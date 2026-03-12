import { useState, useRef, useEffect } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  agentName: string;
}

export default function ChatInput({ onSend, disabled, agentName }: ChatInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const handleSend = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  };

  return (
    <div className="border-t border-slate-200 dark:border-white/10 p-4">
      <div className="flex gap-3">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={`Message ${agentName}...`}
          className="flex-1 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 px-4 py-3 text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-white/30 focus:border-violet-500/40 dark:focus:border-violet-400/40 focus:outline-none transition"
          style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
          disabled={disabled}
        />
        <button
          onClick={handleSend}
          disabled={!value.trim() || disabled}
          className="border border-violet-500/40 dark:border-violet-400/40 bg-violet-500/10 dark:bg-violet-400/10 px-6 py-3 text-[10px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 dark:hover:bg-violet-400/20 transition tracking-[1px] disabled:opacity-30 disabled:cursor-not-allowed font-mono"
        >
          SEND
        </button>
      </div>
    </div>
  );
}
