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

(appended as work proceeds)
