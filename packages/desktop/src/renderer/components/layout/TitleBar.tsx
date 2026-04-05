/**
 * Title bar — blends with app, Samantha-style.
 * Agent name center, theme toggle + agent switcher on right.
 * Uses lucide-react icons matching Samantha.
 */

import { useState, useEffect } from 'react';
import { Moon, Sun, ChevronDown } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function TitleBar() {
  const { agentRoot } = useApp();
  const [agentName, setAgentName] = useState('KyberBot');
  const [isDark, setIsDark] = useState(true);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    const kb = (window as any).kyberbot;
    if (!kb) return;
    kb.config.readIdentity().then((id: any) => {
      if (id?.agent_name) setAgentName(id.agent_name);
    });
    setIsDark(!document.documentElement.classList.contains('light'));
  }, [agentRoot]);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.remove('light');
      localStorage.setItem('kyberbot_theme', 'dark');
    } else {
      document.documentElement.classList.add('light');
      localStorage.setItem('kyberbot_theme', 'light');
    }
  };

  const switchAgent = async () => {
    const kb = (window as any).kyberbot;
    const result = await kb.config.selectAgentRoot();
    if (result?.hasIdentity) window.location.reload();
    else if (result) alert(`No identity.yaml found in ${result.path}`);
    setShowMenu(false);
  };

  const createNewAgent = () => {
    (window as any).kyberbot.config.setAgentRoot('').then(() => window.location.reload());
    setShowMenu(false);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '36px',
        padding: '0 12px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        WebkitAppRegion: 'drag' as any,
        position: 'relative',
      }}
    >
      {/* Spacer for native macOS stoplight buttons */}
      <div style={{ width: '70px', flexShrink: 0 }} />

      {/* Center: Agent name dropdown */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            WebkitAppRegion: 'no-drag' as any,
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.15em', color: 'var(--accent-emerald)', textTransform: 'uppercase' }}>
            {`// ${agentName}`}
          </span>
          <ChevronDown size={10} style={{ color: 'var(--fg-muted)' }} />
        </button>
      </div>

      {/* Right: Theme toggle */}
      <div style={{ width: '70px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', WebkitAppRegion: 'no-drag' as any }}>
        <button
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--fg-muted)', opacity: 0.4,
            width: '20px', height: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'opacity 150ms',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.4')}
        >
          {isDark ? <Moon size={12} /> : <Sun size={12} />}
        </button>
      </div>

      {/* Dropdown */}
      {showMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowMenu(false)} />
          <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, border: '1px solid var(--border-color)', background: 'var(--bg-elevated)', padding: '4px 0', minWidth: '200px', WebkitAppRegion: 'no-drag' as any }}>
            <button onClick={switchAgent} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--fg-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>Switch Agent...</button>
            <button onClick={createNewAgent} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--accent-emerald)', background: 'transparent', border: 'none', cursor: 'pointer' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>+ Create New Agent</button>
          </div>
        </>
      )}
    </div>
  );
}
