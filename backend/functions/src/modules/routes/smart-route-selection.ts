import { LatLng } from '@taxi-line/shared';
import type { RouteAlternative } from '../pricing/services';
import { RoadblockCandidate, RoadblockImpactItem } from './roadblock-impact';
import { distanceToRouteSegmentKm } from './route-proximity';

export interface SmartRouteResult {
  selectedIndex: number;
  blocked: boolean;
  requiresDriverConfirmation: boolean;
  durationMin: number;
  distanceKm: number;
  delayMin: number;
  affectedRoadblocks: RoadblockImpactItem[];
  reason: 'fastest_clear_route' | 'avoids_closed_checkpoint' | 'least_affected_route';
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function distanceToPath(point: LatLng, coordinates: LatLng[]): number {
  let closest = Infinity;
  for (let index = 1; index < coordinates.length; index += 1) {
    closest = Math.min(closest, distanceToRouteSegmentKm(point, coordinates[index - 1]!, coordinates[index]!));
  }
  return closest;
}

export function selectSmartRoute(routes: RouteAlternative[], candidates: RoadblockCandidate[]): SmartRouteResult {
  if (routes.length === 0) throw new Error('At least one route is required');
  const evaluated = routes.map((route, index) => {
    const affected: RoadblockImpactItem[] = [];
    for (const data of candidates) {
      const lat = numberValue(data.lat, Number.NaN);
      const lng = typeof data.lng === 'number' && Number.isFinite(data.lng) ? data.lng : Number.NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const distance = distanceToPath({ lat, lng }, route.coordinates);
      const radiusKm = Math.max(0.05, numberValue(data.radiusMeters, 100) / 1000);
      if (distance > radiusKm) continue;
      const status = data.status === 'closed' ? 'closed' : 'congested';
      affected.push({
        id: data.id,
        name: typeof data.name === 'string' ? data.name : 'Road checkpoint',
        status,
        delayMin: numberValue(data.delayMin, status === 'closed' ? 20 : 10),
        surchargeIls: numberValue(data.surchargeIls),
        distanceToRouteKm: Math.round(distance * 10) / 10,
      });
    }
    const closedCount = affected.filter((item) => item.status === 'closed').length;
    const delayMin = affected.reduce((sum, item) => sum + item.delayMin, 0);
    return { index, route, affected, closedCount, delayMin, score: route.durationMin + delayMin + closedCount * 10_000 };
  });
  const clear = evaluated.filter((item) => item.closedCount === 0);
  const selected = [...(clear.length > 0 ? clear : evaluated)].sort((left, right) => left.score - right.score)[0]!;
  return {
    selectedIndex: selected.index,
    blocked: selected.closedCount > 0,
    requiresDriverConfirmation: clear.length === 0,
    durationMin: Math.round((selected.route.durationMin + selected.delayMin) * 10) / 10,
    distanceKm: Math.round(selected.route.distanceKm * 100) / 100,
    delayMin: Math.round(selected.delayMin * 10) / 10,
    affectedRoadblocks: selected.affected,
    reason: clear.length === 0 ? 'least_affected_route' : selected.index === 0 ? 'fastest_clear_route' : 'avoids_closed_checkpoint',
  };
}
