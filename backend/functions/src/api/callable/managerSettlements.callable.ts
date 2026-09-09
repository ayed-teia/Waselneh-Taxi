import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';
import { calculateSettlement } from '../../modules/billing/settlement';

const CreateSchema = z.object({
  targetType: z.enum(['driver', 'office']),
  targetId: z.string().trim().min(1),
  periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  commissionRecordIds: z.array(z.string().trim().min(1)).min(1).max(100),
  includeRecurringFee: z.boolean().default(true),
});
const PaySchema = z.object({
  settlementId: z.string().trim().min(1),
  paymentReference: z.string().trim().min(2).max(200),
});

async function requireGlobalBillingManager(managerId: string) {
  const profile = await assertManagerPermission(managerId, 'manage_pricing');
  if (!profile.isGlobalScope) throw new ForbiddenError('Only a global manager can settle billing');
}

export const managerCreateCommissionSettlement = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await requireGlobalBillingManager(managerId);
    const parsed = CreateSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid settlement request', parsed.error.flatten());
    const data = parsed.data;
    const db = getFirestore();
    const settlementId = `${data.targetType}_${data.targetId}_${data.periodKey}`;
    const settlementRef = db.collection('commissionSettlements').doc(settlementId);
    const subscriptionRef = db.collection('subscriptions').doc(`${data.targetType}_${data.targetId}`);
    const recordRefs = [...new Set(data.commissionRecordIds)].map((id) => db.collection('commissionRecords').doc(id));

    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(settlementRef);
      if (existing.exists) return { success: true as const, settlementId, alreadyExists: true };
      const [subscription, ...records] = await Promise.all([
        transaction.get(subscriptionRef),
        ...recordRefs.map((ref) => transaction.get(ref)),
      ]);
      const normalized = records.map((record) => {
        if (!record.exists) throw new NotFoundError('Commission record', record.id);
        const value = record.data() ?? {};
        const belongs = data.targetType === 'driver'
          ? value.driverId === data.targetId
          : value.officeId === data.targetId;
        if (!belongs || value.status !== 'pending') {
          throw new ForbiddenError(`Commission record ${record.id} is not pending for this target`);
        }
        return {
          grossFareIls: Number(value.grossFareIls ?? 0),
          commissionIls: Number(value.commissionIls ?? 0),
          driverNetIls: Number(value.driverNetIls ?? 0),
        };
      });
      const subscriptionData = subscription.data() ?? {};
      const chargeFee = data.includeRecurringFee &&
        ['subscription', 'hybrid'].includes(String(subscriptionData.billingModel ?? ''));
      const amounts = calculateSettlement(normalized, chargeFee ? Number(subscriptionData.recurringFeeIls ?? 0) : 0);
      transaction.set(settlementRef, {
        settlementId, ...data, commissionRecordIds: recordRefs.map((ref) => ref.id), ...amounts,
        status: 'pending', createdBy: managerId, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      for (const ref of recordRefs) transaction.update(ref, { status: 'processing', settlementId, updatedAt: FieldValue.serverTimestamp() });
      return { success: true as const, settlementId, alreadyExists: false, ...amounts };
    });
  } catch (error) { throw handleError(error); }
});

export const managerMarkCommissionSettlementPaid = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await requireGlobalBillingManager(managerId);
    const parsed = PaySchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid settlement payment', parsed.error.flatten());
    const db = getFirestore();
    const ref = db.collection('commissionSettlements').doc(parsed.data.settlementId);
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists) throw new NotFoundError('Settlement', parsed.data.settlementId);
      const data = doc.data() ?? {};
      if (data.status === 'paid') return;
      if (data.status !== 'pending') throw new ForbiddenError('Only pending settlements can be paid');
      const recordIds = Array.isArray(data.commissionRecordIds) ? data.commissionRecordIds.filter((id): id is string => typeof id === 'string') : [];
      transaction.update(ref, { status: 'paid', paymentReference: parsed.data.paymentReference, paidAt: FieldValue.serverTimestamp(), paidBy: managerId, updatedAt: FieldValue.serverTimestamp() });
      for (const id of recordIds) transaction.update(db.collection('commissionRecords').doc(id), { status: 'settled', settledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true as const, settlementId: parsed.data.settlementId };
  } catch (error) { throw handleError(error); }
});
