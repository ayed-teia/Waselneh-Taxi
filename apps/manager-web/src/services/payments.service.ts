import { collection, onSnapshot, Timestamp, query, orderBy, limit } from 'firebase/firestore';

import { getFirestoreDb } from './firebase';

/**
 * ============================================================================
 * PAYMENTS REALTIME SERVICE
 * ============================================================================
 * 
 * Subscribes to realtime updates from the payments collection.
 * 
 * FIRESTORE COLLECTION: payments/{paymentId}
 * 
 * ============================================================================
 */

/**
 * Payment document structure
 */
export interface PaymentDocument {
  paymentId: string;
  tripId: string;
  passengerId: string;
  driverId: string;
  amount: number;
  currency: string;
  method: 'cash' | 'card' | 'wallet';
  status: 'pending' | 'paid' | 'failed';
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/**
 * Subscribe to realtime payment updates
 * 
 * @param callback - Function called whenever payments data changes
 * @param limitCount - Maximum number of payments to return (default: 100)
 * @returns Unsubscribe function
 */
export function subscribeToPayments(
  callback: (payments: PaymentDocument[]) => void,
  limitCount: number = 100
): () => void {
  const db = getFirestoreDb();
  const paymentsRef = collection(db, 'payments');

  // Order by createdAt descending, limit results
  const q = query(
    paymentsRef,
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );

  console.log('🎧 [Payments] Starting realtime subscription...');

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const payments: PaymentDocument[] = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        payments.push({
          paymentId: doc.id,
          tripId: data.tripId || '',
          passengerId: data.passengerId || '',
          driverId: data.driverId || '',
          amount: data.amount || 0,
          currency: data.currency || 'ILS',
          method: data.method || 'cash',
          status: data.status || 'pending',
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null,
        });
      });

      console.log(`📊 [Payments] Received ${payments.length} payments`);
      callback(payments);
    },
    (error) => {
      console.error('❌ [Payments] Subscription error:', error);
    }
  );

  return unsubscribe;
}
