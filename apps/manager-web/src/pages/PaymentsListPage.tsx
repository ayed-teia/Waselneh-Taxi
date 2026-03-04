import { useEffect, useState } from 'react';
import { PaymentDocument, subscribeToPayments } from '../services/payments.service';
import './PaymentsListPage.css';

function getStatusBadge(status: PaymentDocument['status']): { className: string; text: string } {
  switch (status) {
    case 'paid':
      return { className: 'badge-paid', text: 'Paid' };
    case 'pending':
      return { className: 'badge-pending', text: 'Pending' };
    case 'failed':
      return { className: 'badge-failed', text: 'Failed' };
    default:
      return { className: 'badge-pending', text: status };
  }
}

function getMethodDisplay(method: PaymentDocument['method']): string {
  switch (method) {
    case 'cash':
      return 'Cash';
    case 'card':
      return 'Card';
    case 'wallet':
      return 'Wallet';
    default:
      return method;
  }
}

function formatDate(timestamp: unknown): string {
  if (!timestamp) return 'N/A';

  try {
    const raw = timestamp as { toDate?: () => Date };
    const date = raw.toDate ? raw.toDate() : new Date(timestamp as string | number | Date);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'N/A';
  }
}

export function PaymentsListPage() {
  const [payments, setPayments] = useState<PaymentDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToPayments((newPayments) => {
      setPayments(newPayments);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const totalPaid = payments
    .filter((payment) => payment.status === 'paid')
    .reduce((sum, payment) => sum + payment.amount, 0);
  const totalPending = payments
    .filter((payment) => payment.status === 'pending')
    .reduce((sum, payment) => sum + payment.amount, 0);
  const paidCount = payments.filter((payment) => payment.status === 'paid').length;
  const pendingCount = payments.filter((payment) => payment.status === 'pending').length;

  return (
    <div className="payments-page">
      <h2>Payments</h2>
      <p className="payments-subtitle">Realtime payment ledger with status and method visibility.</p>

      {loading ? <div className="loading">Loading payments...</div> : null}

      {!loading ? (
        <>
          <div className="summary-cards">
            <div className="summary-card paid">
              <div className="summary-value">NIS {totalPaid.toFixed(2)}</div>
              <div className="summary-label">{paidCount} paid</div>
            </div>
            <div className="summary-card pending">
              <div className="summary-value">NIS {totalPending.toFixed(2)}</div>
              <div className="summary-label">{pendingCount} pending</div>
            </div>
            <div className="summary-card total">
              <div className="summary-value">{payments.length}</div>
              <div className="summary-label">Total records</div>
            </div>
          </div>

          {payments.length === 0 ? (
            <div className="empty-state">
              <p>No payments yet.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th>Trip ID</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => {
                    const statusBadge = getStatusBadge(payment.status);
                    return (
                      <tr key={payment.paymentId}>
                        <td className="trip-id">
                          {payment.tripId.length > 20
                            ? `${payment.tripId.slice(0, 8)}...`
                            : payment.tripId}
                        </td>
                        <td className="amount">
                          <span className="currency">{payment.currency ?? 'NIS'}</span>
                          {payment.amount.toFixed(2)}
                        </td>
                        <td className="method">{getMethodDisplay(payment.method)}</td>
                        <td>
                          <span className={`status-badge ${statusBadge.className}`}>
                            {statusBadge.text}
                          </span>
                        </td>
                        <td className="date">{formatDate(payment.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
