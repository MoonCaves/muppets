import { useEffect } from 'react';
import type { SessionSummary } from '../../hooks/useConversations';

interface ConversationsModalProps {
  sessions: SessionSummary[];
  currentSessionId?: string;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function ConversationsModal({ sessions, currentSessionId, onSelect, onClose }: ConversationsModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-2xl mx-4 bg-white dark:bg-[#0a0a0a] border border-slate-300 dark:border-white/20 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10">
          <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono">
            ALL_SESSIONS
          </div>
          <button
            onClick={onClose}
            className="text-[9px] text-slate-400 dark:text-white/30 hover:text-slate-600 dark:hover:text-white/60 tracking-[1px] font-mono transition-colors"
          >
            CLOSE
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => onSelect(session.id)}
              className={`border p-3 transition cursor-pointer ${
                currentSessionId === session.id
                  ? 'border-violet-500/40 dark:border-violet-400/30 bg-violet-500/5 dark:bg-violet-400/5'
                  : 'border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
              }`}
            >
              <div className="flex items-start justify-between mb-1">
                <p
                  className="text-sm text-slate-700 dark:text-white/80 flex-1 mr-3"
                  style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
                >
                  {session.title || 'New conversation'}
                </p>
                <span className="text-[9px] text-slate-400 dark:text-white/30 font-mono whitespace-nowrap">
                  {formatTime(session.updated_at)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-slate-400/60 dark:text-white/20 font-mono">
                  {session.message_count} msg{session.message_count !== 1 ? 's' : ''}
                </span>
                <span className={`text-[8px] border px-1 py-0 tracking-[0.5px] font-mono ${
                  session.channel === 'web'
                    ? 'text-violet-600/60 dark:text-violet-400/50 border-violet-500/20 dark:border-violet-400/20'
                    : 'text-cyan-600/60 dark:text-cyan-400/50 border-cyan-500/20 dark:border-cyan-400/20'
                }`}>
                  {session.channel.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
