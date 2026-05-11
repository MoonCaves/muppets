import { useTheme } from '../../hooks/useTheme';

interface HeaderProps {
  agentName: string;
  showSettings: boolean;
  onToggleSettings: () => void;
}

export function getAgentEmoji(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('rizzo')) return '🐀';
  if (lower.includes('kermit')) return '🐸';
  return '🤖';
}

// Per-agent accent classes — keep in sync with the muppets directory cards.
// Static, fully-qualified Tailwind classes so the JIT scanner picks them up.
function getAgentAccent(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('kermit')) return 'text-emerald-600 dark:text-emerald-400';
  if (lower.includes('rizzo')) return 'text-violet-600 dark:text-violet-400';
  return 'text-violet-600 dark:text-violet-400';
}

function getSwitchUrl(agentName: string): { label: string; emoji: string; url: string } | null {
  const lower = agentName.toLowerCase();
  const protocol = window.location.protocol;
  const host = window.location.host;

  if (lower.includes('rizzo')) {
    const kermitHost = host.replace(/^rizzo\./, 'kermit.').replace(/^muppets\./, 'kermit.');
    return {
      label: 'KERMIT',
      emoji: '🐸',
      url: `${protocol}//${kermitHost.includes('kermit') ? kermitHost : 'kermit.remotelyhuman.com'}/ui`,
    };
  }
  if (lower.includes('kermit')) {
    const rizzoHost = host.replace(/^kermit\./, 'rizzo.');
    return {
      label: 'RIZZO',
      emoji: '🐀',
      url: `${protocol}//${rizzoHost.includes('rizzo') ? rizzoHost : 'rizzo.remotelyhuman.com'}/ui`,
    };
  }
  return null;
}

export default function Header({ agentName, showSettings, onToggleSettings }: HeaderProps) {
  const { isDark, toggle } = useTheme();
  const switchTarget = getSwitchUrl(agentName);
  const emoji = getAgentEmoji(agentName);
  const accent = getAgentAccent(agentName);

  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'https:';
  const muppetsUrl = `${protocol}//muppets.remotelyhuman.com`;

  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        {switchTarget ? (
          <a
            href={switchTarget.url}
            className="text-base leading-none no-underline hover:opacity-70 transition cursor-pointer"
            title={`Switch to ${switchTarget.label}`}
          >
            {emoji}
          </a>
        ) : (
          <span className="text-base leading-none">{emoji}</span>
        )}
        <a
          href={muppetsUrl}
          className="text-[9px] text-slate-500 dark:text-white/40 tracking-[1px] font-mono no-underline hover:text-violet-600 dark:hover:text-violet-400 transition cursor-pointer"
          title="Muppets dashboard"
        >
          MUPPETS
        </a>
        <div className="w-px h-4 bg-slate-300 dark:bg-white/10" />
        <div className={`text-[9px] tracking-[2px] font-mono ${accent}`}>
          {'// AGENT_' + agentName.toUpperCase().replace(/\s+/g, '_')}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 bg-emerald-500 dark:bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-[9px] text-emerald-600/80 dark:text-emerald-400/80 tracking-[1px] font-mono">
            ONLINE
          </span>
        </div>
        <button
          onClick={toggle}
          className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] px-3 py-1.5 text-[9px] text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/60 hover:border-slate-400 dark:hover:border-white/20 transition tracking-[1px] font-mono"
        >
          {isDark ? 'LIGHT' : 'DARK'}
        </button>
        <button
          onClick={onToggleSettings}
          className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] px-3 py-1.5 text-[9px] text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/60 hover:border-slate-400 dark:hover:border-white/20 transition tracking-[1px] font-mono"
        >
          {showSettings ? 'HIDE_SETTINGS' : 'SHOW_SETTINGS'}
        </button>
      </div>
    </div>
  );
}
