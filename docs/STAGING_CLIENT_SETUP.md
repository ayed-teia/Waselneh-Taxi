# Running the apps against real staging

Target project: **`waselneh-staging-ayed`**. Production (`waselneh-prod-414e2`)
is never touched by anything in this document.

---

## Blockers that need a human in the Firebase Console

These were verified against the live staging project. **Until they are done, the
apps cannot sign in** — no amount of client configuration fixes them.

### 1. Email/Password provider is DISABLED

Probed via the Identity Toolkit REST API:

```
POST identitytoolkit.googleapis.com/v1/accounts:signInWithPassword
-> {"message": "PASSWORD_LOGIN_DISABLED"}
```

Manager Web cannot sign in at all until this is enabled.

> Firebase Console → project **waselneh-staging-ayed** → **Authentication** →
> **Sign-in method** → **Email/Password** → Enable → Save.

Enable only Email/Password. Do not change other providers.

### 2. Anonymous auth is DISABLED — and that is CORRECT

```
POST identitytoolkit.googleapis.com/v1/accounts:signUp
-> {"message": "ADMIN_ONLY_OPERATION"}
```

This is the source of the Manager Web error `auth/admin-restricted-operation`,
and of the passenger app's `Missing or insufficient permissions`.

**Do not enable anonymous auth to make the errors stop.** The passenger app used
anonymous sign-in as a *development* shortcut. On staging the passenger must use
the real phone/OTP flow (`EXPO_PUBLIC_ENABLE_PHONE_AUTH=true`). If you want to
exercise the passenger app before Phone auth is configured, enable Anonymous
deliberately and knowingly — it is a real decision about who may read staging
data, not a formality.

### 3. Most Cloud Functions are NOT deployed to staging

Probed on `europe-west1-waselneh-staging-ayed.cloudfunctions.net`:

| Function | Status |
|---|---|
| `health` | HTTP 200 — deployed |
| `createTripRequest` | HTTP 403 — deployed |
| `getManagerSession` | **HTTP 404 — missing** |
| `getSystemConfigCallable` | **HTTP 404 — missing** |
| `requestOtpPermission` | **HTTP 404 — missing** |
| `managerAcknowledgeAlert` | **HTTP 404 — missing** |

`getManagerSession` **is** exported correctly from
`backend/functions/src/index.ts` and `api/callable/index.ts` — the export was
never the problem. It simply has not been deployed. Manager Web calls it
immediately after sign-in, so manager login fails at the authorization step even
once Email/Password is on.

Fix by deploying (staging-only script):

```powershell
pnpm deploy:staging:functions
```

### 4. Native `google-services.json` points at PRODUCTION

`apps/passenger-app/google-services.json` and the driver equivalent declare:

```
project_id: waselneh-prod-414e2
packages : com.taxiline.passenger, com.taxiline.driver
```

There are no `.staging` package entries, and
`apps/*/.firebase/staging/google-services.json` **does not exist** — yet
`app.config.js` references that path for pilot builds.

This is why the passenger app reported a valid native Auth UID while Firestore
calls failed: the **native** Firebase SDK auto-initialised against *production*
from this file, while the **JS SDK** — which actually issues the Firestore
queries — had no session on staging at all.

> Firebase Console → **waselneh-staging-ayed** → Project settings → Your apps →
> Add app → Android:
> - `com.taxiline.passenger.staging`
> - `com.taxiline.driver.staging`
>
> Download each `google-services.json` and save as:
> - `apps/passenger-app/.firebase/staging/google-services.json`
> - `apps/driver-app/.firebase/staging/google-services.json`
>
> These paths are gitignored. Never commit them.

---

## Local setup

### Mobile (passenger and driver)

```powershell
# Once per app: copy the template and fill in the staging values.
Copy-Item apps\passenger-app\.env.staging.example apps\passenger-app\.env.staging
Copy-Item apps\driver-app\.env.staging.example    apps\driver-app\.env.staging
```

`.env.staging` is gitignored — it carries a real API key.

### Manager Web

`apps/manager-web/.env.local` (gitignored) must contain:

```
VITE_APP_MODE=pilot
VITE_FORCE_LOCAL_DEV_MODE=false
VITE_USE_EMULATORS=false
VITE_ENABLE_MANAGER_PASSWORD_AUTH=true
VITE_FIREBASE_PROJECT_ID=waselneh-staging-ayed
...
```

`VITE_FORCE_LOCAL_DEV_MODE=false` is load-bearing: without it, `firebase.ts`
forces mode to `dev` on localhost *and* turns emulators on, silently overriding
`VITE_APP_MODE=pilot`.

---

## Commands (Windows PowerShell)

```powershell
# Install the staging build on a connected device (first run, or after a
# native change). Passenger -> Redmi, Driver -> Samsung A16.
pnpm passenger:staging:android
pnpm driver:staging:android

# Start Metro for an already-installed staging build.
pnpm passenger:staging:start   # port 8081
pnpm driver:staging:start      # port 8082

# Manager Web -> http://localhost:5173
pnpm manager:staging:dev
```

If Expo reports **"No development build (com.taxiline.passenger) is
installed"**, the build on the device is the *production* package. Reinstall
with `pnpm passenger:staging:android`.

---

## First staging admin

Manager Web authorization comes from `managerRoles/{uid}`, which is
`allow write: if false` for clients. The first document must be created with the
Admin SDK.

```powershell
# 1. Create the user: Console -> Authentication -> Add user (email + password).
#    Copy its User UID.

# 2. Dry run - writes nothing.
node scripts/bootstrap-staging-admin.mjs --project waselneh-staging-ayed --uid <UID> --dry-run

# 3. Apply.
node scripts/bootstrap-staging-admin.mjs --project waselneh-staging-ayed --uid <UID>
```

The script rejects any project other than staging, verifies the Auth user
exists, and embeds no credentials. It never creates a user and never handles a
password: identity and authorization stay separate.

---

## Known non-blocking warnings

**NativeEventEmitter: "new NativeEventEmitter() was called with a non-null
argument without the required addListener method."** Emitted by third-party
native modules (Expo Notifications / MapLibre) under the Legacy Architecture.
Not our wrapper code, harmless, and patching a node_modules package to silence
it would be worse than the warning. It disappears with the New Architecture.

**MapLibre primary style timeout → falls back to
`https://demotiles.maplibre.org/style.json`.** The fallback is deliberate and
working. Tiles render from the demo style, so maps stay usable.

**Legacy Architecture warning.** `newArchEnabled: false` in both app configs.
Migrating is a separate, substantial piece of work.
