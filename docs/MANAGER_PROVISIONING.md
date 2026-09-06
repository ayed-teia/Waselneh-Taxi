# Manager Provisioning

> Written as part of the R1 privilege-escalation fix. Read this before creating the
> first manager in a fresh environment.

## Source of truth

`managerRoles/{uid}` is the **only** source of truth for manager RBAC.

Both authorization paths now agree on this:

| Path | File | Reads |
|---|---|---|
| Firestore rules | `firestore.rules` → `isManager()` | a verified custom claim, **or** an `isActive: true` `managerRoles/{uid}` document |
| Backend RBAC | `backend/functions/src/modules/auth/manager-rbac.ts` → `getManagerProfile()` | `managerRoles/{uid}` only |

`users/{uid}` still carries a denormalized copy of `role`, `permissions`, `officeIds`,
`lineIds` and `status` (written by `managerUpsertStaffRole`) for **display purposes only**.
Nothing reads it to make an authorization decision, and clients can no longer write those
fields to their own user document.

### Why the `users/{uid}` fallback was removed

`match /users/{uid}` allowed the owner to write their whole document, and `isManager()`
trusted `users/{uid}.role`. Any signed-in user could therefore:

1. set `role: "admin"` on their own `users/{uid}` document,
2. become a manager as far as both the rules and the backend were concerned,
3. and then write `managerRoles/*` (which allows `write: if isManager()`) to make the
   escalation permanent and survive step 1 being reverted.

This is verified as a real, reproducible exploit — see
`backend/functions/scripts/qa-security-regression-e2e.mjs`, which fails 10/16 against the
pre-fix code and passes 16/16 after.

## Provisioning an ordinary manager (normal case)

Use the existing callable, signed in as a manager who already holds the
`manage_staff` permission:

```
managerUpsertStaffRole({
  targetUserId, role, permissions, officeIds, lineIds, isActive: true
})
```

It writes `managerRoles/{targetUserId}` (authoritative) and mirrors a copy onto
`users/{targetUserId}` (display only).

## Provisioning the FIRST manager (bootstrap)

This is the case that needs care: with the `users` fallback gone, there is no way to
promote yourself into the first manager from a client. That is the intended behaviour.

### Local / emulator

Call the emulator-only callable — it is hard-gated behind `isEmulatorEnvironment()` and
cannot run in a deployed environment:

```
devIssueManagerToken({ uid: 'dev-manager-001', role: 'admin' })
```

### Production — pick ONE of these two, deliberately

Both require credentials that only an operator with project access has. Neither is
reachable from a client, which is the point.

**Option A — one-off Admin SDK script (recommended).**
The Admin SDK bypasses Firestore rules, so a trusted operator can seed the first document
directly:

```js
await db.collection('managerRoles').doc(FIRST_ADMIN_UID).set({
  uid: FIRST_ADMIN_UID,
  role: 'admin',
  permissions: [],          // empty => defaults for the role are applied
  officeIds: [],            // empty office+line => global scope
  lineIds: [],
  isActive: true,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: 'bootstrap',
});
```

Run it once, from a machine with the service-account credentials, against the target
project. Record who ran it and when.

**Option B — a custom claim.**
`isManager()` also accepts a verified custom claim (`role: manager|admin`, or
`managerRole`). Setting it requires the Admin SDK too:

```js
await getAuth().setCustomUserClaims(FIRST_ADMIN_UID, { role: 'admin', managerRole: 'admin' });
```

The user must obtain a fresh ID token before the claim takes effect. Note that
`getManagerProfile()` (the backend RBAC) still requires a `managerRoles/{uid}` document,
so Option B alone lets the account pass Firestore rules but **not** the manager callables.
For a fully working first admin, do Option A — or Option A **and** B.

## Deactivating a manager

Set `isActive: false` on `managerRoles/{uid}`. Both the rules and `getManagerProfile()`
now reject a deactivated document; the document does not need to be deleted.

> Note: `getManagerProfile()` did not previously check `isActive` at all, so a manager
> deactivated through the UI kept full backend access. That is fixed as part of R1.

## Verifying

```
corepack pnpm qa:security-regression:e2e   # with the emulator suite running
```

Covers: self-assigning each privilege field, self-minting `managerRoles`, backend RBAC
ignoring `users/{uid}.role`, deactivated roles being refused, and positive controls that
an active manager still works and an owner can still edit their own profile.
