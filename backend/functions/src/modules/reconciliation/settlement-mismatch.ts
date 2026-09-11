/**
 * ============================================================================
 * PROVIDER SETTLEMENT RECONCILIATION - MISMATCH TAXONOMY
 * ============================================================================
 *
 * Compares OUR payment ledger against the PROVIDER's settlement report. This is a
 * different question from trip-payment-classification.ts, which only ever compares
 * our trips to our own payments and so can never detect that the processor thinks
 * something different from us.
 *
 * Pure - no Firestore, no network, no clock. Every category below is therefore
 * unit-testable against fixtures, which matters because the real evidence (an
 * actual Lahza settlement file) cannot be obtained without live credentials.
 *
 * WHY MONEY IS COMPARED IN MINOR UNITS
 *
 * Settlement amounts arrive in agorot. Comparing floats would make 12.30 != 12.30
 * on some inputs, so every comparison here is integer-on-integer. Callers convert
 * once, at the boundary.
 *
 * WHY AN UNKNOWN CATEGORY IS NOT AN ERROR
 *
 * A reconciliation run that throws on the first surprise tells an operator nothing
 * about the other 4,000 rows. Each row is classified independently and the run
 * always completes; severity is what drives attention.
 * ============================================================================
 */

/**
 * What went wrong between our ledger and the provider's.
 *
 * `matched` is included deliberately so a run reports coverage rather than only
 * exceptions - "0 mismatches" is meaningless if nothing was compared.
 */
export type MismatchCategory =
  | 'matched'
  | 'internal_paid_provider_missing'
  | 'provider_paid_internal_pending'
  | 'amount_mismatch'
  | 'duplicate_provider_reference'
  | 'refund_mismatch'
  | 'currency_mismatch'
  | 'orphan_provider_payment';

/** How hard an operator should look. Drives alerting, not correctness. */
export type MismatchSeverity = 'none' | 'low' | 'high';

/** Our side of the comparison. */
export interface InternalPaymentRecord {
  paymentId: string;
  tripId: string;
  /** Our recorded state: pending | paid | refunded | failed | cancelled. */
  status: string;
  amountMinorUnits: number;
  currency: string;
  /** The provider's own reference, when a charge was actually created. */
  providerChargeId?: string | null;
}

/** The provider's side, as parsed from a settlement report. */
export interface ProviderSettlementRecord {
  /** The provider's transaction reference. */
  reference: string;
  /** Normalised provider state: paid | refunded | failed. */
  status: string;
  amountMinorUnits: number;
  currency: string;
  /** Our trip id, recovered from the reference where the adapter can do so. */
  tripId?: string | null;
}

export interface MismatchFinding {
  category: MismatchCategory;
  severity: MismatchSeverity;
  tripId: string | null;
  paymentId: string | null;
  providerReference: string | null;
  internalAmountMinorUnits: number | null;
  providerAmountMinorUnits: number | null;
  detail: string;
}

const HIGH_RISK: ReadonlySet<MismatchCategory> = new Set<MismatchCategory>([
  // Money the provider has that we have not recorded, or vice versa.
  'internal_paid_provider_missing',
  'provider_paid_internal_pending',
  'amount_mismatch',
  'duplicate_provider_reference',
  'orphan_provider_payment',
]);

export function severityFor(category: MismatchCategory): MismatchSeverity {
  if (category === 'matched') return 'none';
  return HIGH_RISK.has(category) ? 'high' : 'low';
}

function normaliseStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normaliseCurrency(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function toMinorUnits(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

/**
 * Compare one internal payment against its provider counterpart.
 *
 * `provider` is null when the settlement report contains no row for it.
 */
export function classifyPaymentAgainstSettlement(
  internal: InternalPaymentRecord,
  provider: ProviderSettlementRecord | null
): MismatchFinding {
  const internalStatus = normaliseStatus(internal.status);
  const internalAmount = toMinorUnits(internal.amountMinorUnits);

  const base = {
    tripId: internal.tripId || null,
    paymentId: internal.paymentId || null,
    providerReference: provider?.reference ?? internal.providerChargeId ?? null,
    internalAmountMinorUnits: internalAmount,
    providerAmountMinorUnits: provider ? toMinorUnits(provider.amountMinorUnits) : null,
  };

  if (!provider) {
    // We believe we were paid but the processor has no record of it. This is the
    // one that costs real money, so it is high severity even though it is often a
    // timing artefact of a report that has not settled yet.
    if (internalStatus === 'paid') {
      return {
        ...base,
        category: 'internal_paid_provider_missing',
        severity: severityFor('internal_paid_provider_missing'),
        detail: 'Marked paid internally but absent from the provider settlement report.',
      };
    }
    // Not paid on our side and absent on theirs: consistent, nothing to report.
    return {
      ...base,
      category: 'matched',
      severity: 'none',
      detail: 'Not paid internally and not present in the settlement report.',
    };
  }

  const providerStatus = normaliseStatus(provider.status);
  const providerAmount = toMinorUnits(provider.amountMinorUnits);

  if (normaliseCurrency(internal.currency) !== normaliseCurrency(provider.currency)) {
    return {
      ...base,
      category: 'currency_mismatch',
      severity: severityFor('currency_mismatch'),
      detail: `Currency differs: internal ${internal.currency}, provider ${provider.currency}.`,
    };
  }

  // Refund disagreements are tested BEFORE the paid check. An internally-refunded
  // payment that the provider still reports as paid also satisfies
  // `providerStatus === paid && internalStatus !== paid`, so checking paid first
  // misfiled it as provider_paid_internal_pending - whose remedy is to record a
  // payment, on money we have already returned.
  if (providerStatus === 'refunded' && internalStatus !== 'refunded') {
    return {
      ...base,
      category: 'refund_mismatch',
      severity: severityFor('refund_mismatch'),
      detail: `Provider reports refunded, internal status is "${internalStatus || 'unknown'}".`,
    };
  }

  if (internalStatus === 'refunded' && providerStatus !== 'refunded') {
    return {
      ...base,
      category: 'refund_mismatch',
      severity: severityFor('refund_mismatch'),
      detail: `Internal status is refunded, provider reports "${providerStatus || 'unknown'}".`,
    };
  }

  if (providerStatus === 'paid' && internalStatus !== 'paid') {
    // The processor took the passenger's money and we never recorded it - most
    // often a webhook we failed to process.
    return {
      ...base,
      category: 'provider_paid_internal_pending',
      severity: severityFor('provider_paid_internal_pending'),
      detail: `Provider reports paid, internal status is "${internalStatus || 'unknown'}".`,
    };
  }

  if (internalAmount !== null && providerAmount !== null && internalAmount !== providerAmount) {
    return {
      ...base,
      category: 'amount_mismatch',
      severity: severityFor('amount_mismatch'),
      detail: `Amount differs: internal ${internalAmount}, provider ${providerAmount} (minor units).`,
    };
  }

  return {
    ...base,
    category: 'matched',
    severity: 'none',
    detail: 'Internal ledger agrees with the provider settlement.',
  };
}

export interface ReconciliationReport {
  findings: MismatchFinding[];
  totals: Record<MismatchCategory, number>;
  comparedCount: number;
  highRiskCount: number;
}

function emptyTotals(): Record<MismatchCategory, number> {
  return {
    matched: 0,
    internal_paid_provider_missing: 0,
    provider_paid_internal_pending: 0,
    amount_mismatch: 0,
    duplicate_provider_reference: 0,
    refund_mismatch: 0,
    currency_mismatch: 0,
    orphan_provider_payment: 0,
  };
}

/**
 * Reconcile a batch of internal payments against a settlement report.
 *
 * Every internal payment yields exactly one finding, so the report always
 * accounts for the full input. Provider rows left over at the end - references we
 * have no payment for - are reported as orphans, and duplicate references in the
 * provider file are flagged rather than silently collapsed.
 */
export function reconcileSettlement(
  internalPayments: readonly InternalPaymentRecord[],
  providerRecords: readonly ProviderSettlementRecord[]
): ReconciliationReport {
  const byReference = new Map<string, ProviderSettlementRecord>();
  const duplicateReferences = new Set<string>();

  for (const record of providerRecords) {
    const reference = typeof record.reference === 'string' ? record.reference.trim() : '';
    if (!reference) continue;
    if (byReference.has(reference)) {
      // The same reference twice in one report can mean a double capture. Never
      // collapse it silently - that is how a duplicate charge goes unnoticed.
      duplicateReferences.add(reference);
      continue;
    }
    byReference.set(reference, record);
  }

  const findings: MismatchFinding[] = [];
  const totals = emptyTotals();
  const consumedReferences = new Set<string>();

  for (const internal of internalPayments) {
    const reference =
      typeof internal.providerChargeId === 'string' ? internal.providerChargeId.trim() : '';
    const provider = reference ? (byReference.get(reference) ?? null) : null;
    if (reference && provider) consumedReferences.add(reference);

    let finding = classifyPaymentAgainstSettlement(internal, provider);

    if (reference && duplicateReferences.has(reference)) {
      finding = {
        ...finding,
        category: 'duplicate_provider_reference',
        severity: severityFor('duplicate_provider_reference'),
        detail: `Reference ${reference} appears more than once in the settlement report.`,
      };
      consumedReferences.add(reference);
    }

    findings.push(finding);
    totals[finding.category] += 1;
  }

  // Provider rows nothing internal claimed.
  for (const [reference, record] of byReference) {
    if (consumedReferences.has(reference)) continue;
    const finding: MismatchFinding = {
      category: 'orphan_provider_payment',
      severity: severityFor('orphan_provider_payment'),
      tripId: record.tripId ?? null,
      paymentId: null,
      providerReference: reference,
      internalAmountMinorUnits: null,
      providerAmountMinorUnits: toMinorUnits(record.amountMinorUnits),
      detail: 'Settlement row has no matching internal payment record.',
    };
    findings.push(finding);
    totals[finding.category] += 1;
  }

  return {
    findings,
    totals,
    comparedCount: internalPayments.length,
    highRiskCount: findings.filter((finding) => finding.severity === 'high').length,
  };
}
