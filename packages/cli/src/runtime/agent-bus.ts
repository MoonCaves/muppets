/**
 * KyberBot — Agent Bus
 *
 * In-process message bus for inter-agent communication.
 * Agents register handlers and can send messages to each other.
 *
 * Phase 5 wires actual message handling. This stub exists from Phase 3
 * so AgentRuntime can hold a reference without rebuilds later.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createLogger } from '../logger.js';
import { saveBusMessage, loadBusHistory } from './bus-db.js';

const logger = createLogger('agent-bus');

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface AgentMessage {
  id: string;
  from: string;
  to: string; // agent name or '*' for broadcast
  type: 'query' | 'notify' | 'delegate' | 'response';
  topic?: string;
  payload: string;
  replyTo?: string;
  depth?: number;
  timestamp: string;
}

export type AgentMessageHandler = (msg: AgentMessage) => Promise<string>;

// ═══════════════════════════════════════════════════════════════════════════════
// BUS
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentBus extends EventEmitter {
  private history: AgentMessage[] = [];
  private handlers = new Map<string, AgentMessageHandler>();
  private sendCounts = new Map<string, { count: number; resetAt: number }>();
  private readonly MAX_SENDS_PER_HOUR = 10;
  private pendingNotifications = new Map<string, AgentMessage[]>();
  private subscriptions: Array<{ subscriber: string; from: string; topic: string }> = [];

  registerAgent(name: string, handler: AgentMessageHandler): void {
    this.handlers.set(name, handler);
    logger.info(`Agent "${name}" registered on bus`);
  }

  unregisterAgent(name: string): void {
    this.handlers.delete(name);
    logger.info(`Agent "${name}" unregistered from bus`);
  }

  getRegisteredAgents(): string[] {
    return [...this.handlers.keys()];
  }

  async send(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<AgentMessage | null> {
    // Rate limiting
    const now = Date.now();
    const limit = this.sendCounts.get(message.from) || { count: 0, resetAt: now + 3600_000 };
    if (now > limit.resetAt) {
      limit.count = 0;
      limit.resetAt = now + 3600_000;
    }
    if (limit.count >= this.MAX_SENDS_PER_HOUR) {
      logger.warn(`Rate limit: ${message.from} exceeded ${this.MAX_SENDS_PER_HOUR} sends/hour`);
      return null;
    }
    limit.count++;
    this.sendCounts.set(message.from, limit);

    const msg: AgentMessage = {
      ...message,
      id: randomUUID(),
      depth: (message as any).depth || 0,
      timestamp: new Date().toISOString(),
    };

    // Persist to SQLite
    try { saveBusMessage(msg); } catch (err) {
      logger.error('Failed to persist bus message', { error: String(err) });
    }

    this.history.push(msg);
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
    this.emit('message', msg);

    if (msg.to === '*') {
      // Broadcast — notify all agents except sender
      for (const [name, handler] of this.handlers) {
        if (name !== msg.from && name !== msg.from.toLowerCase()) {
          handler(msg).catch((err) =>
            logger.error(`Bus delivery to ${name} failed`, { error: String(err) })
          );
        }
      }
      return null;
    }

    // Direct message (case-insensitive lookup)
    const handler = this.handlers.get(msg.to) || this.handlers.get(msg.to.toLowerCase());
    if (!handler) {
      logger.warn(`Agent "${msg.to}" not found on bus`, { registered: [...this.handlers.keys()] });
      return null;
    }

    const responseText = await handler(msg);

    const response: AgentMessage = {
      id: randomUUID(),
      from: msg.to,
      to: msg.from,
      type: 'response',
      payload: responseText,
      replyTo: msg.id,
      depth: msg.depth,
      timestamp: new Date().toISOString(),
    };

    // Persist response to SQLite
    try { saveBusMessage(response); } catch (err) {
      logger.error('Failed to persist bus response', { error: String(err) });
    }

    this.history.push(response);
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
    this.emit('message', response);

    // Check topic subscriptions — queue notifications for subscribers
    this.checkSubscriptions(msg);

    return response;
  }

  getHistory(limit?: number): AgentMessage[] {
    try {
      return loadBusHistory({ limit: limit || 50 });
    } catch {
      // Fall back to in-memory cache if DB unavailable
      return this.history.slice(-(limit || 50));
    }
  }

  // ── Subscriptions ──

  subscribe(subscriber: string, from: string, topic: string): void {
    this.subscriptions.push({ subscriber, from, topic });
    logger.info(`${subscriber} subscribed to ${topic} from ${from}`);
  }

  unsubscribeAll(subscriber: string): void {
    this.subscriptions = this.subscriptions.filter(s => s.subscriber !== subscriber);
  }

  getSubscriptions(subscriber?: string): Array<{ subscriber: string; from: string; topic: string }> {
    if (subscriber) return this.subscriptions.filter(s => s.subscriber === subscriber);
    return [...this.subscriptions];
  }

  // ── Notification Queue ──

  private checkSubscriptions(msg: AgentMessage): void {
    for (const sub of this.subscriptions) {
      if (sub.subscriber === msg.from) continue;
      if (sub.subscriber === msg.to) continue;
      const fromMatch = sub.from === '*' || sub.from.toLowerCase() === msg.from.toLowerCase();
      const topicMatch = !msg.topic || sub.topic === msg.topic;
      if (fromMatch && topicMatch) {
        this.queueNotification(sub.subscriber, msg);
      }
    }
  }

  private queueNotification(agent: string, msg: AgentMessage): void {
    const pending = this.pendingNotifications.get(agent) || [];
    pending.push(msg);
    this.pendingNotifications.set(agent, pending);
    logger.debug(`Queued notification for ${agent} from ${msg.from}`);
  }

  getPendingNotifications(agent: string): AgentMessage[] {
    const pending = this.pendingNotifications.get(agent) || [];
    this.pendingNotifications.delete(agent);
    return pending;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVE BUS SINGLETON
// ═══════════════════════════════════════════════════════════════════════════════

let _activeBus: AgentBus | null = null;

export function setActiveBus(bus: AgentBus | null): void {
  _activeBus = bus;
}

export function getActiveBus(): AgentBus | null {
  return _activeBus;
}
