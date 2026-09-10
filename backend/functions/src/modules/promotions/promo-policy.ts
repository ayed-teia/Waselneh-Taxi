export interface PromoPolicyInput {
  active: boolean;
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  maxDiscountIls?: number | null;
  minFareIls?: number | null;
  startsAtMs?: number | null;
  expiresAtMs?: number | null;
  usageLimit?: number | null;
  usageCount?: number | null;
  perPassengerLimit?: number | null;
  passengerUsageCount?: number | null;
}

export interface PromoDecision {
  valid: boolean;
  discountIls: number;
  reason?: 'inactive' | 'not_started' | 'expired' | 'minimum_fare' | 'usage_limit' | 'passenger_limit' | 'invalid_discount';
}

export function normalizePromoCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
}

export function evaluatePromo(policy: PromoPolicyInput, fareIls: number, nowMs = Date.now()): PromoDecision {
  if (!policy.active) return { valid: false, discountIls: 0, reason: 'inactive' };
  if (policy.startsAtMs && nowMs < policy.startsAtMs) return { valid: false, discountIls: 0, reason: 'not_started' };
  if (policy.expiresAtMs && nowMs >= policy.expiresAtMs) return { valid: false, discountIls: 0, reason: 'expired' };
  if (fareIls < Math.max(0, policy.minFareIls ?? 0)) return { valid: false, discountIls: 0, reason: 'minimum_fare' };
  if (policy.usageLimit && (policy.usageCount ?? 0) >= policy.usageLimit) return { valid: false, discountIls: 0, reason: 'usage_limit' };
  if (policy.perPassengerLimit && (policy.passengerUsageCount ?? 0) >= policy.perPassengerLimit) {
    return { valid: false, discountIls: 0, reason: 'passenger_limit' };
  }
  if (!Number.isFinite(policy.discountValue) || policy.discountValue <= 0) {
    return { valid: false, discountIls: 0, reason: 'invalid_discount' };
  }

  const rawDiscount = policy.discountType === 'percentage'
    ? fareIls * Math.min(policy.discountValue, 100) / 100
    : policy.discountValue;
  const cappedDiscount = policy.maxDiscountIls && policy.maxDiscountIls > 0
    ? Math.min(rawDiscount, policy.maxDiscountIls)
    : rawDiscount;

  return { valid: true, discountIls: Math.min(fareIls, Math.max(0, Math.floor(cappedDiscount * 100) / 100)) };
}
