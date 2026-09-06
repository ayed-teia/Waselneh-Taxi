# Remaining Work — Designs and Decisions

Three features that were deliberately **not built**, because each needs infrastructure
that does not exist in this repo, or a product decision only you can make. Each section
is a design plus the specific decisions that unblock it.

Phone/OTP and manager login have their own document: `docs/AUTH_ROLLOUT.md`.

---

## 1. Driver onboarding + document upload

**Blocked on: Firebase Storage, which this project does not use at all yet.**
`firebase.json` configures no storage emulator and there is no `storage.rules` file, so
there is currently nowhere for a driver to upload a licence photo.

### Current state
Drivers are created by a manager through `managerSetDriverEligibility`, which requires
`fullName`, `nationalId`, `phone`, `lineNumber` and a route. There is no self-service
onboarding and no document anywhere in the system — `verificationStatus: 'approved'` is
a manager's assertion, backed by nothing stored.

### Design

**Storage layout** — mirror the PII split this branch just made:
```
driver-documents/{driverId}/{documentType}/{uploadId}.{ext}
```
`documentType` ∈ `national_id`, `driving_licence`, `vehicle_registration`,
`insurance`, `profile_photo`.

**Storage rules** (the file to create):
- a driver may `create` only under their own `{driverId}` prefix, with a size cap
  (~10MB) and a content-type allowlist (`image/jpeg`, `image/png`, `application/pdf`);
- a driver may `read` their own documents;
- **only managers may read another driver's documents**;
- nobody may `delete` from a client — retention is a legal question, not a UI button.

**Firestore** — `drivers/{driverId}/private/documents/{documentType}` holding
`{ storagePath, uploadedAt, status: pending|approved|rejected, reviewedBy, reviewNote }`.
It goes under `private/` for the same reason `pii` did: the parent driver document is
readable by the passenger on an active trip.

**State machine** — `pending → approved | rejected(reason) → resubmitted`. A driver
becomes eligible only when every required document is `approved`; wire that into the
existing `evaluateDriverEligibility` rather than inventing a second notion of "ready".

**Review queue** — a manager-web page listing pending documents with approve/reject,
writing through a new `managerReviewDriverDocument` callable (never a direct client
write, matching how every other privileged mutation works here).

### Decisions I need
1. **Which documents are mandatory** for a licensed line owner vs a contractor?
2. **Who is legally allowed to view identity documents** — every manager role, or only
   `admin`/`operations_manager`? (Today `isManager()` is all-or-nothing.)
3. **Retention period.** Storing scans of national IDs creates a real obligation. How
   long are they kept after a driver leaves, and who deletes them?
4. **Does onboarding become self-service**, or does a manager keep creating drivers and
   documents are just attached?
5. **Is there an existing offline/paper process** these documents must reconcile with?

---

## 2. Card / online payments

**Blocked on: choosing a PSP. That is the whole decision — the SDK is the easy part.**

### Current state
Cash only. `confirmCashPayment` — which was never deployed until this branch (R6) —
flips `paymentStatus` to `paid` on the driver's word. `payments/{id}` exists and is
read-only to clients. The new reconciliation page surfaces where trips and the ledger
disagree.

### The real constraint
Not the integration — **settlement in ILS to West Bank accounts**. Stripe does not
support Palestinian entities; Israeli processors (Tranzila, PayPlus, Cardcom) and
regional providers each have different KYC, settlement and fee terms. **Pick the
processor first; the code follows in days.**

### Design (processor-agnostic)

**Never trust the client.** A client saying "payment succeeded" is a claim, not an
event. Authority is the PSP webhook.

1. `createPaymentIntent` callable → PSP intent, store `payments/{tripId}` as
   `pending` with an **idempotency key derived from the tripId**, so a retry or a
   double tap cannot charge twice.
2. Client completes the card flow in the PSP's SDK/web view. It never sees a secret key,
   and card data never touches your servers (this is what keeps you out of PCI scope).
3. **PSP webhook → an HTTP function that verifies the signature** and transitions
   `payments/{tripId}` to `paid`/`failed`, then updates the trip. Signature verification
   is the security boundary: an unverified webhook endpoint is an open "mark as paid" API.
4. Reconciliation job comparing your ledger against the PSP's daily settlement report —
   the reconciliation page already models exactly these mismatch states.

**Refunds and disputes** need a state machine of their own (`refund_pending`,
`refunded`, `disputed`) and a manager-only callable. Do not bolt them on later.

### Decisions I need
1. **Which PSP?** Everything else follows. Needs ILS settlement to your actual bank.
2. **Who bears the fee** — passenger, driver, or platform? This changes the fare
   calculation, not just the payment call.
3. **Are drivers paid out through the platform** (marketplace/split payments, much more
   PSP paperwork) or do they keep cash and settle separately?
4. **Refund policy** — who can refund, up to when, and does a cancelled trip auto-refund?
5. **Do you need saved cards?** Storing a payment token raises the compliance bar.

---

## 3. The taxi-line FIFO queue

**Blocked on: a fairness policy. This is a social/operational design problem that
happens to need code.**

### Current state
`createTripRequest` matches the **nearest** eligible driver by Haversine distance
(`driversWithDistance.sort(...)`), and this branch added re-offer to the next nearest.
There is no queue and no notion of a driver's turn.

A real taxi line is FIFO, not nearest — a driver who has waited an hour at the head of
the line expects the next fare, even if someone just pulled up closer to the passenger.
**Shipping distance-based matching into a rank culture is how you get a driver strike,
not a bug report.** So the rules must be agreed with drivers before any code.

### Design

**Queue document** — `lines/{lineId}/queue/{driverId}` with `{ joinedAt, position,
status: waiting|offered|serving }`. Positions assigned **server-side only**; a client
that can write its own position can jump the line.

**Joining** — a driver joins by going online inside the line's geofence. Leaving the
geofence, going offline, or completing a trip removes them.

**Matching** — for a request scoped to a line, offer to `status: waiting` ordered by
`position` (FIFO), falling back to the existing distance matcher when no line is
specified. The re-offer module added in this branch already walks a candidate list, so a
FIFO ordering slots in as a different way of *building* that list — the offer/timeout
machinery does not change.

**The hard part — what forfeits your place?**
- Declining an offer: back of the queue, or keep your place?
- Not answering within 45s: same question.
- Going offline for 2 minutes: do you keep your place?
- Leaving the geofence briefly (traffic, a toilet break)?
- A short trip that ends 3 minutes later — do you return to the head or the tail?

Every one of these has a defensible answer and drivers will have strong opinions. Guess
wrong and the system is seen as rigged, which is much harder to undo than a code bug.

**Anti-gaming** — position must be server-assigned, the geofence check must be
server-side against `driverLive` (a client can lie about its GPS), and managers need an
audit view of queue movements.

### Decisions I need
1. **Is the queue per line, per office, or per physical stand?**
2. **The forfeit rules above** — ideally agreed *with* a group of drivers, not for them.
3. **Does FIFO override distance entirely**, or is there a distance cap (e.g. head of
   the queue gets it unless they are >5km away)?
4. **Can a passenger request a specific driver**, and does that bypass the queue?
5. **How do full-taxi vs seat-only bookings interact with the queue** — does filling a
   seat keep you in place?
6. **Who arbitrates disputes** when a driver believes they were skipped, and what
   evidence does the app need to retain to settle it?

---

## Also worth doing (small, unblocked)

- **~240 `isRTL ? 'AR' : 'EN'` ternaries** remain across 25 files. They already carry
  both translations and work correctly, so this is a mechanical refactor into `t()`,
  not a bug. Worth doing incrementally per screen; a bulk conversion risks silent
  mistranslation for no user-visible gain.
- **~80 `no-unsafe-*` lint errors**, all from `doc.data()` returning `any`. The fix is a
  `FirestoreDataConverter` per collection using the zod schemas that already exist in
  `packages/shared/src/schemas`. Do it at the callable boundaries, collection by
  collection; then flip CI's lint step from advisory to blocking.
- **`subscribeToPayments` swallows its errors** and takes no `onError`, so a payments
  failure shows as an empty ledger in the reconciliation view. Add the callback.
- **`apps/driver-app/src/services/firebase/firebase.config.old.ts`** is provably
  unreferenced. Deleting it is a judgement call about intent, so it was left.
