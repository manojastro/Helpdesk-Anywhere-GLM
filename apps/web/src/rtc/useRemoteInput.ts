import { useCallback, useEffect, useRef, useState } from 'react';
import type { ControlMessage, MouseButton } from '@helpdesk/shared';

/** Browser button index → protocol button name. */
const BUTTON_MAP: Record<number, MouseButton> = { 0: 'left', 1: 'middle', 2: 'right' };

/**
 * Combos the browser would otherwise act on itself (close tab, new tab,
 * reload, find, print…). While control is active these belong to the remote
 * desktop, so we swallow them locally and forward them instead.
 */
const HIJACKED_WITH_CTRL = new Set([
  'KeyW', 'KeyT', 'KeyN', 'KeyR', 'KeyF', 'KeyP', 'KeyS', 'KeyD',
  'KeyL', 'KeyJ', 'KeyH', 'KeyO', 'KeyU', 'Digit1', 'Digit2', 'Digit3',
  'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Tab',
]);

/**
 * Keys the browser or the page would act on locally.
 *
 * Tab is here for a subtle reason: unprevented, it moves focus out of the
 * viewer and into the next control — typically the chat box. From then on
 * every keystroke is treated as chat input and silently stops reaching the
 * remote machine, so the keyboard appears to die mid-session.
 */
const HIJACKED_BARE = new Set([
  'F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12', 'Tab',
]);

export interface RemoteInputOptions {
  /** Send a control message; returns false when the DataChannel is not open. */
  send: (msg: ControlMessage) => boolean;
  /** Master switch — when false nothing is captured or forwarded. */
  enabled: boolean;
  /** The element showing the remote screen (coordinates are relative to it). */
  surfaceRef: React.RefObject<HTMLElement | null>;
}

/**
 * Technician-side input capture for remote control.
 *
 * Keyboard is captured at the window, not on the video element: requiring
 * focus on the <video> meant a stray click anywhere silently stopped
 * keystrokes reaching the endpoint. Mouse movement is coalesced to one
 * message per animation frame so a drag cannot flood the DataChannel, and
 * every key/button held down is released when focus is lost so nothing
 * sticks down on the remote machine.
 */
export function useRemoteInput({ send, enabled, surfaceRef }: RemoteInputOptions) {
  const heldKeys = useRef<Set<string>>(new Set());
  const heldButtons = useRef<Set<MouseButton>>(new Set());
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const lastSent = useRef<{ x: number; y: number } | null>(null);
  /** Virtual pointer position used while the real cursor is locked. */
  const virtualPos = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const [pointerLocked, setPointerLocked] = useState(false);
  const rafId = useRef<number | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  /** Release everything currently held — used on blur, disable and unmount. */
  const releaseAll = useCallback(() => {
    for (const code of heldKeys.current) {
      sendRef.current({ type: 'key', code, state: 'up' });
    }
    heldKeys.current.clear();
    for (const button of heldButtons.current) {
      sendRef.current({ type: 'mouse_click', button, state: 'up' });
    }
    heldButtons.current.clear();
  }, []);

  const flushMove = useCallback(() => {
    rafId.current = null;
    const p = pendingMove.current;
    if (!p) return;
    pendingMove.current = null;
    if (lastSent.current && lastSent.current.x === p.x && lastSent.current.y === p.y) return;
    lastSent.current = { x: p.x, y: p.y };
    sendRef.current({ type: 'mouse_move', x: p.x, y: p.y });
  }, []);

  /**
   * Send a move immediately, cancelling any frame-coalesced one.
   *
   * Buttons and wheel must never overtake the move that positions them: the
   * endpoint agent applies a click at the cursor's *current* location, so a
   * click that arrives before its move lands wherever the pointer used to be.
   */
  const sendMoveNow = useCallback((x: number, y: number) => {
    if (rafId.current !== null) {
      window.cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    pendingMove.current = null;
    // Re-sending a position the remote pointer already holds is pure traffic.
    const last = lastSent.current;
    if (last && last.x === x && last.y === y) return;
    lastSent.current = { x, y };
    sendRef.current({ type: 'mouse_move', x, y });
  }, []);

  /** Position the remote pointer before a button or wheel event is sent. */
  const positionBefore = useCallback(
    (p: { x: number; y: number } | null) => {
      if (p) sendMoveNow(p.x, p.y);
      else if (pendingMove.current) {
        sendMoveNow(pendingMove.current.x, pendingMove.current.y);
      }
    },
    [sendMoveNow],
  );

  const queueMove = useCallback(
    (x: number, y: number) => {
      pendingMove.current = { x, y };
      if (rafId.current === null) {
        rafId.current = window.requestAnimationFrame(flushMove);
      }
    },
    [flushMove],
  );

  const relative = useCallback(
    (clientX: number, clientY: number) => {
      const el = surfaceRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return {
        x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
      };
    },
    [surfaceRef],
  );

  // ---- keyboard: window-level so focus cannot silently break typing ----
  useEffect(() => {
    if (!enabled) {
      releaseAll();
      return;
    }

    const shouldSwallow = (e: KeyboardEvent): boolean => {
      if (HIJACKED_BARE.has(e.code)) return true;
      if ((e.ctrlKey || e.metaKey) && HIJACKED_WITH_CTRL.has(e.code)) return true;
      if (e.altKey) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Never steal keystrokes aimed at the chat box or any other input.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (shouldSwallow(e)) e.preventDefault();
      // e.repeat still forwards: holding a key must repeat on the remote too.
      heldKeys.current.add(e.code);
      sendRef.current({ type: 'key', code: e.code, state: 'down' });
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (shouldSwallow(e)) e.preventDefault();
      heldKeys.current.delete(e.code);
      sendRef.current({ type: 'key', code: e.code, state: 'up' });
    };

    // Losing focus (alt-tab, switching tab) must not leave keys stuck down.
    const onBlur = () => releaseAll();
    const onVisibility = () => {
      if (document.hidden) releaseAll();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      releaseAll();
    };
  }, [enabled, releaseAll]);

  // Cancel any queued frame on unmount.
  useEffect(
    () => () => {
      if (rafId.current !== null) window.cancelAnimationFrame(rafId.current);
    },
    [],
  );

  /** Where the remote pointer is: virtual while locked, element-relative otherwise. */
  const pointRef = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const el = surfaceRef.current;
      if (el && document.pointerLockElement === el) return virtualPos.current;
      return relative(e.clientX, e.clientY);
    },
    [relative, surfaceRef],
  );

  /** Hide and pin the local cursor, routing movement to the remote machine. */
  const lockPointer = useCallback(() => {
    const el = surfaceRef.current;
    if (!el) return;
    void (el.requestPointerLock?.() as unknown as Promise<void> | undefined);
  }, [surfaceRef]);

  useEffect(() => {
    const onChange = () => {
      const el = surfaceRef.current;
      setPointerLocked(!!el && document.pointerLockElement === el);
    };
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, [surfaceRef]);

  // Releasing the lock must not strand a held button on the remote machine.
  useEffect(() => {
    if (!pointerLocked && heldButtons.current.size > 0) releaseAll();
  }, [pointerLocked, releaseAll]);

  // ---- mouse handlers, spread onto the surface element ----
  const handlers = {
    onPointerMove: (e: React.PointerEvent) => {
      if (!enabled) return;
      const el = surfaceRef.current;
      if (el && document.pointerLockElement === el) {
        // Locked: the OS cursor does not move, so absolute coordinates are
        // meaningless. Integrate the relative deltas into a virtual position
        // instead. This is what makes control usable when the technician and
        // the endpoint are the same machine — an unlocked pointer would be
        // warped by our own injection and feed back into itself.
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const v = virtualPos.current;
        virtualPos.current = {
          x: Math.min(1, Math.max(0, v.x + e.movementX / r.width)),
          y: Math.min(1, Math.max(0, v.y + e.movementY / r.height)),
        };
        queueMove(virtualPos.current.x, virtualPos.current.y);
        return;
      }
      const p = relative(e.clientX, e.clientY);
      if (p) {
        virtualPos.current = p;
        queueMove(p.x, p.y);
      }
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled) return;
      const button = BUTTON_MAP[e.button] ?? 'left';
      const p = pointRef(e);
      // Send first: pointer capture is a nicety, but setPointerCapture throws
      // NotFoundError for a pointer id the browser does not consider active,
      // and an exception here would swallow the click entirely.
      positionBefore(p);
      heldButtons.current.add(button);
      send({ type: 'mouse_click', button, state: 'down', ...(p ?? {}) });
      try {
        // Capture the pointer so a drag that leaves the surface still tracks.
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        // preventScroll matters: a plain focus() scrolls the viewer into view,
        // which moves the element under the pointer between press and release.
        // The release then maps to a different position and Windows sees a
        // drag instead of a click — the first click of a session was lost.
        (e.currentTarget as HTMLElement).focus?.({ preventScroll: true });
      } catch {
        /* capture unavailable — dragging past the edge just stops tracking */
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!enabled) return;
      const button = BUTTON_MAP[e.button] ?? 'left';
      const p = pointRef(e);
      positionBefore(p);
      heldButtons.current.delete(button);
      send({ type: 'mouse_click', button, state: 'up', ...(p ?? {}) });
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        /* nothing was captured */
      }
    },
    onPointerLeave: () => {
      // Buttons held when the cursor leaves would otherwise stay down remotely.
      if (!enabled) return;
      for (const button of heldButtons.current) {
        send({ type: 'mouse_click', button, state: 'up' });
      }
      heldButtons.current.clear();
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onWheel: (e: React.WheelEvent) => {
      if (!enabled) return;
      // Scroll applies under the remote cursor, so position it first.
      positionBefore(pointRef(e));
      // Windows wheel delta is 120 per notch, positive = away from the user.
      send({ type: 'mouse_wheel', delta: -Math.sign(e.deltaY) * 120 });
    },
  };

  /** Send a chord (e.g. Ctrl+Alt+Delete) as ordered downs then reversed ups. */
  const sendChord = useCallback((codes: string[]) => {
    for (const code of codes) sendRef.current({ type: 'key', code, state: 'down' });
    for (const code of [...codes].reverse()) {
      sendRef.current({ type: 'key', code, state: 'up' });
    }
  }, []);

  return { handlers, releaseAll, sendChord, lockPointer, pointerLocked };
}
