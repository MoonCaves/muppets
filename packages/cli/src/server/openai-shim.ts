/**
 * KyberBot — OpenAI-Compatible Shim
 *
 * Exposes POST /v1/chat/completions so Open WebUI (and other OpenAI-compatible
 * clients) can point at this server instead of Haiku / a paid proxy.
 *
 * Phase progression:
 *   Step 2 (current) — stub response, hard-coded body, proves the route wires up.
 *   Step 3           — bearer-auth middleware (OPENAI_SHIM_TOKEN env var).
 *   Step 4           — real Claude SDK translation (non-streaming).
 *   Step 5           — SSE streaming when request.stream === true.
 *   Step 6           — Open WebUI wiring + model dropdown.
 *   Step 7           — rate-limit, error mapping, README, handoff to Rizzo.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { createLogger } from '../logger.js';

const logger = createLogger('openai-shim');

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
 * Step 2 stub: returns a valid OpenAI shape immediately without calling Claude.
 * Auth is intentionally ABSENT in this step — added in step 3.
 */
function chatCompletionsHandler(req: Request, res: Response): void {
  const model = (req.body as { model?: string })?.model ?? 'claude-shim-stub';
  logger.info('POST /v1/chat/completions (stub)', { model });
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

  // Core completions endpoint
  router.post('/v1/chat/completions', chatCompletionsHandler);

  // Model listing — needed by Open WebUI
  router.get('/v1/models', listModelsHandler);

  return router;
}
