import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';
import { decideRefundRequest, getPaymentProvider } from '../../modules/payments';

const Schema = z.object({
  paymentId: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(3).max(300),
});

export const managerRefundPayment = onCall({ region: REGION, timeoutSeconds: 30 }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    const parsed = Schema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid refund request', parsed.error.flatten());

    const db = getFirestore();
    const paymentRef = db.collection('payments').doc(parsed.data.paymentId);
    const initialPayment = await paymentRef.get();
    if (!initialPayment.exists) throw new NotFoundError('Payment', parsed.data.paymentId);
    const initialData = initialPayment.data() ?? {};
    const tripId = typeof initialData.tripId === 'string' ? initialData.tripId : '';
    if (!tripId) throw new ValidationError('Payment has no trip reference');
    const trip = await db.collection('trips').doc(tripId).get();
    const officeId = typeof trip.data()?.officeId === 'string' ? String(trip.data()?.officeId) : '';
    const profile = await assertManagerPermission(
      managerId,
      'manage_payments',
      officeId ? { officeId } : undefined
    );
    if (!profile.isGlobalScope && !officeId) {
      throw new ForbiddenError('Scoped managers cannot refund a payment without an office');
    }
    const provider = getPaymentProvider();
    if (!provider) throw new ValidationError('Online payments are not enabled');

    const reservation = await db.runTransaction(async (transaction) => {
      const payment = await transaction.get(paymentRef);
      if (!payment.exists) throw new NotFoundError('Payment', parsed.data.paymentId);
      const data = payment.data() ?? {};
      const decision = decideRefundRequest(String(data.status ?? ''), String(data.refundRequestStatus ?? ''));
      if (decision.alreadyRequested) return { alreadyRequested: true as const };
      if (!decision.allowed) throw new ValidationError(decision.reason ?? 'Refund is not allowed');
      const providerChargeId = typeof data.providerChargeId === 'string' ? data.providerChargeId : '';
      if (!providerChargeId) throw new ValidationError('Payment has no provider charge reference');
      const amountIls = Number(data.amount ?? 0);
      if (!Number.isFinite(amountIls) || amountIls <= 0) throw new ValidationError('Payment amount is invalid');
      transaction.update(paymentRef, {
        refundRequestStatus: 'processing',
        refundReason: parsed.data.reason,
        refundRequestedBy: managerId,
        refundRequestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(db.collection('paymentRefundRequests').doc(payment.id), {
        paymentId: payment.id,
        tripId,
        officeId: officeId || null,
        amountIls,
        reason: parsed.data.reason,
        status: 'processing',
        requestedBy: managerId,
        requestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { alreadyRequested: false as const, providerChargeId, amountIls };
    });
    if (reservation.alreadyRequested) return { success: true as const, alreadyRequested: true };

    try {
      const refund = await provider.refund({
        providerChargeId: reservation.providerChargeId,
        amountMinorUnits: Math.round(reservation.amountIls * 100),
        reason: parsed.data.reason,
      });
      const patch = {
        refundRequestStatus: 'submitted',
        providerRefundId: refund.providerRefundId,
        refundProviderSettled: refund.settled,
        updatedAt: FieldValue.serverTimestamp(),
      };
      await Promise.all([
        paymentRef.update(patch),
        db.collection('paymentRefundRequests').doc(paymentRef.id).update({
          ...patch,
          status: 'submitted',
          submittedAt: FieldValue.serverTimestamp(),
        }),
      ]);
      return { success: true as const, alreadyRequested: false, status: 'submitted' as const };
    } catch (providerError) {
      const failure = providerError instanceof Error ? providerError.message : 'Refund provider failed';
      await Promise.all([
        paymentRef.update({ refundRequestStatus: 'failed', refundFailureReason: failure, updatedAt: FieldValue.serverTimestamp() }),
        db.collection('paymentRefundRequests').doc(paymentRef.id).update({ status: 'failed', failureReason: failure, updatedAt: FieldValue.serverTimestamp() }),
      ]);
      throw providerError;
    }
  } catch (error) {
    throw handleError(error);
  }
});
