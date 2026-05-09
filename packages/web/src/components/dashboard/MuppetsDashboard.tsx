import { useEffect, useState } from 'react';
import { useTheme } from '../../hooks/useTheme';
import OrchPanels from './OrchPanels';

interface AgentCard {
  slug: 'kermit' | 'rizzo';
  emoji: string;
  name: string;
  role: string;
  description: string;
  // Static, fully-qualified Tailwind classes so the JIT scanner picks them up.
  cardHover: string;
  iconBox: string;
  enterText: string;
  roleText: string;
}

const AGENTS: AgentCard[] = [
  {
    slug: 'kermit',
    emoji: '🐸',
    name: 'KERMIT',
    role: 'Chief of Staff',
    description: 'Strategy, brotherhood, book, family, daily comms triage.',
    cardHover: 'hover:border-emerald-500/50 dark:hover:border-emerald-400/50',
    iconBox:
      'border-emerald-500/30 dark:border-emerald-400/30 bg-emerald-500/10 dark:bg-emerald-400/10',
    enterText: 'text-emerald-600 dark:text-emerald-400',
    roleText: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    slug: 'rizzo',
    emoji: '🐀',
    name: 'RIZZO',
    role: 'Sysadmin & Infrastructure',
    description: 'The Hetzner fleet, Coolify, NetBird, the connective layer.',
    cardHover: 'hover:border-violet-500/50 dark:hover:border-violet-400/50',
    iconBox:
      'border-violet-500/30 dark:border-violet-400/30 bg-violet-500/10 dark:bg-violet-400/10',
    enterText: 'text-violet-600 dark:text-violet-400',
    roleText: 'text-violet-600 dark:text-violet-400',
  },
];

function buildAgentUrl(slug: 'kermit' | 'rizzo'): string {
  // Replace muppets.* with kermit.* / rizzo.* on the same parent domain.
  const protocol = window.location.protocol;
  const host = window.location.host;
  if (host.startsWith('muppets.')) {
    return `${protocol}//${host.replace(/^muppets\./, slug + '.')}/ui`;
  }
  // Fallback for local/dev — link to canonical prod hosts.
  return `https://${slug}.remotelyhuman.com/ui`;
}

export default function MuppetsDashboard() {
  const { isDark, toggle } = useTheme();
  const [now, setNow] = useState<string>('');

  useEffect(() => {
    const update = () => {
      const d = new Date();
      setNow(d.toISOString().replace('T', ' ').slice(0, 19) + 'Z');
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-[#F0EFEA] dark:bg-[#0a0a0a] transition-colors duration-300">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header bar */}
        <div className="mb-12 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-base leading-none">🎭</span>
            <span className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono">
              MUPPETS
            </span>
            <div className="w-px h-4 bg-slate-300 dark:bg-white/10" />
            <div className="text-[9px] text-violet-600 dark:text-violet-400 tracking-[2px] font-mono">
              {'// AGENT_DIRECTORY'}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-slate-500 dark:text-white/40 tracking-[1px] font-mono">
              {now}
            </span>
            <button
              onClick={toggle}
              className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] px-3 py-1.5 text-[9px] text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/60 hover:border-slate-400 dark:hover:border-white/20 transition tracking-[1px] font-mono"
            >
              {isDark ? 'LIGHT' : 'DARK'}
            </button>
          </div>
        </div>

        {/* Title */}
        <div className="mb-12">
          <h1
            className="text-3xl text-slate-800 dark:text-white/90 mb-2"
            style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
          >
            The Fleet
          </h1>
          <p
            className="text-sm text-slate-500 dark:text-white/50 max-w-xl"
            style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
          >
            Pick an agent to chat with. Each one has its own scope, memory, and habits.
          </p>
        </div>

        {/* Agent grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {AGENTS.map((agent) => (
            <a
              key={agent.slug}
              href={buildAgentUrl(agent.slug)}
              className={`group block border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-6 transition no-underline ${agent.cardHover}`}
            >
              <div className="flex items-start justify-between mb-6">
                <div
                  className={`w-14 h-14 border flex items-center justify-center ${agent.iconBox}`}
                >
                  <span className="text-2xl leading-none select-none">{agent.emoji}</span>
                </div>
                <span
                  className={`text-[9px] tracking-[2px] font-mono opacity-0 group-hover:opacity-100 transition ${agent.enterText}`}
                >
                  ENTER →
                </span>
              </div>

              <div className="mb-2">
                <h2
                  className="text-xl text-slate-800 dark:text-white/90"
                  style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
                >
                  {agent.name}
                </h2>
                <p className={`text-[9px] tracking-[1px] font-mono mt-1 ${agent.roleText}`}>
                  {'// ' + agent.role.toUpperCase().replace(/\s+/g, '_')}
                </p>
              </div>

              <p
                className="text-sm text-slate-500 dark:text-white/50 leading-relaxed"
                style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
              >
                {agent.description}
              </p>

              <div className="mt-6 flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-emerald-500 dark:bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-[9px] text-emerald-600/80 dark:text-emerald-400/80 tracking-[1px] font-mono">
                  ONLINE
                </span>
              </div>
            </a>
          ))}
        </div>

        {/* Orchestration panels */}
        <OrchPanels />

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-slate-200 dark:border-white/10">
          <p className="text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] font-mono">
            {'// MUPPETS.REMOTELYHUMAN.COM — built on KyberBot'}
          </p>
        </div>
      </div>
    </div>
  );
}
