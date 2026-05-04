/**
 * KyberBot — Shared Types
 *
 * Core type definitions used across the application.
 */

export interface ServiceStatus {
  name: string;
  status: 'running' | 'starting' | 'stopped' | 'error' | 'disabled';
  extra?: string;
}

export interface ServiceHandle {
  stop: () => Promise<void>;
  status: () => ServiceStatus['status'];
}

export interface ServiceConfig {
  name: string;
  enabled: boolean;
  start: () => Promise<ServiceHandle>;
}

export interface IdentityConfig {
  agent_name: string;
  agent_description?: string;
  kyberbot_version?: string;
  timezone: string;
  locale?: string;
  heartbeat_interval: string;
  heartbeat_active_hours?: {
    start: string;
    end: string;
    timezone?: string;
  };
  /**
   * Model used for heartbeat and orchestration (CEO/worker) Claude calls.
   * Defaults to 'sonnet' if unset — heartbeat is tool-use orchestration,
   * not deep reasoning, so running Opus there is wasteful. The agent's
   * main chat still uses `claude.model` (Opus by default).
   */
  heartbeat_model?: 'haiku' | 'sonnet' | 'opus';
  server?: {
    port: number;
    host?: string;
  };
  channels?: {
    telegram?: {
      bot_token: string;
      owner_chat_id?: number;
    };
    whatsapp?: { enabled: boolean };
  };
  kybernesis?: {
    agent_id: string;
    workspace_id: string;
  };
  tunnel?: {
    enabled: boolean;
    provider?: string;
  };
  backup?: {
    enabled: boolean;
    remote_url: string;
    schedule: string;
    branch?: string;
  };
  claude?: {
    mode: 'subscription' | 'sdk';
    model?: string;
  };
  memory?: {
    entity_stoplist?: string[];
  };
  subscriptions?: Array<{
    from: string;
    topic: string;
  }>;
  watched_folders?: Array<{
    path: string;
    label?: string;
    enabled?: boolean;
    extensions?: string[];
  }>;
  /**
   * Symphony §8.5 stall timeout — a heartbeat run is killed if it goes
   * this many ms without a phase transition. Default 5 minutes.
   * Set to 0 to disable stall detection.
   */
  heartbeat_stall_timeout_ms?: number;
  /**
   * Shell hooks fired around the worker run lifecycle. Scripts run as
   * `bash -lc <script>` in the agent's root with KYBERBOT_ISSUE_ID,
   * KYBERBOT_AGENT, and KYBERBOT_RUN_STATUS env vars.
   */
  hooks?: {
    after_create?: string;
    before_run?: string;
    after_run?: string;
    before_remove?: string;
    timeout_ms?: number;
  };
  /**
   * Per-agent concurrency limits. `max_concurrent_runs` caps the number
   * of simultaneously running heartbeats for this agent. `max_by_state`
   * caps the number of issues this agent will work in each issue state
   * (e.g. `{ todo: 3, in_progress: 1 }`). Both default to 1.
   */
  concurrency?: {
    max_concurrent_runs?: number;
    max_by_state?: Record<string, number>;
  };
  /**
   * Symphony §7.1 worker-loop limit. After each turn that ends with
   * STATUS: IN_PROGRESS, the worker re-prompts the agent with the tail
   * of its previous output as context, up to this many turns within a
   * single run. Defaults to 5. Set to 1 to disable the loop. Inner Claude
   * SDK turns (tool-use rounds within one call) are unaffected.
   */
  worker_max_turns?: number;
}
