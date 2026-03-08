import { useEffect, useState } from 'react';
import { useI18n } from '../localization';
import {
  FeatureFlag,
  SystemConfig,
  subscribeToSystemConfig,
  toggleFeatureFlag,
  toggleTripsEnabled,
} from '../services/system-config.service';
import './SystemSettingsPage.css';

export function SystemSettingsPage() {
  const { txt } = useI18n();
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
        ? txt('تفعيل إنشاء الرحلات لجميع المستخدمين؟', 'Enable trip creation for all users?')
        : txt('إيقاف إنشاء الرحلات؟ سيتم حظر جميع الطلبات الجديدة.', 'Disable all trip creation? This blocks all new trips.')
    );

    if (!confirmed) return;

    setTogglingFlag('trips');
    setError(null);

    try {
      await toggleTripsEnabled(newEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : txt('تعذّر تبديل حالة الرحلات', 'Failed to toggle trips'));
    } finally {
      setTogglingFlag(null);
    }
  };

  const handleToggleFlag = async (flag: FeatureFlag, currentValue: boolean) => {
    if (togglingFlag) return;

    const flagLabels: Record<FeatureFlag, string> = {
      tripsEnabled: txt('إنشاء الرحلات', 'Trip creation'),
      roadblocksEnabled: txt('الإغلاقات', 'Roadblocks'),
      paymentsEnabled: txt('المدفوعات', 'Payments'),
    };

    const newEnabled = !currentValue;
    const confirmed = window.confirm(
      newEnabled ? txt(`تفعيل ${flagLabels[flag]}؟`, `Enable ${flagLabels[flag]}?`) : txt(`إيقاف ${flagLabels[flag]}؟`, `Disable ${flagLabels[flag]}?`)
    );

    if (!confirmed) return;

    setTogglingFlag(flag);
    setError(null);

    try {
      await toggleFeatureFlag(flag, newEnabled);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : txt(`تعذّر تبديل ${flagLabels[flag]}`, `Failed to toggle ${flagLabels[flag]}`)
      );
    } finally {
      setTogglingFlag(null);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <h2>{txt('إعدادات النظام', 'System Settings')}</h2>
        <p className="subtitle">{txt('تحكم مركزي في إنشاء الرحلات وتوفّر الميزات.', 'Central controls for trip creation and feature availability.')}</p>
        <div className="loading">{txt('جاري تحميل الإعدادات...', 'Loading settings...')}</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h2>{txt('إعدادات النظام', 'System Settings')}</h2>
      <p className="subtitle">{txt('تحكم مركزي في إنشاء الرحلات وتوفّر الميزات.', 'Central controls for trip creation and feature availability.')}</p>

      {config && !config.tripsEnabled ? (
        <div className="warning-banner">
          <div className="warning-content">
            <strong>{txt('الرحلات متوقفة', 'Trips disabled')}</strong>
            <p>{txt('جميع طلبات الرحلات الجديدة متوقفة حاليًا.', 'All new trip requests are currently blocked.')}</p>
          </div>
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-info">
            <h3>{txt('إنشاء الرحلات (إيقاف طارئ)', 'Trip Creation (Kill Switch)')}</h3>
            <p>{txt('التحكم بإمكانية إنشاء طلبات رحلات جديدة من تطبيق الراكب.', 'Control whether passengers can create new trip requests.')}</p>
            {config?.updatedAt ? (
              <span className="last-updated">
                {txt('آخر تحديث', 'Last updated')}: {config.updatedAt.toLocaleString()}
                {config.updatedBy ? ` ${txt('بواسطة', 'by')} ${config.updatedBy.slice(0, 8)}...` : ''}
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
                ? txt('جارٍ التحديث...', 'Updating...')
                : config?.tripsEnabled
                  ? txt('مفعّل', 'Enabled')
                  : txt('موقّف', 'Disabled')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <h3>{txt('أعلام الميزات', 'Feature Flags')}</h3>

        <div className="setting-row">
          <div className="setting-info">
            <h4>{txt('الإغلاقات', 'Roadblocks')}</h4>
            <p>{txt('تفعيل أو إيقاف إدارة الإغلاقات وشاشاتها.', 'Enable or disable roadblock management screens and actions.')}</p>
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
                  ? txt('تشغيل', 'ON')
                  : txt('إيقاف', 'OFF')}
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <h4>{txt('المدفوعات', 'Payments')}</h4>
            <p>{txt('تفعيل أو إيقاف ميزات الدفع أثناء الإطلاق التدريجي.', 'Enable or disable payment features while rolling out to production.')}</p>
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
                  ? txt('تشغيل', 'ON')
                  : txt('إيقاف', 'OFF')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <h3>{txt('حدود التشغيل التجريبية', 'Pilot Limits')}</h3>
        <div className="pilot-limits">
          <div className="limit-item">
            <span className="limit-label">{txt('أقصى رحلات نشطة (سائق)', 'Max active trips (driver)')}</span>
            <span className="limit-value">1</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">{txt('أقصى رحلات نشطة (راكب)', 'Max active trips (passenger)')}</span>
            <span className="limit-value">1</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">{txt('مهلة رد السائق', 'Driver response timeout')}</span>
            <span className="limit-value">45 {txt('ثانية', 'sec')}</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">{txt('مهلة البحث', 'Search timeout')}</span>
            <span className="limit-value">2 {txt('دقيقة', 'min')}</span>
          </div>
          <div className="limit-item">
            <span className="limit-label">{txt('مهلة وصول السائق', 'Driver arrival timeout')}</span>
            <span className="limit-value">5 {txt('دقيقة', 'min')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
