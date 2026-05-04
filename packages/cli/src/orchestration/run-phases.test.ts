/**
 * KyberBot — run-phase state machine tests
 *
 * Spins up an isolated orchestration DB by overriding HOME so the
 * tests don't touch the user's real ~/.kyberbot/orchestration.db.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resetOrchDb, getOrchDb } from './db.js';
import { transitionPhase, getRunPhase, RunPhase, isTerminalPhase } from './run-phases.js';
import { createRun, completeRun, failRun } from './runs.js';

let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'kyberbot-runs-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  resetOrchDb();
  // Force schema init
  getOrchDb();
});

afterEach(() => {
  resetOrchDb();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe('transitionPhase', () => {
  it('records phase and history', () => {
    const id = createRun('test-agent', 'worker');
    transitionPhase(id, RunPhase.PreparingWorkspace);
    transitionPhase(id, RunPhase.BuildingPrompt);
    transitionPhase(id, RunPhase.LaunchingAgent);

    const result = getRunPhase(id);
    expect(result.phase).toBe(RunPhase.LaunchingAgent);
    expect(result.history.map(h => h.phase)).toEqual([
      RunPhase.PreparingWorkspace,
      RunPhase.BuildingPrompt,
      RunPhase.LaunchingAgent,
    ]);
  });

  it('is idempotent on the same phase', () => {
    const id = createRun('a', 'worker');
    transitionPhase(id, RunPhase.BuildingPrompt);
    transitionPhase(id, RunPhase.BuildingPrompt);
    const result = getRunPhase(id);
    expect(result.history.length).toBe(1);
  });

  it('refuses transitions after terminal phase', () => {
    const id = createRun('a', 'worker');
    transitionPhase(id, RunPhase.Succeeded);
    transitionPhase(id, RunPhase.StreamingTurn); // should be ignored
    const result = getRunPhase(id);
    expect(result.phase).toBe(RunPhase.Succeeded);
    expect(result.history.length).toBe(1);
  });

  it('records reason on phase entry', () => {
    const id = createRun('a', 'worker');
    transitionPhase(id, RunPhase.Stalled, 'no events for 5m');
    const result = getRunPhase(id);
    expect(result.history[0].reason).toBe('no events for 5m');
  });
});

describe('isTerminalPhase', () => {
  it('classifies terminal phases', () => {
    expect(isTerminalPhase(RunPhase.Succeeded)).toBe(true);
    expect(isTerminalPhase(RunPhase.Failed)).toBe(true);
    expect(isTerminalPhase(RunPhase.TimedOut)).toBe(true);
    expect(isTerminalPhase(RunPhase.Stalled)).toBe(true);
    expect(isTerminalPhase(RunPhase.CanceledByReconciliation)).toBe(true);
  });

  it('classifies in-flight phases as non-terminal', () => {
    expect(isTerminalPhase(RunPhase.PreparingWorkspace)).toBe(false);
    expect(isTerminalPhase(RunPhase.StreamingTurn)).toBe(false);
    expect(isTerminalPhase(RunPhase.Finishing)).toBe(false);
  });
});

describe('completeRun / failRun integration', () => {
  it('completeRun transitions to Succeeded', () => {
    const id = createRun('a', 'worker');
    completeRun(id, { result_summary: 'ok' });
    const result = getRunPhase(id);
    expect(result.phase).toBe(RunPhase.Succeeded);
  });

  it('failRun transitions to Failed by default', () => {
    const id = createRun('a', 'worker');
    failRun(id, 'boom');
    const result = getRunPhase(id);
    expect(result.phase).toBe(RunPhase.Failed);
    expect(result.history[0].reason).toBe('boom');
  });

  it('failRun accepts a different terminal phase', () => {
    const id = createRun('a', 'worker');
    failRun(id, 'no events for 5m', RunPhase.Stalled);
    const result = getRunPhase(id);
    expect(result.phase).toBe(RunPhase.Stalled);
  });
});
