import { useEffect, useRef } from 'react';
import type { ControlMessage } from '@helpdesk/shared';
import { useRemoteInput } from '../rtc/useRemoteInput';

interface Props {
  stream: MediaStream | null;
  connected: boolean;
  onControl?: (msg: ControlMessage) => boolean;
  /** Disable input capture (e.g. view-only). */
  inputEnabled?: boolean;
  /** Fires when the browser presents a new video frame to the compositor. */
  onFramePresented?: () => void;
}

/**
 * Remote screen renderer + normalized input capture.
 * Coordinates are normalized 0..1 so the endpoint can map to any resolution/DPI.
 */
export function ScreenViewer({
  stream,
  connected,
  onControl,
  inputEnabled = true,
  onFramePresented,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const { handlers, lockPointer, pointerLocked } = useRemoteInput({
    send: (msg) => onControl?.(msg) ?? false,
    enabled: inputEnabled && connected && !!stream,
    surfaceRef: videoRef,
  });


  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    if (stream) {
      void el.play().catch(() => undefined);
      // requestVideoFrameCallback fires per COMPOSITED frame — this proves
      // the video is actually painting, not merely decoding.
      type VideoWithRvfc = HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      const v = el as VideoWithRvfc;
      if (v.requestVideoFrameCallback) {
        let cancelled = false;
        const tick = () => {
          if (cancelled) return;
          onFramePresented?.();
          v.requestVideoFrameCallback?.(tick);
        };
        v.requestVideoFrameCallback?.(tick);
        return () => {
          cancelled = true;
        };
      }
    }
    return undefined;
    // `connected` matters as much as `stream`: while it is false this component
    // renders the placeholder instead of the <video>, so videoRef is null and
    // this effect has nothing to attach to. ontrack fires well before the peer
    // reaches 'connected', so on the normal ordering the <video> mounts only on
    // a later render — and without `connected` here that render never assigns
    // srcObject, leaving a permanently black viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, connected]);

  if (!connected || !stream) {
    return (
      <div className="stage">
        <div className="stage-empty">
          {connected ? (
            <>
              <span className="spinner" />
              <span>Waiting for video track…</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 26, opacity: 0.5 }}>🖥️</span>
              <span>No remote screen</span>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                The endpoint has not started sharing yet.
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`stage${inputEnabled ? ' is-controllable' : ''}`}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        tabIndex={0}
        {...handlers}
      />
      {inputEnabled && (
        <button
          type="button"
          className={`lock-pill${pointerLocked ? ' is-locked' : ''}`}
          onClick={lockPointer}
          disabled={pointerLocked}
          title={
            pointerLocked
              ? 'Your cursor is hidden and driving the remote machine. Press Esc to release it.'
              : 'Hide the local cursor and send raw movement to the remote machine. Essential when the technician and endpoint are the same computer.'
          }
        >
          {pointerLocked ? 'Pointer locked — Esc to release' : 'Lock pointer'}
        </button>
      )}
    </div>
  );
}
