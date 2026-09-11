import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { getAuthenticatedUserId } from '../../core/auth';
import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { ForbiddenError, UnauthorizedError, ValidationError, handleError } from '../../core/errors';
import { asRecord, getNumber, getString } from '../../core/firestore/doc-data';
import { assertManagerPermission } from '../../modules/auth';
import { getPaymentProvider } from '../../modules/payments';
import {
  type InternalPaymentRecord,
  type ProviderSettlementRecord,
  reconcileSettlement,
} from '../../modules/reconciliation';

/**
 * ============================================================================
 * MANAGER RECONCILIATION
 * ============================================================================
 *
 * Compares our payment ledger against the provider's settlement report and returns
 * a categorised mismatch report.
 *
 * WHY THIS IS A CALLABLE RATHER THAN A CLIENT QUERY
 *
 * The manager page previously subscribed to `trips` and `payments` directly and
 * classified them in a `useMemo`. That is fine for rendering, but a settlement
 * comparison needs the provider's secret key to fetch the report - which must never
 * reach a browser - and financial classification should be decided once, on the
 * server, not re-derived by each client.
 *
 * WHY "NO PROVIDER DATA" IS NOT AN EMPTY REPORT
 *
 * If online payments are disabled, or the selected adapter cannot supply settlement
 * data, this returns `providerAvailable: false` and compares nothing. Reporting
 * "0 mismatches" in that situation would be a lie: "we checked and found nothing"
 * and "we could not check" must never look alike to an operator.
 * ============================================================================
 */

const RequestSchema = z.object({
  /** Inclusive ISO-8601 start of the settlement window. */
  fromIso: z.string().datetime(),
  /** Exclusive ISO-8601 end. */
  toIso: z.string().datetime(),
  /** Safety cap; a reconciliation run is not a data export. */
  limit: z.number().int().positive().max(2000).default(500),
}).refine((value) => new Date(value.toIso) > new Date(value.fromIso), {
  message: 'toIso must be after fromIso',
  path: ['toIso'],
});

/** ILS is stored in whole shekels on the payment document; settlement is in agorot. */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export const managerReconcileSettlement = onCall(
  { region: REGION, memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    try {
      const managerId = getAuthenticatedUserId(request);
      if (!managerId) throw new UnauthorizedError('Authentication required');

      const profile = await assertManagerPermission(managerId, 'manage_payments');
      if (!profile.isGlobalScope) {
        throw new ForbiddenError('Only a global manager can reconcile settlements');
      }

      const parsed = RequestSchema.safeParse(request.data);
      if (!parsed.success) {
        throw new ValidationError('Invalid reconciliation request', parsed.error.flatten());
      }
      const { fromIso, toIso, limit } = parsed.data;

      // The provider may be absent (flag off) or unable to report settlements.
      // Either way, say so rather than returning an empty comparison.
      let provider;
      try {
        provider = getPaymentProvider();
      } catch (error) {
        return {
          providerAvailable: false,
          reason: error instanceof Error ? error.message : 'Payment provider misconfigured',
          comparedCount: 0,
          highRiskCount: 0,
          totals: null,
          findings: [],
        };
      }

      if (!provider || typeof provider.fetchSettlement !== 'function') {
        return {
          providerAvailable: false,
          reason: provider
            ? `Adapter "${provider.name}" cannot supply settlement data`
            : 'Online payments are disabled',
          comparedCount: 0,
          highRiskCount: 0,
          totals: null,
          findings: [],
        };
      }

      const db = getFirestore();
      const snapshot = await db
        .collection('payments')
        .where('createdAt', '>=', new Date(fromIso))
        .where('createdAt', '<', new Date(toIso))
        .limit(limit)
        .get();

      const internalPayments: InternalPaymentRecord[] = snapshot.docs.map((doc) => {
        const data = asRecord(doc.data());
        const providerChargeId = getString(data, 'providerChargeId', '');
        return {
          paymentId: doc.id,
          tripId: getString(data, 'tripId', ''),
          status: getString(data, 'status', ''),
          amountMinorUnits: toMinorUnits(getNumber(data, 'amount', 0)),
          currency: getString(data, 'currency', 'ILS'),
          ...(providerChargeId ? { providerChargeId } : {}),
        };
      });

      const settlementRows = await provider.fetchSettlement(fromIso, toIso);
      const providerRecords: ProviderSettlementRecord[] = settlementRows.map((row) => ({
        reference: row.reference,
        status: row.status,
        amountMinorUnits: row.amountMinorUnits,
        currency: row.currency,
      }));

      const report = reconcileSettlement(internalPayments, providerRecords);

      return {
        providerAvailable: true,
        provider: provider.name,
        window: { fromIso, toIso },
        comparedCount: report.comparedCount,
        highRiskCount: report.highRiskCount,
        totals: report.totals,
        // Only actionable rows are returned; a matched row is not worth the payload.
        findings: report.findings.filter((finding) => finding.category !== 'matched'),
      };
    } catch (error) {
      throw handleError(error);
    }
  }
);
