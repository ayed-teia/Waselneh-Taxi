# Waselneh Security Hardening — Report

**Repo:** https://github.com/ayed-teia/Waselneh-Taxi (formerly `taxi-line-platform`; the
configured `origin` still uses the old URL, which GitHub redirects — no remote change needed).
**Branch:** `chore/overnight-hardening`
**Base:** `origin/main` @ `85a49c7` (the vulnerable baseline)

All testing is LOCAL via the Firebase emulator suite. Nothing was deployed or merged.

---

## 0. STATE CHECK

`chore/overnight-hardening` already existed with tested fixes for R1, R2 and R6, sitting as a
clean fast-forward on top of `origin/main`. I verified it green before building on it, rather
than redoing that work.

| Check | Result on the existing branch |
|---|---|
| `pnpm install` | PASS |
| `pnpm typecheck` | PASS (6 of 7 projects; `apps/manager-web` has no typecheck script) |
| `pnpm build:functions` | PASS |
| `qa:driver-eligibility:e2e` | 6/6 |
| `qa:request-lifecycle:e2e` | 6/6 |
| `qa:cash-payment:e2e` | 6/6 |
| `qa:security-regression:e2e` | 16/16 |
| **QA total** | **34/34** |
| `pnpm lint` | 83 errors, 130 warnings (down from 1902 errors on main) |

Pre-existing commits carried forward (R1/R2/R6 — detail in `OVERNIGHT_REPORT.md`):

| Commit | Change |
|---|---|
| `c0c77ce` | Baseline record |
| `1336664` | **R6** — export `confirmCashPayment` so payments reach PAID |
| `b12c3bd` | Repair broken ESLint import resolver + safe autofixes |
| `66eab8a` | Mechanically-safe ESLint error fixes |
| `b7174cc` | **SECURITY R1** — stop trusting `users/{uid}` for manager privilege |
| `553fc0a` | **SECURITY R2** — gate dev auth bypass on emulator vars only |
| `ea14bab` | Overnight report |

---

## PRODUCTION EXPOSURE — read-only diagnostics

I ran only read-only commands against `waselneh-prod-414e2`. Nothing was written or deployed.

| Probe | Result |
|---|---|
| `firebase projects:list` | `waselneh-prod` / `waselneh-prod-414e2` — access confirmed genuine |
| `firebase functions:list` | **"No functions found in project waselneh-prod-414e2"** |
| `firebase apps:list` | 4 apps registered (Passenger + Driver, Android + iOS) |
| `firebase firestore:databases:list` | a `(default)` STANDARD FIRESTORE_NATIVE database **exists** |

**Interpretation — please sanity-check this, it drives urgency:**

- **No Cloud Functions are deployed.** So the *backend* halves of R1 (the `getManagerProfile`
  fallback) and **all of R2** (the `devUserId` impersonation bypass) are **NOT currently
  reachable in production.** R2 in particular is the scariest issue on paper, and it appears
  to be un-live.
- **A production Firestore database does exist**, and mobile apps are registered against the
  project. Firestore rules deploy independently of functions, so the rules-side exposure —
  **R1's privilege escalation and the PII read exposure** — is most likely **live**.
- I did **not** attempt to read the deployed rules or any production data, as that goes beyond
  the read-only diagnostic scope I was given. **If you want certainty, check the deployed
  ruleset in the Firebase console** (Firestore → Rules) and compare `isManager()` against
  this branch's version.

Caveat: `functions:list` returning empty is consistent with "never deployed", but I cannot
distinguish that from a permissions quirk with certainty. Treat it as strong evidence, not proof.

---

## 1. CHANGE LOG (this session)

| Commit | Change |
|---|---|
| `df56c53` | State check + read-only production exposure baseline |
| `2618134` | **SECURITY(PII)** — scope `drivers` / `driverLive` reads |
| `af63e16` | First-manager bootstrap script + prod deploy runbook |
| `13494ec` | Restore real import lint rules via the TS resolver |

---

## 2. SECURITY CHANGES FOR REVIEW

Four security items are on this branch. **All need your review; none are deployed.**

### R1 — Privilege escalation (`b7174cc`, pre-existing)
Any signed-in user could set `role: "admin"` on their own `users/{uid}` document,
become a manager, then mint `managerRoles/*` to make it permanent. The backend mirrored
the flaw. Fixed in both halves; also fixed a latent bug where `getManagerProfile()` never
checked `isActive`, so a manager deactivated in the UI kept full backend access.

### R2 — Dev auth bypass (`553fc0a`, pre-existing)
`isEmulatorMode()` returned true when `ENVIRONMENT === 'dev'`, and **`ENVIRONMENT`
defaults to `'dev'`**. Any deployed environment that had not overridden it would accept
`devUserId` from the internet and act as any user named — no credential. Now gated on
the two auto-set emulator variables only.

### R6 — Cash payments never reached PAID (`1336664`, pre-existing)
`confirmCashPayment` was missing from the named export list in
`backend/functions/src/index.ts`, so it was never deployed and every driver cash
confirmation hit a 404.

### PII — driver PII and live GPS readable by anyone (`2618134`, NEW this session)
`drivers/{driverId}` was `allow read: if isAuthenticated()` and `driverLive/{driverId}`
ended in `|| isAuthenticated()`. **Any signed-in account could read — and enumerate the
entire collection of — every driver's `nationalId` and `phone`, and stream every
driver's live GPS position.** Collection enumeration makes this a bulk harvest.

Reads are now scoped to: the driver (owner), a manager (single doc **and** `list`, which
manager-web needs for the live map and drivers list), and the passenger of record on the
driver's current trip via a new `isPassengerOfDriverCurrentTrip()` helper
(`drivers/{id}.currentTripId` -> `trips/{id}.passengerId`).

I mapped every client read path before writing the rule. One detail drove the design:
`passenger-app/app/trip.tsx` gates the **driverLive** subscription on an active trip
status, but does **not** gate the **driver profile** subscription — it only requires
`trip.driverId`. So the rule keys on `currentTripId`, not trip status; a stricter
"active statuses only" rule would have broken the post-trip driver card.

---

## 3. PII OUTCOME — including what is NOT fixed

**Fixed:** arbitrary authenticated users can no longer read or enumerate driver profiles
or live locations. That is the bulk-harvest exposure, and it is closed.

**NOT fixed, deliberately:** Firestore read rules are **per-document, not per-field**.
The passenger of record therefore still receives the whole driver document —
`nationalId` and `phone` included — while they have an assigned driver. There is no
rules-only fix; a field-level read rule does not exist in Firestore.

Per the mandate I stopped at read-scoping rather than attempting a field-level rule or
breaking the passenger flow. The QA suite asserts the scoping and **prints the residual
field exposure explicitly** rather than pretending it is resolved.

**Recommended follow-up (needs your approval — it is a data-model change):** move PII to
a private subcollection, e.g. `drivers/{driverId}/private/pii`, readable only by the
driver and managers, leaving the parent document with just the display fields the
passenger actually consumes (name, photo, rating, vehicle, plate, line). The passenger
app already reads only those display fields, so the client change is small — but it
requires a migration and a backend write-path change, so it belongs in its own PR.

---

## 4. BASELINE vs FINAL

| Check | `origin/main` (85a49c7) | This branch |
|---|---|---|
| `pnpm install` | PASS | PASS |
| `pnpm typecheck` | PASS | **PASS** |
| `pnpm lint` | **FAIL — 1902 errors**, 308 warnings | **83 errors**, 173 warnings, with import rules genuinely enabled |
| `pnpm build:functions` | PASS | **PASS** |
| `qa:driver-eligibility:e2e` | 6/6 | **6/6** |
| `qa:request-lifecycle:e2e` | 6/6 | **6/6** |
| `qa:cash-payment:e2e` | n/a (1/6 vs pre-fix code) | **6/6** |
| `qa:security-regression:e2e` | n/a (6/16 vs pre-fix code) | **16/16** |
| `qa:pii-scoping:e2e` | n/a (**6/13** vs pre-fix rules) | **13/13** |
| **QA total** | 12/12 | **47/47** |

### Negative-control evidence
Every security suite was run against the **pre-fix** code to prove it actually catches
the bug, then restored and byte-verified:

| Suite | Against vulnerable code | After fix |
|---|---|---|
| `qa:cash-payment` | **1/6** — endpoint returns HTTP 404 | 6/6 |
| `qa:security-regression` | **6/16** — full R1 exploit chain succeeds; R2 bypass opens | 16/16 |
| `qa:pii-scoping` | **6/13** — stranger reads *and enumerates* both collections | 13/13 |

The remaining 83 lint errors are all `no-unsafe-*` / `require-await` from
`doc.data()` returning `any`. Silencing them with casts would assert a shape nobody
verified; the real fix is a `FirestoreDataConverter` built on the existing zod schemas,
which is a refactor needing your call on the domain model.

---

## 5. IS THE VULNERABLE CODE LIVE IN PRODUCTION?

Read-only diagnostics only — raw results in the section above.

- **Cloud Functions: none deployed.** So **R2 is not live**, and neither is the backend
  half of R1 nor R6. R2 — the scariest issue on paper — appears never to have shipped.
- **Firestore database: exists**, with 4 mobile apps registered. Rules deploy separately
  from functions, so **R1's rules-side escalation and the PII exposure are most likely
  live right now.**
- I did **not** read the deployed ruleset or any production data. **Please confirm in the
  console** (Firestore -> Rules) — that is the one check that turns "most likely" into
  certainty, and it decides how urgent this PR is.

---

## 6. WHAT NEEDS YOU

1. **Review the PR.** These are authorization changes; I deliberately did not merge.
2. **Confirm the deployed ruleset** in the Firebase console, to settle whether R1/PII are
   live and how fast this needs to ship.
3. **Run the ordered prod deploy** in `docs/PROD_DEPLOY_RUNBOOK.md` — the order is not
   optional: **seed the first manager BEFORE deploying rules**, or the hardened rules will
   lock every human out of the manager dashboard (nobody is a manager -> nobody can write
   `managerRoles`). The bootstrap script is prepared but has never been run.
4. **Decide on the PII follow-up** (private subcollection) — section 3.
5. **If the vulnerable rules were live**, decide with legal/DPO whether driver
   `nationalId`/`phone` exposure requires disclosure.

---

## 7. WHAT I COULD NOT VERIFY

Stated plainly, because some of this matters:

- **Real phone / SMS OTP**, **on-device push**, **payment gateways**, **iOS/Android store
  builds** — no device, no PSP in this codebase, nothing exercised.
- **Real production behaviour of any change here.** Everything was verified against the
  emulator's rules engine and function runtime, which are faithful but not identical to
  production. Nothing was deployed.
- **Whether the production ruleset matches `origin/main`'s `firestore.rules`.** I only
  established that a database exists. `functions:list` returning empty is strong evidence
  functions were never deployed, but I cannot fully exclude a permissions quirk.
- **`apps/manager-web`** — no `typecheck` script and no tests; only linted. Its
  enumeration paths are covered by the PII suite's manager assertions, but the app itself
  was never run.
- **Scheduled functions** (`expireDriverRequests`, `expireStaleTrips`,
  `aggregateOpsMetrics`) — the pubsub emulator was not running, so these never executed.
- **The bootstrap script's write path.** Its four refusal guards were verified (all trigger
  before any Firebase connection opens), but the actual seed write has never been executed
  against any project.

**This code is not bug-free, and I am not claiming it is.** What I verified is listed
above with its evidence; everything else is unverified.

