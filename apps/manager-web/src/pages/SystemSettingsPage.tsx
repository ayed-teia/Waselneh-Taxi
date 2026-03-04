import { useEffect, useState } from 'react';
import {
  FeatureFlag,
  SystemConfig,
  subscribeToSystemConfig,
  toggleFeatureFlag,
  toggleTripsEnabled,
} from '../services/system-config.service';
import './SystemSettingsPage.css';

export function SystemSettingsPage() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingFlag, setTogglingFlag] = useState<FeatureFlag | 'trips' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToSystemConfig(
      (newConfig) => {
        setConfig(newConfig);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleToggleTrips = async () => {
    if (!config || togglingFlag) return;

    const newEnabled = !config.tripsEnabled;
    const confirmed = window.confirm(
      newEnabled
        ? 'Enable trip creation for all users?'
        : 'Disable all trip creation? This blocks all new trips.'
    );

    if (!confirmed) return;

    setTogglingFlag('trips');
    setError(null);

    try {
      await toggleTripsEnabled(newEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle trips');
    } finally {
      setTogglingFlag(null);
    }
  };

  const handleToggleFlag = async (flag: FeatureFlag, currentValue: boolean) => {
    if (togglingFlag) return;

    const flagLabels: Record<FeatureFlag, string> = {
      tripsEnabled: 'Trip creation',
      roadblocksEnabled: 'Roadblocks',
      paymentsEnabled: 'Payments',
    };

    const newEnabled = !currentValue;
    const confirmed = window.confirm(
      newEnabled ? `Enable ${flagLabels[flag]}?` : `Disable ${flagLabels[flag]}?`
    );

    if (!confirmed) return;

    setTogglingFlag(flag);
    setError(null);

    try {
      await toggleFeatureFlag(flag, newEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to toggle ${flagLabels[flag]}`);
    } finally {
      setTogglingFlag(null);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <h2>System Settings</h2>
        <p className="subtitle">Central controls for trip creation and feature availability.</p>
        <div className="loading">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h2>System Settings</h2>
      <p className="subtitle">Central controls for trip creation and feature availability.</p>

      {config && !config.tripsEnabled ? (
        <div className="warning-banner">
          <div className="warning-content">
            <strong>Trips disabled</strong>
            <p>All new trip requests are currently blocked.</p>
          </div>
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-info">
            <h3>Trip Creation (Kill Switch)</h3>
            <p>Control whether passengers can create new trip requests.</p>
            {config?.updatedAt ? (
              <span className="last-updated">
                Last updated: {config.updatedAt.toLocaleString()}
                {config.updatedBy ? ` by ${config.updatedBy.slice(0, 8)}...` : ''}
              </span>
            ) : null}
          </div>
          <div className="setting-control">
            <button
              className={`toggle-button ${config?.tripsEnabled ? 'enabled' : 'disabled'}`}
              onClick={handleToggleTrips}
              disabled={!!togglingFlag}
            >
              {togglingFlag === 'trips'
                ? 'Updating...'
                : config?.tripsEnabled
                  ? 'Enabled'
                  : 'Disabled'}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <h3>Feature Flags</h3>

        <div className="setting-row">
          <div className="setting-info">
            <h4>Roadblocks</h4>
            <p>Enable or disable roadblock management screens and actions.</p>
          </div>
          <div className="setting-control">
            <button
              className={`toggle-button small ${config?.roadblocksEnabled ? 'enabled' : 'disabled'}`}
              onClick={() => handleToggleFlag('roadblocksEnabled', config?.roadblocksEnabled ?? true)}
              disabled={!!togglingFlag}
            >
              {togglingFlag === 'roadblocksEnabled'
                ? '...'
                : config?.roadblocksEnabled
                  ? 'ON'
                  : 'OFF'}
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <h4>Payments</h4>
            <p>Enable or disable payment features while rolling out to production.</p>
          </div>
          <div className="setting-control">
            <button
              className={`toggle-button small ${config?.paymentsEnabled ? 'enabled' : 'disabled'}`}
              onClick={() => handleToggleFlag('paymentsEnabled', config?.paymentsEnabled ?? false)}
              disabled={!!togglingFlag}
            >
              {togglingFlag === 'paymentsEnabled'
                ? '...'
                : config?.paymentsEnabled
                  ? 'ON'
                  : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <h3>Pilot Limits</h3>
        <div className="pilot-limits">
          <div className="limit-item">
            <span className="limit-label">Max active trips (driver)</span>
            <span className="limit-value">1</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">Max active trips (passenger)</span>
            <span className="limit-value">1</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">Driver response timeout</span>
            <span className="limit-value">45 sec</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">Search timeout</span>
            <span className="limit-value">2 min</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">Driver arrival timeout</span>
            <span className="limit-value">5 min</span>
          </div>
        </div>
      </div>
    </div>
  );
}
