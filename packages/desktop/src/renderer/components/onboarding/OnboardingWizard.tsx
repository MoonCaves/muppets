/**
 * 9-step onboarding wizard for creating a new KyberBot agent.
 * Matches the CLI's onboard.ts steps exactly.
 */

import { useState, useCallback } from 'react';
import PrerequisiteCheck from './PrerequisiteCheck';

interface OnboardingData {
  agentRoot: string;
  agentName: string;
  agentDescription: string;
  userName: string;
  timezone: string;
  location: string;
  about: string;
  claudeMode: 'subscription' | 'sdk';
  apiKey: string;
  kybernesisKey: string;
  ngrokToken: string;
  telegramToken: string;
  whatsappEnabled: boolean;
  backupUrl: string;
  backupBranch: string;
}

const INITIAL: OnboardingData = {
  agentRoot: '',
  agentName: '',
  agentDescription: 'A personal AI agent powered by Claude Code',
  userName: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  location: '',
  about: '',
  claudeMode: 'subscription',
  apiKey: '',
  kybernesisKey: '',
  ngrokToken: '',
  telegramToken: '',
  whatsappEnabled: false,
  backupUrl: '',
  backupBranch: 'main',
};

const STEPS = [
  'Prerequisites',
  'Agent Identity',
  'About You',
  'Claude Code',
  'Brain Init',
  'Cloud Sync',
  'Remote Access',
  'Channels',
  'Backup',
  'Summary',
];

interface OnboardingWizardProps {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingData>(INITIAL);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const update = (partial: Partial<OnboardingData>) => setData(prev => ({ ...prev, ...partial }));
  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep(s => Math.max(s - 1, 1)); // Can't go back to prerequisites

  const selectDirectory = async () => {
    const kb = (window as any).kyberbot;
    const result = await kb.config.selectAgentRoot();
    if (result) {
      update({ agentRoot: result.path });
      if (result.hasIdentity) {
        // Existing agent — skip to end
        onComplete();
        return;
      }
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const kb = (window as any).kyberbot;
      await kb.onboarding.create({
        agentRoot: data.agentRoot,
        agentName: data.agentName,
        agentDescription: data.agentDescription,
        userName: data.userName,
        timezone: data.timezone,
        claudeMode: data.claudeMode,
        apiKey: data.apiKey || undefined,
      });
      onComplete();
    } catch (err) {
      setError((err as Error).message);
    }
    setCreating(false);
  };

  const prereqsPassed = useCallback(() => { setStep(1); }, []);

  const inputStyle = { fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--bg-tertiary)', color: 'var(--fg-primary)', border: '1px solid var(--border-color)', outline: 'none', width: '100%', padding: '8px 12px' };
  const labelStyle = { color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase' as const, display: 'block', marginBottom: '4px' };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* Progress bar */}
      <div className="px-6 pt-4 pb-2">
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={i} className="flex-1 h-[2px]" style={{ background: i <= step ? 'var(--accent-emerald)' : 'var(--border-color)', transition: 'background 0.3s' }} />
          ))}
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[9px] tracking-[2px]" style={{ color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>
            {`// STEP ${step + 1} OF ${STEPS.length}: ${STEPS[step].toUpperCase()}`}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col items-center">
        <div className="w-full max-w-md">
          {/* Step 0: Prerequisites */}
          {step === 0 && <PrerequisiteCheck onPassed={prereqsPassed} />}

          {/* Step 1: Agent Identity */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label style={labelStyle}>Agent Directory</label>
                <div className="flex gap-2">
                  <input value={data.agentRoot} readOnly style={inputStyle} placeholder="Select a directory..." />
                  <button onClick={selectDirectory} className="px-3 text-[9px] tracking-[1px] uppercase border whitespace-nowrap" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)', background: 'transparent', cursor: 'pointer' }}>Browse</button>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Agent Name</label>
                <input value={data.agentName} onChange={e => update({ agentName: e.target.value })} style={inputStyle} placeholder="e.g. Atlas, Nova, Echo" />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <input value={data.agentDescription} onChange={e => update({ agentDescription: e.target.value })} style={inputStyle} />
              </div>
            </div>
          )}

          {/* Step 2: About You */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label style={labelStyle}>Your Name</label>
                <input value={data.userName} onChange={e => update({ userName: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Timezone</label>
                <input value={data.timezone} onChange={e => update({ timezone: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Location (optional)</label>
                <input value={data.location} onChange={e => update({ location: e.target.value })} style={inputStyle} placeholder="e.g. New York, USA" />
              </div>
              <div>
                <label style={labelStyle}>About You (optional)</label>
                <textarea value={data.about} onChange={e => update({ about: e.target.value })} style={{ ...inputStyle, height: '80px', resize: 'none' }} placeholder="What do you do? What should your agent know about you?" />
              </div>
            </div>
          )}

          {/* Step 3: Claude Code */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label style={labelStyle}>Claude Code Mode</label>
                <div className="space-y-2 mt-2">
                  {(['subscription', 'sdk'] as const).map(mode => (
                    <label key={mode} className="flex items-center gap-3 p-3 border cursor-pointer" style={{ borderColor: data.claudeMode === mode ? 'var(--accent-emerald)' : 'var(--border-color)', background: data.claudeMode === mode ? 'rgba(16,185,129,0.05)' : 'var(--bg-secondary)' }}>
                      <input type="radio" checked={data.claudeMode === mode} onChange={() => update({ claudeMode: mode })} style={{ accentColor: 'var(--accent-emerald)' }} />
                      <div>
                        <div className="text-[12px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{mode === 'subscription' ? 'Claude Code Subscription' : 'Anthropic API Key'}</div>
                        <div className="text-[9px]" style={{ color: 'var(--fg-muted)' }}>{mode === 'subscription' ? 'Uses your Claude Max/Pro subscription' : 'Pay-per-use with your own API key'}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {data.claudeMode === 'sdk' && (
                <div>
                  <label style={labelStyle}>Anthropic API Key</label>
                  <input type="password" value={data.apiKey} onChange={e => update({ apiKey: e.target.value })} style={inputStyle} placeholder="sk-ant-..." />
                </div>
              )}
            </div>
          )}

          {/* Step 4: Brain Init */}
          {step === 4 && (
            <div className="space-y-3">
              <p className="text-[13px]" style={{ color: 'var(--fg-secondary)', fontFamily: 'var(--font-sans)', fontWeight: 300 }}>
                The brain will be initialized when your agent is created. This includes:
              </p>
              {['data/ directory for databases', 'Entity graph (SQLite)', 'Timeline index (SQLite)', 'ChromaDB vector store (Docker)', 'Brain notes directory', 'Heartbeat scheduler'].map(item => (
                <div key={item} className="flex items-center gap-2 pl-2">
                  <span style={{ color: 'var(--accent-emerald)' }}>{'\u2713'}</span>
                  <span className="text-[11px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-secondary)' }}>{item}</span>
                </div>
              ))}
            </div>
          )}

          {/* Step 5: Cloud Sync */}
          {step === 5 && (
            <div className="space-y-4">
              <p className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Optional: Connect to Kybernesis Cloud for cross-device sync.</p>
              <div>
                <label style={labelStyle}>Kybernesis API Key (optional)</label>
                <input type="password" value={data.kybernesisKey} onChange={e => update({ kybernesisKey: e.target.value })} style={inputStyle} placeholder="Leave blank to skip" />
              </div>
            </div>
          )}

          {/* Step 6: Remote Access */}
          {step === 6 && (
            <div className="space-y-4">
              <p className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Optional: Enable remote access via ngrok tunnel.</p>
              <div>
                <label style={labelStyle}>ngrok Auth Token (optional)</label>
                <input type="password" value={data.ngrokToken} onChange={e => update({ ngrokToken: e.target.value })} style={inputStyle} placeholder="Leave blank to skip" />
              </div>
            </div>
          )}

          {/* Step 7: Channels */}
          {step === 7 && (
            <div className="space-y-4">
              <p className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Optional: Connect messaging channels.</p>
              <div>
                <label style={labelStyle}>Telegram Bot Token (optional)</label>
                <input value={data.telegramToken} onChange={e => update({ telegramToken: e.target.value })} style={inputStyle} placeholder="Get from @BotFather on Telegram" />
              </div>
              <label className="flex items-center gap-3 p-3 border cursor-pointer" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
                <input type="checkbox" checked={data.whatsappEnabled} onChange={e => update({ whatsappEnabled: e.target.checked })} style={{ accentColor: 'var(--accent-emerald)' }} />
                <div>
                  <div className="text-[12px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>Enable WhatsApp</div>
                  <div className="text-[9px]" style={{ color: 'var(--fg-muted)' }}>Requires QR code scan after setup</div>
                </div>
              </label>
            </div>
          )}

          {/* Step 8: Backup */}
          {step === 8 && (
            <div className="space-y-4">
              <p className="text-[11px]" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Optional: Configure GitHub backup.</p>
              <div>
                <label style={labelStyle}>GitHub Repo URL (optional)</label>
                <input value={data.backupUrl} onChange={e => update({ backupUrl: e.target.value })} style={inputStyle} placeholder="https://github.com/user/my-agent.git" />
              </div>
              {data.backupUrl && (
                <div>
                  <label style={labelStyle}>Branch</label>
                  <input value={data.backupBranch} onChange={e => update({ backupBranch: e.target.value })} style={inputStyle} />
                </div>
              )}
            </div>
          )}

          {/* Step 9: Summary */}
          {step === 9 && (
            <div className="space-y-3">
              <p className="text-[13px] mb-4" style={{ color: 'var(--fg-secondary)', fontFamily: 'var(--font-sans)', fontWeight: 300 }}>
                Review your configuration and launch your agent.
              </p>
              {[
                ['Agent', data.agentName],
                ['Directory', data.agentRoot],
                ['User', data.userName],
                ['Timezone', data.timezone],
                ['Claude Mode', data.claudeMode],
                ['Telegram', data.telegramToken ? 'Configured' : 'Skipped'],
                ['WhatsApp', data.whatsappEnabled ? 'Enabled' : 'Skipped'],
                ['Backup', data.backupUrl || 'Skipped'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between py-1 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <span className="text-[9px] tracking-[1px] uppercase" style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{label}</span>
                  <span className="text-[11px]" style={{ color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>{value || '—'}</span>
                </div>
              ))}
              {error && <div className="p-2 border text-[11px]" style={{ borderColor: 'var(--status-error)', color: 'var(--status-error)', fontFamily: 'var(--font-mono)' }}>{error}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      {step > 0 && (
        <div className="px-6 py-4 flex items-center justify-between border-t" style={{ borderColor: 'var(--border-color)' }}>
          <button onClick={prev} disabled={step <= 1} className="px-4 py-2 text-[9px] tracking-[1px] uppercase border" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--border-color)', color: 'var(--fg-secondary)', background: 'transparent', cursor: step <= 1 ? 'default' : 'pointer', opacity: step <= 1 ? 0.3 : 1 }}>Back</button>
          {step < 9 ? (
            <button onClick={next} disabled={step === 1 && (!data.agentRoot || !data.agentName)} className="px-4 py-2 text-[9px] tracking-[1px] uppercase border" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)', background: 'transparent', cursor: 'pointer', opacity: step === 1 && (!data.agentRoot || !data.agentName) ? 0.3 : 1 }}>Next</button>
          ) : (
            <button onClick={handleCreate} disabled={creating} className="px-6 py-2 text-[9px] tracking-[1px] uppercase border" style={{ fontFamily: 'var(--font-mono)', borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)', background: 'rgba(16,185,129,0.1)', cursor: creating ? 'default' : 'pointer' }}>
              {creating ? 'Creating...' : 'Launch Agent'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
