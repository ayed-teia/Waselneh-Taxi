export interface RouteRunCapacity {
  seatCapacity: number;
  availableSeats: number;
  bookedSeats: number;
  bookingCount: number;
  status: 'boarding' | 'full';
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

export function reserveRouteRunSeats(
  run: Record<string, unknown>,
  seats: number
): RouteRunCapacity {
  const seatCapacity = Math.max(1, nonNegativeInteger(run.seatCapacity, 1));
  const availableSeats = Math.min(
    seatCapacity,
    nonNegativeInteger(run.availableSeats, seatCapacity)
  );
  const requestedSeats = Math.max(1, nonNegativeInteger(seats, 1));

  if (requestedSeats > availableSeats) {
    throw new Error('NOT_ENOUGH_SEATS');
  }

  const nextAvailableSeats = availableSeats - requestedSeats;
  return {
    seatCapacity,
    availableSeats: nextAvailableSeats,
    bookedSeats: seatCapacity - nextAvailableSeats,
    bookingCount: nonNegativeInteger(run.bookingCount) + 1,
    status: nextAvailableSeats === 0 ? 'full' : 'boarding',
  };
}

export function releaseRouteRunSeats(
  run: Record<string, unknown>,
  seats: number
): RouteRunCapacity {
  const seatCapacity = Math.max(1, nonNegativeInteger(run.seatCapacity, 1));
  const availableSeats = Math.min(
    seatCapacity,
    nonNegativeInteger(run.availableSeats, seatCapacity)
  );
  const releasedSeats = Math.max(0, nonNegativeInteger(seats));
  const nextAvailableSeats = Math.min(seatCapacity, availableSeats + releasedSeats);

  return {
    seatCapacity,
    availableSeats: nextAvailableSeats,
    bookedSeats: seatCapacity - nextAvailableSeats,
    bookingCount: Math.max(0, nonNegativeInteger(run.bookingCount) - 1),
    status: 'boarding',
  };
}
