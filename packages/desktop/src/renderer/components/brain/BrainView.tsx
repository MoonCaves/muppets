/**
 * Brain tab — 5 sub-tabs: Graph, Entities, Notes, Timeline, Search.
 * All memories are expandable to show full content.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { brainFetch, manageFetch } from '../../utils/api';
import MemoryCanvas from './canvas/MemoryCanvas';
import EntityBrowser from './entities/EntityBrowser';
import type { GraphResponse, GraphNodeDTO } from './canvas/types';

type BrainSubTab = 'graph' | 'entities' | 'notes' | 'timeline' | 'search';

export default function BrainView() {
  const { serverUrl, apiToken } = useApp();
  const [activeTab, setActiveTab] = useState<BrainSubTab>('graph');
  const [graphData, setGraphData] = useState<GraphResponse>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNodeDTO | null>(null);

  const loadGraph = useCallback(async () => {
    try {
      const data = await brainFetch<GraphResponse>(serverUrl, apiToken, '/graph?limit=150');
      setGraphData(data);
      setError(null);
    } catch (err) {
      const msg = (err as Error).name === 'AbortError'
        ? 'Brain API timed out — the entity graph database may be busy. Try again.'
        : (err as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [serverUrl, apiToken]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Sub-tab bar */}
      <div className="flex items-center gap-0 px-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {(['graph', 'entities', 'notes', 'timeline', 'search'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-3 py-2 relative"
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase',
              color: activeTab === tab ? 'var(--accent-violet)' : 'var(--fg-muted)',
              background: 'transparent', border: 'none', cursor: 'pointer',
            }}
          >
            {tab}
            {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-[1px]" style={{ background: 'var(--accent-violet)' }} />}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {activeTab === 'graph' && (
          <>
            <button onClick={() => (window as any).kyberbot?.brain?.popout()} className="px-2 py-1 text-[9px] tracking-[1px] uppercase" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', background: 'transparent', border: 'none', cursor: 'pointer' }}>Pop Out</button>
            <button onClick={loadGraph} className="px-2 py-1 text-[9px] tracking-[1px] uppercase" style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>Refresh</button>
          </>
        )}
        <span className="text-[9px] ml-2" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
          {graphData.nodes.length} nodes / {graphData.edges.length} edges
        </span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {error && (
          <div className="absolute top-2 left-2 right-2 p-2 text-[11px] border z-10" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--status-error)', color: 'var(--status-error)', background: 'var(--bg-primary)' }}>
            {error}
          </div>
        )}

        {activeTab === 'graph' && (
          loading ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Loading graph...</span>
            </div>
          ) : (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
              <MemoryCanvas nodes={graphData.nodes} edges={graphData.edges} onNodeSelect={setSelectedNode} />
              {selectedNode && (
                <GraphEntityDetail
                  entity={selectedNode}
                  serverUrl={serverUrl}
                  apiToken={apiToken}
                  onClose={() => setSelectedNode(null)}
                  onNavigate={(id) => {
                    const node = graphData.nodes.find(n => n.id === id);
                    if (node) setSelectedNode(node);
                  }}
                />
              )}
            </div>
          )
        )}

        {activeTab === 'entities' && <EntityBrowser />}
        {activeTab === 'notes' && <BrainNotesView serverUrl={serverUrl} apiToken={apiToken} />}
        {activeTab === 'timeline' && <TimelineView serverUrl={serverUrl} apiToken={apiToken} />}
        {activeTab === 'search' && <SearchView serverUrl={serverUrl} apiToken={apiToken} />}
      </div>
    </div>
  );
}

// ── Brain Notes ──

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  brain: { label: 'BRAIN NOTE', color: 'var(--accent-emerald)' },
  'claude-memory': { label: 'CLAUDE CODE MEMORY', color: 'var(--accent-violet)' },
  'claude-sync': { label: 'MEMORY SYNC', color: 'var(--accent-cyan)' },
  identity: { label: 'IDENTITY', color: 'var(--accent-amber)' },
};

function BrainNotesView({ serverUrl, apiToken }: { serverUrl: string; apiToken: string | null }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [selectedNote, setSelectedNote] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    manageFetch<{ notes: any[] }>(serverUrl, apiToken, '/brain-notes')
      .then(d => setNotes(d.notes))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [serverUrl, apiToken]);

  const openNote = async (path: string) => {
    try {
      const data = await manageFetch<{ name: string; content: string }>(serverUrl, apiToken, '/brain-notes/read', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      setSelectedNote(data);
    } catch {}
  };

  const filtered = filter ? notes.filter(n => n.source === filter) : notes;
  const sources = [...new Set(notes.map(n => n.source))];

  if (selectedNote) {
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--accent-emerald)' }}>{selectedNote.name}</span>
          <button onClick={() => setSelectedNote(null)} style={{ fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>Back</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          <pre style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{selectedNote.content}</pre>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto', padding: '16px' }}>
      <span className="section-title" style={{ color: 'var(--accent-emerald)' }}>{'// ALL MEMORY FILES'}</span>
      <p style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: '4px', marginBottom: '12px' }}>
        {notes.length} files across brain notes, Claude Code memory, identity files, and memory sync
      </p>

      {/* Source filter buttons */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <button onClick={() => setFilter(null)} style={{ padding: '2px 8px', fontSize: '8px', letterSpacing: '0.5px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', border: `1px solid ${!filter ? 'var(--accent-emerald)' : 'var(--border-color)'}`, color: !filter ? 'var(--accent-emerald)' : 'var(--fg-muted)', background: !filter ? 'rgba(16,185,129,0.1)' : 'transparent', cursor: 'pointer' }}>All ({notes.length})</button>
        {sources.map(src => {
          const meta = SOURCE_LABELS[src] || { label: src, color: 'var(--fg-muted)' };
          const count = notes.filter(n => n.source === src).length;
          return (
            <button key={src} onClick={() => setFilter(filter === src ? null : src)} style={{ padding: '2px 8px', fontSize: '8px', letterSpacing: '0.5px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', border: `1px solid ${filter === src ? meta.color : 'var(--border-color)'}`, color: filter === src ? meta.color : 'var(--fg-muted)', background: filter === src ? `${meta.color}15` : 'transparent', cursor: 'pointer' }}>{meta.label} ({count})</button>
          );
        })}
      </div>

      {loading && <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Loading...</span>}
      {filtered.length === 0 && !loading && <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>No files in this category</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {filtered.map(note => {
          const meta = SOURCE_LABELS[note.source] || { label: note.source, color: 'var(--fg-muted)' };
          return (
            <div key={note.path} onClick={() => openNote(note.path)} style={{ padding: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '8px', padding: '1px 4px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: meta.color, background: `${meta.color}15`, border: `1px solid ${meta.color}30` }}>{meta.label}</span>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', flex: 1 }}>{note.name}</span>
                <span style={{ fontSize: '9px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{(note.size / 1024).toFixed(1)}KB</span>
              </div>
              <span style={{ fontSize: '9px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                {new Date(note.lastModified).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Timeline (expandable) ──

function TimelineView({ serverUrl, apiToken }: { serverUrl: string; apiToken: string | null }) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    brainFetch<{ events: any[] }>(serverUrl, apiToken, '/timeline?limit=100')
      .then(data => setEvents(data.events))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [serverUrl, apiToken]);

  const toggle = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto', padding: '16px' }}>
      <span className="section-title" style={{ color: 'var(--accent-emerald)' }}>{'// TIMELINE'}</span>
      <p style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: '4px', marginBottom: '16px' }}>
        Temporal events — click to expand full content
      </p>
      {loading && <span style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>Loading...</span>}
      {events.map((ev, i) => {
        const isExpanded = expanded.has(i);
        const content = ev.summary || ev.content || JSON.stringify(ev);
        return (
          <div key={i} onClick={() => toggle(i)} style={{ padding: '8px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '9px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{new Date(ev.timestamp || ev.created_at).toLocaleString()}</span>
              {ev.event_type && <span style={{ fontSize: '9px', padding: '1px 4px', textTransform: 'uppercase', color: 'var(--accent-emerald)', background: 'rgba(16,185,129,0.1)', fontFamily: 'var(--font-mono)' }}>{ev.event_type}</span>}
              {ev.channel && <span style={{ fontSize: '9px', padding: '1px 4px', textTransform: 'uppercase', color: 'var(--accent-cyan)', background: 'rgba(34,211,238,0.1)', fontFamily: 'var(--font-mono)' }}>{ev.channel}</span>}
              <span style={{ fontSize: '8px', color: 'var(--fg-muted)', marginLeft: 'auto' }}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--fg-secondary)', whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap', overflow: isExpanded ? 'visible' : 'hidden', textOverflow: isExpanded ? 'unset' : 'ellipsis', wordBreak: isExpanded ? 'break-word' : 'normal' }}>
              {isExpanded ? content : content.slice(0, 200)}
            </div>
          </div>
        );
      })}
      {!loading && events.length === 0 && <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>No timeline events</span>}
    </div>
  );
}

// ── Search (expandable results) ──

function SearchView({ serverUrl, apiToken }: { serverUrl: string; apiToken: string | null }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setExpanded(new Set());
    try {
      const data = await brainFetch<{ results: any[] }>(serverUrl, apiToken, '/search', {
        method: 'POST',
        body: JSON.stringify({ query, limit: 50 }),
      });
      setResults(data.results);
    } catch {}
    setLoading(false);
  };

  const toggle = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '8px' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Search all memories (semantic + keyword)..."
          style={{ flex: 1, padding: '6px 8px', fontSize: '11px', fontFamily: 'var(--font-mono)', background: 'var(--bg-secondary)', color: 'var(--fg-primary)', border: '1px solid var(--border-color)', outline: 'none' }}
        />
        <button onClick={search} style={{ padding: '4px 12px', fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', border: '1px solid var(--accent-emerald)', color: 'var(--accent-emerald)', background: 'transparent', cursor: 'pointer' }}>Search</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {loading && <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Searching...</span>}
        {results.map((r, i) => {
          const isExpanded = expanded.has(i);
          const content = r.content || '';
          const title = r.title || content.slice(0, 80) || 'Untitled';
          return (
            <div key={i} onClick={() => toggle(i)} style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                {r.type && <span style={{ fontSize: '8px', padding: '1px 4px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: r.type === 'conversation' ? 'var(--accent-cyan)' : r.type === 'note' ? 'var(--accent-emerald)' : 'var(--accent-violet)', background: r.type === 'conversation' ? 'rgba(34,211,238,0.1)' : r.type === 'note' ? 'rgba(16,185,129,0.1)' : 'rgba(139,92,246,0.1)' }}>{r.type}</span>}
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                {r.score != null && <span style={{ fontSize: '8px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{(r.score * 100).toFixed(0)}%</span>}
                <span style={{ fontSize: '8px', color: 'var(--fg-muted)' }}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
              </div>
              {r.entities && r.entities.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  {r.entities.slice(0, 5).map((e: string, j: number) => (
                    <span key={j} style={{ fontSize: '8px', padding: '1px 4px', color: 'var(--accent-amber)', background: 'rgba(245,158,11,0.1)', fontFamily: 'var(--font-mono)' }}>{e}</span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: '11px', color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap', overflow: isExpanded ? 'visible' : 'hidden', textOverflow: isExpanded ? 'unset' : 'ellipsis', wordBreak: isExpanded ? 'break-word' : 'normal' }}>
                {isExpanded ? content : content.slice(0, 200)}
              </div>
              {isExpanded && r.created_at && (
                <div style={{ fontSize: '8px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: '8px' }}>
                  Stored: {new Date(r.created_at).toLocaleString()}
                  {r.tier && ` | Tier: ${r.tier}`}
                  {r.priority != null && ` | Priority: ${(r.priority * 100).toFixed(0)}%`}
                </div>
              )}
            </div>
          );
        })}
        {!loading && results.length === 0 && query && <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>No results found</span>}
        {!query && <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Enter a query to search across all memories — conversations, notes, entity facts, and brain documents</span>}
      </div>
    </div>
  );
}

// ── Graph Entity Detail Sidebar ──

const TYPE_COLORS_DETAIL: Record<string, string> = {
  person: '#10b981', company: '#22d3ee', project: '#14b8a6', place: '#a855f7', topic: '#f59e0b',
};

function GraphEntityDetail({ entity, serverUrl, apiToken, onClose, onNavigate }: {
  entity: GraphNodeDTO;
  serverUrl: string;
  apiToken: string | null;
  onClose: () => void;
  onNavigate: (id: number) => void;
}) {
  const [context, setContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    brainFetch<any>(serverUrl, apiToken, `/entities/${entity.id}`)
      .then(d => setContext(d))
      .catch(() => setContext(null))
      .finally(() => setLoading(false));
  }, [entity.id, serverUrl, apiToken]);

  const typeColor = TYPE_COLORS_DETAIL[entity.type] || '#71717a';

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '340px', borderLeft: '1px solid var(--border-color)', overflowY: 'auto', background: 'var(--bg-primary)', zIndex: 10 }}>
      <div style={{ padding: '16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span className="section-title" style={{ color: 'var(--accent-violet)' }}>{'// ENTITY'}</span>
          <button onClick={onClose} style={{ fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>Close</button>
        </div>

        {/* Name + Type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{entity.name}</div>
          <span style={{ fontSize: '8px', padding: '1px 6px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: typeColor, background: `${typeColor}15`, border: `1px solid ${typeColor}40` }}>{entity.type}</span>
        </div>
        {entity.tier && <span style={{ fontSize: '8px', padding: '1px 6px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: 'var(--status-warning)', background: 'rgba(245,158,11,0.1)' }}>{entity.tier}</span>}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px', marginBottom: '16px' }}>
          {[['MENTIONS', entity.mention_count], ['PRIORITY', `${(entity.priority * 100).toFixed(0)}%`], ['FIRST SEEN', context?.entity?.first_seen ? new Date(context.entity.first_seen).toLocaleDateString() : '—'], ['LAST SEEN', new Date(entity.last_seen).toLocaleDateString()]].map(([label, value]) => (
            <div key={label as string}>
              <div style={{ fontSize: '7px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginBottom: '2px' }}>{label}</div>
              <div style={{ fontSize: '13px', fontWeight: 'bold', fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Confidence bar */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '7px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>CONFIDENCE</div>
          <div style={{ height: '4px', width: '100%', background: 'var(--bg-tertiary)' }}>
            <div style={{ height: '100%', width: `${entity.priority * 100}%`, background: entity.priority >= 0.7 ? '#10b981' : entity.priority >= 0.4 ? '#f59e0b' : '#ef4444' }} />
          </div>
        </div>

        {loading && <div style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Loading details...</div>}

        {context && (
          <>
            {/* Contradictions */}
            {context.contradictions && context.contradictions.length > 0 && (
              <div style={{ marginBottom: '16px', padding: '8px', border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.05)' }}>
                <div style={{ fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: '#f59e0b', fontFamily: 'var(--font-mono)', marginBottom: '8px' }}>{`// CONTRADICTIONS (${context.contradictions.length})`}</div>
                {context.contradictions.map((c: any, i: number) => (
                  <div key={i} style={{ fontSize: '11px', color: 'var(--fg-secondary)', marginBottom: '4px' }}>{c.description || c.fact_a || JSON.stringify(c).slice(0, 150)}</div>
                ))}
              </div>
            )}

            {/* Facts */}
            {context.facts && context.facts.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)', marginBottom: '8px' }}>{`// FACTS (${context.facts.length})`}</div>
                {context.facts.map((f: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', paddingBottom: '6px', marginBottom: '6px', borderBottom: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '7px', padding: '1px 4px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', color: f.source_type === 'corrected' ? '#10b981' : f.source_type === 'confirmed' ? '#22d3ee' : 'var(--fg-muted)', background: f.source_type === 'corrected' ? 'rgba(16,185,129,0.1)' : f.source_type === 'confirmed' ? 'rgba(34,211,238,0.1)' : 'var(--bg-tertiary)', flexShrink: 0, marginTop: '2px' }}>{(f.source_type || 'fact').slice(0, 5)}</span>
                    <span style={{ fontSize: '11px', color: 'var(--fg-secondary)' }}>{f.content || f.fact || JSON.stringify(f).slice(0, 200)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Relationships */}
            {context.related_entities && context.related_entities.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', marginBottom: '8px' }}>{`// RELATIONSHIPS (${context.related_entities.length})`}</div>
                {context.related_entities.map((rel: any, i: number) => {
                  const relEntity = rel.entity || rel;
                  const relName = relEntity.name || 'Unknown';
                  const relType = relEntity.type || 'default';
                  const relColor = TYPE_COLORS_DETAIL[relType] || '#71717a';
                  return (
                    <div key={i} onClick={() => relEntity.id && onNavigate(relEntity.id)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', cursor: 'pointer' }}>
                      <span style={{ fontSize: '8px', padding: '1px 4px', fontFamily: 'var(--font-mono)', color: 'var(--accent-violet)', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)' }}>{rel.relationship || 'related'}</span>
                      <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: relColor }}>{relName}</span>
                      <span style={{ fontSize: '8px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>({relType})</span>
                      {rel.strength && <span style={{ fontSize: '8px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>×{rel.strength}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mentions */}
            {context.mentions && context.mentions.length > 0 && (
              <div>
                <div style={{ fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: '#14b8a6', fontFamily: 'var(--font-mono)', marginBottom: '8px' }}>{`// MENTIONS (${context.mentions.length})`}</div>
                {context.mentions.slice(0, 15).map((m: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', paddingBottom: '6px' }}>
                    <div style={{ width: '4px', height: '4px', borderRadius: '9999px', background: 'var(--accent-emerald)', marginTop: '5px', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '8px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{new Date(m.timestamp || m.created_at).toLocaleString()}</div>
                      <div style={{ fontSize: '10px', color: 'var(--fg-secondary)' }}>{(m.context || m.content || '').slice(0, 200)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
