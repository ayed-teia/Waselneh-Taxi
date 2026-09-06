/**
 * ============================================================================
 * PAYMENT RECONCILIATION - CLASSIFICATION
 * ============================================================================
 *
 * Pure functions, deliberately free of React, so the classification that decides
 * whether money is considered collected can be tested directly rather than only
 * through a rendered page. It was previously inline in PaymentReconciliationPage
 * and therefore only verifiable by eye.
 *
 * The states:
 *   collected    the trip says paid AND a payment record exists.  Healthy.
 *   uncollected  the trip completed but payment is still pending. Money owed.
 *   unrecorded   the trip says paid but there is NO payment document - the trip
 *                and the ledger disagree, which is the case worth chasing.
 *
 * Separately, an ORPHANED payment is one whose trip is absent from the completed
 * set entirely.
 * ============================================================================
 */

export type ReconcileState = 'collected' | 'uncollected' | 'unrecorded';

/** Minimal shape needed to classify; keeps this decoupled from the full docs. */
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
    if (payment.tripId) map.set(payment.tripId, payment);
  }
  return map;
}

/**
 * Payments whose trip is not present in the given trip set.
 *
 * Note this is relative to the trips actually loaded - the page subscribes to
 * COMPLETED trips, so a payment attached to an in-progress trip legitimately
 * shows as orphaned there. That is intentional: a payment record for a trip that
 * has not completed is exactly as interesting as one for a trip that vanished.
 */
export function findOrphanedPayments<T extends ReconcilablePayment>(
  payments: readonly T[],
  trips: readonly ReconcilableTrip[]
): T[] {
  const tripIds = new Set(trips.map((t) => t.tripId));
  return payments.filter((p) => p.tripId && !tripIds.has(p.tripId));
}

export interface ReconcileTotals {
  collectedCount: number;
  uncollectedCount: number;
  unrecordedCount: number;
}

/** Count trips per state. */
export function summarize(states: readonly ReconcileState[]): ReconcileTotals {
  return {
    collectedCount: states.filter((s) => s === 'collected').length,
    uncollectedCount: states.filter((s) => s === 'uncollected').length,
    unrecordedCount: states.filter((s) => s === 'unrecorded').length,
  };
}
