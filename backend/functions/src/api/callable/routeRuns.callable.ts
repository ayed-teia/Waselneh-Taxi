import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import {
  AdvanceRouteRunInputSchema,
  BookRouteRunInputSchema,
  CancelRouteBookingInputSchema,
  OpenRouteRunInputSchema,
  normalizeSeatCapacity,
  normalizeVehicleType,
} from '@taxi-line/shared';
import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  handleError,
} from '../../core/errors';
import { logger } from '../../core/logger';
import { ensureDriverIsLicensedLineOwnerData } from '../../modules/auth';
import { publishTripStatusNotifications } from '../../modules/notifications';
import {
  releaseRouteRunSeats,
  reserveRouteRunSeats,
} from '../../modules/routes/route-run-capacity';
import { readGeoPoint } from '../../modules/routes/route-proximity';

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function passengerName(data: FirebaseFirestore.DocumentData | undefined): string {
  return (
    optionalString(data?.fullName) ??
    optionalString(data?.displayName) ??
    optionalString(data?.name) ??
    'Passenger'
  );
}

export const openRouteRun = onCall<unknown, Promise<{ runId: string; status: 'boarding' }>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    try {
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) throw new UnauthorizedError('Authentication required');

      const parsed = OpenRouteRunInputSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid route run payload', parsed.error.flatten());
      }

      const departureDate = new Date(parsed.data.departureTime);
      if (departureDate.getTime() <= Date.now()) {
        throw new ValidationError('departureTime must be in the future');
      }

      const db = getFirestore();
      const runRef = db.collection('routeRuns').doc();
      const driverRef = db.collection('drivers').doc(driverId);
      const lineRef = db.collection('lines').doc(parsed.data.lineId);

      await db.runTransaction(async (transaction) => {
        const [driverDoc, lineDoc] = await Promise.all([
          transaction.get(driverRef),
          transaction.get(lineRef),
        ]);
        if (!driverDoc.exists) throw new NotFoundError('Driver profile not found');
        if (!lineDoc.exists) throw new NotFoundError('Line not found');

        const driverData = driverDoc.data() ?? {};
        const lineData = lineDoc.data() ?? {};
        const eligibility = ensureDriverIsLicensedLineOwnerData(driverId, driverData);
        if (eligibility.lineId !== parsed.data.lineId) {
          throw new ForbiddenError('Driver is not assigned to this line');
        }
        if (lineData.status !== 'active') {
          throw new ForbiddenError('Line is not active');
        }
        if (optionalString(driverData.activeRouteRunId)) {
          throw new ForbiddenError('Driver already has an active route run');
        }

        let originPoint = readGeoPoint(lineData.originPoint);
        let destinationPoint = readGeoPoint(lineData.destinationPoint);
        const originCityId = optionalString(lineData.originCityId);
        const destinationCityId = optionalString(lineData.destinationCityId);
        if ((!originPoint && originCityId) || (!destinationPoint && destinationCityId)) {
          const [originCityDoc, destinationCityDoc] = await Promise.all([
            originCityId
              ? transaction.get(db.collection('cities').doc(originCityId))
              : Promise.resolve(null),
            destinationCityId
              ? transaction.get(db.collection('cities').doc(destinationCityId))
              : Promise.resolve(null),
          ]);
          const originCityData = (originCityDoc?.data() ?? {}) as Record<string, unknown>;
          const destinationCityData = (destinationCityDoc?.data() ?? {}) as Record<string, unknown>;
          originPoint = originPoint ?? readGeoPoint(originCityData.center);
          destinationPoint = destinationPoint ?? readGeoPoint(destinationCityData.center);
        }

        const seatCapacity = normalizeSeatCapacity(
          driverData.seatCapacity,
          normalizeVehicleType(driverData.vehicleType)
        );
        transaction.create(runRef, {
          runId: runRef.id,
          lineId: parsed.data.lineId,
          driverId,
          vehicleId: optionalString(driverData.vehicleId),
          officeId: optionalString(lineData.officeId),
          status: 'boarding',
          departureTime: Timestamp.fromDate(departureDate),
          seatCapacity,
          availableSeats: seatCapacity,
          bookedSeats: 0,
          bookingCount: 0,
          originCityId,
          destinationCityId,
          originPoint,
          destinationPoint,
          originLabel: optionalString(lineData.originLabel),
          destinationLabel: optionalString(lineData.destinationLabel),
          lineName: optionalString(lineData.name),
          lineCode: optionalString(lineData.code),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(
          driverRef,
          { activeRouteRunId: runRef.id, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      });

      return { runId: runRef.id, status: 'boarding' };
    } catch (error) {
      logger.error('[RouteRun] Open failed', { error });
      throw handleError(error);
    }
  }
);

export const bookRouteRun = onCall<unknown, Promise<{ bookingId: string; availableSeats: number; status: string }>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    try {
      const passengerId = getAuthenticatedUserId(request);
      if (!passengerId) throw new UnauthorizedError('Authentication required');

      const parsed = BookRouteRunInputSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid route booking payload', parsed.error.flatten());
      }

      const db = getFirestore();
      const runRef = db.collection('routeRuns').doc(parsed.data.runId);
      const bookingRef = runRef.collection('bookings').doc(passengerId);
      const passengerRef = db.collection('users').doc(passengerId);
      let availableSeats = 0;
      let status = 'boarding';
      let driverIdForNotify = '';
      let bookingCreated = false;

      await db.runTransaction(async (transaction) => {
        const [runDoc, bookingDoc, passengerDoc] = await Promise.all([
          transaction.get(runRef),
          transaction.get(bookingRef),
          transaction.get(passengerRef),
        ]);
        if (!runDoc.exists) throw new NotFoundError('Route run not found');
        const runData = runDoc.data() ?? {};
        const lineId = optionalString(runData.lineId);
        if (!lineId) throw new ValidationError('Route run is missing its lineId');
        driverIdForNotify = optionalString(runData.driverId) ?? '';

        if (bookingDoc.exists && bookingDoc.data()?.status === 'confirmed') {
          if (bookingDoc.data()?.seats !== parsed.data.seats) {
            throw new ForbiddenError(
              'An active booking already exists with a different seat count'
            );
          }
          availableSeats = Number(runData.availableSeats ?? 0);
          status = String(runData.status ?? 'boarding');
          return;
        }
        if (runData.status !== 'boarding') {
          throw new ForbiddenError('Route run is not accepting bookings');
        }
        const departureTime = runData.departureTime as Timestamp | undefined;
        if (departureTime && departureTime.toMillis() <= Date.now()) {
          throw new ForbiddenError('Route run has already reached departure time');
        }

        let capacity;
        try {
          capacity = reserveRouteRunSeats(runData, parsed.data.seats);
        } catch (error) {
          if (error instanceof Error && error.message === 'NOT_ENOUGH_SEATS') {
            throw new ForbiddenError('Not enough seats are available');
          }
          throw error;
        }

        availableSeats = capacity.availableSeats;
        status = capacity.status;
        transaction.update(runRef, {
          availableSeats: capacity.availableSeats,
          bookedSeats: capacity.bookedSeats,
          bookingCount: capacity.bookingCount,
          status: capacity.status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(bookingRef, {
          bookingId: passengerId,
          runId: parsed.data.runId,
          lineId,
          passengerId,
          passengerName: passengerName(passengerDoc.data()),
          seats: parsed.data.seats,
          status: 'confirmed',
          pickupLabel: optionalString(parsed.data.pickupLabel),
          destinationLabel:
            optionalString(parsed.data.destinationLabel) ?? optionalString(runData.destinationLabel),
          bookedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        bookingCreated = true;
      });

      if (bookingCreated) {
        await publishTripStatusNotifications({
          tripId: parsed.data.runId,
          status: 'route_booking_confirmed',
          recipients: [
            { userId: passengerId, role: 'passenger' },
            { userId: driverIdForNotify, role: 'driver' },
          ],
          metadata: { runId: parsed.data.runId, seats: parsed.data.seats },
        });
      }

      return { bookingId: passengerId, availableSeats, status };
    } catch (error) {
      logger.error('[RouteRun] Booking failed', { error });
      throw handleError(error);
    }
  }
);

export const cancelRouteBooking = onCall<unknown, Promise<{ cancelled: true; availableSeats: number }>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    try {
      const passengerId = getAuthenticatedUserId(request);
      if (!passengerId) throw new UnauthorizedError('Authentication required');
      const parsed = CancelRouteBookingInputSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid route booking cancellation', parsed.error.flatten());
      }

      const db = getFirestore();
      const runRef = db.collection('routeRuns').doc(parsed.data.runId);
      const bookingRef = runRef.collection('bookings').doc(passengerId);
      let availableSeats = 0;
      let driverIdForNotify = '';
      let bookingCancelled = false;

      await db.runTransaction(async (transaction) => {
        const [runDoc, bookingDoc] = await Promise.all([
          transaction.get(runRef),
          transaction.get(bookingRef),
        ]);
        if (!runDoc.exists) throw new NotFoundError('Route run not found');
        if (!bookingDoc.exists) throw new NotFoundError('Route booking not found');

        const runData = runDoc.data() ?? {};
        driverIdForNotify = optionalString(runData.driverId) ?? '';
        const bookingData = bookingDoc.data() ?? {};
        if (bookingData.passengerId !== passengerId) {
          throw new ForbiddenError('You cannot cancel this booking');
        }
        if (bookingData.status === 'cancelled') {
          availableSeats = Number(runData.availableSeats ?? 0);
          return;
        }
        if (!['boarding', 'full'].includes(String(runData.status))) {
          throw new ForbiddenError('Booking cannot be cancelled after departure');
        }

        const capacity = releaseRouteRunSeats(runData, Number(bookingData.seats ?? 0));
        availableSeats = capacity.availableSeats;
        transaction.update(runRef, {
          availableSeats: capacity.availableSeats,
          bookedSeats: capacity.bookedSeats,
          bookingCount: capacity.bookingCount,
          status: capacity.status,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(bookingRef, {
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        bookingCancelled = true;
      });

      if (bookingCancelled) {
        await publishTripStatusNotifications({
          tripId: parsed.data.runId,
          status: 'route_booking_cancelled',
          recipients: [
            { userId: passengerId, role: 'passenger' },
            { userId: driverIdForNotify, role: 'driver' },
          ],
          metadata: { runId: parsed.data.runId },
        });
      }

      return { cancelled: true, availableSeats };
    } catch (error) {
      logger.error('[RouteRun] Cancellation failed', { error });
      throw handleError(error);
    }
  }
);

export const advanceRouteRun = onCall<unknown, Promise<{ runId: string; status: string }>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    try {
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) throw new UnauthorizedError('Authentication required');
      const parsed = AdvanceRouteRunInputSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid route run transition', parsed.error.flatten());
      }

      const db = getFirestore();
      const runRef = db.collection('routeRuns').doc(parsed.data.runId);
      const driverRef = db.collection('drivers').doc(driverId);

      await db.runTransaction(async (transaction) => {
        const [runDoc, driverDoc] = await Promise.all([
          transaction.get(runRef),
          transaction.get(driverRef),
        ]);
        if (!runDoc.exists) throw new NotFoundError('Route run not found');
        const runData = runDoc.data() ?? {};
        if (runData.driverId !== driverId) {
          throw new ForbiddenError('Only the assigned driver can advance this route run');
        }

        const currentStatus = String(runData.status ?? '');
        const allowed =
          (parsed.data.targetStatus === 'departed' && ['boarding', 'full'].includes(currentStatus)) ||
          (parsed.data.targetStatus === 'completed' && currentStatus === 'departed');
        if (!allowed) {
          throw new ForbiddenError(
            `Cannot move route run from ${currentStatus} to ${parsed.data.targetStatus}`
          );
        }

        transaction.update(runRef, {
          status: parsed.data.targetStatus,
          [`${parsed.data.targetStatus}At`]: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        if (parsed.data.targetStatus === 'completed' && driverDoc.exists) {
          transaction.set(
            driverRef,
            { activeRouteRunId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
      });

      const bookings = await runRef.collection('bookings').where('status', '==', 'confirmed').get();
      await publishTripStatusNotifications({
        tripId: parsed.data.runId,
        status: `route_run_${parsed.data.targetStatus}`,
        recipients: bookings.docs.map((doc) => ({
          userId: String(doc.data().passengerId ?? ''),
          role: 'passenger' as const,
        })),
        metadata: { runId: parsed.data.runId, driverId },
      });

      return { runId: parsed.data.runId, status: parsed.data.targetStatus };
    } catch (error) {
      logger.error('[RouteRun] Transition failed', { error });
      throw handleError(error);
    }
  }
);
