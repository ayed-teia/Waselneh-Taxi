import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
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

export async function saveSubscriptionPlan(input: Omit<SubscriptionPlan, 'id'> & { planId?: string }) {
  const callable = httpsCallable(getFunctionsInstance(), 'managerUpsertSubscriptionPlan');
  await callable(input);
}

export async function assignSubscription(input: Omit<SubscriptionAssignment, 'id'> & { startsAt: string; endsAt?: string | null }) {
  const callable = httpsCallable(getFunctionsInstance(), 'managerAssignSubscription');
  await callable(input);
}
