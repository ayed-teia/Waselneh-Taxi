# Staging deployment runbook

This runbook targets **only** `waselneh-staging-ayed`. Production is
`waselneh-prod-414e2` and must never be substituted into these commands.

## Registered applications

| App | Platform identifier |
|---|---|
| Passenger Android | `com.taxiline.passenger.staging` |
| Driver Android | `com.taxiline.driver.staging` |
| Passenger iOS | `com.taxiline.passenger.staging` |
| Driver iOS | `com.taxiline.driver.staging` |
| Manager web | Firebase web app in `waselneh-staging-ayed` |

Firestore and Storage use the staging project. Firestore was provisioned in
`me-west1`; Functions remain in `europe-west1`, matching every shipped client and
the existing backend parameter default. Changing the Functions region is a
separate migration because it changes every callable endpoint.

## Preconditions

1. Verify billing and the exact target:

   ```bash
   gcloud billing projects describe waselneh-staging-ayed
   firebase use staging
   firebase projects:list
   ```

   `billingEnabled` must be `true`; the active Firebase project must be
   `waselneh-staging-ayed`.
2. Create a budget scoped to `waselneh-staging-ayed`. A budget is an alert, not a
   hard spending cap.
3. Keep real payment credentials disabled in staging. Lahza configuration is not
   guessed or copied from production.
4. Configure the two EAS projects' **preview** environment with file variables:
   - `GOOGLE_SERVICES_JSON`: that app's staging `google-services.json`.
   - `GOOGLE_SERVICE_INFO_PLIST`: that app's staging
     `GoogleService-Info.plist`.
   Never reuse the production files for a preview build.

The Firebase client configuration committed in `.env.pilot` and `eas.json` is
public application metadata, not an Admin SDK credential. Service-account keys,
payment secrets and Mapbox download tokens must remain outside git.

## Validate before deployment

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build:shared
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build:functions
corepack pnpm qa:unit
corepack pnpm qa:all
```

## Deploy in dependency order

Rules go first, indexes second, Functions last. The index build is asynchronous;
wait for every index to report **Enabled** before deploying Functions.

```bash
corepack pnpm deploy:staging:rules
corepack pnpm deploy:staging:indexes
# Wait in Firebase Console -> Firestore -> Indexes until all are Enabled.
corepack pnpm deploy:staging:functions
```

The Functions command builds both workspaces and creates an ignored, isolated
deployment source. Cloud Build uses npm, so the deployment package replaces the
monorepo-only `workspace:*` dependency with a local `file:vendor/shared` package.

There is deliberately no combined staging deploy command: the CLI returning from
index deployment does not prove that every index has finished building, so an
operator must verify that gate before Functions are deployed.

## Post-deploy verification

1. `firebase functions:list --project waselneh-staging-ayed` lists the backend in
   `europe-west1`.
2. Run the HTTP health endpoint and one authenticated callable smoke test.
3. Build the mobile `preview` profiles. Their package/bundle identifiers must end
   in `.staging`, so staging and production can coexist on one device.
4. Add the EAS Android signing certificate SHA-1/SHA-256 fingerprints to each
   staging Android Firebase app before testing Phone Authentication.
5. Use only Firebase fictional test phone numbers; do not send real SMS during
   smoke testing.
6. Verify document upload against the staging Storage bucket and confirm the
   production bucket remains unchanged.

## Production guard

Production deploy scripts now refuse to run without an exact explicit target
confirmation. Example (only after a separately approved production release):

```bash
corepack pnpm deploy:prod -- --confirm-production=waselneh-prod-414e2
```

This guard does not replace review, backups, or a rollback plan.
