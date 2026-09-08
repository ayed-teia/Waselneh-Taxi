export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceToRouteSegmentKm(
  point: GeoPoint,
  origin: GeoPoint,
  destination: GeoPoint
): number {
  const referenceLatitude = radians((origin.lat + destination.lat + point.lat) / 3);
  const project = (value: GeoPoint) => ({
    x: EARTH_RADIUS_KM * radians(value.lng) * Math.cos(referenceLatitude),
    y: EARTH_RADIUS_KM * radians(value.lat),
  });
  const p = project(point);
  const a = project(origin);
  const b = project(destination);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const ratio = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const nearestX = a.x + ratio * dx;
  const nearestY = a.y + ratio * dy;
  return Math.hypot(p.x - nearestX, p.y - nearestY);
}

export function readGeoPoint(value: unknown): GeoPoint | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { lat?: unknown; lng?: unknown };
  return typeof candidate.lat === 'number' && Number.isFinite(candidate.lat) &&
    typeof candidate.lng === 'number' && Number.isFinite(candidate.lng)
    ? { lat: candidate.lat, lng: candidate.lng }
    : null;
}
