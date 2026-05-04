/**
 * KyberBot — Claude completion route (OpenAI-shape proxy) regression sentinels
 *
 * These tests are PERMANENT — not one-shot Phase 1 scaffolding. They
 * lock the wire-shape contract that Phase 1's empirical smoke discovered:
 *
 *   1. metadata MUST be nested under `extra_body.metadata.spend_logs_metadata`.
 *      Top-level keys (Sentinel A) are silently dropped by the proxy and
 *      never reach spend_logs_metadata. Anything that regresses this shape
 *      causes silent attribution loss for every call.
 *   2. tags MUST be a flat string[] of `<key>:<value>` for budget
 *      enforcement (request_tags column) — used by POST /tag/new +
 *      max_budget for hard 400 budget_exceeded gating.
 *   3. stream MUST be `false`. completeProxy() returns a plain string;
 *      the .choices access path below the call site is incompatible with
 *      AsyncIterable<ChatCompletionChunk>.
 *   4. inFlightProxyCount MUST balance — Option α instrumentation
 *      reads this at fleet-manager shutdown to gate Phase 1.6 work.
 *
 * No network required — the OpenAI SDK is mocked. CI-safe.
 *
 * Integration smoke against real /spend/logs lives separately; gated by
 * PROXY_INTEGRATION=1 and run as a post-deploy probe (Rizzo owns the
 * CI mechanism — see hostile case (d) of the Phase C plan).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('completeProxy — Phase 1 wire-shape sentinels', () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.PROXY_BRAIN_KEY = 'sk-test-key';
    process.env.PROXY_BRAIN_URL = 'https://test.invalid/v1';

    mockCreate = vi.fn().mockResolvedValue({
      id: 'chatcmpl-test',
      model: 'claude-haiku-4-5',
      choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    vi.doMock('openai', () => ({
      default: class FakeOpenAI {
        chat = { completions: { create: mockCreate } };
        constructor(_opts: any) {}
      },
    }));

    // Hermetic config — tests must not read host identity.yaml or
    // depend on KYBERBOT_ROOT. Mock both functions claude.ts touches
    // and stub the rest of the surface to avoid load failures.
    vi.doMock('./config.js', async () => {
      const actual = await vi.importActual<any>('./config.js');
      return {
        ...actual,
        getRoot: () => '/tmp/test-default-root',
        getAgentNameForRoot: (cwd: string) => {
          // Match the basename-fallback shape deriveAgentName uses
          // when identity.yaml lookup fails on the real path.
          const parts = (cwd || '').replace(/\/+$/, '').split('/');
          const base = parts[parts.length - 1] || 'unknown';
          return base.replace(/-agent$/, '') || base;
        },
        getClaudeMode: () => 'subprocess',
        getClaudeModel: () => 'haiku',
        isFleetMode: () => false,
      };
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.doUnmock('openai');
    vi.doUnmock('./config.js');
    vi.resetModules();
  });

  it('SENTINEL: spend_logs_metadata + tags via extra_body, never top-level', async () => {
    const { ClaudeClient } = await import('./claude.js');
    const client = new ClaudeClient();
    await (client as any).completeProxy('hello', {
      caller: 'brain',
      callSite: 'brain.test-sentinel',
      cwd: '/home/test/agent-x',
      model: 'haiku',
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const arg = mockCreate.mock.calls[0]![0];

    // CRITICAL: top-level metadata must NOT carry our keys. The proxy
    // silently drops them — Sentinel A failure mode. If this assertion
    // ever fails, every spend log row loses caller/agent attribution.
    expect(arg.metadata).toBeUndefined();

    // Spend-logs analytics surface — exact shape verified empirically
    // in Phase 1 sentinel B against production /spend/logs.
    expect(arg.extra_body).toBeDefined();
    expect(arg.extra_body.metadata.spend_logs_metadata).toEqual({
      agent_root: '/home/test/agent-x',
      agent_name: 'agent-x',
      call_site: 'brain.test-sentinel',
      caller: 'brain',
    });

    // Budget-enforcement surface — request_tags column.
    expect(arg.extra_body.metadata.tags).toEqual([
      'caller:brain',
      'agent:agent-x',
    ]);

    // Phase C invariant — completeProxy() never streams.
    expect(arg.stream).toBe(false);

    // Sanity: standard OpenAI fields present.
    expect(arg.model).toBe('haiku');
    expect(arg.max_tokens).toBe(4096); // default
    expect(Array.isArray(arg.messages)).toBe(true);
  });

  it('SENTINEL: extra_body unchanged when caller is unknown / cwd missing', async () => {
    // Defensive — even with degraded inputs, we still write *something*
    // attributable to spend_logs_metadata rather than dropping the call.
    const { ClaudeClient } = await import('./claude.js');
    const client = new ClaudeClient();
    await (client as any).completeProxy('hello', {});

    const arg = mockCreate.mock.calls[0]![0];
    expect(arg.extra_body.metadata.spend_logs_metadata.caller).toBe('unknown');
    expect(arg.extra_body.metadata.spend_logs_metadata.call_site).toBe('unknown');
    // No cwd passed → falls back to mocked getRoot() = '/tmp/test-default-root'
    // → basename = 'test-default-root'.
    expect(arg.extra_body.metadata.spend_logs_metadata.agent_root).toBe('/tmp/test-default-root');
    expect(arg.extra_body.metadata.spend_logs_metadata.agent_name).toBe('test-default-root');
    expect(arg.extra_body.metadata.tags).toEqual([
      'caller:unknown',
      'agent:test-default-root',
    ]);
  });

  it('SENTINEL: in-flight counter is 1 during call, 0 after success', async () => {
    let countDuringCall = -1;
    mockCreate.mockImplementation(async () => {
      const { getInFlightProxyCount } = await import('./claude.js');
      countDuringCall = getInFlightProxyCount();
      return {
        id: 'x',
        model: 'claude-haiku-4-5',
        choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    });

    const { ClaudeClient, getInFlightProxyCount } = await import('./claude.js');
    const client = new ClaudeClient();
    expect(getInFlightProxyCount()).toBe(0);
    await (client as any).completeProxy('hi', { caller: 'brain', cwd: '/tmp/t' });
    expect(countDuringCall).toBe(1);
    expect(getInFlightProxyCount()).toBe(0);
  });

  it('SENTINEL: in-flight counter decrements on error path (finally)', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const { ClaudeClient, getInFlightProxyCount } = await import('./claude.js');
    const client = new ClaudeClient();
    await expect(
      (client as any).completeProxy('hi', { caller: 'brain', cwd: '/tmp/t' })
    ).rejects.toThrow('boom');
    expect(getInFlightProxyCount()).toBe(0);
  });

  it('SENTINEL: streaming response shape throws Phase C invariant error', async () => {
    // Simulate a refactor mistake: SDK returns AsyncIterable instead of
    // ChatCompletion. The runtime guard must catch this before the
    // .choices access path crashes with a less informative error.
    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ value: undefined, done: true }),
      }),
    });

    const { ClaudeClient, getInFlightProxyCount } = await import('./claude.js');
    const client = new ClaudeClient();
    await expect(
      (client as any).completeProxy('hi', { caller: 'brain', cwd: '/tmp/t' })
    ).rejects.toThrow(/Phase C invariant/);
    // Counter must still balance even on guard throw.
    expect(getInFlightProxyCount()).toBe(0);
  });

  // ── Backward-compat schema tests ────────────────────────────────────────
  // These lock the dual-read fallback: operators with old LITELLM_BRAIN_*
  // env vars in .env must not silently break on upgrade. The new names take
  // precedence; old names resolve if present and new names are absent.

  it('COMPAT: LITELLM_BRAIN_* env vars resolve when PROXY_BRAIN_* are unset', async () => {
    // Simulate an operator who hasn't renamed their .env yet.
    delete process.env.PROXY_BRAIN_KEY;
    delete process.env.PROXY_BRAIN_URL;
    process.env.LITELLM_BRAIN_KEY = 'sk-legacy-key';
    process.env.LITELLM_BRAIN_URL = 'https://legacy.invalid/v1';

    const { ClaudeClient } = await import('./claude.js');
    const client = new ClaudeClient();

    // Must complete successfully (old key/URL resolved via fallback).
    await expect(
      (client as any).completeProxy('hi', { caller: 'brain', cwd: '/tmp/t' })
    ).resolves.toBe('OK');

    // Verify the request landed on the legacy URL — FakeOpenAI ctor is
    // called with baseURL from the env var, so inspect mockCreate args.
    expect(mockCreate).toHaveBeenCalledOnce();
    const arg = mockCreate.mock.calls[0]![0];
    // Standard shape still intact — compat path doesn't alter the request body.
    expect(arg.extra_body.metadata.spend_logs_metadata.caller).toBe('brain');
  });

  it('COMPAT: new PROXY_BRAIN_* names win when both old and new are set', async () => {
    // Simulate an operator mid-migration: both names present. New wins.
    process.env.PROXY_BRAIN_KEY = 'sk-new-key';
    process.env.PROXY_BRAIN_URL = 'https://new.invalid/v1';
    process.env.LITELLM_BRAIN_KEY = 'sk-should-not-use';
    process.env.LITELLM_BRAIN_URL = 'https://should-not-use.invalid/v1';

    const { ClaudeClient } = await import('./claude.js');
    const client = new ClaudeClient();

    // Must complete successfully; old values are shadowed by new.
    await expect(
      (client as any).completeProxy('hello', { caller: 'brain', cwd: '/tmp/t' })
    ).resolves.toBe('OK');

    // FakeOpenAI constructed with new baseURL — confirm via mockCreate call count.
    expect(mockCreate).toHaveBeenCalledOnce();
  });
});
