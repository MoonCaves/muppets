import type { ServiceStatus as ServiceStatusType } from '../../api/types';

interface ServiceStatusProps {
  status: ServiceStatusType | null;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ServiceStatus({ status }: ServiceStatusProps) {
  return (
    <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono">
          SERVICE_STATUS
        </div>
        {status && (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-emerald-500 dark:bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-[9px] text-emerald-600/80 dark:text-emerald-400/80 tracking-[1px] font-mono">
              ONLINE
            </span>
          </div>
        )}
      </div>

      {status ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 dark:text-white/50 font-mono">
              UPTIME
            </span>
            <span className="text-[11px] text-slate-800 dark:text-white/90 font-mono">
              {formatUptime(status.uptime)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 dark:text-white/50 font-mono">
              AGENT
            </span>
            <span className="text-[11px] text-slate-800 dark:text-white/90 font-mono">
              {status.agent}
            </span>
          </div>
        </div>
      ) : (
        <div
          className="text-[10px] text-slate-400 dark:text-white/30"
          style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
        >
          Connecting...
        </div>
      )}
    </div>
  );
}
