/**
 * Heartbeat tab — task list, manual trigger, log viewer.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { manageFetch } from '../../utils/api';

interface HeartbeatTask {
  name: string;
  schedule: string;
  action: string;
  skill: string | null;
  window: string | null;
  lastRun: string | null;
}

export default function HeartbeatView() {
  const { serverUrl, apiToken } = useApp();
  const [tasks, setTasks] = useState<HeartbeatTask[]>([]);
  const [logContent, setLogContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [rawContent, setRawContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'tasks' | 'editor' | 'log'>('tasks');

  const loadData = useCallback(async () => {
    try {
      const data = await manageFetch<{ tasks: HeartbeatTask[]; rawContent: string }>(serverUrl, apiToken, '/heartbeat');
      setTasks(data.tasks);
      setRawContent(data.rawContent);
      setEditContent(data.rawContent);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, [serverUrl, apiToken]);

  const loadLog = useCallback(async () => {
    try {
      const data = await manageFetch<{ content: string; exists: boolean }>(serverUrl, apiToken, '/heartbeat/log?lines=100');
      setLogContent(data.content);
    } catch { /* offline */ }
  }, [serverUrl, apiToken]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (tab === 'log') loadLog(); }, [tab, loadLog]);

  const formatTime = (iso: string | null) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleString();
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex items-center gap-0 px-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {(['tasks', 'editor', 'log'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className="px-3 py-2 relative" style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase', color: tab === t ? 'var(--accent-emerald)' : 'var(--fg-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            {t}
            {tab === t && <div className="absolute bottom-0 left-0 right-0 h-[1px]" style={{ background: 'var(--accent-emerald)' }} />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'tasks' && (
          <>
            {loading && <span className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Loading...</span>}
            {tasks.length === 0 && !loading && (
              <div className="text-center py-8"><span className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>No heartbeat tasks defined</span></div>
            )}
            <div className="grid gap-2">
              {tasks.map((task) => (
                <div key={task.name} className="p-3 border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-medium" style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{task.name}</span>
                    <span className="text-[9px] px-1" style={{ color: 'var(--accent-cyan)', background: 'rgba(34,211,238,0.1)' }}>{task.schedule}</span>
                  </div>
                  <div className="text-[11px] mb-1" style={{ color: 'var(--fg-secondary)' }}>{task.action}</div>
                  <div className="flex gap-4 text-[9px]" style={{ color: 'var(--fg-muted)' }}>
                    {task.skill && <span>Skill: {task.skill}</span>}
                    {task.window && <span>Window: {task.window}</span>}
                    <span>Last: {formatTime(task.lastRun)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'editor' && (
          <div className="h-full flex flex-col">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="flex-1 resize-none outline-none p-3"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--bg-secondary)', color: 'var(--fg-primary)', border: 'none' }}
            />
            <div className="flex items-center justify-between p-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <span className="text-[9px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{editContent.length} chars</span>
              <button
                onClick={async () => {
                  setSaving(true);
                  try {
                    await manageFetch(serverUrl, apiToken, '/heartbeat', { method: 'PUT', body: JSON.stringify({ content: editContent }) });
                    setRawContent(editContent);
                    loadData();
                  } catch {}
                  setSaving(false);
                }}
                disabled={saving || editContent === rawContent}
                className="px-3 py-1 text-[9px] tracking-[1px] uppercase border"
                style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)', background: 'transparent', cursor: 'pointer', opacity: saving || editContent === rawContent ? 0.3 : 1 }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {tab === 'log' && (
          <pre className="text-[11px] whitespace-pre-wrap" style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-secondary)' }}>
            {logContent || 'No heartbeat log entries yet.'}
          </pre>
        )}
      </div>
    </div>
  );
}
