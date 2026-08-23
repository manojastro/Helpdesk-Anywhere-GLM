import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@helpdesk/shared';

interface Props {
  messages: ChatMessage[];
  enabled: boolean;
  onSend: (text: string) => void;
}

function ts(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel({ messages, enabled, onSend }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
          minHeight: 200,
        }}
      >
        {messages.length === 0 && (
          <p className="muted" style={{ padding: '0 12px', fontSize: 13 }}>
            No messages yet.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ padding: '4px 12px' }}>
            <span className="muted" style={{ fontSize: 12, marginRight: 8 }}>
              {ts(m.ts)}
            </span>
            <strong style={{ color: m.from === 'technician' ? '#5dade2' : '#58d68d', marginRight: 8 }}>
              {m.from === 'technician' ? 'You' : 'Endpoint'}:
            </strong>
            <span style={{ wordBreak: 'break-word' }}>{m.text}</span>
          </div>
        ))}
      </div>
      <form
        style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid #232d38' }}
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
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={!enabled || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
