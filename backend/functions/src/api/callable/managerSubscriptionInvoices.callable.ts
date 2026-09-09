import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';
import { isPayableInvoiceStatus, shouldReactivateSubscription } from '../../modules/billing/invoice-payment';

const PaymentSchema = z.object({
  invoiceId: z.string().trim().min(1),
  paymentReference: z.string().trim().min(2).max(200),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'card', 'other']),
});

async function requireGlobalBillingManager(managerId: string) {
  const profile = await assertManagerPermission(managerId, 'manage_pricing');
  if (!profile.isGlobalScope) throw new ForbiddenError('Only a global manager can record invoice payments');
}

export const managerMarkSubscriptionInvoicePaid = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await requireGlobalBillingManager(managerId);
    const parsed = PaymentSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid invoice payment', parsed.error.flatten());

    const db = getFirestore();
    const invoiceRef = db.collection('subscriptionInvoices').doc(parsed.data.invoiceId);
    let reactivated = false;
    let alreadyPaid = false;

    await db.runTransaction(async (transaction) => {
      const invoice = await transaction.get(invoiceRef);
      if (!invoice.exists) throw new NotFoundError('Subscription invoice', parsed.data.invoiceId);
      const invoiceData = invoice.data() ?? {};
      if (invoiceData.status === 'paid') {
        alreadyPaid = true;
        return;
      }
      if (!isPayableInvoiceStatus(String(invoiceData.status ?? ''))) {
        throw new ForbiddenError('Only pending or overdue invoices can be paid');
      }

      const subscriptionId = typeof invoiceData.subscriptionId === 'string' ? invoiceData.subscriptionId : '';
      if (!subscriptionId) throw new ValidationError('Invoice has no subscription');
      const subscriptionRef = db.collection('subscriptions').doc(subscriptionId);
      const [subscription, invoices] = await Promise.all([
        transaction.get(subscriptionRef),
        transaction.get(db.collection('subscriptionInvoices').where('subscriptionId', '==', subscriptionId)),
      ]);
      if (!subscription.exists) throw new NotFoundError('Subscription', subscriptionId);
      const subscriptionData = subscription.data() ?? {};
      const otherStatuses = invoices.docs
        .filter((item) => item.id !== invoice.id)
        .map((item) => String(item.data().status ?? ''));
      reactivated = shouldReactivateSubscription(String(subscriptionData.status ?? ''), otherStatuses);

      transaction.update(invoiceRef, {
        status: 'paid',
        paymentReference: parsed.data.paymentReference,
        paymentMethod: parsed.data.paymentMethod,
        paidAt: FieldValue.serverTimestamp(),
        paidBy: managerId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(subscriptionRef.collection('events').doc(), {
        type: 'subscription_invoice_paid',
        invoiceId: invoice.id,
        paymentReference: parsed.data.paymentReference,
        paymentMethod: parsed.data.paymentMethod,
        previousInvoiceStatus: String(invoiceData.status ?? ''),
        subscriptionReactivated: reactivated,
        actorId: managerId,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (!reactivated) return;
      const targetType: unknown = subscriptionData.targetType;
      const targetId: unknown = subscriptionData.targetId;
      if ((targetType !== 'driver' && targetType !== 'office') || typeof targetId !== 'string' || !targetId) {
        throw new ValidationError('Subscription target is invalid');
      }
      const targetRef = db.collection(targetType === 'driver' ? 'drivers' : 'offices').doc(targetId);
      transaction.update(subscriptionRef, {
        status: 'active',
        reactivatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: managerId,
      });
      transaction.set(targetRef, {
        subscriptionStatus: 'active',
        subscriptionUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (targetType === 'driver') {
        transaction.set(db.collection('userNotifications').doc(targetId).collection('items').doc(`subscription_payment_${invoice.id}`), {
          userId: targetId,
          role: 'driver',
          type: 'subscription_payment_confirmed',
          invoiceId: invoice.id,
          read: false,
          titleAr: 'تم استلام دفعة الاشتراك',
          titleEn: 'Subscription payment received',
          bodyAr: 'تم تفعيل اشتراكك. يمكنك العودة للعمل عند تشغيل حالة الاتصال.',
          bodyEn: 'Your subscription is active. You can resume work when you go online.',
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });

    return { success: true as const, invoiceId: parsed.data.invoiceId, alreadyPaid, reactivated };
  } catch (error) {
    throw handleError(error);
  }
});
