/**
 * KyberBot — Fleet Manager
 *
 * Orchestrates multiple AgentRuntime instances in a single Node.js process.
 * One Express server, one port, agent-namespaced routes.
 */

import express from 'express';
import http from 'http';
import { createLogger } from '../logger.js';
import { getIdentityForRoot } from '../config.js';
import { loadRegistry } from '../registry.js';
import { AgentRuntime, AgentRuntimeStatus } from './agent-runtime.js';
import { AgentBus } from './agent-bus.js';
import { FleetSleepScheduler } from './fleet-sleep-scheduler.js';
import { createFleetAuthMiddleware } from './fleet-auth.js';
import { getMetrics, errorMiddleware } from '../monitoring.js';

const logger = createLogger('fleet');

export class FleetManager {
  private agents = new Map<string, AgentRuntime>();
  private server: http.Server | null = null;
  private app: express.Express | null = null;
  private sleepScheduler: FleetSleepScheduler | null = null;
  private tunnelHandle: { stop: () => Promise<void>; status: () => string } | null = null;
  private bus: AgentBus;
  private startedAt = 0;

  constructor() {
    this.bus = new AgentBus();
  }

  /**
   * Load agents from registry.
   * If names is provided, loads only those agents. Otherwise loads auto_start or all.
   */
  async loadAgents(names?: string[]): Promise<void> {
    const registry = loadRegistry();
    const allNames = Object.keys(registry.agents);

    if (allNames.length === 0) {
      throw new Error('No agents registered. Run `kyberbot fleet register` first.');
    }

    const toLoad = names || registry.defaults?.auto_start || allNames;

    for (const name of toLoad) {
      const entry = registry.agents[name];
      if (!entry) {
        throw new Error(`Agent "${name}" not found in registry.`);
      }

      const identity = getIdentityForRoot(entry.root);
      const runtime = new AgentRuntime({
        root: entry.root,
        name,
        identity,
        bus: this.bus,
      });

      this.agents.set(name, runtime);
      logger.info(`Loaded agent: ${name}`, { root: entry.root });
    }
  }

  /**
   * Start all loaded agents and the shared server.
   */
  async start(port: number = 3456): Promise<void> {
    this.startedAt = Date.now();

    // Start each agent's services (heartbeat, channels, embeddings)
    for (const [name, agent] of this.agents) {
      try {
        await agent.start();
      } catch (error) {
        logger.error(`Failed to start agent ${name}`, { error: String(error) });
      }
    }

    // Build auth lookup
    const authMap = new Map<string, { root: string; apiToken: string }>();
    for (const [name, agent] of this.agents) {
      authMap.set(name, { root: agent.root, apiToken: agent.apiToken });
    }

    // Create Express server
    this.app = express();
    this.app.use(express.json());

    // Fleet-level routes (no auth required for health)
    this.app.get('/health', (_req, res) => {
      const metrics = getMetrics();
      const statuses = this.getAllStatuses();
      const allHealthy = statuses.every(s => s.status === 'running');

      res.json({
        status: allHealthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: metrics.uptime_human,
        mode: 'fleet',
        agents: statuses.map(s => ({
          name: s.name,
          status: s.status,
          services: s.services,
        })),
        sleep: {
          currentAgent: this.sleepScheduler?.getCurrentAgent() || null,
          running: this.sleepScheduler?.isRunning() || false,
        },
        memory: metrics.memory,
        pid: metrics.pid,
      });
    });

    this.app.get('/fleet', (_req, res) => {
      const uptimeMs = Date.now() - this.startedAt;
      const uptimeSec = Math.floor(uptimeMs / 1000);
      const h = Math.floor(uptimeSec / 3600);
      const m = Math.floor((uptimeSec % 3600) / 60);
      const uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

      const statuses = this.getAllStatuses();

      res.json({
        mode: 'fleet',
        agents: statuses.map(s => ({
          name: s.name,
          status: s.status,
          uptime: `${Math.floor(s.uptime / 1000)}s`,
          services: [
            { name: 'ChromaDB', status: s.services.embeddings === 'running' ? 'running' : 'disabled' },
            { name: 'Server', status: s.status },
            { name: 'Heartbeat', status: s.services.heartbeat },
            { name: 'Sleep Agent', status: this.sleepScheduler?.isRunning() ? 'running' : 'disabled' },
            { name: 'Channels', status: s.services.channels.length > 0 ? 'running' : 'disabled' },
            { name: 'Tunnel', status: s.status === 'running' && this.agents.get(s.name)?.identity.tunnel?.enabled ? 'stopped' : 'disabled' },
          ],
          channels: s.services.channels,
        })),
        sleep: {
          current_agent: this.sleepScheduler?.getCurrentAgent() || null,
          last_run: null,
        },
        uptime: uptimeStr,
        pid: process.pid,
      });
    });

    // Fleet management API
    this.app.post('/fleet/agents', express.json(), async (req, res) => {
      const { name, root } = req.body;
      if (!name || !root) {
        return res.status(400).json({ error: 'Missing name or root' });
      }
      try {
        await this.addAgent(name, root);
        res.json({ ok: true, agent: this.getAgentStatus(name) });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    this.app.delete('/fleet/agents/:name', async (req, res) => {
      try {
        await this.removeAgent(req.params.name);
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // ── Bus API ──────────────────────────────────────────────────────────

    // POST /fleet/bus/send — send message between agents
    this.app.post('/fleet/bus/send', express.json(), async (req, res) => {
      const { from, to, message, topic } = req.body;
      if (!from || !to || !message) {
        return res.status(400).json({ error: 'Missing from, to, or message' });
      }
      try {
        const result = await this.bus.send({ from, to, type: 'query', payload: message, topic });
        res.json({ ok: true, response: result });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // POST /fleet/bus/broadcast — broadcast to all agents
    this.app.post('/fleet/bus/broadcast', express.json(), async (req, res) => {
      const { from, message, topic } = req.body;
      if (!from || !message) {
        return res.status(400).json({ error: 'Missing from or message' });
      }
      try {
        await this.bus.send({ from, to: '*', type: 'notify', payload: message, topic });
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // GET /fleet/bus/history — message history
    this.app.get('/fleet/bus/history', (req, res) => {
      const limit = parseInt(req.query.limit as string) || 50;
      const agent = req.query.agent as string;
      let history = this.bus.getHistory(limit);
      if (agent) {
        history = history.filter(m => m.from === agent || m.to === agent);
      }
      res.json({ messages: history });
    });

    // Per-agent routes with auth
    const fleetAuth = createFleetAuthMiddleware(authMap);

    for (const [name, agent] of this.agents) {
      this.app.use(`/agent/${name}`, fleetAuth, agent.createRouter());
    }

    // Backward compat: if only 1 agent, mount at root too
    if (this.agents.size === 1) {
      const [, agent] = [...this.agents.entries()][0];
      this.app.use('/', fleetAuth, agent.createRouter());
    }

    // Error middleware
    this.app.use(errorMiddleware);

    // Start server
    this.server = http.createServer(this.app);
    await new Promise<void>((resolve) => {
      this.server!.listen(port, () => {
        logger.info(`Fleet server listening on port ${port}`);
        logger.info(`Agents: ${[...this.agents.keys()].join(', ')}`);

        if (this.agents.size === 1) {
          logger.info('Single-agent mode — root routes available');
        } else {
          logger.info('Multi-agent mode — use /agent/{name}/* routes');
        }

        resolve();
      });
    });

    // Start sleep scheduler
    const sleepRoots = new Map<string, string>();
    for (const [name, agent] of this.agents) {
      sleepRoots.set(name, agent.root);
    }
    this.sleepScheduler = new FleetSleepScheduler(sleepRoots);
    // Start in background (don't await — it runs indefinitely)
    this.sleepScheduler.start().catch((err) =>
      logger.error('Sleep scheduler error', { error: String(err) })
    );

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down fleet...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /**
   * Stop everything.
   */
  async stop(): Promise<void> {
    // Stop sleep scheduler
    if (this.sleepScheduler) {
      this.sleepScheduler.stop();
      this.sleepScheduler = null;
    }

    // Stop all agents
    for (const [name, agent] of this.agents) {
      try {
        await agent.stop();
      } catch (error) {
        logger.error(`Failed to stop agent ${name}`, { error: String(error) });
      }
    }

    // Stop server
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }

    logger.info('Fleet stopped');
  }

  /**
   * Hot-add an agent to the running fleet.
   */
  async addAgent(name: string, root: string): Promise<void> {
    if (this.agents.has(name)) {
      throw new Error(`Agent "${name}" is already running`);
    }

    const identity = getIdentityForRoot(root);
    const runtime = new AgentRuntime({
      root,
      name,
      identity,
      bus: this.bus,
    });

    await runtime.start();
    this.agents.set(name, runtime);

    // Add route
    if (this.app) {
      const authMap = new Map<string, { root: string; apiToken: string }>();
      authMap.set(name, { root, apiToken: runtime.apiToken });
      this.app.use(`/agent/${name}`, createFleetAuthMiddleware(authMap), runtime.createRouter());
    }

    // Add to sleep scheduler
    if (this.sleepScheduler) {
      this.sleepScheduler.addAgent(name, root);
    }

    logger.info(`Hot-added agent: ${name}`);
  }

  /**
   * Hot-remove an agent from the running fleet.
   */
  async removeAgent(name: string): Promise<void> {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent "${name}" is not running`);
    }

    await agent.stop();
    this.agents.delete(name);

    // Remove from sleep scheduler
    if (this.sleepScheduler) {
      this.sleepScheduler.removeAgent(name);
    }

    // Note: Express doesn't support route removal, but the agent router
    // will return 404s since the agent is stopped. Acceptable for v1.

    logger.info(`Removed agent: ${name}`);
  }

  getAgentStatus(name: string): AgentRuntimeStatus | null {
    return this.agents.get(name)?.getStatus() || null;
  }

  getAllStatuses(): AgentRuntimeStatus[] {
    return [...this.agents.values()].map(a => a.getStatus());
  }

  getAgentNames(): string[] {
    return [...this.agents.keys()];
  }
}
