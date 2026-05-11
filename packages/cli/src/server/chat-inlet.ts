/**
 * KyberBot — Chat-Inlet
 *
 * Exposes POST /v1/chat/completions so Open WebUI (and other OpenAI-compatible
 * clients) can point at this server instead of a paid proxy.
 *
 * Routes through the kyberbot subprocess (claude CLI) — no Anthropic API key
 * required beyond the Claude Code subscription already in use.
 *
 * ── ENV VARS ──────────────────────────────────────────────────────────────────
 * CHAT_INLET_TOKEN  (required)
 *   A random bearer token that Open WebUI (or any OpenAI-compatible client)
 *   must send in the Authorization header:
 *       Authorization: Bearer <CHAT_INLET_TOKEN>
 *   Generate with: openssl rand -hex 32
 *   Add to the KyberBot .env file (same directory as identity.yaml).
 *   All requests lacking this token receive a 401 with an OpenAI-shape error.
 *
 * ── Phase progression ─────────────────────────────────────────────────────────
 *   Step 2  — stub response, hard-coded body, proves the route wires up.
 *   Step 3  — bearer-auth middleware (CHAT_INLET_TOKEN env var).
 *   Step 6  — Open WebUI wiring + model dropdown.
 *   Step 7  — rate-limit, error mapping, README, handoff.
 *   NOTE: Step 5 (SSE streaming, 0e5354c) is committed but may not be wired
 *         correctly — tests mock @anthropic-ai/sdk directly while the impl
 *         routes through getClaudeClient() subprocess. Needs validation pass.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger.js';
import { getClaudeClient } from '../claude.js';

const logger = createLogger('chat-inlet');

// ── Model mapping ──────────────────────────────────────────────────────────────
// Maps OpenAI model names (and friendly short-names) to kyberbot model names.
const MODEL_MAP: Record<string, 'haiku' | 'sonnet' | 'opus'> = {
  'haiku':  'haiku',
  'sonnet': 'sonnet',
  'opus':   'opus',
  'claude-haiku-4-5':  'haiku',
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-7':   'opus',
  'gpt-3.5-turbo':       'haiku',
  'gpt-3.5-turbo-16k':   'haiku',
  'gpt-4':               'sonnet',
  'gpt-4o':              'sonnet',
  'gpt-4o-mini':         'haiku',
  'gpt-4-turbo':         'opus',
  'gpt-4-turbo-preview': 'opus',
};

const DEFAULT_MODEL: 'haiku' | 'sonnet' | 'opus' = 'haiku';

// Models surfaced on GET /v1/models
const AVAILABLE_MODELS = [
  { id: 'claude-haiku-4-5',  description: 'Fast and compact' },
  { id: 'claude-sonnet-4-6', description: 'Balanced capability' },
  { id: 'claude-opus-4-7',   description: 'Most capable' },
  { id: 'haiku',  description: 'Alias → claude-haiku-4-5' },
  { id: 'sonnet', description: 'Alias → claude-sonnet-4-6' },
  { id: 'opus',   description: 'Alias → claude-opus-4-7' },
];

// ── OpenAI request types ───────────────────────────────────────────────────────

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChatRequest {
  model?: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  stream?: boolean;
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

/**
 * Flatten an OpenAI messages array into a single prompt string for the
 * kyberbot subprocess. System messages are prepended; user/assistant turns
 * are formatted as "Human: …" / "Assistant: …" pairs matching the pattern
 * used elsewhere in kyberbot's chat history handling.
 */
function buildPrompt(messages: OpenAIMessage[]): string {
  const systemParts: string[] = [];
  const convParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else {
      convParts.push(`${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`);
    }
  }

  const parts: string[] = [];
  if (systemParts.length > 0) parts.push(systemParts.join('\n\n'));
  if (convParts.length > 0) parts.push(convParts.join('\n\n'));

  return parts.join('\n\n');
}

// ── Auth middleware ────────────────────────────────────────────────────────────

function chatInletAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inletToken = process.env.CHAT_INLET_TOKEN;

  if (!inletToken) {
    logger.warn('CHAT_INLET_TOKEN not set — chat-inlet is locked until the env var is configured');
    res.status(401).json({
      error: {
        message: 'Chat-Inlet is not configured: CHAT_INLET_TOKEN env var is missing. Set it in .env and restart KyberBot.',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
    return;
  }

  const authHeader = req.headers['authorization'] ?? '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (provided !== inletToken) {
    logger.warn('Chat-Inlet auth failure', { ip: req.ip });
    res.status(401).json({
      error: {
        message: 'Invalid token. Check the Authorization: Bearer <CHAT_INLET_TOKEN> header.',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
    return;
  }

  next();
}

// ── Route handlers ─────────────────────────────────────────────────────────────

/**
 * POST /v1/chat/completions (stream: true) — SSE path.
 *
 * complete() returns the full response as a string. We emit it as a minimal
 * three-chunk SSE sequence so Open WebUI's streaming consumer works correctly:
 *
 *   1. Role-announcement chunk  { delta: { role: "assistant", content: "" } }
 *   2. Content chunk            { delta: { content: "<full response>" } }
 *   3. Final chunk              { delta: {}, finish_reason: "stop" }
 *   4. Sentinel                 data: [DONE]
 */
async function chatCompletionsStreamHandler(
  req: Request,
  res: Response,
  model: 'haiku' | 'sonnet' | 'opus',
  prompt: string,
  root: string,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const completionId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const requestedModel = (req.body as OpenAIChatRequest).model ?? DEFAULT_MODEL;

  function sendChunk(delta: Record<string, unknown>, finishReason: string | null = null): void {
    if (res.writableEnded) return;
    res.write(
      `data: ${JSON.stringify({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: requestedModel,
        choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
      })}\n\n`,
    );
  }

  try {
    const client = getClaudeClient();
    const content = await client.complete(prompt, { model, cwd: root });

    sendChunk({ role: 'assistant', content: '' });
    sendChunk({ content });
    sendChunk({}, 'stop');
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err: any) {
    logger.error('Chat-Inlet subprocess error (stream)', { error: String(err) });
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({
          error: { message: err?.message ?? 'Subprocess error', type: 'api_error', code: 'stream_error' },
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

/**
 * POST /v1/chat/completions — dispatch to streaming or non-streaming path.
 */
async function chatCompletionsHandler(root: string): Promise<(req: Request, res: Response) => Promise<void>> {
  return async (req: Request, res: Response): Promise<void> => {
    const body = req.body as OpenAIChatRequest;
    const model = MODEL_MAP[body.model ?? ''] ?? DEFAULT_MODEL;
    const prompt = buildPrompt(body.messages ?? []);

    logger.info('POST /v1/chat/completions', { requestedModel: body.model, resolvedModel: model, stream: !!body.stream });

    if (body.stream) {
      return chatCompletionsStreamHandler(req, res, model, prompt, root);
    }

    try {
      const client = getClaudeClient();
      const content = await client.complete(prompt, { model, cwd: root });

      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? DEFAULT_MODEL,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        system_fingerprint: null,
      });
    } catch (err: any) {
      logger.error('Chat-Inlet subprocess error', { error: String(err) });
      res.status(500).json({
        error: {
          message: err?.message ?? 'Subprocess error',
          type: 'api_error',
          code: 'upstream_error',
        },
      });
    }
  };
}

/**
 * GET /v1/models — Open WebUI fetches this to populate the model dropdown.
 */
function listModelsHandler(_req: Request, res: Response): void {
  const now = Math.floor(Date.now() / 1000);
  res.json({
    object: 'list',
    data: AVAILABLE_MODELS.map(m => ({
      id: m.id,
      object: 'model',
      created: now,
      owned_by: 'kyberbot',
    })),
  });
}

// ── Router factory ─────────────────────────────────────────────────────────────

export async function createChatInletRouter(root: string): Promise<Router> {
  const router = Router();
  const completionsHandler = await chatCompletionsHandler(root);

  router.use(chatInletAuthMiddleware);
  router.post('/v1/chat/completions', completionsHandler);
  router.get('/v1/models', listModelsHandler);

  return router;
}
