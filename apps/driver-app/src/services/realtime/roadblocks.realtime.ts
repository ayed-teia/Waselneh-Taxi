import { firebaseDB, Unsubscribe } from '../firebase';

/**
 * Roadblock data from Firestore
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
}

/**
 * Subscribe to active roadblocks (closed and congested only)
 */
export function subscribeToActiveRoadblocks(
  onData: (roadblocks: RoadblockData[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('roadblocks')
    .where('status', 'in', ['closed', 'congested'])
    .onSnapshot(
      (snapshot) => {
        const roadblocks: RoadblockData[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: data?.name ?? 'Unnamed',
            area: data?.area,
            lat: data?.lat,
            lng: data?.lng,
            radiusMeters: data?.radiusMeters ?? 100,
            status: data?.status ?? 'closed',
            note: data?.note,
            updatedAt: data?.updatedAt?.toDate() ?? null,
          };
        });
        roadblocks.sort(
          (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0)
        );
        onData(roadblocks);
      },
      onError
    );
}

/**
 * Subscribe to ALL roadblocks (for list view)
 */
export function subscribeToAllRoadblocks(
  onData: (roadblocks: RoadblockData[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return firebaseDB
    .collection('roadblocks')
    .orderBy('updatedAt', 'desc')
    .onSnapshot(
      (snapshot) => {
        const roadblocks: RoadblockData[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: data?.name ?? 'Unnamed',
            area: data?.area,
            lat: data?.lat,
            lng: data?.lng,
            radiusMeters: data?.radiusMeters ?? 100,
            status: data?.status ?? 'closed',
            note: data?.note,
            updatedAt: data?.updatedAt?.toDate() ?? null,
          };
        });
        onData(roadblocks);
      },
      onError
    );
}

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in meters
 */
function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Check if a point is within a roadblock's radius
 */
export function isPointInRoadblock(
  pointLat: number,
  pointLng: number,
  roadblock: RoadblockData
): boolean {
  const distance = haversineDistanceMeters(
    pointLat,
    pointLng,
    roadblock.lat,
    roadblock.lng
  );
  return distance <= roadblock.radiusMeters;
}

/**
 * Check if a route (from pickup to dropoff) intersects any closed roadblocks
 * Uses simplified line-circle intersection by checking points along the route
 */
export function checkRouteIntersectsRoadblocks(
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
  roadblocks: RoadblockData[]
): RoadblockData[] {
  const intersectingRoadblocks: RoadblockData[] = [];

  // Only check closed roadblocks
  const closedRoadblocks = roadblocks.filter(r => r.status === 'closed');

  for (const roadblock of closedRoadblocks) {
    // Check pickup point
    if (isPointInRoadblock(pickup.lat, pickup.lng, roadblock)) {
      intersectingRoadblocks.push(roadblock);
      continue;
    }

    // Check dropoff point
    if (isPointInRoadblock(dropoff.lat, dropoff.lng, roadblock)) {
      intersectingRoadblocks.push(roadblock);
      continue;
    }

    // Check intermediate points along the route (10 points)
    const steps = 10;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const lat = pickup.lat + (dropoff.lat - pickup.lat) * t;
      const lng = pickup.lng + (dropoff.lng - pickup.lng) * t;

      if (isPointInRoadblock(lat, lng, roadblock)) {
        intersectingRoadblocks.push(roadblock);
        break;
      }
    }
  }

  return intersectingRoadblocks;
}

/**
 * Get roadblock status display info
 */
export function getRoadblockStatusDisplay(status: string): {
  label: string;
  color: string;
  emoji: string;
  bgColor: string;
} {
  switch (status) {
    case 'open':
      return { label: 'Open', color: '#34C759', emoji: '✅', bgColor: '#E8F8ED' };
    case 'closed':
      return { label: 'Closed', color: '#FF3B30', emoji: '🚫', bgColor: '#FFE5E5' };
    case 'congested':
      return { label: 'Congested', color: '#FF9500', emoji: '⚠️', bgColor: '#FFF4E5' };
    default:
      return { label: status, color: '#8E8E93', emoji: '❓', bgColor: '#F2F2F7' };
  }
}
