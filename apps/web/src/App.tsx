import { useEffect, useState } from 'react';
import { getAccess, clearAccess } from './api';
import { LoginPage } from './pages/LoginPage';
import { ConsolePage } from './pages/ConsolePage';
import { JoinPage } from './pages/JoinPage';

interface JoinRoute {
  code: string;
  token: string;
}

function parseHash(): JoinRoute | null {
  const h = window.location.hash;
  if (!h.startsWith('#/join')) return null;
  const params = new URLSearchParams(h.split('?')[1] ?? '');
  const code = params.get('code');
  const token = params.get('token');
  if (code && token) return { code, token };
  return { code: '', token: '' };
}

export function App() {
  const [route, setRoute] = useState<'login' | 'console' | 'join'>(getAccess() ? 'console' : 'login');
  const [joinRoute, setJoinRoute] = useState<JoinRoute | null>(null);

  useEffect(() => {
    const onHash = () => {
      const j = parseHash();
      if (j) {
        setJoinRoute(j);
        setRoute('join');
      }
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      {/* Page-level chrome (max width, padding) now lives in .app-shell /
          .login-wrap so each route controls its own layout. */}
      {route === 'login' && (
        <LoginPage
          onLoggedIn={() => {
            window.location.hash = '';
            setRoute('console');
          }}
        />
      )}
      {route === 'console' && (
        <ConsolePage
          onLogout={() => {
            clearAccess();
            setRoute('login');
          }}
        />
      )}
      {route === 'join' && joinRoute && (
        <JoinPage
          initialCode={joinRoute.code}
          initialToken={joinRoute.token}
        />
      )}
    </>
  );
}
