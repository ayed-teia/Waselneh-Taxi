import { FieldValue, Firestore, Transaction } from 'firebase-admin/firestore';

export interface BenefitRestorationPlan {
  passengerId: string;
  promoCode: string | null;
  loyaltyPoints: number;
}

export function getBenefitRestorationPlan(data: Record<string, unknown>): BenefitRestorationPlan | null {
  if (data.benefitsRestoredAt) return null;
  const passengerId = typeof data.passengerId === 'string' ? data.passengerId.trim() : '';
  if (!passengerId) return null;
  const rawPromo = typeof data.promoCode === 'string' ? data.promoCode.trim() : '';
  const loyaltyPoints = Number.isFinite(data.loyaltyPointsRedeemed)
    ? Math.max(0, Math.floor(Number(data.loyaltyPointsRedeemed)))
    : 0;
  return { passengerId, promoCode: rawPromo || null, loyaltyPoints };
}

export async function restoreTripRequestBenefits(
  transaction: Transaction,
  db: Firestore,
  requestId: string,
  data: Record<string, unknown>,
  reason: 'passenger_cancelled' | 'search_expired'
): Promise<boolean> {
  const plan = getBenefitRestorationPlan(data);
  if (!plan) return false;
  const requestRef = db.collection('tripRequests').doc(requestId);
  const promoRef = plan.promoCode ? db.collection('promoCodes').doc(plan.promoCode) : null;
  const redemptionRef = plan.promoCode
    ? db.collection('promoRedemptions').doc(`${plan.promoCode}_${plan.passengerId}`)
    : null;
  const [promoSnapshot, redemptionSnapshot] = await Promise.all([
    promoRef ? transaction.get(promoRef) : Promise.resolve(null),
    redemptionRef ? transaction.get(redemptionRef) : Promise.resolve(null),
  ]);

  if (promoRef && promoSnapshot?.exists) {
    transaction.update(promoRef, { usageCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() });
  }
  if (redemptionRef && redemptionSnapshot?.exists) {
    transaction.update(redemptionRef, { usageCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() });
  }
  if (plan.promoCode) {
    transaction.set(db.collection('promoRedemptionAudit').doc(requestId), {
      restoredAt: FieldValue.serverTimestamp(), restoredReason: reason,
    }, { merge: true });
  }
  if (plan.loyaltyPoints > 0) {
    const passengerRef = db.collection('users').doc(plan.passengerId);
    transaction.set(passengerRef, {
      loyaltyPoints: FieldValue.increment(plan.loyaltyPoints), loyaltyUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(passengerRef.collection('loyaltyLedger').doc(`${requestId}_restored`), {
      tripRequestId: requestId, type: 'trip_discount_restored', points: plan.loyaltyPoints,
      reason, createdAt: FieldValue.serverTimestamp(),
    });
  }
  transaction.update(requestRef, {
    benefitsRestoredAt: FieldValue.serverTimestamp(), benefitsRestoreReason: reason,
  });
  return true;
}
