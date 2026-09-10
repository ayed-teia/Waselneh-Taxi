/**
 * ============================================================================
 * REFERRAL REWARD POLICY
 * ============================================================================
 *
 * Pure. Decides WHETHER a referral has earned its reward and HOW MUCH - never
 * touches Firestore, never reads the clock except through an injected `nowMs`.
 * Mirrors `modules/promotions/promo-policy.ts`, for the same reason: the
 * authoritative transaction and the tests must run identical logic.
 *
 * WHY THE TRIGGER IS PAYMENT, NOT TRIP COMPLETION
 *
 * `completeTrip` writes the payment row as PENDING; `confirmCashPayment` (cash)
 * and the provider webhook (online) are what set PAID. Hanging the reward off
 * completion would therefore pay out on cash trips the driver never actually
 * collected. This module is called from the PAYMENT transition.
 *
 * DEFAULT IS OFF
 *
 * With no `system/referralConfig` document, or `enabled !== true`, or both point
 * values at zero, this returns null and nothing is granted. Shipping the feature
 * is therefore inert until a manager configures it deliberately.
 * ============================================================================
 */

export interface ReferralRewardPlan {
  inviterId: string;
  inviterCredits: number;
  inviteeCredits: number;
  configVersion: number;
}

export type ReferralRejectionReason =
  | 'no_referral'
  | 'no_config'
  | 'disabled'
  | 'already_qualified'
  | 'self_referral'
  | 'below_minimum_fare'
  | 'claim_expired'
  | 'zero_reward';

export interface ReferralDecision {
  plan: ReferralRewardPlan | null;
  reason?: ReferralRejectionReason;
}

export interface ReferralPolicyInput {
  /** The `referrals/{inviteeId}` document body, or null when none exists. */
  referral: Record<string, unknown> | null;
  /** The `system/referralConfig` body, or null when unconfigured. */
  config: Record<string, unknown> | null;
  /** The passenger who took the qualifying trip (the invitee). */
  passengerId: string;
  /** Final fare actually charged, in ILS. */
  finalPriceIls: number;
  /** Epoch ms of the claim, from the stored `claimedAtMs`. */
  claimedAtMs: number | null;
  /** Injected clock so expiry is testable. */
  nowMs: number;
}

function toNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/**
 * Decide whether this payment qualifies the referral, and for how much.
 *
 * Returns a decision rather than a bare plan so the caller can log WHY nothing
 * was granted without re-deriving the reasoning.
 */
export function decideReferralReward(input: ReferralPolicyInput): ReferralDecision {
  const { referral, config, passengerId, finalPriceIls, claimedAtMs, nowMs } = input;

  if (!referral) return { plan: null, reason: 'no_referral' };
  if (!config) return { plan: null, reason: 'no_config' };
  if (config.enabled !== true) return { plan: null, reason: 'disabled' };

  // Only a pending claim can qualify. Anything else has already paid out, or was
  // cancelled - either way a second grant must be impossible.
  if (referral.status !== 'pending') return { plan: null, reason: 'already_qualified' };

  const inviterId = typeof referral.inviterId === 'string' ? referral.inviterId.trim() : '';
  if (!inviterId) return { plan: null, reason: 'no_referral' };

  // Defence in depth: claimReferralCode already rejects this, but a document
  // written before that guard existed must still never pay out.
  if (inviterId === passengerId) return { plan: null, reason: 'self_referral' };

  const minimumFareIls = Math.max(0, Number(config.minQualifyingFareIls) || 0);
  if (!Number.isFinite(finalPriceIls) || finalPriceIls < minimumFareIls) {
    return { plan: null, reason: 'below_minimum_fare' };
  }

  // A claim that has sat unqualified past the window stops being eligible. This
  // is the anti-farming lever: an attacker cannot stockpile claims and cash them
  // in later. Zero or absent means "no expiry".
  const claimExpiryDays = Math.max(0, Number(config.claimExpiryDays) || 0);
  if (claimExpiryDays > 0) {
    if (claimedAtMs === null || !Number.isFinite(claimedAtMs)) {
      return { plan: null, reason: 'claim_expired' };
    }
    const expiresAtMs = claimedAtMs + claimExpiryDays * 24 * 60 * 60 * 1000;
    if (nowMs >= expiresAtMs) return { plan: null, reason: 'claim_expired' };
  }

  const inviterCredits = toNonNegativeInt(config.inviterCredits);
  const inviteeCredits = toNonNegativeInt(config.inviteeCredits);
  if (inviterCredits <= 0 && inviteeCredits <= 0) {
    // Nothing to grant: skip rather than write empty ledger rows.
    return { plan: null, reason: 'zero_reward' };
  }

  const configVersion = Math.max(1, toNonNegativeInt(config.version) || 1);
  return { plan: { inviterId, inviterCredits, inviteeCredits, configVersion } };
}
