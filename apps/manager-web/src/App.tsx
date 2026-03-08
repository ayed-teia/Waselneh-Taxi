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

  const permissionPreview = useMemo(() => {
    if (!session) return '';
    return session.permissions.slice(0, 4).join(', ');
  }, [session]);

  return (
    <div className={`app ${isRTL ? 'app-rtl' : 'app-ltr'}`}>
      <header className="header">
        <div className="header-title-group">
          <span className="workspace-badge">{txt('لوحة التشغيل', 'Operations Console')}</span>
          <Text as="h1" variant="h2">
            {txt('واصلني | لوحة الإدارة', 'Waselneh Manager')}
          </Text>
          {session ? (
            <p className="session-meta">
              {txt('الدور', 'role')}: <strong>{session.role}</strong>
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
                      {option}
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
