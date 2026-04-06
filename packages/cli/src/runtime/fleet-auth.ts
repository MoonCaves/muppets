/**
 * KyberBot — Fleet Authentication Middleware
 *
 * Provides Express middleware that supports multi-agent token validation.
 * For /agent/:name/* routes, checks against that agent's token.
 * For root-level routes, checks against all agents (backward compat).
 */

import { Request, Response, NextFunction } from 'express';
import { loadTokenForRoot } from '../middleware/auth.js';
import { createLogger } from '../logger.js';

const logger = createLogger('fleet-auth');

/**
 * Extract bearer token from Authorization header.
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

/**
 * Create fleet-aware auth middleware.
 * Agents map: name → { root, apiToken }.
 */
export function createFleetAuthMiddleware(
  agents: Map<string, { root: string; apiToken: string }>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    // No token configured anywhere — allow all (development mode)
    if (agents.size === 0) {
      return next();
    }

    const token = extractBearerToken(req);

    // Check if token matches any agent
    if (token) {
      for (const [name, agent] of agents) {
        if (token === agent.apiToken) {
          // Attach agent context to request
          (req as any).agentName = name;
          (req as any).agentRoot = agent.root;
          return next();
        }
      }
    }

    // No valid token — check if any agent requires auth
    const anyTokenRequired = [...agents.values()].some(a => a.apiToken);
    if (!anyTokenRequired) {
      return next();
    }

    // Auth failed
    const isLocal = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
    if (isLocal) {
      logger.debug('Fleet auth failed from localhost', { path: req.path });
    } else {
      logger.warn('Fleet auth failed', { path: req.path, ip: req.ip });
    }

    res.status(401).json({ error: 'Unauthorized', message: 'Invalid API token' });
  };
}
