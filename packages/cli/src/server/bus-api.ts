/**
 * KyberBot — Bus API Router
 *
 * HTTP endpoints for receiving bus messages from remote agents/fleet.
 * Mounted on every agent (standalone or fleet) at /api/bus/*.
 */

import { Router } from 'express';
import { createLogger } from '../logger.js';
import { handleIncomingBusMessage } from '../runtime/bus-handler.js';
import { getIdentityForRoot } from '../config.js';
import { storeConversation } from '../brain/store-conversation.js';
import type { AgentMessage } from '../runtime/agent-bus.js';

const logger = createLogger('bus-api');

// Fleet connection — set when a fleet server registers with this agent
let _fleetUrl: string | null = null;
let _fleetToken: string | null = null;

export function getFleetConnection(): { url: string; token: string } | null {
  if (_fleetUrl && _fleetToken) return { url: _fleetUrl, token: _fleetToken };
  return null;
}

export function setFleetConnection(url: string, token: string): void {
  _fleetUrl = url;
  _fleetToken = token;
  logger.info('Fleet connection registered', { url });
}

export function createBusApiRouter(root: string): Router {
  const router = Router();

  let agentName = 'unknown';
  try {
    agentName = getIdentityForRoot(root).agent_name || 'unknown';
  } catch {}

  // POST /api/bus/receive — accept message from fleet or remote agent
  router.post('/receive', async (req, res) => {
    const { message } = req.body as { message: AgentMessage };

    if (!message || !message.from || !message.payload) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    logger.info(`Bus message received from ${message.from}: ${message.payload.slice(0, 80)}`);

    try {
      const response = await handleIncomingBusMessage(root, agentName, message);

      // Store the conversation in memory
      try {
        await storeConversation(root, {
          prompt: `[From ${message.from}]: ${message.payload}`,
          response,
          channel: 'agent-bus',
          metadata: { from: message.from, type: message.type, topic: message.topic },
        });
      } catch { /* best effort */ }

      res.json({ ok: true, response });
    } catch (error) {
      logger.error('Bus message handling failed', { error: String(error) });
      res.status(500).json({ error: 'Message handling failed' });
    }
  });

  // POST /api/bus/register-fleet — fleet server registers its URL with this agent
  router.post('/register-fleet', (req, res) => {
    const { fleetUrl, fleetToken } = req.body;
    if (!fleetUrl) {
      return res.status(400).json({ error: 'Missing fleetUrl' });
    }
    setFleetConnection(fleetUrl, fleetToken || '');
    res.json({ ok: true });
  });

  // GET /api/bus/fleet-connection — check if a fleet is registered
  router.get('/fleet-connection', (_req, res) => {
    const conn = getFleetConnection();
    res.json({ connected: !!conn, url: conn?.url || null });
  });

  return router;
}
