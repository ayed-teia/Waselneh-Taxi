# Final Hardening — Report

**Branch:** `chore/final-hardening` (off `main` @ `59fb234`, with PR #1 and PR #2 merged)
**PR:** https://github.com/ayed-teia/Waselneh-Taxi/pull/3 — **OPEN, not merged.**

All testing was LOCAL via the Firebase emulator suite. Nothing was deployed, nothing was
merged, and the PII migration was **not** run.

---

## BASELINE vs FINAL

| Check | Baseline (`main` @ 59fb234) | Final |
|---|---|---|
| `pnpm install` | PASS | PASS |
| `pnpm typecheck` | PASS (6 projects) | PASS (6 projects) |
| `pnpm lint` | **66 errors**, 173 warnings | **0 errors**, 169 warnings |
| `pnpm build:functions` | PASS | PASS |
| `qa:driver-eligibility:e2e` | 6/6 | 6/6 |
| `qa:request-lifecycle:e2e` | 8/8 | **9/9** |
| `qa:cash-payment:e2e` | 6/6 | 6/6 |
| `qa:security-regression:e2e` | 17/17 | 17/17 |
| `qa:pii-scoping:e2e` | 20/20 | 20/20 |
| `qa:scheduled:e2e` | *(did not exist)* | **6/6** |
| `qa:reconciliation` | *(did not exist)* | **11/11** |
| **QA total** | **57/57** (5 suites) | **75/75** (7 suites) |

CI now runs all seven suites, and its lint step is **blocking**.

---

## WHAT WAS BUILT

### 1. Typed Firestore accessors, finished — lint 66 → 0 (`14ab60c`, `1c22457`, `2dea3b1`)

`doc.data()` is typed `any`, so every field read was unchecked by both TypeScript and
ESLint — and a renamed field failed silently at runtime rather than loudly at the
boundary. The `core/firestore/doc-data.ts` pattern is now rolled out across **all**
shipped source: no callable or trigger in `backend/functions/src` consumes `doc.data()`
as `any` any more.

Two accessors were added for cases the rollout hit: `getRecord()` for nested maps
(`rideOptions.officeId`) and `getLatLng()` for the `{ lat, lng }` pairs on trips.

Beyond the mechanical conversion this removed **four `as any` casts on `vehicleType`**,
replaced with the existing `normalizeVehicleType` helper. Those casts were silently
accepting any string where a `VehicleType` was expected — a real (if latent) bug, not
just a lint complaint.

Patterns worth knowing before touching this again:

- Narrowing a status to `unknown` then interpolating it into an error message trips
  `restrict-template-expressions`. Reading it once into a typed local fixes the
  comparison *and* the message, and reads better.
- `FirebaseFirestore.DocumentData` has an `any` index signature, so narrowing the whole
  body once with `asRecord()` beats narrowing field by field (`dynamic-pricing`).
- A `readonly TripStatus[]` needs widening for a membership test, rather than casting the
  value that came out of Firestore.
- `exactOptionalPropertyTypes` is on: an absent optional property must be **omitted**
  via a conditional spread, never set to `undefined`.

**The last 25 errors were in `qa-step32.ts` / `qa-step33.ts`** — orphaned one-off
verification scripts from historical delivery steps. Nothing references them (no npm
script, no CI job, no import), and `qa-step33` initialises against a **different project
id** (`demo-taxi-line`), so it cannot run against this emulator setup at all. Their errors
are a runtime-conditional `require()` and `async` test functions with no `await` — patterns
it would be wrong to "fix" in a script nothing runs. They are **excluded from linting
rather than deleted**, because removing someone else's historical QA record is a judgement
call; `backend/functions/scripts/README-qa-step-legacy.md` records why, and notes deleting
both is safe if you are finished with them.

> A detail worth flagging: the exclusion had to go in `backend/functions/.eslintrc.json`,
> not the root config. That nested config sets `"root": true`, so the root
> `ignorePatterns` never applied to those files.

### 2. CI lint step is now blocking (`2dea3b1`)

With `pnpm lint` exiting 0, the step no longer swallows failures. Warnings (169, mostly
`no-console` in QA scripts) are still permitted, so it fails only on a genuine new error.

### 3. The scheduled-function verification gap is closed (`a5a0af5`)

`expireDriverRequests`, `expireStaleTrips` and `aggregateOpsMetrics` had **no coverage at
all**. The pubsub emulator was not configured, so the functions emulator skipped them
entirely — which meant **the dispatch re-offer path inside `expireDriverRequests` had
never actually executed under a scheduled run.** Its behaviour was inferred from the
reject-path twin that shares the module.

- `firebase.json` now configures the pubsub (8085) and eventarc (9299) emulators. All
  three functions initialise as pubsub functions instead of being skipped.
- New `qa-scheduled-functions-e2e.mjs`, wired into `pnpm qa:all` and CI.

**On how they are invoked, because this matters for how much the tests prove:** publishing
to the `firebase-schedule-<name>` topics does **not** dispatch them. firebase-tools 15.29.0
rejects v2 `onSchedule` functions with `Unsupported trigger signature: http` — confirmed
in `pubsub-debug.log`, not guessed. The tests therefore call `.run()` on the compiled
export, the handle `firebase-functions` provides for exactly this. That exercises the real
shipped handler against real emulator Firestore. What it does **not** cover is Cloud
Scheduler's own delivery, which is Google's to get right and cannot be tested locally
either way. That limitation is stated in the script header rather than glossed over.

Six scenarios: expiry with no candidates fails the trip; **expiry WITH a candidate
re-offers to it** (the previously-unexecuted path); an `open` request past the search
timeout expires with reason `no_driver_found`; a driver no-show is cancelled and the driver
freed; `aggregateOpsMetrics` writes `opsMetrics/current` with counters reflecting seeded
live state; and the sweepers are safe to re-run — which a once-a-minute cron guarantees
will happen.

**Negative control:** with the re-offer branch disabled, the re-offer scenario fails with
`trip should stay pending after re-offer, got no_driver_available`. Enabled: 6/6.

### 4. Coverage strengthened (`46a229a`)

**Reconciliation.** The classification deciding whether money counts as collected was
inline in `PaymentReconciliationPage`, so it was only verifiable by eye. It is now pure
functions in `apps/manager-web/src/services/reconciliation.ts` — **the page imports them,
so the tested code is the shipped code** — with 11 checks. Beyond the four headline states
it pins down cases that are easy to get subtly wrong: a `pending` trip carrying a stray
payment row is still *uncollected* (the trip, not the ledger row, settles whether the ride
was paid for); an unknown or `failed` status is never read as paid; and a payment with an
empty `tripId` is ignored rather than becoming a wildcard match against every trip.

**Negative control:** flipping the classifier so a missing payment returns `collected`
fails the suite (10/11) — which also proves the harness loads the real module, not a stub.

**Dispatch.** Added a scenario proving a re-offer **never returns the trip to a driver who
already rejected it**, and that `triedDriverIds` records them. Handing a trip back to the
driver who just declined would be worse than the original dead-end: it wastes the
passenger's time *and* annoys the driver.

### 5. Dead code removed (`5f388b9`)

`apps/driver-app/src/services/firebase/firebase.config.old.ts` — 264 lines, zero
references. Proof: no import by any spelling; the `services/firebase/index.ts` barrel
re-exports only `./firebase`, so it was not barrel-reachable; its only code mention was a
tsconfig `exclude` entry — a *negative* reference, keeping it out of compilation because it
does not compile. It also hardcoded a production Firebase apiKey, which is a further reason
not to leave a stale duplicate around. The dangling `exclude` entry was removed too, and
driver-app still typechecks **with the exclusion gone**, which independently confirms
nothing referenced it.

**Deliberately kept:** `scripts/bootstrap-first-manager.mjs` and
`scripts/migrate-driver-pii.mjs`. Neither is referenced by any npm script or CI job, but
both are one-shot operational tools meant to be run by hand — absence from `package.json`
is expected for that class of script, not evidence they are dead.

No other backup-style file exists (`*.old.*`, `*.bak`, `*.backup`, `*-copy*`, `*.orig`). A
filename-stem sweep across all 292 source files found no further orphans, but that is a
heuristic and **not proof**, so nothing else was removed. A real answer needs import-graph
analysis (`knip` / `ts-prune`) — noted as follow-up rather than guessed at.

---

## PRODUCTION EXPOSURE (read-only diagnostics)

`firebase functions:list --project waselneh-prod-414e2` → **"No functions found"**,
consistent with previous checks. The first attempt returned a transient
`Failed to list functions`; `projects:list` confirmed access was fine, and a retry returned
the normal empty result. So the transient error was **not** evidence of a state change —
worth stating precisely rather than reporting the first failure as a finding.

Nothing was written. The PII migration was not run.

---

## STILL DECISION- OR DEPLOY-GATED (untouched, as instructed)

| Item | Plan | Blocked on |
|---|---|---|
| Production phone/OTP login | `docs/AUTH_ROLLOUT.md` | Your decisions (country codes, SMS budget) + console steps + a device |
| Manager production login | `docs/AUTH_ROLLOUT.md` §3 | Your choice: email+MFA or SSO |
| Driver onboarding + documents | `docs/REMAINING_PLAN.md` §1 | Firebase Storage (unused in this project — no `storage.rules`) + retention policy |
| Card / online payments | `docs/REMAINING_PLAN.md` §2 | Choosing a PSP that settles ILS to West Bank accounts |
| Taxi-line FIFO queue | `docs/REMAINING_PLAN.md` §3 | A fairness policy, ideally agreed *with* drivers |
| **The production deploy** | `docs/PROD_DEPLOY_RUNBOOK.md` | Yours to run |
| **The PII migration** | `scripts/migrate-driver-pii.mjs` | Yours to run — must run BEFORE the new rules ship |

The auth feature flag remains **OFF** and untouched. The dev login is unchanged.

---

## WHAT I COULD NOT VERIFY

Stated plainly:

- **Real phone/SMS OTP, on-device push, payment gateways, iOS/Android store builds** — no
  device, no PSP in this codebase, nothing exercised.
- **The PII migration's write path.** Still never run against any project, including the
  emulator. Its guards are verified; the migration itself is not.
- **Cloud Scheduler delivery.** The scheduled handlers are now covered, but their *cron
  invocation* is not — firebase-tools cannot dispatch v2 `onSchedule` via pubsub locally
  (see above). If a schedule string were wrong, these tests would not catch it.
- **manager-web at runtime.** It typechecks, lints, and its reconciliation *logic* is now
  unit-tested, but the app has still never been launched in a browser. The rendering is
  unverified.
- **The CI workflow's new blocking lint step and pubsub emulator** — verified locally via
  the identical `pnpm qa:all` command, but the workflow itself runs for the first time on
  this PR.
- **Production behaviour of anything here.** Everything was verified against the emulator,
  which is faithful but not identical to production. Nothing was deployed.
- **Whether any of the remaining 290 source files are dead** — the sweep was a filename
  heuristic, not import-graph analysis.

**This code is not bug-free, and I am not claiming it is.** What I verified is above with
its evidence; everything else is unverified.
