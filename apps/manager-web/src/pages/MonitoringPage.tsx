import { useEffect, useMemo, useState } from 'react';
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

function formatDate(value?: Date | null): string {
  if (!value) return '--';
  return value.toLocaleString();
}

export function MonitoringPage() {
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
      setError(err instanceof Error ? err.message : 'Failed to acknowledge alert');
    } finally {
      setBusyAlertId(null);
    }
  };

  return (
    <div className="monitoring-page">
      <h2>Monitoring & Reliability</h2>
      <p className="subtitle">
        Live metrics, active alerts, and incoming client errors from mobile/web apps.
      </p>

      {error ? <div className="monitoring-error">{error}</div> : null}

      <section className="monitoring-metrics">
        <article className="metric-card">
          <h3>Errors (15m)</h3>
          <strong>{metrics?.errors?.total ?? 0}</strong>
          <div className="metric-meta">
            <span>fatal: {metrics?.errors?.fatal ?? 0}</span>
            <span>error: {metrics?.errors?.error ?? 0}</span>
            <span>warning: {metrics?.errors?.warning ?? 0}</span>
          </div>
        </article>

        <article className="metric-card">
          <h3>Drivers</h3>
          <strong>{metrics?.drivers?.onlineCount ?? 0}</strong>
          <div className="metric-meta">
            <span>online</span>
            <span>available: {metrics?.drivers?.availableOnlineCount ?? 0}</span>
          </div>
        </article>

        <article className="metric-card">
          <h3>Trips</h3>
          <strong>{metrics?.trips?.activeCount ?? 0}</strong>
          <div className="metric-meta">
            <span>active</span>
            <span>pending: {metrics?.trips?.pendingCount ?? 0}</span>
            <span>24h completed: {metrics?.trips?.completedLast24h ?? 0}</span>
          </div>
        </article>

        <article className="metric-card">
          <h3>Generated</h3>
          <strong>{formatDate(metrics?.generatedAt)}</strong>
          <div className="metric-meta">
            <span>Window: {metrics?.windows?.errorsMinutes ?? 15}m errors</span>
            <span>{metrics?.windows?.tripsHours ?? 24}h trips</span>
          </div>
        </article>
      </section>

      <section className="monitoring-section">
        <h3>Active Alerts ({openAlerts.length})</h3>
        {openAlerts.length === 0 ? (
          <p className="empty">No active alerts.</p>
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
                <small>opened: {formatDate(alert.openedAt)}</small>
                <small>updated: {formatDate(alert.updatedAt)}</small>
                <small>
                  acknowledged:{' '}
                  {alert.acknowledgedAt ? `${formatDate(alert.acknowledgedAt)} by ${alert.acknowledgedBy ?? '--'}` : 'no'}
                </small>
                <button
                  onClick={() => onAcknowledge(alert.alertId)}
                  disabled={busyAlertId === alert.alertId}
                >
                  {busyAlertId === alert.alertId ? 'Acknowledging...' : 'Acknowledge'}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="monitoring-section">
        <h3>Recent Client Errors</h3>
        {errors.length === 0 ? (
          <p className="empty">No errors reported.</p>
        ) : (
          <div className="errors-table-wrap">
            <table className="errors-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Severity</th>
                  <th>App</th>
                  <th>Message</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, 50).map((entry) => (
                  <tr key={entry.errorId}>
                    <td>{formatDate(entry.createdAt)}</td>
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
