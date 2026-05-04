/**
 * KyberBot — loop-detection config + cross-run continuation tests
 *
 * The actual subprocess streaming hook in claude.ts is hard to unit-test
 * without a real Claude CLI, but the config plumbing and the threshold
 * logic itself are pure and worth pinning down.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getLoopDetectionConfigForRoot,
  getSubprocessRetryConfigForRoot,
  getHeartbeatMaxInnerTurnsForRoot,
  getHeartbeatModelForRoot,
  clearIdentityCache,
} from '../config.js';

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'kyberbot-loop-cfg-'));
});

afterEach(() => {
  clearIdentityCache(tempRoot);
  rmSync(tempRoot, { recursive: true, force: true });
});

function writeIdentity(yaml: string): void {
  writeFileSync(join(tempRoot, 'identity.yaml'), yaml);
  clearIdentityCache(tempRoot);
}

describe('getLoopDetectionConfigForRoot', () => {
  it('returns enabled defaults when not configured', () => {
    writeIdentity('agent_name: t\ntimezone: UTC\nheartbeat_interval: 1h\n');
    const cfg = getLoopDetectionConfigForRoot(tempRoot);
    expect(cfg).toEqual({ enabled: true, maxIdenticalToolCalls: 3, maxConsecutiveToolErrors: 5 });
  });

  it('honors explicit thresholds', () => {
    writeIdentity(`agent_name: t
timezone: UTC
heartbeat_interval: 1h
loop_detection:
  enabled: true
  max_identical_tool_calls: 5
  max_consecutive_tool_errors: 8
`);
    const cfg = getLoopDetectionConfigForRoot(tempRoot);
    expect(cfg.maxIdenticalToolCalls).toBe(5);
    expect(cfg.maxConsecutiveToolErrors).toBe(8);
  });

  it('disables when enabled: false', () => {
    writeIdentity(`agent_name: t
timezone: UTC
heartbeat_interval: 1h
loop_detection:
  enabled: false
`);
    expect(getLoopDetectionConfigForRoot(tempRoot).enabled).toBe(false);
  });

  it('floors invalid thresholds to defaults', () => {
    writeIdentity(`agent_name: t
timezone: UTC
heartbeat_interval: 1h
loop_detection:
  max_identical_tool_calls: 0
  max_consecutive_tool_errors: -3
`);
    const cfg = getLoopDetectionConfigForRoot(tempRoot);
    expect(cfg.maxIdenticalToolCalls).toBe(3);
    expect(cfg.maxConsecutiveToolErrors).toBe(5);
  });
});

describe('getSubprocessRetryConfigForRoot', () => {
  it('returns Symphony §8.4-style defaults', () => {
    writeIdentity('agent_name: t\ntimezone: UTC\nheartbeat_interval: 1h\n');
    const r = getSubprocessRetryConfigForRoot(tempRoot);
    expect(r.maxAttempts).toBe(3);
    expect(r.baseBackoffMs).toBe(10_000);
    expect(r.maxBackoffMs).toBe(300_000);
  });

  it('honors per-agent overrides', () => {
    writeIdentity(`agent_name: t
timezone: UTC
heartbeat_interval: 1h
worker_subprocess_retry:
  max_attempts: 5
  base_backoff_ms: 1000
  max_backoff_ms: 60000
`);
    const r = getSubprocessRetryConfigForRoot(tempRoot);
    expect(r.maxAttempts).toBe(5);
    expect(r.baseBackoffMs).toBe(1000);
    expect(r.maxBackoffMs).toBe(60000);
  });
});

describe('getHeartbeatMaxInnerTurnsForRoot', () => {
  it('defaults to 50', () => {
    writeIdentity('agent_name: t\ntimezone: UTC\nheartbeat_interval: 1h\n');
    expect(getHeartbeatMaxInnerTurnsForRoot(tempRoot)).toBe(50);
  });

  it('honors explicit value', () => {
    writeIdentity('agent_name: t\ntimezone: UTC\nheartbeat_interval: 1h\nheartbeat_max_inner_turns: 80\n');
    expect(getHeartbeatMaxInnerTurnsForRoot(tempRoot)).toBe(80);
  });
});

describe('getHeartbeatModelForRoot', () => {
  it('defaults to opus', () => {
    writeIdentity('agent_name: t\ntimezone: UTC\nheartbeat_interval: 1h\n');
    expect(getHeartbeatModelForRoot(tempRoot)).toBe('opus');
  });

  it('honors explicit haiku/sonnet/opus', () => {
    writeIdentity('agent_name: t\ntimezone: UTC\nheartbeat_interval: 1h\nheartbeat_model: sonnet\n');
    expect(getHeartbeatModelForRoot(tempRoot)).toBe('sonnet');
  });

  it('falls back to opus on invalid value', () => {
    writeIdentity('agent_name: t\ntimezone: UTC\nheartbeat_interval: 1h\nheartbeat_model: gpt5\n');
    expect(getHeartbeatModelForRoot(tempRoot)).toBe('opus');
  });
});
