/**
 * KyberBot Desktop — Root App Component
 */

import { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import TitleBar from './components/layout/TitleBar';
import TabBar, { type TabId } from './components/layout/TabBar';
import DashboardView from './components/dashboard/DashboardView';
import ChatView from './components/chat/ChatView';
import SkillsView from './components/skills/SkillsView';
import ChannelsView from './components/channels/ChannelsView';
import HeartbeatView from './components/heartbeat/HeartbeatView';
import SettingsView from './components/settings/SettingsView';
import BrainView from './components/brain/BrainView';
import OnboardingWizard from './components/onboarding/OnboardingWizard';

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { isReady, agentRoot } = useApp();

  if (!isReady) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <span style={{ fontSize: '11px', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>Loading...</span>
      </div>
    );
  }

  if (!agentRoot) {
    if (showOnboarding) {
      return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
          <TitleBar />
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <OnboardingWizard onComplete={() => window.location.reload()} />
          </div>
        </div>
      );
    }

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        <TitleBar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
          <span className="section-title" style={{ color: 'var(--accent-emerald)', marginBottom: '16px' }}>{'// WELCOME TO KYBERBOT'}</span>
          <p style={{ fontSize: '13px', textAlign: 'center', maxWidth: '28rem', marginBottom: '32px', color: 'var(--fg-secondary)', fontFamily: 'var(--font-sans)', fontWeight: 300 }}>
            Create a new agent from scratch, or open an existing agent directory.
          </p>
          <div style={{ display: 'flex', gap: '16px' }}>
            <button onClick={() => setShowOnboarding(true)} style={{ padding: '12px 24px', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', border: '1px solid var(--accent-emerald)', color: 'var(--accent-emerald)', background: 'transparent', cursor: 'pointer' }}>Create New Agent</button>
            <button onClick={async () => { const kb = (window as any).kyberbot; const result = await kb.config.selectAgentRoot(); if (result?.hasIdentity) window.location.reload(); else if (result) alert('No identity.yaml found.'); }} style={{ padding: '12px 24px', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)', border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)', background: 'transparent', cursor: 'pointer' }}>Open Existing Agent</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <TitleBar />
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'chat' && <ChatView />}
        {activeTab === 'skills' && <SkillsView />}
        {activeTab === 'channels' && <ChannelsView />}
        {activeTab === 'heartbeat' && <HeartbeatView />}
        {activeTab === 'brain' && <BrainView />}
        {activeTab === 'settings' && <SettingsView />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
