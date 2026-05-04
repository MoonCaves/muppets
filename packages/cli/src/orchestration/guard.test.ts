/**
 * Guard tests — 4 fire cases + 2 silent cases + 1 guard/resolver-mismatch case = 7 total.
 */
import { describe, it, expect } from 'vitest';
import { assertOrchConfig, OrchConfigError } from './guard.js';
import type { IdentityConfig } from '../types.js';

const id = (overrides: Partial<IdentityConfig> = {}): IdentityConfig => ({
  agent_name: 'test-agent',
  timezone: 'UTC',
  heartbeat_interval: '1h',
  ...overrides,
});

describe('assertOrchConfig', () => {
  // ── FIRE cases (4) ──────────────────────────────────────────────────────────

  it('fires: orch on, both fields unset', () => {
    expect(() => assertOrchConfig('a', id(), true, '/root'))
      .toThrow(OrchConfigError);
  });

  it('fires: orch on, fields = sonnet', () => {
    const i = id({ ceo_model: 'sonnet', worker_model: 'sonnet' });
    expect(() => assertOrchConfig('a', i, true, '/root'))
      .toThrow(/ceo_model=sonnet/);
  });

  it('fires: orch on, fields = haiku (rejected — too weak for orch)', () => {
    const i = id({ ceo_model: 'haiku', worker_model: 'haiku' });
    expect(() => assertOrchConfig('a', i, true, '/root'))
      .toThrow(/ceo_model=haiku/);
  });

  it('fires: orch on, only ceo_model opus — worker unset', () => {
    const i = id({ ceo_model: 'opus' /* worker_model unset */ });
    expect(() => assertOrchConfig('a', i, true, '/root'))
      .toThrow(/worker_model=unset/);
  });

  // ── SILENT cases (2) ────────────────────────────────────────────────────────

  it('silent: orch off, regardless of model fields', () => {
    // Both bad models + orch disabled = no throw
    expect(() => assertOrchConfig('a', id(), false, '/root')).not.toThrow();
    const i = id({ ceo_model: 'sonnet', worker_model: 'sonnet' });
    expect(() => assertOrchConfig('a', i, false, '/root')).not.toThrow();
  });

  it('silent: orch on, both fields opus', () => {
    const i = id({ ceo_model: 'opus', worker_model: 'opus' });
    expect(() => assertOrchConfig('a', i, true, '/root')).not.toThrow();
  });

  // ── GUARD/RESOLVER MISMATCH — explicit verification (HOLE 2 from spec review) ──

  it('fires: orch on, heartbeat_model=opus but ceo/worker unset (guard does NOT honor legacy fallback)', () => {
    // This is the silent-drift case the guard exists to surface.
    // The resolver would fall back to heartbeat_model and return opus.
    // The guard must NOT follow that path — it reads raw fields only.
    const i = id({ heartbeat_model: 'opus' /* ceo_model + worker_model unset */ });
    const err = (() => {
      try { assertOrchConfig('a', i, true, '/root'); return null; }
      catch (e) { return e; }
    })();
    expect(err).toBeInstanceOf(OrchConfigError);
    // Error message must mention "explicit" config to signal the guard's intent.
    expect((err as Error).message).toMatch(/explicit/i);
  });
});
