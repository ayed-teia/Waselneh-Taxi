import { z } from 'zod';

export const TripStatus = {
  /** Trip request created by passenger */
  PENDING: 'pending',
  /** Driver assigned to trip (after matching) */
  DRIVER_ASSIGNED: 'driver_assigned',
  /** Driver accepted the trip */
  ACCEPTED: 'accepted',
  /** Driver arrived at pickup location */
  DRIVER_ARRIVED: 'driver_arrived',
  /** Passenger picked up, trip in progress */
  IN_PROGRESS: 'in_progress',
  /** Trip completed successfully */
  COMPLETED: 'completed',
  /** Trip cancelled by passenger */
  CANCELLED_BY_PASSENGER: 'cancelled_by_passenger',
  /** Trip cancelled by driver */
  CANCELLED_BY_DRIVER: 'cancelled_by_driver',
  /** Trip cancelled by system (timeout, etc.) */
  CANCELLED_BY_SYSTEM: 'cancelled_by_system',
  /** No driver available */
  NO_DRIVER_AVAILABLE: 'no_driver_available',
} as const;

export type TripStatus = (typeof TripStatus)[keyof typeof TripStatus];

export const TripStatusSchema = z.enum([
  'pending',
  'driver_assigned',
  'accepted',
  'driver_arrived',
  'in_progress',
  'completed',
  'cancelled_by_passenger',
  'cancelled_by_driver',
  'cancelled_by_system',
  'no_driver_available',
]);

/** Statuses that indicate the trip is still active */
export const ACTIVE_TRIP_STATUSES: TripStatus[] = [
  TripStatus.PENDING,
  TripStatus.DRIVER_ASSIGNED,
  TripStatus.ACCEPTED,
  TripStatus.DRIVER_ARRIVED,
  TripStatus.IN_PROGRESS,
];

/** Statuses that indicate the trip has ended */
export const TERMINAL_TRIP_STATUSES: TripStatus[] = [
  TripStatus.COMPLETED,
  TripStatus.CANCELLED_BY_PASSENGER,
  TripStatus.CANCELLED_BY_DRIVER,
  TripStatus.CANCELLED_BY_SYSTEM,
  TripStatus.NO_DRIVER_AVAILABLE,
];
