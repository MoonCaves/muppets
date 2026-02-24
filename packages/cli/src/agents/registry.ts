/**
 * KyberBot — Agent Registry
 *
 * Builds the agent section for CLAUDE.md and handles agent removal.
 * The actual CLAUDE.md rebuild is handled by skills/registry.ts which
 * imports and uses these functions.
 */

import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { paths } from '../config.js';
import { InstalledAgent } from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('agents');

/**
 * Build the agent section content for CLAUDE.md
 */
export function buildAgentSection(agents: InstalledAgent[]): string {
  if (agents.length === 0) return '';

  const lines = agents.map(agent => {
    return `- **${agent.name}** (${agent.model}) — ${agent.description} [${agent.role}]`;
  });

  return lines.join('\n');
}

/**
 * Remove an agent file.
 * Caller is responsible for triggering CLAUDE.md rebuild (to avoid circular deps).
 */
export function removeAgent(name: string): boolean {
  const agentPath = join(paths.agents, `${name}.md`);

  if (!existsSync(agentPath)) {
    return false;
  }

  rmSync(agentPath, { force: true });

  logger.info(`Removed agent: ${name}`);
  return true;
}
