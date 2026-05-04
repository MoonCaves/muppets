/**
 * KyberBot — reconciliation tests
 *
 * Covers stall detection, external state refresh, and dispatch slot
 * computation. Uses an isolated tmpdir HOME so the user's real
 * orchestration DB stays untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resetOrchDb, getOrchDb } from './db.js';
import { createRun } from './runs.js';
import { transitionPhase, RunPhase, getRunPhase } from './run-phases.js';
import {
  detectStalls,
  refreshExternalState,
  registerExternalStateSource,
  clearExternalStateSources,
  computeDispatchSlots,
  canDispatch,
  reconcileTick,
} from './reconcile.js';

let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'kyberbot-reconcile-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  resetOrchDb();
  clearExternalStateSources();
  getOrchDb(); // initialize
});

afterEach(() => {
  resetOrchDb();
  clearExternalStateSources();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe('detectStalls', () => {
  it('marks runs with no recent phase transitions as stalled', () => {
    const id = createRun('agent', 'worker');
    transitionPhase(id, RunPhase.StreamingTurn);

    // Pretend it's been 10 minutes — well past the 5min stall timeout
    const future = Date.now() + 10 * 60 * 1000;
    const result = detectStalls({ now: future, stallTimeoutMs: 5 * 60 * 1000 });
    expect(result.stalledRunIds).toContain(id);

    const phase = getRunPhase(id);
    expect(phase.phase).toBe(RunPhase.Stalled);
  });

  it('does not stall fresh runs', () => {
    const id = createRun('agent', 'worker');
    transitionPhase(id, RunPhase.StreamingTurn);
    const result = detectStalls({ stallTimeoutMs: 60 * 1000 });
    expect(result.stalledRunIds).not.toContain(id);
  });

  it('skips stall detection when timeout <= 0', () => {
    const id = createRun('agent', 'worker');
    const future = Date.now() + 24 * 60 * 60 * 1000;
    const result = detectStalls({ now: future, stallTimeoutMs: 0 });
    expect(result.stalledRunIds).toEqual([]);
  });
});

describe('refreshExternalState', () => {
  it('updates issue status from external source', async () => {
    const db = getOrchDb();
    db.prepare(
      "INSERT INTO issues (id, title, created_by, status, external_source) VALUES (1, 'task', 'system', 'in_progress', 'fake')"
    ).run();

    registerExternalStateSource({
      kind: 'fake',
      async refresh(ids) {
        const m = new Map();
        for (const id of ids) m.set(id, { status: 'done' });
        return m;
      },
    });

    const result = await refreshExternalState();
    expect(result.refreshedIssueIds).toContain(1);

    const issue = db.prepare('SELECT status FROM issues WHERE id = 1').get() as { status: string };
    expect(issue.status).toBe('done');
  });

  it('cancels running runs when external source reports terminal', async () => {
    const db = getOrchDb();
    db.prepare(
      "INSERT INTO issues (id, title, created_by, status, external_source) VALUES (5, 'task', 'system', 'in_progress', 'fake')"
    ).run();

    const runId = createRun('worker', 'worker');
    db.prepare("UPDATE heartbeat_runs SET result_summary = 'KYB-5 in flight' WHERE id = ?").run(runId);

    registerExternalStateSource({
      kind: 'fake',
      async refresh() { return new Map([[5, { status: 'cancelled' }]]); },
    });

    const result = await refreshExternalState();
    expect(result.canceledRunIds).toContain(runId);
    expect(getRunPhase(runId).phase).toBe(RunPhase.CanceledByReconciliation);
  });

  it('keeps workers running on source error', async () => {
    const db = getOrchDb();
    db.prepare(
      "INSERT INTO issues (id, title, created_by, status, external_source) VALUES (1, 'task', 'system', 'in_progress', 'flaky')"
    ).run();
    registerExternalStateSource({
      kind: 'flaky',
      async refresh() { throw new Error('network down'); },
    });
    const result = await refreshExternalState();
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].source).toBe('flaky');
    // Issue status unchanged
    const row = db.prepare('SELECT status FROM issues WHERE id = 1').get() as { status: string };
    expect(row.status).toBe('in_progress');
  });
});

describe('computeDispatchSlots', () => {
  it('counts running runs against the global limit', () => {
    createRun('worker', 'worker'); // status=running by default
    const slots = computeDispatchSlots('worker', { max_concurrent_runs: 1 });
    expect(slots.global).toBe(0);
  });

  it('clamps below zero to zero', () => {
    createRun('worker', 'worker');
    createRun('worker', 'worker');
    const slots = computeDispatchSlots('worker', { max_concurrent_runs: 1 });
    expect(slots.global).toBe(0);
  });

  it('returns per-state slots from issue counts', () => {
    const db = getOrchDb();
    db.prepare("INSERT INTO issues (title, created_by, status, assigned_to) VALUES ('a', 'system', 'todo', 'worker')").run();
    db.prepare("INSERT INTO issues (title, created_by, status, assigned_to) VALUES ('b', 'system', 'todo', 'worker')").run();

    const slots = computeDispatchSlots('worker', {
      max_concurrent_runs: 5,
      max_by_state: { todo: 3 },
    });
    expect(slots.byState.todo).toBe(1);
  });
});

describe('canDispatch', () => {
  it('allows when slots are available', () => {
    const r = canDispatch('worker', { max_concurrent_runs: 1 }, 'todo');
    expect(r.allowed).toBe(true);
  });

  it('denies when at global limit', () => {
    createRun('worker', 'worker');
    const r = canDispatch('worker', { max_concurrent_runs: 1 }, 'todo');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/max_concurrent_runs/);
  });

  it('denies when at per-state limit', () => {
    const db = getOrchDb();
    db.prepare("INSERT INTO issues (title, created_by, status, assigned_to) VALUES ('a', 'system', 'todo', 'worker')").run();
    db.prepare("INSERT INTO issues (title, created_by, status, assigned_to) VALUES ('b', 'system', 'todo', 'worker')").run();
    const r = canDispatch('worker', { max_concurrent_runs: 5, max_by_state: { todo: 2 } }, 'todo');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/max_by_state\[todo\]/);
  });
});

describe('reconcileTick', () => {
  it('returns a structured summary', async () => {
    const result = await reconcileTick();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.stalledRunIds).toEqual([]);
    expect(result.refreshedIssueIds).toEqual([]);
  });
});
