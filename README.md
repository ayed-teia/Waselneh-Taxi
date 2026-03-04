# Waselneh Taxi Platform

Monorepo for a licensed taxi-line dispatch system:
- Passenger mobile app (ride request and trip tracking)
- Driver mobile app (request inbox, trip lifecycle)
- Manager web dashboard (operations + monitoring)
- Firebase backend (Functions, Firestore, Auth)

## Core Features

- Strict driver eligibility enforcement:
  - `driverType = licensed_line_owner`
  - `verificationStatus = approved`
  - Must have `lineId` or `licenseId`
- Scoped dispatch by operations data:
  - Driver matching is constrained by `officeId` and/or `lineId`
- Dynamic pricing:
  - Vehicle type, seat capacity, peak windows, and pricing zones
- Operations dashboard:
  - Offices, lines, licenses, vehicles, driver binding, RBAC roles
- Monitoring dashboard:
  - Client error ingestion, aggregated metrics, open/resolved alerts
- E2E QA scripts:
  - Request lifecycle, rejects, expiries, reconnect, eligibility guards

## Monorepo Structure

```text
apps/
  driver-app/
  passenger-app/
  manager-web/
backend/
  functions/
packages/
  shared/
docs/
```

## Tech Stack

- Mobile: React Native + Expo + TypeScript
- Web: React + Vite + TypeScript
- Backend: Firebase Functions (Node.js 20) + Firestore + Auth
- Validation/Schema: Zod
- Maps/Routing: Mapbox
- Monorepo: pnpm workspaces

## Prerequisites

- Node.js 20+ recommended
  - Functions runtime is `nodejs20`
  - Repo includes a helper to run Firebase CLI on Node 20:
    - `scripts/run-firebase-node20.cjs`
- pnpm `8.x` (`corepack` supported)
- Java (required by Firebase emulators)
- Android Studio + emulator (for mobile apps)

## Install

```bash
corepack enable
corepack pnpm install
```

## Environment Variables

### Mobile apps (`apps/driver-app`, `apps/passenger-app`)

Required in `.env`:

```bash
EXPO_PUBLIC_APP_MODE=dev
EXPO_PUBLIC_USE_EMULATORS=true
EXPO_PUBLIC_EMULATOR_HOST=10.0.2.2
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=...

EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=waselneh-prod-414e2
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
```

Optional dev bypass:

```bash
EXPO_PUBLIC_DEV_AUTH_BYPASS=true
EXPO_PUBLIC_DEV_DRIVER_ID=dev-driver-001
EXPO_PUBLIC_DEV_PASSENGER_ID=dev-passenger-001
```

### Manager web (`apps/manager-web`)

Optional `.env` (has defaults in code):

```bash
VITE_APP_MODE=dev
VITE_USE_EMULATORS=true
VITE_EMULATOR_HOST=127.0.0.1

VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=waselneh-prod-414e2
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## Local Development

### 1) Start backend emulators

```bash
corepack pnpm emulators:core
```

Emulator UI:
- `http://127.0.0.1:4000`

### 2) Run driver app

```bash
corepack pnpm --filter @waselneh/driver-app android -- --device "Pixel_5" --port 8082
```

### 3) Run passenger app

```bash
corepack pnpm --filter @waselneh/passenger-app android -- --device "Pixel_5_2" --port 8081
```

### 4) Run manager web

```bash
corepack pnpm --filter @waselneh/manager-web dev
```

## Useful Scripts

Root:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm emulators:core
corepack pnpm emulators:persist
```

Functions:

```bash
corepack pnpm --filter @taxi-line/functions build
corepack pnpm --filter @taxi-line/functions typecheck
corepack pnpm --filter @taxi-line/functions qa:driver-eligibility:e2e
corepack pnpm --filter @taxi-line/functions qa:request-lifecycle:e2e
```

Backfill driver eligibility:

```bash
corepack pnpm backfill:driver-eligibility:dry-run
corepack pnpm backfill:driver-eligibility:apply
```

## Required Driver Document Shape

Collection: `drivers`  
Document ID: `uid`

Minimum fields for eligible operation:

```json
{
  "driverType": "licensed_line_owner",
  "verificationStatus": "approved",
  "lineId": "LINE_123",
  "licenseId": "LIC_123",
  "isOnline": false,
  "isAvailable": false,
  "status": "offline"
}
```

Notes:
- `lineId` or `licenseId` is required (at least one).
- Non-eligible drivers are blocked from:
  - go online
  - accept trip
  - start trip
  - complete trip

## Firestore Rules and Indexes

Deploy only Firestore config:

```bash
node ./scripts/run-firebase-node20.cjs deploy --project waselneh-prod-414e2 --only firestore:rules,firestore:indexes
```

## Production Deploy

Full deploy command:

```bash
node ./scripts/run-firebase-node20.cjs deploy --project waselneh-prod-414e2 --only functions,firestore:rules,firestore:indexes
```

Important:
- Deploying Cloud Functions requires Blaze plan on Firebase project (for Cloud Build/Artifact Registry APIs).

## Troubleshooting

- `Auth state changed: No user` on driver app:
  - Check `EXPO_PUBLIC_DEV_AUTH_BYPASS` or phone auth flow.
- Driver receives request in logs but modal does not show:
  - Check request expiry and driver inbox screen state.
- `Port ... is not open` when starting emulators:
  - Stop previous emulator instances or change ports in `firebase.json`.
- Node mismatch warnings (`wanted node 20, current 22`):
  - Expected for functions package on host Node 22; use `run-firebase-node20.cjs` for Firebase CLI operations.
