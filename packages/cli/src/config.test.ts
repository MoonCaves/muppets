import { describe, it, expect, beforeEach } from 'vitest';
import { parseDuration, resolveOrchModelFromIdentity, _resetOrchDeprecationFlag } from './config.js';
import type { IdentityConfig } from './types.js';

const baseId = (overrides: Partial<IdentityConfig> = {}): IdentityConfig => ({
  agent_name: 'test-agent',
  timezone: 'UTC',
  heartbeat_interval: '1h',
  ...overrides,
});

describe('parseDuration', () => {
  it('should parse seconds', () => {
    expect(parseDuration('5s')).toBe(5_000);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('1s')).toBe(1_000);
  });

  it('should parse minutes', () => {
    expect(parseDuration('1m')).toBe(60_000);
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('5m')).toBe(300_000);
  });

  it('should parse hours', () => {
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('24h')).toBe(86_400_000);
  });

  it('should parse days', () => {
    expect(parseDuration('1d')).toBe(86_400_000);
    expect(parseDuration('7d')).toBe(604_800_000);
  });

  it('should throw on invalid format', () => {
    expect(() => parseDuration('')).toThrow('Invalid duration');
    expect(() => parseDuration('abc')).toThrow('Invalid duration');
    expect(() => parseDuration('30')).toThrow('Invalid duration');
    expect(() => parseDuration('30x')).toThrow('Invalid duration');
    expect(() => parseDuration('m30')).toThrow('Invalid duration');
  });
});

describe('resolveOrchModelFromIdentity', () => {
  beforeEach(() => _resetOrchDeprecationFlag());

  it('back-compat: only heartbeat_model set → falls back to legacy field', () => {
    const id = baseId({ heartbeat_model: 'opus' });
    expect(resolveOrchModelFromIdentity(id, 'ceo_model')).toBe('opus');
    expect(resolveOrchModelFromIdentity(id, 'worker_model')).toBe('opus');
  });

  it('forward-compat: ceo/worker_model set → uses new explicit fields', () => {
    const id = baseId({ ceo_model: 'opus', worker_model: 'haiku' });
    expect(resolveOrchModelFromIdentity(id, 'ceo_model')).toBe('opus');
    expect(resolveOrchModelFromIdentity(id, 'worker_model')).toBe('haiku');
  });

  it('new wins over legacy: both present, explicit takes precedence', () => {
    const id = baseId({
      heartbeat_model: 'sonnet',
      ceo_model: 'opus',
      worker_model: 'opus',
    });
    expect(resolveOrchModelFromIdentity(id, 'ceo_model')).toBe('opus');
    expect(resolveOrchModelFromIdentity(id, 'worker_model')).toBe('opus');
  });

  it('nothing set: returns sonnet default', () => {
    const id = baseId();
    expect(resolveOrchModelFromIdentity(id, 'ceo_model')).toBe('sonnet');
    expect(resolveOrchModelFromIdentity(id, 'worker_model')).toBe('sonnet');
  });
});
