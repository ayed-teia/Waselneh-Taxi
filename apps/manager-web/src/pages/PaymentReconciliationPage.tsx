import { useEffect, useMemo, useState } from 'react';

import { subscribeToPayments, type PaymentDocument } from '../services/payments.service';
import {
  subscribeToCompletedTrips,
  getPaymentStatusDisplay,
  type TripData,
} from '../services/trips.service';

/**
 * ============================================================================
 * PAYMENT RECONCILIATION
 * ============================================================================
 *
 * READ-ONLY. This page opens no new write path: it subscribes to `trips` and
 * `payments`, both of which are `allow write: if false` for clients, and joins
 * them in the browser. Every mutation still belongs to a Cloud Function.
 *
 * WHY THIS EXISTS
 * A completed trip records its own `paymentStatus`, and a separate `payments`
 * document records the money. Nothing was comparing the two, so the states that
 * actually matter operationally were invisible:
 *
 *   - COLLECTED    trip says paid, and a matching paid payment exists.  Healthy.
 *   - UNCOLLECTED  trip completed but still pending. Real money owed by a
 *                  passenger, or a driver who has not confirmed cash.
 *   - UNRECORDED   trip says paid but there is NO payment document. The books
 *                  and the trip disagree - this is the one to chase.
 *   - ORPHANED     a payment exists whose trip is missing or not completed.
 *
 * Note that `confirmCashPayment` was until recently never deployed at all (R6),
 * so historical trips may legitimately sit in UNCOLLECTED. That is a data
 * artefact, not necessarily a driver failing to collect.
 * ============================================================================
 */

type ReconcileState = 'collected' | 'uncollected' | 'unrecorded';

interface ReconciledRow {
  tripId: string;
  driverId: string | null;
  passengerId: string;
  fareAmount: number;
  tripPaymentStatus: string;
  paymentMethod: string;
  completedAt: Date | null;
  paidAt: Date | null;
  payment: PaymentDocument | null;
  state: ReconcileState;
}

const STATE_LABEL: Record<ReconcileState, { label: string; color: string; hint: string }> = {
  collected: {
    label: 'Collected',
    color: '#059669',
    hint: 'Trip is paid and a matching payment record exists.',
  },
  uncollected: {
    label: 'Uncollected',
    color: '#d97706',
    hint: 'Trip completed but payment is still pending - money may be owed.',
  },
  unrecorded: {
    label: 'Unrecorded',
    color: '#dc2626',
    hint: 'Trip is marked paid but has no payment document - the books disagree.',
  },
};

function formatIls(amount: number): string {
  return `₪${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
}

function formatDate(value: Date | null): string {
  return value ? value.toLocaleString() : '—';
}

export function PaymentReconciliationPage() {
  const [trips, setTrips] = useState<TripData[]>([]);
  const [payments, setPayments] = useState<PaymentDocument[]>([]);
  const [tripsError, setTripsError] = useState<string | null>(null);
  // subscribeToPayments logs its own errors and exposes no error callback, so a
  // payments failure surfaces as an empty ledger rather than a banner here. Every
  // trip would then read "Unrecorded", which is visibly wrong rather than silently
  // wrong - acceptable for now, but worth an onError parameter on that service.
  const paymentsError: string | null = null;
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | ReconcileState>('all');

  useEffect(() => {
    const unsubscribe = subscribeToCompletedTrips(
      (data) => {
        setTrips(data);
        setLoading(false);
      },
      (error) => {
        setTripsError(error.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToPayments((data) => setPayments(data), 500);
    return () => unsubscribe();
  }, []);

  // Index payments by trip so the join is O(n) rather than O(n*m).
  const paymentsByTrip = useMemo(() => {
    const map = new Map<string, PaymentDocument>();
    for (const payment of payments) {
      if (payment.tripId) map.set(payment.tripId, payment);
    }
    return map;
  }, [payments]);

  const rows = useMemo<ReconciledRow[]>(() => {
    return trips.map((trip) => {
      const payment = paymentsByTrip.get(trip.tripId) ?? null;
      const tripSaysPaid = trip.paymentStatus === 'paid';

      let state: ReconcileState;
      if (tripSaysPaid && payment) state = 'collected';
      else if (tripSaysPaid && !payment) state = 'unrecorded';
      else state = 'uncollected';

      return {
        tripId: trip.tripId,
        driverId: trip.driverId,
        passengerId: trip.passengerId,
        fareAmount: trip.fareAmount,
        tripPaymentStatus: trip.paymentStatus,
        paymentMethod: trip.paymentMethod,
        completedAt: trip.completedAt,
        paidAt: trip.paidAt,
        payment,
        state,
      };
    });
  }, [trips, paymentsByTrip]);

  // A payment whose trip is not in the completed set at all.
  const orphanedPayments = useMemo(() => {
    const tripIds = new Set(trips.map((t) => t.tripId));
    return payments.filter((p) => p.tripId && !tripIds.has(p.tripId));
  }, [payments, trips]);

  const totals = useMemo(() => {
    const sum = (predicate: (row: ReconciledRow) => boolean) =>
      rows.filter(predicate).reduce((acc, row) => acc + (row.fareAmount || 0), 0);
    return {
      collectedCount: rows.filter((r) => r.state === 'collected').length,
      collectedAmount: sum((r) => r.state === 'collected'),
      uncollectedCount: rows.filter((r) => r.state === 'uncollected').length,
      uncollectedAmount: sum((r) => r.state === 'uncollected'),
      unrecordedCount: rows.filter((r) => r.state === 'unrecorded').length,
      unrecordedAmount: sum((r) => r.state === 'unrecorded'),
    };
  }, [rows]);

  const visibleRows = useMemo(
    () => (filter === 'all' ? rows : rows.filter((row) => row.state === filter)),
    [rows, filter]
  );

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Payment Reconciliation</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>
        Completed trips cross-referenced against the payments ledger. Read-only.
      </p>

      {tripsError && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8 }}>
          Failed to load trips: {tripsError}
        </div>
      )}
      {paymentsError && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8 }}>
          Failed to load payments: {paymentsError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '20px 0' }}>
        {(['collected', 'uncollected', 'unrecorded'] as const).map((state) => {
          const meta = STATE_LABEL[state];
          const count =
            state === 'collected'
              ? totals.collectedCount
              : state === 'uncollected'
                ? totals.uncollectedCount
                : totals.unrecordedCount;
          const amount =
            state === 'collected'
              ? totals.collectedAmount
              : state === 'uncollected'
                ? totals.uncollectedAmount
                : totals.unrecordedAmount;
          return (
            <div
              key={state}
              title={meta.hint}
              style={{
                border: `1px solid ${meta.color}33`,
                borderLeft: `4px solid ${meta.color}`,
                borderRadius: 8,
                padding: '12px 16px',
                minWidth: 180,
                background: '#fff',
              }}
            >
              <div style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{formatIls(amount)}</div>
              <div style={{ color: '#6b7280', fontSize: 13 }}>{count} trip(s)</div>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 12 }}>
        {(['all', 'collected', 'uncollected', 'unrecorded'] as const).map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            style={{
              marginRight: 8,
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              background: filter === value ? '#111827' : '#fff',
              color: filter === value ? '#fff' : '#111827',
              cursor: 'pointer',
            }}
          >
            {value === 'all' ? 'All' : STATE_LABEL[value].label}
          </button>
        ))}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : visibleRows.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No trips in this category.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>State</th>
                <th style={{ padding: 8 }}>Trip</th>
                <th style={{ padding: 8 }}>Driver</th>
                <th style={{ padding: 8 }}>Fare</th>
                <th style={{ padding: 8 }}>Method</th>
                <th style={{ padding: 8 }}>Trip status</th>
                <th style={{ padding: 8 }}>Ledger</th>
                <th style={{ padding: 8 }}>Completed</th>
                <th style={{ padding: 8 }}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const meta = STATE_LABEL[row.state];
                const tripStatus = getPaymentStatusDisplay(row.tripPaymentStatus);
                return (
                  <tr key={row.tripId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 8 }}>
                      <span
                        title={meta.hint}
                        style={{
                          color: meta.color,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
                      {row.tripId}
                    </td>
                    <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
                      {row.driverId ?? '—'}
                    </td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{formatIls(row.fareAmount)}</td>
                    <td style={{ padding: 8 }}>{row.paymentMethod}</td>
                    <td style={{ padding: 8 }}>
                      {tripStatus.emoji} {tripStatus.label}
                    </td>
                    <td style={{ padding: 8 }}>
                      {row.payment
                        ? `${row.payment.status} · ${formatIls(row.payment.amount)}`
                        : '— none —'}
                    </td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                      {formatDate(row.completedAt)}
                    </td>
                    <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{formatDate(row.paidAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {orphanedPayments.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18 }}>Orphaned payments ({orphanedPayments.length})</h2>
          <p style={{ color: '#6b7280', marginTop: 0 }}>
            Payment records whose trip is missing, or is not in the completed set.
          </p>
          <ul>
            {orphanedPayments.map((payment) => (
              <li key={payment.paymentId} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {payment.paymentId} · trip {payment.tripId} · {payment.status} ·{' '}
                {formatIls(payment.amount)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default PaymentReconciliationPage;
