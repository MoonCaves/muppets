/**
 * Memory block editor modal — edit SOUL.md, USER.md, HEARTBEAT.md.
 * Ported from web MemoryBlockModal.tsx.
 */

import { useState, useEffect, useRef } from 'react';

interface MemoryBlockEditorProps {
  name: string;
  label: string;
  content: string;
  saving: boolean;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

export default function MemoryBlockEditor({ name, label, content, saving, onSave, onClose }: MemoryBlockEditorProps) {
  const [editValue, setEditValue] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(content);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, [content]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-2xl border p-8" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between border-b pb-4 mb-6" style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-[9px] tracking-[2px]" style={{ color: 'var(--accent-violet)', fontFamily: 'var(--font-mono)' }}>
            {'// EDIT_' + label.replace('.', '_')}
          </span>
          <button onClick={onClose} className="text-2xl leading-none" style={{ color: 'var(--fg-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>&times;</button>
        </div>

        <textarea
          ref={textareaRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="w-full h-96 px-4 py-3 text-[13px] resize-none outline-none"
          style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-secondary)', color: 'var(--fg-primary)', border: '1px solid var(--border-color)' }}
          placeholder={`Enter ${name} content...`}
        />

        <div className="flex items-center justify-between mt-4">
          <span className="text-[9px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{editValue.length} CHARS</span>
          <div className="flex gap-3">
            <button onClick={onClose} className="border px-4 py-2 text-[9px] tracking-[1px] uppercase" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--border-color)', color: 'var(--fg-secondary)', background: 'transparent', cursor: 'pointer' }}>Cancel</button>
            <button
              onClick={async () => { try { await onSave(editValue); } catch {} }}
              disabled={saving || editValue === content}
              className="border px-4 py-2 text-[9px] tracking-[1px] uppercase"
              style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)', background: 'rgba(16,185,129,0.05)', cursor: saving || editValue === content ? 'default' : 'pointer', opacity: saving || editValue === content ? 0.3 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
