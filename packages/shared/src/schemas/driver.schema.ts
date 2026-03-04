import { z } from 'zod';
import { VEHICLE_MAX_CAPACITY, VEHICLE_TYPE_VALUES } from '../config/vehicle.config';

/**
 * ============================================================================
 * DRIVER AVAILABILITY SCHEMA
 * ============================================================================
 * 
 * Firestore Collection: drivers/{driverId}
 * 
 * This document tracks driver availability for trip dispatch:
 * - isOnline: Driver has toggled their status to online
 * - isAvailable: Driver can receive new trip requests (online + not on a trip)
 * - lastLocation: Last known location as GeoPoint
 * - updatedAt: Timestamp of last update
 * 
 * LIFECYCLE:
 * 1. Driver goes Online → isOnline=true, isAvailable=true
 * 2. Driver accepts trip → isAvailable=false
 * 3. Driver completes trip → isAvailable=true
 * 4. Driver goes Offline → isOnline=false, isAvailable=false
 * 
 * ============================================================================
 */

/**
 * Driver availability document schema
 */
export const DriverSchema = z.object({
  /** Driver's auth UID */
  driverId: z.string(),
  
  /** Is driver currently online (toggled by driver) */
  isOnline: z.boolean(),
  
  /** Is driver available for new trips (online and not on a trip) */
  isAvailable: z.boolean(),

  /** Licensed office binding used for dispatch scopes */
  officeId: z.string().nullable().optional(),

  /** Licensed line binding used for dispatch scopes */
  lineId: z.string().nullable().optional(),

  /** License binding (at least one of line/license should exist for eligibility) */
  licenseId: z.string().nullable().optional(),

  /** Assigned operation vehicle id */
  vehicleId: z.string().nullable().optional(),

  /** Vehicle category used for dispatch matching */
  vehicleType: z.enum(VEHICLE_TYPE_VALUES as [string, ...string[]]).nullable().optional(),

  /** Available passenger seats for this vehicle */
  seatCapacity: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY).nullable().optional(),
  
  /** Last known location as GeoPoint { latitude, longitude } */
  lastLocation: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }).nullable().optional(),
  
  /** When driver went online (if online) */
  onlineSince: z.date().nullable().optional(),
  
  /** When driver went offline (if offline) */
  offlineSince: z.date().nullable().optional(),
  
  /** Current trip ID if on a trip */
  currentTripId: z.string().nullable().optional(),
  
  /** Timestamp of last update */
  updatedAt: z.date(),
});

export type Driver = z.infer<typeof DriverSchema>;

/**
 * Driver availability status (computed from isOnline + isAvailable)
 */
export const DriverAvailabilityStatus = {
  /** Driver is offline */
  OFFLINE: 'offline',
  /** Driver is online and available for trips */
  AVAILABLE: 'available',
  /** Driver is online but on a trip */
  BUSY: 'busy',
} as const;

export type DriverAvailabilityStatus = typeof DriverAvailabilityStatus[keyof typeof DriverAvailabilityStatus];

/**
 * Get driver availability status from flags
 */
export function getDriverAvailabilityStatus(isOnline: boolean, isAvailable: boolean): DriverAvailabilityStatus {
  if (!isOnline) return DriverAvailabilityStatus.OFFLINE;
  if (isAvailable) return DriverAvailabilityStatus.AVAILABLE;
  return DriverAvailabilityStatus.BUSY;
}
