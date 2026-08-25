import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, PeerRole } from '@helpdesk/shared';

interface Props {
  messages: ChatMessage[];
  enabled: boolean;
  onSend: (text: string) => void;
  /** Which side is rendering this panel — decides "You" vs the other party. */
  selfRole: PeerRole;
}

function ts(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel({ messages, enabled, onSend, selfRole }: Props) {
  const otherLabel = selfRole === 'technician' ? 'Endpoint' : 'Technician';
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <>
      <div ref={listRef} className="chat-list">
        {messages.length === 0 && <p className="chat-empty">No messages yet.</p>}
        {messages.map((m, i) => {
          const own = m.from === selfRole;
          return (
            <div key={i} className={own ? 'msg is-own' : 'msg'}>
              <span className="msg-meta">
                {own ? 'You' : otherLabel} · {ts(m.ts)}
              </span>
              <span className="msg-bubble">{m.text}</span>
            </div>
          );
        })}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || !enabled) return;
          onSend(text.trim());
          setText('');
        }}
      >
        <input
          placeholder={enabled ? 'Type a message…' : 'Chat unavailable'}
          disabled={!enabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!enabled || !text.trim()}>
          Send
        </button>
      </form>
    </>
  );
}
