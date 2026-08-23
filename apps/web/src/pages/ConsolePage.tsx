import { useState } from 'react';
import type { CreateSessionResponse, JoinSessionResponse } from '@helpdesk/shared';
import { api } from '../api';
import { useRtcSession } from '../rtc/useRtcSession';
import { ScreenViewer } from '../components/ScreenViewer';
import { ChatPanel } from '../components/ChatPanel';

export function ConsolePage({ onLogout }: { onLogout: () => void }) {
  const [created, setCreated] = useState<CreateSessionResponse | null>(null);
  const [joined, setJoined] = useState<JoinSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const rtc = useRtcSession({
    role: 'technician',
    sessionId: joined?.session.id ?? '',
    signallingToken: joined?.signallingToken ?? '',
    createControlChannel: true,
  });

  const createSession = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createSession();
      setCreated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Technician joins signalling for their own session (to receive the endpoint).
  const joinOwnSession = async () => {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.joinSession(
        created.session.code,
        created.joinToken,
        'technician',
      );
      setJoined(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const endSession = async () => {
    if (!created) return;
    rtc.disconnect();
    try {
      await api.endSession(created.session.code);
    } catch {
      /* session may already be gone */
    }
    setJoined(null);
    setCreated(null);
  };

  const joinLink = created
    ? `${window.location.origin}${window.location.pathname}#/join?code=${created.session.code}&token=${encodeURIComponent(created.joinToken)}`
    : '';

  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Technician Console</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {(created || joined) && (
            <button className="danger" onClick={endSession}>
              End session
            </button>
          )}
          <button onClick={onLogout}>Sign out</button>
        </div>
      </header>

      {error && (
        <p style={{ color: '#e74c3c', background: '#2a1512', padding: '8px 12px', borderRadius: 8 }}>
          {error}
        </p>
      )}
      {rtc.error && (
        <p style={{ color: '#e67e22', background: '#2a1f12', padding: '8px 12px', borderRadius: 8 }}>
          {rtc.error}
        </p>
      )}

      {!created && (
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: 48 }}>
          <p className="muted">Create a support session and share the code with the user.</p>
          <button onClick={createSession} disabled={busy}>
            {busy ? 'Creating…' : 'Create Support Session'}
          </button>
        </div>
      )}

      {created && !joined && (
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: 40 }}>
          <p className="muted">Session created — waiting for the endpoint to join.</p>
          <div
            className="mono"
            style={{ fontSize: 42, letterSpacing: 10, margin: '16px 0', fontWeight: 600 }}
          >
            {created.session.code}
          </div>
          <p className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
            Join link: <a href={joinLink}>{joinLink}</a>
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(joinLink);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied!' : 'Copy join link'}
            </button>
            <button onClick={joinOwnSession} disabled={busy}>
              {busy ? 'Joining…' : 'Start watching'}
            </button>
          </div>
        </div>
      )}

      {joined && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 24 }}>
          <div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
              <StatusBadge state={rtc.connState} />
              <span className="muted" style={{ fontSize: 13 }}>
                DataChannel: {rtc.dataChannelOpen ? 'open' : 'closed'} · Peer:{' '}
                {rtc.peerPresent ? 'connected' : 'waiting'} · Session {created?.session.code}
              </span>
            </div>
            <ScreenViewer stream={rtc.remoteStream} connected={rtc.connState === 'connected'} onControl={rtc.sendControl} />
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 480 }}>
            <h3 style={{ margin: '0 0 8px' }}>Chat</h3>
            <ChatPanel messages={rtc.chat} enabled={rtc.dataChannelOpen} onSend={rtc.sendChat} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state: string }) {
  const color =
    state === 'connected' ? '#27ae60' : state === 'failed' ? '#c0392b' : '#f39c12';
  return (
    <span
      style={{
        background: color,
        color: '#fff',
        borderRadius: 12,
        padding: '2px 12px',
        fontSize: 13,
        fontWeight: 600,
        textTransform: 'capitalize',
      }}
    >
      {state}
    </span>
  );
}
