/**
 * Channels tab — read-only status display.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { manageFetch } from '../../utils/api';

interface ChannelInfo {
  name: string;
  connected: boolean;
  verified: boolean | null;
}

export default function ChannelsView() {
  const { serverUrl, apiToken } = useApp();
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadChannels = useCallback(async () => {
    try {
      const data = await manageFetch<{ channels: ChannelInfo[] }>(serverUrl, apiToken, '/channels');
      setChannels(data.channels);
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, [serverUrl, apiToken]);

  useEffect(() => {
    loadChannels();
    const timer = setInterval(loadChannels, 10_000);
    return () => clearInterval(timer);
  }, [loadChannels]);

  return (
    <div className="h-full overflow-y-auto p-4" style={{ background: 'var(--bg-primary)' }}>
      <span className="section-title" style={{ color: 'var(--accent-emerald)' }}>{'// CHANNELS'}</span>
      <p className="text-[11px] mt-1 mb-4" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
        Channel lifecycle is managed by the CLI. Status is read-only.
      </p>

      {loading && <span className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Loading...</span>}

      {channels.length === 0 && !loading && (
        <div className="text-center py-8">
          <span className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>No channels configured</span>
        </div>
      )}

      <div className="grid gap-3">
        {channels.map((ch) => (
          <div key={ch.name} className="p-4 border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-3">
              <div className={`status-dot ${ch.connected ? 'status-dot--online' : 'status-dot--offline'}`} />
              <span className="text-[13px] font-medium capitalize" style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{ch.name}</span>
              <span className="text-[9px] tracking-[1px] uppercase" style={{ color: ch.connected ? 'var(--status-success)' : 'var(--fg-muted)' }}>
                {ch.connected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
              {ch.verified !== null && (
                <span className="text-[9px] tracking-[1px] uppercase" style={{ color: ch.verified ? 'var(--accent-cyan)' : 'var(--status-warning)' }}>
                  {ch.verified ? 'VERIFIED' : 'UNVERIFIED'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
