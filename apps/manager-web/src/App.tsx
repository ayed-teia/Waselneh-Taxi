import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Button, Card, LanguageToggle, Text } from './ui';
import { useI18n } from './localization';
import {
  ManagerRole,
  ManagerSession,
  ensureSignedInManager,
  getManagerSession,
  signOutManager,
} from './services/manager-auth.service';
import { isUsingEmulators } from './services/firebase';
import './App.css';

const ROLE_OPTIONS: ManagerRole[] = [
  'admin',
  'manager',
  'operations_manager',
  'dispatcher',
  'support',
];

const ROLE_LABELS: Record<ManagerRole, { ar: string; en: string }> = {
  admin: { ar: 'مدير عام', en: 'Admin' },
  manager: { ar: 'مدير', en: 'Manager' },
  operations_manager: { ar: 'مدير عمليات', en: 'Operations Manager' },
  dispatcher: { ar: 'موجّه رحلات', en: 'Dispatcher' },
  support: { ar: 'الدعم', en: 'Support' },
};

const PERMISSION_LABELS: Record<string, { ar: string; en: string }> = {
  view_dashboard: { ar: 'عرض اللوحة', en: 'View dashboard' },
  manage_system_flags: { ar: 'إدارة إعدادات النظام', en: 'Manage system flags' },
  manage_drivers: { ar: 'إدارة السائقين', en: 'Manage drivers' },
  manage_offices: { ar: 'إدارة المكاتب', en: 'Manage offices' },
  manage_lines: { ar: 'إدارة الخطوط', en: 'Manage lines' },
  manage_licenses: { ar: 'إدارة التراخيص', en: 'Manage licenses' },
  manage_vehicles: { ar: 'إدارة المركبات', en: 'Manage vehicles' },
  manage_pricing: { ar: 'إدارة التسعير', en: 'Manage pricing' },
  view_monitoring: { ar: 'عرض المراقبة', en: 'View monitoring' },
  manage_alerts: { ar: 'إدارة التنبيهات', en: 'Manage alerts' },
  force_cancel_trip: { ar: 'إلغاء رحلة إجباريًا', en: 'Force cancel trip' },
  manage_rbac: { ar: 'إدارة الصلاحيات', en: 'Manage RBAC' },
};

const NAV_ITEMS = [
  { to: '/drivers', labelAr: 'السائقون', labelEn: 'Drivers' },
  { to: '/operations', labelAr: 'العمليات', labelEn: 'Operations' },
  { to: '/monitoring', labelAr: 'المراقبة', labelEn: 'Monitoring' },
  { to: '/live-map', labelAr: 'الخريطة المباشرة', labelEn: 'Live Map' },
  { to: '/payments', labelAr: 'المدفوعات', labelEn: 'Payments' },
  { to: '/roadblocks', labelAr: 'الإغلاقات', labelEn: 'Roadblocks' },
  { to: '/settings', labelAr: 'الإعدادات', labelEn: 'Settings' },
];

export function App() {
  const { txt, isRTL } = useI18n();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<ManagerRole>('admin');
  const [refreshToken, setRefreshToken] = useState(0);
  const [session, setSession] = useState<ManagerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emulators = isUsingEmulators();

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      setLoading(true);
      setError(null);
      try {
        await ensureSignedInManager(role);
        const managerSession = await getManagerSession();
        if (!active) return;
        setSession(managerSession);
      } catch (err) {
        if (!active) return;
        setSession(null);
        setError(
          err instanceof Error
            ? err.message
            : txt('تعذّر توثيق جلسة المدير', 'Failed to authenticate manager session')
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void bootstrap();
    return () => {
      active = false;
    };
  }, [refreshToken, role, txt]);

  const roleLabel = useMemo(() => {
    const labels = ROLE_LABELS[role];
    return txt(labels.ar, labels.en);
  }, [role, txt]);

  const sessionRoleLabel = useMemo(() => {
    if (!session) return '';
    const labels = ROLE_LABELS[session.role];
    return txt(labels.ar, labels.en);
  }, [session, txt]);

  const permissionPreview = useMemo(() => {
    if (!session) return '';
    return session.permissions
      .slice(0, 4)
      .map((permission) => {
        const labels = PERMISSION_LABELS[permission];
        if (!labels) return permission;
        return txt(labels.ar, labels.en);
      })
      .join('، ');
  }, [session, txt]);

  return (
    <div className={`app ${isRTL ? 'app-rtl' : 'app-ltr'}`}>
      <header className="header">
        <div className="header-title-group">
          <span className="workspace-badge">{txt('لوحة التشغيل', 'Operations Console')}</span>
          <Text as="h1" variant="h2">
            {txt('وصلني | لوحة الإدارة', 'Waselneh Manager')}
          </Text>
          {session ? (
            <p className="session-meta">
              {txt('الدور', 'role')}: <strong>{sessionRoleLabel || roleLabel}</strong>
              {' • '}
              {txt('النطاق', 'scope')}:{' '}
              <strong>
                {session.isGlobalScope
                  ? txt('عام', 'global')
                  : txt(
                      `${session.officeIds.length} مكاتب / ${session.lineIds.length} خطوط`,
                      `${session.officeIds.length} offices / ${session.lineIds.length} lines`
                    )}
              </strong>
            </p>
          ) : null}
        </div>

        <nav className="top-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
              to={item.to}
            >
              {txt(item.labelAr, item.labelEn)}
            </NavLink>
          ))}
          <LanguageToggle />
          <Button
            type="button"
            variant="primary"
            onClick={() => setRefreshToken((current) => current + 1)}
          >
            {txt('تحديث الجلسة', 'Refresh Session')}
          </Button>
        </nav>
      </header>

      <main className="main">
        <Card elevated>
          <div className="session-toolbar">
            <div className="session-toolbar-meta">
              <strong>{txt('البيئة', 'Environment')}:</strong>{' '}
              {emulators ? txt('محاكي', 'emulator') : txt('إنتاج', 'production')}
            </div>
            <div className="session-actions">
              {emulators ? (
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as ManagerRole)}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {txt(ROLE_LABELS[option].ar, ROLE_LABELS[option].en)}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void signOutManager().finally(() => setRefreshToken((current) => current + 1));
                }}
              >
                {txt('تسجيل الخروج', 'Sign out')}
              </Button>
            </div>
          </div>

          {loading ? (
            <p className="session-loading">
              {txt('جاري تحميل جلسة المدير...', 'Loading manager session...')}
            </p>
          ) : null}
          {error ? <div className="session-error">{error}</div> : null}
          {!loading && !error && session ? (
            <div className="session-info">
              <span>
                <strong>{txt('المستخدم', 'User')}:</strong> {session.userId}
              </span>
              <span>
                <strong>{txt('الصلاحيات', 'Permissions')}:</strong>{' '}
                {permissionPreview || txt('لا يوجد', 'none')}
              </span>
            </div>
          ) : null}

          {!loading && !error && session ? <Outlet /> : null}
        </Card>
      </main>
    </div>
  );
}
