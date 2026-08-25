import { useEffect, useRef, useState } from 'react';
import type { CreateSessionResponse, JoinSessionResponse } from '@helpdesk/shared';
import { api } from '../api';
import { useRtcSession } from '../rtc/useRtcSession';
import { ScreenViewer } from '../components/ScreenViewer';
import { ChatPanel } from '../components/ChatPanel';
import { BrandMark } from '../components/BrandMark';

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
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-title">Technician Console</div>
            <div className="brand-sub">Helpdesk Anywhere</div>
          </div>
        </div>
        <div className="header-actions">
          {(created || joined) && (
            <button className="danger" onClick={endSession}>
              End session
            </button>
          )}
          <button className="ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {rtc.error && <div className="alert alert-warn">{rtc.error}</div>}

      {!created && (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <h3 style={{ fontSize: 17 }}>Start a support session</h3>
          <p className="muted" style={{ margin: '8px 0 22px', fontSize: 13.5 }}>
            Create a session and share the code or join link with the user.
          </p>
          <button className="lg" onClick={createSession} disabled={busy}>
            {busy ? 'Creating…' : 'Create Support Session'}
          </button>
        </div>
      )}

      {created && !joined && (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <span className="badge is-pending">Waiting for endpoint</span>
          <div className="session-code">{created.session.code}</div>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 16px' }}>
            Share this code, or send the join link below.
          </p>
          <a className="joinlink" href={joinLink}>
            {joinLink}
          </a>
          <div className="btn-row">
            <button
              className="ghost"
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
        <div className="console-grid">
          <div>
            <div className="statusbar">
              <StatusBadge state={rtc.connState} />
              <span className="meta">
                DataChannel: {rtc.dataChannelOpen ? 'open' : 'closed'}
                <span className="meta-sep">·</span>
                Peer: {rtc.peerPresent ? 'connected' : 'waiting'}
                <span className="meta-sep">·</span>
                Session <span className="mono">{created?.session.code}</span>
              </span>
            </div>
            <ScreenViewer
              stream={rtc.remoteStream}
              connected={rtc.connState === 'connected'}
              onControl={rtc.sendControl}
              onFramePresented={() => setFramesPresented((n) => n + 1)}
            />
            <p className="statline">
              {rtc.videoStats ?? 'video stats pending…'} · painted: {framesPresented} {videoDebug}
            </p>
            <VideoDebugProbe stream={rtc.remoteStream} onChange={setVideoDebug} />
          </div>
          <div className="card chat-card">
            <div className="chat-head">
              <span className="chat-title">Chat</span>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {rtc.dataChannelOpen ? 'connected' : 'offline'}
              </span>
            </div>
            <ChatPanel
              messages={rtc.chat}
              enabled={rtc.dataChannelOpen}
              onSend={rtc.sendChat}
              selfRole="technician"
            />
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
  const tone =
    state === 'connected' ? 'is-connected' : state === 'failed' ? 'is-failed' : 'is-pending';
  return <span className={`badge is-state ${tone}`}>{state}</span>;
}
