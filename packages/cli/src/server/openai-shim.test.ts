/**
 * KyberBot — OpenAI Shim Tests
 *
 * Covers step 3 (auth), step 4 (non-streaming), and step 5 (SSE streaming).
 * The Anthropic SDK is mocked at the module level so no real API calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOpenAiShimRouter, _resetAnthropicClientForTesting } from './openai-shim.js';

// ── Anthropic SDK mock ────────────────────────────────────────────────────────
//
// We use a stable wrapper object so vi.mock()'s factory captures a reference
// that remains valid across all tests even after vi.clearAllMocks().
//
// Tests control behaviour by replacing `_mock.create` in beforeEach.

const _mock = {
  create: vi.fn(),
};

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: (...args: unknown[]) => _mock.create(...args),
    };
  },
}));

// ── App factory ───────────────────────────────────────────────────────────────

/** Build a fresh Express app with the shim mounted.  Router is shared; state
 *  (e.g. lazy Anthropic singleton) is reset via _resetAnthropicClientForTesting. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createOpenAiShimRouter());
  return app;
}

// ── Response helpers ──────────────────────────────────────────────────────────

function makeAnthropicResponse(text: string, stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

/** Async generator yielding Anthropic stream events for `text`. */
async function* makeStreamEvents(text: string, stopReason = 'end_turn') {
  yield { type: 'message_start', message: { id: 'msg_stream', usage: { input_tokens: 10 } } };
  yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
  // Two delta chunks to verify multi-delta reconstruction
  yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 3) } };
  yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(3) } };
  yield { type: 'content_block_stop', index: 0 };
  yield { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } };
  yield { type: 'message_stop' };
}

// ── Environment setup ─────────────────────────────────────────────────────────

const VALID_TOKEN = 'test-shim-token-abc123';

beforeEach(() => {
  process.env.OPENAI_SHIM_TOKEN = VALID_TOKEN;
  process.env.ANTHROPIC_API_KEY = 'sk-test-key';
  _mock.create = vi.fn();
  _resetAnthropicClientForTesting();
});

// ── SSE helpers ───────────────────────────────────────────────────────────────

/**
 * Parse raw SSE body text into an array of parsed JSON objects.
 * Drops blank lines and the [DONE] sentinel.
 */
function parseSSE(body: string): unknown[] {
  return body
    .split('\n')
    .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map(line => JSON.parse(line.slice(6)));
}

/**
 * Make a streaming supertest request and return the raw response body text.
 */
async function streamRequest(app: express.Express, payload: object): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const res = await (request(app)
    .post('/v1/chat/completions')
    .set('Authorization', `Bearer ${VALID_TOKEN}`)
    .send(payload)
    .buffer(true)
    .parse((res, callback) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => callback(null, data));
    }) as any);
  return { status: res.status, headers: res.headers, body: res.body as string };
}

// ── Auth tests ────────────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  it('returns 401 when OPENAI_SHIM_TOKEN is not set', async () => {
    delete process.env.OPENAI_SHIM_TOKEN;
    const app = buildApp();
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it('returns 401 when bearer token is wrong', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer wrong-token')
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(401);
  });

  it('passes with correct bearer token', async () => {
    _mock.create.mockResolvedValueOnce(makeAnthropicResponse('pong'));
    const app = buildApp();
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ messages: [{ role: 'user', content: 'ping' }] });
    expect(res.status).toBe(200);
  });
});

// ── Non-streaming tests ───────────────────────────────────────────────────────

describe('POST /v1/chat/completions (non-streaming)', () => {
  it('returns an OpenAI-shaped completion', async () => {
    _mock.create.mockResolvedValueOnce(makeAnthropicResponse('Hello world'));
    const app = buildApp();
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ model: 'haiku', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('chat.completion');
    expect(res.body.choices[0].message.role).toBe('assistant');
    expect(res.body.choices[0].message.content).toBe('Hello world');
    expect(res.body.choices[0].finish_reason).toBe('stop');
    expect(res.body.usage.prompt_tokens).toBe(10);
    expect(res.body.usage.completion_tokens).toBe(5);
  });

  it('maps model alias to Anthropic model ID', async () => {
    _mock.create.mockResolvedValueOnce(makeAnthropicResponse('ok'));
    const app = buildApp();
    await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ model: 'haiku', messages: [{ role: 'user', content: 'hi' }] });

    expect(_mock.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5' }),
    );
  });

  it('maps gpt-4o alias to sonnet', async () => {
    _mock.create.mockResolvedValueOnce(makeAnthropicResponse('ok'));
    const app = buildApp();
    await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(_mock.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    );
  });

  it('extracts system message and passes it separately to Claude', async () => {
    _mock.create.mockResolvedValueOnce(makeAnthropicResponse('ok'));
    const app = buildApp();
    await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'hi' },
        ],
      });

    expect(_mock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
  });

  it('returns 500 when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildApp();
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('missing_api_key');
  });
});

// ── Streaming tests ───────────────────────────────────────────────────────────

describe('POST /v1/chat/completions (stream: true)', () => {
  it('responds with Content-Type text/event-stream', async () => {
    _mock.create.mockReturnValueOnce(makeStreamEvents('Hi there'));
    const { headers } = await streamRequest(buildApp(), {
      model: 'haiku',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
    });
    expect(headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('first chunk announces the assistant role', async () => {
    _mock.create.mockReturnValueOnce(makeStreamEvents('Hi there'));
    const { body } = await streamRequest(buildApp(), {
      model: 'haiku',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
    });
    const chunks = parseSSE(body) as any[];
    expect(chunks[0].choices[0].delta).toMatchObject({ role: 'assistant', content: '' });
  });

  it('streams text deltas and reassembles to the original string', async () => {
    _mock.create.mockReturnValueOnce(makeStreamEvents('Hi there'));
    const { body } = await streamRequest(buildApp(), {
      model: 'haiku',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
    });
    const chunks = parseSSE(body) as any[];
    // Skip role chunk (first) and stop chunk (last) — collect text content
    const text = chunks
      .slice(1, -1)
      .map((c: any) => c.choices[0].delta.content ?? '')
      .join('');
    expect(text).toBe('Hi there');
  });

  it('final chunk has finish_reason stop and empty delta', async () => {
    _mock.create.mockReturnValueOnce(makeStreamEvents('ok'));
    const { body } = await streamRequest(buildApp(), {
      model: 'haiku',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
    });
    const chunks = parseSSE(body) as any[];
    const last = chunks[chunks.length - 1] as any;
    expect(last.choices[0].finish_reason).toBe('stop');
    expect(last.choices[0].delta).toEqual({});
  });

  it('includes [DONE] sentinel in the raw body', async () => {
    _mock.create.mockReturnValueOnce(makeStreamEvents('ok'));
    const { body } = await streamRequest(buildApp(), {
      model: 'haiku',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
    });
    expect(body).toContain('data: [DONE]');
  });

  it('all chunks carry consistent id, object, and requested model', async () => {
    _mock.create.mockReturnValueOnce(makeStreamEvents('test'));
    const { body } = await streamRequest(buildApp(), {
      model: 'sonnet',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
    });
    const chunks = parseSSE(body) as any[];
    for (const chunk of chunks) {
      expect((chunk as any).object).toBe('chat.completion.chunk');
      expect((chunk as any).model).toBe('sonnet');
      expect((chunk as any).id).toMatch(/^chatcmpl-/);
    }
  });

  it('returns clean JSON 500 before SSE headers when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const app = buildApp();
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ messages: [{ role: 'user', content: 'hi' }], stream: true });

    // Must be a JSON error response — NOT text/event-stream — because the
    // client init failure occurs before SSE headers are flushed.
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('missing_api_key');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('passes stream: true to the Anthropic SDK create call', async () => {
    _mock.create.mockReturnValueOnce(makeStreamEvents('ok'));
    await streamRequest(buildApp(), {
      model: 'haiku',
      messages: [{ role: 'user', content: 'go' }],
      stream: true,
    });
    expect(_mock.create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
    );
  });
});

// ── GET /v1/models ────────────────────────────────────────────────────────────

describe('GET /v1/models', () => {
  it('returns available model list with correct shape', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/v1/models')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(res.body.data).toBeInstanceOf(Array);
    const ids = res.body.data.map((m: any) => m.id);
    expect(ids).toContain('claude-haiku-4-5');
    expect(ids).toContain('haiku');
    expect(ids).toContain('sonnet');
    expect(ids).toContain('opus');
  });
});
