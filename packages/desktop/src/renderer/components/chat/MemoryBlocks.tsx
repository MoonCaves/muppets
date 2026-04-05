/**
 * Memory blocks panel — SOUL.md, USER.md, HEARTBEAT.md cards with click-to-edit.
 * Ported from web MemoryBlocks.tsx.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import MemoryBlockEditor from './MemoryBlockEditor';

interface BlockData {
  content: string;
  lastModified: string;
}

const BLOCKS = ['soul', 'user', 'heartbeat'] as const;
type BlockName = typeof BLOCKS[number];

const BLOCK_META: Record<BlockName, { label: string; description: string; color: string }> = {
  soul: { label: 'SOUL.MD', description: 'Agent personality, values, and communication style', color: '#8b5cf6' },
  user: { label: 'USER.MD', description: 'Everything the agent knows about you', color: '#22d3ee' },
  heartbeat: { label: 'HEARTBEAT.MD', description: 'Recurring tasks and their cadence', color: '#10b981' },
};

export default function MemoryBlocks() {
  const { serverUrl, apiToken } = useApp();
  const [blocks, setBlocks] = useState<Record<BlockName, BlockData>>({
    soul: { content: '', lastModified: '' },
    user: { content: '', lastModified: '' },
    heartbeat: { content: '', lastModified: '' },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<BlockName | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiToken) h['Authorization'] = `Bearer ${apiToken}`;
    return h;
  }, [apiToken]);

  const fetchBlocks = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(
      BLOCKS.map(async (name) => {
        try {
          const res = await fetch(`${serverUrl}/api/web/memory/${name}`, { headers: headers() });
          if (!res.ok) return [name, { content: '', lastModified: '' }] as const;
          const data = await res.json();
          return [name, data] as const;
        } catch {
          return [name, { content: '', lastModified: '' }] as const;
        }
      })
    );
    const newBlocks = {} as Record<BlockName, BlockData>;
    for (const [name, data] of results) newBlocks[name as BlockName] = data;
    setBlocks(newBlocks);
    setLoading(false);
  }, [serverUrl, headers]);

  useEffect(() => { fetchBlocks(); }, [fetchBlocks]);

  const saveBlock = async (name: string, content: string) => {
    setSaving(true);
    try {
      await fetch(`${serverUrl}/api/web/memory/${name}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ content }),
      });
      setBlocks(prev => ({ ...prev, [name]: { content, lastModified: new Date().toISOString() } }));
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-[9px] animate-pulse" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>LOADING_MEMORY...</div>;

  return (
    <>
      <div style={{ border: '1px solid var(--border-color)', padding: '12px', background: 'var(--bg-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '9px', letterSpacing: '2px', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>MEMORY_BLOCKS</span>
          <span style={{ fontSize: '9px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{BLOCKS.length}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {BLOCKS.map(name => {
            const block = blocks[name];
            const meta = BLOCK_META[name];
            return (
              <div
                key={name}
                onClick={() => setEditing(name)}
                style={{ border: '1px solid var(--border-color)', padding: '10px', cursor: 'pointer', background: 'var(--bg-secondary)', transition: 'border-color 150ms' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${meta.color}40`)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] tracking-[1px] px-1 py-0.5 border" style={{ fontFamily: 'var(--font-mono)', color: meta.color, borderColor: `${meta.color}40`, background: `${meta.color}10` }}>{meta.label}</span>
                  <span className="text-[9px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{block.content.length}</span>
                </div>
                <p className="text-[9px] mb-1.5" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-sans)', fontWeight: 300 }}>{meta.description}</p>
                <p className="text-[11px] line-clamp-3" style={{ color: 'var(--fg-secondary)', fontFamily: 'var(--font-sans)', fontWeight: 300 }}>
                  {block.content || <span style={{ color: 'var(--fg-muted)', fontStyle: 'italic' }}>Click to add content...</span>}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {editing && (
        <MemoryBlockEditor
          name={editing}
          label={BLOCK_META[editing].label}
          content={blocks[editing].content}
          saving={saving}
          onSave={(content) => saveBlock(editing, content)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
