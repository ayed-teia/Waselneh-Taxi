export type BillingInterval = 'monthly' | 'quarterly' | 'annual';

const MONTHS_BY_INTERVAL: Record<BillingInterval, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

export function billingPeriodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shouldCreateInvoice(start: Date, now: Date, interval: BillingInterval): boolean {
  if (now < start || now.getUTCDate() < start.getUTCDate()) return false;
  const elapsedMonths = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + now.getUTCMonth() - start.getUTCMonth();
  return elapsedMonths >= 0 && elapsedMonths % MONTHS_BY_INTERVAL[interval] === 0;
}
