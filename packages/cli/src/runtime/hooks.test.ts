/**
 * KyberBot — hook runner tests
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runHook, runConfiguredHook, isFatalHook } from './hooks.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'kyberbot-hooks-'));
}

describe('runHook', () => {
  it('captures stdout and exit code on success', async () => {
    const dir = tmpDir();
    try {
      const result = await runHook('before_run', 'echo hello', { cwd: dir });
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/hello/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('captures non-zero exit codes', async () => {
    const dir = tmpDir();
    try {
      const result = await runHook('before_run', 'exit 7', { cwd: dir });
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(7);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('runs in the configured cwd', async () => {
    const dir = tmpDir();
    try {
      const result = await runHook('before_run', 'pwd > marker.txt', { cwd: dir });
      expect(result.success).toBe(true);
      expect(existsSync(join(dir, 'marker.txt'))).toBe(true);
      const contents = readFileSync(join(dir, 'marker.txt'), 'utf-8').trim();
      // macOS may resolve /var → /private/var
      expect(contents.endsWith(dir.replace(/^\/var/, '/private/var')) || contents.endsWith(dir)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('passes env vars through', async () => {
    const dir = tmpDir();
    try {
      const result = await runHook('before_run', 'echo $KYBER_TEST_VAR', {
        cwd: dir,
        env: { KYBER_TEST_VAR: 'banana' },
      });
      expect(result.stdout).toMatch(/banana/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('kills runaway scripts at timeout', async () => {
    const dir = tmpDir();
    try {
      const result = await runHook('before_run', 'sleep 10', { cwd: dir, timeoutMs: 200 });
      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('runConfiguredHook', () => {
  it('returns null when hook is undefined', async () => {
    const dir = tmpDir();
    try {
      const r = await runConfiguredHook('before_run', {}, { cwd: dir });
      expect(r).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('runs when hook is defined', async () => {
    const dir = tmpDir();
    try {
      const r = await runConfiguredHook('before_run', { before_run: 'echo ok' }, { cwd: dir });
      expect(r).not.toBeNull();
      expect(r!.success).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('isFatalHook', () => {
  it('classifies hooks per Symphony §9.4', () => {
    expect(isFatalHook('after_create')).toBe(true);
    expect(isFatalHook('before_run')).toBe(true);
    expect(isFatalHook('after_run')).toBe(false);
    expect(isFatalHook('before_remove')).toBe(false);
  });
});
