/**
 * KyberBot — worker continuation prompt tests
 *
 * The full runWorkerHeartbeat loop is hard to unit-test without mocking
 * Claude's subprocess client. We test the pure prompt builder here; the
 * loop control flow is covered by typecheck + integration in real fleets.
 */

import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt, type WorkerRunResult } from './worker-heartbeat.js';
import type { Issue } from './types.js';

const fakeIssue: Issue = {
  id: 42,
  title: 'Implement widget',
  description: 'Add a widget',
  goal_id: null,
  parent_id: null,
  project_id: null,
  assigned_to: 'atlas',
  created_by: 'kitt',
  status: 'in_progress',
  priority: 'high',
  labels: null,
  checkout_by: 'atlas',
  checkout_at: null,
  due_date: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('buildContinuationPrompt', () => {
  it('mentions the issue identifier and title', () => {
    const out = buildContinuationPrompt(fakeIssue, 'short output', 2, 5);
    expect(out).toContain('KYB-42');
    expect(out).toContain('Implement widget');
  });

  it('includes the previous output for short outputs verbatim', () => {
    const out = buildContinuationPrompt(fakeIssue, 'STATUS: IN_PROGRESS\nfinished step 1', 2, 5);
    expect(out).toContain('STATUS: IN_PROGRESS');
    expect(out).toContain('finished step 1');
  });

  it('truncates long outputs to the tail (where STATUS lives)', () => {
    const noise = 'x'.repeat(5000);
    const tail = '\nSTATUS: IN_PROGRESS\nstill have more to do';
    const out = buildContinuationPrompt(fakeIssue, noise + tail, 2, 5);
    expect(out).toContain('STATUS: IN_PROGRESS');
    expect(out).toContain('still have more to do');
    // Bulk noise should be cropped — the tail is at most 2000 chars
    expect(out).not.toContain(noise);
  });

  it('reports turn index and ceiling', () => {
    const out = buildContinuationPrompt(fakeIssue, 'x', 3, 7);
    expect(out).toMatch(/turn 3 of up to 7/);
  });

  it('tells the agent not to redo previously-completed work', () => {
    const out = buildContinuationPrompt(fakeIssue, 'x', 2, 5);
    expect(out).toMatch(/[Dd]o NOT redo/);
  });

  it('lists all four valid STATUS lines', () => {
    const out = buildContinuationPrompt(fakeIssue, 'x', 2, 5);
    expect(out).toContain('STATUS: DONE');
    expect(out).toContain('STATUS: IN_REVIEW');
    expect(out).toContain('STATUS: BLOCKED');
    expect(out).toContain('STATUS: IN_PROGRESS');
  });
});

// Compile-time guard: the WorkerRunResult shape is the public contract that
// queueWorkerHeartbeat keys its post-exit retry decision on. Breaking either
// the field names or the status enum is a wire-level change (orchestration-api
// returns it via /api/orch/* heartbeat endpoints).
describe('WorkerRunResult type', () => {
  it('accepts every documented status value', () => {
    const cases: WorkerRunResult[] = [
      { summary: 'no work', status: 'noop' },
      { summary: 'finished', status: 'done' },
      { summary: 'pending review', status: 'in_review' },
      { summary: 'stuck', status: 'blocked' },
      { summary: 'partial', status: 'in_progress' },
    ];
    expect(cases.length).toBe(5);
  });
});
