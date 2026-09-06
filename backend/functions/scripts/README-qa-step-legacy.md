# Legacy `qa-step32.ts` / `qa-step33.ts`

These are **orphaned one-off verification scripts** from historical delivery steps
(step 32: cancel flows and the trip kill switch; step 33: go-live mode and feature flags).

They are **not part of the QA suite** and are excluded from linting in `.eslintrc.json`:

- nothing references them — no npm script, no CI job, no import;
- `qa-step33.ts` initialises Firebase Admin against a **different project id**
  (`demo-taxi-line`), not the emulator project the current suites use, so it cannot run
  against this setup at all;
- between them they accounted for the last 25 ESLint errors in the repo, all from a
  runtime-conditional `require()` of a built artifact and `async` test functions with no
  `await` — patterns that are wrong to "fix" in a script nothing runs.

They were **excluded rather than deleted**, because removing someone else's historical QA
record is a judgement call rather than a correctness fix. If they are genuinely finished
with, deleting both files is safe — nothing depends on them.

**The live QA suites are the `qa-*-e2e.mjs` scripts in this directory.** Those are linted,
run by `pnpm qa:all`, and run in CI.
