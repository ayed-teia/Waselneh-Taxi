# Pilot Runbook

**Step 33: Go-Live Mode - Pilot Configuration**

This document provides operational guidance for running the Waselneh taxi-line platform in pilot mode.

---

## Table of Contents

1. [Environment Modes](#environment-modes)
2. [Development Setup](#development-setup)
3. [Pilot Deployment](#pilot-deployment)
4. [Health Verification](#health-verification)
5. [Troubleshooting Guide](#troubleshooting-guide)
6. [Go/No-Go Checklist](#gono-go-checklist)
7. [Step 34: Real Device QA](#step-34-real-device-qa)

---

## Environment Modes

The platform supports three environment modes:

| Mode | Use Case | Emulators | Firebase |
|------|----------|-----------|----------|
| `dev` | Local development | ✅ Allowed | Emulated |
| `pilot` | Limited real-world testing | ❌ Blocked | Real |
| `prod` | Full production | ❌ Blocked | Real |

### Configuration

**Mobile Apps (Expo):**
```env
EXPO_PUBLIC_APP_MODE=dev|pilot|prod
EXPO_PUBLIC_USE_EMULATORS=true|false
```

**Manager Web (Vite):**
```env
VITE_APP_MODE=dev|pilot|prod
VITE_USE_EMULATORS=true|false
```

### Safety Guards

- In `pilot` mode, emulator connections are **automatically blocked** even if misconfigured
- Warning is logged if demo project ID is used in non-dev mode
- Connection mode is logged at startup

---

## Development Setup

### 1. Start Firebase Emulators

```bash
cd backend/functions
npm run emulators
```

Emulator ports:
- Firestore: 8080
- Auth: 9099
- Functions: 5001

### 2. Deploy Functions to Emulators

```bash
cd backend/functions
npm run build
# Functions auto-deploy to emulators
```

### 3. Run Apps

**Driver App:**
```bash
cd apps/driver-app
npx expo start
```

**Passenger App:**
```bash
cd apps/passenger-app
npx expo start
```

**Manager Web:**
```bash
cd apps/manager-web
npm run dev
```

### 4. Verify Connection

Each app logs its connection mode at startup:
- `🔧 DEV mode: Using Firebase Emulators`
- `🚀 PILOT mode: Using real Firebase`

---

## Pilot Deployment

### Pre-Deployment Checklist

- [ ] Set `EXPO_PUBLIC_APP_MODE=pilot` in mobile app .env files
- [ ] Set `VITE_APP_MODE=pilot` in manager-web .env
- [ ] Ensure Firebase project ID is the **real project** (not `demo-*`)
- [ ] Deploy Cloud Functions to Firebase
- [ ] Configure Firestore rules
- [ ] Set up initial `system/config` document

### Deploy Cloud Functions

```bash
cd backend/functions
npm run build
firebase deploy --only functions
```

### Initial System Config

Create `system/config` document in Firestore:

```json
{
  "tripsEnabled": true,
  "roadblocksEnabled": true,
  "paymentsEnabled": false
}
```

### Build Mobile Apps (Android)

**Step 34: Android Pilot Build Setup**

#### Option 1: Local Build (npx expo run:android)

```bash
# Driver App
cd apps/driver-app

# Copy pilot configuration
cp .env.pilot .env
# Edit .env with your real Firebase credentials

# Generate native project
npx expo prebuild --clean

# Build and run on connected device
npx expo run:android --variant release
```

```bash
# Passenger App
cd apps/passenger-app

# Copy pilot configuration
cp .env.pilot .env
# Edit .env with your real Firebase credentials

# Generate native project  
npx expo prebuild --clean

# Build and run on connected device
npx expo run:android --variant release
```

#### Option 2: EAS Build (Cloud)

```bash
# Login to Expo
npx eas login

# Driver App
cd apps/driver-app
npx eas build -p android --profile preview

# Passenger App
cd apps/passenger-app
npx eas build -p android --profile preview
```

The `preview` profile builds with:
- `EXPO_PUBLIC_APP_MODE=pilot`
- `EXPO_PUBLIC_USE_EMULATORS=false`
- APK output for direct installation

#### Build Configuration

| App | Package | Version | VersionCode |
|-----|---------|---------|-------------|
| Driver | com.taxiline.driver | 1.0.0-pilot | 1 |
| Passenger | com.taxiline.passenger | 1.0.0-pilot | 1 |

---

## Health Verification

### Quick Health Check

1. **Functions Health:**
   ```bash
   curl https://<region>-<project>.cloudfunctions.net/health
   ```
   Expected: `{"status":"ok",...}`

2. **Manager Web:**
   - Open Settings page
   - Verify all feature flags visible
   - Toggle trips off/on to test kill switch

3. **Create Test Trip:**
   - Passenger app: Request trip
   - Driver app: Accept trip
   - Complete full trip flow

### Key Metrics to Monitor

- Trip creation success rate
- Driver response times
- Error rates in Cloud Functions logs
- Firestore read/write counts

---

## Troubleshooting Guide

### No Drivers Receiving Trips

**Symptoms:** Passengers can create trips but no drivers get notified

**Check:**
1. Are there online drivers?
   ```
   Firestore: drivers where isOnline == true AND isAvailable == true
   ```
2. Check driver dispatch logs in Cloud Functions
3. Verify `dispatchTripRequest` function is running

**Resolution:**
- Ensure at least one driver is online and available
- Check for driver location accuracy (must have valid `lat`/`lng`)

### Trips Stuck in "Searching"

**Symptoms:** Trip stays in PENDING/searching state

**Check:**
1. Is `tripsEnabled` set to `true` in system/config?
2. Check `expireStaleTrips` scheduled function logs
3. Verify driver response timeout hasn't expired

**Resolution:**
- Wait for auto-expiry (2 min for searching, 5 min for accepted)
- Use Manager override to force-cancel stuck trips
- Check kill switch status in Manager Web

### Payment Mismatch

**Symptoms:** Final price doesn't match estimate

**Check:**
1. Compare `estimatedPriceILS` with `finalPriceILS`
2. Check trip distance calculation
3. Verify pricing config in Firestore

**Resolution:**
- Review `calculateTripPrice` logic
- Check pick-up/drop-off coordinates accuracy
- Pilot uses estimate as final (no meter)

### Emergency: Kill Switch Usage

**When to use:**
- Critical bug discovered
- Safety incident
- System overload

**How to activate:**

1. **Via Manager Web:**
   - Go to Settings → Trip Creation
   - Click toggle to "DISABLED"

2. **Via Firestore (emergency):**
   ```
   system/config.tripsEnabled = false
   ```

**Effects:**
- New trip requests are rejected with clear error
- Existing trips continue to completion
- Drivers can complete in-progress trips

**To re-enable:**
- Toggle back to "ENABLED" in Manager Web
- Verify function logs show trips working

---

## Go/No-Go Checklist

### Go Criteria ✅

**Infrastructure:**
- [ ] Cloud Functions deployed and healthy
- [ ] Firestore rules verified
- [ ] System config initialized
- [ ] Kill switch tested (toggle on/off)

**Mobile Apps:**
- [ ] Apps built with `pilot` mode
- [ ] Connection guard logs show "PILOT mode"
- [ ] No emulator connections active

**Trip Flow:**
- [ ] Test trip completes successfully
- [ ] Driver can accept/reject
- [ ] Passenger can cancel (when allowed)
- [ ] Driver can cancel (when allowed)
- [ ] Trip auto-expires after timeout

**Safety:**
- [ ] Kill switch disables new trips
- [ ] Manager can force-cancel trips
- [ ] Feature flags toggleable

### No-Go Criteria ❌

- Cloud Functions failing
- Kill switch not working
- Trips not being dispatched to drivers
- Critical errors in logs
- Cannot verify trip completion

---

## Emergency Contacts

| Role | Responsibility |
|------|---------------|
| On-call Engineer | Technical issues, function errors |
| Ops Manager | Business decisions, kill switch |
| QA Lead | Issue triage, reproduction |

---

## Step 34: Real Device QA

Before marking pilot as ready, complete the full QA checklist on real devices.

**QA Checklist Document:** [QA_STEP34_CHECKLIST.md](QA_STEP34_CHECKLIST.md)

### Quick Summary

| Test Area | Key Verification |
|-----------|-----------------|
| App Identity | Name shows "Waselneh" / "Waselneh Driver" |
| Firebase | Connects to real project (not emulators) |
| Trip Flow | Full trip creation → completion works |
| Driver Assignment | Nearest driver receives request |
| Realtime Location | Driver location updates on map |
| Kill Switch | Trips disabled when toggle off |
| Offline Handling | App handles Airplane Mode gracefully |
| Background State | App state preserved after minimize |

### Pass Criteria

- All core flows work on real device
- No crashes observed
- Firebase connected to real project
- Kill switch respected
- Offline/background scenarios handled

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-11 | 1.0 | Initial pilot runbook (Step 33) |
| 2026-02-11 | 1.1 | Added Step 34 Real Device QA section |
