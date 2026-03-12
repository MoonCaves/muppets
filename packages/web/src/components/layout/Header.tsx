import { useTheme } from '../../hooks/useTheme';

interface HeaderProps {
  agentName: string;
  showSettings: boolean;
  onToggleSettings: () => void;
}

export default function Header({ agentName, showSettings, onToggleSettings }: HeaderProps) {
  const { isDark, toggle } = useTheme();

  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="text-[9px] text-slate-500 dark:text-white/40 tracking-[1px] font-mono">
          KYBERBOT
        </span>
        <div className="w-px h-4 bg-slate-300 dark:bg-white/10" />
        <div className="text-[9px] text-violet-600 dark:text-violet-400 tracking-[2px] font-mono">
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
