import type { ControlMessage, IceCandidatePayload, PeerRole, SdpPayload } from '@helpdesk/shared';

export type ConnState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

export interface PeerSessionCallbacks {
  onState?: (state: ConnState, detail?: string) => void;
  onDataChannelOpen?: () => void;
  onDataChannelClose?: () => void;
  onControlMessage?: (msg: ControlMessage) => void;
  /** Remote media (screen) stream arrived or ended. */
  onTrack?: (stream: MediaStream | null) => void;
  onLocalIce?: (candidate: RTCIceCandidateInit) => void;
  onLocalSdp?: (sdp: SdpPayload) => void;
}

/**
 * WebRTC peer session with perfect negotiation.
 * The technician is the impolite offerer and owns the DataChannel;
 * the endpoint answers and sends the screen track.
 */
export class PeerSession {
  readonly pc: RTCPeerConnection;
  readonly role: PeerRole;
  dataChannel: RTCDataChannel | null = null;

  private makingOffer = false;
  private ignoreOffer = false;
  private readonly polite: boolean;
  private readonly cb: PeerSessionCallbacks;
  private closed = false;

  constructor(role: PeerRole, config: RTCConfiguration, cb: PeerSessionCallbacks) {
    this.role = role;
    this.polite = role === 'endpoint';
    this.cb = cb;

    this.pc = new RTCPeerConnection(config);

    // The technician receives the endpoint's screen: the offer must include a
    // video m-line so the .NET agent's VP8 answer track has somewhere to land.
    if (role === 'technician') {
      this.pc.addTransceiver('video', { direction: 'recvonly' });
    }

    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      const map: Record<RTCPeerConnectionState, ConnState> = {
        new: 'idle',
        connecting: 'connecting',
        connected: 'connected',
        disconnected: 'disconnected',
        failed: 'failed',
        closed: 'closed',
      };
      this.cb.onState?.(map[s], s);
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.cb.onLocalIce?.(candidate.toJSON());
    };

    this.pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.cb.onTrack?.(stream);
      } else if (event.track.kind === 'video') {
        // .NET answers carry no msid — synthesize a stream from the track.
        this.cb.onTrack?.(new MediaStream([event.track]));
      }
    };

    this.pc.ondatachannel = (event) => {
      this.bindDataChannel(event.channel);
    };

    this.pc.onnegotiationneeded = () => {
      void this.handleNegotiationNeeded();
    };
  }

  /** Technician side: create the control DataChannel. */
  createDataChannel(label = 'control'): RTCDataChannel {
    const dc = this.pc.createDataChannel(label, { ordered: true });
    this.bindDataChannel(dc);
    return dc;
  }

  /** Endpoint side (browser stand-in): share screen as the video track. */
  async addScreenTrack(stream: MediaStream): Promise<void> {
    for (const track of stream.getTracks()) {
      this.pc.addTrack(track, stream);
    }
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.cb.onTrack?.(null);
    });
  }

  private bindDataChannel(dc: RTCDataChannel): void {
    this.dataChannel = dc;
    dc.onopen = () => this.cb.onDataChannelOpen?.();
    dc.onclose = () => this.cb.onDataChannelClose?.();
    dc.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data) as ControlMessage;
        this.cb.onControlMessage?.(msg);
      } catch {
        // ignore malformed
      }
    };
  }

  sendControl(msg: ControlMessage): boolean {
    if (this.dataChannel?.readyState !== 'open') return false;
    this.dataChannel.send(JSON.stringify(msg));
    return true;
  }

  private async handleNegotiationNeeded(): Promise<void> {
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      const ld = this.localSdp();
      if (ld) this.cb.onLocalSdp?.(ld);
    } catch (err) {
      console.error('[peer] negotiation error', err);
    } finally {
      this.makingOffer = false;
    }
  }

  /** Feed a remote SDP (from signal:sdp). Resolves with what should be relayed. */
  async handleRemoteSdp(sdp: SdpPayload): Promise<void> {
    const description = new RTCSessionDescription(sdp);
    const offerCollision =
      description.type === 'offer' &&
      (this.makingOffer || this.pc.signalingState !== 'stable');

    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    // Perfect negotiation: on a collision the polite peer yields by rolling
    // its own offer back first. Chrome can do this implicitly, but rolling
    // back explicitly keeps the state machine predictable across browsers.
    if (offerCollision && this.pc.signalingState === 'have-local-offer') {
      await this.pc.setLocalDescription({ type: 'rollback' });
    }

    await this.pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await this.pc.setLocalDescription();
      const ld = this.localSdp();
      if (ld) this.cb.onLocalSdp?.(ld);
    }
  }

  /**
   * True when there is actually something to negotiate. A peer with no
   * transceivers and no DataChannel produces an offer with ZERO m-lines, and
   * applying that to a peer that already negotiated m-lines fails with
   * "The order of m-lines in subsequent offer doesn't match order from
   * previous offer/answer" — which kills the session.
   */
  hasNegotiableMedia(): boolean {
    return this.pc.getTransceivers().length > 0 || this.dataChannel !== null;
  }

  /** (Re-)emit an offer when stable — used when a peer arrives after media was ready. */
  async forceOffer(): Promise<void> {
    if (this.pc.signalingState !== 'stable') return;
    // The endpoint reaches this while the user is still picking a screen in
    // the getDisplayMedia dialog, when it has nothing to offer yet. Staying
    // quiet is correct: adding the track fires negotiationneeded later.
    if (!this.hasNegotiableMedia()) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      const ld = this.localSdp();
      if (ld) this.cb.onLocalSdp?.(ld);
    } finally {
      this.makingOffer = false;
    }
  }

  /** Current local description to relay (offer or answer), or null. */
  localSdp(): SdpPayload | null {
    const ld = this.pc.localDescription;
    if (!ld) return null;
    return { type: ld.type as 'offer' | 'answer', sdp: ld.sdp };
  }

  async handleRemoteIce(candidate: IceCandidatePayload): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!this.ignoreOffer) throw err;
    }
  }

  /** Inbound video stats for the quality indicator (null until connected). */
  async videoStats(): Promise<string | null> {
    if (this.pc.connectionState !== 'connected') return null;
    try {
      const stats = await this.pc.getStats();
      let bytes = -1;
      let frames = -1;
      let lost = -1;
      stats.forEach((r) => {
        const rep = r as unknown as {
          type: string;
          kind?: string;
          bytesReceived?: number;
          framesDecoded?: number;
          packetsLost?: number;
        };
        if (rep.type === 'inbound-rtp' && rep.kind === 'video') {
          bytes = rep.bytesReceived ?? 0;
          frames = rep.framesDecoded ?? 0;
          lost = rep.packetsLost ?? 0;
        }
      });
      if (bytes < 0) return 'video: waiting for RTP…';
      return `video ✓ ${Math.round(bytes / 1024)} KB · ${frames} frames decoded · ${lost} lost`;
    } catch {
      return null;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.dataChannel?.close();
    } catch {
      /* already closed */
    }
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.ondatachannel = null;
    this.pc.onnegotiationneeded = null;
    this.pc.close();
    this.cb.onState?.('closed', 'local close');
  }
}
