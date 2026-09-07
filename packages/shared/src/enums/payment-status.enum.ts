/**
 * ============================================================================
 * PAYMENT STATUS ENUM
 * ============================================================================
 * 
 * Status values for payment documents in the payments collection.
 * 
 * ============================================================================
 */

/**
 * Payment status values
 */
export const PaymentStatus = {
  /** Payment created, awaiting collection */
  PENDING: 'pending',
  /**
   * A charge has been created with the payment provider and we are waiting for the
   * provider to tell us what happened. ONLINE PAYMENTS ONLY - the cash path never
   * enters this state, it goes straight from pending to paid when the driver
   * confirms collection.
   */
  AWAITING_PAYMENT: 'awaiting_payment',
  /** Payment collected/processed */
  PAID: 'paid',
  /** Payment failed */
  FAILED: 'failed',
  /** The charge was cancelled before it completed (abandoned, or the trip died). */
  CANCELLED: 'cancelled',
  /** A previously PAID payment was refunded. Terminal. */
  REFUNDED: 'refunded',
} as const;

export type PaymentStatus = typeof PaymentStatus[keyof typeof PaymentStatus];

/**
 * Payment method values
 */
export const PaymentMethod = {
  /** Cash payment */
  CASH: 'cash',
  /** Card payment (future) */
  CARD: 'card',
  /** Wallet payment (future) */
  WALLET: 'wallet',
} as const;

export type PaymentMethod = typeof PaymentMethod[keyof typeof PaymentMethod];
