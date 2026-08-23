/**
 * DataChannel control protocol between technician browser and endpoint agent.
 * Carried over WebRTC DataChannel (reliable, ordered) as JSON text.
 *
 * Mirrored by the C# models in apps/agent/src/HelpdeskAgent/ControlProtocol.cs.
 */

export type MouseButton = 'left' | 'right' | 'middle';
export type InputState = 'down' | 'up';

export interface ChatMessage {
  type: 'chat';
  text: string;
  /** Unix epoch milliseconds, set by sender. */
  ts: number;
  from: 'technician' | 'endpoint';
}

export interface MouseMoveMessage {
  type: 'mouse_move';
  /** Normalized 0.0–1.0 relative to captured desktop. */
  x: number;
  y: number;
}

export interface MouseClickMessage {
  type: 'mouse_click';
  button: MouseButton;
  state: InputState;
  /** Optional normalized coords for click-at-position. */
  x?: number;
  y?: number;
}

export interface MouseWheelMessage {
  type: 'mouse_wheel';
  /** Positive scrolls down (Windows wheel delta convention). */
  delta: number;
}

export interface KeyMessage {
  type: 'key';
  /** Browser KeyboardEvent.code value, e.g. "KeyA", "ShiftLeft". */
  code: string;
  state: InputState;
}

export type ControlMessage =
  | ChatMessage
  | MouseMoveMessage
  | MouseClickMessage
  | MouseWheelMessage
  | KeyMessage;

export function isControlMessage(v: unknown): v is ControlMessage {
  if (typeof v !== 'object' || v === null) return false;
  const t = (v as { type?: unknown }).type;
  return (
    t === 'chat' || t === 'mouse_move' || t === 'mouse_click' || t === 'mouse_wheel' || t === 'key'
  );
}
