import { useState } from 'react';
import { useConversations, type SessionSummary } from '../../hooks/useConversations';
import ConversationsModal from './ConversationsModal';

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

interface RecentConversationsProps {
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export default function RecentConversations({ currentSessionId, onSelectSession, onNewSession }: RecentConversationsProps) {
  const { sessions, loading } = useConversations();
  const [showAll, setShowAll] = useState(false);

  if (loading) {
    return (
      <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-4">
        <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono animate-pulse">
          LOADING_SESSIONS...
        </div>
      </div>
    );
  }

  const withMessages = sessions.filter(s => s.message_count > 0);

  if (withMessages.length === 0) {
    return (
      <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-4">
        <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono mb-3">
          RECENT_SESSIONS
        </div>
        <p
          className="text-[10px] text-slate-400 dark:text-white/30"
          style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
        >
          No conversations yet
        </p>
      </div>
    );
  }

  const visible = withMessages.slice(0, 5);

  return (
    <>
      <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono">
            RECENT_SESSIONS
          </div>
          <div className="flex gap-2">
            <button
              onClick={onNewSession}
              className="text-[9px] text-emerald-600/60 dark:text-emerald-400/60 hover:text-emerald-600 dark:hover:text-emerald-400 tracking-[1px] font-mono transition-colors"
            >
              + NEW
            </button>
            {withMessages.length > 5 && (
              <button
                onClick={() => setShowAll(true)}
                className="text-[9px] text-violet-600/60 dark:text-violet-400/60 hover:text-violet-600 dark:hover:text-violet-400 tracking-[1px] font-mono transition-colors"
              >
                VIEW ALL
              </button>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {visible.map((session) => (
            <div
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`border p-2 transition cursor-pointer ${
                currentSessionId === session.id
                  ? 'border-violet-500/40 dark:border-violet-400/30 bg-violet-500/5 dark:bg-violet-400/5'
                  : 'border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
              }`}
            >
              <p
                className="text-xs text-slate-600 dark:text-white/70 truncate mb-1"
                style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
              >
                {session.title || 'New conversation'}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-slate-400/60 dark:text-white/20 font-mono">
                  {session.message_count} msg{session.message_count !== 1 ? 's' : ''}
                </span>
                <span className="text-[9px] text-slate-400 dark:text-white/30 font-mono">
                  {formatRelativeTime(session.updated_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showAll && (
        <ConversationsModal
          sessions={withMessages}
          currentSessionId={currentSessionId}
          onSelect={(id) => { onSelectSession(id); setShowAll(false); }}
          onClose={() => setShowAll(false)}
        />
      )}
    </>
  );
}
