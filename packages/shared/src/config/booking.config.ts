export const BOOKING_TYPES = {
  SEAT_ONLY: 'seat_only',
  FULL_TAXI: 'full_taxi',
} as const;

export type BookingType = (typeof BOOKING_TYPES)[keyof typeof BOOKING_TYPES];

export const BOOKING_TYPE_VALUES = Object.values(BOOKING_TYPES) as BookingType[];

export function normalizeBookingType(value: unknown): BookingType {
  if (typeof value !== 'string') {
    return BOOKING_TYPES.SEAT_ONLY;
  }

  const trimmed = value.trim() as BookingType;
  return BOOKING_TYPE_VALUES.includes(trimmed) ? trimmed : BOOKING_TYPES.SEAT_ONLY;
}

export function getRequestedSeatsForBookingType(
  bookingType: BookingType,
  requestedSeats?: number | null
): number {
  if (bookingType === BOOKING_TYPES.FULL_TAXI) {
    // Full taxi reserves all available seats on acceptance. The exact value
    // is resolved server-side from current driver availability.
    return 0;
  }

  if (typeof requestedSeats === 'number' && Number.isFinite(requestedSeats)) {
    return Math.max(1, Math.round(requestedSeats));
  }

  return 1;
}
