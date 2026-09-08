import { z } from 'zod';

import { VEHICLE_MAX_CAPACITY } from '../config/vehicle.config';

export const ROUTE_RUN_STATUS_VALUES = [
  'boarding',
  'full',
  'departed',
  'completed',
  'cancelled',
] as const;
export type RouteRunStatus = (typeof ROUTE_RUN_STATUS_VALUES)[number];

export const ROUTE_BOOKING_STATUS_VALUES = [
  'confirmed',
  'cancelled',
  'checked_in',
  'no_show',
] as const;
export type RouteBookingStatus = (typeof ROUTE_BOOKING_STATUS_VALUES)[number];

export const OpenRouteRunInputSchema = z.object({
  lineId: z.string().trim().min(1),
  departureTime: z.string().datetime(),
});

export const BookRouteRunInputSchema = z.object({
  runId: z.string().trim().min(1),
  seats: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY),
  pickupLabel: z.string().trim().min(2).max(160).optional(),
  destinationLabel: z.string().trim().min(2).max(160).optional(),
});

export const CancelRouteBookingInputSchema = z.object({
  runId: z.string().trim().min(1),
});

export const AdvanceRouteRunInputSchema = z.object({
  runId: z.string().trim().min(1),
  targetStatus: z.enum(['departed', 'completed']),
});

export const FindNearbyRouteRunsInputSchema = z.object({
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  seats: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY).default(1),
  maxRouteDistanceKm: z.number().positive().max(50).default(5),
});

export const RouteRunSchema = z.object({
  runId: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
  driverId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1).nullable().optional(),
  officeId: z.string().trim().min(1).nullable().optional(),
  status: z.enum(ROUTE_RUN_STATUS_VALUES),
  departureTime: z.unknown(),
  seatCapacity: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY),
  availableSeats: z.number().int().min(0).max(VEHICLE_MAX_CAPACITY),
  bookedSeats: z.number().int().min(0).max(VEHICLE_MAX_CAPACITY),
  bookingCount: z.number().int().nonnegative(),
  originCityId: z.string().trim().min(1).nullable().optional(),
  destinationCityId: z.string().trim().min(1).nullable().optional(),
  originLabel: z.string().trim().min(1).nullable().optional(),
  destinationLabel: z.string().trim().min(1).nullable().optional(),
});

export type RouteRun = z.infer<typeof RouteRunSchema>;

export const RouteBookingSchema = z.object({
  bookingId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
  passengerId: z.string().trim().min(1),
  passengerName: z.string().trim().min(1),
  seats: z.number().int().min(1).max(VEHICLE_MAX_CAPACITY),
  status: z.enum(ROUTE_BOOKING_STATUS_VALUES),
  pickupLabel: z.string().trim().min(1).nullable().optional(),
  destinationLabel: z.string().trim().min(1).nullable().optional(),
});

export type RouteBooking = z.infer<typeof RouteBookingSchema>;
