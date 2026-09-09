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
  paidAt?: Timestamp;
  paymentReference?: string;
  paymentMethod?: 'cash' | 'bank_transfer' | 'card' | 'other';
}

export function subscribeToPlans(callback: (items: SubscriptionPlan[]) => void): () => void {
  return onSnapshot(query(collection(getFirestoreDb(), 'subscriptionPlans'), orderBy('nameEn')), (snapshot) =>
    callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as SubscriptionPlan)))
  );
}

export function subscribeToAssignments(callback: (items: SubscriptionAssignment[]) => void): () => void {
  return onSnapshot(collection(getFirestoreDb(), 'subscriptions'), (snapshot) =>
    callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as SubscriptionAssignment)))
  );
}

export function subscribeToSubscriptionInvoices(callback: (items: SubscriptionInvoice[]) => void): () => void {
  return onSnapshot(query(collection(getFirestoreDb(), 'subscriptionInvoices'), orderBy('createdAt', 'desc')), (snapshot) =>
    callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as SubscriptionInvoice)))
  );
}

export async function saveSubscriptionPlan(input: Omit<SubscriptionPlan, 'id'> & { planId?: string }) {
  const callable = httpsCallable(getFunctionsInstance(), 'managerUpsertSubscriptionPlan');
  await callable(input);
}

export async function assignSubscription(input: Omit<SubscriptionAssignment, 'id'> & { startsAt: string; endsAt?: string | null }) {
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
