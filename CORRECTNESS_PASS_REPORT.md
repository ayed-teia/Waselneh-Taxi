# Correctness & Robustness Pass — Report

**Branch:** `fix/correctness-pass` (off `main` @ `fd04d9e`)

All testing LOCAL via the emulator suite. Nothing deployed, no PII migration, no flag enabled.

---

## 0. BASELINE (on `main` @ fd04d9e)

| Check | Result |
|---|---|
| `pnpm install` | PASS |
| `pnpm typecheck` | PASS — 6 projects |
| `pnpm lint` | **0 errors**, 159 warnings |
| `pnpm build:functions` | PASS |
| `pnpm qa:all` | **11/11 suites, 118 checks** |

---

## 1. VERIFICATION — do these issues still exist?

Each item was checked against current `main` BEFORE any code was written.

### R8 — seat accounting drift: **CONFIRMED, still present**

Counting references to `availableSeats` / `fullTaxiReserved` in each path that releases a driver:

| Path | refs | Restores seats? |
|---|---|---|
| `passengerCancelTrip` | 10 | yes |
| `driverCancelTrip` | 10 | yes |
| `completeTrip` | 9 | yes |
| **`managerForceCancelTrip`** | **0** | **NO** |
| **`expireStaleTrips` (no-show)** | **0** | **NO** |

Both broken paths blindly write `{ isAvailable: true, currentTripId: null }`. Consequences:

- `availableSeats` stays decremented — a 4-seat taxi force-cancelled off a 2-seat booking is
  left advertising 2 seats forever, and the drift accumulates per incident;
- `fullTaxiReserved` stays `true` after a full-taxi force-cancel, so the driver is filtered out
  of matching entirely — silently unbookable until someone edits Firestore by hand;
- `isAvailable: true` is set unconditionally, ignoring whether the driver is even online.

### R5 — no distance cap on matching: **CONFIRMED, still present**

Two constants exist and **neither is referenced by any matching code**:

- `PILOT_LIMITS.MAX_DRIVER_SEARCH_RADIUS_KM = 15` (packages/shared) — dead
- `MAX_SEARCH_RADIUS_METERS = 5000` (backend env, with a `maxSearchRadiusMeters` accessor whose
  only reference is its own definition) — dead

They also **disagree**: 15 km vs 5 km. `createTripRequest` ranks every eligible driver by
Haversine distance and offers to the nearest with no ceiling at all, so a driver 80 km away is a
valid match if nobody closer is online.

---

## 2. CHANGE LOG

(appended as work proceeds)
