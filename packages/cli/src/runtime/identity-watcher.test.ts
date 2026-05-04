/**
 * KyberBot — identity.yaml watcher tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { watchIdentity } from './identity-watcher.js';

const handles: Array<{ stop: () => void }> = [];
const dirs: string[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpWithIdentity(initial: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kyberbot-idwatch-'));
  writeFileSync(join(dir, 'identity.yaml'), initial);
  dirs.push(dir);
  return dir;
}

describe('watchIdentity', () => {
  it('is a no-op when identity.yaml is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kyberbot-idwatch-empty-'));
    dirs.push(dir);
    const w = watchIdentity(dir);
    handles.push(w);
    // Stop should not throw
    expect(() => w.stop()).not.toThrow();
  });

  it('fires onReload after a debounced change', async () => {
    const dir = tmpWithIdentity('agent_name: a\ntimezone: UTC\nheartbeat_interval: 1h\n');
    let reloaded = false;
    const w = watchIdentity(dir, { onReload: () => { reloaded = true; } });
    handles.push(w);

    // Trigger a write
    writeFileSync(join(dir, 'identity.yaml'), 'agent_name: a\ntimezone: UTC\nheartbeat_interval: 30m\n');

    // Wait past two poll cycles (1s interval) so the change is detected
    await new Promise(r => setTimeout(r, 4500));
    expect(reloaded).toBe(true);
  });

  it('fires onError on invalid YAML and keeps watching', async () => {
    const dir = tmpWithIdentity('agent_name: a\ntimezone: UTC\nheartbeat_interval: 1h\n');
    let lastError: Error | null = null;
    let reloads = 0;
    const w = watchIdentity(dir, {
      onReload: () => { reloads++; },
      onError: (err) => { lastError = err; },
    });
    handles.push(w);

    writeFileSync(join(dir, 'identity.yaml'), 'agent_name: [unclosed');
    await new Promise(r => setTimeout(r, 4500));
    expect(lastError).not.toBeNull();

    // Subsequent valid write should still produce a reload
    writeFileSync(join(dir, 'identity.yaml'), 'agent_name: a\ntimezone: UTC\nheartbeat_interval: 5m\n');
    await new Promise(r => setTimeout(r, 4500));
    expect(reloads).toBeGreaterThanOrEqual(1);
  });
});
