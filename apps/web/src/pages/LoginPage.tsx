import { useState } from 'react';
import { api, storeAccess } from '../api';
import { BrandMark } from '../components/BrandMark';

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
    <div className="login-wrap">
      <div className="card login-card">
        <BrandMark size={24} />
        <h2>Helpdesk Anywhere</h2>
        <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
          Technician sign-in
        </p>

        <form onSubmit={submit}>
          <input
            type="email"
            required
            placeholder="technician@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <button type="submit" className="lg" disabled={busy || !email}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {error && (
          <div className="alert alert-error" style={{ marginTop: 16, marginBottom: 0 }}>
            <span>{error}</span>
          </div>
        )}

        <p className="field-hint">Proof of concept — no password required.</p>
      </div>
    </div>
  );
}
