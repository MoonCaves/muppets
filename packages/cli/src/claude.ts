/**
 * KyberBot — Claude Abstraction Layer
 *
 * Four routes:
 *   1. completion — LiteLLM HTTP via OpenAI-compatible client (Phase 1+ default for brain).
 *      Set `caller` (e.g. 'brain') and the call routes to LiteLLM unless
 *      `_transport: 'subprocess'` is set explicitly.
 *   2. Agent SDK — Uses @anthropic-ai/claude-code (subscription users)
 *   3. SDK — Direct Anthropic API calls (requires ANTHROPIC_API_KEY)
 *   4. Subprocess — Spawns `claude -p` (default for user-facing chat
 *      that hits the subscription path)
 *
 * All brain AI operations go through this layer.
 */

import { spawn } from 'child_process';
import { getAgentNameForRoot, getClaudeMode, getClaudeModel, getClaudeModelForRoot, getRoot, isFleetMode } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('claude');

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Caller identifies which subsystem invoked completion. Open pattern
 * (`KnownCaller | (string & {})`) — closed unions fight the architectural
 * goal "any LLM on any process". An ESLint rule + runtime metric track
 * unknown caller values; promotion path is documented in
 * `brain/litellm-phase1-callers.md`.
 */
export type KnownCaller = 'brain' | 'subagent' | 'skill' | 'eval';

/**
 * Underscored override — set to `'subprocess'` to keep a call on the legacy
 * Claude Code subscription path even when `caller` is set. Set to
 * `'completion'` to force LiteLLM HTTP. Underscored to signal escape-hatch
 * status; usage outside `claude.ts` and `debug/` is flagged by the ESLint
 * `no-restricted-syntax` rule and emits a runtime warn log on every call.
 */
export type Transport = 'subprocess' | 'completion';

export interface CompleteOptions {
  /**
   * Model identifier. Two shapes:
   *   - Legacy short names ('haiku' | 'sonnet' | 'opus') for subprocess path.
   *   - LiteLLM alias names ('haiku' | 'brain-fast' | …) for the completion
   *     path. Open string so new aliases don't require a code change here.
   */
  model?: string;
  system?: string;
  maxTokens?: number;
  maxTurns?: number;
  /** Callback for stdout chunks as they arrive (streaming, subprocess only). */
  onChunk?: (chunk: string) => void;
  /**
   * Force subprocess mode for this call. Each invocation runs in an
   * isolated child process whose memory is reclaimed on exit.
   * Equivalent to `_transport: 'subprocess'` — kept for back-compat.
   */
  subprocess?: boolean;
  /**
   * Working directory for the spawned `claude` process. Claude Code
   * attributes session files to the project corresponding to this
   * directory. In fleet mode the parent process has one CWD shared
   * across many agents, so without this option every agent's Haiku
   * calls land in the same project dir. Callers that know which
   * agent's work is being done (sleep steps, heartbeat, channel
   * handlers, bus handler, store-conversation) should pass the
   * agent's root here. Used by subprocess CWD AND completion metadata
   * (agent_root + agent_name derivation).
   */
  cwd?: string;

  // ──────────────────────────────────────────────────────────────────────
  // Phase 1 LiteLLM — completion-route fields
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Subsystem invoking completion. Required for completion route. Brain
   * sites pass 'brain'. Sub-agents pass 'subagent'. Skills pass 'skill'.
   * Eval harness passes 'eval'. New string values are accepted (open
   * pattern) but flagged by lint + runtime metric.
   */
  caller?: KnownCaller | (string & {});

  /**
   * Dotted-hyphen call site for observability. Convention:
   * `<subsystem>.<function-or-pass>`, lowercase. Examples:
   * `brain.fact-extractor`, `brain.reasoning-pass1`, `brain.observe`,
   * `skill.daily-task-reminder`. Forwarded to LiteLLM `metadata.call_site`.
   */
  callSite?: string;

  /**
   * Underscored escape hatch. `'completion'` → LiteLLM HTTP.
   * `'subprocess'` → legacy `claude -p` spawn. When unset, routing is
   * driven by `caller`: any caller routes to completion. Lint flags
   * usage outside claude.ts/debug/.
   */
  _transport?: Transport;
}

/**
 * Allowlist used by lint + runtime metric. Adding a value here means it
 * stops being a "warn on unknown caller" hit and is promoted to first-class.
 */
export const KNOWN_CALLERS: readonly KnownCaller[] = Object.freeze([
  'brain',
  'subagent',
  'skill',
  'eval',
]);

// Model ID mapping
const MODEL_IDS: Record<string, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
};

/**
 * LiteLLM proxy URL. Default points at production. Override with
 * LITELLM_BRAIN_URL for staging/local.
 */
function getLitellmBaseUrl(): string {
  return process.env.LITELLM_BRAIN_URL || 'https://ai-api.remotelyhuman.com/v1';
}

function getLitellmApiKey(): string | undefined {
  return process.env.LITELLM_BRAIN_KEY;
}

/**
 * Derive the agent name for completion metadata. Reads identity.yaml at
 * `cwd` (preferred) or falls back to basename(cwd) without `-agent` suffix.
 */
function deriveAgentName(cwd: string | undefined): string {
  if (!cwd) return 'unknown';
  try {
    return getAgentNameForRoot(cwd);
  } catch {
    const parts = cwd.replace(/\/+$/, '').split('/');
    const base = parts[parts.length - 1] || 'unknown';
    return base.replace(/-agent$/, '') || base;
  }
}

export class ClaudeClient {
  private mode: 'agent-sdk' | 'sdk' | 'subprocess';
  private sdk: any | null = null;
  private litellm: any | null = null;
  private litellmInitFailed = false;

  constructor() {
    const configMode = getClaudeMode();

    if (configMode === 'agent-sdk') {
      // All callers use subprocess: true, so don't load the Agent SDK
      // into the long-lived server process — it leaks hundreds of MB.
      // The SDK is only needed for in-process query() calls, which we
      // no longer make. Subprocess mode spawns `claude -p` instead.
      this.mode = 'subprocess';
      logger.debug('Using subprocess mode (agent-sdk disabled for memory safety)');
    } else if (configMode === 'sdk') {
      this.mode = 'sdk';
      this.initSDK();
    } else {
      this.mode = 'subprocess';
    }
  }

  private async initSDK(): Promise<void> {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      this.sdk = new Anthropic();
      logger.debug('Initialized in SDK mode');
    } catch {
      logger.warn('Failed to initialize SDK, falling back to subprocess mode');
      this.mode = 'subprocess';
    }
  }

  /**
   * Single completion — fire and forget prompt
   */
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    // Always resolve model — never let subprocess/agent-sdk fall back to CLI defaults.
    //
    // Fleet-mode resolution rules:
    //  1. Explicit opts.model wins (caller knows best).
    //  2. Else, if opts.cwd is given, resolve via the per-root model. Channel
    //     handlers, sleep steps, heartbeat, store-conversation, and the bus
    //     handler all pass cwd: this.root, so this is the normal path.
    //  3. Else, in fleet mode, throw — there is no safe singleton fallback.
    //     Falling back to getClaudeModel() would silently route every agent
    //     to whichever identity loaded last in the FleetManager process.
    //  4. Outside fleet mode (terminal/CLI/single-agent), the legacy soft
    //     fallback to getClaudeModel() is preserved.
    if (!opts.model) {
      if (opts.cwd) {
        opts.model = getClaudeModelForRoot(opts.cwd) as 'haiku' | 'sonnet' | 'opus';
      } else if (isFleetMode()) {
        throw new Error(
          'ClaudeClient.complete() called in fleet mode without opts.model and ' +
          'without opts.cwd. Cannot resolve which agent\'s model to use without ' +
          'one of them. Caller fix: pass `cwd: this.root` (preferred) or ' +
          '`model: getClaudeModelForRoot(this.root)`. Refusing to fall back to ' +
          'the singleton getClaudeModel() — that path collapses every agent ' +
          'onto whichever identity loaded last.'
        );
      } else {
        opts.model = (getClaudeModel() || 'opus') as 'haiku' | 'sonnet' | 'opus';
      }
    }

    // All server-process calls should use subprocess for memory isolation.
    // SDK mode is only for direct API calls (ANTHROPIC_API_KEY users).
    if (this.mode === 'sdk' && this.sdk && !opts.subprocess) {
      return this.completeSDK(prompt, opts.model, opts);
    }
    return this.completeSubprocess(prompt, opts);
  }

  /**
   * Multi-turn chat
   */
  async chat(messages: Message[], system: string): Promise<string> {
    const model = (getClaudeModel() || 'opus') as 'haiku' | 'sonnet' | 'opus';

    if (this.mode === 'sdk' && this.sdk) {
      return this.chatSDK(messages, system, model);
    }
    // Subprocess mode: flatten into a single prompt with history
    const historyPrompt = messages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    const fullPrompt = `${system}\n\n${historyPrompt}`;
    return this.completeSubprocess(fullPrompt, { model });
  }

  private async completeSDK(
    prompt: string,
    model: string,
    opts: CompleteOptions
  ): Promise<string> {
    const modelId = MODEL_IDS[model] || MODEL_IDS.opus;
    const response = await this.sdk.messages.create({
      model: modelId,
      max_tokens: opts.maxTokens || 4096,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b: any) => b.type === 'text');
    return textBlock?.text || '';
  }

  private async chatSDK(
    messages: Message[],
    system: string,
    model: string
  ): Promise<string> {
    const modelId = MODEL_IDS[model] || MODEL_IDS.opus;
    const response = await this.sdk.messages.create({
      model: modelId,
      max_tokens: 4096,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    const textBlock = response.content.find((b: any) => b.type === 'text');
    return textBlock?.text || '';
  }

  private completeSubprocess(prompt: string, opts: CompleteOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      // Use stream-json format when onChunk is provided for live output
      const useStreamJson = !!opts.onChunk;
      const args = ['--print', '-'];
      args.push('--dangerously-skip-permissions'); // Always skip — subprocesses are headless, no human to prompt
      if (useStreamJson) {
        args.push('--output-format', 'stream-json', '--verbose');
      }
      if (opts.system) {
        args.push('--system-prompt', opts.system);
      }
      if (opts.model) {
        args.push('--model', opts.model);
      }
      if (opts.maxTurns) {
        args.push('--max-turns', String(opts.maxTurns));
      }

      // Pipe prompt via stdin instead of CLI args to avoid ARG_MAX limits
      // (large conversation histories + system prompts easily exceed 256KB)
      const proc = spawn('claude', args, {
        env: {
          ...process.env,
          // Must unset CLAUDECODE to avoid Claude Code detecting nested invocation
          CLAUDECODE: '',
          CLAUDE_CODE_ENTRYPOINT: '',
        },
        // cwd determines which ~/.claude/projects/<slug> dir Claude Code
        // writes this session's .jsonl to. Without this, every agent's
        // brain/sleep/heartbeat calls in fleet mode attribute to the same
        // dir (the fleet process's cwd). Callers pass the agent's root.
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (proc.stdin) {
        proc.stdin.write(prompt);
        proc.stdin.end();
      }

      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let stdoutBytes = 0;
      const MAX_STDOUT = 2 * 1024 * 1024; // 2MB cap — subprocess responses should be small

      let stdoutDestroyed = false;
      proc.stdout.on('data', (data: Buffer) => {
        stdoutBytes += data.length;
        if (stdoutBytes <= MAX_STDOUT) {
          chunks.push(data);
          // Stream callback for live log capture
          if (opts.onChunk) {
            try { opts.onChunk(data.toString()); } catch { /* ignore */ }
          }
        } else if (!stdoutDestroyed) {
          // Destroy the read stream to stop reading entirely.
          // Without this, rapid data arrival floods GC with temporary Buffers.
          stdoutDestroyed = true;
          proc.stdout.destroy();
          logger.warn(`Subprocess stdout exceeded ${MAX_STDOUT / 1024 / 1024}MB — stream destroyed`);
        }
      });
      proc.stderr.on('data', (data: Buffer) => { errChunks.push(data); });

      proc.on('close', (code) => {
        const chunksBytes = chunks.reduce((sum, c) => sum + c.length, 0);
        const errBytes = errChunks.reduce((sum, c) => sum + c.length, 0);
        logger.info('subprocess:close', { code, stdoutBytes: chunksBytes, stderrBytes: errBytes, totalStdoutRead: stdoutBytes, destroyed: stdoutDestroyed, heapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) });
        const stdout = Buffer.concat(chunks).toString().trim();
        const stderr = Buffer.concat(errChunks).toString();
        // Clear references immediately to let GC reclaim buffers
        chunks.length = 0;
        errChunks.length = 0;
        stdoutBytes = 0;

        if (code === 0) {
          if (useStreamJson) {
            // Parse stream-json: extract the final result text from JSONL
            // The last line with type "result" has the final text
            let resultText = '';
            for (const line of stdout.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const event = JSON.parse(trimmed);
                if (event.type === 'result' && event.result) {
                  resultText = event.result;
                } else if (event.type === 'assistant' && event.message?.content) {
                  // Accumulate assistant text blocks
                  for (const block of event.message.content) {
                    if (block.type === 'text') resultText = block.text;
                  }
                }
              } catch { /* not valid JSON — skip */ }
            }
            resolve(resultText || stdout);
          } else {
            resolve(stdout);
          }
        } else {
          logger.error(`claude subprocess exited with code ${code}`, { stderr: stderr.slice(0, 500) });
          reject(new Error(`claude subprocess failed: ${stderr.slice(0, 500) || `exit code ${code}`}`));
        }
      });

      proc.on('error', (err) => {
        chunks.length = 0;
        errChunks.length = 0;
        reject(new Error(`Failed to spawn claude: ${err.message}. Is Claude Code installed?`));
      });
    });
  }
}

// Singleton
let _client: ClaudeClient | null = null;

export function getClaudeClient(): ClaudeClient {
  if (!_client) {
    _client = new ClaudeClient();
  }
  return _client;
}
