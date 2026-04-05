/**
 * Frameless title bar with agent name and switcher.
 */

import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

export default function TitleBar() {
  const { agentRoot } = useApp();
  const [agentName, setAgentName] = useState('KyberBot');
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    const kb = (window as any).kyberbot;
    if (!kb) return;
    kb.config.readIdentity().then((id: any) => {
      if (id?.agent_name) setAgentName(id.agent_name);
    });
  }, [agentRoot]);

  const switchAgent = async () => {
    const kb = (window as any).kyberbot;
    const result = await kb.config.selectAgentRoot();
    if (result?.hasIdentity) {
      window.location.reload();
    } else if (result) {
      alert(`No identity.yaml found in ${result.path}`);
    }
    setShowMenu(false);
  };

  const createNewAgent = () => {
    const kb = (window as any).kyberbot;
    // Clear agent root to trigger onboarding
    kb.config.setAgentRoot('').then(() => {
      window.location.reload();
    });
    setShowMenu(false);
  };

  const agentDir = agentRoot?.split('/').pop() || '';

  return (
    <div
      className="flex items-center h-9 px-3 border-b select-none relative"
      style={{
        WebkitAppRegion: 'drag' as any,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        background: 'var(--bg-secondary)',
      }}
    >
      {/* Spacer for macOS traffic lights */}
      <div className="w-[70px] flex-shrink-0" />

      {/* Agent name — clickable for switcher */}
      <div className="flex-1 flex items-center justify-center gap-2">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-1.5"
          style={{
            WebkitAppRegion: 'no-drag' as any,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <span className="text-[9px] tracking-[2px] uppercase" style={{ color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {agentName}
          </span>
          <span className="text-[7px]" style={{ color: 'var(--fg-muted)' }}>{'\u25BE'}</span>
        </button>
        {agentDir && (
          <span className="text-[8px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
            ({agentDir})
          </span>
        )}
      </div>

      {/* Right spacer */}
      <div className="w-[70px] flex-shrink-0" />

      {/* Dropdown menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 z-50 border py-1 min-w-[200px]"
            style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-color)', WebkitAppRegion: 'no-drag' as any }}
          >
            <button
              onClick={switchAgent}
              className="w-full text-left px-3 py-1.5 text-[11px] transition-colors"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Switch Agent...
            </button>
            <button
              onClick={createNewAgent}
              className="w-full text-left px-3 py-1.5 text-[11px] transition-colors"
              style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-emerald)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              + Create New Agent
            </button>
          </div>
        </>
      )}
    </div>
  );
}
