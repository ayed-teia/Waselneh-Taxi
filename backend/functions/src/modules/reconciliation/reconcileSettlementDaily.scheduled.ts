import { FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { getFirestore } from '../../core/config';
import { REGION } from '../../core/env';
import { asRecord, getNumber, getString } from '../../core/firestore/doc-data';
import { logger } from '../../core/logger';
import { getPaymentProvider } from '../payments';

import {
  type InternalPaymentRecord,
  type ProviderSettlementRecord,
  reconcileSettlement,
} from './settlement-mismatch';

/**
 * ============================================================================
 * DAILY SETTLEMENT RECONCILIATION - scaffold
 * ============================================================================
 *
 * Compares yesterday's payment ledger against the provider's settlement report and
 * raises an ops alert when high-risk mismatches are found.
 *
 * WHY THIS IS OFF BY DEFAULT, AND WHY THAT NEEDS NO NEW FLAG
 *
 * The gate is the existing ONLINE_PAYMENTS_ENABLED. With it unset - the default,
 * everywhere - `getPaymentProvider()` returns null, this function logs that it was
 * skipped and returns having written nothing. A second, reconciliation-specific flag
 * would only create a state where reconciliation is "on" while payments are off,
 * which cannot mean anything useful.
 *
 * WHY IT STILL DOES NOTHING EVEN WITH PAYMENTS ENABLED
 *
 * No adapter implements `fetchSettlement` yet. `fetchSettlement` is deliberately
 * OPTIONAL on PaymentProvider, and LahzaProvider deliberately does not implement it:
 * no Lahza credentials exist, so the real settlement report format is unknown and
 * unverifiable. Writing a parser against a guessed format - and scheduling it to
 * raise financial alerts - would be fabricated evidence of a working control.
 *
 * So this is a scaffold in the honest sense: the schedule, the window arithmetic,
 * the alerting and the audit trail are real and tested; the one missing piece is the
 * provider call, and its absence is reported rather than hidden.
 *
 * WHAT RUNS WHEN THE ADAPTER LANDS
 *
 * Implementing `fetchSettlement` on the adapter is the only change needed here.
 * ============================================================================
 */

const ALERT_ID_SETTLEMENT_MISMATCH = 'settlement_mismatch';

/** A run that compared nothing must never resolve a standing alert. */
interface SkipReason {
  skipped: true;
  reason: string;
}

/** ILS is stored in whole shekels on the payment document; settlement is in agorot. */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Yesterday, as a half-open [from, to) UTC window.
 *
 * Half-open so a payment on the boundary is counted once and only once: a closed
 * window double-counts it across two consecutive days, which shows up later as a
 * phantom duplicate in the totals.
 */
export function previousUtcDayWindow(nowMs: number): { fromIso: string; toIso: string } {
  const now = new Date(nowMs);
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  return {
    fromIso: new Date(startOfYesterday).toISOString(),
    toIso: new Date(startOfToday).toISOString(),
  };
}

async function upsertMismatchAlert(
  highRiskCount: number,
  comparedCount: number,
  window: { fromIso: string; toIso: string },
  totals: Record<string, number>
): Promise<void> {
  const db = getFirestore();
  const ref = db.collection('opsAlerts').doc(ALERT_ID_SETTLEMENT_MISMATCH);
  const existing = await ref.get();

  // Category counts only - never a trip id, passenger id or amount. This document is
  // read by the ops console; the detail belongs in the run record, not the alert.
  const payload = {
    title: 'Settlement mismatches detected',
    message: `${highRiskCount} high-risk mismatch(es) across ${comparedCount} compared payment(s).`,
    severity: 'critical' as const,
    details: { window, comparedCount, highRiskCount, totals },
    status: 'open' as const,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (existing.exists && existing.data()?.status === 'open') {
    await ref.set(payload, { merge: true });
    return;
  }

  await ref.set(
    {
      alertId: ALERT_ID_SETTLEMENT_MISMATCH,
      ...payload,
      acknowledgedAt: null,
      acknowledgedBy: null,
      openedAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
    },
    { merge: true }
  );
}

async function resolveMismatchAlert(): Promise<void> {
  const db = getFirestore();
  const ref = db.collection('opsAlerts').doc(ALERT_ID_SETTLEMENT_MISMATCH);
  const existing = await ref.get();
  if (!existing.exists || existing.data()?.status !== 'open') return;
  await ref.set(
    {
      status: 'resolved',
      resolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * The body, extracted from the schedule so it is callable from a test without a
 * Pub/Sub trigger. Returns either a skip reason or the run summary.
 */
export async function runDailyReconciliation(
  nowMs: number
): Promise<SkipReason | { skipped: false; comparedCount: number; highRiskCount: number }> {
  const window = previousUtcDayWindow(nowMs);

  let provider;
  try {
    provider = getPaymentProvider();
  } catch (error) {
    // Misconfiguration (payments on, secret missing) must be loud, and must NOT
    // resolve a standing alert - we learned nothing about the money.
    const reason = error instanceof Error ? error.message : 'Payment provider misconfigured';
    logger.error('[Reconciliation] Provider unavailable; run skipped', { reason, window });
    return { skipped: true, reason };
  }

  if (!provider) {
    logger.info('[Reconciliation] Online payments disabled; nothing to reconcile', { window });
    return { skipped: true, reason: 'Online payments are disabled' };
  }

  if (typeof provider.fetchSettlement !== 'function') {
    logger.warn('[Reconciliation] Adapter cannot supply settlement data; run skipped', {
      provider: provider.name,
      window,
    });
    return {
      skipped: true,
      reason: `Adapter "${provider.name}" cannot supply settlement data`,
    };
  }

  const db = getFirestore();
  const snapshot = await db
    .collection('payments')
    .where('createdAt', '>=', new Date(window.fromIso))
    .where('createdAt', '<', new Date(window.toIso))
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

  const settlementRows = await provider.fetchSettlement(window.fromIso, window.toIso);
  const providerRecords: ProviderSettlementRecord[] = settlementRows.map((row) => ({
    reference: row.reference,
    status: row.status,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
  }));

  const report = reconcileSettlement(internalPayments, providerRecords);

  // The run record is the audit trail: server timestamps, category counts, and the
  // window. Findings carry uids and amounts, so they stay in this server-only
  // collection rather than on the broadly-read alert document.
  await db.collection('settlementReconciliationRuns').add({
    window,
    provider: provider.name,
    comparedCount: report.comparedCount,
    highRiskCount: report.highRiskCount,
    totals: report.totals,
    findings: report.findings.filter((finding) => finding.category !== 'matched'),
    createdAt: FieldValue.serverTimestamp(),
  });

  if (report.highRiskCount > 0) {
    await upsertMismatchAlert(report.highRiskCount, report.comparedCount, window, report.totals);
  } else {
    await resolveMismatchAlert();
  }

  logger.info('[Reconciliation] Daily run complete', {
    window,
    comparedCount: report.comparedCount,
    highRiskCount: report.highRiskCount,
  });

  return {
    skipped: false,
    comparedCount: report.comparedCount,
    highRiskCount: report.highRiskCount,
  };
}

export const reconcileSettlementDaily = onSchedule(
  {
    region: REGION,
    // 03:00 Asia/Hebron - after the provider's own day has closed, before office hours.
    schedule: '0 3 * * *',
    timeZone: 'Asia/Hebron',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    try {
      await runDailyReconciliation(Date.now());
    } catch (error) {
      // Never rethrow into an infinite retry on a financial report; the alert and the
      // log are the signal.
      logger.error('[Reconciliation] Daily run failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
