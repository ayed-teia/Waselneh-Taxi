# Pilot Readiness Checklist

> **Environment**: `pilot`  
> **Date**: February 2026  
> **Version**: 1.0

This checklist validates the Taxi Line Platform is ready for limited production pilot testing.

---

## Pre-Pilot Verification

### Environment Setup
- [ ] Firebase project configured with `ENVIRONMENT=pilot`
- [ ] Cloud Functions deployed successfully
- [ ] Firestore security rules deployed
- [ ] Driver app built and installed on test devices
- [ ] Passenger app built and installed on test devices
- [ ] Manager dashboard accessible

### Safety Guards Verified
- [ ] `PILOT_LIMITS.MAX_ACTIVE_TRIPS_PER_PASSENGER = 1`
- [ ] `PILOT_LIMITS.MAX_ACTIVE_TRIPS_PER_DRIVER = 1`
- [ ] `PILOT_LIMITS.DRIVER_RESPONSE_TIMEOUT_SECONDS = 20`
- [ ] `expireDriverRequests` scheduled function running every 1 minute

---

## Test Scenarios

### 1. ✅ Happy Path Ride

**Objective**: Complete an end-to-end ride successfully

**Prerequisites**:
- 1 passenger account
- 1 driver account (online and available)

**Steps**:

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 1.1 | Driver | Open app, go online | Status shows "Online - Available" |
| 1.2 | Passenger | Open app, enter pickup/dropoff | Fare estimate displayed |
| 1.3 | Passenger | Confirm ride request | Loading state, "Finding driver..." |
| 1.4 | Driver | See trip request notification | Request shows pickup, dropoff, fare |
| 1.5 | Driver | Accept trip | Status changes to "Accepted" |
| 1.6 | Passenger | See driver accepted | Shows "Driver on the way" |
| 1.7 | Driver | Arrive at pickup, tap "Arrived" | Status → "Driver Arrived" |
| 1.8 | Passenger | See driver arrived notification | Shows "Driver has arrived" |
| 1.9 | Driver | Passenger in car, tap "Start Trip" | Status → "In Progress" |
| 1.10 | Passenger | See trip started | Shows "Trip in progress" |
| 1.11 | Driver | Arrive at destination, tap "Complete" | Status → "Completed", fare shown |
| 1.12 | Driver | Collect cash, tap "Cash Collected" | Payment confirmed |
| 1.13 | Passenger | See trip completed | Shows fare, option to go home |

**Logs to Verify** (Firebase Console → Functions → Logs):
```
🆕 [TripLifecycle] TRIP_CREATED      { env: "pilot", tripId: "...", ... }
✅ [TripLifecycle] TRIP_ACCEPTED     { env: "pilot", tripId: "...", ... }
📍 [TripLifecycle] TRIP_DRIVER_ARRIVED { env: "pilot", tripId: "...", ... }
🚗 [TripLifecycle] TRIP_STARTED      { env: "pilot", tripId: "...", ... }
🏁 [TripLifecycle] TRIP_COMPLETED    { env: "pilot", tripId: "...", ... }
💰 [Payment] CONFIRMED               { env: "pilot", tripId: "...", amount: X }
```

**Firestore to Verify**:
- [ ] `trips/{tripId}` has `status: "completed"`, `paymentStatus: "paid"`
- [ ] `drivers/{driverId}` has `isAvailable: true`, `currentTripId: null`

---

### 2. 🔌 Driver Offline Scenario

**Objective**: Verify system handles driver going offline gracefully

**Prerequisites**:
- 1 passenger account
- 1 driver account

**Test Case 2A: Driver goes offline before any requests**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 2A.1 | Driver | Go online | Status "Available" |
| 2A.2 | Driver | Go offline | Status "Offline" |
| 2A.3 | Passenger | Request ride | Should get "No drivers available" |

**Test Case 2B: Driver goes offline mid-trip (app closed)**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 2B.1 | Complete steps 1.1-1.9 (trip in progress) | - | Trip in progress |
| 2B.2 | Driver | Force close app | - |
| 2B.3 | Driver | Reopen app | Should see active trip, can continue |
| 2B.4 | Passenger | Check app | Trip still shows "In Progress" |
| 2B.5 | Driver | Complete trip normally | Trip completes successfully |

**Firestore to Verify**:
- [ ] Trip status remains consistent during app restart
- [ ] Driver's `isAvailable` stays `false` during active trip

---

### 3. 🚫 No Drivers Available

**Objective**: Verify passenger gets appropriate feedback when no drivers available

**Prerequisites**:
- 1 passenger account
- 0 online drivers (or all drivers busy)

**Test Case 3A: No drivers online**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 3A.1 | Verify | Check no drivers online | All drivers offline |
| 3A.2 | Passenger | Request ride | Error: "No drivers available" |
| 3A.3 | Passenger | Verify | Can retry or go back home |

**Test Case 3B: Drivers online but all busy**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 3B.1 | Driver | Accept a trip (now busy) | isAvailable = false |
| 3B.2 | Passenger 2 | Request ride | Error: "No drivers available" |

**Test Case 3C: Driver doesn't respond (timeout)**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 3C.1 | Driver | Go online, don't touch phone | Available |
| 3C.2 | Passenger | Request ride | Request sent to driver |
| 3C.3 | Wait | Wait 20+ seconds | Request expires |
| 3C.4 | Passenger | Check status | Shows "No driver available" |
| 3C.5 | Driver | Check status | isAvailable = true again |

**Logs to Verify**:
```
🚫 [Dispatch] FAILED - No available drivers { env: "pilot", ... }
⏰ [TripLifecycle] TRIP_EXPIRED { env: "pilot", tripId: "...", reason: "Driver did not respond in time" }
```

---

### 4. 📱 App Restart Mid-Trip

**Objective**: Verify trip state persists across app restarts

**Prerequisites**:
- Active trip in progress

**Test Case 4A: Passenger app restart**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 4A.1 | Start trip | Get to "In Progress" state | Trip active |
| 4A.2 | Passenger | Force close app | - |
| 4A.3 | Passenger | Reopen app | App shows current trip status |
| 4A.4 | Passenger | Verify | Driver location visible, status correct |

**Test Case 4B: Driver app restart**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 4B.1 | Start trip | Get to "In Progress" state | Trip active |
| 4B.2 | Driver | Force close app | - |
| 4B.3 | Driver | Reopen app | App shows current trip |
| 4B.4 | Driver | Can complete trip | All actions work normally |

**Test Case 4C: Both apps restart**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 4C.1 | Start trip | Get to "Accepted" state | Trip active |
| 4C.2 | Both | Force close both apps | - |
| 4C.3 | Both | Reopen apps | Both show correct trip state |
| 4C.4 | Continue | Complete trip normally | Trip completes |

**What to Verify**:
- [ ] Trip subscription reconnects automatically
- [ ] Driver location updates resume
- [ ] All trip actions available after restart
- [ ] No duplicate trip creation

---

### 5. 📶 Network Loss Recovery

**Objective**: Verify graceful handling of network interruptions

**Prerequisites**:
- Active trip in progress
- Ability to toggle airplane mode / disable WiFi

**Test Case 5A: Passenger loses network briefly**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 5A.1 | Start trip | Get to "In Progress" state | Trip active |
| 5A.2 | Passenger | Enable airplane mode | App shows offline indicator |
| 5A.3 | Wait | Wait 10 seconds | - |
| 5A.4 | Passenger | Disable airplane mode | App reconnects |
| 5A.5 | Passenger | Verify | Trip state syncs, driver location updates |

**Test Case 5B: Driver loses network briefly**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 5B.1 | Start trip | Get to "In Progress" state | Trip active |
| 5B.2 | Driver | Enable airplane mode | Location updates stop |
| 5B.3 | Passenger | Observe | May show stale driver location |
| 5B.4 | Driver | Disable airplane mode | Location updates resume |
| 5B.5 | Driver | Continue trip | Can complete normally |

**Test Case 5C: Network loss during trip action**

| Step | Actor | Action | Expected Result |
|------|-------|--------|-----------------|
| 5C.1 | Driver | Arrive at pickup | Ready to mark arrived |
| 5C.2 | Driver | Enable airplane mode | - |
| 5C.3 | Driver | Tap "Arrived" | Should show error or queue |
| 5C.4 | Driver | Disable airplane mode | Action should retry/complete |
| 5C.5 | Verify | Check trip status | Status updated correctly |

**What to Verify**:
- [ ] Firestore listeners reconnect automatically
- [ ] Queued writes sync when network returns
- [ ] No data loss or corruption
- [ ] User gets feedback about network state

---

## Edge Cases

### 6. Duplicate Request Prevention

| Test | Action | Expected |
|------|--------|----------|
| 6.1 | Passenger tries to create 2nd trip | Error: "You already have an active trip" |
| 6.2 | Driver tries to accept expired request | Error: "This trip request has expired" |
| 6.3 | Double-tap on Accept button | Only one accept processes |

### 7. Payment Edge Cases

| Test | Action | Expected |
|------|--------|----------|
| 7.1 | Cash Collected before trip complete | Error: "Trip must be completed first" |
| 7.2 | Cash Collected twice | Error: "Payment already collected" |
| 7.3 | Different driver tries Cash Collected | Error: "You are not the driver of this trip" |

---

## Manager Dashboard Verification

- [ ] Live map shows online drivers
- [ ] Active trips visible on map
- [ ] Completed trips table shows payment status
- [ ] Roadblocks visible with correct colors
- [ ] Can create/edit/delete roadblocks

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| QA Tester | | | |
| Product Owner | | | |

---

## Known Limitations (Pilot Phase)

1. **Single driver per request**: No fallback to next driver if first rejects
2. **Cash only**: No card payment integration
3. **No ride cancellation fees**: Passengers can cancel freely
4. **No driver ratings impact**: Ratings collected but not used for matching
5. **Manual driver onboarding**: No in-app driver registration

---

## Rollback Procedure

If critical issues found during pilot:

1. Disable Cloud Functions: `firebase functions:delete --all`
2. Notify all pilot users via SMS/WhatsApp
3. Investigate logs in Firebase Console
4. Fix and redeploy before resuming

---

## Support Contacts

| Role | Contact |
|------|---------|
| Dev Lead | TBD |
| On-call | TBD |
| Product | TBD |
