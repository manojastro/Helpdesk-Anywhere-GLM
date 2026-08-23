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

export interface RtcSessionState {
  connState: ConnState;
  peerPresent: boolean;
  remoteStream: MediaStream | null;
  chat: ChatMessage[];
  dataChannelOpen: boolean;
  error: string | null;
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
      const { iceServers } = await api.getIceConfig().catch(() => ({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      }));
      if (disposed) return;

      const peer = new PeerSession(opts.role, { iceServers }, {
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
          if (msg.type === 'chat') appendChat(msg);
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
            sigRef.current?.sendSdp(opts.sessionId, stale);
          } else if (peer.pc.signalingState === 'stable') {
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.sessionId, opts.signallingToken, opts.role]);

  const pendingOfferRef = useRef<import('@helpdesk/shared').SdpPayload | null>(null);

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
    sendChat,
    sendControl,
    disconnect,
  };
}
