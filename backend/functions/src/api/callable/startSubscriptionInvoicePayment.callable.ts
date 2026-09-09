import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { subscriptionInvoicePaymentSubject } from '../../modules/billing/subscription-online-payment';
import { getPaymentProvider } from '../../modules/payments';

const Schema = z.object({ invoiceId: z.string().trim().min(1) });
export const startSubscriptionInvoicePayment = onCall({ region: REGION, timeoutSeconds: 30 }, async (request) => {
  try {
    const driverId = getAuthenticatedUserId(request);
    if (!driverId) throw new UnauthorizedError('Authentication required');
    const parsed = Schema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid invoice');
    const provider = getPaymentProvider();
    if (!provider) throw new ValidationError('Online payments are not enabled');
    const db = getFirestore();
    const invoice = await db.collection('subscriptionInvoices').doc(parsed.data.invoiceId).get();
    if (!invoice.exists) throw new NotFoundError('Subscription invoice', parsed.data.invoiceId);
    const data = invoice.data() ?? {};
    if (data.targetType !== 'driver' || data.targetId !== driverId) throw new ForbiddenError('This invoice does not belong to you');
    if (!['pending', 'past_due', 'suspended'].includes(String(data.status ?? ''))) throw new ValidationError('Invoice cannot be paid');
    const amountMinorUnits = Math.round(Number(data.amountIls ?? 0) * 100);
    if (amountMinorUnits <= 0) throw new ValidationError('Invoice amount is invalid');
    const subject = subscriptionInvoicePaymentSubject(invoice.id);
    const subjectRef = db.collection('onlinePaymentSubjects').doc(subject);
    await subjectRef.set({ kind: 'subscription_invoice', invoiceId: invoice.id, driverId, amountMinorUnits, status: 'initiating', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const charge = await provider.createCharge({ tripId: subject, passengerId: driverId, amountMinorUnits, currency: 'ILS', idempotencyKey: subject });
    await subjectRef.set({ provider: provider.name, providerChargeId: charge.providerChargeId, status: 'awaiting_payment', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { success: true, clientActionUrl: charge.clientActionUrl, providerChargeId: charge.providerChargeId };
  } catch (error) { throw handleError(error); }
});
