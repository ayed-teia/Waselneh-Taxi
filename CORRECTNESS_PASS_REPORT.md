# Correctness & Robustness Pass — Report

**Branch:** `fix/correctness-pass` (off `main` @ `fd04d9e`)
**PR:** https://github.com/ayed-teia/Waselneh-Taxi/pull/10 — **OPEN, not merged.**

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

## 2. WHAT WAS FIXED

| Commit | Change |
|---|---|
| `b89f684` | Baseline + verification that R8 and R5 still exist |
| `4620088` | **R8** — restore seats on force-cancel and driver no-show |
| `d42330d` | **R5** — enforce a search radius, with one source of truth |
| `0c1f4e1` | 35 pure-logic unit tests via `node:test`, wired into CI |
| `744d20a` | Two unsafe `any` casts on Firestore timestamps |

### R8 — seat accounting drift

Rather than copy the restore logic a fourth and fifth time — **four copies of a rule is
how the fifth one ends up wrong** — it is extracted into
`modules/drivers/driver-seat-release.ts`. `buildDriverReleasePatch()` returns a patch
rather than writing, so each caller keeps control of its own transaction ordering.

Beyond restoring seats it fixes two things the working paths also got right and the
broken ones did not:

- it **clamps to `seatCapacity`**, so a double release cannot inflate the seat count —
  which matters because a once-a-minute sweeper *will* re-observe the same trip;
- `isAvailable` is **derived** (online AND seats free) rather than asserted `true`, so an
  offline driver is no longer marked bookable.

Both call sites needed their transactions reordered to read the driver before any write.
The no-show branch had **never read the driver at all**, which is precisely why it could
not restore anything.

**Negative control — `qa:seat-accounting:e2e` against the unfixed code: 0/5**

```
FAIL Force-cancel (seat_only)  - availableSeats must return to 4, got 2
FAIL Force-cancel (full_taxi)  - fullTaxiReserved must be cleared
FAIL No-show (seat_only)       - availableSeats must return to 4, got 2
FAIL No-show (full_taxi)       - fullTaxiReserved must be cleared
FAIL Offline driver            - must not be marked available by a force-cancel
```

**After the fix: 5/5.**

### R5 — no distance cap on matching

**Source of truth chosen: `env.maxSearchRadiusMeters`** (5000 m), because it is genuinely
operator-tunable per environment — it is already set in `backend/functions/.env` — whereas
a hardcoded shared constant needs a code change and a redeploy to adjust. Every other
dispatch limit that varies by deployment already lives in `env`.

`PILOT_LIMITS.MAX_DRIVER_SEARCH_RADIUS_KM` is now marked `@deprecated`, documents the
disagreement (15 km vs 5 km, while both were dead code), points at the real source, and
says not to add new readers. It is kept only so existing imports do not break.

The check **excludes** an out-of-range driver rather than ranking them last, so they are
also kept out of the re-offer candidate list — a trip should not fall back to a driver
40 km away when the near one declines.

**Negative control — `qa:search-radius:e2e` against the unfixed code: 1/4**

```
FAIL far driver excluded        - a driver 50km away WAS matched (trip created)
PASS near driver matched        - (positive control, already passing)
FAIL far driver not a candidate - 40km driver remained in candidateDriverIds
FAIL no-driver-in-range path    - a 90km driver got the trip; expected 'searching'
```

The one passing check was the positive control, which confirms the suite was not simply
rejecting everything. **After the fix: 4/4.**

### Unit tests — 35, via `node:test` (no new dependency)

Split across `pricing.test.mjs` (18) and `dispatch.test.mjs` (17): base fare, the
minimum-fare floor at *and* below the boundary, fare monotonicity, seat surcharge,
vehicle multipliers, seat normalization against junk input, the R8 release-patch builder,
and the queue ordering property.

Several assert **properties** rather than fixed values, because those are what actually
matter: a longer trip never costs less; a release never inflates seats above capacity;
the queue never drops a candidate; an offline or unknown driver is never assumed available.

Wired in as `pnpm qa:unit` (and `qa:verify` = unit + emulator), and added to the **fast**
CI job *before* the emulator suites, so a broken fare calculation fails in seconds.

---

## 3. ONE FINDING DOCUMENTED RATHER THAN CHANGED

`roundDistanceKm` returns binary floating-point artefacts — `roundDistanceKm(5.01)` is
`5.1000000000000005` — because it computes `ceil(x / 0.1) * 0.1`.

It is **harmless**: the only consumer multiplies by the rate and `Math.ceil()`s to whole
shekels, so a 5e-16 tail cannot move a fare. There is now a test asserting exactly that
invariance. Changing the rounding would change fares, which is a **pricing decision, not a
correctness fix** — so it is flagged here rather than altered.

---

## 4. LINT WARNINGS — WHAT WAS AND WAS NOT CLEARED

159 → **157**. Only the genuinely actionable ones were touched; the rest are documented
rather than suppressed:

| Count | Rule | Decision |
|---|---|---|
| 106 | `no-console` | **Left.** Deliberate diagnostic logging in the mobile service layer. Removing it would *reduce* debuggability on devices where you cannot attach a debugger — the opposite of a robustness improvement. |
| 42 | `import/no-named-as-default(-member)` | **Left.** All from `firebase/compat` and `expo-constants` default imports. The usage is correct; the rule mis-fires on those packages' export shape. 42 suppression comments would hide the rule if it ever fired on something real. |
| 9 | `no-explicit-any` | **Left.** React Navigation / expo-router internals. Typing them needs the router's generated route types — a build-config change, not a correctness fix. |
| 2 | `no-explicit-any` | **Fixed.** Firestore timestamp handling, narrowed explicitly instead of cast. |

---

## 5. BASELINE vs FINAL

| Check | Baseline | Final |
|---|---|---|
| `pnpm typecheck` | PASS (6 projects) | PASS (6 projects) |
| `pnpm lint` | 0 errors, 159 warnings | **0 errors**, 157 warnings |
| `pnpm build:functions` | PASS | PASS |
| **Unit tests** | *(none existed)* | **35/35** |
| `pnpm qa:all` | 11 suites, 118 checks | **13 suites, 127 checks** |

New suites: `qa:seat-accounting:e2e` (5) and `qa:search-radius:e2e` (4).

---

## 6. WHAT COULD NOT BE VERIFIED

- **Real production behaviour of either fix.** Emulator only; nothing deployed. The
  radius cap in particular reads a value from the function environment, and I could only
  exercise the value in `backend/functions/.env` (5000 m).
- **Whether 5 km is the RIGHT radius.** I reconciled the conflict and made the value
  enforceable and tunable; whether that is the correct operational number for West Bank
  service areas is a product decision, not something a test can settle. The 15 km
  alternative is one env var away.
- **Accumulated drift already in production data.** This fixes the *cause*; any driver
  whose `availableSeats` was already corrupted by a past force-cancel stays corrupted
  until someone repairs those documents. No migration was written, and none was run.
- **Cloud Scheduler delivery** — unchanged from before; the no-show sweeper is invoked via
  `.run()` because firebase-tools cannot dispatch v2 `onSchedule` locally.
- **No UI was rendered.** Nothing in this pass touches a screen, but nor was any app
  launched.

**This code is not bug-free, and I am not claiming it is.** What I verified is above with
its evidence; everything else is unverified.
