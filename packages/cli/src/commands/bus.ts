/**
 * Bus Command
 *
 * Inter-agent messaging via the fleet server's AgentBus API.
 *
 * Usage:
 *   kyberbot bus send <agent> "<message>"     # Send a message to a specific agent
 *   kyberbot bus broadcast "<message>"        # Broadcast to all agents
 *   kyberbot bus history                       # Show recent message history
 *   kyberbot bus history --agent nova          # Filter history by agent
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getServerPort, getAgentName as getConfigAgentName } from '../config.js';

const PRIMARY = chalk.hex('#10b981');
const ACCENT = chalk.hex('#22d3ee');
const DIM = chalk.dim;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getFleetPort(): number {
  try {
    return getServerPort();
  } catch {
    return 3456;
  }
}

function getApiToken(): string {
  return process.env.KYBERBOT_API_TOKEN || '';
}

function getCurrentAgentName(): string {
  try {
    return getConfigAgentName();
  } catch {
    return 'unknown';
  }
}

async function fleetFetch(
  path: string,
  options: RequestInit = {},
  timeoutMs: number = 5000,
): Promise<Response> {
  const port = getFleetPort();
  const token = getApiToken();
  const url = `http://localhost:${port}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

export function createBusCommand(): Command {
  const bus = new Command('bus')
    .description('Inter-agent messaging via the fleet bus');

  // ─────────────────────────────────────────────────────────────
  // bus send <agent> <message>
  // ─────────────────────────────────────────────────────────────
  bus
    .command('send <agent> <message>')
    .description('Send a message to a specific agent')
    .option('-t, --topic <topic>', 'Message topic for routing')
    .option('-f, --from <name>', 'Sender name (defaults to current agent)')
    .action(async (agent: string, message: string, options: { topic?: string; from?: string }) => {
      const from = options.from || getCurrentAgentName();

      try {
        console.log(DIM(`Sending to ${agent}... (waiting for Claude response)`));
        const res = await fleetFetch('/fleet/bus/send', {
          method: 'POST',
          body: JSON.stringify({
            from,
            to: agent,
            message,
            topic: options.topic,
          }),
        }, 120_000);  // 2 min timeout — Claude needs time to think

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
          console.error(chalk.red(`Error: ${body.error || res.statusText}`));
          process.exit(1);
        }

        const data = await res.json() as { ok: boolean; response: { payload: string } | null };

        console.log();
        console.log(PRIMARY.bold('  Message sent'));
        console.log();
        console.log(`  ${DIM('From:')}    ${ACCENT(from)}`);
        console.log(`  ${DIM('To:')}      ${ACCENT(agent)}`);
        if (options.topic) {
          console.log(`  ${DIM('Topic:')}   ${options.topic}`);
        }
        console.log(`  ${DIM('Message:')} ${message}`);

        if (data.response) {
          console.log();
          console.log(`  ${DIM('Response:')} ${data.response.payload}`);
        }
        console.log();
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.error(chalk.red('Error: Fleet server not responding (timeout)'));
        } else {
          console.error(chalk.red(`Error: Could not reach fleet server. Is it running?`));
          console.error(DIM(`  Try: kyberbot fleet start`));
        }
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────
  // bus broadcast <message>
  // ─────────────────────────────────────────────────────────────
  bus
    .command('broadcast <message>')
    .description('Broadcast a message to all agents')
    .option('-t, --topic <topic>', 'Message topic for routing')
    .option('-f, --from <name>', 'Sender name (defaults to current agent)')
    .action(async (message: string, options: { topic?: string; from?: string }) => {
      const from = options.from || getCurrentAgentName();

      try {
        console.log(DIM(`Broadcasting... (waiting for agent responses)`));
        const res = await fleetFetch('/fleet/bus/broadcast', {
          method: 'POST',
          body: JSON.stringify({
            from,
            message,
            topic: options.topic,
          }),
        }, 120_000);

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
          console.error(chalk.red(`Error: ${body.error || res.statusText}`));
          process.exit(1);
        }

        console.log();
        console.log(PRIMARY.bold('  Broadcast sent'));
        console.log();
        console.log(`  ${DIM('From:')}    ${ACCENT(from)}`);
        console.log(`  ${DIM('To:')}      ${ACCENT('all agents')}`);
        if (options.topic) {
          console.log(`  ${DIM('Topic:')}   ${options.topic}`);
        }
        console.log(`  ${DIM('Message:')} ${message}`);
        console.log();
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.error(chalk.red('Error: Fleet server not responding (timeout)'));
        } else {
          console.error(chalk.red(`Error: Could not reach fleet server. Is it running?`));
          console.error(DIM(`  Try: kyberbot fleet start`));
        }
        process.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────
  // bus history
  // ─────────────────────────────────────────────────────────────
  bus
    .command('history')
    .description('Show recent bus message history')
    .option('-a, --agent <name>', 'Filter by agent name')
    .option('-l, --limit <n>', 'Number of messages to show', '20')
    .action(async (options: { agent?: string; limit?: string }) => {
      const limit = parseInt(options.limit || '20') || 20;

      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (options.agent) {
          params.set('agent', options.agent);
        }

        const res = await fleetFetch(`/fleet/bus/history?${params.toString()}`);

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
          console.error(chalk.red(`Error: ${body.error || res.statusText}`));
          process.exit(1);
        }

        const data = await res.json() as {
          messages: Array<{
            id: string;
            from: string;
            to: string;
            type: string;
            topic?: string;
            payload: string;
            replyTo?: string;
            timestamp: string;
          }>;
        };

        console.log();
        if (data.messages.length === 0) {
          console.log(DIM('  No messages on the bus yet.'));
          console.log();
          return;
        }

        console.log(PRIMARY.bold('  Bus Message History'));
        if (options.agent) {
          console.log(DIM(`  Filtered by: ${options.agent}`));
        }
        console.log();

        for (const msg of data.messages) {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          const direction = msg.to === '*' ? 'broadcast' : `-> ${msg.to}`;
          const typeLabel = msg.type === 'response' ? chalk.gray('[reply]') : '';
          const topicLabel = msg.topic ? chalk.gray(` [${msg.topic}]`) : '';

          console.log(
            `  ${DIM(time)} ${ACCENT(msg.from)} ${direction}${topicLabel} ${typeLabel}`
          );
          console.log(`    ${msg.payload.slice(0, 120)}${msg.payload.length > 120 ? '...' : ''}`);
          console.log();
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.error(chalk.red('Error: Fleet server not responding (timeout)'));
        } else {
          console.error(chalk.red(`Error: Could not reach fleet server. Is it running?`));
          console.error(DIM(`  Try: kyberbot fleet start`));
        }
        process.exit(1);
      }
    });

  return bus;
}
