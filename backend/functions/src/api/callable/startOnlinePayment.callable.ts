import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { PaymentStatus, TripStatus } from '@taxi-line/shared';

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
import { asRecord, getNumber, getString } from '../../core/firestore/doc-data';
import { logger } from '../../core/logger';
import {
  decidePaymentTransition,
  getPaymentProvider,
  isPaymentState,
  paymentIdempotencyKey,
} from '../../modules/payments';

/**
 * ============================================================================
 * START ONLINE PAYMENT
 * ============================================================================
 *
 * Creates a charge with the provider and moves the payment to `awaiting_payment`.
 *
 * WHAT THIS FUNCTION CANNOT DO, BY DESIGN: mark anything paid. It hands back a URL
 * for the provider's own payment UI and stops. `paid` arrives later, over the
 * webhook, from the provider. Splitting it this way is what stops a client from
 * ever being the thing that says money moved.
 *
 * With ONLINE_PAYMENTS_ENABLED off this rejects immediately and cash is unaffected.
 * ============================================================================
 */

const StartOnlinePaymentSchema = z.object({
  tripId: z.string().min(1),
});

interface StartOnlinePaymentResponse {
  success: boolean;
  status: string;
  clientActionUrl: string;
  providerChargeId: string;
}

export const startOnlinePayment = onCall<unknown, Promise<StartOnlinePaymentResponse>>(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      const provider = getPaymentProvider();
      if (!provider) {
        // Inert when the flag is off - the same answer an unimplemented feature gives.
        throw new ValidationError('Online payments are not enabled');
      }

      const userId = getAuthenticatedUserId(request);
      if (!userId) throw new UnauthorizedError('Authentication required');

      const parsed = StartOnlinePaymentSchema.safeParse(request.data);
      if (!parsed.success) throw new ValidationError('Invalid request data');
      const { tripId } = parsed.data;

      const db = getFirestore();
      const paymentRef = db.collection('payments').doc(paymentIdempotencyKey(tripId));
      const tripRef = db.collection('trips').doc(tripId);

      const [paymentSnap, tripSnap] = await Promise.all([paymentRef.get(), tripRef.get()]);
      if (!paymentSnap.exists || !tripSnap.exists) throw new NotFoundError('Payment not found');

      const payment = asRecord(paymentSnap.data());
      const trip = asRecord(tripSnap.data());

      // Only the passenger who owes the fare may start paying it.
      if (getString(payment, 'passengerId') !== userId) {
        throw new ForbiddenError('You are not the passenger of this trip');
      }

      if (getString(trip, 'status', '') !== TripStatus.COMPLETED) {
        throw new ValidationError('Trip must be completed before payment');
      }

      const rawStatus = getString(payment, 'status', PaymentStatus.PENDING);
      const from = isPaymentState(rawStatus) ? rawStatus : PaymentStatus.PENDING;
      const decision = decidePaymentTransition(from, PaymentStatus.AWAITING_PAYMENT);

      if (!decision.apply && !decision.alreadyApplied) {
        throw new ValidationError(decision.reason ?? 'Payment cannot be started');
      }

      // ONE key per trip. A retry - a double tap, a lost response - reaches the
      // provider with the same key and yields the same charge rather than a second one.
      const idempotencyKey = paymentIdempotencyKey(tripId);
      const amount = getNumber(payment, 'amount', 0);

      const charge = await provider.createCharge({
        tripId,
        amountMinorUnits: Math.round(amount * 100),
        currency: 'ILS',
        passengerId: userId,
        idempotencyKey,
      });

      // Written even when already awaiting_payment: re-recording the same charge id is
      // harmless and keeps the document consistent with what we just told the provider.
      await paymentRef.update({
        status: PaymentStatus.AWAITING_PAYMENT,
        provider: provider.name,
        providerChargeId: charge.providerChargeId,
        idempotencyKey,
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('💳 [StartOnlinePayment] Charge created', { tripId, from });

      return {
        success: true,
        status: PaymentStatus.AWAITING_PAYMENT,
        clientActionUrl: charge.clientActionUrl,
        providerChargeId: charge.providerChargeId,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
