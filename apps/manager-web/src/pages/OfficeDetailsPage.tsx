import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useI18n } from '../localization';
import { DashboardDoc, getOfficeDashboard, OfficeDashboard } from '../services/office-dashboard.service';
import './OfficeDetailsPage.css';

const text = (doc: DashboardDoc | null, key: string, fallback = '—') =>
  typeof doc?.[key] === 'string' && doc[key] ? String(doc[key]) : fallback;
const amount = (doc: DashboardDoc, ...keys: string[]) => {
  for (const key of keys) {
    const value = Number(doc[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
};
const money = (value: number) => `${value.toFixed(2)} ILS`;

export function OfficeDetailsPage() {
  const { officeId = '' } = useParams();
  const { txt } = useI18n();
  const [dashboard, setDashboard] = useState<OfficeDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!officeId) return;
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getOfficeDashboard(officeId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : txt('تعذّر تحميل المكتب.', 'Failed to load office.'));
    } finally {
      setLoading(false);
    }
  }, [officeId, txt]);

  useEffect(() => { void refresh(); }, [refresh]);

  const metrics = useMemo(() => {
    if (!dashboard) return null;
    const completed = dashboard.trips.filter((trip) => trip.status === 'completed');
    const revenue = completed.reduce((sum, trip) => sum + amount(trip, 'fareAmount', 'finalFareIls', 'estimatedPriceIls'), 0);
    const commission = dashboard.commissions.reduce((sum, item) => sum + amount(item, 'commissionIls'), 0);
    const debt = dashboard.invoices
      .filter((invoice) => !['paid', 'void'].includes(String(invoice.status ?? 'pending')))
      .reduce((sum, invoice) => sum + amount(invoice, 'amountIls'), 0);
    return { completed: completed.length, revenue, commission, debt };
  }, [dashboard]);

  if (loading && !dashboard) return <div className="office-page"><p>{txt('جارٍ تحميل المكتب…', 'Loading office…')}</p></div>;
  if (error && !dashboard) return <div className="office-page"><Link to="/operations">← {txt('العمليات', 'Operations')}</Link><p className="office-error">{error}</p></div>;
  if (!dashboard || !metrics) return null;

  return (
    <div className="office-page">
      <header className="office-header">
        <div><Link to="/operations">← {txt('العمليات', 'Operations')}</Link><h2>{text(dashboard.office, 'name')}</h2><p>{text(dashboard.office, 'code')} · {text(dashboard.office, 'contactPhone')}</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? txt('تحديث…', 'Refreshing…') : txt('تحديث البيانات', 'Refresh data')}</button>
      </header>
      {error ? <p className="office-error">{error}</p> : null}
      <section className="office-metrics">
        <article><span>{txt('السائقون', 'Drivers')}</span><strong>{dashboard.drivers.length}</strong></article>
        <article><span>{txt('المركبات', 'Vehicles')}</span><strong>{dashboard.vehicles.length}</strong></article>
        <article><span>{txt('الخطوط', 'Lines')}</span><strong>{dashboard.lines.length}</strong></article>
        <article><span>{txt('الرحلات المكتملة', 'Completed trips')}</span><strong>{metrics.completed}</strong></article>
        <article><span>{txt('إجمالي الإيراد', 'Gross revenue')}</span><strong>{money(metrics.revenue)}</strong></article>
        <article><span>{txt('عمولة المنصة', 'Platform commission')}</span><strong>{money(metrics.commission)}</strong></article>
        <article className={metrics.debt > 0 ? 'warning' : ''}><span>{txt('المبالغ المستحقة', 'Outstanding')}</span><strong>{money(metrics.debt)}</strong></article>
        <article><span>{txt('الاشتراك', 'Subscription')}</span><strong>{text(dashboard.subscription, 'status', txt('غير مفعّل', 'Not assigned'))}</strong></article>
      </section>
      <section className="office-panel"><h3>{txt('السائقون', 'Drivers')}</h3><div className="office-table-wrap"><table><thead><tr><th>{txt('السائق', 'Driver')}</th><th>{txt('الهاتف', 'Phone')}</th><th>{txt('الحالة', 'Status')}</th><th>{txt('الخط', 'Line')}</th></tr></thead><tbody>{dashboard.drivers.map((driver) => <tr key={driver.id}><td>{text(driver, 'displayName', text(driver, 'name', driver.id))}</td><td>{text(driver, 'phoneNumber', text(driver, 'phone'))}</td><td>{text(driver, 'status')}</td><td>{text(driver, 'lineId')}</td></tr>)}</tbody></table></div>{dashboard.drivers.length === 0 ? <p>{txt('لا يوجد سائقون مرتبطون.', 'No linked drivers.')}</p> : null}</section>
      <div className="office-columns">
        <section className="office-panel"><h3>{txt('المركبات', 'Vehicles')}</h3>{dashboard.vehicles.map((vehicle) => <div className="office-row" key={vehicle.id}><strong>{text(vehicle, 'plateNumber', vehicle.id)}</strong><span>{text(vehicle, 'vehicleType')} · {amount(vehicle, 'seatCapacity')} {txt('مقاعد', 'seats')}</span></div>)}</section>
        <section className="office-panel"><h3>{txt('الخطوط', 'Lines')}</h3>{dashboard.lines.map((line) => <div className="office-row" key={line.id}><strong>{text(line, 'name', line.id)}</strong><span>{text(line, 'serviceType')} · {text(line, 'code')}</span></div>)}</section>
      </div>
      <footer className="office-generated">{txt('آخر تحديث', 'Last updated')}: {new Date(dashboard.generatedAt).toLocaleString()}</footer>
    </div>
  );
}
