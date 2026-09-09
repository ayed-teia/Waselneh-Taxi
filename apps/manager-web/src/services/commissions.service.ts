import { collection, limit, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { getFirestoreDb, getFunctionsInstance } from './firebase';

export interface CommissionRecord {
  id: string;
  tripId: string;
  driverId: string;
  officeId: string | null;
  grossFareIls: number;
  commissionBps: number;
  commissionIls: number;
  driverNetIls: number;
  status: 'pending' | 'processing' | 'settled';
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
      status: data.status === 'settled' || data.status === 'processing' ? data.status : 'pending',
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
    };
  })));
}

export interface CommissionSettlement {
  id: string;
  targetId: string;
  periodKey: string;
  payableIls: number;
  status: 'pending' | 'paid';
}

export function subscribeToSettlements(callback: (items: CommissionSettlement[]) => void): () => void {
  return onSnapshot(collection(getFirestoreDb(), 'commissionSettlements'), (snapshot) =>
    callback(snapshot.docs.map((doc) => {
      const data = doc.data();
      return { id: doc.id, targetId: String(data.targetId ?? ''), periodKey: String(data.periodKey ?? ''), payableIls: Number(data.payableIls ?? 0), status: data.status === 'paid' ? 'paid' : 'pending' };
    }))
  );
}

export async function createDriverSettlement(driverId: string, periodKey: string, recordIds: string[]) {
  const callable = httpsCallable(getFunctionsInstance(), 'managerCreateCommissionSettlement');
  await callable({ targetType: 'driver', targetId: driverId, periodKey, commissionRecordIds: recordIds, includeRecurringFee: true });
}

export async function markSettlementPaid(settlementId: string, paymentReference: string) {
  const callable = httpsCallable(getFunctionsInstance(), 'managerMarkCommissionSettlementPaid');
  await callable({ settlementId, paymentReference });
}
