import { useState, useEffect, useRef } from 'react';

interface MemoryBlockModalProps {
  name: string;
  label: string;
  content: string;
  saving: boolean;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

export default function MemoryBlockModal({ name, label, content, saving, onSave, onClose }: MemoryBlockModalProps) {
  const [editValue, setEditValue] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(content);
    // Focus textarea on open
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [content]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async () => {
    try {
      await onSave(editValue);
    } catch {
      // Error handled by hook
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-500/40 dark:bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-4 mb-6">
          <div className="text-[9px] text-violet-600 dark:text-violet-400 tracking-[2px] font-mono">
            {'// EDIT_' + label.replace('.', '_')}
          </div>
          <button
            onClick={onClose}
            className="text-2xl text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/90 transition leading-none"
          >
            &times;
          </button>
        </div>

        {/* Editor */}
        <textarea
          ref={textareaRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="w-full h-96 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 px-4 py-3 text-sm text-slate-800 dark:text-white/90 placeholder-slate-400 dark:placeholder-white/30 focus:border-violet-500/40 dark:focus:border-violet-400/40 focus:outline-none transition resize-none font-mono"
          placeholder={`Enter ${name} content...`}
        />

        {/* Footer */}
        <div className="flex items-center justify-between mt-4">
          <span className="text-[9px] text-slate-400 dark:text-white/30 font-mono">
            {editValue.length} CHARS
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] px-4 py-2 text-[9px] text-slate-600 dark:text-white/60 hover:text-slate-800 dark:hover:text-white hover:border-slate-400 dark:hover:border-white/20 transition tracking-[1px] font-mono"
            >
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={saving || editValue === content}
              className="border border-emerald-600/50 dark:border-emerald-700/50 bg-emerald-100 dark:bg-emerald-700/10 px-4 py-2 text-[9px] text-emerald-700 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-700/20 transition tracking-[1px] font-mono disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {saving ? 'SAVING...' : 'SAVE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
