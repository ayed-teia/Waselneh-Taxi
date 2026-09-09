import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '../localization';
import { CommissionRecord, CommissionSettlement, createDriverSettlement, markSettlementPaid, subscribeToCommissions, subscribeToSettlements } from '../services/commissions.service';

import './PaymentsListPage.css';

export function CommissionsPage() {
  const { txt } = useI18n();
  const [records, setRecords] = useState<CommissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [settlements, setSettlements] = useState<CommissionSettlement[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => subscribeToCommissions((items) => { setRecords(items); setLoading(false); }), []);
  useEffect(() => subscribeToSettlements(setSettlements), []);
  const totals = useMemo(() => records.reduce((sum, item) => ({
    gross: sum.gross + item.grossFareIls,
    commission: sum.commission + item.commissionIls,
    net: sum.net + item.driverNetIls,
  }), { gross: 0, commission: 0, net: 0 }), [records]);
  const pendingByDriver = useMemo(() => records.filter((item) => item.status === 'pending').reduce<Record<string, string[]>>((groups, item) => {
    (groups[item.driverId] ??= []).push(item.id); return groups;
  }, {}), [records]);
  const periodKey = new Date().toISOString().slice(0, 7);

  return <div className="payments-page">
    <h2>{txt('العمولات والمستحقات', 'Commissions & settlements')}</h2>
    <p>{txt('سجل محاسبي مباشر لكل رحلة مكتملة.', 'Auditable ledger for every completed trip.')}</p>
    {loading ? <p>{txt('جاري التحميل...', 'Loading...')}</p> : <>
      <div className="summary-cards">
        <div className="summary-card total"><div className="summary-value">NIS {totals.gross.toFixed(2)}</div><div>{txt('إجمالي الأجرة', 'Gross fares')}</div></div>
        <div className="summary-card pending"><div className="summary-value">NIS {totals.commission.toFixed(2)}</div><div>{txt('عمولة المنصة', 'Platform commission')}</div></div>
        <div className="summary-card paid"><div className="summary-value">NIS {totals.net.toFixed(2)}</div><div>{txt('صافي السائقين', 'Driver net')}</div></div>
      </div>
      <div className="summary-card">
        <h3>{txt('إنشاء تسويات الشهر', 'Create monthly settlements')}</h3>
        {Object.entries(pendingByDriver).map(([driverId, ids]) => <button key={driverId} disabled={saving} onClick={async () => { setSaving(true); try { await createDriverSettlement(driverId, periodKey, ids.slice(0, 100)); } finally { setSaving(false); } }}>{txt(`تسوية ${driverId.slice(0, 10)} (${ids.length} رحلة)`, `Settle ${driverId.slice(0, 10)} (${ids.length} trips)`)}</button>)}
        {Object.keys(pendingByDriver).length === 0 ? <p>{txt('لا توجد عمولات معلقة.', 'No pending commissions.')}</p> : null}
      </div>
      <div className="table-container"><table className="payments-table"><thead><tr><th>{txt('التسوية', 'Settlement')}</th><th>{txt('الفترة', 'Period')}</th><th>{txt('المستفيد', 'Payee')}</th><th>{txt('المبلغ', 'Amount')}</th><th>{txt('الحالة', 'Status')}</th></tr></thead><tbody>{settlements.map((item) => <tr key={item.id}><td>{item.id.slice(0, 14)}</td><td>{item.periodKey}</td><td>{item.targetId.slice(0, 10)}</td><td>NIS {item.payableIls.toFixed(2)}</td><td>{item.status === 'pending' ? <button disabled={saving} onClick={async () => { const reference = window.prompt(txt('مرجع الدفعة', 'Payment reference')); if (!reference) return; setSaving(true); try { await markSettlementPaid(item.id, reference); } finally { setSaving(false); } }}>{txt('تأكيد الدفع', 'Mark paid')}</button> : txt('مدفوعة', 'Paid')}</td></tr>)}</tbody></table></div>
      <div className="table-container"><table className="payments-table"><thead><tr>
        <th>{txt('الرحلة', 'Trip')}</th><th>{txt('السائق', 'Driver')}</th><th>{txt('المكتب', 'Office')}</th><th>{txt('النسبة', 'Rate')}</th><th>{txt('العمولة', 'Commission')}</th><th>{txt('الصافي', 'Net')}</th><th>{txt('الحالة', 'Status')}</th>
      </tr></thead><tbody>{records.map((item) => <tr key={item.id}>
        <td>{item.tripId.slice(0, 10)}</td><td>{item.driverId.slice(0, 10)}</td><td>{item.officeId ?? '—'}</td><td>{(item.commissionBps / 100).toFixed(2)}%</td><td>NIS {item.commissionIls.toFixed(2)}</td><td>NIS {item.driverNetIls.toFixed(2)}</td><td>{item.status}</td>
      </tr>)}</tbody></table></div>
    </>}
  </div>;
}
