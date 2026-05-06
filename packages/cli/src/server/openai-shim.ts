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
 * ── Phase progression ─────────────────────────────────────────────────────────
 *   Step 2  — stub response, hard-coded body, proves the route wires up.
 *   Step 3  (current) — bearer-auth middleware (OPENAI_SHIM_TOKEN env var).
 *   Step 4  — real Claude SDK translation (non-streaming).
 *   Step 5  — SSE streaming when request.stream === true.
 *   Step 6  — Open WebUI wiring + model dropdown.
 *   Step 7  — rate-limit, error mapping, README, handoff to Rizzo.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../logger.js';

const logger = createLogger('openai-shim');

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

/**
 * Minimal valid OpenAI ChatCompletion response.
 * Shape documented at https://platform.openai.com/docs/api-reference/chat/object
 */
function stubChatCompletion(requestedModel: string): object {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `chatcmpl-stub-${Date.now()}`,
    object: 'chat.completion',
    created: now,
    model: requestedModel || 'claude-shim-stub',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '[KyberBot OpenAI shim — stub response. Real Claude translation lands in step 4.]',
        },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    system_fingerprint: null,
  };
}

/**
 * POST /v1/chat/completions
 *
 * Step 3: bearer auth enforced by shimAuthMiddleware (see createOpenAiShimRouter).
 * Returns a valid OpenAI shape immediately without calling Claude (stub until step 4).
 */
function chatCompletionsHandler(req: Request, res: Response): void {
  const model = (req.body as { model?: string })?.model ?? 'claude-shim-stub';
  logger.info('POST /v1/chat/completions (stub, auth ok)', { model });
  res.json(stubChatCompletion(model));
}

/**
 * GET /v1/models
 *
 * Open WebUI fetches this to populate the model dropdown.
 * Step 2 stub: returns a single placeholder model entry.
 */
function listModelsHandler(_req: Request, res: Response): void {
  res.json({
    object: 'list',
    data: [
      {
        id: 'claude-shim-stub',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'kyberbot',
      },
    ],
  });
}

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
