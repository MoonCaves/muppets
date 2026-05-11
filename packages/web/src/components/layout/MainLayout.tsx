import { useEffect } from 'react';
import Header, { getAgentEmoji } from './Header';
import Sidebar from './Sidebar';
import { formatModelName } from '../../utils/model';
import ChatArea from '../chat/ChatArea';
import ChatInput from '../chat/ChatInput';
import { useChat } from '../../hooks/useChat';
import { useIdentity } from '../../hooks/useIdentity';
import { useMemoryBlocks } from '../../hooks/useMemoryBlocks';
import { useStatus } from '../../hooks/useStatus';

interface MainLayoutProps {
  token: string | null;
}

export default function MainLayout({ token: _token }: MainLayoutProps) {
  const { identity, loading: identityLoading, updateIdentity } = useIdentity();
  const { blocks, loading: blocksLoading, saving: blocksSaving, saveBlock, refresh: refreshBlocks, BLOCK_META, BLOCKS } = useMemoryBlocks();
  const status = useStatus();
  const {
    messages, isStreaming, streamingText, streamingStatus, streamingTools,
    currentSession, sendMessage, loadSession, startNewSession,
  } = useChat();

  const agentName = identity?.agent_name || 'KyberBot';

  // Auto-refresh memory blocks when a chat message has memoryUpdates
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'assistant' && lastMsg.memoryUpdates && lastMsg.memoryUpdates.length > 0) {
      refreshBlocks();
    }
  }, [messages, refreshBlocks]);

  return (
    <div className="h-screen flex flex-col bg-[#F0EFEA] dark:bg-[#0a0a0a] transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col flex-1 min-h-0 w-full">
        <Header
          agentName={agentName}
          showSettings={true}
          onToggleSettings={() => {}}
        />

        <div className="flex gap-6 flex-1 min-h-0 min-w-0">
          {/* Chat Interface */}
          <div className={`flex-1 min-w-0 border bg-white dark:bg-[#0a0a0a] flex flex-col ${isStreaming ? 'streaming-pulse' : 'border-slate-300 dark:border-white/10'}`}>
            {/* Chat Header */}
            <div className="border-b border-slate-200 dark:border-white/10 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 border border-violet-500/30 dark:border-violet-400/30 bg-violet-500/10 dark:bg-violet-400/10 flex items-center justify-center">
                  <span className="text-xl leading-none select-none">
                    {getAgentEmoji(agentName)}
                  </span>
                </div>
                <div>
                  <h2
                    className="text-lg text-slate-800 dark:text-white/90"
                    style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
                  >
                    {agentName}
                  </h2>
                  <p className="text-[9px] text-slate-500 dark:text-white/40 tracking-[1px] font-mono">
                    {formatModelName(identity?.claude?.model)}
                  </p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <ChatArea
              messages={messages}
              isStreaming={isStreaming}
              streamingText={streamingText}
              streamingStatus={streamingStatus}
              streamingTools={streamingTools}
              agentName={agentName}
            />

            {/* Input */}
            <ChatInput
              onSend={sendMessage}
              disabled={isStreaming}
              agentName={agentName}
            />
          </div>

          {/* Settings Sidebar */}
          <Sidebar
            identity={identity}
            identityLoading={identityLoading}
            onUpdateIdentity={updateIdentity}
            blocks={blocks}
            blocksLoading={blocksLoading}
            blocksSaving={blocksSaving}
            onSaveBlock={saveBlock}
            blockMeta={BLOCK_META}
            blockNames={BLOCKS}
            status={status}
            currentSessionId={currentSession?.id}
            onSelectSession={loadSession}
            onNewSession={startNewSession}
          />
        </div>
      </div>
    </div>
  );
}
