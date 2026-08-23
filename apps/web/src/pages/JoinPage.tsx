import { useState } from 'react';
import type { JoinSessionResponse } from '@helpdesk/shared';
import { api } from '../api';
import { useRtcSession } from '../rtc/useRtcSession';
import { ChatPanel } from '../components/ChatPanel';

function makeSyntheticStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  const start = Date.now();
  const draw = () => {
    const t = ((Date.now() - start) / 1000) % 10;
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, `hsl(${(t * 36) % 360}, 60%, 25%)`);
    grad.addColorStop(1, `hsl(${(t * 36 + 120) % 360}, 60%, 12%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '48px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SYNTHETIC TEST PATTERN', canvas.width / 2, canvas.height / 2 - 20);
    ctx.font = '28px monospace';
    ctx.fillText(new Date().toLocaleTimeString(), canvas.width / 2, canvas.height / 2 + 40);
    ctx.fillRect(((Date.now() - start) / 20) % canvas.width, canvas.height - 120, 80, 80);
  };
  const timer = window.setInterval(draw, 100);
  const stream = canvas.captureStream(15);
  stream.getVideoTracks()[0]?.addEventListener('ended', () => window.clearInterval(timer));
  return stream;
}

/**
 * Browser stand-in for the Windows endpoint agent (Phase 1 proof).
 * Joins with session code + token, shares the screen over WebRTC,
 * and exchanges chat over the DataChannel.
 */
export function JoinPage({
  initialCode,
  initialToken,
}: {
  initialCode: string;
  initialToken: string;
}) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [token, setToken] = useState(initialToken);
  const [joined, setJoined] = useState<JoinSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rtc = useRtcSession({
    role: 'endpoint',
    sessionId: joined?.session.id ?? '',
    signallingToken: joined?.signallingToken ?? '',
    getLocalStream: async () => {
      try {
        return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } catch {
        // Native picker unavailable/denied (e.g. automated test context):
        // fall back to an animated synthetic stream so the video path is provable.
        return makeSyntheticStream();
      }
    },
  });

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.joinSession(code.trim(), token.trim(), 'endpoint');
      setJoined(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <header>
        <h2 style={{ margin: 0 }}>Helpdesk Anywhere — Endpoint</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          {joined
            ? 'Sharing your screen with the technician.'
            : 'Enter the session code your technician gave you.'}
        </p>
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

      {!joined && (
        <form
          className="card"
          onSubmit={join}
          style={{ marginTop: 24, display: 'flex', gap: 8, alignItems: 'center' }}
        >
          <input
            placeholder="Session code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="mono"
            style={{ width: 140, letterSpacing: 3, textAlign: 'center', fontSize: 18 }}
            maxLength={6}
            autoFocus
          />
          <input
            placeholder="Join token (included in link)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={busy || code.length !== 6 || !token}>
            {busy ? 'Joining…' : 'Join & Share Screen'}
          </button>
        </form>
      )}

      {joined && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginTop: 24 }}>
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🖥️</div>
            <p style={{ fontSize: 18, fontWeight: 600, textTransform: 'capitalize' }}>
              {rtc.connState === 'connected' ? 'Sharing screen' : rtc.connState}
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Peer: {rtc.peerPresent ? 'technician connected' : 'waiting for technician…'}
            </p>
            <button
              className="danger"
              onClick={() => {
                rtc.disconnect();
                setJoined(null);
              }}
            >
              Stop sharing
            </button>
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
