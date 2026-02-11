# Step 34: Real Device QA Checklist

**Date:** _______________  
**Tester:** _______________  
**Device:** _______________  
**Android Version:** _______________  
**APK Version:** 1.0.0-pilot

---

## Pre-Test Setup

- [ ] APK installed on real Android device
- [ ] Firebase project is the **real project** (not demo-*)
- [ ] Cloud Functions deployed to real Firebase
- [ ] `system/config` document exists with `tripsEnabled: true`
- [ ] At least one test driver account created
- [ ] At least one test passenger account created

---

## 1. App Identity & Branding

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| App name in launcher | "Waselneh" (passenger) / "Waselneh Driver" (driver) | |
| App icon visible | Custom icon (not Expo default) | |
| Splash screen | Branded splash screen | |
| Version in settings (if shown) | 1.0.0-pilot | |

---

## 2. Firebase Connection

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| Startup log shows | "🚀 PILOT mode: Using real Firebase" | |
| NO emulator logs | No "Auth Emulator", "Firestore Emulator" logs | |
| Auth works | Can sign in with phone number | |
| Firestore reads work | Can load stations/roadblocks | |

**How to verify:**
- Use Android Studio Logcat or `adb logcat` to see connection logs
- Look for: `🚀 PILOT mode: Using real Firebase`

---

## 3. Trip Creation Flow

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| Passenger: Select pickup station | Station list loads | |
| Passenger: Select dropoff station | Station list loads | |
| Passenger: View price estimate | Price shown in ₪ | |
| Passenger: Request trip | Trip created successfully | |
| Driver: Receives trip request | Notification/alert appears | |
| Driver: Accept trip | Trip status changes to ACCEPTED | |
| Passenger: Sees driver assigned | Driver info shown | |

---

## 4. Driver Assignment

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| Driver is online | `isOnline: true` in Firestore | |
| Driver is available | `isAvailable: true` in Firestore | |
| Nearest driver gets trip | Trip assigned to closest driver | |
| Driver accepts | Driver marked unavailable | |
| Trip rejected | Next nearest driver notified | |

---

## 5. Realtime Location

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| Driver: Location permission granted | Permission dialog shown | |
| Driver: Location updates in Firestore | `lat`/`lng` fields update | |
| Passenger: Sees driver on map | Driver marker moves | |
| Location updates while driving | Updates every few seconds | |

**How to verify:**
1. Open Firestore Console
2. Watch `drivers/{driverId}` document
3. Confirm `lat` and `lng` change as driver moves

---

## 6. Map Display

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| Map loads on home screen | Google Maps visible | |
| Stations shown on map | Station markers visible | |
| Roadblocks shown (if enabled) | Roadblock zones visible | |
| Map is interactive | Can pan/zoom | |
| Current location marker | Blue dot shows user location | |

---

## 7. Kill Switch

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| Disable trips via Manager Web | Toggle to "DISABLED" | |
| Passenger: Try to create trip | Error: "Trip creation is currently disabled" | |
| Existing trips unaffected | Active trips continue | |
| Re-enable trips | Toggle to "ENABLED" | |
| Passenger: Create trip again | Trip created successfully | |

---

## 8. Airplane Mode Test (Offline Handling)

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| Start a trip normally | Trip in progress | |
| Enable Airplane Mode | Network disconnected | |
| App shows offline indicator | Or handles gracefully | |
| No crash | App remains stable | |
| Disable Airplane Mode | Network reconnected | |
| App reconnects | Data syncs automatically | |
| Trip state consistent | Same trip, correct status | |

---

## 9. Background/Foreground Test

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| App in foreground, trip active | Trip UI visible | |
| Press Home button | App goes to background | |
| Wait 30 seconds | | |
| Return to app | App resumes | |
| Trip state unchanged | Same ride, correct status | |
| Location still updating (driver) | Location updates continue | |
| No duplicated trips | Only one trip exists | |

---

## 10. Error Handling

| Test | Expected | Pass/Fail |
|------|----------|-----------|
| Invalid phone number | Validation error shown | |
| No drivers available | "No drivers available" message | |
| Trip timeout (2 min) | Auto-cancelled, user notified | |
| Driver no-show (5 min) | Auto-cancelled, user notified | |

---

## Final Checklist

- [ ] All core flows work on real device
- [ ] Firebase connects to real project (not emulators)
- [ ] No crashes observed
- [ ] App handles offline gracefully
- [ ] Background state preserved
- [ ] Kill switch respected
- [ ] Realtime features work

---

## QA Result

**PASS** / **FAIL** (circle one)

**Notes:**
```
_____________________________________________
_____________________________________________
_____________________________________________
_____________________________________________
```

**Signed:** _______________ **Date:** _______________

---

## Troubleshooting

### App crashes on startup
- Check Logcat for error messages
- Verify Firebase config is correct
- Ensure all dependencies installed

### Firebase connection fails
- Verify Firebase project ID is correct
- Check internet connection
- Verify Cloud Functions are deployed

### Location not updating
- Check location permissions granted
- Verify GPS is enabled on device
- Check battery optimization settings

### Trip not dispatching to drivers
- Verify driver is online AND available
- Check driver has valid location
- Verify `tripsEnabled: true` in system/config

### Map not loading
- Check Google Maps API key configured
- Verify internet connection
- Check for Google Play Services
