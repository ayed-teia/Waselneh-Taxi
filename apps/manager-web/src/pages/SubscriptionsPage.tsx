import { FormEvent, useEffect, useState } from 'react';

import { useI18n } from '../localization';
import {
  SubscriptionAssignment,
  SubscriptionPlan,
  assignSubscription,
  saveSubscriptionPlan,
  subscribeToAssignments,
  subscribeToPlans,
} from '../services/subscriptions.service';
import './OperationsPage.css';

export function SubscriptionsPage() {
  const { txt } = useI18n();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [assignments, setAssignments] = useState<SubscriptionAssignment[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [plan, setPlan] = useState({ nameAr: '', nameEn: '', billingModel: 'hybrid' as const, commissionBps: '1000', recurringFeeIls: '0', billingInterval: 'monthly' as const });
  const [assignment, setAssignment] = useState({ targetType: 'driver' as const, targetId: '', planId: '', status: 'active' as const, startsAt: new Date().toISOString().slice(0, 16), endsAt: '' });

  useEffect(() => {
    const unsubscribePlans = subscribeToPlans(setPlans);
    const unsubscribeAssignments = subscribeToAssignments(setAssignments);
    return () => { unsubscribePlans(); unsubscribeAssignments(); };
  }, []);

  async function submitPlan(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      await saveSubscriptionPlan({ ...plan, commissionBps: Number(plan.commissionBps), recurringFeeIls: Number(plan.recurringFeeIls), isActive: true });
      setMessage(txt('تم حفظ الخطة', 'Plan saved'));
    } catch (error) { setMessage(error instanceof Error ? error.message : txt('تعذّر الحفظ', 'Save failed')); }
    finally { setSaving(false); }
  }

  async function submitAssignment(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      await assignSubscription({ ...assignment, startsAt: new Date(assignment.startsAt).toISOString(), endsAt: assignment.endsAt ? new Date(assignment.endsAt).toISOString() : null });
      setMessage(txt('تم إسناد الاشتراك', 'Subscription assigned'));
    } catch (error) { setMessage(error instanceof Error ? error.message : txt('تعذّر الإسناد', 'Assignment failed')); }
    finally { setSaving(false); }
  }

  return <div className="operations-page">
    <h2>{txt('الاشتراكات والفوترة', 'Subscriptions & billing')}</h2>
    <p className="subtitle">{txt('إدارة خطط السائقين والمكاتب وربط العمولات.', 'Manage driver and office plans with commission rules.')}</p>
    {message ? <div className="ops-banner success">{message}</div> : null}
    <div className="ops-grid">
      <form className="ops-card" onSubmit={submitPlan}>
        <h3>{txt('خطة جديدة', 'New plan')}</h3>
        <input required placeholder={txt('الاسم بالعربية', 'Arabic name')} value={plan.nameAr} onChange={(e) => setPlan({ ...plan, nameAr: e.target.value })} />
        <input required placeholder={txt('الاسم بالإنجليزية', 'English name')} value={plan.nameEn} onChange={(e) => setPlan({ ...plan, nameEn: e.target.value })} />
        <select value={plan.billingModel} onChange={(e) => setPlan({ ...plan, billingModel: e.target.value as typeof plan.billingModel })}><option value="per_trip">Per trip</option><option value="subscription">Subscription</option><option value="hybrid">Hybrid</option></select>
        <input required type="number" min="0" max="10000" value={plan.commissionBps} onChange={(e) => setPlan({ ...plan, commissionBps: e.target.value })} placeholder="Commission BPS" />
        <input required type="number" min="0" step="0.01" value={plan.recurringFeeIls} onChange={(e) => setPlan({ ...plan, recurringFeeIls: e.target.value })} placeholder="Recurring fee ILS" />
        <button disabled={saving}>{txt('حفظ الخطة', 'Save plan')}</button>
      </form>
      <form className="ops-card" onSubmit={submitAssignment}>
        <h3>{txt('إسناد اشتراك', 'Assign subscription')}</h3>
        <select value={assignment.targetType} onChange={(e) => setAssignment({ ...assignment, targetType: e.target.value as typeof assignment.targetType })}><option value="driver">Driver</option><option value="office">Office</option></select>
        <input required placeholder={txt('معرّف السائق أو المكتب', 'Driver or office ID')} value={assignment.targetId} onChange={(e) => setAssignment({ ...assignment, targetId: e.target.value })} />
        <select required value={assignment.planId} onChange={(e) => setAssignment({ ...assignment, planId: e.target.value })}><option value="">{txt('اختر الخطة', 'Select plan')}</option>{plans.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.nameAr} — {item.commissionBps / 100}%</option>)}</select>
        <input required type="datetime-local" value={assignment.startsAt} onChange={(e) => setAssignment({ ...assignment, startsAt: e.target.value })} />
        <input type="datetime-local" value={assignment.endsAt} onChange={(e) => setAssignment({ ...assignment, endsAt: e.target.value })} />
        <button disabled={saving}>{txt('إسناد', 'Assign')}</button>
      </form>
    </div>
    <div className="ops-snapshot"><h3>{txt('الوضع الحالي', 'Current status')}</h3><div className="snapshot-grid"><div>{txt('الخطط', 'Plans')} <span>{plans.length}</span></div><div>{txt('الاشتراكات', 'Subscriptions')} <span>{assignments.length}</span></div><div>{txt('النشطة', 'Active')} <span>{assignments.filter((item) => item.status === 'active').length}</span></div></div></div>
  </div>;
}
