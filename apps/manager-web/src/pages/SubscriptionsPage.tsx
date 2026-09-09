import { FormEvent, useEffect, useMemo, useState } from 'react';

import { useI18n } from '../localization';
import {
  SubscriptionAssignment,
  SubscriptionInvoice,
  SubscriptionPlan,
  assignSubscription,
  buildSubscriptionInvoicesCsv,
  markSubscriptionInvoicePaid,
  saveSubscriptionPlan,
  subscribeToAssignments,
  subscribeToSubscriptionInvoices,
  subscribeToPlans,
} from '../services/subscriptions.service';
import './OperationsPage.css';

export function SubscriptionsPage() {
  const { txt } = useI18n();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [assignments, setAssignments] = useState<SubscriptionAssignment[]>([]);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [targetFilter, setTargetFilter] = useState<'all' | 'driver' | 'office'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | SubscriptionInvoice['status']>('all');
  const [periodFilter, setPeriodFilter] = useState('');
  const [plan, setPlan] = useState({
    nameAr: '',
    nameEn: '',
    billingModel: 'hybrid' as const,
    commissionBps: '1000',
    recurringFeeIls: '0',
    billingInterval: 'monthly' as const,
  });
  const [assignment, setAssignment] = useState({
    targetType: 'driver' as const,
    targetId: '',
    planId: '',
    status: 'active' as const,
    startsAt: new Date().toISOString().slice(0, 16),
    endsAt: '',
  });

  useEffect(() => {
    const unsubscribePlans = subscribeToPlans(setPlans);
    const unsubscribeAssignments = subscribeToAssignments(setAssignments);
    const unsubscribeInvoices = subscribeToSubscriptionInvoices(setInvoices);
    return () => {
      unsubscribePlans();
      unsubscribeAssignments();
      unsubscribeInvoices();
    };
  }, []);

  async function submitPlan(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await saveSubscriptionPlan({
        ...plan,
        commissionBps: Number(plan.commissionBps),
        recurringFeeIls: Number(plan.recurringFeeIls),
        isActive: true,
      });
      setMessageType('success');
      setMessage(txt('تم حفظ الخطة', 'Plan saved'));
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : txt('تعذّر الحفظ', 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  async function submitAssignment(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await assignSubscription({
        ...assignment,
        startsAt: new Date(assignment.startsAt).toISOString(),
        endsAt: assignment.endsAt ? new Date(assignment.endsAt).toISOString() : null,
      });
      setMessageType('success');
      setMessage(txt('تم إسناد الاشتراك', 'Subscription assigned'));
    } catch (error) {
      setMessageType('error');
      setMessage(
        error instanceof Error ? error.message : txt('تعذّر الإسناد', 'Assignment failed')
      );
    } finally {
      setSaving(false);
    }
  }

  async function payInvoice(invoice: SubscriptionInvoice) {
    const paymentReference = window
      .prompt(txt('أدخل رقم مرجع الدفعة', 'Enter payment reference'))
      ?.trim();
    if (!paymentReference) return;
    const paymentMethod = window
      .prompt(
        txt(
          'طريقة الدفع: cash أو bank_transfer أو card أو other',
          'Payment method: cash, bank_transfer, card, or other'
        ),
        'cash'
      )
      ?.trim();
    if (!paymentMethod || !['cash', 'bank_transfer', 'card', 'other'].includes(paymentMethod)) {
      setMessageType('error');
      setMessage(txt('طريقة الدفع غير صالحة', 'Invalid payment method'));
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await markSubscriptionInvoicePaid({
        invoiceId: invoice.id,
        paymentReference,
        paymentMethod: paymentMethod as 'cash' | 'bank_transfer' | 'card' | 'other',
      });
      setMessageType('success');
      setMessage(
        txt('تم تسجيل الدفعة وتحديث الاشتراك', 'Payment recorded and subscription updated')
      );
    } catch (error) {
      setMessageType('error');
      setMessage(
        error instanceof Error ? error.message : txt('تعذّر تسجيل الدفعة', 'Payment failed')
      );
    } finally {
      setSaving(false);
    }
  }

  function formatDate(invoice: SubscriptionInvoice) {
    return invoice.dueAt?.toDate().toLocaleDateString() ?? '—';
  }

  const filteredInvoices = useMemo(
    () =>
      invoices.filter(
        (invoice) =>
          (targetFilter === 'all' || invoice.targetType === targetFilter) &&
          (statusFilter === 'all' || invoice.status === statusFilter) &&
          (!periodFilter || invoice.periodKey === periodFilter)
      ),
    [invoices, periodFilter, statusFilter, targetFilter]
  );
  const outstanding = invoices.filter((item) => !['paid', 'void'].includes(item.status));
  const total = (items: SubscriptionInvoice[]) =>
    items.reduce((sum, item) => sum + item.amountIls, 0);
  const paidTotal = total(invoices.filter((item) => item.status === 'paid'));
  const outstandingTotal = total(outstanding);
  const officeDebt = total(outstanding.filter((item) => item.targetType === 'office'));
  const driverDebt = total(outstanding.filter((item) => item.targetType === 'driver'));

  function exportCsv() {
    const url = URL.createObjectURL(
      new Blob([buildSubscriptionInvoicesCsv(filteredInvoices)], { type: 'text/csv;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `subscription-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="operations-page">
      <h2>{txt('الاشتراكات والفوترة', 'Subscriptions & billing')}</h2>
      <p className="subtitle">
        {txt(
          'إدارة خطط السائقين والمكاتب وربط العمولات.',
          'Manage driver and office plans with commission rules.'
        )}
      </p>
      {message ? <div className={`ops-banner ${messageType}`}>{message}</div> : null}
      <div className="ops-grid">
        <form className="ops-card" onSubmit={submitPlan}>
          <h3>{txt('خطة جديدة', 'New plan')}</h3>
          <input
            required
            placeholder={txt('الاسم بالعربية', 'Arabic name')}
            value={plan.nameAr}
            onChange={(e) => setPlan({ ...plan, nameAr: e.target.value })}
          />
          <input
            required
            placeholder={txt('الاسم بالإنجليزية', 'English name')}
            value={plan.nameEn}
            onChange={(e) => setPlan({ ...plan, nameEn: e.target.value })}
          />
          <select
            value={plan.billingModel}
            onChange={(e) =>
              setPlan({ ...plan, billingModel: e.target.value as typeof plan.billingModel })
            }
          >
            <option value="per_trip">Per trip</option>
            <option value="subscription">Subscription</option>
            <option value="hybrid">Hybrid</option>
          </select>
          <input
            required
            type="number"
            min="0"
            max="10000"
            value={plan.commissionBps}
            onChange={(e) => setPlan({ ...plan, commissionBps: e.target.value })}
            placeholder="Commission BPS"
          />
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={plan.recurringFeeIls}
            onChange={(e) => setPlan({ ...plan, recurringFeeIls: e.target.value })}
            placeholder="Recurring fee ILS"
          />
          <button disabled={saving}>{txt('حفظ الخطة', 'Save plan')}</button>
        </form>
        <form className="ops-card" onSubmit={submitAssignment}>
          <h3>{txt('إسناد اشتراك', 'Assign subscription')}</h3>
          <select
            value={assignment.targetType}
            onChange={(e) =>
              setAssignment({
                ...assignment,
                targetType: e.target.value as typeof assignment.targetType,
              })
            }
          >
            <option value="driver">Driver</option>
            <option value="office">Office</option>
          </select>
          <input
            required
            placeholder={txt('معرّف السائق أو المكتب', 'Driver or office ID')}
            value={assignment.targetId}
            onChange={(e) => setAssignment({ ...assignment, targetId: e.target.value })}
          />
          <select
            required
            value={assignment.planId}
            onChange={(e) => setAssignment({ ...assignment, planId: e.target.value })}
          >
            <option value="">{txt('اختر الخطة', 'Select plan')}</option>
            {plans
              .filter((item) => item.isActive)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nameAr} — {item.commissionBps / 100}%
                </option>
              ))}
          </select>
          <input
            required
            type="datetime-local"
            value={assignment.startsAt}
            onChange={(e) => setAssignment({ ...assignment, startsAt: e.target.value })}
          />
          <input
            type="datetime-local"
            value={assignment.endsAt}
            onChange={(e) => setAssignment({ ...assignment, endsAt: e.target.value })}
          />
          <button disabled={saving}>{txt('إسناد', 'Assign')}</button>
        </form>
      </div>
      <div className="ops-snapshot">
        <h3>{txt('الملخص المالي', 'Financial summary')}</h3>
        <div className="snapshot-grid">
          <div>
            {txt('المحصّل', 'Collected')} <span>₪{paidTotal.toFixed(2)}</span>
          </div>
          <div>
            {txt('إجمالي الديون', 'Outstanding')} <span>₪{outstandingTotal.toFixed(2)}</span>
          </div>
          <div>
            {txt('ديون المكاتب', 'Office debt')} <span>₪{officeDebt.toFixed(2)}</span>
          </div>
          <div>
            {txt('ديون السائقين', 'Driver debt')} <span>₪{driverDebt.toFixed(2)}</span>
          </div>
          <div>
            {txt('الاشتراكات النشطة', 'Active subscriptions')}{' '}
            <span>{assignments.filter((item) => item.status === 'active').length}</span>
          </div>
        </div>
      </div>
      <section className="ops-snapshot">
        <h3>{txt('فواتير الاشتراكات', 'Subscription invoices')}</h3>
        <div className="billing-filters">
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value as typeof targetFilter)}
          >
            <option value="all">{txt('كل الجهات', 'All targets')}</option>
            <option value="driver">{txt('السائقون', 'Drivers')}</option>
            <option value="office">{txt('المكاتب', 'Offices')}</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">{txt('كل الحالات', 'All statuses')}</option>
            <option value="pending">pending</option>
            <option value="past_due">past_due</option>
            <option value="suspended">suspended</option>
            <option value="paid">paid</option>
            <option value="void">void</option>
          </select>
          <input
            type="month"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
          />
          <button onClick={exportCsv}>{txt('تصدير كشف CSV', 'Export CSV')}</button>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>{txt('الفترة', 'Period')}</th>
                <th>{txt('الجهة', 'Target')}</th>
                <th>{txt('القيمة', 'Amount')}</th>
                <th>{txt('الاستحقاق', 'Due')}</th>
                <th>{txt('الحالة', 'Status')}</th>
                <th>{txt('الإجراء', 'Action')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.periodKey}</td>
                  <td>
                    {invoice.targetType} · {invoice.targetId}
                  </td>
                  <td>
                    {invoice.amountIls.toFixed(2)} {invoice.currency}
                  </td>
                  <td>{formatDate(invoice)}</td>
                  <td>
                    <span className={`invoice-status ${invoice.status}`}>{invoice.status}</span>
                  </td>
                  <td>
                    {invoice.status === 'paid' ? (
                      <span>{invoice.paymentReference ?? '—'}</span>
                    ) : invoice.status === 'void' ? (
                      '—'
                    ) : (
                      <button
                        className="inline-action"
                        disabled={saving}
                        onClick={() => void payInvoice(invoice)}
                      >
                        {txt('تسجيل دفعة', 'Record payment')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!filteredInvoices.length ? (
                <tr>
                  <td colSpan={6}>{txt('لا توجد فواتير مطابقة', 'No matching invoices')}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
