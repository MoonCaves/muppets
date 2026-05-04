/**
 * KyberBot — AGENT.md Hooks Runner
 *
 * Symphony §9.4 hooks model: short shell scripts authored in AGENT.md
 * front matter that fire at named points in the run lifecycle. Failure
 * semantics differ per hook (some are fatal, some are best-effort).
 *
 * Security note: hooks run with the fleet process's uid and full
 * filesystem access. They are authored by the agent owner; we do not
 * sandbox. This matches Symphony's documented baseline. Document this
 * loudly in any user-facing migration guide.
 */

import { spawn } from 'child_process';
import { createLogger } from '../logger.js';

const logger = createLogger('hooks');

const DEFAULT_HOOK_TIMEOUT_MS = 60_000;

export type HookName = 'after_create' | 'before_run' | 'after_run' | 'before_remove';

export interface HookResult {
  name: HookName;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  error?: string;
}

export interface RunHookOptions {
  cwd: string;
  timeoutMs?: number;
  /** Extra env to merge over process.env. */
  env?: Record<string, string>;
}

/**
 * Run a single hook script. Always returns a result; never throws — the
 * caller decides whether to treat failures as fatal based on hook semantics.
 */
export function runHook(name: HookName, script: string, opts: RunHookOptions): Promise<HookResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const start = Date.now();

  return new Promise<HookResult>((resolve) => {
    const child = spawn('bash', ['-lc', script], {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk.toString('utf-8')));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf-8')));

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        name,
        success: false,
        exitCode: null,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        durationMs: Date.now() - start,
        timedOut,
        error: String(err),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const success = !timedOut && code === 0;
      resolve({
        name,
        success,
        exitCode: code,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        durationMs: Date.now() - start,
        timedOut,
      });
    });
  });
}

/**
 * Whether a hook's failure is fatal to the surrounding lifecycle event.
 * Symphony §9.4 failure semantics:
 *   - after_create: fatal to workspace creation
 *   - before_run:   fatal to the run attempt
 *   - after_run:    logged, ignored
 *   - before_remove: logged, ignored (cleanup proceeds)
 */
export function isFatalHook(name: HookName): boolean {
  return name === 'after_create' || name === 'before_run';
}

/**
 * Convenience wrapper: read AGENT.md hooks from a config blob, run a named
 * hook if defined, return null when undefined. The caller decides what to
 * do with the HookResult based on isFatalHook(name).
 */
export interface HooksConfig {
  after_create?: string;
  before_run?: string;
  after_run?: string;
  before_remove?: string;
  timeout_ms?: number;
  /**
   * Opt in to the strict Symphony §9.4 semantic where a failed before_run
   * aborts the run attempt. Default false — failures are logged in
   * phase_history and the run continues.
   */
  fatal_on_before_run?: boolean;
}

export async function runConfiguredHook(
  name: HookName,
  hooks: HooksConfig | undefined,
  opts: { cwd: string; env?: Record<string, string> },
): Promise<HookResult | null> {
  const script = hooks?.[name];
  if (!script || typeof script !== 'string' || script.trim() === '') return null;

  const result = await runHook(name, script, {
    cwd: opts.cwd,
    timeoutMs: hooks?.timeout_ms,
    env: opts.env,
  });

  if (result.success) {
    logger.info(`hook ${name} succeeded`, { durationMs: result.durationMs });
  } else {
    logger.warn(`hook ${name} failed`, {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stderrPreview: result.stderr.slice(0, 200),
    });
  }
  return result;
}
