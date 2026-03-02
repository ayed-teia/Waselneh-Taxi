import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, UnauthorizedError, ValidationError } from '../../core/errors';
import { getAuthenticatedUserId } from '../../core/auth';

const GetDriverEarningsSummarySchema = z.object({
  lookbackDays: z.number().int().min(1).max(30).optional(),
});

interface EarningsBlock {
  totalEarningsIls: number;
  tripsCount: number;
  workingMinutes: number;
  averageFareIls: number;
}

interface GetDriverEarningsSummaryResponse {
  success: boolean;
  day: EarningsBlock;
  week: EarningsBlock;
  currency: 'ILS';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const maybeToDate = value as { toDate?: () => Date };
  if (typeof maybeToDate.toDate === 'function') {
    return maybeToDate.toDate();
  }
  return null;
}

export const getDriverEarningsSummary = onCall<unknown, Promise<GetDriverEarningsSummaryResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) {
        throw new UnauthorizedError('Authentication required');
      }

      const parsed = GetDriverEarningsSummarySchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid earnings request payload', parsed.error.flatten());
      }

      const lookbackDays = parsed.data.lookbackDays ?? 7;
      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);

      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - lookbackDays);

      const db = getFirestore();
      const snapshot = await db
        .collection('trips')
        .where('driverId', '==', driverId)
        .where('status', 'in', ['completed', 'rated'])
        .where('completedAt', '>=', weekStart)
        .orderBy('completedAt', 'desc')
        .limit(300)
        .get();

      let dayFareTotal = 0;
      let dayTrips = 0;
      let dayMinutes = 0;

      let weekFareTotal = 0;
      let weekTrips = 0;
      let weekMinutes = 0;

      snapshot.forEach((doc) => {
        const data = doc.data();
        const fare = Number(data.finalPriceIls ?? data.estimatedPriceIls ?? 0);
        if (!Number.isFinite(fare)) return;

        const startedAt = toDate(data.startedAt);
        const completedAt = toDate(data.completedAt);
        const tripMinutes =
          startedAt && completedAt
            ? Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 60000))
            : 0;

        weekFareTotal += fare;
        weekTrips += 1;
        weekMinutes += tripMinutes;

        if (completedAt && completedAt >= dayStart) {
          dayFareTotal += fare;
          dayTrips += 1;
          dayMinutes += tripMinutes;
        }
      });

      const dayAvg = dayTrips > 0 ? dayFareTotal / dayTrips : 0;
      const weekAvg = weekTrips > 0 ? weekFareTotal / weekTrips : 0;

      return {
        success: true,
        currency: 'ILS',
        day: {
          totalEarningsIls: round2(dayFareTotal),
          tripsCount: dayTrips,
          workingMinutes: dayMinutes,
          averageFareIls: round2(dayAvg),
        },
        week: {
          totalEarningsIls: round2(weekFareTotal),
          tripsCount: weekTrips,
          workingMinutes: weekMinutes,
          averageFareIls: round2(weekAvg),
        },
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
