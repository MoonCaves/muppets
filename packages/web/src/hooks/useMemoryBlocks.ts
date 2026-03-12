import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPut } from '../api/client';

interface MemoryBlockData {
  content: string;
  lastModified: string;
}

const BLOCKS = ['soul', 'user', 'heartbeat'] as const;
type BlockName = typeof BLOCKS[number];

const BLOCK_META: Record<BlockName, { label: string; description: string; filename: string; color: string }> = {
  soul: { label: 'SOUL.MD', description: 'Agent personality, values, and communication style', filename: 'SOUL.md', color: 'violet' },
  user: { label: 'USER.MD', description: 'Everything the agent knows about you', filename: 'USER.md', color: 'cyan' },
  heartbeat: { label: 'HEARTBEAT.MD', description: 'Recurring tasks and their cadence', filename: 'HEARTBEAT.md', color: 'emerald' },
};

export function useMemoryBlocks() {
  const [blocks, setBlocks] = useState<Record<BlockName, MemoryBlockData>>({
    soul: { content: '', lastModified: '' },
    user: { content: '', lastModified: '' },
    heartbeat: { content: '', lastModified: '' },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBlocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        BLOCKS.map(async (name) => {
          try {
            const data = await apiGet<MemoryBlockData>(`/memory/${name}`);
            return [name, data] as const;
          } catch {
            return [name, { content: '', lastModified: '' }] as const;
          }
        })
      );
      const newBlocks = {} as Record<BlockName, MemoryBlockData>;
      for (const [name, data] of results) {
        newBlocks[name] = data;
      }
      setBlocks(newBlocks);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  const saveBlock = useCallback(async (name: string, content: string) => {
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/memory/${name}`, { content });
      setBlocks(prev => ({
        ...prev,
        [name]: { content, lastModified: new Date().toISOString() },
      }));
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  return { blocks, loading, saving, error, saveBlock, refresh: fetchBlocks, BLOCK_META, BLOCKS };
}
