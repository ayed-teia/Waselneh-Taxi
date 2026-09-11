import { FieldValue, Firestore, Transaction } from 'firebase-admin/firestore';

/**
 * ============================================================================
 * BENEFIT RESTORATION
 * ============================================================================
 *
 * When a booking is abandoned, whatever the passenger spent to get the discount
 * must go back: the promo redemption they consumed, and any loyalty points they
 * redeemed. Neither is refunded by anything else, so without this a cancelled
 * booking silently destroys value the passenger paid for.
 *
 * WHY THIS IS DOCUMENT-AGNOSTIC
 *
 * Benefits are consumed at REQUEST time and recorded on `tripRequests/{id}`. But
 * once dispatch matches a driver, the authoritative record becomes `trips/{id}`,
 * which carries its own copy of promoCode / loyaltyPointsRedeemed. Restoration
 * therefore has to work from EITHER document.
 *
 * This used to be hard-wired to `tripRequests`: it wrote the sentinel there and
 * keyed the ledger `${requestId}_restored`. That meant the four actors which
 * cancel a MATCHED trip - passengerCancelTrip, driverCancelTrip,
 * managerForceCancelTrip and the driver-no-show sweeper - could not call it at
 * all, and none of them restored anything. A passenger who redeemed a promo and
 * points, got matched, then cancelled before the trip started lost both.
 *
 * IDEMPOTENCY
 *
 * The `benefitsRestoredAt` sentinel lives on whichever document is authoritative
 * and is checked before any write, so a retried transaction, a double-tap, or a
 * sweeper re-observing the same trip restores exactly once. The ledger entry id
 * is derived from that document's own id, which is unique across both
 * collections because Firestore auto-ids do not collide.
 * ============================================================================
 */

/** Why benefits were returned. Recorded on the document and in the ledger. */
export type BenefitRestorationReason =
  | 'passenger_cancelled'
  | 'search_expired'
  | 'driver_cancelled'
  | 'manager_cancelled'
  | 'driver_no_show';

export interface BenefitRestorationPlan {
  passengerId: string;
  promoCode: string | null;
  loyaltyPoints: number;
}

/**
 * Decide what is owed back, or null when nothing is.
 *
 * Pure - no I/O - so every branch is unit-testable. Returns null when the
 * document has already been restored, which is the primary double-refund guard.
 */
export function getBenefitRestorationPlan(data: Record<string, unknown>): BenefitRestorationPlan | null {
  if (data.benefitsRestoredAt) return null;
  const passengerId = typeof data.passengerId === 'string' ? data.passengerId.trim() : '';
  if (!passengerId) return null;
  const rawPromo = typeof data.promoCode === 'string' ? data.promoCode.trim() : '';
  const loyaltyPoints = Number.isFinite(data.loyaltyPointsRedeemed)
    ? Math.max(0, Math.floor(Number(data.loyaltyPointsRedeemed)))
    : 0;
  // NOTE: a plan is returned even when nothing monetary is owed. The caller still
  // writes the benefitsRestoredAt sentinel, which is what lets a LATER actor tell
  // "already handled" from "never handled". Four actors can cancel the same trip,
  // so dropping the marker here would break that distinction.
  return { passengerId, promoCode: rawPromo || null, loyaltyPoints };
}

/**
 * Return consumed promo usage and redeemed loyalty points.
 *
 * MUST be called from the caller's READ phase: it issues transaction.get calls,
 * and Firestore forbids a read after any write in the same transaction.
 *
 * @param benefitRef the document that consumed the benefits and carries the
 *                   `benefitsRestoredAt` sentinel - `tripRequests/{id}` before a
 *                   match, `trips/{id}` after one
 * @param data       that document's body, already read by the caller
 */
export async function restoreBenefits(
  transaction: Transaction,
  db: Firestore,
  benefitRef: FirebaseFirestore.DocumentReference,
  data: Record<string, unknown>,
  reason: BenefitRestorationReason
): Promise<boolean> {
  const plan = getBenefitRestorationPlan(data);
  if (!plan) return false;

  const documentId = benefitRef.id;
  const promoRef = plan.promoCode ? db.collection('promoCodes').doc(plan.promoCode) : null;
  const redemptionRef = plan.promoCode
    ? db.collection('promoRedemptions').doc(`${plan.promoCode}_${plan.passengerId}`)
    : null;

  // ---- reads first -----------------------------------------------------------
  const [promoSnapshot, redemptionSnapshot] = await Promise.all([
    promoRef ? transaction.get(promoRef) : Promise.resolve(null),
    redemptionRef ? transaction.get(redemptionRef) : Promise.resolve(null),
  ]);

  // ---- writes ----------------------------------------------------------------
  if (promoRef && promoSnapshot?.exists) {
    transaction.update(promoRef, {
      usageCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (redemptionRef && redemptionSnapshot?.exists) {
    transaction.update(redemptionRef, {
      usageCount: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (plan.promoCode) {
    transaction.set(
      db.collection('promoRedemptionAudit').doc(documentId),
      { restoredAt: FieldValue.serverTimestamp(), restoredReason: reason },
      { merge: true }
    );
  }
  if (plan.loyaltyPoints > 0) {
    const passengerRef = db.collection('users').doc(plan.passengerId);
    transaction.set(
      passengerRef,
      {
        loyaltyPoints: FieldValue.increment(plan.loyaltyPoints),
        loyaltyUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(passengerRef.collection('loyaltyLedger').doc(`${documentId}_restored`), {
      sourceDocumentId: documentId,
      type: 'trip_discount_restored',
      points: plan.loyaltyPoints,
      reason,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  transaction.update(benefitRef, {
    benefitsRestoredAt: FieldValue.serverTimestamp(),
    benefitsRestoreReason: reason,
  });
  return true;
}

/**
 * Backwards-compatible wrapper for the unmatched-request path.
 *
 * Kept so the two existing call sites (cancelTripRequest and the search-expiry
 * sweeper) read unchanged.
 */
export async function restoreTripRequestBenefits(
  transaction: Transaction,
  db: Firestore,
  requestId: string,
  data: Record<string, unknown>,
  reason: BenefitRestorationReason
): Promise<boolean> {
  return restoreBenefits(transaction, db, db.collection('tripRequests').doc(requestId), data, reason);
}
