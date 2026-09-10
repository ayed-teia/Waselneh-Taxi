import { firebaseDB, Unsubscribe } from '../firebase';

export interface LoyaltyEntry {
  id: string;
  type: 'trip_completed' | 'trip_discount_redeemed' | 'trip_discount_restored';
  points: number;
  discountIls: number | null;
  createdAt: Date | null;
}

export function subscribeToLoyaltyWallet(
  passengerId: string,
  onBalance: (points: number, tripsCompleted: number) => void,
  onEntries: (entries: LoyaltyEntry[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  const unsubscribeUser = firebaseDB.collection('users').doc(passengerId).onSnapshot((snapshot) => {
    const data = snapshot.data();
    onBalance(Math.max(0, Number(data?.loyaltyPoints ?? 0)), Math.max(0, Number(data?.loyaltyTripsCompleted ?? 0)));
  }, onError);
  const unsubscribeLedger = firebaseDB.collection('users').doc(passengerId).collection('loyaltyLedger')
    .orderBy('createdAt', 'desc').limit(20).onSnapshot((snapshot) => {
      onEntries(snapshot.docs.map((document) => {
        const data = document.data();
        const rawType = String(data.type ?? 'trip_completed') as LoyaltyEntry['type'];
        return {
          id: document.id,
          type: rawType,
          points: Number(data.points ?? 0),
          discountIls: typeof data.discountIls === 'number' ? data.discountIls : null,
          createdAt: data.createdAt?.toDate?.() ?? null,
        };
      }));
    }, onError);
  return () => { unsubscribeUser(); unsubscribeLedger(); };
}
