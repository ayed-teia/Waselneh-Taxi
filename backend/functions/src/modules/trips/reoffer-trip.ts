import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { PILOT_LIMITS, TripStatus } from '@taxi-line/shared';

import { logger } from '../../core/logger';
import { evaluateDriverEligibility } from '../auth/driver-eligibility';

/**
 * ============================================================================
 * RE-OFFER A TRIP TO THE NEXT CANDIDATE DRIVER
 * ============================================================================
 *
 * THE PROBLEM THIS SOLVES
 * Dispatch was single-shot. createTripRequest ranked every eligible driver by
 * distance, offered the trip to the nearest one, and then threw the rest of the
 * ranking away. If that one driver rejected the offer - or simply did not answer
 * before the 45s timeout - the trip went straight to NO_DRIVER_AVAILABLE, even when
 * five other drivers were online, eligible and metres away. The passenger had to
 * start over from the client.
 *
 * THE APPROACH
 * createTripRequest now persists the full ranked candidate list on the trip
 * (`candidateDriverIds`), along with how far through it we are (`dispatchAttempt`)
 * and who has already been tried (`triedDriverIds`). When an offer fails, this
 * module walks to the next candidate that is still eligible and available, and
 * re-offers to them. Only when the list is exhausted does the trip become
 * NO_DRIVER_AVAILABLE - which is now an accurate statement rather than a guess.
 *
 * WHY SEQUENTIAL RATHER THAN BROADCAST
 * createTripRequest locks the driver (`isAvailable: false`) at OFFER time, not at
 * accept time, so broadcasting one trip to N drivers would need that locking model
 * rewritten. Sequential re-offers fit the existing model exactly, which keeps this
 * change small and reviewable.
 *
 * BOUNDS
 * Re-offers are bounded twice over: by the candidate list itself, and by
 * MAX_DISPATCH_ATTEMPTS. The existing expireStaleTrips sweeper still enforces the
 * overall TRIP_SEARCH_TIMEOUT_SECONDS budget, so a trip cannot bounce between
 * drivers indefinitely.
 * ============================================================================
 */

/** How many drivers a single trip may be offered to before giving up. */
export const MAX_DISPATCH_ATTEMPTS = 5;

export interface ReofferResult {
  /** True if the trip was re-offered to another driver. */
  reoffered: boolean;
  /** The driver it was offered to, when reoffered is true. */
  driverId?: string;
  /** Why no re-offer happened, for logging. */
  reason?: string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * Attempt to re-offer `tripId` to the next viable candidate.
 *
 * MUST be called inside a transaction, and every read it performs happens before
 * any write, as Firestore requires. Returns without writing if there is no viable
 * candidate, leaving the caller to apply its own terminal handling.
 *
 * @param transaction   the enclosing transaction
 * @param db            Firestore instance
 * @param tripId        trip being re-offered
 * @param tripData      the trip document body (already read by the caller)
 * @param excludeDriverId the driver who just rejected / timed out
 */
export async function reofferTripToNextDriver(
  transaction: Transaction,
  db: Firestore,
  tripId: string,
  tripData: FirebaseFirestore.DocumentData,
  excludeDriverId: string
): Promise<ReofferResult> {
  const candidates = asStringArray(tripData.candidateDriverIds);
  const tried = new Set([...asStringArray(tripData.triedDriverIds), excludeDriverId]);
  const attempt = typeof tripData.dispatchAttempt === 'number' ? tripData.dispatchAttempt : 1;

  if (candidates.length === 0) {
    return { reoffered: false, reason: 'no_candidate_list' };
  }

  if (attempt >= MAX_DISPATCH_ATTEMPTS) {
    return { reoffered: false, reason: 'max_attempts_reached' };
  }

  const remaining = candidates.filter((driverId) => !tried.has(driverId));
  if (remaining.length === 0) {
    return { reoffered: false, reason: 'candidates_exhausted' };
  }

  // ---- ALL READS FIRST -----------------------------------------------------
  // Re-read each remaining candidate: the ranking was computed when the trip was
  // created and may be stale by now (the driver may have gone offline, taken
  // another trip, or been deactivated).
  const candidateDocs = await Promise.all(
    remaining.map((driverId) => transaction.get(db.collection('drivers').doc(driverId)))
  );

  let chosen: { driverId: string; data: FirebaseFirestore.DocumentData } | null = null;
  for (const doc of candidateDocs) {
    if (!doc.exists) continue;
    const data = doc.data() ?? {};

    if (data.isOnline !== true) continue;
    if (data.isAvailable !== true) continue;
    // Do not steal a driver who is already committed to another trip.
    if (typeof data.currentTripId === 'string' && data.currentTripId && data.currentTripId !== tripId) {
      continue;
    }
    if (!evaluateDriverEligibility(data).isEligible) continue;

    chosen = { driverId: doc.id, data };
    break; // `remaining` preserves the original distance ordering: nearest first.
  }

  if (!chosen) {
    return { reoffered: false, reason: 'no_available_candidate' };
  }

  // ---- WRITES --------------------------------------------------------------
  const expiresAt = Timestamp.fromMillis(
    Date.now() + PILOT_LIMITS.DRIVER_RESPONSE_TIMEOUT_SECONDS * 1000
  );

  const driverRequestRef = db
    .collection('driverRequests')
    .doc(chosen.driverId)
    .collection('requests')
    .doc(tripId);

  transaction.set(driverRequestRef, {
    tripId,
    passengerId: tripData.passengerId,
    pickup: tripData.pickup,
    dropoff: tripData.dropoff,
    estimatedDistanceKm: tripData.estimatedDistanceKm ?? null,
    estimatedDurationMin: tripData.estimatedDurationMin ?? null,
    estimatedPriceIls: tripData.estimatedPriceIls ?? null,
    bookingType: tripData.bookingType ?? null,
    requestedSeats: tripData.requestedSeats ?? null,
    requiredSeats: tripData.requiredSeats ?? null,
    destinationLabel: tripData.destinationLabel ?? null,
    destinationCity: tripData.destinationCity ?? null,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    timeoutSeconds: PILOT_LIMITS.DRIVER_RESPONSE_TIMEOUT_SECONDS,
    reofferedFrom: excludeDriverId,
    dispatchAttempt: attempt + 1,
  });

  // Move the trip's assignment to the new driver, keeping it PENDING so the
  // normal accept/reject flow applies unchanged.
  transaction.update(db.collection('trips').doc(tripId), {
    driverId: chosen.driverId,
    status: TripStatus.PENDING,
    dispatchAttempt: attempt + 1,
    triedDriverIds: Array.from(tried),
    reofferedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Lock the new driver, mirroring what createTripRequest does at offer time.
  transaction.set(
    db.collection('drivers').doc(chosen.driverId),
    {
      isAvailable: false,
      availability: 'busy',
      currentTripId: tripId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info('[Reoffer] Trip re-offered to next candidate', {
    tripId,
    fromDriverId: excludeDriverId,
    toDriverId: chosen.driverId,
    attempt: attempt + 1,
    remainingCandidates: remaining.length - 1,
  });

  return { reoffered: true, driverId: chosen.driverId };
}
