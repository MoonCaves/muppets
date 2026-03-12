import { useState } from 'react';
import type { IdentityConfig } from '../../api/types';
import { formatModelName } from '../../utils/model';

interface AgentConfigProps {
  identity: IdentityConfig | null;
  loading: boolean;
  onUpdate: (changes: Partial<IdentityConfig>) => Promise<void>;
}

function EditableField({
  label,
  value,
  onSave,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onSave: (val: string) => Promise<void>;
  placeholder?: string;
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // Stay in edit mode on error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] mb-1 font-mono">
        {label}
      </div>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder={placeholder}
            autoFocus
            className={`flex-1 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 px-2 py-1 text-xs text-slate-800 dark:text-white/90 focus:border-violet-500/40 dark:focus:border-violet-400/40 focus:outline-none ${mono ? 'font-mono' : ''}`}
          />
          <button
            onClick={save}
            disabled={saving}
            className="text-[8px] text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 dark:border-emerald-400/30 bg-emerald-500/10 dark:bg-emerald-400/10 px-1.5 py-1 tracking-[1px] font-mono hover:bg-emerald-500/20 dark:hover:bg-emerald-400/20 transition disabled:opacity-50"
          >
            {saving ? '...' : 'SAVE'}
          </button>
          <button
            onClick={() => { setDraft(value); setEditing(false); }}
            className="text-[8px] text-slate-400 dark:text-white/30 tracking-[1px] font-mono hover:text-slate-600 dark:hover:text-white/50 transition"
          >
            ESC
          </button>
        </div>
      ) : (
        <p
          onClick={() => { setDraft(value); setEditing(true); }}
          className={`text-sm text-slate-600 dark:text-white/70 cursor-pointer hover:text-violet-600 dark:hover:text-violet-400 transition-colors ${mono ? 'font-mono' : ''}`}
          style={mono ? undefined : { fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
        >
          {value || <span className="italic text-slate-400 dark:text-white/30">{placeholder || 'Click to set'}</span>}
        </p>
      )}
    </div>
  );
}

export default function AgentConfig({ identity, loading, onUpdate }: AgentConfigProps) {
  const [addingTelegram, setAddingTelegram] = useState(false);
  const [telegramToken, setTelegramToken] = useState('');
  const [savingTelegram, setSavingTelegram] = useState(false);

  if (loading) {
    return (
      <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-4">
        <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono animate-pulse">
          LOADING_CONFIG...
        </div>
      </div>
    );
  }

  if (!identity) return null;

  const hasTelegram = !!identity.channels?.telegram?.bot_token;
  const hasWhatsapp = !!identity.channels?.whatsapp?.enabled;

  const saveTelegram = async () => {
    if (!telegramToken.trim()) return;
    setSavingTelegram(true);
    try {
      await onUpdate({ channels: { ...identity.channels, telegram: { bot_token: telegramToken.trim() } } });
      setAddingTelegram(false);
      setTelegramToken('');
    } catch {
      // stay open on error
    } finally {
      setSavingTelegram(false);
    }
  };

  const removeTelegram = async () => {
    await onUpdate({ channels: { ...identity.channels, telegram: undefined } } as Partial<IdentityConfig>);
  };

  const toggleWhatsapp = async () => {
    await onUpdate({
      channels: { ...identity.channels, whatsapp: { enabled: !hasWhatsapp } },
    });
  };

  return (
    <div className="border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0a0a0a] p-4">
      <div className="text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono mb-4">
        AGENT_CONFIG
      </div>

      <div className="space-y-3">
        {/* Name — read-only */}
        <div>
          <div className="text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] mb-1 font-mono">
            NAME
          </div>
          <p
            className="text-sm text-slate-800 dark:text-white/90"
            style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
          >
            {identity.agent_name}
          </p>
        </div>

        {/* Description — editable */}
        <EditableField
          label="DESCRIPTION"
          value={identity.agent_description || ''}
          onSave={(val) => onUpdate({ agent_description: val })}
          placeholder="Add a description..."
        />

        {/* Model — read-only */}
        <div>
          <div className="text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] mb-1 font-mono">
            MODEL
          </div>
          <p
            className="text-sm text-slate-800 dark:text-white/90"
            style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
          >
            {formatModelName(identity.claude?.model)}
          </p>
        </div>

        {/* Timezone — editable */}
        <EditableField
          label="TIMEZONE"
          value={identity.timezone}
          onSave={(val) => onUpdate({ timezone: val })}
          mono
        />

        {/* Heartbeat — editable */}
        <EditableField
          label="HEARTBEAT_INTERVAL"
          value={identity.heartbeat_interval}
          onSave={(val) => onUpdate({ heartbeat_interval: val })}
          placeholder="e.g. 30m, 1h"
          mono
        />

        {/* Channels */}
        <div>
          <div className="text-[9px] text-slate-400 dark:text-white/30 tracking-[1px] mb-2 font-mono">
            CHANNELS
          </div>
          <div className="space-y-2">
            {/* Telegram */}
            {hasTelegram ? (
              <div className="flex items-center justify-between">
                <span className="text-[10px] border px-2 py-1 tracking-[1px] font-mono text-cyan-600/70 dark:text-cyan-400/70 border-cyan-500/30 dark:border-cyan-400/30 bg-cyan-500/5 dark:bg-cyan-400/5">
                  TELEGRAM
                </span>
                <button
                  onClick={removeTelegram}
                  className="text-[8px] text-rose-500/60 dark:text-rose-400/60 hover:text-rose-500 dark:hover:text-rose-400 tracking-[1px] font-mono transition-colors"
                >
                  REMOVE
                </button>
              </div>
            ) : addingTelegram ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveTelegram()}
                  placeholder="Bot token from @BotFather"
                  autoFocus
                  className="w-full bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 px-2 py-1.5 text-[10px] text-slate-800 dark:text-white/90 font-mono focus:border-cyan-500/40 dark:focus:border-cyan-400/40 focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={saveTelegram}
                    disabled={savingTelegram || !telegramToken.trim()}
                    className="text-[8px] text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 tracking-[1px] font-mono hover:bg-emerald-500/20 transition disabled:opacity-30"
                  >
                    {savingTelegram ? 'SAVING...' : 'ADD'}
                  </button>
                  <button
                    onClick={() => { setAddingTelegram(false); setTelegramToken(''); }}
                    className="text-[8px] text-slate-400 dark:text-white/30 tracking-[1px] font-mono hover:text-slate-600 dark:hover:text-white/50 transition"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingTelegram(true)}
                className="text-[9px] border border-dashed border-slate-300 dark:border-white/10 text-slate-400 dark:text-white/30 hover:border-cyan-400/40 dark:hover:border-cyan-400/30 hover:text-cyan-600 dark:hover:text-cyan-400 px-2 py-1.5 tracking-[1px] font-mono transition w-full text-center"
              >
                + ADD TELEGRAM
              </button>
            )}

            {/* WhatsApp */}
            <div className="flex items-center justify-between">
              <span className={`text-[10px] border px-2 py-1 tracking-[1px] font-mono ${
                hasWhatsapp
                  ? 'text-violet-600/70 dark:text-violet-400/70 border-violet-500/20 dark:border-violet-400/20 bg-violet-500/5 dark:bg-violet-400/5'
                  : 'text-slate-400/60 dark:text-white/20 border-slate-300/50 dark:border-white/5'
              }`}>
                WHATSAPP
              </span>
              <button
                onClick={toggleWhatsapp}
                className={`text-[8px] tracking-[1px] font-mono transition-colors ${
                  hasWhatsapp
                    ? 'text-slate-400 dark:text-white/30 hover:text-rose-500 dark:hover:text-rose-400'
                    : 'text-emerald-500/60 dark:text-emerald-400/60 hover:text-emerald-500 dark:hover:text-emerald-400'
                }`}
              >
                {hasWhatsapp ? 'DISABLE' : 'ENABLE'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
