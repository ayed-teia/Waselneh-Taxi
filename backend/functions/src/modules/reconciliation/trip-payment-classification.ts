/**
 * ============================================================================
 * PAYMENT RECONCILIATION - INTERNAL CLASSIFICATION
 * ============================================================================
 *
 * Compares OUR trips against OUR payment ledger. Pure functions, no I/O, so the
 * classification that decides whether money is considered collected is directly
 * testable rather than only observable through a rendered page.
 *
 * WHY THIS MOVED TO THE BACKEND
 *
 * This logic used to live in `apps/manager-web/src/services/reconciliation.ts`.
 * The emulator suite had to load it by reading the TypeScript source and stripping
 * the type annotations with a hand-rolled regex transform into a `data:` URL,
 * because the QA harness has no TypeScript runtime. That shim was fragile - a
 * generic or a type-only construct it did not anticipate would break the suite
 * rather than the code under test.
 *
 * Financial classification is also server business: the manager page should render
 * what the server decided, not re-derive it from a client-side Firestore query.
 * The behaviour below is a faithful port - every state and edge case the previous
 * suite pinned is preserved.
 *
 * THE STATES
 *   collected    the trip says paid AND a payment record exists.  Healthy.
 *   uncollected  the trip completed but payment is still pending. Money owed.
 *   unrecorded   the trip says paid but there is NO payment document - the trip
 *                and the ledger disagree, which is the case worth chasing.
 *
 * Separately, an ORPHANED payment is one whose trip is absent from the set.
 * ============================================================================
 */

export type ReconcileState = 'collected' | 'uncollected' | 'unrecorded';

/** Minimal shape needed to classify; keeps this decoupled from the full documents. */
export interface ReconcilableTrip {
  tripId: string;
  paymentStatus: string;
}

export interface ReconcilablePayment {
  paymentId: string;
  tripId: string;
}

/**
 * Classify one trip against the payment (if any) found for it.
 *
 * A payment is matched by tripId; `null` means no payment document exists.
 *
 * The trip is the source of truth for whether the ride was paid for: a stray
 * ledger row alone never upgrades a pending trip to `collected`, and an unknown
 * or malformed status is never read as paid.
 */
export function classifyTrip(
  trip: ReconcilableTrip,
  payment: ReconcilablePayment | null | undefined
): ReconcileState {
  const tripSaysPaid = trip.paymentStatus === 'paid';
  if (tripSaysPaid && payment) return 'collected';
  if (tripSaysPaid && !payment) return 'unrecorded';
  return 'uncollected';
}

/** Index payments by trip id, so the join is O(n) rather than O(n*m). */
export function indexPaymentsByTrip<T extends ReconcilablePayment>(
  payments: readonly T[]
): Map<string, T> {
  const map = new Map<string, T>();
  for (const payment of payments) {
    // An empty tripId must never become a wildcard match.
    if (payment.tripId) map.set(payment.tripId, payment);
  }
  return map;
}

/**
 * Payments whose trip is not present in the given trip set.
 *
 * Note this is relative to the trips actually loaded - the caller supplies
 * COMPLETED trips, so a payment attached to an in-progress trip legitimately
 * shows as orphaned. That is intentional: a payment record for a trip that has
 * not completed is exactly as interesting as one for a trip that vanished.
 */
export function findOrphanedPayments<T extends ReconcilablePayment>(
  payments: readonly T[],
  trips: readonly ReconcilableTrip[]
): T[] {
  const tripIds = new Set(trips.map((trip) => trip.tripId));
  return payments.filter((payment) => payment.tripId && !tripIds.has(payment.tripId));
}

export interface ReconcileTotals {
  collectedCount: number;
  uncollectedCount: number;
  unrecordedCount: number;
}

/** Count trips per state. */
export function summarize(states: readonly ReconcileState[]): ReconcileTotals {
  return {
    collectedCount: states.filter((state) => state === 'collected').length,
    uncollectedCount: states.filter((state) => state === 'uncollected').length,
    unrecordedCount: states.filter((state) => state === 'unrecorded').length,
  };
}
