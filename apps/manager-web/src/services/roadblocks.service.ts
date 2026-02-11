import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  Unsubscribe,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  where
} from 'firebase/firestore';
import { getFirestoreDb } from './firebase';

/**
 * Roadblock status constants
 */
const RoadblockStatus = {
  OPEN: 'open',
  CLOSED: 'closed',
  CONGESTED: 'congested',
} as const;

/**
 * Roadblock data for manager dashboard
 */
export interface RoadblockData {
  id: string;
  name: string;
  area?: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  status: 'open' | 'closed' | 'congested';
  note?: string;
  updatedAt: Date | null;
  createdAt: Date | null;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Subscribe to all roadblocks (real-time)
 */
export function subscribeToRoadblocks(
  onData: (roadblocks: RoadblockData[]) => void,
  onError: (error: Error) => void,
  options?: { activeOnly?: boolean }
): Unsubscribe {
  const db = getFirestoreDb();
  const roadblocksRef = collection(db, 'roadblocks');
  
  // If activeOnly, exclude 'open' status (cleared roadblocks)
  let q;
  if (options?.activeOnly) {
    q = query(
      roadblocksRef,
      where('status', 'in', ['closed', 'congested']),
      orderBy('updatedAt', 'desc')
    );
  } else {
    q = query(
      roadblocksRef,
      orderBy('updatedAt', 'desc')
    );
  }

  return onSnapshot(
    q,
    (snapshot) => {
      const roadblocks: RoadblockData[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          name: data.name ?? 'Unnamed',
          area: data.area,
          lat: data.lat,
          lng: data.lng,
          radiusMeters: data.radiusMeters ?? 100,
          status: data.status ?? 'closed',
          note: data.note,
          updatedAt: data.updatedAt?.toDate() ?? null,
          createdAt: data.createdAt?.toDate() ?? null,
          createdBy: data.createdBy,
          updatedBy: data.updatedBy,
        };
      });
      onData(roadblocks);
    },
    onError
  );
}

/**
 * Create a new roadblock
 */
export async function createRoadblock(data: {
  name: string;
  area?: string;
  lat: number;
  lng: number;
  radiusMeters?: number;
  status?: 'open' | 'closed' | 'congested';
  note?: string;
  createdBy?: string;
}): Promise<string> {
  const db = getFirestoreDb();
  const roadblocksRef = collection(db, 'roadblocks');
  
  const docRef = await addDoc(roadblocksRef, {
    name: data.name,
    area: data.area ?? '',
    lat: data.lat,
    lng: data.lng,
    radiusMeters: data.radiusMeters ?? 100,
    status: data.status ?? 'closed',
    note: data.note ?? '',
    createdBy: data.createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  
  console.log('🚧 [Roadblocks] Created:', docRef.id);
  return docRef.id;
}

/**
 * Update a roadblock
 */
export async function updateRoadblock(
  id: string,
  data: Partial<{
    name: string;
    area: string;
    lat: number;
    lng: number;
    radiusMeters: number;
    status: 'open' | 'closed' | 'congested';
    note: string;
    updatedBy: string;
  }>
): Promise<void> {
  const db = getFirestoreDb();
  const roadblockRef = doc(db, 'roadblocks', id);
  
  await updateDoc(roadblockRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
  
  console.log('🚧 Roadblock status updated:', id, data);
}

/**
 * Delete a roadblock
 */
export async function deleteRoadblock(id: string): Promise<void> {
  const db = getFirestoreDb();
  const roadblockRef = doc(db, 'roadblocks', id);
  
  await deleteDoc(roadblockRef);
  
  console.log('🚧 [Roadblocks] Deleted:', id);
}

/**
 * Get display info for roadblock status
 */
export function getRoadblockStatusDisplay(status: string): { 
  label: string; 
  color: string; 
  emoji: string;
  bgColor: string;
} {
  switch (status) {
    case RoadblockStatus.OPEN:
      return { label: 'Open', color: '#10b981', emoji: '✅', bgColor: 'rgba(16, 185, 129, 0.1)' };
    case RoadblockStatus.CLOSED:
      return { label: 'Closed', color: '#ef4444', emoji: '🚫', bgColor: 'rgba(239, 68, 68, 0.1)' };
    case RoadblockStatus.CONGESTED:
      return { label: 'Congested', color: '#f59e0b', emoji: '⚠️', bgColor: 'rgba(245, 158, 11, 0.1)' };
    default:
      return { label: status, color: '#6b7280', emoji: '❓', bgColor: 'rgba(107, 114, 128, 0.1)' };
  }
}
