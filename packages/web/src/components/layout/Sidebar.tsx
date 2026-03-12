import type { IdentityConfig, ServiceStatus as ServiceStatusType } from '../../api/types';
import AgentConfig from '../sidebar/AgentConfig';
import MemoryBlocks from '../sidebar/MemoryBlocks';
import RecentConversations from '../sidebar/RecentConversations';
import ServiceStatus from '../sidebar/ServiceStatus';

interface SidebarProps {
  identity: IdentityConfig | null;
  identityLoading: boolean;
  onUpdateIdentity: (changes: Partial<IdentityConfig>) => Promise<void>;
  blocks: Record<string, { content: string; lastModified: string }>;
  blocksLoading: boolean;
  blocksSaving: boolean;
  onSaveBlock: (name: string, content: string) => Promise<void>;
  blockMeta: Record<string, { label: string; description: string; filename: string; color: string }>;
  blockNames: readonly string[];
  status: ServiceStatusType | null;
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export default function Sidebar({
  identity,
  identityLoading,
  onUpdateIdentity,
  blocks,
  blocksLoading,
  blocksSaving,
  onSaveBlock,
  blockMeta,
  blockNames,
  status,
  currentSessionId,
  onSelectSession,
  onNewSession,
}: SidebarProps) {
  return (
    <div className="w-80 space-y-4 overflow-y-auto sidebar-scroll">
      <AgentConfig identity={identity} loading={identityLoading} onUpdate={onUpdateIdentity} />
      <MemoryBlocks
        blocks={blocks}
        loading={blocksLoading}
        saving={blocksSaving}
        onSave={onSaveBlock}
        blockMeta={blockMeta}
        blockNames={blockNames}
      />
      <RecentConversations
        currentSessionId={currentSessionId}
        onSelectSession={onSelectSession}
        onNewSession={onNewSession}
      />
      <ServiceStatus status={status} />
    </div>
  );
}
