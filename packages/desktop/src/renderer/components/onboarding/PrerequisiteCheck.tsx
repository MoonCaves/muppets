/**
 * Prerequisite check — blocks until Docker + Claude Code are both detected.
 * Auto-refreshes every 3 seconds.
 */

import { useState, useEffect } from 'react';
import type { PrerequisiteStatus } from '../../../types/ipc';

interface PrerequisiteCheckProps {
  onPassed: () => void;
}

export default function PrerequisiteCheck({ onPassed }: PrerequisiteCheckProps) {
  const [status, setStatus] = useState<PrerequisiteStatus | null>(null);

  useEffect(() => {
    const kb = (window as any).kyberbot;
    if (!kb) return;

    const check = async () => {
      const s = await kb.prerequisites.check();
      setStatus(s);
      if (s.docker.installed && s.docker.running && s.claude.installed && s.kyberbot.installed) {
        onPassed();
      }
    };

    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, [onPassed]);

  const items = [
    {
      label: 'KyberBot CLI',
      ok: status?.kyberbot?.installed,
      installed: status?.kyberbot?.installed,
      version: status?.kyberbot?.version,
      help: 'Install with: npm install -g @kyberbot/cli',
    },
    {
      label: 'Docker Desktop',
      ok: status?.docker.installed && status?.docker.running,
      installed: status?.docker.installed,
      version: status?.docker.version,
      help: 'Download from docker.com/products/docker-desktop',
      detail: status?.docker.installed && !status?.docker.running ? 'Installed but not running — start Docker Desktop' : undefined,
    },
    {
      label: 'Claude Code CLI',
      ok: status?.claude.installed,
      installed: status?.claude.installed,
      version: status?.claude.version,
      help: 'Install with: npm install -g @anthropic-ai/claude-code',
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center p-8">
      <span className="section-title mb-6" style={{ color: 'var(--accent-emerald)' }}>{'// PREREQUISITES'}</span>
      <p className="text-[13px] text-center max-w-md mb-8" style={{ color: 'var(--fg-secondary)', fontFamily: 'var(--font-sans)', fontWeight: 300 }}>
        KyberBot requires Docker Desktop and the Claude Code CLI to run. Install both before continuing.
      </p>

      <div className="w-full max-w-sm space-y-3">
        {items.map(item => (
          <div key={item.label} className="border p-4" style={{ borderColor: item.ok ? 'rgba(16,185,129,0.3)' : 'var(--border-color)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-3">
              <div className="text-[16px]">{item.ok ? '\u2713' : status ? '\u2717' : '\u25CB'}</div>
              <div className="flex-1">
                <div className="text-[13px]" style={{ fontFamily: 'var(--font-mono)', color: item.ok ? 'var(--status-success)' : 'var(--fg-primary)' }}>{item.label}</div>
                {item.version && <div className="text-[9px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{item.version}</div>}
                {item.detail && <div className="text-[9px] mt-1" style={{ color: 'var(--status-warning)', fontFamily: 'var(--font-mono)' }}>{item.detail}</div>}
                {!item.ok && !item.detail && <div className="text-[9px] mt-1" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{item.help}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {!status && (
        <div className="mt-6 text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Checking...</div>
      )}

      {status && !(status.docker.installed && status.docker.running && status.claude.installed) && (
        <div className="mt-6 text-[9px] tracking-[1px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
          AUTO-REFRESHING EVERY 3 SECONDS...
        </div>
      )}
    </div>
  );
}
