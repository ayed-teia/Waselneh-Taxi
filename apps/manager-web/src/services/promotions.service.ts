import { Timestamp, collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { getFirestoreDb, getFunctionsInstance } from './firebase';

export interface Promotion {
  code: string;
  nameAr: string;
  nameEn: string;
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  maxDiscountIls: number | null;
  minFareIls: number;
  usageLimit: number | null;
  usageCount: number;
  perPassengerLimit: number;
  startsAt: Timestamp | null;
  expiresAt: Timestamp | null;
  active: boolean;
}

export function subscribeToPromotions(onData: (items: Promotion[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(collection(getFirestoreDb(), 'promoCodes'), orderBy('code')), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ code: item.id, ...item.data() }) as Promotion));
  }, onError);
}

export async function savePromotion(input: Record<string, unknown>) {
  await httpsCallable(getFunctionsInstance(), 'managerUpsertPromotion')(input);
}
