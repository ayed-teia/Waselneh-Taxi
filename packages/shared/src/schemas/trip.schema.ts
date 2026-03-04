import { z } from 'zod';
import { PaymentMethod, PaymentStatus } from '../enums/payment-status.enum';
import { VEHICLE_MAX_CAPACITY, VEHICLE_TYPE_VALUES } from '../config/vehicle.config';

/**
 * ============================================================================
 * TRIP SCHEMA
 * ============================================================================
 * 
 * Firestore Collection: trips/{tripId}
 * 
 * This document represents a taxi trip from request to completion.
 * 
 * Note: TripStatus is defined in ../enums/trip-status.enum.ts
 * Note: PaymentMethod and PaymentStatus are defined in ../enums/payment-status.enum.ts
 * 
 * ============================================================================
 */

// Importing from enums - re-exported for backward compatibility
// (PaymentMethod and PaymentStatus are now in payment-status.enum.ts)

/**
 * Trip payment schema
 */
export const TripPaymentSchema = z.object({
  /** Payment method (default: cash) */
  paymentMethod: z.enum(['cash']).default('cash'),
  
  /** Fare amount in ILS */
  fareAmount: z.number().nonnegative(),
  
  /** Payment status */
  paymentStatus: z.enum(['pending', 'paid']).default('pending'),
  
  /** Timestamp when payment was collected */
  paidAt: z.date().nullable().optional(),
});

export type TripPayment = z.infer<typeof TripPaymentSchema>;

/**
 * Location point schema
 */
export const LocationPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export type LocationPoint = z.infer<typeof LocationPointSchema>;

/**
 * Full trip document schema
 */
export const TripSchema = z.object({
  /** Unique trip ID */
  tripId: z.string(),
  
  /** Passenger's auth UID */
  passengerId: z.string(),
  
  /** Assigned driver's auth UID */
  driverId: z.string(),
  
  /** Current trip status */
  status: z.enum([
    'pending',
    'accepted',
    'driver_arrived',
    'in_progress',
    'completed',
    'cancelled',
    'no_driver_available',
  ]),
  
  /** Pickup location */
  pickup: LocationPointSchema,
  
  /** Dropoff location */
  dropoff: LocationPointSchema,
  
  /** Estimated distance in kilometers */
  estimatedDistanceKm: z.number().nonnegative(),
  
  /** Estimated duration in minutes */
  estimatedDurationMin: z.number().nonnegative(),
  
  /** Estimated price in ILS */
  estimatedPriceIls: z.number().nonnegative(),

  /** Passenger requested seats for this ride */
  requiredSeats: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY).optional(),

  /** Requested vehicle type preference (optional) */
  requestedVehicleType: z.enum(VEHICLE_TYPE_VALUES as [string, ...string[]]).nullable().optional(),

  /** Requested office scope for dispatch */
  requestedOfficeId: z.string().nullable().optional(),

  /** Requested line scope for dispatch */
  requestedLineId: z.string().nullable().optional(),

  /** Vehicle type selected during dispatch */
  matchedVehicleType: z.enum(VEHICLE_TYPE_VALUES as [string, ...string[]]).nullable().optional(),

  /** Seat capacity on matched driver vehicle */
  matchedSeatCapacity: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY).optional(),

  /** Matched driver's office scope */
  matchedOfficeId: z.string().nullable().optional(),

  /** Matched driver's line scope */
  matchedLineId: z.string().nullable().optional(),
  
  // ========================
  // PAYMENT FIELDS
  // ========================
  
  /** Payment method (default: cash) */
  paymentMethod: z.enum(['cash']).default('cash'),
  
  /** Final fare amount in ILS (may differ from estimate) */
  fareAmount: z.number().nonnegative(),
  
  /** Payment status */
  paymentStatus: z.enum(['pending', 'paid']).default('pending'),
  
  /** Timestamp when payment was collected */
  paidAt: z.date().nullable().optional(),
  
  // ========================
  // TIMESTAMPS
  // ========================
  
  /** When trip was created */
  createdAt: z.date(),
  
  /** When trip was accepted */
  acceptedAt: z.date().nullable().optional(),
  
  /** When driver arrived at pickup */
  arrivedAt: z.date().nullable().optional(),
  
  /** When trip started (passenger picked up) */
  startedAt: z.date().nullable().optional(),
  
  /** When trip completed */
  completedAt: z.date().nullable().optional(),
  
  /** When trip was cancelled */
  cancelledAt: z.date().nullable().optional(),
});

export type Trip = z.infer<typeof TripSchema>;

/**
 * Default payment values for new trips
 */
export const DEFAULT_PAYMENT = {
  paymentMethod: PaymentMethod.CASH,
  paymentStatus: PaymentStatus.PENDING,
  paidAt: null,
} as const;
