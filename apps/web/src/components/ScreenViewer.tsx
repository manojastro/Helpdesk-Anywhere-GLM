import { useEffect, useRef } from 'react';
import type { ControlMessage, MouseButton } from '@helpdesk/shared';

interface Props {
  stream: MediaStream | null;
  connected: boolean;
  onControl?: (msg: ControlMessage) => void;
  /** Disable input capture (e.g. view-only). */
  inputEnabled?: boolean;
  /** Fires when the browser presents a new video frame to the compositor. */
  onFramePresented?: () => void;
}

function relPos(e: React.MouseEvent<HTMLVideoElement>, el: HTMLVideoElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  };
}

const BUTTON_MAP: Record<number, MouseButton> = { 0: 'left', 1: 'middle', 2: 'right' };

/**
 * Remote screen renderer + normalized input capture.
 * Coordinates are normalized 0..1 so the endpoint can map to any resolution/DPI.
 */
export function ScreenViewer({ stream, connected, onControl, inputEnabled = true, onFramePresented }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  if (!connected || !stream) {
    return (
      <div
        style={{
          background: '#10161d',
          border: '1px dashed #2d3640',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 320,
          color: '#6b7480',
        }}
      >
        {connected ? 'Waiting for video track…' : 'No remote screen'}
      </div>
    );
  }

  const send = (msg: ControlMessage) => {
    if (inputEnabled) onControl?.(msg);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLVideoElement>) => {
    if (!inputEnabled) return;
    e.preventDefault();
    if (e.repeat) return;
    send({ type: 'key', code: e.code, state: 'down' });
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLVideoElement>) => {
    if (!inputEnabled) return;
    e.preventDefault();
    send({ type: 'key', code: e.code, state: 'up' });
  };

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      tabIndex={0}
      onMouseMove={(e) => send({ type: 'mouse_move', ...relPos(e, e.currentTarget) })}
      onMouseDown={(e) => {
        e.currentTarget.focus();
        send({
          type: 'mouse_click',
          button: BUTTON_MAP[e.button] ?? 'left',
          state: 'down',
          ...relPos(e, e.currentTarget),
        });
      }}
      onMouseUp={(e) =>
        send({
          type: 'mouse_click',
          button: BUTTON_MAP[e.button] ?? 'left',
          state: 'up',
          ...relPos(e, e.currentTarget),
        })
      }
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => {
        e.preventDefault();
        send({ type: 'mouse_wheel', delta: Math.sign(e.deltaY) * 120 });
      }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      style={{
        width: '100%',
        borderRadius: 10,
        border: '1px solid #232d38',
        background: '#000',
        outline: 'none',
        cursor: 'default',
      }}
    />
  );
}
