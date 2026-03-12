export interface ToolCall {
  id: string;
  name: string;
  label: string;
  detail: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  costUsd?: number;
  toolCalls?: ToolCall[];
  memoryUpdates?: string[];
}

export interface MemoryBlock {
  name: string;
  label: string;
  content: string;
  lastModified: string;
}

export interface IdentityConfig {
  agent_name: string;
  agent_description?: string;
  timezone: string;
  heartbeat_interval: string;
  server?: { port?: number };
  claude?: { mode?: string; model?: string };
  channels?: {
    telegram?: { bot_token?: string };
    whatsapp?: { enabled?: boolean };
  };
}

export interface ServiceStatus {
  agent: string;
  uptime: number;
  timestamp: string;
}

export interface ChatSSEEvent {
  type: 'init' | 'text' | 'result' | 'error' | 'keepalive' | 'status' | 'tool_start' | 'tool_end';
  data: Record<string, unknown>;
}

export interface UsageStats {
  messages: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}
