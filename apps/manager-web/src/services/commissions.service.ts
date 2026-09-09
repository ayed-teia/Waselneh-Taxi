import { collection, limit, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';

import { getFirestoreDb } from './firebase';

export interface CommissionRecord {
  id: string;
  tripId: string;
  driverId: string;
  officeId: string | null;
  grossFareIls: number;
  commissionBps: number;
  commissionIls: number;
  driverNetIls: number;
  status: 'pending' | 'settled';
  createdAt: Timestamp | null;
}

export function subscribeToCommissions(callback: (records: CommissionRecord[]) => void): () => void {
  const recordsQuery = query(collection(getFirestoreDb(), 'commissionRecords'), orderBy('createdAt', 'desc'), limit(500));
  return onSnapshot(recordsQuery, (snapshot) => callback(snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      tripId: String(data.tripId ?? item.id),
      driverId: String(data.driverId ?? ''),
      officeId: typeof data.officeId === 'string' ? data.officeId : null,
      grossFareIls: Number(data.grossFareIls ?? 0),
      commissionBps: Number(data.commissionBps ?? 0),
      commissionIls: Number(data.commissionIls ?? 0),
      driverNetIls: Number(data.driverNetIls ?? 0),
      status: data.status === 'settled' ? 'settled' : 'pending',
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
    };
  })));
}
