import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { logger } from '../../core/logger';
import {
  BillingInterval,
  billingPeriodKey,
  reminderDaysBeforeDue,
  shouldCreateInvoice,
} from './invoice-cycle';

const DUE_DAYS = 7;
const SUSPENSION_GRACE_DAYS = 7;

function targetRef(db: FirebaseFirestore.Firestore, data: FirebaseFirestore.DocumentData) {
  if (data.targetType !== 'driver' && data.targetType !== 'office') return null;
  if (typeof data.targetId !== 'string' || !data.targetId) return null;
  return db.collection(data.targetType === 'driver' ? 'drivers' : 'offices').doc(data.targetId);
}

export const processSubscriptionBilling = onSchedule(
  { region: REGION, schedule: 'every day 02:00', timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();
    const periodKey = billingPeriodKey(now.toDate());
    const subscriptions = await db
      .collection('subscriptions')
      .where('status', '==', 'active')
      .get();
    let created = 0;
    let overdue = 0;
    let suspended = 0;
    let reminders = 0;

    for (const subscription of subscriptions.docs) {
      const data = subscription.data();
      const startsAt = data.startsAt instanceof Timestamp ? data.startsAt.toDate() : null;
      const interval = data.billingInterval as BillingInterval | undefined;
      const billable = data.billingModel === 'subscription' || data.billingModel === 'hybrid';
      const rawTargetType: unknown = data.targetType;
      const rawTargetId: unknown = data.targetId;
      const rawPlanId: unknown = data.planId;
      const targetType: 'driver' | 'office' | null =
        rawTargetType === 'driver' || rawTargetType === 'office' ? rawTargetType : null;
      const targetId = typeof rawTargetId === 'string' ? rawTargetId : null;
      const planId = typeof rawPlanId === 'string' ? rawPlanId : null;
      if (
        !billable ||
        !startsAt ||
        !interval ||
        !targetType ||
        !targetId ||
        !shouldCreateInvoice(startsAt, now.toDate(), interval)
      )
        continue;
      const amountIls = Math.max(0, Number(data.recurringFeeIls ?? 0));
      if (amountIls <= 0) continue;
      const invoiceRef = db
        .collection('subscriptionInvoices')
        .doc(`${subscription.id}_${periodKey}`);
      const dueAt = Timestamp.fromMillis(now.toMillis() + DUE_DAYS * 86_400_000);
      await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(invoiceRef);
        if (existing.exists) return;
        transaction.set(invoiceRef, {
          invoiceId: invoiceRef.id,
          subscriptionId: subscription.id,
          targetType,
          targetId,
          planId,
          periodKey,
          amountIls,
          currency: 'ILS',
          status: 'pending',
          dueAt,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        if (targetType === 'driver') {
          const notificationId = `subscription_invoice_${periodKey}`;
          transaction.set(
            db
              .collection('userNotifications')
              .doc(targetId)
              .collection('items')
              .doc(notificationId),
            {
              userId: targetId,
              role: 'driver',
              type: 'subscription_invoice',
              invoiceId: invoiceRef.id,
              read: false,
              titleAr: 'فاتورة اشتراك جديدة',
              titleEn: 'New subscription invoice',
              bodyAr: `قيمة الفاتورة ${amountIls.toFixed(2)} شيكل، الاستحقاق خلال ${DUE_DAYS} أيام.`,
              bodyEn: `Invoice amount NIS ${amountIls.toFixed(2)}, due in ${DUE_DAYS} days.`,
              createdAt: FieldValue.serverTimestamp(),
            }
          );
        }
        created += 1;
      });
    }

    const pendingInvoices = await db
      .collection('subscriptionInvoices')
      .where('status', '==', 'pending')
      .get();
    for (const invoice of pendingInvoices.docs) {
      const data = invoice.data();
      if (
        data.targetType !== 'driver' ||
        typeof data.targetId !== 'string' ||
        !(data.dueAt instanceof Timestamp)
      )
        continue;
      const days = reminderDaysBeforeDue(data.dueAt.toDate(), now.toDate());
      if (!days) continue;
      await db
        .collection('userNotifications')
        .doc(data.targetId)
        .collection('items')
        .doc(`subscription_due_${invoice.id}_${days}`)
        .set(
          {
            userId: data.targetId,
            role: 'driver',
            type: 'subscription_invoice_reminder',
            invoiceId: invoice.id,
            read: false,
            titleAr: 'تذكير بموعد فاتورة الاشتراك',
            titleEn: 'Subscription invoice reminder',
            bodyAr: `متبقي ${days === 1 ? 'يوم واحد' : '3 أيام'} على فاتورة بقيمة ${Number(data.amountIls ?? 0).toFixed(2)} شيكل.`,
            bodyEn: `${days} day(s) remain on your NIS ${Number(data.amountIls ?? 0).toFixed(2)} invoice.`,
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      reminders += 1;
    }

    const overdueInvoices = await db
      .collection('subscriptionInvoices')
      .where('status', '==', 'pending')
      .where('dueAt', '<', now)
      .get();
    for (const invoice of overdueInvoices.docs) {
      const data = invoice.data();
      const subscriptionRef = db.collection('subscriptions').doc(String(data.subscriptionId));
      const subscription = await subscriptionRef.get();
      const target = targetRef(db, subscription.data() ?? {});
      const batch = db.batch();
      batch.update(invoice.ref, {
        status: 'past_due',
        pastDueAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(
        subscriptionRef,
        { status: 'past_due', updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      if (target)
        batch.set(
          target,
          { subscriptionStatus: 'past_due', updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      await batch.commit();
      overdue += 1;
    }

    const suspensionCutoff = Timestamp.fromMillis(
      now.toMillis() - SUSPENSION_GRACE_DAYS * 86_400_000
    );
    const lateInvoices = await db
      .collection('subscriptionInvoices')
      .where('status', '==', 'past_due')
      .where('dueAt', '<', suspensionCutoff)
      .get();
    for (const invoice of lateInvoices.docs) {
      const data = invoice.data();
      const subscriptionRef = db.collection('subscriptions').doc(String(data.subscriptionId));
      const subscription = await subscriptionRef.get();
      const target = targetRef(db, subscription.data() ?? {});
      const batch = db.batch();
      batch.update(invoice.ref, {
        status: 'suspended',
        suspendedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(
        subscriptionRef,
        { status: 'suspended', updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      if (target)
        batch.set(
          target,
          {
            subscriptionStatus: 'suspended',
            ...(data.targetType === 'driver'
              ? { isOnline: false, isAvailable: false, status: 'offline' }
              : {}),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      await batch.commit();
      suspended += 1;
    }
    logger.info('[SubscriptionBilling] Cycle complete', {
      periodKey,
      created,
      reminders,
      overdue,
      suspended,
    });
  }
);
