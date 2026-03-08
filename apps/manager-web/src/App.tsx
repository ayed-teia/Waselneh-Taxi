import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Button, Card, Text } from './ui';
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
  { to: '/drivers', label: 'Drivers' },
  { to: '/operations', label: 'Operations' },
  { to: '/monitoring', label: 'Monitoring' },
  { to: '/live-map', label: 'Live Map' },
  { to: '/payments', label: 'Payments' },
  { to: '/roadblocks', label: 'Roadblocks' },
  { to: '/settings', label: 'Settings' },
];

export function App() {
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
        setError(err instanceof Error ? err.message : 'Failed to authenticate manager session');
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
  }, [refreshToken, role]);

  const permissionPreview = useMemo(() => {
    if (!session) return '';
    return session.permissions.slice(0, 4).join(', ');
  }, [session]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-title-group">
          <span className="workspace-badge">Operations Console</span>
          <Text as="h1" variant="h2">
            Waselneh Manager
          </Text>
          {session ? (
            <p className="session-meta">
              role: <strong>{session.role}</strong>
              {' � '}
              scope:{' '}
              <strong>
                {session.isGlobalScope
                  ? 'global'
                  : `${session.officeIds.length} offices / ${session.lineIds.length} lines`}
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
              {item.label}
            </NavLink>
          ))}
          <Button
            type="button"
            variant="primary"
            onClick={() => setRefreshToken((current) => current + 1)}
          >
            Refresh Session
          </Button>
        </nav>
      </header>

      <main className="main">
        <Card elevated>
          <div className="session-toolbar">
            <div className="session-toolbar-meta">
              <strong>Environment:</strong> {emulators ? 'emulator' : 'production'}
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
                Sign out
              </Button>
            </div>
          </div>

        {loading ? <p className="session-loading">Loading manager session...</p> : null}
        {error ? <div className="session-error">{error}</div> : null}
        {!loading && !error && session ? (
          <div className="session-info">
            <span>
                <strong>User:</strong> {session.userId}
              </span>
              <span>
              <strong>Permissions:</strong> {permissionPreview || 'none'}
            </span>
          </div>
        ) : null}

          {!loading && !error && session ? (
            <Outlet />
          ) : null}
        </Card>
      </main>
    </div>
  );
}
