import { PaymentStatus } from '@taxi-line/shared';

import type { PaymentState } from './payment-state-machine';

/**
 * ============================================================================
 * PAYMENT PROVIDER ADAPTER INTERFACE
 * ============================================================================
 *
 * NO REAL PSP IS INTEGRATED, deliberately. Choosing one is blocked on a business
 * constraint, not a technical one: settlement in ILS to West Bank accounts. Stripe
 * does not support Palestinian entities, and the Israeli/regional processors differ
 * in KYC, settlement terms and fees. See docs/REMAINING_PLAN.md.
 *
 * What exists here is the SHAPE a real adapter must satisfy, plus a deterministic
 * stub so the whole flow - charge, webhook, refund, idempotency - is testable today.
 * When the processor is chosen, writing the adapter is the small part; the state
 * machine, webhook handling and tests around it are already done.
 *
 * TWO RULES THE INTERFACE ENFORCES BY SHAPE
 *
 * 1. THE CLIENT IS NEVER THE SOURCE OF TRUTH. There is no "the app says it paid"
 *    entry point. Money state advances only from a verified provider event, which is
 *    why parseAndVerifyWebhook returns the event rather than taking one on trust.
 *
 * 2. CARD DATA NEVER REACHES OUR SERVERS. createCharge returns a redirect/client
 *    secret for the provider's own UI. Nothing here accepts a PAN, which is what
 *    keeps this out of PCI scope.
 * ============================================================================
 */

export interface CreateChargeInput {
  tripId: string;
  /** Amount in the smallest currency unit (agorot), to avoid float money. */
  amountMinorUnits: number;
  currency: 'ILS';
  passengerId: string;
  /** One key per trip; a retry with the same key must not create a second charge. */
  idempotencyKey: string;
}

export interface CreateChargeResult {
  /** The provider's own id for this charge. */
  providerChargeId: string;
  /**
   * Where to send the passenger to complete payment. A real adapter returns the
   * provider's hosted page or a client secret for its SDK - never anything that
   * implies we handle card data ourselves.
   */
  clientActionUrl: string;
}

/** A payment event as reported by the provider, after signature verification. */
export interface VerifiedPaymentEvent {
  /** The provider's unique id FOR THIS EVENT (not the charge). Used for replay detection. */
  eventId: string;
  providerChargeId: string;
  tripId: string;
  /** What the provider says the payment now is. */
  status: Extract<
    PaymentState,
    typeof PaymentStatus.PAID | typeof PaymentStatus.FAILED | typeof PaymentStatus.REFUNDED
  >;
  amountMinorUnits: number;
  /** Provider-supplied failure detail, when status is failed. */
  failureReason?: string;
}

export interface RefundInput {
  providerChargeId: string;
  amountMinorUnits: number;
  reason?: string;
}

export interface RefundResult {
  providerRefundId: string;
  /**
   * Whether the refund settled synchronously. Many processors settle
   * asynchronously and confirm by webhook, so callers must not assume `true`.
   */
  settled: boolean;
}

/**
 * What a concrete PSP adapter must implement.
 * See docs/REMAINING_PLAN.md for the full checklist.
 */
/**
 * One settled transaction as reported by a provider.
 *
 * Amounts are in MINOR units (agorot for ILS) so reconciliation never compares
 * floats. Adapters convert at their own boundary.
 */
export interface SettlementRow {
  reference: string;
  status: 'paid' | 'refunded' | 'failed';
  amountMinorUnits: number;
  currency: string;
  settledAtIso?: string | null;
}

export interface PaymentProvider {
  /** Stable identifier, recorded on the payment document for auditing. */
  readonly name: string;

  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>;

  /**
   * Verify a raw webhook request and return the event it carries.
   *
   * MUST return null for an unverifiable payload. Returning an event from an
   * unverified request would turn the webhook into an open "mark this trip paid"
   * endpoint - the single most dangerous thing an adapter can get wrong.
   */
  parseAndVerifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>
  ): VerifiedPaymentEvent | null;

  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Fetch settled transactions for a date range, for reconciliation.
   *
   * OPTIONAL. An adapter that cannot supply settlement data simply omits it, and
   * reconciliation reports that the provider side is unavailable rather than
   * inventing an empty report - "0 rows" and "cannot ask" must never look alike.
   *
   * @param fromIso inclusive ISO-8601 start
   * @param toIso   exclusive ISO-8601 end
   */
  fetchSettlement?(fromIso: string, toIso: string): Promise<SettlementRow[]>;
}

/**
 * ============================================================================
 * STUB PROVIDER — dev and emulator only
 * ============================================================================
 *
 * Deterministic, no network, no keys, no SDK. It exists so the payment core is
 * genuinely testable rather than only reviewable.
 *
 * Behaviour is driven by the tripId so a test can choose an outcome without any
 * hidden state:
 *   tripId containing 'fail'   -> the charge is created, then the webhook reports failed
 *   anything else              -> the webhook reports paid
 *
 * Its "signature" is a SHA-256 HMAC over the body with a fixed dev secret. That is
 * the same SHAPE a real verification takes - and it still rejects a tampered body -
 * but the secret is not secret, so this must never be selected outside the emulator.
 * ============================================================================
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Not a secret. The stub must never be reachable in a deployed environment. */
const STUB_WEBHOOK_SECRET = 'stub-provider-dev-secret';

export const STUB_SIGNATURE_HEADER = 'x-waselneh-stub-signature';

/** Sign a payload the way the stub expects. Exported so tests can build requests. */
export function stubSignPayload(rawBody: string): string {
  return createHmac('sha256', STUB_WEBHOOK_SECRET).update(rawBody).digest('hex');
}

export class StubProvider implements PaymentProvider {
  readonly name = 'stub';

  createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    // Derived from the idempotency key, so a retry yields the SAME charge id -
    // which is exactly what a real provider does with an idempotency key.
    return Promise.resolve({
      providerChargeId: `stub_charge_${input.idempotencyKey}`,
      clientActionUrl: `https://stub.invalid/pay/${input.idempotencyKey}`,
    });
  }

  parseAndVerifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>
  ): VerifiedPaymentEvent | null {
    const provided = headers[STUB_SIGNATURE_HEADER] ?? headers[STUB_SIGNATURE_HEADER.toLowerCase()];
    if (typeof provided !== 'string' || provided.length === 0) return null;

    const expected = stubSignPayload(rawBody);
    // Constant-time compare, and length-check first because timingSafeEqual throws
    // on a length mismatch.
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }

    if (typeof parsed !== 'object' || parsed === null) return null;
    const body = parsed as Record<string, unknown>;

    const eventId = typeof body.eventId === 'string' ? body.eventId : null;
    const tripId = typeof body.tripId === 'string' ? body.tripId : null;
    const providerChargeId =
      typeof body.providerChargeId === 'string' ? body.providerChargeId : null;
    const status = body.status;
    const amountMinorUnits =
      typeof body.amountMinorUnits === 'number' && Number.isFinite(body.amountMinorUnits)
        ? Math.round(body.amountMinorUnits)
        : null;

    if (!eventId || !tripId || !providerChargeId || amountMinorUnits === null) return null;
    if (
      status !== PaymentStatus.PAID &&
      status !== PaymentStatus.FAILED &&
      status !== PaymentStatus.REFUNDED
    ) {
      return null;
    }

    return {
      eventId,
      providerChargeId,
      tripId,
      status,
      amountMinorUnits,
      ...(typeof body.failureReason === 'string' ? { failureReason: body.failureReason } : {}),
    };
  }

  refund(input: RefundInput): Promise<RefundResult> {
    return Promise.resolve({
      providerRefundId: `stub_refund_${input.providerChargeId}`,
      // The stub settles synchronously. A real adapter frequently will not, which is
      // why callers must read this flag rather than assume.
      settled: true,
    });
  }
}
