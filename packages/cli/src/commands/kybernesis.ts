/**
 * Kybernesis Command
 *
 * Cloud brain interface — query and manage the Kybernesis cloud memory.
 *
 * Usage:
 *   kyberbot kybernesis query "What do you know about X?"
 *   kyberbot kybernesis status
 */

import { Command } from 'commander';
import { getKybernesisConfig } from '../config.js';
import { createLogger } from '../logger.js';

const logger = createLogger('kybernesis');

const KYBERNESIS_API_BASE = 'https://api.kybernesis.ai/v1';

// ═══════════════════════════════════════════════════════════════════════════════
// API CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

interface KybernesisResponse {
  message?: string;
  response?: string;
  error?: string;
}

async function queryKybernesis(agentId: string, apiKey: string, message: string): Promise<string> {
  const url = `${KYBERNESIS_API_BASE}/agents/${agentId}/chat`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kybernesis API error (${response.status}): ${text}`);
  }

  const data = await response.json() as KybernesisResponse;
  return data.response || data.message || JSON.stringify(data);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function handleQuery(message: string) {
  try {
    const config = getKybernesisConfig();

    if (!config) {
      console.log('Kybernesis is not configured.');
      console.log('');
      console.log('To connect:');
      console.log('  1. Add KYBERNESIS_API_KEY to .env');
      console.log('  2. Add kybernesis.agent_id to identity.yaml');
      console.log('');
      console.log('Or run `kyberbot onboard` to set up interactively.');
      process.exit(1);
    }

    logger.debug(`Querying Kybernesis agent ${config.agentId}`);
    const response = await queryKybernesis(config.agentId, config.apiKey, message);
    console.log(response);
  } catch (error) {
    console.error(`Error querying Kybernesis: ${error}`);
    process.exit(1);
  }
}

async function handleStatus() {
  try {
    const config = getKybernesisConfig();

    if (!config) {
      console.log('Kybernesis: not configured');
      console.log('');
      console.log('Add KYBERNESIS_API_KEY to .env and kybernesis.agent_id to identity.yaml.');
      return;
    }

    console.log('Kybernesis: configured');
    console.log(`  Agent ID: ${config.agentId}`);
    console.log(`  API key: ${config.apiKey.slice(0, 8)}...`);

    // Test connectivity
    try {
      const response = await queryKybernesis(config.agentId, config.apiKey, 'ping');
      console.log('  Status: connected');
    } catch (error) {
      console.log(`  Status: error (${error})`);
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

export function createKybernesisCommand(): Command {
  const cmd = new Command('kybernesis')
    .description('Kybernesis cloud brain — query and manage cloud memory');

  cmd
    .command('query')
    .description('Ask the cloud brain a question')
    .argument('<message>', 'Question or query for the cloud brain')
    .action(handleQuery);

  cmd
    .command('status')
    .description('Check Kybernesis connection status')
    .action(handleStatus);

  return cmd;
}
