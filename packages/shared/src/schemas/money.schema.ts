import { z } from 'zod';

/** Currency code for Israeli New Shekel */
export const CURRENCY_ILS = 'ILS' as const;

export const MoneySchema = z.object({
  /** Amount in smallest currency unit (agorot for ILS) */
  amount: z.number().int().nonnegative(),
  /** Currency code (always ILS for this platform) */
  currency: z.literal(CURRENCY_ILS),
});

export type Money = z.infer<typeof MoneySchema>;

/** Create a Money object from shekel amount */
export function shekelToMoney(shekels: number): Money {
  return {
    amount: Math.round(shekels * 100),
    currency: CURRENCY_ILS,
  };
}

/** Convert Money to shekel amount */
export function moneyToShekel(money: Money): number {
  return money.amount / 100;
}

/** Format Money for display */
export function formatMoney(money: Money): string {
  const shekels = moneyToShekel(money);
  return `₪${shekels.toFixed(2)}`;
}

/** Add two Money amounts */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error('Cannot add money with different currencies');
  }
  return {
    amount: a.amount + b.amount,
    currency: a.currency,
  };
}

/** Create zero money */
export function zeroMoney(): Money {
  return { amount: 0, currency: CURRENCY_ILS };
}
