import { useEffect, useRef, useState } from 'react';
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
  const [framesPresented, setFramesPresented] = useState(0);
  const [videoDebug, setVideoDebug] = useState('');

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
            <ScreenViewer
              stream={rtc.remoteStream}
              connected={rtc.connState === 'connected'}
              onControl={rtc.sendControl}
              onFramePresented={() => setFramesPresented((n) => n + 1)}
            />
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              {rtc.videoStats ?? 'video stats pending…'} · painted: {framesPresented} {videoDebug}
            </p>
            <VideoDebugProbe stream={rtc.remoteStream} onChange={setVideoDebug} />
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

function VideoDebugProbe({
  stream,
  onChange,
}: {
  stream: MediaStream | null;
  onChange: (s: string) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const el = ref.current;
      if (!el) return;
      // Draw the video into a canvas and measure pixel variance — this works
      // regardless of rVFC/compositor support and proves real picture content.
      let variance = -1;
      let brightest = 0;
      const cv = canvasRef.current;
      if (el.videoWidth > 0 && cv) {
        cv.width = 64;
        cv.height = 36;
        const ctx = cv.getContext('2d');
        if (ctx) {
          ctx.drawImage(el, 0, 0, 64, 36);
          const data = ctx.getImageData(0, 0, 64, 36).data;
          let sum = 0;
          let sumSq = 0;
          const n = data.length / 4;
          for (let i = 0; i < data.length; i += 4) {
            const lum = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
            sum += lum;
            sumSq += lum * lum;
            if (lum > brightest) brightest = lum;
          }
          const mean = sum / n;
          variance = Math.round(Math.sqrt(sumSq / n - mean * mean) * 10) / 10;
        }
      }
      onChange(
        `· el: ${el.videoWidth}x${el.videoHeight} rs=${el.readyState} content: ${variance >= 0 ? `σ=${variance} max=${Math.round(brightest)}` : 'n/a'}`,
      );
    }, 2000);
    return () => window.clearInterval(timer);
  }, [stream, onChange]);
  return (
    <div style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none' }}>
    <video
      muted
      autoPlay
      playsInline
      style={{ position: 'absolute', width: 2, height: 2, opacity: 0, pointerEvents: 'none' }}
      ref={(el) => {
        ref.current = el;
        if (el && el.srcObject !== stream) el.srcObject = stream;
      }}
    />
    <canvas ref={canvasRef} style={{ width: 2, height: 2 }} />
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
