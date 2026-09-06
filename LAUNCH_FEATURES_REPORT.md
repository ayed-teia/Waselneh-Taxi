# Launch Features — Report

Built off `main` @ `c88c1fb` (PRs #1–#3 merged). **Four separate PRs, one per feature**, rather than one stacked branch: each is independently reviewable and independently revertible, and three of the four touch security rules — reviewing those interleaved would be worse, not better.

**Every feature ships behind a flag defaulted OFF.** Merging all four changes **nothing** in production until a human flips a flag after real-device QA.

| PR | Feature | Flag (default OFF) | Status |
|---|---|---|---|
| [#4](https://github.com/ayed-teia/Waselneh-Taxi/pull/4) | Phone/OTP sign-in + server-side rate limiting | `EXPO_PUBLIC_ENABLE_PHONE_AUTH` | OPEN |
| [#5](https://github.com/ayed-teia/Waselneh-Taxi/pull/5) | Manager email+password login | `VITE_ENABLE_MANAGER_PASSWORD_AUTH` | OPEN |
| [#6](https://github.com/ayed-teia/Waselneh-Taxi/pull/6) | Driver onboarding + document upload | *(no flag — new surface, unreachable until used)* | OPEN |
| [#7](https://github.com/ayed-teia/Waselneh-Taxi/pull/7) | Taxi-line FIFO queue | `TAXI_LINE_QUEUE_ENABLED` | OPEN |
| [#8](https://github.com/ayed-teia/Waselneh-Taxi/pull/8) | This report + payments decision | *(docs only)* | OPEN |

**None merged.** All testing was LOCAL via the emulator suite. Nothing was deployed, and the PII migration was **not** run.

---

## BASELINE vs FINAL

| Check | Baseline (`main` @ c88c1fb) | Final (per branch) |
|---|---|---|
| `pnpm typecheck` | PASS (6 projects) | PASS |
| `pnpm lint` | **0 errors**, 173 warnings | **0 errors** (CI lint is blocking) |
| `pnpm build:functions` | PASS | PASS |
| **QA suites** | **75/75** (7 suites) | **+58 new checks across 4 new suites** |

New suites: `qa:otp-auth:e2e` (13) · `qa:manager-login:e2e` (5) · `qa:driver-onboarding:e2e` (15) · `qa:line-queue:e2e` (10) — plus the 15 existing checks each branch keeps green.

---

## NEGATIVE-CONTROL EVIDENCE, PER FEATURE

Every security-relevant change was run against deliberately-broken code first, to prove the test catches it. This is the part worth checking:

| Feature | Control applied | Result |
|---|---|---|
| **OTP rate limiting** | short-circuit `checkAndRecordOtpSend` to always allow | **10/13** — cooldown, hourly cap and lockout enforcement all fail; unlimited sends get through |
| **Manager login** | a valid password with **no** `managerRoles` doc | **denied** — if this passed, adding a login form would have quietly undone R1 |
| **Storage rules** | swap in a permissive "any signed-in user" ruleset | **11/15** — another driver can read *and upload into* someone else's document prefix, bad content types pass, deletion works |
| **Queue** | client writes its own queue position | **denied** (`permission-denied`); positive control confirms the queue is still readable |
| **Queue (flag off)** | all 9 existing dispatch scenarios | **still green** — by default nothing changes |

---

## DEFAULT DECISIONS APPLIED — confirm or override

You gave me these; I applied them literally and recorded where each lives.

1. **Phone country codes `+970` and `+972`** — `ALLOWED_COUNTRY_CODES` in `otp-rate-limit.ts`.
   *Consequence worth knowing:* with two codes allowed, a bare national number like `0599…` is **ambiguous**, so the server **refuses** it rather than guessing. Guessing would send someone's code to someone else's phone. The UI therefore makes the caller pick a code explicitly.

2. **Manager login: Firebase email+password**, structured for later MFA/SSO — everything in the sign-in path establishes *identity only*; authorization stays with `managerRoles`.

3. **Dev/test login keeps working with the flag off**, and no dev account is deleted. With phone auth ON, the driver app's dev **auto-login** is suppressed (otherwise it would sign in before the OTP screen could render) but the dev path stays reachable from a button.

4. **Onboarding: managers verify; documents under a private path; retention = one named constant.**
   `DRIVER_DOCUMENT_RETENTION_DAYS` is a **placeholder and is enforced nowhere**. Deleting identity documents on a timer without a lawyer's sign-off would be worse than keeping them.

5. **Queue: FIFO per line; forfeit on decline / offline / leaving the area.** Implemented exactly as specified — **and it needs driver sign-off before enabling**, which is why the flag is off and `docs/REMAINING_PLAN.md` now carries a banner rather than a checkbox.

---

## NOT BUILT — card / online payments

Untouched, as instructed. `docs/REMAINING_PLAN.md` §2 has the design; the blocking decision is unchanged and is **not** a technical one:

> **Which PSP?** The constraint is settlement in ILS to West Bank accounts — Stripe does not support Palestinian entities, and the Israeli/regional processors differ in KYC, settlement and fees. Pick the processor and the integration follows in days. **The cash path already works** (R6, PR #1).

---

## WHAT STILL NEEDS A DEVICE, THE CONSOLE, OR YOU

**Console + device (per `docs/AUTH_ROLLOUT.md`):** enable the Phone provider; set the SMS region policy to the two allowed codes; register App Check (Play Integrity / App Attest) and watch it in **monitoring** before enforcing; add **all** Android SHA-1/SHA-256 including the Play App Signing key; upload the iOS APNs key; raise the SMS quota and set a billing alert; add store-review test numbers.

**Yours alone:** the production deploy (`docs/PROD_DEPLOY_RUNBOOK.md`), the **PII migration** — which must run **before** the new rules ship — the PSP choice, driver sign-off on the queue policy, and a legal answer on document retention.

---

## WHAT I COULD NOT VERIFY

Plainly, because some of it matters:

- **Real SMS delivery**, on-device **reCAPTCHA / App Check / Play Integrity / APNs**. The OTP round trip is proven against the Auth emulator's REST API; the device-side verifier is exactly the part that is not.
- **No UI was rendered anywhere.** The OTP screens, the manager login page, and the manager review queue typecheck and lint, but **no app was launched in a browser or simulator**. The logic and rules are what's proven, not the pixels.
- **No driver-app upload UI or queue UI** was built — PRs #6 and #7 are callables, rules and state machines.
- **Cloud Scheduler delivery** remains uncovered (a firebase-tools limitation, unchanged from PR #3).
- **The PII migration's write path** — still never run against any project.
- **The fairness of the queue policy.** The tests prove the mechanism works; whether the rules are *right* is a human decision.
- **Production behaviour of anything here.** Emulator only. Nothing deployed.

**This code is not bug-free, and I am not claiming it is.** What I verified is listed above with its evidence; everything else is unverified.
