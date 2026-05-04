/**
 * KyberBot — identity.yaml Hot-Reload Watcher
 *
 * Watches an agent's identity.yaml file and invalidates the cached config
 * on change so the next heartbeat dispatch picks up the new values. We
 * deliberately do NOT interrupt in-flight runs — they finish on their
 * original config — matching Symphony §6.2's "implementations are not
 * REQUIRED to restart in-flight agent sessions automatically when config
 * changes".
 *
 * On invalid reload (YAML or read error), the previous cached config
 * stays active and the watcher fires onError so the desktop can surface
 * the problem without crashing the fleet.
 */

import { watchFile, unwatchFile, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type { IdentityConfig } from '../types.js';
import { clearIdentityCache } from '../config.js';
import { createLogger } from '../logger.js';

const logger = createLogger('identity-watcher');

// Poll interval for watchFile. Polling is reliable across platforms
// (macOS fs.watch is famously inconsistent on single files), and the
// 1s cadence is fine since identity.yaml changes are rare and the next
// dispatch — not the watcher — is the consumer.
const POLL_INTERVAL_MS = 1000;

export interface IdentityWatcher {
  stop: () => void;
}

export interface IdentityWatcherCallbacks {
  /** Fired with the freshly parsed identity after a successful reload. */
  onReload?: (identity: IdentityConfig) => void;
  /** Fired when reload fails — the previous cached config stays active. */
  onError?: (err: Error) => void;
}

/**
 * Start watching `<root>/identity.yaml`. No-op when the file doesn't exist
 * at start time (the runtime resolves missing-file failures up front).
 */
export function watchIdentity(root: string, callbacks: IdentityWatcherCallbacks = {}): IdentityWatcher {
  const path = join(root, 'identity.yaml');
  if (!existsSync(path)) {
    return { stop: () => { /* no-op */ } };
  }

  const onChange = () => {
    try {
      const raw = readFileSync(path, 'utf-8');
      const parsed = yaml.load(raw) as IdentityConfig;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('identity.yaml did not parse as a YAML map');
      }
      clearIdentityCache(root);
      logger.info('identity.yaml reloaded', { root });
      callbacks.onReload?.(parsed);
    } catch (err) {
      logger.warn('identity.yaml reload failed — keeping previous config', {
        root,
        error: String(err),
      });
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  try {
    watchFile(path, { interval: POLL_INTERVAL_MS, persistent: false }, (curr, prev) => {
      // mtime===0 means "no longer exists" — ignore (a re-create will fire again)
      if (curr.mtimeMs === 0) return;
      // Skip the initial stat callback (fires once on watch start with prev.mtimeMs===0)
      if (prev.mtimeMs === 0) return;
      if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
      onChange();
    });
  } catch (err) {
    logger.warn('Failed to start identity watcher', { root, error: String(err) });
    return { stop: () => { /* no-op */ } };
  }

  return {
    stop: () => {
      try { unwatchFile(path); } catch { /* ignore */ }
    },
  };
}
