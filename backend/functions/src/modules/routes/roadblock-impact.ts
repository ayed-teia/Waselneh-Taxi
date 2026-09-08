import { LatLng } from '@taxi-line/shared';
import { getFirestore } from '../../core/config';
import { distanceToRouteSegmentKm } from './route-proximity';

export interface RoadblockImpactItem {
  id: string;
  name: string;
  status: 'closed' | 'congested';
  delayMin: number;
  surchargeIls: number;
  distanceToRouteKm: number;
}

export interface RoadblockImpact {
  affected: boolean;
  hasClosure: boolean;
  delayMin: number;
  surchargeIls: number;
  items: RoadblockImpactItem[];
}

export interface RoadblockCandidate extends Record<string, unknown> {
  id: string;
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function assessRoadblockImpact(
  pickup: LatLng,
  dropoff: LatLng,
  candidates: RoadblockCandidate[]
): RoadblockImpact {
  const items: RoadblockImpactItem[] = [];

  for (const data of candidates) {
    const lat = safeNumber(data.lat, Number.NaN);
    const lng = typeof data.lng === 'number' && Number.isFinite(data.lng) ? data.lng : Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const radiusKm = Math.max(0.05, safeNumber(data.radiusMeters, 100) / 1000);
    const distance = distanceToRouteSegmentKm({ lat, lng }, pickup, dropoff);
    if (distance > radiusKm) continue;
    const status = data.status === 'closed' ? 'closed' : 'congested';
    items.push({
      id: data.id,
      name: typeof data.name === 'string' ? data.name : 'Road checkpoint',
      status,
      delayMin: safeNumber(data.delayMin, status === 'closed' ? 20 : 10),
      surchargeIls: safeNumber(data.surchargeIls),
      distanceToRouteKm: Math.round(distance * 10) / 10,
    });
  }

  return {
    affected: items.length > 0,
    hasClosure: items.some((item) => item.status === 'closed'),
    delayMin: Math.round(items.reduce((sum, item) => sum + item.delayMin, 0) * 10) / 10,
    surchargeIls: Math.ceil(items.reduce((sum, item) => sum + item.surchargeIls, 0)),
    items,
  };
}

export async function calculateRoadblockImpact(
  pickup: LatLng,
  dropoff: LatLng
): Promise<RoadblockImpact> {
  const snapshot = await getFirestore()
    .collection('roadblocks')
    .where('status', 'in', ['closed', 'congested'])
    .limit(100)
    .get();
  return assessRoadblockImpact(
    pickup,
    dropoff,
    snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
  );
}
