/**
 * KyberBot — Agent Router
 *
 * Creates an Express router with all routes scoped to a specific agent root.
 * Used by both single-agent mode (server/index.ts) and fleet mode (FleetManager).
 */

import express, { Router } from 'express';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createBrainRouter } from './brain-api.js';
import { createWebApiRouter } from './web-api.js';
import { createManagementRouter } from './management-api.js';
import { chatSseHandler } from './chat-sse.js';
import { executeHandler } from './execute-api.js';
import { Channel } from './channels/types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('agent-router');

/**
 * Create an Express router with all agent-specific routes.
 * Every route within this router operates in the context of the given root.
 */
export function createAgentRouter(root: string, channels: Channel[]): Router {
  const router = Router();

  // Brain API
  router.use('/brain', createBrainRouter(root));

  // Execute API
  router.post('/api/execute', executeHandler);

  // Chat SSE — must be before the web router
  router.post('/api/web/chat', (req, res) => chatSseHandler(req, res, root));

  // Web API
  router.use('/api/web', createWebApiRouter(root));

  // Management API
  router.use('/api/web/manage', createManagementRouter(channels, root));

  // Serve web UI static files
  try {
    const webDistPaths = [
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'web', 'dist'),
      join(process.cwd(), 'node_modules', '@kyberbot', 'web', 'dist'),
    ];

    for (const distPath of webDistPaths) {
      if (existsSync(join(distPath, 'index.html'))) {
        router.use('/ui', express.static(distPath));
        router.get('/ui/*', (_req, res) => {
          res.sendFile(join(distPath, 'index.html'));
        });
        logger.debug(`Web UI available from ${distPath}`);
        break;
      }
    }
  } catch (err) {
    logger.debug('Web UI not available', { error: String(err) });
  }

  return router;
}
