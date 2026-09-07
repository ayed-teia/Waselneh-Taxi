import { useCallback, useState } from 'react';

import { signInManagerWithPassword } from '../services/manager-auth.service';

/**
 * ============================================================================
 * MANAGER SIGN-IN (email + password)
 * ============================================================================
 *
 * Only rendered when VITE_ENABLE_MANAGER_PASSWORD_AUTH=true. With the flag off (the
 * default) manager-web keeps using the emulator dev-token path and this page is
 * never mounted.
 *
 * Signing in proves identity only. Authorization still comes from
 * getManagerSession(), which reads managerRoles/{uid} and nothing else - so a valid
 * password for an account that is not an active manager gets in nowhere, and is
 * signed straight back out.
 * ============================================================================
 */

export interface ManagerLoginPageProps {
  /** Called once sign-in AND the manager-session check both succeed. */
  onSignedIn: () => void;
}

export function ManagerLoginPage({ onSignedIn }: ManagerLoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await signInManagerWithPassword(email, password);
        onSignedIn();
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        // Deliberately do not distinguish "wrong password" from "not a manager":
        // that difference tells an attacker which emails are manager accounts.
        setError(
          /permission|manager|forbidden|deactivated/i.test(raw)
            ? 'This account cannot access the dashboard.'
            : 'Sign-in failed. Check your email and password.'
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, email, password, onSignedIn]
  );

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={(e) => void handleSubmit(e)}>
        <h1 style={styles.title}>Waselneh — Manager</h1>
        <p style={styles.subtitle}>Sign in to the operations dashboard.</p>

        <label style={styles.label} htmlFor="manager-email">
          Email
        </label>
        <input
          id="manager-email"
          style={styles.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          disabled={busy}
        />

        <label style={styles.label} htmlFor="manager-password">
          Password
        </label>
        <input
          id="manager-password"
          style={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          disabled={busy}
        />

        <button style={styles.button} type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {error ? <p style={styles.error}>{error}</p> : null}
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f3f4f6',
  },
  card: {
    background: '#fff',
    padding: 32,
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
    width: 360,
    display: 'flex',
    flexDirection: 'column',
  },
  title: { margin: '0 0 4px', fontSize: 22 },
  subtitle: { margin: '0 0 20px', color: '#6b7280', fontSize: 14 },
  label: { fontSize: 13, fontWeight: 600, marginBottom: 4 },
  input: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    marginBottom: 14,
    fontSize: 15,
  },
  button: {
    padding: '10px 12px',
    borderRadius: 8,
    border: 'none',
    background: '#111827',
    color: '#fff',
    fontSize: 15,
    cursor: 'pointer',
    marginTop: 4,
  },
  error: { color: '#dc2626', fontSize: 14, marginTop: 12, marginBottom: 0 },
};

export default ManagerLoginPage;
