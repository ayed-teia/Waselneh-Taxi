import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { TripStatus, PaymentStatus } from '@taxi-line/shared';
import { REGION } from '../../core/env';
import { getFirestore } from '../../core/config';
import { handleError, ValidationError, NotFoundError, ForbiddenError, UnauthorizedError } from '../../core/errors';
import { logger } from '../../core/logger';
import { getAuthenticatedUserId } from '../../core/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { docData, getNumber, getString } from '../../core/firestore/doc-data';
import { grantReferralRewardIfDue } from '../../modules/referrals';

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
      const driverId = getAuthenticatedUserId(request);
      if (!driverId) {
        throw new UnauthorizedError('Authentication required');
      }

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

      // The payment transition and the referral grant must be ATOMIC. This used to
      // be a bare get()-then-update(), so the 'already collected' guard was a
      // read-then-write race: two taps could both observe PENDING and both proceed.
      // Wrapping it also gives the referral reward a read phase to run in.
      const result = await db.runTransaction(async (transaction) => {
        // ---- reads first; a transaction may not read after it writes ----------
        const tripDoc = await transaction.get(tripRef);
        if (!tripDoc.exists) {
          throw new NotFoundError('Trip not found');
        }

        const tripData = docData(tripDoc);

        if (tripData.driverId !== driverId) {
          logger.warn(`⚠️ [ConfirmCashPayment] Driver does not own trip`, {
            driverId,
            tripDriverId: tripData.driverId,
          });
          throw new ForbiddenError('You are not the driver of this trip');
        }

        const tripStatus = getString(tripData, 'status', '');
        if (tripStatus !== TripStatus.COMPLETED) {
          logger.warn(`⚠️ [ConfirmCashPayment] Trip not completed`, { tripId, status: tripStatus });
          throw new ValidationError(
            `Trip must be completed before collecting payment. Current status: ${tripStatus}`
          );
        }

        if (tripData.paymentStatus === PaymentStatus.PAID) {
          logger.warn(`⚠️ [ConfirmCashPayment] Payment already collected`, { tripId });
          throw new ValidationError('Payment has already been collected for this trip');
        }

        const fareAmount =
          getNumber(tripData, 'fareAmount') ?? getNumber(tripData, 'estimatedPriceIls', 0);
        const passengerId = getString(tripData, 'passengerId', '');

        // Referral credits are granted HERE, on the payment transition - not on trip
        // completion, which writes the payment as PENDING and would therefore reward
        // cash trips the driver never actually collected. Still inside the read phase.
        const referral = await grantReferralRewardIfDue(
          transaction,
          db,
          passengerId,
          tripId,
          fareAmount
        );

        // ---- writes -----------------------------------------------------------
        transaction.update(tripRef, {
          paymentStatus: PaymentStatus.PAID,
          paidAt: FieldValue.serverTimestamp(),
        });

        const paymentRef = db.collection('payments').doc(`payment_${tripId}`);
        transaction.set(
          paymentRef,
          {
            status: PaymentStatus.PAID,
            paidAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return { fareAmount, passengerId, referralGranted: referral.granted, tripData };
      });

      const { fareAmount, passengerId, referralGranted, tripData } = result;

      // logger.paymentConfirmed takes a narrow 'cash' | 'card' union, so widen only
      // to what it accepts rather than casting an arbitrary stored string.
      const paymentMethod = getString(tripData, 'paymentMethod', 'cash') === 'card' ? 'card' : 'cash';
      logger.paymentConfirmed(tripId, fareAmount, paymentMethod, { driverId, passengerId });

      if (referralGranted) {
        // uids deliberately omitted - referral rewards must not put a passenger id in logs.
        logger.info(`🎁 [ConfirmCashPayment] Referral reward granted`, { tripId });
      }

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
