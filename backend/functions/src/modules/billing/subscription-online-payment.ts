import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { PaymentStatus } from '@taxi-line/shared';
import { getFirestore } from '../../core/config';
import { ValidationError } from '../../core/errors';
import { VerifiedPaymentEvent } from '../payments';
import { shouldReactivateSubscription } from './invoice-payment';

const PREFIX = 'subinv';
export const subscriptionInvoicePaymentSubject = (invoiceId: string) => `${PREFIX}${createHash('sha256').update(invoiceId).digest('hex').slice(0, 40)}`;
export const isSubscriptionInvoicePaymentSubject = (value: string) => value.startsWith(PREFIX) && value.length === 46;

export async function advanceSubscriptionInvoicePayment(event: VerifiedPaymentEvent, provider: string) {
  const db = getFirestore();
  const subjectRef = db.collection('onlinePaymentSubjects').doc(event.tripId);
  return db.runTransaction(async (transaction) => {
    const subject = await transaction.get(subjectRef);
    if (!subject.exists || subject.data()?.kind !== 'subscription_invoice') throw new ValidationError('Unknown payment subject');
    const invoiceId = String(subject.data()?.invoiceId ?? '');
    const invoiceRef = db.collection('subscriptionInvoices').doc(invoiceId);
    const invoice = await transaction.get(invoiceRef);
    if (!invoice.exists) throw new ValidationError('Invoice not found');
    const data = invoice.data() ?? {};
    if (event.amountMinorUnits !== Math.round(Number(data.amountIls ?? 0) * 100)) throw new ValidationError('Payment amount mismatch');
    if (data.status === 'paid') return { ok: true, duplicate: true, status: 'paid' };
    if (event.status !== PaymentStatus.PAID) {
      transaction.set(subjectRef, { status: event.status, failureReason: event.failureReason ?? null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true, duplicate: false, status: event.status };
    }
    const subscriptionId = String(data.subscriptionId ?? '');
    const subscriptionRef = db.collection('subscriptions').doc(subscriptionId);
    const [subscription, invoices] = await Promise.all([transaction.get(subscriptionRef), transaction.get(db.collection('subscriptionInvoices').where('subscriptionId', '==', subscriptionId))]);
    if (!subscription.exists) throw new ValidationError('Subscription not found');
    const subscriptionData = subscription.data() ?? {};
    const otherStatuses = invoices.docs.filter((item) => item.id !== invoiceId).map((item) => String(item.data().status ?? ''));
    const reactivated = shouldReactivateSubscription(String(subscriptionData.status ?? ''), otherStatuses);
    transaction.update(invoiceRef, { status: 'paid', paymentMethod: 'card', paymentReference: event.providerChargeId, provider, paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    transaction.set(subjectRef, { status: 'paid', eventId: event.eventId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(subscriptionRef.collection('events').doc(), { type: 'subscription_invoice_paid', invoiceId, paymentMethod: 'card', paymentReference: event.providerChargeId, subscriptionReactivated: reactivated, actorId: 'payment_webhook', createdAt: FieldValue.serverTimestamp() });
    if (reactivated) {
      const targetType: unknown = subscriptionData.targetType;
      const targetId: unknown = subscriptionData.targetId;
      if ((targetType !== 'driver' && targetType !== 'office') || typeof targetId !== 'string') throw new ValidationError('Invalid subscription target');
      transaction.update(subscriptionRef, { status: 'active', reactivatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      transaction.set(db.collection(targetType === 'driver' ? 'drivers' : 'offices').doc(targetId), { subscriptionStatus: 'active', subscriptionUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    return { ok: true, duplicate: false, status: 'paid' };
  });
}
