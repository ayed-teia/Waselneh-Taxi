import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { assertManagerPermission } from '../../modules/auth';
import { calculateOfficeStatement } from '../../modules/billing/office-statement';
import { shouldReactivateSubscription } from '../../modules/billing/invoice-payment';

const CreateSchema = z.object({
  officeId: z.string().trim().min(1),
  periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  commissionRecordIds: z.array(z.string().trim().min(1)).max(100),
  subscriptionInvoiceIds: z.array(z.string().trim().min(1)).max(20),
}).refine((value) => value.commissionRecordIds.length + value.subscriptionInvoiceIds.length > 0, 'Statement cannot be empty');
const PaySchema = z.object({ statementId: z.string().trim().min(1), paymentReference: z.string().trim().min(2).max(200) });

async function requireGlobalManager(managerId: string) {
  const profile = await assertManagerPermission(managerId, 'manage_pricing');
  if (!profile.isGlobalScope) throw new ForbiddenError('Only a global manager can manage office statements');
}

export const managerCreateOfficeStatement = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await requireGlobalManager(managerId);
    const parsed = CreateSchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid office statement', parsed.error.flatten());
    const data = parsed.data;
    const db = getFirestore();
    const statementId = `${data.officeId}_${data.periodKey}`;
    const statementRef = db.collection('officeBillingStatements').doc(statementId);
    const recordRefs = [...new Set(data.commissionRecordIds)].map((id) => db.collection('commissionRecords').doc(id));
    const invoiceRefs = [...new Set(data.subscriptionInvoiceIds)].map((id) => db.collection('subscriptionInvoices').doc(id));
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(statementRef);
      if (existing.exists) return { success: true as const, statementId, alreadyExists: true };
      const [office, ...documents] = await Promise.all([
        transaction.get(db.collection('offices').doc(data.officeId)),
        ...recordRefs.map((ref) => transaction.get(ref)),
        ...invoiceRefs.map((ref) => transaction.get(ref)),
      ]);
      if (!office.exists) throw new NotFoundError('Office', data.officeId);
      const records = documents.slice(0, recordRefs.length);
      const invoices = documents.slice(recordRefs.length);
      const commissionInputs = records.map((doc) => {
        const value = doc.data() ?? {};
        const recordPeriod = value.createdAt instanceof Timestamp ? value.createdAt.toDate().toISOString().slice(0, 7) : '';
        if (!doc.exists || value.officeId !== data.officeId || value.status !== 'pending' || recordPeriod !== data.periodKey) throw new ForbiddenError(`Commission ${doc.id} is not pending for this office and period`);
        return { grossFareIls: Number(value.grossFareIls ?? 0), commissionIls: Number(value.commissionIls ?? 0) };
      });
      const invoiceAmounts = invoices.map((doc) => {
        const value = doc.data() ?? {};
        if (!doc.exists || value.targetType !== 'office' || value.targetId !== data.officeId || value.periodKey !== data.periodKey || !['pending', 'past_due', 'suspended'].includes(String(value.status ?? ''))) throw new ForbiddenError(`Invoice ${doc.id} is not payable for this office and period`);
        return Number(value.amountIls ?? 0);
      });
      const amounts = calculateOfficeStatement(commissionInputs, invoiceAmounts);
      transaction.set(statementRef, {
        statementId, officeId: data.officeId, periodKey: data.periodKey,
        commissionRecordIds: recordRefs.map((ref) => ref.id), subscriptionInvoiceIds: invoiceRefs.map((ref) => ref.id),
        ...amounts, currency: 'ILS', status: 'pending', createdBy: managerId,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      recordRefs.forEach((ref) => transaction.update(ref, { status: 'processing', officeStatementId: statementId, updatedAt: FieldValue.serverTimestamp() }));
      return { success: true as const, statementId, alreadyExists: false, ...amounts };
    });
  } catch (error) { throw handleError(error); }
});

export const managerMarkOfficeStatementPaid = onCall({ region: REGION }, async (request) => {
  try {
    const managerId = getAuthenticatedUserId(request);
    if (!managerId) throw new UnauthorizedError('Authentication required');
    await requireGlobalManager(managerId);
    const parsed = PaySchema.safeParse(request.data);
    if (!parsed.success) throw new ValidationError('Invalid office statement payment', parsed.error.flatten());
    const db = getFirestore();
    const statementRef = db.collection('officeBillingStatements').doc(parsed.data.statementId);
    await db.runTransaction(async (transaction) => {
      const statement = await transaction.get(statementRef);
      if (!statement.exists) throw new NotFoundError('Office statement', parsed.data.statementId);
      const data = statement.data() ?? {};
      if (data.status === 'paid') return;
      if (data.status !== 'pending') throw new ForbiddenError('Only pending statements can be paid');
      const recordIds = Array.isArray(data.commissionRecordIds) ? data.commissionRecordIds.filter((id): id is string => typeof id === 'string') : [];
      const invoiceIds = Array.isArray(data.subscriptionInvoiceIds) ? data.subscriptionInvoiceIds.filter((id): id is string => typeof id === 'string') : [];
      const officeId = typeof data.officeId === 'string' ? data.officeId : '';
      const subscriptionRef = db.collection('subscriptions').doc(`office_${officeId}`);
      const [subscription, officeInvoices] = await Promise.all([
        transaction.get(subscriptionRef),
        transaction.get(db.collection('subscriptionInvoices').where('subscriptionId', '==', subscriptionRef.id)),
      ]);
      const included = new Set(invoiceIds);
      const otherStatuses = officeInvoices.docs.filter((doc) => !included.has(doc.id)).map((doc) => String(doc.data().status ?? ''));
      const reactivate = subscription.exists && shouldReactivateSubscription(String(subscription.data()?.status ?? ''), otherStatuses);
      transaction.update(statementRef, { status: 'paid', paymentReference: parsed.data.paymentReference, paidBy: managerId, paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      recordIds.forEach((id) => transaction.update(db.collection('commissionRecords').doc(id), { status: 'settled', settledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
      invoiceIds.forEach((id) => transaction.update(db.collection('subscriptionInvoices').doc(id), { status: 'paid', paymentMethod: 'bank_transfer', paymentReference: parsed.data.paymentReference, paidBy: managerId, paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
      if (reactivate) {
        transaction.update(subscriptionRef, { status: 'active', reactivatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        transaction.set(db.collection('offices').doc(officeId), { subscriptionStatus: 'active', subscriptionUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });
    return { success: true as const, statementId: parsed.data.statementId };
  } catch (error) { throw handleError(error); }
});
