import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../localization';
import { acknowledgeAlert } from '../services/operations.service';
import {
  OpsAlert,
  OpsError,
  OpsMetrics,
  subscribeOpsAlerts,
  subscribeOpsErrors,
  subscribeOpsMetrics,
} from '../services/monitoring.service';
import './MonitoringPage.css';

function formatDate(value: Date | null | undefined, locale: 'ar' | 'en'): string {
  if (!value) return locale === 'ar' ? '--' : '--';
  return value.toLocaleString(locale === 'ar' ? 'ar-PS' : 'en-US');
}

export function MonitoringPage() {
  const { txt, locale } = useI18n();
  const [metrics, setMetrics] = useState<OpsMetrics | null>(null);
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [errors, setErrors] = useState<OpsError[]>([]);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeOpsMetrics(setMetrics),
      subscribeOpsAlerts(setAlerts),
      subscribeOpsErrors(setErrors),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  const openAlerts = useMemo(() => alerts.filter((alert) => alert.status === 'open'), [alerts]);

  const onAcknowledge = async (alertId: string) => {
    setBusyAlertId(alertId);
    setError(null);
    try {
      await acknowledgeAlert({ alertId });
    } catch (err) {
      setError(err instanceof Error ? err.message : txt('تعذّر تأكيد التنبيه', 'Failed to acknowledge alert'));
    } finally {
      setBusyAlertId(null);
    }
  };

  return (
    <div className="monitoring-page">
      <h2>{txt('المراقبة والاعتمادية', 'Monitoring & Reliability')}</h2>
      <p className="subtitle">
        {txt(
          'مؤشرات مباشرة وتنبيهات نشطة وأخطاء عميل واردة من تطبيقات الجوال والويب.',
          'Live metrics, active alerts, and incoming client errors from mobile/web apps.'
        )}
      </p>

      {error ? <div className="monitoring-error">{error}</div> : null}

      <section className="monitoring-metrics">
        <article className="metric-card">
          <h3>{txt('الأخطاء (15 دقيقة)', 'Errors (15m)')}</h3>
          <strong>{metrics?.errors?.total ?? 0}</strong>
          <div className="metric-meta">
            <span>{txt('حرج', 'fatal')}: {metrics?.errors?.fatal ?? 0}</span>
            <span>{txt('خطأ', 'error')}: {metrics?.errors?.error ?? 0}</span>
            <span>{txt('تحذير', 'warning')}: {metrics?.errors?.warning ?? 0}</span>
          </div>
        </article>

        <article className="metric-card">
          <h3>{txt('السائقون', 'Drivers')}</h3>
          <strong>{metrics?.drivers?.onlineCount ?? 0}</strong>
          <div className="metric-meta">
            <span>{txt('متصل', 'online')}</span>
            <span>{txt('متاح', 'available')}: {metrics?.drivers?.availableOnlineCount ?? 0}</span>
          </div>
        </article>

        <article className="metric-card">
          <h3>{txt('الرحلات', 'Trips')}</h3>
          <strong>{metrics?.trips?.activeCount ?? 0}</strong>
          <div className="metric-meta">
            <span>{txt('نشطة', 'active')}</span>
            <span>{txt('معلقة', 'pending')}: {metrics?.trips?.pendingCount ?? 0}</span>
            <span>{txt('مكتملة خلال 24 ساعة', '24h completed')}: {metrics?.trips?.completedLast24h ?? 0}</span>
          </div>
        </article>

        <article className="metric-card">
          <h3>{txt('وقت التوليد', 'Generated')}</h3>
          <strong>{formatDate(metrics?.generatedAt, locale)}</strong>
          <div className="metric-meta">
            <span>{txt('نافذة الأخطاء', 'Window')}: {metrics?.windows?.errorsMinutes ?? 15}m</span>
            <span>{metrics?.windows?.tripsHours ?? 24}h {txt('رحلات', 'trips')}</span>
          </div>
        </article>
      </section>

      <section className="monitoring-section">
        <h3>{txt(`التنبيهات النشطة (${openAlerts.length})`, `Active Alerts (${openAlerts.length})`)}</h3>
        {openAlerts.length === 0 ? (
          <p className="empty">{txt('لا توجد تنبيهات نشطة.', 'No active alerts.')}</p>
        ) : (
          <div className="alerts-grid">
            {openAlerts.map((alert) => (
              <article
                key={alert.alertId}
                className={`alert-card ${alert.severity === 'critical' ? 'critical' : 'warning'}`}
              >
                <header>
                  <strong>{alert.title}</strong>
                  <span>{alert.severity}</span>
                </header>
                <p>{alert.message}</p>
                <small>{txt('فُتح', 'opened')}: {formatDate(alert.openedAt, locale)}</small>
                <small>{txt('آخر تحديث', 'updated')}: {formatDate(alert.updatedAt, locale)}</small>
                <small>
                  {txt('تم التأكيد', 'acknowledged')}:{' '}
                  {alert.acknowledgedAt
                    ? `${formatDate(alert.acknowledgedAt, locale)} ${txt('بواسطة', 'by')} ${alert.acknowledgedBy ?? '--'}`
                    : txt('لا', 'no')}
                </small>
                <button
                  onClick={() => onAcknowledge(alert.alertId)}
                  disabled={busyAlertId === alert.alertId}
                >
                  {busyAlertId === alert.alertId
                    ? txt('جارٍ التأكيد...', 'Acknowledging...')
                    : txt('تأكيد', 'Acknowledge')}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="monitoring-section">
        <h3>{txt('أخطاء العميل الأخيرة', 'Recent Client Errors')}</h3>
        {errors.length === 0 ? (
          <p className="empty">{txt('لا توجد أخطاء مبلّغ عنها.', 'No errors reported.')}</p>
        ) : (
          <div className="errors-table-wrap">
            <table className="errors-table">
              <thead>
                <tr>
                  <th>{txt('الوقت', 'Time')}</th>
                  <th>{txt('الحدة', 'Severity')}</th>
                  <th>{txt('التطبيق', 'App')}</th>
                  <th>{txt('الرسالة', 'Message')}</th>
                  <th>{txt('المستخدم', 'User')}</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, 50).map((entry) => (
                  <tr key={entry.errorId}>
                    <td>{formatDate(entry.createdAt, locale)}</td>
                    <td>{entry.severity}</td>
                    <td>{entry.app}</td>
                    <td>{entry.message}</td>
                    <td>{entry.userId ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
