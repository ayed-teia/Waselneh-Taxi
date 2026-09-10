import { FieldValue } from 'firebase-admin/firestore';
import { PaymentStatus, isOnlinePaymentsEnabled } from '@taxi-line/shared';

import { getFirestore } from '../../core/config';
import { asRecord, getString } from '../../core/firestore/doc-data';
import { logger } from '../../core/logger';
import { grantReferralRewardIfDue } from '../referrals';

import { LahzaProvider } from './lahza-provider';
import type { PaymentProvider, VerifiedPaymentEvent } from './payment-provider';
import { StubProvider } from './payment-provider';
import {
  decidePaymentTransition,
  isPaymentState,
  paymentIdempotencyKey,
  type PaymentState,
} from './payment-state-machine';

/**
 * ============================================================================
 * ONLINE PAYMENTS CORE
 * ============================================================================
 *
 * Ties together the state machine, the provider adapter and Firestore. Two things
 * matter more than anything else here.
 *
 * 1. THE PROVIDER EVENT IS THE SOURCE OF TRUTH, NEVER THE CLIENT.
 *    Nothing in this module accepts "the passenger's app says it paid". State only
 *    advances from a payload the adapter has cryptographically verified.
 *
 * 2. EVERY ADVANCE IS IDEMPOTENT AND TRANSACTIONAL.
 *    Processors retry webhooks - that is normal, not exceptional. A retry is
 *    delivered because our 200 was lost, not because anything changed, so applying
 *    it twice would be OUR bug. Two guards, deliberately overlapping:
 *      a. the processed-event id set, which catches a byte-identical replay;
 *      b. the state machine's from === to check, which catches a re-delivery that
 *         somehow carries a different event id.
 *    Both live INSIDE the transaction, because a check outside one is only a
 *    narrower race, not the absence of one.
 * ============================================================================
 */

/** Payment documents are `payments/payment_<tripId>`. */
const PAYMENTS_COLLECTION = 'payments';

/** Adapter names accepted by PAYMENT_PROVIDER. */
const PROVIDER_LAHZA = 'lahza';
const PROVIDER_STUB = 'stub';

/**
 * Provider selection.
 *
 * With the flag OFF this returns null and every entry point becomes a no-op, so the
 * module is inert rather than merely unused.
 *
 * WITH THE FLAG ON, THE RULES ARE DELIBERATELY UNFORGIVING:
 *
 *   - `lahza` is the DEFAULT, so a deployment cannot land on the stub by forgetting
 *     to set PAYMENT_PROVIDER. It requires LAHZA_SECRET_KEY; missing or blank
 *     THROWS. It does NOT quietly fall back to the stub - the stub marks trips paid
 *     for free, so a silent fallback in a would-be production path is the worst
 *     available failure mode. A hard error is loud, immediate and safe.
 *
 *   - `stub` is refused unless FUNCTIONS_EMULATOR is set, so it cannot be selected
 *     in a deployed environment even deliberately.
 */
export function getPaymentProvider(
  env: Record<string, string | undefined> = process.env
): PaymentProvider | null {
  if (!isOnlinePaymentsEnabled(env)) return null;

  const selected = (env.PAYMENT_PROVIDER ?? PROVIDER_LAHZA).trim().toLowerCase();

  if (selected === PROVIDER_STUB) {
    // The stub is a test double, not a payment processor.
    if (env.FUNCTIONS_EMULATOR !== 'true') {
      throw new Error(
        'PAYMENT_PROVIDER=stub is only permitted under the emulator. The stub marks ' +
          'trips paid without taking any money.'
      );
    }
    return new StubProvider();
  }

  if (selected === PROVIDER_LAHZA) {
    const secretKey = (env.LAHZA_SECRET_KEY ?? '').trim();
    if (!secretKey) {
      // Fail safe, and loudly. Never degrade to the stub.
      throw new Error(
        'ONLINE_PAYMENTS_ENABLED is on with PAYMENT_PROVIDER=lahza, but LAHZA_SECRET_KEY ' +
          'is not set. Refusing to start a payment. See docs/LAHZA_SETUP.md.'
      );
    }
    return new LahzaProvider({
      secretKey,
      ...(env.LAHZA_BASE_URL ? { baseUrl: env.LAHZA_BASE_URL } : {}),
    });
  }

  throw new Error(`Unknown PAYMENT_PROVIDER "${selected}". Expected "lahza" or "stub".`);
}

export interface AdvanceResult {
  /** False only when the event was rejected outright. */
  ok: boolean;
  /** The state the payment is in after this call. */
  status?: PaymentState;
  /** True when nothing was written because the event had already been applied. */
  duplicate: boolean;
  /** Set when the event was rejected. */
  reason?: string;
}

/**
 * Apply a VERIFIED provider event to the payment document.
 *
 * The caller must already have verified the signature; this function assumes the
 * event is authentic and concerns itself only with whether it is NEW and LEGAL.
 */
export async function advancePaymentFromEvent(
  event: VerifiedPaymentEvent,
  providerName: string
): Promise<AdvanceResult> {
  const db = getFirestore();
  const paymentRef = db.collection(PAYMENTS_COLLECTION).doc(paymentIdempotencyKey(event.tripId));

  return db.runTransaction(async (tx) => {
    // ---- reads first; Firestore transactions forbid a read after a write --------
    const snap = await tx.get(paymentRef);

    if (!snap.exists) {
      // No charge was ever created for this trip. An event for an unknown payment is
      // either a misrouted webhook or an attack; either way we do not conjure a
      // payment record out of it.
      logger.warn('⚠️ [Payments] Event for unknown payment', {
        tripId: event.tripId,
        eventId: event.eventId,
      });
      return { ok: false, duplicate: false, reason: 'Unknown payment' };
    }

    const data = asRecord(snap.data());

    // ---- guard (a): exact replay ------------------------------------------------
    const processed = Array.isArray(data.processedEventIds)
      ? data.processedEventIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (processed.includes(event.eventId)) {
      logger.info('↩️ [Payments] Duplicate event ignored', {
        tripId: event.tripId,
        eventId: event.eventId,
      });
      return { ok: true, duplicate: true, status: readState(data) };
    }

    // ---- guard (b): the state machine ------------------------------------------
    const from = readState(data);
    const decision = decidePaymentTransition(from, event.status);

    if (!decision.apply) {
      if (decision.alreadyApplied) {
        // Re-delivery under a different event id. Record the id so guard (a) catches
        // the next one cheaply, but change no money state.
        tx.update(paymentRef, {
          processedEventIds: FieldValue.arrayUnion(event.eventId),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { ok: true, duplicate: true, status: from };
      }

      logger.warn('⚠️ [Payments] Illegal transition rejected', {
        tripId: event.tripId,
        from,
        to: event.status,
        reason: decision.reason,
      });
      return {
        ok: false,
        duplicate: false,
        status: from,
        ...(decision.reason ? { reason: decision.reason } : {}),
      };
    }

    // Referral credits are granted on the PAYMENT transition, and only when the
    // provider says this payment actually became PAID. Runs in the read phase:
    // grantReferralRewardIfDue performs its own transaction.get calls, and a
    // Firestore transaction forbids a read after any write.
    let referralGranted = false;
    if (event.status === PaymentStatus.PAID) {
      const passengerId = typeof data.passengerId === 'string' ? data.passengerId : '';
      const amountIls = typeof data.amount === 'number' && Number.isFinite(data.amount) ? data.amount : 0;
      if (passengerId) {
        const referral = await grantReferralRewardIfDue(tx, db, passengerId, event.tripId, amountIls);
        referralGranted = referral.granted;
      }
    }

    // ---- apply ------------------------------------------------------------------
    tx.update(paymentRef, {
      status: event.status,
      provider: providerName,
      providerChargeId: event.providerChargeId,
      processedEventIds: FieldValue.arrayUnion(event.eventId),
      updatedAt: FieldValue.serverTimestamp(),
      ...(event.status === PaymentStatus.PAID ? { paidAt: FieldValue.serverTimestamp() } : {}),
      ...(event.status === PaymentStatus.REFUNDED
        ? { refundedAt: FieldValue.serverTimestamp() }
        : {}),
      ...(event.failureReason ? { failureReason: event.failureReason } : {}),
    });

    logger.info('💳 [Payments] Transition applied', {
      tripId: event.tripId,
      from,
      to: event.status,
      eventId: event.eventId,
      referralGranted,
    });

    return { ok: true, duplicate: false, status: event.status };
  });
}

/**
 * Read the current state off a payment document.
 *
 * An unreadable or unrecognised status is treated as `pending` rather than trusted:
 * the alternative is letting a corrupt field authorise a transition.
 */
function readState(data: Record<string, unknown>): PaymentState {
  const raw = getString(data, 'status', PaymentStatus.PENDING);
  return isPaymentState(raw) ? raw : PaymentStatus.PENDING;
}
