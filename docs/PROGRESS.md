# Waselneh — Delivery Progress

Cumulative record of autonomous delivery batches. Newest first.

## Baseline (measured on `main` @ `8ce2bbf`, PR #45)

| Check | Result |
|---|---|
| Typecheck | 0 errors (6 projects) |
| Lint | 0 errors, 152 warnings (blocking on errors only) |
| Unit tests | **147** passing, 30 suites, 19 files |
| Emulator QA | **16/16** suites |

CI: `.github/workflows/ci.yml` — `static` (build:shared → typecheck → lint →
build:functions → qa:unit) and `emulator-qa` (17 suites, Node 20 / Java 21).

---

## Batch 3 — Phase 3: payment reconciliation + Lahza hardening

- **PR:** _pending_
- **Merge SHA:** _pending_
- **Tests added:** 48 unit (reconciliation-classification, settlement-mismatch,
  reconciliation-window) + 7 emulator cases (qa-settlement-reconciliation-e2e)
- **Test count after:** 231 unit, 19 emulator suites

Reconciliation existed only as CLIENT-SIDE logic in
`apps/manager-web/src/services/reconciliation.ts`, comparing our trips to our own
payments. It could never detect that the processor thinks something different.
The emulator suite loaded that TypeScript by stripping types with a regex into a
`data:` URL, because the QA harness has no TS runtime.

Moved the classification to `backend/functions/src/modules/reconciliation/` as a
compiled module (the suite now requires `dist` and the shim is gone), and added the
provider dimension that did not exist: a mismatch taxonomy covering all seven
categories, plus `managerReconcileSettlement`.

**"Could not check" never looks like "checked and found nothing."** With online
payments disabled - the default - the callable returns `providerAvailable: false`
with a reason and null totals, rather than a reassuring empty report.

`PaymentProvider` gains an OPTIONAL `fetchSettlement`, so the stub and any adapter
that cannot report settlements simply omit it. **No real or sandbox Lahza call was
made; none is faked.** The taxonomy is proven against fixtures only.

Incidental fixes: `subscribeToPayments` had no `onError`, so a payments failure
rendered an empty ledger and every trip read "Unrecorded" - wrong data rather than
an honest error. Wired through to a banner the page already had but never fed. Also
extracted the duplicated `csvCell` into `apps/manager-web/src/utils/csv.ts`,
preserving its formula-injection guard.

Also added `reconcileSettlementDaily` (03:00 Asia/Hebron), which raises the
`settlement_mismatch` ops alert and writes an auditable run record. It is gated on
the existing ONLINE_PAYMENTS_ENABLED rather than a new flag - a state where
reconciliation is "on" while payments are off cannot mean anything - so by default
it logs that it was skipped and writes nothing. A run that compared nothing never
resolves a standing alert. Its window arithmetic is half-open [from, to) and unit
tested across month, year and leap boundaries: a closed window would double-count a
payment landing exactly on midnight.

`LahzaProvider` deliberately does NOT implement `fetchSettlement`. Writing a parser
against a guessed report format, then scheduling it to raise financial alerts, would
be a control that looks real and proves nothing.

---

## Batch 2 — Phase 2: cancellation benefit restoration

- **PR:** #48 — https://github.com/ayed-teia/Waselneh-Taxi/pull/48
- **Merge SHA:** `347e8b0`
- **Tests added:** 12 unit (benefit-restoration-policy) + 6 emulator cases
  (qa-cancellation-benefits-e2e)
- **Test count after:** 183 unit, 18 emulator suites

Benefits (promo usage counters + redeemed loyalty points) are consumed at REQUEST
time. They were returned only when an UNMATCHED request was abandoned, via
`cancelTripRequest` and the search-expiry sweeper.

**Four actors that cancel a MATCHED trip restored nothing:** `passengerCancelTrip`,
`driverCancelTrip`, `managerForceCancelTrip`, and the driver-no-show branch of
`expireStaleTrips`. A passenger who redeemed a promo and points, got matched, then
cancelled before the trip started silently lost both.

`restoreTripRequestBenefits` was hard-wired to `tripRequests/{id}` - it wrote the
`benefitsRestoredAt` sentinel there and keyed the ledger `${requestId}_restored` -
so the matched-trip actors could not call it at all. Generalised to `restoreBenefits`,
which takes the benefit-bearing document and its own ref, and works from either a
`tripRequests` or a `trips` body. The old wrapper is kept so the two existing call
sites read unchanged.

Also fixed a **pre-existing latent bug** in `driverCancelTrip`: it read
`driverRequests/.../{tripId}` AFTER two writes, which Firestore rejects outright
("transactions require all reads to be executed before all writes"). Hoisted into
the read phase, matching what `passengerCancelTrip` already did. Audited the other
four cancellation transactions - all order reads before writes correctly.

`TripDocument` now carries `requestId`, linking a matched trip back to the request
that consumed its benefits.

---

## Batch 1 — Phase 1: server-authoritative referrals

- **PR:** #47 — https://github.com/ayed-teia/Waselneh-Taxi/pull/47
- **Merge SHA:** `10f11e6`
- **Tests added:** 24 unit (referral-policy) + 12 emulator cases (qa-referrals-e2e)
- **Test count after:** 171 unit, 17 emulator suites

Replaced a UI-only placeholder. The old "referral code" was built client-side as
an uppercased slice of the caller's own uid, with no backend, no collection, no
reward and no way to enter someone else's code.

**Rewards land on PAYMENT, not on completion.** `completeTrip` writes the payment
row as PENDING and `confirmCashPayment` sets PAID, so a reward hung off completion
would have paid out on cash trips the driver never collected.

`confirmCashPayment` was additionally wrapped in a transaction. It was a bare
get()-then-update(), so its "already collected" guard was a read-then-write race.

New: `referralCodes/{code}`, `referrals/{inviteeId}`, `referralCredits/{uid}`
(+ `ledger`), `referralRewardAudit/{inviteeId}`, `system/referralConfig`.
Credits live in their own server-only collection because `users/{uid}` is
owner-writable - a balance there could be self-minted.

Ships INERT: with no config document nothing is granted.

---

## Batch 0 — mobile launch blockers

- **PR:** #46 — https://github.com/ayed-teia/Waselneh-Taxi/pull/46
- **Merge SHA:** `9c40c39`
- **Tests added:** none (defect fix; existing 147 unit + 16 suites re-verified)
- **Test count after:** 147

Both mobile apps were unlaunchable on `main`:

1. `expo-splash-screen` missing from both apps while `app.config.js` declares a
   `splash` block → `ClassNotFoundException: SplashScreenManager` on launch.
   Pinned `~31.0.13` (SDK 54 line; `latest` is 57.x, targets SDK 55+).
2. `mapbox.init.ts` threw at import time from `app/_layout.tsx`, the router root.
   `@rnmapbox/maps` fails during module evaluation on the emulator, and expo-router
   treats a route whose module threw as having no default export — so `home`,
   `searching` and `trip` vanished and the app showed "Unmatched Route".
   Initialisation is now lazy inside `try/catch`; `PassengerMapView` split into a
   load boundary + `PassengerMapViewImpl`.

Evidence: route failures 3 → 0, crashes 0, both apps reach `Auth state changed`.

---

## Remaining engineering work

Phases per the delivery mandate, in order:

1. **Referrals** (next) — server-authoritative; replaces the UI-only placeholder at
   `apps/passenger-app/app/promo.tsx:24`.
2. Cancellation policy + benefit restoration.
3. Payment reconciliation + Lahza hardening.
4. Production auth hardening (OTP limits, App Check, manager MFA-ready).
5. Driver onboarding + document security (Storage rules, expiry, review queue).
6. Taxi-line FIFO pilot controls (stays flag-off pending driver sign-off).
7. UX / localisation / accessibility.
8. Firestore typing + code quality.
9. Observability, security, operations.
10. Performance + load testing.
11. Release engineering.

---

## External / manual blockers

| Blocker | Blocks | Needs |
|---|---|---|
| No Lahza credentials | Phase 3 live verification | Owner: merchant account + test keys |
| No physical device | Map rendering, push delivery | Owner: a real Android/iOS handset |
| Firebase console access | Phone Auth, App Check, APNs, SHA keys | Owner: console + store access |
| Driver-representative sign-off | Phase 6 FIFO enablement | Business decision |
| Legal retention periods | Phase 5 document retention | Legal decision |

## Release risks

- Emulator green is **not** production readiness; no load test has been run.
- Maps do not initialise on the Android emulator (`RNMBXLocationModule`); Batch 0
  contains that failure but does not repair Mapbox.
- Push delivery is unverifiable locally — the emulator issues no Expo tokens.
- `deploy:prod` pushes `functions,firestore:rules` only — **not** `firestore:indexes`.
  Index deployment is a separate manual step.
