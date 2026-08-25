import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ControlMessage, PeerRole } from '@helpdesk/shared';
import { api } from '../api';
import { PeerSession, type ConnState } from './peer';
import { SignallingClient } from './signalling';

export interface RtcSessionOptions {
  role: PeerRole;
  sessionId: string;
  signallingToken: string;
  /** Endpoint-browser stand-in only: get the screen stream to send. */
  getLocalStream?: () => Promise<MediaStream | null>;
  /** Technician side: auto-create the control DataChannel when peer arrives. */
  createControlChannel?: boolean;
}

/** Last remote-control command seen by an endpoint, for on-screen feedback. */
export interface RemoteInputEcho {
  /** Normalized pointer position, when the last command carried one. */
  x: number;
  y: number;
  /** Human-readable description of the most recent command. */
  label: string;
  /** Total control commands received this session. */
  count: number;
  ts: number;
}

export interface RtcSessionState {
  connState: ConnState;
  peerPresent: boolean;
  remoteStream: MediaStream | null;
  chat: ChatMessage[];
  dataChannelOpen: boolean;
  error: string | null;
  videoStats: string | null;
  /** Endpoint side: the technician's most recent input command. */
  remoteInput: RemoteInputEcho | null;
  sendChat: (text: string) => void;
  sendControl: (msg: ControlMessage) => boolean;
  disconnect: () => void;
}

/**
 * Wires SignallingClient + PeerSession with perfect negotiation and
 * offer-gating (offers are only relayed once the other peer is present;
 * a stale local offer is re-sent on peer arrival).
 */
export function useRtcSession(opts: RtcSessionOptions): RtcSessionState {
  const [connState, setConnState] = useState<ConnState>('idle');
  const [peerPresent, setPeerPresent] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [dataChannelOpen, setDataChannelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoStats, setVideoStats] = useState<string | null>(null);
  const [remoteInput, setRemoteInput] = useState<RemoteInputEcho | null>(null);
  const inputCount = useRef(0);
  const lastPos = useRef({ x: 0.5, y: 0.5 });

  const peerRef = useRef<PeerSession | null>(null);
  const sigRef = useRef<SignallingClient | null>(null);
  const peerPresentRef = useRef(false);
  const chatRef = useRef<ChatMessage[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const appendChat = useCallback((msg: ChatMessage) => {
    chatRef.current = [...chatRef.current, msg];
    setChat(chatRef.current);
  }, []);

  useEffect(() => {
    let disposed = false;
    let localStream: MediaStream | null = null;

    // Idle until the session + signalling token exist (prevents empty-payload joins).
    if (!opts.sessionId || !opts.signallingToken) return;

    void (async () => {
      const { iceServers, hasTurn } = await api.getIceConfig().catch(() => ({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        hasTurn: false,
      }));
      if (disposed) return;

      // Forced-relay validation (Phase 6): add relay=1 to the URL hash to make
      // this peer REFUSE host/srflx candidates and go through TURN only.
      const forceRelay = window.location.hash.includes('relay=1');
      const config: RTCConfiguration = { iceServers };
      if (forceRelay && hasTurn) {
        config.iceTransportPolicy = 'relay';
        console.info('[poc] forced RELAY mode active');
      }

      const peer = new PeerSession(opts.role, config, {
        onState: (state) => setConnState(state ?? 'idle'),
        onLocalSdp: (sdp) => {
          // Gate on peer presence — sending into an empty room loses the offer
          // and strands us in have-local-offer.
          if (peerPresentRef.current) {
            sigRef.current?.sendSdp(opts.sessionId, sdp);
          } else {
            pendingOfferRef.current = sdp;
          }
        },
        onLocalIce: (candidate) => {
          if (peerPresentRef.current) {
            sigRef.current?.sendIce(opts.sessionId, {
              candidate: candidate.candidate ?? '',
              sdpMid: candidate.sdpMid ?? null,
              sdpMLineIndex: candidate.sdpMLineIndex ?? null,
            });
          }
        },
        onDataChannelOpen: () => setDataChannelOpen(true),
        onDataChannelClose: () => setDataChannelOpen(false),
        onControlMessage: (msg) => {
          if (msg.type === 'chat') {
            appendChat(msg);
            return;
          }
          // A browser endpoint cannot inject OS input, so these used to be
          // dropped in silence — which looked exactly like remote control
          // being broken. Surface them instead: the browser stand-in shows
          // what the technician is doing, and the .NET agent injects it.
          inputCount.current += 1;
          let label: string;
          switch (msg.type) {
            case 'mouse_move':
              lastPos.current = { x: msg.x, y: msg.y };
              label = `move ${(msg.x * 100).toFixed(0)}%, ${(msg.y * 100).toFixed(0)}%`;
              break;
            case 'mouse_click':
              if (typeof msg.x === 'number' && typeof msg.y === 'number') {
                lastPos.current = { x: msg.x, y: msg.y };
              }
              label = `${msg.button} button ${msg.state}`;
              break;
            case 'mouse_wheel':
              label = `wheel ${msg.delta > 0 ? 'up' : 'down'}`;
              break;
            case 'key':
              label = `key ${msg.code} ${msg.state}`;
              break;
            default:
              label = 'unknown command';
          }
          setRemoteInput({
            x: lastPos.current.x,
            y: lastPos.current.y,
            label,
            count: inputCount.current,
            ts: Date.now(),
          });
        },
        onTrack: (stream) => setRemoteStream(stream),
      });
      peerRef.current = peer;

      const sig = new SignallingClient(opts.sessionId, opts.role, opts.signallingToken, {
        onPeerJoined: () => {
          peerPresentRef.current = true;
          setPeerPresent(true);
          const stale = pendingOfferRef.current;
          if (stale && peer.pc.signalingState === 'have-local-offer') {
            pendingOfferRef.current = null;
            sigRef.current?.sendSdp(opts.sessionId, stale);
          } else if (peer.pc.signalingState === 'stable') {
            // No-ops when this peer has nothing to negotiate yet, which would
            // otherwise emit an m-line-less offer and break the session.
            void peer.forceOffer();
          }
        },
        onPeerLeft: () => {
          peerPresentRef.current = false;
          setPeerPresent(false);
          setRemoteStream(null);
        },
        onSdp: (_from, sdp) => {
          void peer.handleRemoteSdp(sdp).catch((err) =>
            setError(`SDP error: ${String(err)}`),
          );
        },
        onIce: (_from, candidate) => {
          void peer.handleRemoteIce(candidate).catch(() => undefined);
        },
        onError: (message) => setError(message),
        onDisconnect: () => setPeerPresent(false),
      });
      sigRef.current = sig;

      // Technician opens the control channel immediately; its offer is gated.
      if (opts.createControlChannel) {
        peer.createDataChannel('control');
      }

      // Endpoint stand-in: attach local screen tracks (fires negotiation).
      if (opts.getLocalStream) {
        try {
          localStream = await opts.getLocalStream();
          if (localStream && !disposed) await peer.addScreenTrack(localStream);
        } catch (err) {
          setError(`screen share failed: ${String(err)}`);
        }
      }
    })();

    return () => {
      disposed = true;
      localStream?.getTracks().forEach((t) => t.stop());
      peerRef.current?.close();
      peerRef.current = null;
      sigRef.current?.close();
      sigRef.current = null;
      peerPresentRef.current = false;
      chatRef.current = [];
      setChat([]);
      setDataChannelOpen(false);
      setRemoteStream(null);
      inputCount.current = 0;
      setRemoteInput(null);
      // The ref outlives this effect (StrictMode re-runs it, and role/session
      // changes recreate the peer). A description left here belongs to the
      // PeerSession just closed, so sending it later would negotiate against a
      // connection that no longer exists.
      pendingOfferRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.sessionId, opts.signallingToken, opts.role]);

  const pendingOfferRef = useRef<import('@helpdesk/shared').SdpPayload | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void peerRef.current?.videoStats().then((s) => setVideoStats(s));
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const sendChat = useCallback(
    (text: string) => {
      const msg: ChatMessage = {
        type: 'chat',
        text,
        ts: Date.now(),
        from: opts.role,
      };
      if (peerRef.current?.sendControl(msg)) appendChat(msg);
    },
    [appendChat, opts.role],
  );

  const sendControl = useCallback((msg: ControlMessage) => {
    return peerRef.current?.sendControl(msg) ?? false;
  }, []);

  const disconnect = useCallback(() => {
    peerRef.current?.close();
    sigRef.current?.close();
    setConnState('closed');
  }, []);

  return {
    connState,
    peerPresent,
    remoteStream,
    chat,
    dataChannelOpen,
    error,
    videoStats,
    remoteInput,
    sendChat,
    sendControl,
    disconnect,
  };
}
