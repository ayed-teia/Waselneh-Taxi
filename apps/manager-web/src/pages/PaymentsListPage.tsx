import { useEffect, useState } from 'react';
import { useI18n } from '../localization';
import { PaymentDocument, subscribeToPayments } from '../services/payments.service';
import './PaymentsListPage.css';

function getStatusBadge(
  status: PaymentDocument['status'],
  txt: (ar: string, en: string) => string
): { className: string; text: string } {
  switch (status) {
    case 'paid':
      return { className: 'badge-paid', text: txt('مدفوع', 'Paid') };
    case 'pending':
      return { className: 'badge-pending', text: txt('معلّق', 'Pending') };
    case 'failed':
      return { className: 'badge-failed', text: txt('فشل', 'Failed') };
    default:
      return { className: 'badge-pending', text: status };
  }
}

function getMethodDisplay(method: PaymentDocument['method'], txt: (ar: string, en: string) => string): string {
  switch (method) {
    case 'cash':
      return txt('نقدي', 'Cash');
    case 'card':
      return txt('بطاقة', 'Card');
    case 'wallet':
      return txt('محفظة', 'Wallet');
    default:
      return method;
  }
}

function formatDate(
  timestamp: unknown,
  locale: 'ar' | 'en'
): string {
  if (!timestamp) return locale === 'ar' ? 'غير متوفر' : 'N/A';

  try {
    const raw = timestamp as { toDate?: () => Date };
    const date = raw.toDate ? raw.toDate() : new Date(timestamp as string | number | Date);
    return date.toLocaleString(locale === 'ar' ? 'ar-PS' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return locale === 'ar' ? 'غير متوفر' : 'N/A';
  }
}

export function PaymentsListPage() {
  const { txt, locale } = useI18n();
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
      <h2>{txt('المدفوعات', 'Payments')}</h2>
      <p className="payments-subtitle">
        {txt(
          'سجل مدفوعات مباشر مع حالة الدفع وطريقة السداد.',
          'Realtime payment ledger with status and method visibility.'
        )}
      </p>

      {loading ? <div className="loading">{txt('جاري تحميل المدفوعات...', 'Loading payments...')}</div> : null}

      {!loading ? (
        <>
          <div className="summary-cards">
            <div className="summary-card paid">
              <div className="summary-value">NIS {totalPaid.toFixed(2)}</div>
              <div className="summary-label">{txt(`${paidCount} مدفوع`, `${paidCount} paid`)}</div>
            </div>
            <div className="summary-card pending">
              <div className="summary-value">NIS {totalPending.toFixed(2)}</div>
              <div className="summary-label">{txt(`${pendingCount} معلّق`, `${pendingCount} pending`)}</div>
            </div>
            <div className="summary-card total">
              <div className="summary-value">{payments.length}</div>
              <div className="summary-label">{txt('إجمالي السجلات', 'Total records')}</div>
            </div>
          </div>

          {payments.length === 0 ? (
            <div className="empty-state">
              <p>{txt('لا توجد مدفوعات بعد.', 'No payments yet.')}</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th>{txt('رقم الرحلة', 'Trip ID')}</th>
                    <th>{txt('المبلغ', 'Amount')}</th>
                    <th>{txt('الطريقة', 'Method')}</th>
                    <th>{txt('الحالة', 'Status')}</th>
                    <th>{txt('تاريخ الإنشاء', 'Created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => {
                    const statusBadge = getStatusBadge(payment.status, txt);
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
                        <td className="method">{getMethodDisplay(payment.method, txt)}</td>
                        <td>
                          <span className={`status-badge ${statusBadge.className}`}>
                            {statusBadge.text}
                          </span>
                        </td>
                        <td className="date">{formatDate(payment.createdAt, locale)}</td>
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
