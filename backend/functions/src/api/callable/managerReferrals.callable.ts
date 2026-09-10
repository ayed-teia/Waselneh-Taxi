import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { asRecord, getNumber } from '../../core/firestore/doc-data';
import { assertManagerPermission } from '../../modules/auth';

/**
 * ============================================================================
 * MANAGER REFERRAL ADMINISTRATION
 * ============================================================================
 *
 * Referral rewards are DISABLED until a manager turns them on here. The config
 * document is not created by the deployment, so `decideReferralReward` returns
 * null and nothing is granted until this callable writes it deliberately.
 *
 * Gated on a dedicated permission (`manage_referrals`) and global scope, exactly
 * as promotions are: referral economics are platform-wide, not per-office.
 * ============================================================================
 */

const ConfigSchema = z.object({
  enabled: z.boolean(),
  inviterCredits: z.number().int().min(0).max(100_000),
  inviteeCredits: z.number().int().min(0).max(100_000),
  minQualifyingFareIls: z.number().min(0).max(100_000).default(0),
  /** 0 means no expiry. */
  claimExpiryDays: z.number().int().min(0).max(365).default(0),
});

interface SetConfigResponse {
  success: true;
}

export const managerSetReferralConfig = onCall<unknown, Promise<SetConfigResponse>>(
  { region: REGION },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const profile = await assertManagerPermission(managerId, 'manage_referrals');
      if (!profile.isGlobalScope) {
        throw new ForbiddenError('Only a global manager can configure referrals');
      }

      const parsed = ConfigSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid referral configuration', parsed.error.flatten());
      }

      const db = getFirestore();
      const configRef = db.collection('system').doc('referralConfig');
      const auditRef = configRef.collection('events').doc();

      const batch = db.batch();
      batch.set(
        configRef,
        {
          ...parsed.data,
          // Bumped on every change so a granted reward records which rules paid it.
          version: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: managerId,
        },
        { merge: true }
      );
      batch.set(auditRef, {
        action: 'referral_config_updated',
        enabled: parsed.data.enabled,
        inviterCredits: parsed.data.inviterCredits,
        inviteeCredits: parsed.data.inviteeCredits,
        minQualifyingFareIls: parsed.data.minQualifyingFareIls,
        claimExpiryDays: parsed.data.claimExpiryDays,
        actorId: managerId,
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();

      return { success: true as const };
    } catch (error) {
      throw handleError(error);
    }
  }
);

interface ReferralReportResponse {
  enabled: boolean;
  totalClaims: number;
  pendingClaims: number;
  qualifiedClaims: number;
  totalInviterCreditsAwarded: number;
  totalInviteeCreditsAwarded: number;
  topInviters: Array<{ inviterRef: string; qualifiedCount: number }>;
}

/** Stable, non-reversible short reference for a uid. Never log or return the uid. */
function pseudonymise(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

/**
 * Aggregate referral reporting.
 *
 * Deliberately PII-free: counts and totals, with top inviters identified by a
 * truncated hash rather than a uid, name or phone number. A manager gets the
 * distribution shape without a list of identifiable people.
 */
export const managerGetReferralReport = onCall<unknown, Promise<ReferralReportResponse>>(
  { region: REGION },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const profile = await assertManagerPermission(managerId, 'manage_referrals');
      if (!profile.isGlobalScope) {
        throw new ForbiddenError('Only a global manager can view referral reporting');
      }

      const db = getFirestore();
      const [configSnapshot, auditSnapshot, referralsSnapshot] = await Promise.all([
        db.collection('system').doc('referralConfig').get(),
        db.collection('referralRewardAudit').get(),
        db.collection('referrals').get(),
      ]);

      let totalInviterCreditsAwarded = 0;
      let totalInviteeCreditsAwarded = 0;
      for (const doc of auditSnapshot.docs) {
        const data = asRecord(doc.data());
        totalInviterCreditsAwarded += getNumber(data, 'inviterCredits', 0);
        totalInviteeCreditsAwarded += getNumber(data, 'inviteeCredits', 0);
      }

      let pendingClaims = 0;
      let qualifiedClaims = 0;
      const qualifiedByInviter = new Map<string, number>();
      for (const doc of referralsSnapshot.docs) {
        const data = asRecord(doc.data());
        if (data.status === 'qualified') {
          qualifiedClaims += 1;
          const inviterId = typeof data.inviterId === 'string' ? data.inviterId : '';
          if (inviterId) {
            qualifiedByInviter.set(inviterId, (qualifiedByInviter.get(inviterId) ?? 0) + 1);
          }
        } else if (data.status === 'pending') {
          pendingClaims += 1;
        }
      }

      const topInviters = [...qualifiedByInviter.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([inviterId, qualifiedCount]) => ({
          inviterRef: pseudonymise(inviterId),
          qualifiedCount,
        }));

      return {
        enabled: configSnapshot.exists ? configSnapshot.data()?.enabled === true : false,
        totalClaims: referralsSnapshot.size,
        pendingClaims,
        qualifiedClaims,
        totalInviterCreditsAwarded,
        totalInviteeCreditsAwarded,
        topInviters,
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
