import { useState } from 'react';
import { api, storeAccess } from '../api';

/** POC lightweight technician identification (see docs/POC_SCOPE.md). */
export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.devLogin(email);
      storeAccess(res.accessToken);
      onLoggedIn();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <div className="card" style={{ width: 380 }}>
        <h2 style={{ marginTop: 0 }}>Helpdesk Anywhere</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Technician sign-in (POC)
        </p>
        <form onSubmit={submit}>
          <input
            type="email"
            required
            placeholder="technician@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', marginBottom: 12 }}
            autoFocus
          />
          <button type="submit" disabled={busy || !email} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {error && <p style={{ color: '#e74c3c' }}>{error}</p>}
      </div>
    </div>
  );
}
