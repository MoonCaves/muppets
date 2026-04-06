/**
 * Remember Command
 *
 * Stores a conversation or piece of information in the memory pipeline.
 *
 * Strategy:
 * 1. Try the running server's /remember API (lightweight HTTP POST — no
 *    heavy modules loaded, reuses the server's already-initialized
 *    ChromaDB/OpenAI/entity-graph connections)
 * 2. Fall back to direct storeConversation() if server isn't available
 *
 * This prevents OOM crashes when `kyberbot remember` is called as a
 * Bash tool from Claude Code, which would otherwise spawn a second
 * full kyberbot process loading the entire memory pipeline again.
 */

import { Command } from 'commander';
import { getRoot, getServerPort } from '../config.js';

async function handleRemember(
  text: string,
  options: { response?: string; channel?: string }
) {
  const channel = options.channel || 'terminal';
  const response = options.response || '';

  // Try the running server's API first (avoids loading heavy modules)
  if (await tryServerRemember(text, response, channel)) {
    console.log(`Stored in memory (channel: ${channel})`);
    console.log(`  Text: ${text.length > 80 ? text.slice(0, 77) + '...' : text}`);
    return;
  }

  // Fall back to direct storage (loads full pipeline — last resort)
  try {
    const root = getRoot();
    const { storeConversation } = await import('../brain/store-conversation.js');

    await storeConversation(root, { prompt: text, response, channel });

    console.log(`Stored in memory (channel: ${channel})`);
    console.log(`  Text: ${text.length > 80 ? text.slice(0, 77) + '...' : text}`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

/**
 * Try to store via the running server's /remember endpoint.
 * This reuses the server's already-initialized memory pipeline
 * (ChromaDB client, OpenAI client, SQLite connections) instead of
 * loading everything from scratch in a new process.
 */
async function tryServerRemember(text: string, response: string, channel: string): Promise<boolean> {
  try {
    const port = getServerPort();
    const token = process.env.KYBERBOT_API_TOKEN;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`http://localhost:${port}/api/web/manage/remember`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, response, channel }),
      signal: AbortSignal.timeout(30_000), // 30s timeout for heavy operations
    });

    if (res.ok) return true;

    // Server returned an error — fall through to direct storage
    return false;
  } catch {
    // Server not running or unreachable — fall through
    return false;
  }
}

export function createRememberCommand(): Command {
  return new Command('remember')
    .description('Store a memory in the brain (timeline, entity graph, embeddings)')
    .argument('<text>', 'The text to remember (conversation prompt or note)')
    .option('-r, --response <text>', 'Optional response/context to pair with the prompt')
    .option('-c, --channel <name>', 'Channel label (default: terminal)', 'terminal')
    .action(handleRemember);
}
