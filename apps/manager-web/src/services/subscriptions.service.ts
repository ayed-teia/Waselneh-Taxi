import { Timestamp, collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { getFirestoreDb, getFunctionsInstance } from './firebase';

export interface SubscriptionPlan {
  id: string;
  nameAr: string;
  nameEn: string;
  billingModel: 'per_trip' | 'subscription' | 'hybrid';
  commissionBps: number;
  recurringFeeIls: number;
  billingInterval: 'monthly' | 'quarterly' | 'annual';
  isActive: boolean;
}

export interface SubscriptionAssignment {
  id: string;
  targetType: 'driver' | 'office';
  targetId: string;
  planId: string;
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
}

export interface SubscriptionInvoice {
  id: string;
  subscriptionId: string;
  targetType: 'driver' | 'office';
  targetId: string;
  periodKey: string;
  amountIls: number;
  currency: 'ILS';
  status: 'pending' | 'past_due' | 'suspended' | 'paid' | 'void';
  dueAt?: Timestamp;
  createdAt?: Timestamp;
  paidAt?: Timestamp;
  paymentReference?: string;
  paymentMethod?: 'cash' | 'bank_transfer' | 'card' | 'other';
}

function safeCsvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildSubscriptionInvoicesCsv(invoices: SubscriptionInvoice[]): string {
  const header = [
    'invoice_id',
    'period',
    'target_type',
    'target_id',
    'amount_ils',
    'status',
    'due_at',
    'paid_at',
    'payment_method',
    'payment_reference',
  ];
  const rows = invoices.map((invoice) =>
    [
      invoice.id,
      invoice.periodKey,
      invoice.targetType,
      invoice.targetId,
      invoice.amountIls.toFixed(2),
      invoice.status,
      invoice.dueAt?.toDate().toISOString() ?? '',
      invoice.paidAt?.toDate().toISOString() ?? '',
      invoice.paymentMethod ?? '',
      invoice.paymentReference ?? '',
    ]
      .map(safeCsvCell)
      .join(',')
  );
  return `\uFEFF${header.map(safeCsvCell).join(',')}\n${rows.join('\n')}`;
}

export function subscribeToPlans(callback: (items: SubscriptionPlan[]) => void): () => void {
  return onSnapshot(
    query(collection(getFirestoreDb(), 'subscriptionPlans'), orderBy('nameEn')),
    (snapshot) =>
      callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SubscriptionPlan))
  );
}

export function subscribeToAssignments(
  callback: (items: SubscriptionAssignment[]) => void
): () => void {
  return onSnapshot(collection(getFirestoreDb(), 'subscriptions'), (snapshot) =>
    callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SubscriptionAssignment))
  );
}

export function subscribeToSubscriptionInvoices(
  callback: (items: SubscriptionInvoice[]) => void
): () => void {
  return onSnapshot(
    query(collection(getFirestoreDb(), 'subscriptionInvoices'), orderBy('createdAt', 'desc')),
    (snapshot) =>
      callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as SubscriptionInvoice))
  );
}

export async function saveSubscriptionPlan(
  input: Omit<SubscriptionPlan, 'id'> & { planId?: string }
) {
  const callable = httpsCallable(getFunctionsInstance(), 'managerUpsertSubscriptionPlan');
  await callable(input);
}

export async function assignSubscription(
  input: Omit<SubscriptionAssignment, 'id'> & { startsAt: string; endsAt?: string | null }
) {
  const callable = httpsCallable(getFunctionsInstance(), 'managerAssignSubscription');
  await callable(input);
}

export async function markSubscriptionInvoicePaid(input: {
  invoiceId: string;
  paymentReference: string;
  paymentMethod: 'cash' | 'bank_transfer' | 'card' | 'other';
}) {
  const callable = httpsCallable(getFunctionsInstance(), 'managerMarkSubscriptionInvoicePaid');
  await callable(input);
}
