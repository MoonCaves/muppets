import { useEffect, useRef, useState } from 'react';

// ---------- Types ----------

interface Goal {
  id: number;
  title: string;
  description: string | null;
  level: 'company' | 'team' | 'agent' | string;
  owner_agent: string | null;
  parent_goal_id: number | null;
  status: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

interface Issue {
  id: number;
  title: string;
  description: string | null;
  goal_id: number | null;
  parent_id: number | null;
  assigned_to: string | null;
  created_by: string | null;
  status: 'todo' | 'in_progress' | 'done' | string;
  priority: 'critical' | 'high' | 'medium' | 'low' | string | null;
  labels: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

interface InboxItem {
  id: number;
  source_agent: string | null;
  title: string;
  body?: string | null;
  kind: 'completed' | 'blocker' | 'question' | string;
  status: string;
  created_at: string;
}

interface ActivityEntry {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string | null;
  created_at: string;
}

interface DashboardPayload {
  goals?: { items?: Goal[]; total?: number; active?: number; completed?: number };
  issues?: { recent?: Issue[]; total?: number; counts?: Record<string, number> };
  inbox?: { items?: InboxItem[]; pending?: number };
  activity?: ActivityEntry[];
  org?: Array<{ agent_name: string; title: string }>;
}

// ---------- Helpers ----------

function buildOrchUrl(): string {
  // Same-origin works for muppets.* — orch endpoints are mounted at /fleet/orch/*.
  if (typeof window === 'undefined') return 'https://muppets.remotelyhuman.com/fleet/orch';
  if (window.location.host.startsWith('muppets.')) {
    return `${window.location.protocol}//${window.location.host}/fleet/orch`;
  }
  return 'https://muppets.remotelyhuman.com/fleet/orch';
}

function agentEmoji(slug: string | null): string {
  if (!slug) return '·';
  const lower = slug.toLowerCase();
  if (lower.includes('kermit')) return '🐸';
  if (lower.includes('rizzo')) return '🐀';
  if (lower === 'human') return '👤';
  return '🤖';
}

function priorityDot(p: Issue['priority']): { color: string; label: string } {
  switch (p) {
    case 'critical':
    case 'high':
      return {
        color: 'bg-red-500 dark:bg-red-400',
        label: (p ?? '').toString().toUpperCase(),
      };
    case 'medium':
      return { color: 'bg-amber-500 dark:bg-amber-400', label: 'MEDIUM' };
    case 'low':
      return { color: 'bg-slate-400 dark:bg-slate-500', label: 'LOW' };
    default:
      return { color: 'bg-slate-300 dark:bg-slate-600', label: '—' };
  }
}

function ageString(iso: string): string {
  const t = Date.parse(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// ---------- Sub-panels ----------

function CampaignPanel({ goals }: { goals: Goal[] }) {
  return (
    <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[9px] text-violet-600 dark:text-violet-400 tracking-[2px] font-mono">
          {'// CAMPAIGN'}
        </div>
        <div className="text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] font-mono">
          {goals.length} ACTIVE
        </div>
      </div>
      {goals.length === 0 ? (
        <div className="text-[10px] text-slate-400 dark:text-white/30 font-mono">
          {'// no active goals'}
        </div>
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => (
            <li
              key={g.id}
              className="flex items-start gap-3 border border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] px-3 py-2"
            >
              <span className="text-sm leading-none mt-0.5">{agentEmoji(g.owner_agent)}</span>
              <div className="flex-1 min-w-0">
                <div
                  className="text-[13px] text-slate-800 dark:text-white/90 leading-snug"
                  style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
                >
                  {g.title}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[9px] tracking-[1px] font-mono text-slate-400 dark:text-white/30 uppercase">
                    {g.level}
                  </span>
                  <span className="text-[9px] text-slate-300 dark:text-white/20">·</span>
                  <span
                    className={`text-[9px] tracking-[1px] font-mono uppercase ${
                      g.status === 'active'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-400 dark:text-white/30'
                    }`}
                  >
                    {g.status}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KanbanPanel({ issues }: { issues: Issue[] }) {
  const cols: Array<{ key: Issue['status']; label: string }> = [
    { key: 'todo', label: 'TODO' },
    { key: 'in_progress', label: 'IN PROGRESS' },
    { key: 'done', label: 'DONE' },
  ];

  const grouped: Record<string, Issue[]> = { todo: [], in_progress: [], done: [] };
  for (const i of issues) {
    if (i.status in grouped) grouped[i.status].push(i);
  }

  return (
    <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[9px] text-violet-600 dark:text-violet-400 tracking-[2px] font-mono">
          {'// KANBAN'}
        </div>
        <div className="text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] font-mono">
          {issues.length} ISSUES
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {cols.map((c) => (
          <div key={c.key} className="min-w-0">
            <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono mb-2 flex items-center justify-between">
              <span>{c.label}</span>
              <span className="text-slate-400 dark:text-white/30">{grouped[c.key].length}</span>
            </div>
            <ul className="space-y-2">
              {grouped[c.key].length === 0 ? (
                <li className="text-[10px] text-slate-400 dark:text-white/30 font-mono italic">
                  —
                </li>
              ) : (
                grouped[c.key].map((i) => {
                  const dot = priorityDot(i.priority);
                  return (
                    <li
                      key={i.id}
                      className="border border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] px-3 py-2"
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot.color}`}
                          title={dot.label}
                        />
                        <div className="flex-1 min-w-0">
                          <div
                            className="text-[12px] text-slate-800 dark:text-white/90 leading-snug"
                            style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
                          >
                            {i.title}
                          </div>
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <span className="text-xs leading-none">
                              {agentEmoji(i.assigned_to)}
                            </span>
                            {i.goal_id != null && (
                              <span className="text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] font-mono">
                                G{i.goal_id}
                              </span>
                            )}
                            <span className="text-[9px] text-slate-300 dark:text-white/20 tracking-[1px] font-mono">
                              #{i.id}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function InboxPanel({ items }: { items: InboxItem[] }) {
  return (
    <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[9px] text-violet-600 dark:text-violet-400 tracking-[2px] font-mono">
          {'// INBOX'}
        </div>
        <div className="text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] font-mono">
          {items.length} PENDING
        </div>
      </div>
      {items.length === 0 ? (
        <div className="text-[10px] text-slate-400 dark:text-white/30 font-mono">
          {'// inbox clear'}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-start gap-3 border border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] px-3 py-2"
            >
              <span className="text-sm leading-none mt-0.5">{agentEmoji(it.source_agent)}</span>
              <div className="flex-1 min-w-0">
                <div
                  className="text-[12px] text-slate-800 dark:text-white/90 leading-snug truncate"
                  style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
                  title={it.title}
                >
                  {it.title}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[9px] tracking-[1px] font-mono uppercase text-violet-600 dark:text-violet-400">
                    {it.kind}
                  </span>
                  <span className="text-[9px] text-slate-300 dark:text-white/20">·</span>
                  <span className="text-[9px] tracking-[1px] font-mono text-slate-400 dark:text-white/30">
                    {ageString(it.created_at)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Main ----------

export default function OrchPanels() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const url = `${buildOrchUrl()}/dashboard`;

    const fetchOnce = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DashboardPayload;
        if (!aliveRef.current) return;
        setData(json);
        setError(null);
        setLastOk(Date.now());
      } catch (e) {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : 'fetch failed');
      }
    };

    fetchOnce();
    const id = setInterval(fetchOnce, 30_000);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, []);

  const goals = data?.goals?.items ?? [];
  const issues = data?.issues?.recent ?? [];
  const inbox = data?.inbox?.items ?? [];

  // Live indicator: green if last successful fetch < 75s ago, red otherwise.
  const fresh = lastOk != null && Date.now() - lastOk < 75_000 && !error;

  return (
    <div className="mt-12">
      <div className="mb-4 flex items-center gap-3">
        <div className="text-[9px] text-violet-600 dark:text-violet-400 tracking-[2px] font-mono">
          {'// ORCHESTRATION'}
        </div>
        <div className="flex items-center gap-1">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              fresh
                ? 'bg-emerald-500 dark:bg-emerald-400 animate-pulse'
                : 'bg-red-500 dark:bg-red-400'
            }`}
            title={
              error
                ? `error: ${error}`
                : lastOk
                ? `last ok ${ageString(new Date(lastOk).toISOString())} ago`
                : 'connecting…'
            }
          />
          <span
            className={`text-[9px] tracking-[1px] font-mono ${
              fresh
                ? 'text-emerald-600/80 dark:text-emerald-400/80'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {fresh ? 'LIVE' : error ? 'OFFLINE' : 'CONNECTING'}
          </span>
        </div>
      </div>

      {data == null && error == null ? (
        <div className="border border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] p-5 text-[10px] text-slate-400 dark:text-white/30 font-mono">
          {'// loading orchestration state…'}
        </div>
      ) : data == null ? (
        <div className="border border-red-300 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/[0.05] p-5 text-[10px] text-red-600 dark:text-red-400 font-mono">
          {'// failed to load orchestration: ' + (error ?? 'unknown')}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="lg:col-span-2">
            <KanbanPanel issues={issues} />
          </div>
          <CampaignPanel goals={goals} />
          <InboxPanel items={inbox} />
        </div>
      )}
    </div>
  );
}
