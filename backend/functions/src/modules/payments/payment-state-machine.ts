import { PaymentStatus } from '@taxi-line/shared';

/**
 * ============================================================================
 * PAYMENT STATE MACHINE
 * ============================================================================
 *
 * Money state is the one place where "it mostly works" is not good enough: a wrong
 * transition either charges someone twice or marks an unpaid trip as settled. So the
 * legal moves are declared once, here, as data - not scattered across callables as
 * ad-hoc `if (status === ...)` checks that drift apart.
 *
 *   pending ──────────► awaiting_payment ──► paid ──► refunded
 *      │                      │  │            │
 *      │                      │  └──► failed  └──► (terminal otherwise)
 *      │                      └─────► cancelled
 *      ├──► paid       (the CASH path: driver confirms collection directly)
 *      ├──► failed
 *      └──► cancelled
 *
 * WHY `pending -> paid` IS STILL LEGAL
 * The cash path does exactly that, and it predates this module. Removing it would
 * break confirmCashPayment, which is explicitly out of scope. Cash never enters
 * awaiting_payment; that state exists only while a provider holds the charge.
 *
 * WHY paid IS NOT TERMINAL
 * A refund has to be representable, or a refunded trip would either be stuck showing
 * "paid" or be rewritten to a lie. `paid -> refunded` is the only exit, and
 * `refunded` is terminal - you cannot un-refund, you would create a new charge.
 *
 * WHAT IS DELIBERATELY ILLEGAL
 *   failed/cancelled/refunded -> anything   (terminal; retrying means a NEW charge
 *                                            with a new idempotency key)
 *   awaiting_payment -> awaiting_payment    (a duplicate provider event; the webhook
 *                                            treats this as a no-op, not an error)
 *   anything -> pending                     (you cannot rewind money state)
 * ============================================================================
 */

export type PaymentState = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** Terminal states. Nothing moves out of these. */
export const TERMINAL_PAYMENT_STATES: readonly PaymentState[] = [
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED,
];

/**
 * Legal transitions, keyed by the CURRENT state.
 * Anything not listed here is rejected.
 */
const ALLOWED_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  [PaymentStatus.PENDING]: [
    PaymentStatus.AWAITING_PAYMENT, // online: a charge was created
    PaymentStatus.PAID, // cash: the driver confirmed collection
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.AWAITING_PAYMENT]: [
    PaymentStatus.PAID,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.PAID]: [PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.REFUNDED]: [],
};

export function isPaymentState(value: unknown): value is PaymentState {
  return (
    typeof value === 'string' &&
    (Object.values(PaymentStatus) as string[]).includes(value)
  );
}

export function isTerminalPaymentState(state: PaymentState): boolean {
  return TERMINAL_PAYMENT_STATES.includes(state);
}

/** Whether `from -> to` is a legal move. */
export function canTransitionPayment(from: PaymentState, to: PaymentState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export interface TransitionDecision {
  /** Apply the write. */
  apply: boolean;
  /**
   * True when the payment is ALREADY in the target state. This is the duplicate-
   * webhook case and it is NOT an error: a provider that retries delivery must find
   * the second attempt harmless.
   */
  alreadyApplied: boolean;
  /** Set when the move is genuinely illegal. */
  reason?: string;
}

/**
 * Decide what to do about a requested transition.
 *
 * Distinguishes three outcomes rather than two, because conflating them is how
 * idempotency bugs happen:
 *   - apply           : a legal, new transition
 *   - alreadyApplied  : a repeat of the current state -> no-op, success
 *   - illegal         : rejected
 */
export function decidePaymentTransition(
  from: PaymentState,
  to: PaymentState
): TransitionDecision {
  if (from === to) {
    // A duplicate/replayed provider event. Succeed without writing.
    return { apply: false, alreadyApplied: true };
  }

  if (canTransitionPayment(from, to)) {
    return { apply: true, alreadyApplied: false };
  }

  return {
    apply: false,
    alreadyApplied: false,
    reason: isTerminalPaymentState(from)
      ? `Payment is already ${from}, which is terminal; a retry needs a new charge.`
      : `Illegal payment transition ${from} -> ${to}.`,
  };
}

/**
 * The idempotency key for a trip's payment.
 *
 * ONE key per trip, derived from the trip id rather than random, so a retried
 * createCharge cannot produce a second charge for the same ride. This mirrors the
 * existing document id (`payment_<tripId>`) deliberately: the key and the document
 * must not be able to disagree about which trip they belong to.
 */
export function paymentIdempotencyKey(tripId: string): string {
  return `payment_${tripId}`;
}
