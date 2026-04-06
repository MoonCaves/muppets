/**
 * KyberBot — Agent Runtime
 *
 * Encapsulates a single agent's services within a shared process.
 * Each AgentRuntime holds its own root, identity, channels, heartbeat,
 * and creates an Express sub-router for its API endpoints.
 */

import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../logger.js';
import { getIdentityForRoot } from '../config.js';
import { initializeEmbeddings } from '../brain/embeddings.js';
import { createAgentRouter } from '../server/agent-router.js';
import { TelegramChannel } from '../server/channels/telegram.js';
import { WhatsAppChannel } from '../server/channels/whatsapp.js';
import { Channel } from '../server/channels/types.js';
import { ServiceHandle } from '../types.js';
import { IdentityConfig } from '../types.js';
import { AgentBus } from './agent-bus.js';

const logger = createLogger('agent-runtime');

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface AgentRuntimeConfig {
  root: string;
  name: string;
  identity: IdentityConfig;
  enableHeartbeat?: boolean;
  enableChannels?: boolean;
  bus?: AgentBus;
}

export interface AgentRuntimeStatus {
  name: string;
  root: string;
  status: 'running' | 'stopped' | 'error';
  services: {
    heartbeat: 'running' | 'stopped' | 'disabled';
    channels: { name: string; connected: boolean }[];
    embeddings: 'running' | 'disabled';
  };
  uptime: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUNTIME
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentRuntime {
  readonly root: string;
  readonly name: string;
  readonly identity: IdentityConfig;
  readonly apiToken: string;

  private heartbeat: ServiceHandle | null = null;
  private channels: Channel[] = [];
  private bus: AgentBus | null = null;
  private startedAt = 0;
  private _status: 'running' | 'stopped' | 'error' = 'stopped';
  private embeddingsReady = false;

  constructor(config: AgentRuntimeConfig) {
    this.root = config.root;
    this.name = config.name;
    this.identity = config.identity;
    this.bus = config.bus || null;

    // Load API token from .env
    this.apiToken = this.loadApiToken();
  }

  /**
   * Start agent services (heartbeat, channels, embeddings).
   * Sleep is NOT started here — it's managed by FleetSleepScheduler.
   */
  async start(): Promise<void> {
    logger.info(`Starting agent: ${this.name}`, { root: this.root });
    this.startedAt = Date.now();

    // Initialize embeddings collection for this agent
    try {
      this.embeddingsReady = await initializeEmbeddings(this.root);
    } catch (error) {
      logger.warn(`Embeddings init failed for ${this.name}`, { error: String(error) });
    }

    // Start heartbeat if not disabled
    const enableHeartbeat = this.identity.heartbeat_interval !== 'disabled';
    if (enableHeartbeat) {
      try {
        const { startHeartbeat } = await import('../services/heartbeat.js');
        this.heartbeat = await startHeartbeat(this.root);
        logger.info(`Heartbeat started for ${this.name}`);
      } catch (error) {
        logger.warn(`Heartbeat start failed for ${this.name}`, { error: String(error) });
      }
    }

    // Start channels if configured
    try {
      if (this.identity.channels?.telegram?.bot_token) {
        const telegram = new TelegramChannel(this.identity.channels.telegram, this.root);
        await telegram.start();
        this.channels.push(telegram);
      }

      if (this.identity.channels?.whatsapp?.enabled) {
        const whatsapp = new WhatsAppChannel(this.root);
        await whatsapp.start();
        this.channels.push(whatsapp);
      }
    } catch (error) {
      logger.warn(`Channel init failed for ${this.name}`, { error: String(error) });
    }

    // Register on the agent bus for inter-agent messaging
    if (this.bus) {
      this.bus.registerAgent(this.name, async (msg) => {
        // For now, just acknowledge — full Claude Code response is a future enhancement
        logger.info(`[bus] ${this.name} received from ${msg.from}: ${msg.payload.slice(0, 100)}`);

        // Store the inter-agent message in memory
        try {
          const { storeConversation } = await import('../brain/store-conversation.js');
          await storeConversation(this.root, {
            prompt: `[From ${msg.from}]: ${msg.payload}`,
            response: `[Acknowledged by ${this.name}]`,
            channel: 'agent-bus',
            metadata: { from: msg.from, type: msg.type, topic: msg.topic },
          });
        } catch { /* best effort */ }

        return `[${this.name}] Message received.`;
      });
    }

    this._status = 'running';
    logger.info(`Agent ${this.name} started`, {
      heartbeat: this.heartbeat ? 'running' : 'disabled',
      channels: this.channels.map(c => c.name),
      embeddings: this.embeddingsReady,
    });
  }

  /**
   * Stop all agent services.
   */
  async stop(): Promise<void> {
    logger.info(`Stopping agent: ${this.name}`);

    // Stop heartbeat
    if (this.heartbeat) {
      await this.heartbeat.stop();
      this.heartbeat = null;
    }

    // Stop channels
    for (const channel of this.channels) {
      try {
        await channel.stop();
      } catch (error) {
        logger.error(`Failed to stop ${channel.name} for ${this.name}`, { error: String(error) });
      }
    }
    this.channels = [];

    // Unregister from bus
    if (this.bus) {
      this.bus.unregisterAgent(this.name);
    }

    this._status = 'stopped';
    logger.info(`Agent ${this.name} stopped`);
  }

  /**
   * Create an Express sub-router for this agent's API endpoints.
   */
  createRouter(): Router {
    return createAgentRouter(this.root, this.channels);
  }

  /**
   * Get current status.
   */
  getStatus(): AgentRuntimeStatus {
    return {
      name: this.name,
      root: this.root,
      status: this._status,
      services: {
        heartbeat: this.heartbeat
          ? (this.heartbeat.status() as 'running' | 'stopped')
          : 'disabled',
        channels: this.channels.map(c => ({
          name: c.name,
          connected: c.isConnected(),
        })),
        embeddings: this.embeddingsReady ? 'running' : 'disabled',
      },
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  /**
   * Load API token from agent's .env file.
   */
  private loadApiToken(): string {
    const envPath = join(this.root, '.env');
    if (!existsSync(envPath)) return '';

    try {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('KYBERBOT_API_TOKEN=')) {
          let value = trimmed.slice('KYBERBOT_API_TOKEN='.length).trim();
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          return value;
        }
      }
    } catch {
      // .env read failed
    }
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLEET AWARENESS HELPER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a system prompt section that makes an agent aware of other running agents.
 * Can be injected into prompt building to enable inter-agent coordination.
 */
export function buildFleetAwarenessSection(bus: AgentBus, currentAgent: string): string {
  const others = bus.getRegisteredAgents().filter(n => n !== currentAgent);
  if (others.length === 0) return '';

  return `\n## Other Agents\n\nAgents running alongside you: ${others.join(', ')}.\n` +
    `To send a message: \`kyberbot bus send <agent> "<message>"\`\n` +
    `To broadcast: \`kyberbot bus broadcast "<message>"\`\n`;
}
