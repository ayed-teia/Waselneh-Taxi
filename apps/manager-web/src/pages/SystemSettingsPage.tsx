import { useEffect, useState } from 'react';
import { 
  subscribeToSystemConfig, 
  toggleTripsEnabled, 
  toggleFeatureFlag,
  SystemConfig,
  FeatureFlag 
} from '../services/system-config.service';
import './SystemSettingsPage.css';

/**
 * ============================================================================
 * SYSTEM SETTINGS PAGE
 * ============================================================================
 * 
 * Step 32: Pilot Hardening & Kill Switches
 * Step 33: Go-Live Mode - Feature Flags
 * 
 * Manager control panel for system-wide settings:
 * - Trips kill switch (enable/disable all trips)
 * - Feature flags for roadblocks, payments, etc.
 * 
 * ============================================================================
 */

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
        : '⚠️ DISABLE all trip creation? This will prevent ALL new trips from being created!'
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
      tripsEnabled: 'Trip Creation',
      roadblocksEnabled: 'Roadblocks',
      paymentsEnabled: 'Payments',
    };

    const newEnabled = !currentValue;
    const confirmed = window.confirm(
      newEnabled
        ? `Enable ${flagLabels[flag]}?`
        : `Disable ${flagLabels[flag]}?`
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
        <h1>⚙️ System Settings</h1>
        <div className="loading">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h1>⚙️ System Settings</h1>
      
      {/* Kill Switch Warning Banner */}
      {config && !config.tripsEnabled && (
        <div className="warning-banner">
          <span className="warning-icon">⚠️</span>
          <div className="warning-content">
            <strong>TRIPS DISABLED</strong>
            <p>All new trip requests are currently blocked. Users cannot create new trips.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner">
          ❌ {error}
        </div>
      )}

      {/* Kill Switch Control */}
      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-info">
            <h3>🚕 Trip Creation (Kill Switch)</h3>
            <p>Control whether passengers can create new trip requests.</p>
            {config?.updatedAt && (
              <span className="last-updated">
                Last updated: {config.updatedAt.toLocaleString()}
                {config.updatedBy && ` by ${config.updatedBy.slice(0, 8)}...`}
              </span>
            )}
          </div>
          <div className="setting-control">
            <button
              className={`toggle-button ${config?.tripsEnabled ? 'enabled' : 'disabled'}`}
              onClick={handleToggleTrips}
              disabled={!!togglingFlag}
            >
              {togglingFlag === 'trips' ? 'Updating...' : config?.tripsEnabled ? '✅ ENABLED' : '🔴 DISABLED'}
            </button>
          </div>
        </div>
      </div>

      {/* Feature Flags */}
      <div className="settings-card">
        <h3>🚩 Feature Flags</h3>
        
        <div className="setting-row">
          <div className="setting-info">
            <h4>🚧 Roadblocks</h4>
            <p>Enable/disable roadblock zone management.</p>
          </div>
          <div className="setting-control">
            <button
              className={`toggle-button small ${config?.roadblocksEnabled ? 'enabled' : 'disabled'}`}
              onClick={() => handleToggleFlag('roadblocksEnabled', config?.roadblocksEnabled ?? true)}
              disabled={!!togglingFlag}
            >
              {togglingFlag === 'roadblocksEnabled' ? '...' : config?.roadblocksEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
        
        <div className="setting-row">
          <div className="setting-info">
            <h4>💳 Payments</h4>
            <p>Enable/disable payment features (off for pilot)</p>
          </div>
          <div className="setting-control">
            <button
              className={`toggle-button small ${config?.paymentsEnabled ? 'enabled' : 'disabled'}`}
              onClick={() => handleToggleFlag('paymentsEnabled', config?.paymentsEnabled ?? false)}
              disabled={!!togglingFlag}
            >
              {togglingFlag === 'paymentsEnabled' ? '...' : config?.paymentsEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Pilot Limits Info */}
      <div className="settings-card">
        <h3>📋 Pilot Limits</h3>
        <div className="pilot-limits">
          <div className="limit-item">
            <span className="limit-label">Max Active Trips (Driver)</span>
            <span className="limit-value">1</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">Max Active Trips (Passenger)</span>
            <span className="limit-value">1</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">Driver Response Timeout</span>
            <span className="limit-value">45 seconds</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">Search Timeout</span>
            <span className="limit-value">2 minutes</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">Driver Arrival Timeout</span>
            <span className="limit-value">5 minutes</span>
          </div>
        </div>
      </div>
    </div>
  );
}
