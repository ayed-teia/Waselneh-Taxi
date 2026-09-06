# Remaining Work — Report

**Branch:** `feat/remaining-work`
**Stacks on:** `chore/overnight-hardening` (PR #1), **not** `main`.
**PR:** https://github.com/ayed-teia/Waselneh-Taxi/pull/2 — **OPEN, not merged.**

### Why it stacks rather than targeting main

This branch modifies `firestore.rules` (the driver PII subcollection) and the driver
PII write paths, both of which build directly on the read-scoping in PR #1. Based on
`main` it would conflict in `firestore.rules` and, worse, would look like it *replaces*
the read-scoping rather than completing it. Reviewing it against PR #1 shows the actual
delta. **Merge PR #1 first, then this.**

All testing was LOCAL via the Firebase emulator suite. Nothing was deployed or merged.

---

## BASELINE vs FINAL

| Check | Baseline (tip of `chore/overnight-hardening`) | Final |
|---|---|---|
| `pnpm install` | PASS | PASS |
| `pnpm typecheck` | PASS (6 projects) | **PASS (7 projects — manager-web added)** |
| `pnpm lint` | 83 errors, 173 warnings | **66 errors**, 173 warnings |
| `pnpm build:functions` | PASS | PASS |
| `qa:driver-eligibility:e2e` | 6/6 | 6/6 |
| `qa:request-lifecycle:e2e` | 6/6 | **8/8** (+2 dispatch) |
| `qa:cash-payment:e2e` | 6/6 | 6/6 |
| `qa:security-regression:e2e` | 16/16 | **17/17** (+1 RBAC) |
| `qa:pii-scoping:e2e` | 13/13 | **20/20** (+7 PII split) |
| **QA total** | **47/47** | **57/57** |

CI now runs all of this automatically on every push and PR.

---

## WHAT WAS BUILT

### 1. The PII fix, completed (`8f26987`) — needs review

PR #1 scoped *who* can read `drivers/{id}`, but Firestore read rules are per-**document**,
so the passenger on an active trip — who legitimately reads that document for the driver
card — still received `nationalId`, `phone` and the driver's legal `fullName`.

Those three fields now live in `drivers/{id}/private/pii`, readable only by the driver
and managers, `allow write: if false` for every client. The parent document keeps only
what the passenger renders, with `displayName` replacing `fullName`.

- `modules/drivers/driver-pii.ts` centralises the path, read/write helpers, and a
  `stripDriverPii()` guard so a future write path cannot put PII back by accident.
- `managerSetDriverEligibility` and `devIssueDriverToken` both split their writes.
- The passenger app fetched `driver.phone` and **never used it** (no call feature) —
  removed outright. Name resolution already fell back to `displayName`.
- manager-web genuinely needs the PII, and a collection-wide snapshot cannot reach a
  subcollection, so `fetchDriverPii()` hydrates each row per driver (guarded; a failure
  does not break the page and does not clobber in-progress edits).
- `scripts/migrate-driver-pii.mjs` — dry-run by default, explicit `--project`, refuses
  production without an extra acknowledgement flag, `--backup`, copies-then-deletes in
  **one batch** so a driver is never left half-migrated, idempotent. **Never run.**

**Test evidence (negative controls, `qa:pii-scoping` 13 → 20 checks):**

| Control | Result |
|---|---|
| Seed a driver in the **old** shape (PII on the parent doc) | passenger receives `[nationalId, phone, fullName]` — the new assertion **catches it** |
| Remove the private-subcollection **rule** | the positive controls fail — driver and manager cannot read their own PII |
| After the change | **20/20**, including: driver and manager still read the PII *and get the real values*, and the passenger still gets `displayName` for the trip card |

### 2. Backend RBAC hardening (`f53c0ac`) — needs review

`getManagerProfile()` denied only an explicit `isActive: false`, so a `managerRoles`
document with **no** `isActive` field passed every manager callable — while the Firestore
rule (`isActive == true`) rejected it. The two sides disagreed. Both now fail closed.

**Negative control:** against the pre-change backend, a document with the field deleted
gets a working manager session (16/17). After: **17/17.**

### 3. Dispatch reliability (`4c8ad7b`, `ab20c21`)

Dispatch was single-shot: it ranked every eligible driver, offered to the nearest, then
**threw the rest of the ranking away**. One rejection — or one unanswered 45s offer —
sent the trip to `NO_DRIVER_AVAILABLE` even with other eligible drivers metres away.

`modules/trips/reoffer-trip.ts` walks to the next viable candidate, re-reading each one
(the ranking may be stale) and preserving nearest-first order. Bounded by both the
candidate list and `MAX_DISPATCH_ATTEMPTS` (5); the existing sweeper still enforces the
overall search-timeout budget. Sequential rather than broadcast, because
`createTripRequest` locks the driver at *offer* time — broadcasting would require
rewriting that locking model.

**Test evidence (negative controls, `qa:request-lifecycle` 6 → 8):**

| Control | Result |
|---|---|
| Pre-change code | "Re-offer on reject" fails — `Expected a persisted candidate list of >= 2, got undefined` |
| Pre-change code | "Re-offer exhaustion" fails — trip still assigned to the first driver |
| After the change | **8/8** — the second driver receives a pending offer **and completes the accept flow**; the exhaustion scenario proves it still ends at `no_driver_available`, so re-offering is genuinely bounded |

> Found by the emulator, not by review: both call sites needed their transactions
> reordered, because the re-offer reads candidate documents and Firestore rejects a read
> that follows a write in the same transaction.

### 4. CI + quality infra (`1a26420`)

`.github/workflows/ci.yml`: install → typecheck → lint → build, plus all five QA suites
inside `firebase emulators:exec` (which tears the emulator down even on failure). Java is
installed explicitly — the Firestore emulator needs it.

**Lint is deliberately advisory**, not blocking. With 66 pre-existing errors a blocking
step would leave CI permanently red and therefore ignored. Flip it once that backlog
clears.

Added the missing `typecheck` script to `apps/manager-web`, which had none and was not
type-checked at all. It passes.

Also `scripts/run-qa-suites.mjs` (`pnpm qa:all`) — one entry point for CI and local,
because chaining commands inside the `emulators:exec` argument breaks on Windows.

### 5. i18n (`1d9bd32`)

`TripRequestModal` was entirely English — including both Alert dialogs a driver reads
before accepting or rejecting a trip, the most consequential screen in the driver app for
an Arabic reader. It did not import the i18n system at all. Every string is now a `t()`
key with an Arabic translation.

Also converted `LiveEtaCard` / `SafetyToolsCard` / `TripChatPanel` (13 keys). Those
ternaries already carried both translations, so the Arabic is preserved verbatim.

**Verified** with a key-resolution check across the whole driver app: all 43 `t()` keys
resolve in **both** locales and the en/ar tables are exactly in sync (77 each). A missing
key renders the raw key string at runtime, which typecheck cannot catch.

### 6. Manager payment reconciliation (`def61a3`)

A completed trip records its own `paymentStatus` and a separate `payments` document
records the money; nothing compared them. The new page joins both and classifies every
completed trip as **Collected / Uncollected / Unrecorded**, plus **Orphaned** payments,
with shekel totals and a filter.

**Read-only**, as required — no new write path, no new callable; both collections are
already `allow write: if false` for clients.

### 7. Typed Firestore accessors (`6344944`)

`doc.data()` is typed `any` — the source of every `no-unsafe-*` error, and the reason a
renamed field fails silently at runtime. `core/firestore/doc-data.ts` adds small
narrowing accessors, adopted in the two densest sites including the global kill switch.

**Lint 80 → 66.** Both sites needed conditional spreads rather than `?? undefined`,
because the project runs `exactOptionalPropertyTypes` — worth knowing before converting
the rest.

---

## WHAT WAS PREPARED ONLY (not enabled, not half-built)

| Item | Where | State |
|---|---|---|
| Phone/OTP auth | `packages/shared/src/config/auth-flags.config.ts`, `docs/AUTH_ROLLOUT.md` | Flag **defaults false** (verified for unset/empty/`false`/`0`/`no`). Dev login untouched. |
| Manager production login | `docs/AUTH_ROLLOUT.md` §3 | Design only. **manager-web has no production login today** — a dashboard launch blocker. |
| Driver onboarding + documents | `docs/REMAINING_PLAN.md` §1 | Design only. Blocked on Storage, which this project does not use at all — no `storage.rules` exists. |
| Card / online payments | `docs/REMAINING_PLAN.md` §2 | Design only. Blocked on choosing a PSP that settles ILS to West Bank accounts — the real constraint, not the SDK. |
| Taxi-line FIFO queue | `docs/REMAINING_PLAN.md` §3 | Design only. Blocked on a fairness policy. |

**I did not build the OTP sign-in UI.** A sign-in screen that cannot be exercised against
a real SMS on real hardware is guesswork shaped like progress. The flag and `OTP_LIMITS`
exist so the server-side rate limiting and the UI can be written against a fixed contract
once you have decided the open questions.

---

## DECISIONS I NEED FROM YOU

**Blocking the PII migration:**
1. **When does `migrate-driver-pii.mjs` run?** It must run **before** these rules ship,
   or manager-web shows blank national IDs until it does. It has never been run anywhere.

**Blocking auth** (full list in `docs/AUTH_ROLLOUT.md` §5):

2. Which country codes — `+970` only, or `+970` and `+972`?
3. SMS budget and expected daily sign-in volume.
4. Manager login method — email+password with MFA, or SSO?
5. Do existing dev-provisioned accounts get migrated or wiped?

**Blocking the other features** (full lists in `docs/REMAINING_PLAN.md`):

6. **Which PSP?** Everything about payments follows from this.
7. **Queue fairness rules** — what forfeits a driver's place? Best agreed *with* drivers:
   shipping distance-based matching into a rank culture is a strike, not a bug report.
8. Who may view identity documents, and how long are they retained? (Storing scans of
   national IDs is a real legal obligation.)

**Smaller:**

9. Should CI's lint step become blocking once the 66 errors clear?
10. Delete `apps/driver-app/src/services/firebase/firebase.config.old.ts`? Provably
    unreferenced, but deleting it is a judgement call about intent.

---

## WHAT I COULD NOT VERIFY

Stated plainly:

- **Real phone/SMS OTP, on-device push, payment gateways, iOS/Android store builds** —
  no device, no PSP in this codebase, nothing exercised.
- **The PII migration script's write path.** Its guards were verified (all refusal paths
  trigger before any Firebase connection opens), but **the actual migration has never run
  against any project**, including the emulator. Run it against a staging copy first, with
  `--backup`.
- **The dispatch re-offer under real concurrency.** The emulator tests are sequential.
  Two drivers rejecting simultaneously, or a driver accepting exactly as the sweeper
  re-offers, are races the transaction *should* handle but that I did not load-test.
- **The `expireDriverRequests` re-offer path end to end.** The pubsub emulator was not
  running, so the scheduled function never executed; I verified its reject-path twin and
  the shared module, not that scheduled invocation.
- **manager-web at runtime.** It now typechecks and lints, but the app was never launched
  — the reconciliation page and the PII hydration in DriversListPage have not been seen
  rendering. Both are covered indirectly by the QA suite's manager assertions.
- **The CI workflow itself.** The `emulators:exec` command and `qa:all` were verified
  locally, but the workflow has not run on GitHub Actions — it will first execute on the
  push that opens this PR.
- **Arabic translation quality.** Strings were preserved verbatim from existing bilingual
  ternaries or written to match the surrounding style; a native reader should review the
  new `request.*` keys.

**This code is not bug-free, and I am not claiming it is.** What I verified is above with
its evidence; everything else is unverified.
