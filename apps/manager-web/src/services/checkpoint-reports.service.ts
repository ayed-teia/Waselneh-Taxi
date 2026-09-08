import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { getFirestoreDb, getFunctionsInstance } from './firebase';

export interface CheckpointReportData {
  id: string;
  driverId: string;
  lat: number;
  lng: number;
  status: 'closed' | 'congested' | 'open';
  note?: string;
  confidence: number;
  corroboratingDrivers: number;
  createdAt: Date | null;
}

export function subscribeToPendingCheckpointReports(
  onData: (reports: CheckpointReportData[]) => void,
  onError: (error: Error) => void
) {
  return onSnapshot(
    query(collection(getFirestoreDb(), 'checkpointReports'), where('moderationStatus', '==', 'pending')),
    (snapshot) => onData(snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        driverId: String(data.driverId ?? ''),
        lat: Number(data.lat ?? 0),
        lng: Number(data.lng ?? 0),
        status: data.status === 'open' || data.status === 'congested' ? data.status : 'closed',
        note: typeof data.note === 'string' ? data.note : undefined,
        confidence: Number(data.confidence ?? 0),
        corroboratingDrivers: Number(data.corroboratingDrivers ?? 1),
        createdAt: data.createdAt?.toDate() ?? null,
      };
    }).sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))),
    onError
  );
}

export async function reviewCheckpointReport(
  reportId: string,
  decision: 'approved' | 'rejected',
  options?: { name?: string; area?: string; radiusMeters?: number; delayMin?: number; surchargeIls?: number }
): Promise<void> {
  const callable = httpsCallable(getFunctionsInstance(), 'managerReviewCheckpointReport');
  await callable({ reportId, decision, ...options });
}
