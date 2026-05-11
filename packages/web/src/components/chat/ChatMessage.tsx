import { useState } from 'react';
import type { ToolCall } from '../../api/types';
import ToolCallCard from './ToolCallCard';
import MarkdownRenderer from './MarkdownRenderer';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  memoryUpdates?: string[];
}

export default function ChatMessage({ role, content, timestamp, toolCalls, memoryUpdates }: ChatMessageProps) {
  const [showTools, setShowTools] = useState(false);

  const hasTools = toolCalls && toolCalls.length > 0;
  const hasMemoryUpdates = memoryUpdates && memoryUpdates.length > 0;

  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] min-w-0 break-words px-4 py-3 ${
          role === 'user'
            ? 'bg-violet-500/10 dark:bg-violet-400/10 border border-violet-500/20 dark:border-violet-400/20'
            : 'bg-slate-100 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10'
        }`}
      >
        {/* Memory update badges */}
        {role === 'assistant' && hasMemoryUpdates && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {memoryUpdates!.map(block => (
              <span
                key={block}
                className="text-[8px] text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 dark:border-cyan-400/30 bg-cyan-500/10 dark:bg-cyan-400/10 px-1.5 py-0.5 tracking-[1px] font-mono"
              >
                UPDATED_{block.toUpperCase()}
              </span>
            ))}
          </div>
        )}

        {/* Collapsed tool summary */}
        {role === 'assistant' && hasTools && (
          <button
            onClick={() => setShowTools(!showTools)}
            className="flex items-center gap-2 mb-2 text-[9px] text-slate-500 dark:text-white/40 tracking-[1px] font-mono hover:text-violet-500 dark:hover:text-violet-400 transition-colors"
          >
            <span className={`transition-transform ${showTools ? 'rotate-90' : ''}`}>
              {'\u25B6'}
            </span>
            <span>{toolCalls!.length} tool {toolCalls!.length === 1 ? 'call' : 'calls'}</span>
            <span className="text-[8px] text-slate-400 dark:text-white/30">
              {summarizeTools(toolCalls!)}
            </span>
          </button>
        )}

        {/* Expanded tool calls */}
        {showTools && hasTools && (
          <div className="space-y-1 mb-3 pl-1">
            {toolCalls!.map((tool) => (
              <ToolCallCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        {role === 'assistant' ? (
          <MarkdownRenderer content={content} />
        ) : (
          <p
            className="text-sm text-slate-800 dark:text-white/90 leading-relaxed"
            style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
          >
            {content}
          </p>
        )}
        <p
          className="mt-2 text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] font-mono"
        >
          {new Date(timestamp).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

function summarizeTools(tools: ToolCall[]): string {
  const counts = new Map<string, number>();
  for (const t of tools) {
    counts.set(t.name, (counts.get(t.name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
}
