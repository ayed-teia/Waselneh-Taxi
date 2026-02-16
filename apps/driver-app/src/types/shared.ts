/**
 * Local shared types for EAS build compatibility
 * These are copies of types from @taxi-line/shared to avoid workspace:* dependency issues
 */

// LatLng type
export interface LatLng {
  lat: number;
  lng: number;
}

export interface LatLngLiteral {
  latitude: number;
  longitude: number;
}

export function toLatLng(literal: LatLngLiteral): LatLng {
  return { lat: literal.latitude, lng: literal.longitude };
}

export function toLatLngLiteral(latLng: LatLng): LatLngLiteral {
  return { latitude: latLng.lat, longitude: latLng.lng };
}

// TripStatus enum
export const TripStatus = {
  PENDING: 'pending',
  DRIVER_ASSIGNED: 'driver_assigned',
  ACCEPTED: 'accepted',
  DRIVER_ARRIVED: 'driver_arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  RATED: 'rated',
  CANCELLED_BY_PASSENGER: 'cancelled_by_passenger',
  CANCELLED_BY_DRIVER: 'cancelled_by_driver',
  CANCELLED_BY_SYSTEM: 'cancelled_by_system',
  NO_DRIVER_AVAILABLE: 'no_driver_available',
} as const;

export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

export const ACTIVE_TRIP_STATUSES: TripStatus[] = [
  TripStatus.PENDING,
  TripStatus.DRIVER_ASSIGNED,
  TripStatus.ACCEPTED,
  TripStatus.DRIVER_ARRIVED,
  TripStatus.IN_PROGRESS,
];

export const TERMINAL_TRIP_STATUSES: TripStatus[] = [
  TripStatus.COMPLETED,
  TripStatus.RATED,
  TripStatus.CANCELLED_BY_PASSENGER,
  TripStatus.CANCELLED_BY_DRIVER,
  TripStatus.CANCELLED_BY_SYSTEM,
  TripStatus.NO_DRIVER_AVAILABLE,
];
