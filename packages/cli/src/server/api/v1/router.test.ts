/**
 * KyberBot — /api/v1 router tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import request from 'supertest';
import { resetOrchDb, getOrchDb } from '../../../orchestration/db.js';
import { createRun, completeRun, failRun } from '../../../orchestration/runs.js';
import { transitionPhase, RunPhase } from '../../../orchestration/run-phases.js';
import { createApiV1Router, buildFleetState, buildAgentState } from './router.js';

let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'kyberbot-apiv1-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  resetOrchDb();
  getOrchDb();
});

afterEach(() => {
  resetOrchDb();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

const fakeDeps = (overrides: Partial<Parameters<typeof createApiV1Router>[0]> = {}) => ({
  listAgents: () => [
    { name: 'atlas', description: 'engineer', type: 'local' as const, status: 'running' as const, root: '/tmp/atlas', uptime_ms: 1000 },
  ],
  getFleetStartedAt: () => Date.now() - 5000,
  ...overrides,
});

describe('GET /api/v1/state', () => {
  it('returns the fleet snapshot shape', async () => {
    const app = express().use('/api/v1', createApiV1Router(fakeDeps()));
    const res = await request(app).get('/api/v1/state');
    expect(res.status).toBe(200);
    expect(res.body.generated_at).toBeTypeOf('string');
    expect(res.body.counts).toEqual({ running: 0, retrying: 0, stalled: 0, canceled: 0 });
    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0].name).toBe('atlas');
    expect(res.body.fleet_uptime_ms).toBeGreaterThan(0);
  });

  it('counts running and stalled runs', async () => {
    const id1 = createRun('atlas', 'worker');
    const id2 = createRun('atlas', 'worker');
    transitionPhase(id1, RunPhase.StreamingTurn);
    failRun(id2, 'no events', RunPhase.Stalled);

    const app = express().use('/api/v1', createApiV1Router(fakeDeps()));
    const res = await request(app).get('/api/v1/state');
    expect(res.body.counts.running).toBe(1);
    expect(res.body.counts.stalled).toBe(1);
    expect(res.body.running).toHaveLength(1);
  });

  it('attaches the running run to its agent row', async () => {
    const id = createRun('atlas', 'worker');
    transitionPhase(id, RunPhase.StreamingTurn);
    const app = express().use('/api/v1', createApiV1Router(fakeDeps()));
    const res = await request(app).get('/api/v1/state');
    expect(res.body.agents[0].current_run.id).toBe(id);
    expect(res.body.agents[0].current_run.phase).toBe(RunPhase.StreamingTurn);
  });
});

describe('GET /api/v1/agents/:name', () => {
  it('returns agent detail', async () => {
    const app = express().use('/api/v1', createApiV1Router(fakeDeps()));
    const res = await request(app).get('/api/v1/agents/atlas');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('atlas');
    expect(res.body.workspace).toEqual({ path: '/tmp/atlas' });
  });

  it('404s on unknown agent with structured error', async () => {
    const app = express().use('/api/v1', createApiV1Router(fakeDeps()));
    const res = await request(app).get('/api/v1/agents/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('agent_not_found');
  });

  it('reports recent_failures and last_error', async () => {
    const id = createRun('atlas', 'worker');
    failRun(id, 'kaboom');
    const app = express().use('/api/v1', createApiV1Router(fakeDeps()));
    const res = await request(app).get('/api/v1/agents/atlas');
    expect(res.body.attempts.recent_failures).toBe(1);
    expect(res.body.last_error).toBe('kaboom');
  });
});

describe('POST /api/v1/refresh', () => {
  it('returns 202 with queued=true', async () => {
    const app = express().use('/api/v1', createApiV1Router(fakeDeps()));
    const res = await request(app).post('/api/v1/refresh').send({});
    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(true);
  });
});

describe('snapshot builders (direct)', () => {
  it('buildFleetState returns recent terminal runs', () => {
    const id = createRun('atlas', 'orchestration');
    completeRun(id, { result_summary: 'ok' });
    const snap = buildFleetState(fakeDeps());
    expect(snap.recent.some(r => r.id === id)).toBe(true);
  });

  it('buildAgentState returns null for unknown agent', () => {
    expect(buildAgentState(fakeDeps(), 'ghost')).toBeNull();
  });
});
