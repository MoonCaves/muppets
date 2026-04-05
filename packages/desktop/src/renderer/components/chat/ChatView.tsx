/**
 * Chat tab — SSE streaming chat.
 * Future: imports from @kyberbot/web via exports field.
 * For now: standalone implementation using the same SSE protocol.
 */

import { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatView() {
  const { serverUrl, apiToken } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;
    const prompt = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: prompt }]);
    setStreaming(true);
    setStreamText('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

      const res = await fetch(`${serverUrl}/api/web/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              fullText += data.text;
              setStreamText(fullText);
            }
          } catch { /* skip */ }
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: fullText }]);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${(err as Error).message}` }]);
      }
    } finally {
      setStreaming(false);
      setStreamText('');
      abortRef.current = null;
    }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !streaming && (
          <div className="flex items-center justify-center h-full">
            <span className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
              Start a conversation...
            </span>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="mb-3">
            <div className="text-[9px] tracking-[1px] uppercase mb-1" style={{ color: msg.role === 'user' ? 'var(--accent-cyan)' : 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>
              {msg.role === 'user' ? 'YOU' : 'ASSISTANT'}
            </div>
            <div className="text-[12px] whitespace-pre-wrap" style={{ fontFamily: 'var(--font-sans)', color: 'var(--fg-primary)', lineHeight: '1.5' }}>
              {msg.content}
            </div>
          </div>
        ))}
        {streaming && streamText && (
          <div className="mb-3">
            <div className="text-[9px] tracking-[1px] uppercase mb-1" style={{ color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>ASSISTANT</div>
            <div className="text-[12px] whitespace-pre-wrap" style={{ fontFamily: 'var(--font-sans)', color: 'var(--fg-primary)', lineHeight: '1.5' }}>
              {streamText}
              <span className="inline-block w-[2px] h-[14px] ml-1 animate-pulse" style={{ background: 'var(--accent-emerald)' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3 flex gap-2" style={{ borderColor: 'var(--border-color)' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Message..."
          disabled={streaming}
          className="flex-1 px-3 py-2 text-[12px] outline-none"
          style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-secondary)', color: 'var(--fg-primary)', border: '1px solid var(--border-color)' }}
          autoFocus
        />
        {streaming ? (
          <button onClick={stopStreaming} className="px-3 py-2 text-[9px] tracking-[1px] uppercase border" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--status-error)', color: 'var(--status-error)', background: 'transparent', cursor: 'pointer' }}>Stop</button>
        ) : (
          <button onClick={sendMessage} disabled={!input.trim()} className="px-3 py-2 text-[9px] tracking-[1px] uppercase border" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)', background: 'transparent', cursor: 'pointer', opacity: input.trim() ? 1 : 0.3 }}>Send</button>
        )}
      </div>
    </div>
  );
}
