/**
 * Recent sessions panel — list previous conversations, start new ones.
 * Ported from web RecentConversations.tsx.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';

interface SessionSummary {
  id: string;
  channel: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface SessionListProps {
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export default function SessionList({ currentSessionId, onSelectSession, onNewSession }: SessionListProps) {
  const { serverUrl, apiToken } = useApp();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
      const res = await fetch(`${serverUrl}/api/web/sessions`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {}
    setLoading(false);
  }, [serverUrl, apiToken]);

  useEffect(() => {
    fetchSessions();
    const timer = setInterval(fetchSessions, 60_000);
    return () => clearInterval(timer);
  }, [fetchSessions]);

  const withMessages = sessions.filter(s => s.message_count > 0);

  if (loading) return <div className="text-[9px] animate-pulse" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>LOADING_SESSIONS...</div>;

  return (
    <div style={{ border: '1px solid var(--border-color)', padding: '12px', background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontSize: '9px', letterSpacing: '2px', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>RECENT_SESSIONS</span>
        <button
          onClick={onNewSession}
          className="text-[9px] tracking-[1px]"
          style={{ color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)', background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.6 }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
        >
          + NEW
        </button>
      </div>

      {withMessages.length === 0 && (
        <p className="text-[10px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', fontWeight: 300 }}>No conversations yet</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {withMessages.slice(0, 8).map(session => (
          <div
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            style={{
              border: `1px solid ${currentSessionId === session.id ? 'rgba(139,92,246,0.3)' : 'var(--border-color)'}`,
              padding: '8px',
              cursor: 'pointer',
              background: currentSessionId === session.id ? 'rgba(139,92,246,0.05)' : 'var(--bg-secondary)',
              transition: 'border-color 150ms',
            }}
            onMouseEnter={(e) => { if (currentSessionId !== session.id) e.currentTarget.style.borderColor = 'var(--border-color-hover)'; }}
            onMouseLeave={(e) => { if (currentSessionId !== session.id) e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            <p className="text-[11px] truncate mb-0.5" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, color: 'var(--fg-primary)' }}>
              {session.title || 'New conversation'}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-[8px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                {session.message_count} msg{session.message_count !== 1 ? 's' : ''}
              </span>
              <span className="text-[9px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                {formatRelativeTime(session.updated_at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
