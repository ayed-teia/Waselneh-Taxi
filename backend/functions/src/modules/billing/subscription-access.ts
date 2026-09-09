const ALLOWED_STATUSES = new Set(['active', 'trialing']);

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const toMillisMethod = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillisMethod === 'function') {
      const result = Reflect.apply(toMillisMethod, value, []) as unknown;
      return typeof result === 'number' && Number.isFinite(result) ? result : null;
    }
  }
  return null;
}

export function getSubscriptionBlockReason(
  data: Record<string, unknown>,
  nowMs = Date.now()
): string | null {
  // Legacy drivers remain operational until a plan is explicitly assigned.
  if (typeof data.subscriptionStatus !== 'string') return null;
  if (!ALLOWED_STATUSES.has(data.subscriptionStatus)) return 'subscription_not_active';

  const startsAt = toMillis(data.subscriptionStartsAt);
  if (startsAt !== null && startsAt > nowMs) return 'subscription_not_started';
  const endsAt = toMillis(data.subscriptionEndsAt);
  if (endsAt !== null && endsAt <= nowMs) return 'subscription_expired';
  return null;
}
