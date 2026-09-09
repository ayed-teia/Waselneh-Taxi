export type SubscriptionInvoiceStatus = 'pending' | 'past_due' | 'suspended' | 'paid' | 'void';

const PAYABLE_STATUSES = new Set<SubscriptionInvoiceStatus>(['pending', 'past_due', 'suspended']);
const BLOCKING_STATUSES = new Set<SubscriptionInvoiceStatus>(['past_due', 'suspended']);

export function isPayableInvoiceStatus(status: string): boolean {
  return PAYABLE_STATUSES.has(status as SubscriptionInvoiceStatus);
}

export function shouldReactivateSubscription(
  subscriptionStatus: string,
  otherInvoiceStatuses: string[],
): boolean {
  if (subscriptionStatus !== 'past_due' && subscriptionStatus !== 'suspended') return false;
  return !otherInvoiceStatuses.some((status) => BLOCKING_STATUSES.has(status as SubscriptionInvoiceStatus));
}
