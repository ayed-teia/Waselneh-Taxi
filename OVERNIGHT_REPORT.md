# Overnight Hardening Report

**Branch:** `chore/overnight-hardening` — committed, **not merged, not pushed, not deployed.**
**Date:** 2026-09-05
**Agent:** Claude Opus 5, unattended.

All runs were **local, against the Firebase emulator suite** (auth, firestore, functions).
No deploy ran. `waselneh-prod-414e2` appears only as the emulator's project id (the suite
requires one); nothing contacted production. No new dependencies were added and no Firebase
project config or secrets were touched.

> **Two files were already modified in your working tree when I started**
> (`apps/driver-app/.../DriverMapView.tsx`, `apps/passenger-app/.../PassengerMapView.tsx`).
> I deliberately left them **uncommitted** so your in-progress work is not absorbed into my
> commits. The ESLint autofix did reorder imports inside them; if you want those two files
> pristine, `git checkout --` them and re-run `npx eslint --fix` on them later.

---

## 1. SECURITY CHANGES FOR REVIEW (R1 / R2)

Both are in their own commits, flagged `[NEEDS REVIEW]`. **Assume these ship only after
your review.** R1 touches `firestore.rules`, so releasing it means releasing rules.

### R1 — Privilege escalation: any user could make themselves an admin
**Commit `b7174cc`** — `firestore.rules`, `backend/functions/src/modules/auth/manager-rbac.ts`,
`docs/MANAGER_PROVISIONING.md`

**The exploit chain (reproduced end to end, not theoretical):**
1. `match /users/{uid}` allowed the owner to write their *entire* document.
2. `isManager()` in `firestore.rules` trusted `users/{uid}.role`.
3. So any signed-in user set `role: "admin"` on themselves and became a manager.
4. `match /managerRoles/{uid}` allows `write: if isManager()` — so they then minted their own
   `managerRoles` document, making the escalation permanent and surviving a revert of step 1.
5. The backend had the mirror-image flaw: `getManagerProfile()` fell back to `users/{uid}`
   for `role`, `permissions`, `officeIds` and `lineIds`. The escalated user got a **real
   manager session from `getManagerSession`.**

**What changed:**
- `isManager()` no longer reads `users/{uid}.role`. Manager status now comes only from a
  verified custom claim, or an `isActive: true` `managerRoles/{uid}` document.
- `match /users/{uid}` split from a blanket `allow write` into `create` / `update` / `delete`.
  An owner may still edit their own profile (displayName, etc.) but may **not** set or change
  `role`, `permissions`, `officeIds`, `officeId`, `lineIds`, `lineId`, `managerRole`, `status`.
  Managers still can; Cloud Functions use the Admin SDK, which bypasses rules entirely.
- Removed the now-unreferenced `userDocPath()` rules helper (proved zero call sites first).
- `getManagerProfile()` reads `managerRoles/{uid}` **only**, and now also rejects
  `isActive: false`. **Separate latent bug found and fixed here:** `isActive` was never
  checked, so a manager deactivated through the UI kept full backend access.
- `docs/MANAGER_PROVISIONING.md` documents the new first-manager bootstrap path.

**First-manager provisioning (this is the operational consequence — please sanity-check it):**
With the `users` fallback gone, nobody can promote themselves from a client. That is intended.
The first manager in a fresh environment must be seeded by an operator with project
credentials, via a one-off Admin SDK write to `managerRoles/{uid}` (recommended), and/or a
custom claim. Full detail and a copy-pasteable snippet are in `docs/MANAGER_PROVISIONING.md`.
Locally, the emulator-only `devIssueManagerToken` still works and is hard-gated behind
`isEmulatorEnvironment()`.

**How to verify:**
```
# terminal 1
corepack pnpm emulators:core
# terminal 2
corepack pnpm qa:security-regression:e2e
```

### R2 — Dev auth bypass reachable in production
**Commit `553fc0a`** — `backend/functions/src/core/auth/devAuth.ts`

`devAuth` lets an unauthenticated caller pass `devUserId` in the request body and be treated
as that user. Fine in the emulator — except `isEmulatorMode()` also returned true when
`ENVIRONMENT === 'dev'`, and **`ENVIRONMENT` defaults to `'dev'`** (`core/env/env.ts:12`).

So any deployed environment that had not explicitly overridden `ENVIRONMENT` would accept
`devUserId` **from the public internet and act as any user id the caller named, including a
manager, with no credential at all.** Combined with R1's `getManagerSession`, that is a
complete unauthenticated takeover path.

**What changed:** the gate is now exactly the two variables the emulator sets automatically
and a deployed function never has:
```ts
process.env.FUNCTIONS_EMULATOR === 'true' || process.env.FIRESTORE_EMULATOR_HOST !== undefined
```
This intentionally matches `isEmulatorEnvironment()` in `core/config/firebase.config.ts`, so
the codebase's two emulator checks can no longer disagree.

### Proof these tests actually catch the bugs
I ran the new suite against the **pre-fix** code (temporarily reverting the three files via
`git stash`, then restoring and byte-verifying them). It **failed 10 of 16**, reproducing both
vulnerabilities in full:

```
❌ R1: self-assigning users/{uid}.role = admin is blocked - The write SUCCEEDED
❌ R1: self-assigning users/{uid}.permissions/managerRole/officeIds/lineIds/status - SUCCEEDED
❌ R1: self-minting managerRoles/{uid} is blocked - The write SUCCEEDED
❌ R1: backend RBAC ignores users/{uid}.role - getManagerSession SUCCEEDED
❌ R1: deactivated managerRoles document is refused - getManagerSession SUCCEEDED
❌ R2: ENVIRONMENT=dev alone does NOT enable the devUserId bypass - the regression is back
```
Against the fixed code: **16/16 pass**, including positive controls proving an active manager
still authenticates and an owner can still edit their own profile — i.e. the rules were
tightened, not merely broken shut.

---

## 2. ALL OTHER CHANGES

| Commit | Change |
|---|---|
| `c0c77ce` | Baseline record (this report's section 3). |
| `1336664` | **R6 fix** — export `confirmCashPayment`; new `qa:cash-payment:e2e`. |
| `b12c3bd` | Repair the broken ESLint import resolver; apply safe autofixes. |
| `66eab8a` | Resolve the mechanically-safe ESLint errors. |
| `b7174cc` | **SECURITY R1** (above). |
| `553fc0a` | **SECURITY R2** (above). |

### R6 — cash payments never reached PAID (`1336664`)
`confirmCashPayment` existed in `api/callable/confirmCashPayment.callable.ts`, was re-exported
from `api/callable/index.ts`, and the driver app called it — but `backend/functions/src/index.ts`
re-exports callables by **explicit name**, and it was missing from that list. The function was
never deployed; every driver cash confirmation hit a nonexistent endpoint, and **no trip ever
reached `paymentStatus: 'paid'`.**

Fix: added the one missing named export. Added `qa:cash-payment:e2e`, which drives a real trip
accept → arrived → start → complete and asserts the payment reaches `paid` **and persists**
(`paymentStatus` + `paidAt` read back from Firestore), plus guards: not-yet-completed, wrong
driver, and double collection.

Negative control: against the pre-fix build the suite scored **1/6**, with the endpoint
returning HTTP 404 "Function does not exist". After the fix: **6/6**.

### Lint repair (`b12c3bd`, `66eab8a`)
`.eslintrc.json` declared `settings["import/resolver"].typescript`, but
**`eslint-import-resolver-typescript` is not a dependency of this repo.** ESLint reported
`invalid interface loaded as resolver` and treated every import as unresolvable — cascading
into ~1800 false errors that buried the real signal and made `pnpm lint` unpassable.

Installing the resolver would add a dependency (forbidden by the mandate), so I fixed it by
configuration: use the bundled node resolver, register the TS parser for `.ts`/`.tsx`, and
disable *only* the rules that genuinely require TypeScript path resolution
(`import/no-unresolved`, `namespace`, `default`, `export`, `no-named-as-default*`).
**No rule that checks actual code correctness was relaxed.**

Then `eslint --fix` (import ordering only — I verified the diff contains no non-import code
changes), plus hand-fixes: useless regex escapes, `@ts-ignore` → `@ts-expect-error`, two
floating `main()` promises in QA scripts now `.catch()` and exit 1, and rationale-carrying
suppressions where the rule was simply wrong (Firestore *requires* a promise-returning
`runTransaction` callback; `qa-step33`'s `require()` is a runtime-conditional load guarded by
`fs.existsSync`).

**Lint: 1902 errors → 83.**

---

## 3. BASELINE vs FINAL

| Check | Baseline | Final |
|---|---|---|
| `pnpm install` | PASS | PASS |
| `pnpm typecheck` | PASS | **PASS** |
| `pnpm lint` | **FAIL — 1902 errors**, 308 warnings | **83 errors**, 130 warnings |
| `pnpm build:functions` | PASS | **PASS** |
| `qa:driver-eligibility:e2e` | 6/6 | **6/6** |
| `qa:request-lifecycle:e2e` | 6/6 | **6/6** |
| `qa:cash-payment:e2e` | *(did not exist; 1/6 against pre-fix code)* | **6/6** |
| `qa:security-regression:e2e` | *(did not exist; 6/16 against pre-fix code)* | **16/16** |
| **QA total** | 12/12 | **34/34** |

`pnpm typecheck` covers 6 of 7 workspace projects — **`apps/manager-web` has no `typecheck`
script**, so it is not type-checked by CI at all. Worth adding; I did not, as it is outside
this mandate's scope and would likely surface a new error backlog.

### The 83 remaining lint errors — why I did not "fix" them
All are `@typescript-eslint/no-unsafe-*` (78) and `require-await` (5), and they share one root
cause: **`DocumentSnapshot.data()` returns `any`**, so every field read off a Firestore
document is unsafe-by-analysis. Examples: `tripData.fareAmount`, `data.updatedAt?.toDate?.()`.

Silencing them with casts would be *worse* than leaving them — a cast asserts a shape nobody
verified. The correct fix is real typing at the boundary: zod schemas already exist in
`packages/shared/src/schemas`, so the path is a `FirestoreDataConverter` (or parsing
`doc.data()` through the existing schemas) per collection. That is a genuine refactor of every
callable's data access, needs your call on the domain model, and had real regression risk to do
unattended. **Left deliberately, documented, not hidden.**

---

## 4. NOT TOUCHED (your human-only list) + recommended plan

I built none of these, as instructed. Each is a sketch for you, not started work.

**Real phone / OTP login.** Needs a real device and a paid SMS path; the emulator's auth
fakes OTP entirely. Plan: enable Phone provider + reCAPTCHA/App Check in the Firebase console;
implement `signInWithPhoneNumber` behind the existing i18n login screens; add a resend cooldown
and an attempt limiter (server-side, not client); decide test numbers for the app-store review
build. Blocking decision: which numbers/countries to allow, and the SMS budget cap.

**Driver onboarding.** Depends on document upload (Storage rules do not exist in this repo yet
— `firebase.json` configures no storage emulator) and on a human verification step. Plan:
define the document set and the `verificationStatus` state machine, add Storage rules where a
driver can write only their own pending docs and only a manager can read them, then a manager
review queue. Blocking decision: who verifies, and the legal retention period for ID documents.

**Manager auth.** Now partly unblocked by R1 — `docs/MANAGER_PROVISIONING.md` defines the
bootstrap. Remaining: a real manager login for `apps/manager-web` (currently leaning on
`devIssueManagerToken`, which is emulator-only), ideally SSO or email+password with enforced
MFA. Blocking decision: identity provider.

**Card / online payments.** Deliberately untouched — this is money, and R6 shows the cash path
was silently broken. Plan: pick the PSP first (West Bank coverage and ILS settlement are the
real constraints, not the SDK); model payments as a state machine with an idempotency key per
trip; treat the PSP webhook as the source of truth, never the client; reconcile against
`payments/{id}`. Do the cash path's `paid` transition as the reference implementation — it
now has test coverage. **Never trust a client-reported payment success.**

**Booking place-picker.** Needs a product decision before code: Mapbox (a token already exists
in the backend) vs Google Places, and whether search is Arabic-first with transliteration —
which matters a lot here and is easy to get wrong. Plan: a debounced geocoding search against
the chosen provider proxied *through a callable* so the key is never in the app bundle, plus
recent/saved places in Firestore.

**"Taxi-line" queue.** The biggest design task and the one I'd most avoid half-building. It is
a fairness system, not a feature: FIFO position per line, what forfeits a position (declining,
going offline, leaving a geofence), and how it interacts with the existing dispatch in
`dispatchTripRequest`. Plan: write the fairness rules down and get driver agreement *first*;
model the queue as a Firestore collection with server-assigned positions mutated only by
callables; then extend `qa-request-lifecycle-e2e` with queue scenarios before any UI.

### Also not touched, deliberately
- **`apps/driver-app/src/services/firebase/firebase.config.old.ts`** — I proved it has zero
  references anywhere in the repo. But it is a superseded copy of live Firebase config, and
  deleting it is a call about your intent rather than a correctness fix, so I left it.
  Recommend deleting it yourself.
- **`requireAuth` in `core/auth/devAuth.ts`** — currently unused (only re-exported by the
  barrel), but it is a reasonable public helper and removing it would be guesswork. Left.
- The two `MapView.tsx` files you had in progress (see the note at the top).

---

## 5. THINGS I WAS UNSURE ABOUT

1. ~~**The `status` field in R1's privilege list.**~~ **Resolved — I checked.** I grepped every
   client app for writes to the `users` collection and found **none**: the only code that
   touches `users` is backend (`devIssueManagerToken`, `managerOperations`,
   `getManagerSession`), all via the Admin SDK, which bypasses these rules entirely. So
   blocking owner-writes to `status` (and the other privilege fields) cannot break an existing
   client write path. Worth re-checking if a client ever starts writing its own user document.
   Relatedly, `getManagerSession` reads `users/{uid}` only for `displayName`/`email` display
   fields — every authorization value it returns comes from the `managerRoles`-backed profile,
   so it was already structured correctly for this change.
2. **Disabling `import/no-unresolved` rather than adding the resolver.** This trades away real
   broken-import detection to obey the no-new-dependencies rule. If you'd rather have the
   coverage, `pnpm add -Dw eslint-import-resolver-typescript` and revert my `.eslintrc.json`
   settings block — that is the better end state.
3. **`isActive` on `managerRoles`.** I made a missing `isActive` field *permissive* (only an
   explicit `isActive === false` denies), matching the Firestore rule's `== true` only
   loosely — the rule is stricter than the backend here. Existing documents all set it, so
   this is consistent today, but the two could drift. Tightening the backend to require
   `isActive === true` would be safer; I did not, to avoid locking out any document I cannot
   see in your production data.
4. **`getManagerSession` error text.** My R1 test accepts "manager role is required" or a
   permission error. If that message is ever reworded the assertion loosens rather than fails.
5. Whether the emulator warning `PERMISSION_DENIED ... false for 'update'` printed during
   `qa-driver-eligibility` is expected. It appears in the **baseline too** and the suite passes,
   so it looks like an intentional negative test logging noisily — but I did not chase it down.

---

## 6. HONEST LIMITS — what I could NOT verify

I did not test, and make no claim about:
- **Real phone / SMS OTP** — the emulator fakes auth entirely.
- **On-device push notifications** — no device, no APNs/FCM delivery path.
- **Any payment gateway** — no PSP exists in this codebase yet. R6 is verified only for the
  *cash* state transition inside the emulator.
- **iOS / Android store builds** — never invoked; no native build ran.
- **`apps/manager-web`** — has no `typecheck` script and no tests; I only linted it.
- **Real production Firestore rules behaviour** — rules were exercised against the emulator's
  rules engine, which is faithful but not identical to production, and never deployed.
- **Load, concurrency, and the scheduled functions** (`expireDriverRequests`, `expireStaleTrips`,
  `aggregateOpsMetrics`) — the pubsub emulator was not running, so these were **not executed**.
  I edited `expireStaleTrips` (a lint suppression only, no logic change), and its
  `runTransaction` paths are therefore **untested by this run**.

**This code is not bug-free and I have not claimed it is.** What I verified is stated above
with its evidence; everything else is unverified. The two security fixes in particular change
authorization behaviour and deserve your review before they ship.
