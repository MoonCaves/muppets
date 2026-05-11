import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, ToolCall } from '../api/types';
import { apiGet, apiPost, getToken } from '../api/client';

let messageIdCounter = 0;

interface SessionInfo {
  id: string;
  title?: string;
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingStatus, setStreamingStatus] = useState('');
  const [streamingTools, setStreamingTools] = useState<ToolCall[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const [sessionUsage, setSessionUsage] = useState({
    messages: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
  });

  // Load most recent session on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await apiGet<{ sessions: Array<{ id: string; title: string | null; message_count: number }> }>('/sessions');
        if (data.sessions.length > 0 && data.sessions[0].message_count > 0) {
          const session = data.sessions[0];
          setCurrentSession({ id: session.id, title: session.title || undefined });
          const msgData = await apiGet<{ messages: Array<{
            id: number; role: 'user' | 'assistant'; content: string;
            toolCalls?: ToolCall[]; memoryUpdates?: string[];
            usage?: { inputTokens: number; outputTokens: number };
            costUsd?: number; timestamp: number;
          }> }>(`/sessions/${session.id}/messages`);
          setMessages(msgData.messages.map(m => ({
            id: `msg-${++messageIdCounter}`,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            toolCalls: m.toolCalls,
            memoryUpdates: m.memoryUpdates,
            usage: m.usage,
            costUsd: m.costUsd ?? undefined,
          })));
        }
      } catch {
        // First load — no sessions yet
      }
    })();
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const msgData = await apiGet<{ messages: Array<{
        id: number; role: 'user' | 'assistant'; content: string;
        toolCalls?: ToolCall[]; memoryUpdates?: string[];
        usage?: { inputTokens: number; outputTokens: number };
        costUsd?: number; timestamp: number;
      }> }>(`/sessions/${sessionId}/messages`);
      setMessages(msgData.messages.map(m => ({
        id: `msg-${++messageIdCounter}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.toolCalls,
        memoryUpdates: m.memoryUpdates,
        usage: m.usage,
        costUsd: m.costUsd ?? undefined,
      })));
      setCurrentSession({ id: sessionId });
      setSessionUsage({ messages: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
    } catch {
      // Failed to load session — don't switch
    }
  }, []);

  const sendMessage = useCallback(async (prompt: string) => {
    if (!prompt.trim() || isStreaming) return;

    // Ensure we have a session
    let sessionId = currentSession?.id;
    if (!sessionId) {
      try {
        const data = await apiPost<{ sessionId: string }>('/sessions', {});
        sessionId = data.sessionId;
        setCurrentSession({ id: sessionId });
      } catch {
        // Fall back to local-only if session creation fails
      }
    }

    const userMsg: Message = {
      id: `msg-${++messageIdCounter}`,
      role: 'user',
      content: prompt.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingText('');
    setStreamingStatus('thinking');
    setStreamingTools([]);

    const token = getToken();
    const controller = new AbortController();
    abortRef.current = () => controller.abort();

    // Local accumulators (avoid stale closure from useState)
    let fullText = '';
    const toolCalls: ToolCall[] = [];
    const memoryUpdates: string[] = [];

    try {
      const res = await fetch('/api/web/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt: prompt.trim(), sessionId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Chat error: ${res.status} ${res.statusText}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      let costUsd: number | undefined;
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let eventEnd: number;
        while ((eventEnd = buffer.indexOf('\n\n')) !== -1) {
          const eventBlock = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);

          for (const line of eventBlock.split('\n')) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (currentEvent === 'text' && data.text) {
                  fullText += data.text;
                  setStreamingText(fullText);
                  setStreamingStatus('');

                } else if (currentEvent === 'status') {
                  if (data.status === 'thinking') {
                    setStreamingStatus('Thinking...');
                  } else if (data.status === 'tool_use') {
                    const statusText = data.detail
                      ? `${data.label} ${data.detail}`
                      : data.label;
                    setStreamingStatus(statusText);
                  }

                } else if (currentEvent === 'tool_start') {
                  const tc: ToolCall = {
                    id: data.id,
                    name: data.name,
                    label: data.label,
                    detail: data.detail || '',
                    status: 'running',
                  };
                  toolCalls.push(tc);
                  setStreamingTools([...toolCalls]);

                } else if (currentEvent === 'tool_end') {
                  const idx = toolCalls.findIndex(t => t.id === data.id);
                  if (idx !== -1) {
                    toolCalls[idx] = {
                      ...toolCalls[idx],
                      status: data.success ? 'done' : 'error',
                      result: data.summary || undefined,
                    };
                    setStreamingTools([...toolCalls]);

                    // Detect memory block updates
                    const toolName = toolCalls[idx].name;
                    const toolDetail = (toolCalls[idx].detail || '').toUpperCase();
                    if ((toolName === 'Edit' || toolName === 'Write') && data.success) {
                      if (toolDetail.includes('SOUL')) memoryUpdates.push('soul');
                      else if (toolDetail.includes('USER')) memoryUpdates.push('user');
                      else if (toolDetail.includes('HEARTBEAT')) memoryUpdates.push('heartbeat');
                    }
                  }

                } else if (currentEvent === 'result') {
                  if (data.usage) usage = data.usage;
                  if (typeof data.costUsd === 'number') costUsd = data.costUsd;
                  if (!fullText && data.summary) {
                    fullText = data.summary;
                    setStreamingText(fullText);
                  }

                } else if (currentEvent === 'error') {
                  const errText = data.message || 'Unknown error';
                  fullText += `\n\nError: ${errText}`;
                  setStreamingText(fullText);
                }
              } catch {
                // skip malformed JSON
              }
              currentEvent = '';
            }
          }
        }
      }

      const assistantMsg: Message = {
        id: `msg-${++messageIdCounter}`,
        role: 'assistant',
        content: fullText || 'No response received.',
        timestamp: Date.now(),
        usage,
        costUsd,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        memoryUpdates: memoryUpdates.length > 0 ? [...new Set(memoryUpdates)] : undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);

      setSessionUsage(prev => ({
        messages: prev.messages + 1,
        inputTokens: prev.inputTokens + (usage?.inputTokens || 0),
        outputTokens: prev.outputTokens + (usage?.outputTokens || 0),
        estimatedCost: prev.estimatedCost + (costUsd || 0),
      }));
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      const errorMsg: Message = {
        id: `msg-${++messageIdCounter}`,
        role: 'assistant',
        content: `Error: ${(err as Error).message}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      setStreamingStatus('');
      setStreamingTools([]);
      abortRef.current = null;
    }
  }, [isStreaming, currentSession]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.();
  }, []);

  const startNewSession = useCallback(async () => {
    setMessages([]);
    setCurrentSession(null);
    setSessionUsage({ messages: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
  }, []);

  return {
    messages,
    isStreaming,
    streamingText,
    streamingStatus,
    streamingTools,
    sessionUsage,
    currentSession,
    sendMessage,
    stopStreaming,
    loadSession,
    startNewSession,
  };
}
