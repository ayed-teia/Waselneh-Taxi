import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus, PaymentStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * ============================================================================
 * CONFIRM CASH PAYMENT - Cloud Function
 * ============================================================================
 * 
 * Called when driver confirms cash payment received from passenger.
 * 
 * PRECONDITION: Trip status must be COMPLETED
 * ACTION: Set paymentStatus = "paid", paidAt = serverTimestamp
 * 
 * ============================================================================
 * QA VERIFICATION CHECKLIST:
 * ============================================================================
 * 
 * ✅ CONFIRM CASH PAYMENT FLOW:
 *    LOG: "💵 [ConfirmCashPayment] START - driverId: {id}, tripId: {id}"
 *    LOG: "🔒 [ConfirmCashPayment] Trip status: completed ✓"
 *    LOG: "💰 [ConfirmCashPayment] Payment confirmed - amount: ₪{amount}"
 *    LOG: "🎉 [ConfirmCashPayment] COMPLETE"
 * 
 * ❌ ERROR CASES:
 *    LOG: "⚠️ [ConfirmCashPayment] Trip not completed: {status}"
 *    LOG: "⚠️ [ConfirmCashPayment] Payment already collected"
 *    LOG: "⚠️ [ConfirmCashPayment] Driver does not own trip"
 * 
 * ============================================================================
 */

/**
 * Request schema for confirm cash payment
 */
const ConfirmCashPaymentSchema = z.object({
  tripId: z.string().min(1),
});

/**
 * Response type
 */
interface ConfirmCashPaymentResponse {
  success: boolean;
  paymentStatus: string;
  fareAmount: number;
  paidAt: string;
}

/**
 * Confirm cash payment collected for a trip
 * 
 * Validates:
 * - Driver is authenticated
 * - Driver owns the trip (trip.driverId === auth.uid)
 * - Trip status is COMPLETED
 * - Payment not already collected
 * 
 * Updates:
 * - paymentStatus = "paid"
 * - paidAt = serverTimestamp
 */
export const confirmCashPayment = onCall<unknown, Promise<ConfirmCashPaymentResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // ========================================
      // 1. Require authentication
      // ========================================
      if (!request.auth?.uid) {
        throw new UnauthorizedError('Authentication required');
      }

      const driverId = request.auth.uid;

      // ========================================
      // 2. Validate input
      // ========================================
      const parsed = ConfirmCashPaymentSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid request data');
      }

      const { tripId } = parsed.data;

      logger.info(`💵 [ConfirmCashPayment] START`, { driverId, tripId });

      // ========================================
      // 3. Get trip document
      // ========================================
      const db = getFirestore();
      const tripRef = db.collection('trips').doc(tripId);
      const tripDoc = await tripRef.get();

      if (!tripDoc.exists) {
        throw new NotFoundError('Trip not found');
      }

      const tripData = tripDoc.data()!;

      // ========================================
      // 4. Validate driver owns the trip
      // ========================================
      if (tripData.driverId !== driverId) {
        logger.warn(`⚠️ [ConfirmCashPayment] Driver does not own trip`, { 
          driverId, 
          tripDriverId: tripData.driverId 
        });
        throw new ForbiddenError('You are not the driver of this trip');
      }

      // ========================================
      // 5. Validate trip is completed
      // ========================================
      if (tripData.status !== TripStatus.COMPLETED) {
        logger.warn(`⚠️ [ConfirmCashPayment] Trip not completed`, { 
          tripId, 
          status: tripData.status 
        });
        throw new ValidationError(`Trip must be completed before collecting payment. Current status: ${tripData.status}`);
      }

      // ========================================
      // 6. Check if payment already collected
      // ========================================
      if (tripData.paymentStatus === PaymentStatus.PAID) {
        logger.warn(`⚠️ [ConfirmCashPayment] Payment already collected`, { tripId });
        throw new ValidationError('Payment has already been collected for this trip');
      }

      // ========================================
      // 7. Update payment status
      // ========================================
      const now = FieldValue.serverTimestamp();
      
      await tripRef.update({
        paymentStatus: PaymentStatus.PAID,
        paidAt: now,
      });

      const fareAmount = tripData.fareAmount || tripData.estimatedPriceIls;

      // Log structured payment confirmation
      logger.paymentConfirmed(tripId, fareAmount, tripData.paymentMethod || 'cash', {
        driverId,
        passengerId: tripData.passengerId,
      });

      logger.info(`🎉 [ConfirmCashPayment] COMPLETE`, { tripId, driverId });

      return {
        success: true,
        paymentStatus: PaymentStatus.PAID,
        fareAmount,
        paidAt: new Date().toISOString(),
      };

    } catch (error) {
      throw handleError(error);
    }
  }
);
