import { useState } from 'react';
import MemoryBlockModal from './MemoryBlockModal';

interface BlockMeta {
  label: string;
  description: string;
  filename: string;
  color: string;
}

const COLOR_CLASSES: Record<string, { label: string; card: string }> = {
  violet: {
    label: 'text-violet-600 dark:text-violet-400 border-violet-500/30 dark:border-violet-400/30 bg-violet-500/10 dark:bg-violet-400/10',
    card: 'hover:border-violet-400/40 dark:hover:border-violet-400/30',
  },
  cyan: {
    label: 'text-cyan-600 dark:text-cyan-400 border-cyan-500/30 dark:border-cyan-400/30 bg-cyan-500/10 dark:bg-cyan-400/10',
    card: 'hover:border-cyan-400/40 dark:hover:border-cyan-400/30',
  },
  emerald: {
    label: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 dark:border-emerald-400/30 bg-emerald-500/10 dark:bg-emerald-400/10',
    card: 'hover:border-emerald-400/40 dark:hover:border-emerald-400/30',
  },
};

interface MemoryBlocksProps {
  blocks: Record<string, { content: string; lastModified: string }>;
  loading: boolean;
  saving: boolean;
  onSave: (name: string, content: string) => Promise<void>;
  blockMeta: Record<string, BlockMeta>;
  blockNames: readonly string[];
}

export default function MemoryBlocks({ blocks, loading, saving, onSave, blockMeta, blockNames }: MemoryBlocksProps) {
  const [editingBlock, setEditingBlock] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-4">
        <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono animate-pulse">
          LOADING_MEMORY...
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono">
            MEMORY_BLOCKS
          </div>
          <span className="text-[9px] text-slate-400 dark:text-white/30 font-mono">
            {blockNames.length}
          </span>
        </div>
        <div className="space-y-3">
          {blockNames.map((name) => {
            const block = blocks[name];
            const meta = blockMeta[name];
            if (!meta) return null;
            const colors = COLOR_CLASSES[meta.color] || COLOR_CLASSES.violet;
            return (
              <div
                key={name}
                onClick={() => setEditingBlock(name)}
                className={`border border-slate-200 dark:border-white/5 p-3 cursor-pointer ${colors.card} hover:bg-slate-50 dark:hover:bg-white/[0.02] transition`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[9px] border px-1.5 py-0.5 tracking-[1px] font-mono ${colors.label}`}>
                    {meta.label}
                  </span>
                  <span className="text-[9px] text-slate-400 dark:text-white/30 font-mono">
                    {block?.content.length || 0}
                  </span>
                </div>
                <p
                  className="text-[9px] text-slate-500 dark:text-white/40 mb-2"
                  style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
                >
                  {meta.description}
                </p>
                <p
                  className="text-xs text-slate-600 dark:text-white/60 line-clamp-3"
                  style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
                >
                  {block?.content || (
                    <span className="italic text-slate-400 dark:text-white/30">Click to add content...</span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {editingBlock && (
        <MemoryBlockModal
          name={editingBlock}
          label={blockMeta[editingBlock]?.label || editingBlock.toUpperCase()}
          content={blocks[editingBlock]?.content || ''}
          saving={saving}
          onSave={async (content) => {
            await onSave(editingBlock, content);
            setEditingBlock(null);
          }}
          onClose={() => setEditingBlock(null)}
        />
      )}
    </>
  );
}
