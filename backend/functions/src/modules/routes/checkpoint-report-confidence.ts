import { distanceToRouteSegmentKm } from './route-proximity';

export interface CheckpointReportPoint {
  driverId: string;
  lat: number;
  lng: number;
  status: 'closed' | 'congested' | 'open';
}

export interface CheckpointConfidence {
  corroboratingDrivers: number;
  confidence: number;
}

export function calculateCheckpointConfidence(
  report: CheckpointReportPoint,
  recentReports: CheckpointReportPoint[],
  matchRadiusKm = 1
): CheckpointConfidence {
  const drivers = new Set<string>();
  for (const candidate of recentReports) {
    if (candidate.status !== report.status) continue;
    const distance = distanceToRouteSegmentKm(
      { lat: candidate.lat, lng: candidate.lng },
      { lat: report.lat, lng: report.lng },
      { lat: report.lat, lng: report.lng }
    );
    if (distance <= matchRadiusKm) drivers.add(candidate.driverId);
  }
  drivers.add(report.driverId);
  return {
    corroboratingDrivers: drivers.size,
    confidence: Math.min(0.95, Math.round((0.25 + drivers.size * 0.2) * 100) / 100),
  };
}
