import { FieldValue, Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';

import { decideReferralReward, type ReferralRewardPlan } from './referral-policy';

/**
 * ============================================================================
 * REFERRAL REWARD GRANT (transactional)
 * ============================================================================
 *
 * The single write path for referral credits. Both payment transitions - cash
 * (`confirmCashPayment`) and online (the provider webhook) - call THIS, so the two
 * can never drift apart in how they reward, audit, or guard against duplicates.
 *
 * Modelled on `modules/promotions/benefit-restoration.ts`.
 *
 * FIRESTORE ORDERING RULE
 *
 * A transaction may not read after it writes. This helper therefore performs ALL
 * of its reads before ANY write, and callers must invoke it from their own read
 * phase - never after they have started writing.
 *
 * IDEMPOTENCY
 *
 * Two overlapping guards, deliberately:
 *   1. `referrals/{inviteeId}.status` must still be 'pending';
 *   2. a ledger document at the fixed id `referral_{inviteeId}` must not already
 *      exist for either side.
 * A retried payment webhook, or a driver double-tapping "cash collected",
 * therefore grants exactly once.
 *
 * WHY CREDITS DO NOT LIVE ON users/{uid}
 *
 * `users/{uid}` is owner-writable (the rules allow an owner to update their own
 * profile as long as it carries no privilege field, and a balance is not one).
 * Putting a spendable balance there would let a passenger mint their own credit.
 * Balances live in `referralCredits/{uid}`, which is `write: if false` for every
 * client and only ever mutated by the Admin SDK from inside this helper.
 * ============================================================================
 */

export interface ReferralGrantResult {
  granted: boolean;
  /** Set when a grant happened, for logging and the callable response. */
  plan?: ReferralRewardPlan;
  /** Why nothing was granted. Absent on success. */
  reason?: string;
}

function timestampToMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

/**
 * Grant the referral reward for `inviteeId`'s qualifying paid trip, if one is due.
 *
 * MUST be called during the caller's read phase.
 *
 * @param transaction the caller's open transaction
 * @param db          Firestore handle
 * @param inviteeId   the passenger who just paid
 * @param tripId      the qualifying trip, recorded for audit
 * @param finalPriceIls the fare actually charged
 * @param nowMs       injected clock, so expiry is testable
 */
export async function grantReferralRewardIfDue(
  transaction: Transaction,
  db: Firestore,
  inviteeId: string,
  tripId: string,
  finalPriceIls: number,
  nowMs: number = Date.now()
): Promise<ReferralGrantResult> {
  if (!inviteeId) return { granted: false, reason: 'no_passenger' };

  const referralRef = db.collection('referrals').doc(inviteeId);
  const configRef = db.collection('system').doc('referralConfig');

  // ---- READS (all of them, before any write) --------------------------------
  const [referralSnapshot, configSnapshot] = await Promise.all([
    transaction.get(referralRef),
    transaction.get(configRef),
  ]);

  const referralData = referralSnapshot.exists ? (referralSnapshot.data() ?? {}) : null;
  const configData = configSnapshot.exists ? (configSnapshot.data() ?? {}) : null;

  const decision = decideReferralReward({
    referral: referralData,
    config: configData,
    passengerId: inviteeId,
    finalPriceIls,
    claimedAtMs: timestampToMillis(referralData?.claimedAt),
    nowMs,
  });

  if (!decision.plan) return { granted: false, ...(decision.reason ? { reason: decision.reason } : {}) };

  const { inviterId, inviterCredits, inviteeCredits, configVersion } = decision.plan;

  // The ledger entry id is the INVITEE id on both sides: the referral edge is what
  // is being rewarded, and each party may be rewarded for it exactly once.
  const ledgerEntryId = `referral_${inviteeId}`;
  const inviterCreditsRef = db.collection('referralCredits').doc(inviterId);
  const inviteeCreditsRef = db.collection('referralCredits').doc(inviteeId);
  const inviterLedgerRef = inviterCreditsRef.collection('ledger').doc(ledgerEntryId);
  const inviteeLedgerRef = inviteeCreditsRef.collection('ledger').doc(ledgerEntryId);

  const [inviterLedgerSnapshot, inviteeLedgerSnapshot] = await Promise.all([
    transaction.get(inviterLedgerRef),
    transaction.get(inviteeLedgerRef),
  ]);

  // Either side already credited means this edge has paid out. Stop.
  if (inviterLedgerSnapshot.exists || inviteeLedgerSnapshot.exists) {
    return { granted: false, reason: 'already_granted' };
  }

  // ---- WRITES ---------------------------------------------------------------
  if (inviteeCredits > 0) {
    transaction.set(inviteeLedgerRef, {
      type: 'referral_invitee_reward',
      credits: inviteeCredits,
      tripId,
      configVersion,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      inviteeCreditsRef,
      {
        userId: inviteeId,
        balance: FieldValue.increment(inviteeCredits),
        lifetimeEarned: FieldValue.increment(inviteeCredits),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  if (inviterCredits > 0) {
    transaction.set(inviterLedgerRef, {
      type: 'referral_inviter_reward',
      credits: inviterCredits,
      tripId,
      configVersion,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      inviterCreditsRef,
      {
        userId: inviterId,
        balance: FieldValue.increment(inviterCredits),
        lifetimeEarned: FieldValue.increment(inviterCredits),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  transaction.update(referralRef, {
    status: 'qualified',
    qualifyingTripId: tripId,
    qualifiedAt: FieldValue.serverTimestamp(),
    inviterRewardCredits: inviterCredits,
    inviteeRewardCredits: inviteeCredits,
    rewardConfigVersion: configVersion,
  });

  // Manager-facing audit. Uids only - no name, phone or contact detail.
  transaction.set(db.collection('referralRewardAudit').doc(inviteeId), {
    inviterId,
    inviteeId,
    tripId,
    inviterCredits,
    inviteeCredits,
    configVersion,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { granted: true, plan: decision.plan };
}
