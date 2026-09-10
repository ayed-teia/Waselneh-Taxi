import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { InternalError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { asRecord, getNumber, getString } from '../../core/firestore/doc-data';
import { generateReferralCode, normalizeReferralCode } from '../../modules/referrals';

/**
 * ============================================================================
 * PASSENGER REFERRAL CALLABLES
 * ============================================================================
 *
 * Replaces a UI-only placeholder that built a "referral code" on the client as an
 * uppercased slice of the caller's own uid. That was unsafe in both directions:
 * anyone holding a uid could forge the code, and anyone shown a code learned six
 * characters of a real uid. Codes are now random, server-issued, and reserved.
 *
 * Nothing here grants a reward. Credits are granted only on the PAYMENT
 * transition, by `grantReferralRewardIfDue` - see modules/referrals.
 * ============================================================================
 */

const EmptySchema = z.object({}).passthrough();
const ClaimSchema = z.object({ code: z.string().trim().min(1).max(16) });

/** Bounded, because a code is not unique until it is reserved. */
const MAX_CODE_ISSUE_ATTEMPTS = 5;

interface ReferralCodeResponse {
  code: string;
}

/**
 * Return the caller's referral code, issuing one on first use.
 *
 * Stable: once `users/{uid}.referralCode` is set, the same value is returned
 * forever. The authoritative mapping is `referralCodes/{code}.ownerId`, which no
 * client can read or write.
 */
export const getMyReferralCode = onCall<unknown, Promise<ReferralCodeResponse>>(
  { region: REGION },
  async (request) => {
    try {
      const userId = getAuthenticatedUserId(request);
      if (!userId) throw new UnauthorizedError('Authentication required');

      const db = getFirestore();
      const userRef = db.collection('users').doc(userId);

      for (let attempt = 0; attempt < MAX_CODE_ISSUE_ATTEMPTS; attempt += 1) {
        const candidate = generateReferralCode();
        const codeRef = db.collection('referralCodes').doc(candidate);

        try {
          const issued = await db.runTransaction(async (transaction) => {
            // ---- reads first -------------------------------------------------
            const [userSnapshot, codeSnapshot] = await Promise.all([
              transaction.get(userRef),
              transaction.get(codeRef),
            ]);

            const existing = getString(asRecord(userSnapshot.data()), 'referralCode', '');
            if (existing) return existing;

            // `create` semantics: reserving a code that already exists must fail
            // rather than silently steal it from its owner.
            if (codeSnapshot.exists) return null;

            // ---- writes ------------------------------------------------------
            transaction.create(codeRef, {
              code: candidate,
              ownerId: userId,
              active: true,
              createdAt: FieldValue.serverTimestamp(),
            });
            transaction.set(
              userRef,
              { referralCode: candidate, referralCodeIssuedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
            return candidate;
          });

          if (issued) return { code: issued };
        } catch (error) {
          // A concurrent reservation of the same candidate lost the race. Try a
          // different candidate rather than failing the request.
          const code = String((error as { code?: unknown }).code ?? '');
          if (!code.includes('already-exists')) throw error;
        }
      }

      throw new InternalError('Could not issue a referral code, please try again');
    } catch (error) {
      throw handleError(error);
    }
  }
);

interface ClaimResponse {
  claimed: true;
  status: 'pending';
}

/**
 * Record that the caller was invited by the owner of `code`.
 *
 * The abuse-critical path. One transaction, all reads before any write, and the
 * attribution document is keyed by INVITEE - which makes "one inviter, forever" a
 * document-existence property rather than a query that can race.
 */
export const claimReferralCode = onCall<unknown, Promise<ClaimResponse>>(
  { region: REGION },
  async (request) => {
    try {
      const inviteeId = getAuthenticatedUserId(request);
      if (!inviteeId) throw new UnauthorizedError('Authentication required');

      const parsed = ClaimSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid referral code', parsed.error.flatten());
      }
      const code = normalizeReferralCode(parsed.data.code);
      if (!code) throw new ValidationError('Referral code is invalid');

      const db = getFirestore();

      await db.runTransaction(async (transaction) => {
        const referralRef = db.collection('referrals').doc(inviteeId);
        const codeRef = db.collection('referralCodes').doc(code);
        const inviteeRef = db.collection('users').doc(inviteeId);

        // ---- reads (all of them) --------------------------------------------
        const [referralSnapshot, codeSnapshot, inviteeSnapshot] = await Promise.all([
          transaction.get(referralRef),
          transaction.get(codeRef),
          transaction.get(inviteeRef),
        ]);

        if (referralSnapshot.exists) {
          throw new ValidationError('A referral code has already been used on this account');
        }
        if (!codeSnapshot.exists) throw new ValidationError('Referral code is invalid');

        const codeData = asRecord(codeSnapshot.data());
        if (codeData.active === false) throw new ValidationError('Referral code is invalid');

        const inviterId = getString(codeData, 'ownerId', '');
        if (!inviterId) throw new ValidationError('Referral code is invalid');
        if (inviterId === inviteeId) {
          throw new ValidationError('You cannot use your own referral code');
        }

        // A code may only be applied BEFORE the invitee's first completed trip, so
        // it can never be attached retroactively to a trip that already happened.
        const inviteeData = asRecord(inviteeSnapshot.data());
        if (getNumber(inviteeData, 'loyaltyTripsCompleted', 0) > 0) {
          throw new ValidationError('Referral codes can only be used before your first trip');
        }

        // ---- write ------------------------------------------------------------
        // `create` rather than `set`: even if the existence check above were raced,
        // this fails rather than overwriting an existing attribution.
        transaction.create(referralRef, {
          inviteeId,
          inviterId,
          code,
          status: 'pending',
          qualifyingTripId: null,
          qualifiedAt: null,
          claimedAt: FieldValue.serverTimestamp(),
        });
      });

      return { claimed: true as const, status: 'pending' as const };
    } catch (error) {
      throw handleError(error);
    }
  }
);

interface ReferralStatusResponse {
  code: string | null;
  claimStatus: 'none' | 'pending' | 'qualified';
  claimedAt: string | null;
  invitedCount: number;
  qualifiedCount: number;
  creditBalance: number;
  rewardsEnabled: boolean;
  inviterCredits: number;
  inviteeCredits: number;
}

/**
 * The caller's own referral state.
 *
 * Returns COUNTS only. A passenger never learns which uids joined under them, so
 * this cannot be used to enumerate other users.
 */
export const getMyReferralStatus = onCall<unknown, Promise<ReferralStatusResponse>>(
  { region: REGION },
  async (request) => {
    try {
      const userId = getAuthenticatedUserId(request);
      if (!userId) throw new UnauthorizedError('Authentication required');

      const parsed = EmptySchema.safeParse(request.data ?? {});
      if (!parsed.success) throw new ValidationError('Invalid request');

      const db = getFirestore();
      const [userSnapshot, referralSnapshot, creditsSnapshot, configSnapshot, invited, qualified] =
        await Promise.all([
          db.collection('users').doc(userId).get(),
          db.collection('referrals').doc(userId).get(),
          db.collection('referralCredits').doc(userId).get(),
          db.collection('system').doc('referralConfig').get(),
          db.collection('referrals').where('inviterId', '==', userId).count().get(),
          db
            .collection('referrals')
            .where('inviterId', '==', userId)
            .where('status', '==', 'qualified')
            .count()
            .get(),
        ]);

      const referral = referralSnapshot.exists ? asRecord(referralSnapshot.data()) : null;
      const config = configSnapshot.exists ? asRecord(configSnapshot.data()) : null;
      const claimedAt = referral?.claimedAt;

      const rawStatus = referral ? getString(referral, 'status', 'pending') : 'none';
      const claimStatus: ReferralStatusResponse['claimStatus'] =
        rawStatus === 'qualified' ? 'qualified' : rawStatus === 'pending' ? 'pending' : 'none';

      return {
        code: getString(asRecord(userSnapshot.data()), 'referralCode', '') || null,
        claimStatus: referral ? claimStatus : 'none',
        claimedAt: claimedAt instanceof Timestamp ? claimedAt.toDate().toISOString() : null,
        invitedCount: invited.data().count,
        qualifiedCount: qualified.data().count,
        creditBalance: creditsSnapshot.exists
          ? getNumber(asRecord(creditsSnapshot.data()), 'balance', 0)
          : 0,
        // The UI must not promise a reward the config does not actually grant.
        rewardsEnabled: config?.enabled === true,
        inviterCredits: config ? getNumber(config, 'inviterCredits', 0) : 0,
        inviteeCredits: config ? getNumber(config, 'inviteeCredits', 0) : 0,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
