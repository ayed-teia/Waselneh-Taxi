# Production Deploy Runbook — Security Hardening Release

> **This release changes authorization.** Doing the steps out of order will lock every
> human out of the manager dashboard. Read the ordering section before you start.
>
> Nothing in this runbook has been run. It is a procedure for a human operator with
> project credentials, to be executed only after the PR is reviewed and approved.

**Target project:** `waselneh-prod-414e2`
**What ships:** R1 (privilege escalation), R2 (dev auth bypass), R6 (cash payments),
PII read scoping.

---

## Why the order matters

Two changes interact badly if sequenced wrong:

1. The new `firestore.rules` says a manager is **only** someone with a verified custom
   claim or an `isActive: true` `managerRoles/{uid}` document. It no longer trusts
   `users/{uid}.role`.
2. `match /managerRoles/{uid}` allows `write: if isManager()`.

So if you **deploy the rules first**, and no `managerRoles` document exists yet, then:
nobody is a manager → nobody can write `managerRoles` → **nobody can ever become a
manager from a client.** The dashboard is bricked until an operator fixes it with the
Admin SDK.

Seeding the first manager **before** the rules deploy avoids this entirely. The seed is
harmless under the old rules too, so there is no window where it does damage.

There is a second ordering trap. **R2** makes the `devUserId` bypass depend only on the
emulator variables — but `ENVIRONMENT` defaults to `'dev'` in `core/env/env.ts`. Set
`ENVIRONMENT=prod` explicitly anyway, so nothing else in the codebase that keys off it
behaves like a dev build.

---

## Pre-flight

- [ ] The PR is reviewed and approved. **These are authorization changes.**
- [ ] You have credentials that can write Firestore in `waselneh-prod-414e2`.
- [ ] You know the **Firebase Auth UID** of the person who will be the first admin
      (Firebase console → Authentication → Users; it is the UID column, not the email).
- [ ] You have a rollback plan for rules (see Rollback below).
- [ ] Note the current state for comparison:

```bash
node ./scripts/run-firebase-node20.cjs functions:list --project waselneh-prod-414e2
```

> At the time this runbook was written, that command returned **"No functions found"** —
> i.e. no Cloud Functions were deployed. If that is still true, this release is the first
> functions deploy, and R2/R6 were never live. Confirm before assuming either way.

- [ ] Check the **currently deployed** Firestore rules in the console
      (Firestore → Rules) and compare `isManager()` with this branch's version, so you
      know whether the privilege-escalation and PII exposure are live right now.

---

## Step 1 — Seed the first manager (BEFORE deploying rules)

Dry run first. It writes nothing and prints the exact document it would create:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json
export GCLOUD_PROJECT=waselneh-prod-414e2

node scripts/bootstrap-first-manager.mjs --uid=<FIREBASE_AUTH_UID>
```

Check the output, then apply:

```bash
node scripts/bootstrap-first-manager.mjs --uid=<FIREBASE_AUTH_UID> --confirm
```

The script refuses to run against an emulator, refuses without `--uid` and `--confirm`,
verifies the UID exists in Firebase Auth, refuses to overwrite an existing
`managerRoles/{uid}` without `--force`, and reads the document back after writing.

**Verify:** Firestore console → `managerRoles/<uid>` exists with `role: "admin"` and
`isActive: true`.

---

## Step 2 — Set `ENVIRONMENT=prod` on functions

`ENVIRONMENT` defaults to `'dev'`. Set it explicitly before or during the functions
deploy, so no deployed code takes a dev-flavoured branch.

Set it wherever this project configures function environment variables (a `.env` for the
functions codebase, or the console's function configuration). Confirm the value lands in
the deployed runtime config — do not assume.

> After R2, the `devUserId` bypass no longer keys off `ENVIRONMENT` at all, so this step
> is defence in depth rather than the fix itself. Do it anyway.

---

## Step 3 — Deploy rules + functions

```bash
node ./scripts/run-firebase-node20.cjs deploy \
  --project waselneh-prod-414e2 \
  --only functions,firestore:rules
```

(The repo's `deploy:prod` script runs exactly this.)

Deploying rules and functions together keeps the two halves of R1 consistent: the rules
side and `getManagerProfile` must agree on `managerRoles` being the source of truth.

---

## Step 4 — Verify in production

- [ ] **Manager dashboard**: sign in as the bootstrapped admin. You can load the drivers
      list and the live map. *(If this fails, go to Rollback immediately — it means the
      seed did not take.)*
- [ ] **Manager enumeration**: the drivers list and live map still populate. Both
      enumerate whole collections, and the PII change must not have broken that.
- [ ] **Passenger active trip**: run one real trip. During it, the passenger sees the
      driver card and the driver's live position on the map.
- [ ] **Cash payment (R6)**: the driver confirms cash on a completed trip and the trip
      reaches `paymentStatus: "paid"`. This path was **never deployed before**, so it is
      new behaviour in production, not a regression risk.
- [ ] **Privilege escalation is closed (R1)**: as an ordinary passenger account, attempt
      to write `role: "admin"` onto your own `users/{uid}` document. It must be denied.
- [ ] **PII is scoped**: as an ordinary account with no active trip, attempt to read some
      other `drivers/{driverId}`. It must be denied.
- [ ] `functions:list` now shows `confirmCashPayment` among the deployed functions.

---

## Rollback

**Rules** are the risky part, and they roll back fastest:

- Firebase console → Firestore → Rules → **Rules history** → revert to the previous
  ruleset. This takes effect in seconds.
- Reverting the rules restores the *vulnerable* behaviour, so treat it as a stopgap
  while you diagnose, not a resting state.

**Functions**: redeploy from the previous commit. If this was the first functions deploy,
rolling back means deleting the deployed functions.

**The seeded `managerRoles` document** is safe to leave in place either way — under the
old rules it grants nothing that `users/{uid}.role` did not already grant.

---

## After the release

- [ ] Rotate anything that may have been exposed while the vulnerable rules were live —
      most importantly, treat driver `nationalId` / `phone` as having been readable by
      any authenticated account, and decide with your DPO/legal whether that needs
      disclosure.
- [ ] Decide on the follow-up PII work: Firestore read rules are per-document, so the
      passenger of record still receives `nationalId` and `phone`. Fully hiding them
      requires moving PII into a private subcollection (e.g. `drivers/{id}/private/pii`)
      readable only by the driver and managers. That is a data-model change and needs
      its own PR.
- [ ] Add `apps/manager-web` to the `typecheck` script — it currently has none, so it is
      not type-checked by CI at all.
