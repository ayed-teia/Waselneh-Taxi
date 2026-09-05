# Overnight Hardening Report

Branch: `chore/overnight-hardening` (never merged, never pushed, never deployed)
Started: 2026-09-05
Agent: Claude Opus 5, working unattended per overnight mandate.

All runs were LOCAL against the Firebase emulator suite (auth, firestore, functions).
No deploy was run. `waselneh-prod-414e2` was used ONLY as the emulator project id
(the emulator suite requires a project id; nothing contacted production).

---

## 0. BASELINE (before any change)

| Check | Result |
|---|---|
| `corepack pnpm install` | PASS (clean, 5.5s) |
| `corepack pnpm typecheck` | **PASS** (6 of 7 workspace projects; `apps/manager-web` has no `typecheck` script) |
| `corepack pnpm lint` | **FAIL** — 1902 errors, 308 warnings |
| `corepack pnpm build:functions` | PASS (tsc clean) |
| `qa:driver-eligibility:e2e` | **PASS** 6/6 |
| `qa:request-lifecycle:e2e` | **PASS** 6/6 |

### Baseline lint error breakdown by rule

```
import/no-unresolved                        E940
import/order                                E440
import/no-duplicates                        E149
import/namespace                            E147
import/default                              E89
import/export                               E42
@typescript-eslint/no-unsafe-assignment     E47
@typescript-eslint/no-unsafe-call           E12
@typescript-eslint/no-unsafe-argument       E11
@typescript-eslint/require-await            E9
@typescript-eslint/no-unsafe-member-access  E8
@typescript-eslint/no-floating-promises     E2
@typescript-eslint/no-var-requires          E2
@typescript-eslint/ban-ts-comment           E1
no-useless-escape                           E1
prefer-const                                E1
@typescript-eslint/no-unnecessary-type-assertion E1
```

**Root cause of ~1807 of the 1902 errors:** `.eslintrc.json` declares
`settings["import/resolver"].typescript`, but the package
`eslint-import-resolver-typescript` is **not installed** in the repo. ESLint reports
`Resolve error: typescript with invalid interface loaded as resolver` and then every
import is treated as unresolvable, which cascades into `import/no-unresolved`,
`import/namespace`, `import/default`, `import/export`, and `import/order` noise.
Installing that resolver would add a third-party dependency, which the mandate forbids,
so it is fixed by configuration instead (see change log).

Roughly **95 errors are genuine code issues**, mostly `@typescript-eslint/no-unsafe-*`.

---

## 1. CHANGE LOG

(appended as work proceeds)
