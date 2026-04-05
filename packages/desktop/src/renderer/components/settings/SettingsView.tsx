/**
 * Settings tab — two-column layout for cleaner presentation.
 * Left: Identity + Server. Right: API Keys + Backup + Tunnel.
 */

import { useState, useEffect } from 'react';
import type { IdentityConfig, EnvConfig } from '../../../types/ipc';

export default function SettingsView() {
  const kb = (window as any).kyberbot;
  const [identity, setIdentity] = useState<IdentityConfig | null>(null);
  const [env, setEnv] = useState<EnvConfig>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!kb) return;
    kb.config.readIdentity().then((id: IdentityConfig | null) => setIdentity(id));
    kb.config.readEnv().then((e: EnvConfig) => setEnv(e));
  }, []);

  useEffect(() => {
    const fetchTunnel = async () => {
      try {
        const token = await kb?.config.getApiToken();
        const url = await kb?.config.getServerUrl();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${url}/api/web/manage/tunnel`, { headers });
        if (res.ok) {
          const data = await res.json();
          setTunnelUrl(data.url);
        }
      } catch {}
    };
    fetchTunnel();
    const timer = setInterval(fetchTunnel, 10_000);
    return () => clearInterval(timer);
  }, []);

  const save = async (type: string, fn: () => Promise<void>) => {
    setSaving(true);
    try {
      await fn();
      setMessage(`${type} saved`);
      setTimeout(() => setMessage(''), 2000);
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    }
    setSaving(false);
  };

  if (!identity) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
      <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Loading settings...</span>
    </div>;
  }

  const inputStyle: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '11px', background: 'var(--bg-tertiary)', color: 'var(--fg-primary)', border: '1px solid var(--border-color)', outline: 'none', width: '100%', padding: '6px 8px' };
  const labelStyle: React.CSSProperties = { color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', display: 'block', marginBottom: '2px' };
  const btnStyle = (color: string): React.CSSProperties => ({ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', borderColor: color, color, background: 'transparent', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.5 : 1, border: '1px solid', padding: '4px 12px' });
  const sectionStyle: React.CSSProperties = { marginBottom: '20px' };
  const fieldGap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '10px' };

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflowY: 'auto', padding: '20px 24px', background: 'var(--bg-primary)' }}>
      {message && <div style={{ marginBottom: '12px', padding: '8px', fontSize: '11px', border: '1px solid var(--accent-emerald)', color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>{message}</div>}

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

        {/* ── LEFT COLUMN ── */}
        <div>
          {/* Identity */}
          <div style={sectionStyle}>
            <span className="section-title" style={{ color: 'var(--accent-emerald)' }}>{'// IDENTITY'}</span>
            <div style={{ ...fieldGap, marginTop: '10px' }}>
              <div>
                <label style={labelStyle}>Agent Name</label>
                <input value={identity.agent_name || ''} onChange={(e) => setIdentity({ ...identity, agent_name: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <input value={identity.agent_description || ''} onChange={(e) => setIdentity({ ...identity, agent_description: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Timezone</label>
                  <input value={identity.timezone || ''} onChange={(e) => setIdentity({ ...identity, timezone: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Heartbeat Interval</label>
                  <input value={identity.heartbeat_interval || ''} onChange={(e) => setIdentity({ ...identity, heartbeat_interval: e.target.value })} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Active Hours Start</label>
                  <input value={identity.heartbeat_active_hours?.start || ''} onChange={(e) => setIdentity({ ...identity, heartbeat_active_hours: { ...identity.heartbeat_active_hours, start: e.target.value, end: identity.heartbeat_active_hours?.end || '23:00' } })} style={inputStyle} placeholder="07:00" />
                </div>
                <div>
                  <label style={labelStyle}>Active Hours End</label>
                  <input value={identity.heartbeat_active_hours?.end || ''} onChange={(e) => setIdentity({ ...identity, heartbeat_active_hours: { ...identity.heartbeat_active_hours, start: identity.heartbeat_active_hours?.start || '07:00', end: e.target.value } })} style={inputStyle} placeholder="23:00" />
                </div>
              </div>
              <button onClick={() => save('Identity', () => kb.config.writeIdentity(identity))} disabled={saving} style={btnStyle('var(--accent-emerald)')}>
                {saving ? 'Saving...' : 'Save Identity'}
              </button>
            </div>
          </div>

          {/* Server */}
          <div style={sectionStyle}>
            <span className="section-title" style={{ color: 'var(--accent-cyan)' }}>{'// SERVER'}</span>
            <div style={{ ...fieldGap, marginTop: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Port</label>
                  <input value={identity.server?.port || 3456} onChange={(e) => setIdentity({ ...identity, server: { ...identity.server, port: parseInt(e.target.value) || 3456 } })} style={inputStyle} type="number" />
                </div>
                <div>
                  <label style={labelStyle}>Claude Mode</label>
                  <select value={identity.claude?.mode || 'subscription'} onChange={(e) => setIdentity({ ...identity, claude: { ...identity.claude, mode: e.target.value as any } })} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="subscription">Subscription</option>
                    <option value="sdk">API Key (SDK)</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Claude Model</label>
                  <select value={identity.claude?.model || 'opus'} onChange={(e) => setIdentity({ ...identity, claude: { ...identity.claude, model: e.target.value } })} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="opus">Opus</option>
                    <option value="sonnet">Sonnet</option>
                    <option value="haiku">Haiku</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={identity.tunnel?.enabled || false} onChange={(e) => setIdentity({ ...identity, tunnel: { enabled: e.target.checked } })} style={{ accentColor: 'var(--accent-emerald)' }} />
                <span style={{ fontSize: '11px', color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>Enable ngrok tunnel</span>
              </div>
            </div>
          </div>

          {/* Tunnel */}
          <div style={sectionStyle}>
            <span className="section-title" style={{ color: 'var(--accent-teal, var(--accent-cyan))' }}>{'// TUNNEL'}</span>
            <div style={{ ...fieldGap, marginTop: '10px' }}>
              {tunnelUrl ? (
                <div style={{ padding: '10px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.05)' }}>
                  <div style={{ fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)', marginBottom: '6px' }}>TUNNEL ACTIVE</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input type="text" value={tunnelUrl} readOnly style={{ ...inputStyle, flex: 1, userSelect: 'text', WebkitUserSelect: 'text' } as any} />
                    <button onClick={() => { navigator.clipboard.writeText(tunnelUrl); setMessage('Tunnel URL copied'); setTimeout(() => setMessage(''), 2000); }} style={btnStyle('var(--accent-emerald)')}>Copy</button>
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>No active tunnel</span>
              )}
              <div>
                <label style={labelStyle}>ngrok Auth Token</label>
                <input type="password" value={env['NGROK_AUTHTOKEN'] || ''} onChange={(e) => setEnv({ ...env, NGROK_AUTHTOKEN: e.target.value })} style={inputStyle} placeholder="Leave blank if globally configured" />
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div>
          {/* API Keys */}
          <div style={sectionStyle}>
            <span className="section-title" style={{ color: 'var(--accent-amber)' }}>{'// API KEYS'}</span>
            <div style={{ ...fieldGap, marginTop: '10px' }}>
              {['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'KYBERNESIS_API_KEY'].map(key => (
                <div key={key}>
                  <label style={labelStyle}>{key}</label>
                  <input type="password" value={env[key] || ''} onChange={(e) => setEnv({ ...env, [key]: e.target.value })} style={inputStyle} placeholder="Not set" />
                </div>
              ))}
              <div>
                <label style={labelStyle}>KYBERBOT_API_TOKEN</label>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input type="text" value={env['KYBERBOT_API_TOKEN'] || ''} onChange={(e) => setEnv({ ...env, KYBERBOT_API_TOKEN: e.target.value })} style={{ ...inputStyle, userSelect: 'text', WebkitUserSelect: 'text' } as any} readOnly={!!env['KYBERBOT_API_TOKEN']} />
                  <button onClick={() => { if (env['KYBERBOT_API_TOKEN']) { navigator.clipboard.writeText(env['KYBERBOT_API_TOKEN']); setMessage('Token copied'); setTimeout(() => setMessage(''), 2000); } }} style={btnStyle('var(--accent-cyan)')}>Copy</button>
                </div>
              </div>
              <button onClick={() => save('.env', () => kb.config.writeEnv(env))} disabled={saving} style={btnStyle('var(--accent-amber)')}>
                {saving ? 'Saving...' : 'Save .env'}
              </button>
            </div>
          </div>

          {/* Backup */}
          <div style={sectionStyle}>
            <span className="section-title" style={{ color: 'var(--accent-violet)' }}>{'// BACKUP'}</span>
            <div style={{ ...fieldGap, marginTop: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={identity.backup?.enabled || false} onChange={(e) => setIdentity({ ...identity, backup: { ...identity.backup, enabled: e.target.checked, remote_url: identity.backup?.remote_url || '', schedule: identity.backup?.schedule || '24h' } })} style={{ accentColor: 'var(--accent-emerald)' }} />
                <span style={{ fontSize: '11px', color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>Enable GitHub backup</span>
              </div>
              {identity.backup?.enabled && (
                <>
                  <div>
                    <label style={labelStyle}>GitHub Remote URL</label>
                    <input value={identity.backup?.remote_url || ''} onChange={(e) => setIdentity({ ...identity, backup: { ...identity.backup!, remote_url: e.target.value } })} style={inputStyle} placeholder="https://github.com/user/repo.git" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={labelStyle}>Schedule</label>
                      <input value={identity.backup?.schedule || '24h'} onChange={(e) => setIdentity({ ...identity, backup: { ...identity.backup!, schedule: e.target.value } })} style={inputStyle} placeholder="24h" />
                    </div>
                    <div>
                      <label style={labelStyle}>Branch</label>
                      <input value={identity.backup?.branch || 'main'} onChange={(e) => setIdentity({ ...identity, backup: { ...identity.backup!, branch: e.target.value } })} style={inputStyle} placeholder="main" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Appearance */}
          <div style={sectionStyle}>
            <span className="section-title" style={{ color: 'var(--fg-tertiary)' }}>{'// APPEARANCE'}</span>
            <p style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: '10px' }}>
              Use the moon/sun icon in the title bar to toggle dark/light mode.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
