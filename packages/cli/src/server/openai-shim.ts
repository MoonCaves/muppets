/**
 * KyberBot — OpenAI-Compatible Shim
 *
 * Exposes POST /v1/chat/completions so Open WebUI (and other OpenAI-compatible
 * clients) can point at this server instead of Haiku / a paid proxy.
 *
 * ── ENV VARS ──────────────────────────────────────────────────────────────────
 * OPENAI_SHIM_TOKEN  (required)
 *   A random bearer token that Open WebUI (or any OpenAI-compatible client)
 *   must send in the Authorization header:
 *       Authorization: Bearer <OPENAI_SHIM_TOKEN>
 *   Generate with: openssl rand -hex 32
 *   Add to the KyberBot .env file (same directory as identity.yaml).
 *   All requests lacking this token receive a 401 with an OpenAI-shape error.
 *
 * ANTHROPIC_API_KEY  (required for Step 4+)
 *   Standard Anthropic API key.  The shim calls the Anthropic Messages API
 *   directly (not through subprocess) so the key must be present at request
 *   time.  Missing key → clear 500 with config guidance, not a crash.
 *
 * ── Phase progression ─────────────────────────────────────────────────────────
 *   Step 2  — stub response, hard-coded body, proves the route wires up.
 *   Step 3  — bearer-auth middleware (OPENAI_SHIM_TOKEN env var).
 *   Step 4  (current) — real Claude SDK translation (non-streaming).
 *   Step 5  — SSE streaming when request.stream === true.
 *   Step 6  — Open WebUI wiring + model dropdown.
 *   Step 7  — rate-limit, error mapping, README, handoff to Rizzo.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger.js';

const logger = createLogger('openai-shim');

// ── Model mapping ──────────────────────────────────────────────────────────────
// Maps OpenAI model names (and friendly short-names) to Anthropic model IDs.
// GPT aliases exist so clients that hard-code OpenAI model names work without
// reconfiguration.
const MODEL_MAP: Record<string, string> = {
  // Friendly short names
  'haiku':  'claude-haiku-4-5',
  'sonnet': 'claude-sonnet-4-6',
  'opus':   'claude-opus-4-7',
  // Full Anthropic model IDs — pass-through
  'claude-haiku-4-5':  'claude-haiku-4-5',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-7':   'claude-opus-4-7',
  // GPT aliases — map to the closest Claude equivalent
  'gpt-3.5-turbo':       'claude-haiku-4-5',
  'gpt-3.5-turbo-16k':   'claude-haiku-4-5',
  'gpt-4':               'claude-sonnet-4-6',
  'gpt-4o':              'claude-sonnet-4-6',
  'gpt-4o-mini':         'claude-haiku-4-5',
  'gpt-4-turbo':         'claude-opus-4-7',
  'gpt-4-turbo-preview': 'claude-opus-4-7',
};

const DEFAULT_MODEL_ID = 'claude-haiku-4-5';

// Models surfaced on GET /v1/models
const AVAILABLE_MODELS = [
  { id: 'claude-haiku-4-5',  description: 'Fast and compact' },
  { id: 'claude-sonnet-4-6', description: 'Balanced capability' },
  { id: 'claude-opus-4-7',   description: 'Most capable' },
  // Friendly aliases
  { id: 'haiku',  description: 'Alias → claude-haiku-4-5' },
  { id: 'sonnet', description: 'Alias → claude-sonnet-4-6' },
  { id: 'opus',   description: 'Alias → claude-opus-4-7' },
];

// ── Anthropic client (lazy singleton) ─────────────────────────────────────────
// Lazy init so a missing ANTHROPIC_API_KEY doesn't crash the server on startup.
// The shim fails gracefully at request time with a clear config error.
let _anthropic: any = null;

async function getAnthropicClient(): Promise<any> {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  _anthropic = new Anthropic();
  return _anthropic;
}

// ── OpenAI request/response types ─────────────────────────────────────────────

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

// ── Conversion helpers ─────────────────────────────────────────────────────────

/**
 * Convert an OpenAI messages array to Claude's format.
 *
 * OpenAI inlines system messages as `{ role: "system", content: "..." }`.
 * Claude takes a separate `system` parameter.  Multiple system messages are
 * joined with double-newlines.
 */
function convertMessages(openaiMessages: OpenAIMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const systemParts: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of openaiMessages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else {
      messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages,
  };
}

/**
 * Map Anthropic stop_reason to OpenAI finish_reason.
 */
function mapFinishReason(stopReason: string | null | undefined): string {
  switch (stopReason) {
    case 'end_turn':      return 'stop';
    case 'max_tokens':    return 'length';
    case 'stop_sequence': return 'stop';
    case 'tool_use':      return 'tool_calls';
    default:              return 'stop';
  }
}

// ── Auth middleware ────────────────────────────────────────────────────────────

/**
 * Bearer-auth middleware for the OpenAI shim.
 *
 * Reads OPENAI_SHIM_TOKEN from process.env.  If the env var is missing or empty
 * the shim is disabled entirely (returns 401 on every request with a clear
 * configuration message so the operator knows what to fix).
 *
 * On success (token matches) — calls next().
 * On failure — returns an OpenAI-shape 401 error and does NOT call next().
 */
function shimAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const shimToken = process.env.OPENAI_SHIM_TOKEN;

  if (!shimToken) {
    logger.warn('OPENAI_SHIM_TOKEN not set — shim is locked until the env var is configured');
    res.status(401).json({
      error: {
        message: 'OpenAI shim is not configured: OPENAI_SHIM_TOKEN env var is missing. Set it in .env and restart KyberBot.',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
    return;
  }

  const authHeader = req.headers['authorization'] ?? '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (provided !== shimToken) {
    logger.warn('OpenAI shim auth failure', { ip: req.ip });
    res.status(401).json({
      error: {
        message: 'Invalid shim token. Check the Authorization: Bearer <OPENAI_SHIM_TOKEN> header.',
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
 * POST /v1/chat/completions — Step 4: real Claude SDK translation (non-streaming).
 *
 * Converts OpenAI messages → Claude messages, calls the Anthropic SDK directly
 * (in-process, not via subprocess), and returns an OpenAI-shaped response.
 *
 * stream: true → clean 400 (Step 5 will handle it).
 * Temperature and top_p are accepted but ignored for now (Step 6).
 */
async function chatCompletionsHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as OpenAIChatRequest;

  if (body.stream) {
    res.status(400).json({
      error: {
        message: 'Streaming is not yet supported by this shim. Set stream: false or omit the field.',
        type: 'invalid_request_error',
        code: 'streaming_not_supported',
      },
    });
    return;
  }

  const requestedModel = body.model ?? DEFAULT_MODEL_ID;
  const modelId = MODEL_MAP[requestedModel] ?? DEFAULT_MODEL_ID;

  logger.info('POST /v1/chat/completions', { requestedModel, resolvedModel: modelId });

  let client: any;
  try {
    client = await getAnthropicClient();
  } catch (err) {
    logger.error('Anthropic client init failed — ANTHROPIC_API_KEY missing?', { error: String(err) });
    res.status(500).json({
      error: {
        message: 'ANTHROPIC_API_KEY is not configured on this server. Set it in .env and restart KyberBot.',
        type: 'server_error',
        code: 'missing_api_key',
      },
    });
    return;
  }

  const { system, messages } = convertMessages(body.messages ?? []);

  let response: any;
  try {
    response = await client.messages.create({
      model: modelId,
      max_tokens: body.max_tokens ?? 4096,
      ...(system ? { system } : {}),
      messages,
    });
  } catch (err: any) {
    const status: number = typeof err?.status === 'number' ? err.status : 500;
    logger.error('Anthropic API error', { status, error: String(err) });
    res.status(status).json({
      error: {
        message: err?.message ?? 'Anthropic API call failed',
        type: 'api_error',
        code: 'upstream_error',
      },
    });
    return;
  }

  const textBlock = response.content?.find((b: any) => b.type === 'text');
  const content: string = textBlock?.text ?? '';

  res.json({
    id: `chatcmpl-${response.id ?? Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        logprobs: null,
        finish_reason: mapFinishReason(response.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: response.usage?.input_tokens ?? 0,
      completion_tokens: response.usage?.output_tokens ?? 0,
      total_tokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    },
    system_fingerprint: null,
  });
}

/**
 * GET /v1/models
 *
 * Open WebUI fetches this to populate the model dropdown.
 * Step 4: returns the real available models (Haiku / Sonnet / Opus + aliases).
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

export function createOpenAiShimRouter(): Router {
  const router = Router();

  // All shim routes require a valid OPENAI_SHIM_TOKEN bearer token.
  // shimAuthMiddleware returns 401 (OpenAI error shape) on mismatch.
  router.use(shimAuthMiddleware);

  // Core completions endpoint
  router.post('/v1/chat/completions', chatCompletionsHandler);

  // Model listing — needed by Open WebUI
  router.get('/v1/models', listModelsHandler);

  return router;
}
