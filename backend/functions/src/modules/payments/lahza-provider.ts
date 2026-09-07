import { createHmac, timingSafeEqual } from 'node:crypto';

import { PaymentStatus } from '@taxi-line/shared';

import { logger } from '../../core/logger';

import type {
  CreateChargeInput,
  CreateChargeResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  VerifiedPaymentEvent,
} from './payment-provider';

/**
 * ============================================================================
 * LAHZA PAYMENT PROVIDER
 * ============================================================================
 *
 * A concrete PaymentProvider for Lahza (https://lahza.io), written against the
 * published API reference. It implements the existing interface and changes nothing
 * about the payments core or the state machine.
 *
 * ⚠️  NO REAL OR SANDBOX LAHZA CALL WAS EVER MADE FROM THIS BRANCH. There are no
 * credentials here, so every claim below traces to the documentation, not to an
 * observed response. What is verified is the logic we control: signature
 * verification, event mapping, amount handling and fail-safe key checks. The first
 * live sandbox charge is a human step - see docs/LAHZA_SETUP.md.
 *
 * SOURCES (read September 2026)
 *   https://api-docs.lahza.io/api-endpoints/transactions  - initialize
 *   https://api-docs.lahza.io/api-endpoints/refunds       - refund
 *   https://docs.lahza.io/payments/webhooks               - signature + events
 *   https://docs.lahza.io/payments/verify-payments        - verify + status values
 *
 * THE DOCUMENTED FACTS THIS ADAPTER RELIES ON
 *   Base URL      https://api.lahza.io
 *   Auth          `Authorization: Bearer <SECRET_KEY>`
 *   Initialize    POST /transaction/initialize -> data.authorization_url,
 *                 data.access_code, data.reference
 *   Refund        POST /refund { transaction, amount?, currency? }
 *   Webhook       header `x-lahza-signature`, HMAC-SHA256 of the RAW body, hex,
 *                 keyed with the SECRET key
 *   Money         ILS amounts are in agora (minor units) - the same unit our
 *                 CreateChargeInput.amountMinorUnits already uses, so there is no
 *                 conversion and therefore no rounding to get wrong.
 *   Currencies    ILS, JOD, USD. We only ever send ILS.
 * ============================================================================
 */

/** Documented base URL. Overridable ONLY so tests can point at a local stub. */
const DEFAULT_LAHZA_BASE_URL = 'https://api.lahza.io';

/** Documented webhook signature header. */
export const LAHZA_SIGNATURE_HEADER = 'x-lahza-signature';

/**
 * Lahza's documented webhook events.
 *
 * `charge.success` is the only one that means money arrived. There is deliberately
 * no "charge.failed" in this list because the docs do not list one: a card that is
 * declined simply never produces a success event. See mapEventToStatus.
 */
export const LAHZA_EVENTS = {
  CHARGE_SUCCESS: 'charge.success',
  REFUND_PROCESSED: 'refund.processed',
  REFUND_FAILED: 'refund.failed',
  REFUND_PENDING: 'refund.pending',
  REFUND_PROCESSING: 'refund.processing',
} as const;

export interface LahzaConfig {
  secretKey: string;
  baseUrl?: string;
}

/**
 * ---------------------------------------------------------------------------
 * TRIP ID <-> LAHZA REFERENCE
 * ---------------------------------------------------------------------------
 *
 * Lahza lets the caller supply the transaction `reference`, and echoes it back on
 * the webhook. We use that to carry the trip identity, so the webhook resolves to a
 * trip deterministically - no lookup table, and nothing taken on trust from a
 * client.
 *
 * The one constraint: Lahza documents the reference charset as "only -, ., = and
 * alphanumeric characters". Our internal idempotency key is `payment_<tripId>`, and
 * the UNDERSCORE IS NOT ALLOWED, so the wire format uses a hyphen instead. Firestore
 * auto-ids (which is what tripIds are) are alphanumeric, so the tripId itself always
 * passes.
 */
const LAHZA_REFERENCE_PREFIX = 'payment-';

/** Characters Lahza documents as legal in a reference. */
const LAHZA_REFERENCE_CHARSET = /^[A-Za-z0-9.=-]+$/;

export function tripIdToLahzaReference(tripId: string): string {
  return `${LAHZA_REFERENCE_PREFIX}${tripId}`;
}

/**
 * Recover the tripId from a Lahza reference, or null if this reference is not one
 * of ours. Returning null matters: it is how a webhook for somebody else's
 * transaction gets ignored rather than misapplied to a trip.
 */
export function lahzaReferenceToTripId(reference: unknown): string | null {
  if (typeof reference !== 'string') return null;
  if (!reference.startsWith(LAHZA_REFERENCE_PREFIX)) return null;
  const tripId = reference.slice(LAHZA_REFERENCE_PREFIX.length);
  if (tripId.length === 0) return null;
  if (!LAHZA_REFERENCE_CHARSET.test(tripId)) return null;
  return tripId;
}

/**
 * Map a Lahza event name to one of our three externally-reportable states.
 *
 * Returns null for events that carry no state change we act on. `refund.pending`
 * and `refund.processing` are explicitly in that category: the money has NOT moved
 * back yet, and treating "we have received your refund request" as `refunded` would
 * tell a passenger they had been repaid before they had been.
 */
export function mapLahzaEventToStatus(event: unknown): VerifiedPaymentEvent['status'] | null {
  switch (event) {
    case LAHZA_EVENTS.CHARGE_SUCCESS:
      return PaymentStatus.PAID;
    case LAHZA_EVENTS.REFUND_PROCESSED:
      return PaymentStatus.REFUNDED;
    case LAHZA_EVENTS.REFUND_FAILED:
      // The refund failed, so the charge is still paid. This is NOT a failed
      // payment, and mapping it to `failed` would mark a paid trip unpaid.
      return null;
    case LAHZA_EVENTS.REFUND_PENDING:
    case LAHZA_EVENTS.REFUND_PROCESSING:
      return null;
    default:
      return null;
  }
}

/**
 * Compute Lahza's webhook signature: HMAC-SHA256 over the raw body, hex digest,
 * keyed with the secret key. Exported so tests can build a correctly signed request
 * without duplicating the algorithm.
 */
export function lahzaSignPayload(rawBody: string, secretKey: string): string {
  return createHmac('sha256', secretKey).update(rawBody, 'utf8').digest('hex');
}

export class LahzaProvider implements PaymentProvider {
  readonly name = 'lahza';

  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(config: LahzaConfig) {
    // Fail loudly at construction rather than at the first charge. A provider with
    // no key cannot do anything useful, and the alternative - discovering this when
    // a passenger tries to pay - is worse.
    if (!config.secretKey || config.secretKey.trim().length === 0) {
      throw new Error('LahzaProvider requires a secret key');
    }
    this.secretKey = config.secretKey.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_LAHZA_BASE_URL).replace(/\/+$/, '');
  }

  /**
   * POST /transaction/initialize
   *
   * Returns the hosted checkout URL. Card data never touches our servers, which is
   * what keeps this out of PCI scope.
   */
  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const reference = tripIdToLahzaReference(input.tripId);

    // Lahza's `amount` is in agora for ILS - the same minor unit the core already
    // uses. No conversion, so there is no rounding step here to get wrong.
    const body = {
      email: buildPassengerEmail(input.passengerId),
      amount: String(input.amountMinorUnits),
      currency: input.currency,
      // Supplying our own reference is what makes the charge idempotent AND lets the
      // webhook resolve back to a trip. Lahza rejects a duplicate reference, which
      // is precisely the behaviour we want from a retry.
      reference,
      metadata: JSON.stringify({
        tripId: input.tripId,
        passengerId: input.passengerId,
        idempotencyKey: input.idempotencyKey,
      }),
    };

    const response = await this.request('/transaction/initialize', 'POST', body);

    const data = asRecord(response.data);
    const authorizationUrl = typeof data.authorization_url === 'string' ? data.authorization_url : '';
    const providerReference = typeof data.reference === 'string' ? data.reference : reference;

    if (!authorizationUrl) {
      throw new Error('Lahza did not return an authorization_url');
    }

    return {
      // Lahza's reference IS the transaction handle used by verify and refund.
      providerChargeId: providerReference,
      clientActionUrl: authorizationUrl,
    };
  }

  /**
   * Verify a Lahza webhook and map it onto our event shape.
   *
   * THIS FUNCTION IS THE ENTIRE SECURITY BOUNDARY. The webhook endpoint is
   * necessarily unauthenticated - Lahza has no Firebase identity - so if this
   * returned an event for an unverified body, the endpoint would be an open
   * "mark this trip paid" API. Every failure path returns null.
   */
  parseAndVerifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>
  ): VerifiedPaymentEvent | null {
    const provided = readHeader(headers, LAHZA_SIGNATURE_HEADER);
    if (!provided) return null;

    const expected = lahzaSignPayload(rawBody, this.secretKey);

    // Length first: timingSafeEqual throws on a length mismatch. Then a constant-time
    // compare, so the signature cannot be discovered a byte at a time.
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))) {
      return null;
    }

    // Only now is it safe to interpret the body.
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    const envelope = parsed as Record<string, unknown>;
    const status = mapLahzaEventToStatus(envelope.event);
    if (!status) {
      // A legitimately signed event we take no action on (refund.pending, and
      // anything Lahza adds later). Ignoring it is correct; the webhook still 200s.
      return null;
    }

    const data = asRecord(envelope.data);
    const tripId = lahzaReferenceToTripId(data.reference);
    if (!tripId) return null;

    const amountMinorUnits =
      typeof data.amount === 'number' && Number.isFinite(data.amount)
        ? Math.round(data.amount)
        : null;
    if (amountMinorUnits === null) return null;

    // Lahza's webhook payload has no dedicated event id, so the reference plus the
    // event name identifies this delivery. That is stable across a retry of the SAME
    // event, which is exactly what the core's replay guard needs.
    const eventId = `${String(envelope.event)}:${String(data.reference)}`;

    return {
      eventId,
      providerChargeId: String(data.reference),
      tripId,
      status,
      amountMinorUnits,
    };
  }

  /**
   * POST /refund
   *
   * Lahza queues refunds ("Refund has been queued for processing", status
   * "pending"), so this reports settled: false unless it explicitly says otherwise.
   * The confirming `refund.processed` webhook is what drives paid -> refunded.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    const body = {
      transaction: input.providerChargeId,
      amount: String(input.amountMinorUnits),
      currency: 'ILS',
      ...(input.reason ? { merchant_note: input.reason } : {}),
    };

    const response = await this.request('/refund', 'POST', body);
    const data = asRecord(response.data);

    const refundId = data.id !== undefined && data.id !== null ? String(data.id) : '';
    const refundStatus = typeof data.status === 'string' ? data.status : '';

    return {
      providerRefundId: refundId,
      // Anything other than an explicit success means "not yet". Assuming settlement
      // would let us tell a passenger they were refunded before Lahza had done it.
      settled: refundStatus === 'processed' || refundStatus === 'success',
    };
  }

  /**
   * One place for auth, JSON handling and error shape.
   *
   * Lahza returns `{status, message, data}` and documents `status: false` as a
   * failed call, so an HTTP 200 alone is NOT success - both are checked.
   */
  private async request(
    path: string,
    method: 'POST' | 'GET',
    body?: Record<string, unknown>
  ): Promise<{ status: boolean; message: string; data: unknown }> {
    const url = `${this.baseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      // Never let a network error message carry the key into a log.
      throw new Error(
        `Lahza request to ${path} failed: ${error instanceof Error ? error.message : 'network error'}`
      );
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Lahza returned a non-JSON response from ${path} (HTTP ${response.status})`);
    }

    const envelope = asRecord(payload);
    const ok = response.ok && envelope.status === true;

    if (!ok) {
      const message = typeof envelope.message === 'string' ? envelope.message : 'unknown error';
      logger.error('❌ [Lahza] API call failed', {
        path,
        httpStatus: response.status,
        message,
      });
      throw new Error(`Lahza ${path} failed: ${message}`);
    }

    return {
      status: true,
      message: typeof envelope.message === 'string' ? envelope.message : '',
      data: envelope.data,
    };
  }
}

/**
 * Lahza requires an email on initialize, but we do not necessarily hold one for a
 * passenger who signed up by phone.
 *
 * TODO: decide the real source. Options are (a) collect an email during online
 * checkout, or (b) confirm with Lahza that a placeholder is acceptable. This
 * placeholder uses the reserved `.invalid` TLD (RFC 2606) so it can never reach a
 * real mailbox - but it also means Lahza cannot email the payer a receipt, which is
 * a product decision, not an engineering one.
 */
function buildPassengerEmail(passengerId: string): string {
  return `passenger-${passengerId}@waselneh.invalid`;
}

function readHeader(
  headers: Record<string, string | undefined>,
  name: string
): string | null {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  // Node lowercases incoming header names, but be tolerant of other casings.
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase() && typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
