import type { ToolCall } from '../../api/types';

// Tool name → icon mapping (simple text icons)
const TOOL_ICONS: Record<string, string> = {
  Read: '\u25B7',      // ▷
  Write: '\u25C1',     // ◁
  Edit: '\u2710',      // ✐
  Glob: '\u2315',      // ⌕
  Grep: '\u2315',      // ⌕
  Bash: '\u276F',      // ❯
  WebFetch: '\u21E3',  // ⇣
  WebSearch: '\u2317',  // ⌗
  Agent: '\u2B22',     // ⬢
  Skill: '\u2726',     // ✦
};

// Tool name → accent color
const TOOL_COLORS: Record<string, string> = {
  Read: 'text-cyan-500 dark:text-cyan-400',
  Write: 'text-emerald-500 dark:text-emerald-400',
  Edit: 'text-emerald-500 dark:text-emerald-400',
  Bash: 'text-amber-500 dark:text-amber-400',
  Glob: 'text-violet-500 dark:text-violet-400',
  Grep: 'text-violet-500 dark:text-violet-400',
  WebFetch: 'text-blue-500 dark:text-blue-400',
  WebSearch: 'text-blue-500 dark:text-blue-400',
  Agent: 'text-pink-500 dark:text-pink-400',
  Skill: 'text-pink-500 dark:text-pink-400',
};

interface ToolCallCardProps {
  tool: ToolCall;
  compact?: boolean;
}

export default function ToolCallCard({ tool, compact }: ToolCallCardProps) {
  const icon = TOOL_ICONS[tool.name] || '\u2022';
  const color = TOOL_COLORS[tool.name] || 'text-slate-500 dark:text-white/40';

  const isMemoryOp = tool.detail.includes('SOUL') || tool.detail.includes('USER') ||
    tool.detail.includes('HEARTBEAT') || tool.detail.includes('memory');
  const isEntityGraph = tool.detail.includes('entity') || tool.detail.includes('graph') ||
    tool.detail.includes('chroma');

  // Highlight memory operations
  const detailColor = isMemoryOp
    ? 'text-emerald-600 dark:text-emerald-400'
    : isEntityGraph
      ? 'text-cyan-600 dark:text-cyan-400'
      : 'text-slate-600 dark:text-white/60';

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-[9px] tracking-[1px] font-mono ${color}`}>
        <span>{icon}</span>
        <span>{tool.label}</span>
        {tool.status === 'running' && <span className="animate-pulse">...</span>}
        {tool.status === 'error' && <span className="text-red-400">FAIL</span>}
      </span>
    );
  }

  return (
    <div className={`flex items-start gap-2 py-1.5 px-2 border-l-2 ${
      tool.status === 'running'
        ? 'border-violet-400/40 bg-violet-500/[0.03]'
        : tool.status === 'error'
          ? 'border-red-400/40 bg-red-500/[0.03]'
          : 'border-slate-300 dark:border-white/10 bg-transparent'
    }`}>
      <span className={`text-xs mt-0.5 ${color} ${tool.status === 'running' ? 'animate-pulse' : ''}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] tracking-[1px] font-mono ${color}`}>
            {tool.label.toUpperCase()}
          </span>
          {tool.status === 'running' && (
            <span className="text-[8px] text-violet-500 dark:text-violet-400 tracking-[1px] font-mono animate-pulse">
              RUNNING
            </span>
          )}
          {tool.status === 'done' && (
            <span className="text-[8px] text-emerald-500 dark:text-emerald-400 tracking-[1px] font-mono">
              DONE
            </span>
          )}
          {tool.status === 'error' && (
            <span className="text-[8px] text-red-500 dark:text-red-400 tracking-[1px] font-mono">
              ERROR
            </span>
          )}
        </div>
        {tool.detail && (
          <p className={`text-[11px] font-mono truncate ${detailColor}`}>
            {tool.detail}
          </p>
        )}
      </div>
    </div>
  );
}
