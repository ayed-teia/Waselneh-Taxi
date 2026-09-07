# Merge Report — PRs #4–#8 into `main`

All five PRs are **merged**. `main` is at `e964d2e` and fully green.

Nothing was deployed. The PII migration was **not** run. No feature flag was enabled at any
point, including during conflict resolution.

---

## FINAL VERIFICATION ON MERGED `main`

| Check | Result |
|---|---|
| `pnpm install` | PASS |
| `pnpm typecheck` | **PASS** — all 6 projects |
| `pnpm lint` | **0 errors**, 159 warnings |
| `pnpm build:functions` | PASS |
| `pnpm qa:all` | **11/11 suites, 118/118 checks** |

Per-suite: driver-eligibility 6 · request-lifecycle 9 · cash-payment 6 · security-regression 17 ·
pii-scoping 20 · scheduled-functions 6 · reconciliation 11 · line-queue 10 · driver-onboarding 15 ·
manager-login 5 · otp-auth 13.

### All feature flags confirmed OFF

Verified by loading the **built** `packages/shared` module and calling each flag with an empty
env, an empty-string env, and `'false'`:

| Flag | unset | empty | `'false'` |
|---|---|---|---|
| `isPhoneAuthEnabled` | false | false | false |
| `isManagerPasswordAuthEnabled` | false | false | false |
| `isTaxiLineQueueEnabled` | false | false | false |

Merging these PRs therefore changes **nothing** in production behaviour until a human flips a
flag.

---

## PER-PR OUTCOME

| PR | Branch | Conflicts | Outcome |
|---|---|---|---|
| #4 | `feat/phone-otp-auth` | none | clean merge |
| #5 | `feat/manager-login` | 3 files | resolved, both sides kept |
| #6 | `feat/driver-onboarding` | 5 files | resolved; one needed more than "keep both" |
| #7 | `feat/taxi-line-queue` | 6 files (twice) | resolved; two needed more than "keep both" |
| #8 | `docs/launch-features-report` | none | clean merge |

### PR #4 — clean

Merged directly. No conflicts (it was the first onto an unchanged `main`).

### PR #5 — 3 conflicts, all additive

| File | Combined |
|---|---|
| `package.json` | `qa:otp-auth:e2e` **and** `qa:manager-login:e2e` |
| `backend/functions/package.json` | the same pair |
| `scripts/run-qa-suites.mjs` | both suites in the runner list |

One mechanical detail: each side's script had been the **last** key in its object, so
concatenating them left the first without a trailing comma. Added it; both files re-validated as
JSON.

### PR #6 — 5 conflicts, one needing real judgement

Additive, kept both: the two `package.json` files, the runner list, `backend/functions/src/index.ts`
(all four callables exported), and `backend/functions/src/api/callable/index.ts` (both barrels).

**The one that was not simply "keep both":** `qa:all` and `qa:driver-eligibility:e2e:exec` exist on
*both* sides with **different values** — this branch had added `,storage` to the emulator list.
Keeping both verbatim produced **duplicate JSON keys**, and `JSON.parse` silently takes the *last*
one, which was the version **without** the storage emulator. That would have made the onboarding
suite fail for a completely non-obvious reason. Resolved by keeping the first occurrence (the
superset list `auth,firestore,functions,pubsub,storage`) and dropping the duplicates; then verified
no duplicate keys remain in either file.

`firebase.json` merged cleanly and carries **both** this branch's `storage` emulator and main's
`pubsub`/`eventarc`.

### PR #7 — 6 conflicts, resolved twice, two needing real judgement

`main` advanced (PR #6 landed) while this branch's first merge was being verified, so the same
conflicts re-presented against the newer `main`. On the second pass this branch's side was a strict
**superset** in every conflicted file, so `--ours` was correct — but it was then verified field by
field rather than trusted.

**Two resolutions needed more than "keep both":**

1. **`packages/shared/src/config/auth-flags.config.ts`.** The conflict spanned a doc-comment block,
   so a naive both-sides merge interleaved the two comments *and* dropped lines that legitimately
   appear in **both** halves — the closing `*/` and the shared `const source =` line. The result did
   not parse. Resolved by taking main's file whole and re-appending `isTaxiLineQueueEnabled` intact.
   All three flag functions verified present and OFF afterwards.

2. **`apps/manager-web/src/App.tsx`.** The `--ours` checkout reintroduced a **duplicated import** of
   `ManagerLoginPage` (my earlier fix had moved it; `--ours` restored both copies), failing typecheck
   with `TS2300: Duplicate identifier`. Removed the second copy.

---

## TWO THINGS FOUND ALONG THE WAY

**1. `main` was already failing its own blocking lint step — before any of these merges.**

After PR #4 landed I found 8 `import/order` errors in the two `MapView.tsx` files. I traced them to
commit **`85a49c7` (`fix(maps): harden mobile map style fallback and loading flow`)**, which predates
every PR in this series. Since CI's lint step is blocking, `main` had been red independently of this
work. All eight were auto-fixable and are now fixed (a 9th, in `App.tsx`, was mine from the PR #5
merge). **Lint on `main` is now 0 errors.**

**2. A stale `dist/` produced a false failure.**

The first `qa:all` after merging PR #4 reported 2 failing suites. The cause was a **stale
`backend/functions/dist/`** from the previous day — `qa:all` does not rebuild functions, so the
emulator was serving a build with no OTP callables. Rebuilding fixed it. Worth knowing: **CI is not
affected** (it builds fresh), but a local `qa:all` should be preceded by `pnpm build:functions` after
any pull.

---

## YOUR UNCOMMITTED WORK IS INTACT

The two in-progress files (`apps/*/src/features/map/*MapView.tsx`) were stashed before any branch
operation and restored afterwards. They remain **uncommitted**, with the same 19-line diff each as
before.

One thing to know: the *committed* versions of those two files were changed by the lint fix above
(import reordering only, no logic). Your WIP now sits on top of that. If you see anything unexpected
when you next diff them, that reordering is why.

---

## STILL A HUMAN STEP — NOT DONE, NOT STARTED

**Production deployment remains yours**, in this order, per `docs/PROD_DEPLOY_RUNBOOK.md`:
**PII migration → bootstrap the first manager → set `ENVIRONMENT=prod` → deploy rules + functions.**
Deploying the hardened rules *before* seeding a manager locks everyone out of the dashboard.

Also untouched: card/online payments (blocked on choosing a PSP that settles ILS to West Bank
accounts), and driver sign-off on the queue fairness policy before `TAXI_LINE_QUEUE_ENABLED` is ever
turned on.

---

## WHAT THIS REPORT DOES AND DOES NOT CLAIM

It claims: the five PRs are merged, every conflict was resolved keeping both features' configuration,
and merged `main` passes typecheck, lint and all 11 emulator QA suites with every flag off.

It does **not** claim the code is bug-free. Everything was verified against the **emulator only** —
no device, no browser, nothing deployed. The limits listed in `LAUNCH_FEATURES_REPORT.md` (no UI was
ever rendered; real SMS, on-device App Check and the PII migration's write path remain unverified)
are unchanged by merging.
