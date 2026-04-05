/**
 * Settings tab — identity, API keys, server config.
 */

import { useState, useEffect } from 'react';
import type { IdentityConfig, EnvConfig } from '../../../types/ipc';

export default function SettingsView() {
  const kb = (window as any).kyberbot;
  const [identity, setIdentity] = useState<IdentityConfig | null>(null);
  const [env, setEnv] = useState<EnvConfig>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!kb) return;
    kb.config.readIdentity().then((id: IdentityConfig | null) => setIdentity(id));
    kb.config.readEnv().then((e: EnvConfig) => setEnv(e));
  }, []);

  const saveIdentity = async () => {
    if (!identity) return;
    setSaving(true);
    try {
      await kb.config.writeIdentity(identity);
      setMessage('Identity saved');
      setTimeout(() => setMessage(''), 2000);
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    }
    setSaving(false);
  };

  const saveEnv = async () => {
    setSaving(true);
    try {
      await kb.config.writeEnv(env);
      setMessage('.env saved');
      setTimeout(() => setMessage(''), 2000);
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    }
    setSaving(false);
  };

  if (!identity) {
    return <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
      <span className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Loading settings...</span>
    </div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4" style={{ background: 'var(--bg-primary)' }}>
      {message && <div className="mb-3 p-2 text-[11px] border" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)' }}>{message}</div>}

      {/* Identity */}
      <span className="section-title" style={{ color: 'var(--accent-emerald)' }}>{'// IDENTITY'}</span>
      <div className="grid gap-3 mt-3 mb-6">
        {([
          ['agent_name', 'Agent Name'],
          ['agent_description', 'Description'],
          ['timezone', 'Timezone'],
          ['heartbeat_interval', 'Heartbeat Interval'],
        ] as const).map(([key, label]) => (
          <div key={key}>
            <label className="text-[9px] tracking-[1px] uppercase mb-1 block" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{label}</label>
            <input
              value={(identity as any)[key] || ''}
              onChange={(e) => setIdentity({ ...identity, [key]: e.target.value })}
              className="w-full px-2 py-1 text-[11px] outline-none"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-tertiary)', color: 'var(--fg-primary)', border: '1px solid var(--border-color)' }}
            />
          </div>
        ))}
        <button onClick={saveIdentity} disabled={saving} className="px-3 py-1 text-[9px] tracking-[1px] uppercase border w-fit" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)', background: 'transparent', cursor: 'pointer' }}>
          {saving ? 'Saving...' : 'Save Identity'}
        </button>
      </div>

      {/* API Keys */}
      <span className="section-title" style={{ color: 'var(--accent-cyan)' }}>{'// API KEYS'}</span>
      <div className="grid gap-3 mt-3 mb-6">
        {['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'KYBERNESIS_API_KEY', 'KYBERBOT_API_TOKEN'].map((key) => (
          <div key={key}>
            <label className="text-[9px] tracking-[1px] uppercase mb-1 block" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{key}</label>
            <input
              type="password"
              value={env[key] || ''}
              onChange={(e) => setEnv({ ...env, [key]: e.target.value })}
              placeholder="Not set"
              className="w-full px-2 py-1 text-[11px] outline-none"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-tertiary)', color: 'var(--fg-primary)', border: '1px solid var(--border-color)' }}
            />
          </div>
        ))}
        <button onClick={saveEnv} disabled={saving} className="px-3 py-1 text-[9px] tracking-[1px] uppercase border w-fit" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)', background: 'transparent', cursor: 'pointer' }}>
          {saving ? 'Saving...' : 'Save .env'}
        </button>
      </div>
    </div>
  );
}
