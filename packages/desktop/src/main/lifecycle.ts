/**
 * CLI child process lifecycle manager.
 *
 * Spawns `kyberbot run` as a child process, monitors health via HTTP,
 * and manages graceful shutdown. The desktop never imports CLI internals —
 * this is the boundary.
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { join } from 'path';
import { existsSync, createWriteStream, mkdirSync, WriteStream } from 'fs';
import { EventEmitter } from 'events';
import { AppStore } from './store.js';
import type { HealthData } from '../types/ipc.js';

type CliStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

export class LifecycleManager extends EventEmitter {
  private store: AppStore;
  private process: ChildProcess | null = null;
  private _status: CliStatus = 'stopped';
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealth: HealthData | null = null;
  private logStream: WriteStream | null = null;
  private stdoutBuffer: string[] = [];
  private readonly MAX_BUFFER_LINES = 1000;
  private restartCount = 0;
  private readonly MAX_RESTARTS = 10;
  private attached = false; // true if we attached to an external server (don't kill on quit)

  constructor(store: AppStore) {
    super();
    this.store = store;
  }

  get status(): CliStatus {
    return this._status;
  }

  getHealth(): HealthData | null {
    return this.lastHealth;
  }

  isRunning(): boolean {
    return this._status === 'running' || this._status === 'starting';
  }

  getRecentLogs(): string[] {
    return [...this.stdoutBuffer];
  }

  async startCli(): Promise<void> {
    if (this.process) return;

    // Check if a server is already running on the expected port
    try {
      const port = this.getServerPort();
      const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        // Server already running (started externally or from a previous session)
        console.log('[lifecycle] Server already running on port', port, '— attaching');
        this._status = 'running';
        this.attached = true;
        this.emit('status-change', this._status);
        this.startHealthPolling();
        return;
      }
    } catch {
      // No server running, proceed to spawn
    }

    this.restartCount = 0;
    this.spawnProcess();
  }

  async stopCli(): Promise<void> {
    this.stopHealthPolling();

    if (!this.process) {
      // We were attached to an external server — don't kill it
      if (this.attached) {
        console.log('[lifecycle] Detaching from external server (not killing)');
        this._status = 'stopped';
        this.attached = false;
        this.emit('status-change', this._status);
      }
      return;
    }
    this._status = 'stopping';
    this.emit('status-change', this._status);
    console.log('[lifecycle] Sending SIGTERM to CLI process...');

    this.process.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) this.process.kill('SIGKILL');
        resolve();
      }, 10_000);

      this.process?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.process = null;
    this.logStream?.end();
    this.logStream = null;
    this._status = 'stopped';
    this.emit('status-change', this._status);
  }

  private spawnProcess(): void {
    const agentRoot = this.store.getAgentRoot();
    if (!agentRoot) throw new Error('Agent root not configured');

    this._status = 'starting';
    this.emit('status-change', this._status);

    const cliPath = this.resolveCliPath();

    // Ensure logs directory
    const logDir = join(agentRoot, 'logs');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

    const logPath = join(logDir, 'desktop-cli.log');
    this.logStream = createWriteStream(logPath, { flags: 'a' });

    // Spawn kyberbot directly (it has its own shebang with node + max-old-space-size)
    const fullPath = this.getFullPath();
    this.process = spawn(cliPath, ['run'], {
      cwd: agentRoot,
      env: {
        ...process.env,
        KYBERBOT_ROOT: agentRoot,
        KYBERBOT_CHILD: '1', // Disables CLI's built-in watchdog (run.ts:64)
        NODE_ENV: 'production',
        PATH: fullPath, // Full PATH including nvm/homebrew for packaged app
        FORCE_COLOR: '3', // Force chalk to output full 24-bit ANSI color codes even when piped
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.pushLogLine(line);
        this.logStream?.write(line + '\n');
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.pushLogLine(`[stderr] ${line}`);
        this.logStream?.write(`[stderr] ${line}\n`);
      }
    });

    this.process.on('error', (error: Error) => {
      this._status = 'crashed';
      this.emit('status-change', this._status);
      this.emit('error', error.message);
    });

    this.process.on('exit', (code) => {
      this.process = null;
      this.logStream?.end();
      this.logStream = null;

      if (this._status === 'stopping') {
        this._status = 'stopped';
        this.emit('status-change', this._status);
        return;
      }

      this._status = 'crashed';
      this.emit('status-change', this._status);
      this.emit('error', `CLI exited with code ${code}`);

      if (code !== 0 && this.restartCount < this.MAX_RESTARTS) {
        this.restartCount++;
        const delay = this.restartCount > 3 ? 10_000 : 2_000;
        setTimeout(() => this.spawnProcess(), delay);
      }
    });

    // Start health polling after startup delay
    setTimeout(() => this.startHealthPolling(), 3000);
  }

  private startHealthPolling(): void {
    this.stopHealthPolling();

    const poll = async () => {
      try {
        const port = this.getServerPort();
        const response = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        const data = await response.json() as HealthData;
        this.lastHealth = data;

        if (this._status === 'starting') {
          this._status = 'running';
          this.emit('status-change', this._status);
        }

        this.emit('health-update', data);
      } catch {
        if (this._status === 'running') {
          const offlineHealth: HealthData = {
            status: 'offline',
            timestamp: new Date().toISOString(),
            uptime: '0s',
            channels: [],
            services: [],
            errors: 0,
            memory: {},
            pid: 0,
            node_version: '',
          };
          this.lastHealth = offlineHealth;
          this.emit('health-update', offlineHealth);
        }
      }
    };

    poll();
    this.healthTimer = setInterval(poll, 5000);
  }

  private stopHealthPolling(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private getServerPort(): number {
    const agentRoot = this.store.getAgentRoot();
    if (!agentRoot) return 3456;
    try {
      const yaml = require('js-yaml');
      const fs = require('fs');
      const identity = yaml.load(fs.readFileSync(join(agentRoot, 'identity.yaml'), 'utf-8'));
      return identity?.server?.port ?? 3456;
    } catch {
      return 3456;
    }
  }

  /**
   * Build a full PATH that includes common Node/nvm/homebrew locations.
   * Electron's packaged app doesn't inherit the user's shell PATH.
   */
  private getFullPath(): string {
    const home = process.env.HOME || '';
    const existing = process.env.PATH || '';
    const extras = [
      join(home, '.local/bin'),          // claude CLI installs here
      '/usr/local/bin',
      '/opt/homebrew/bin',
      join(home, '.npm-global/bin'),
      join(home, '.yarn/bin'),
      '/usr/bin',
      '/bin',
    ];

    // Find nvm node versions — put the HIGHEST version first
    // (kyberbot is compiled against the latest node, better-sqlite3
    // native module must match the node version that runs it)
    const nvmDir = join(home, '.nvm/versions/node');
    const nvmPaths: string[] = [];
    try {
      const versions = require('fs').readdirSync(nvmDir) as string[];
      // Sort descending so newest node is first on PATH
      versions.sort((a: string, b: string) => {
        const va = a.replace('v', '').split('.').map(Number);
        const vb = b.replace('v', '').split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
        }
        return 0;
      });
      for (const v of versions) {
        nvmPaths.push(join(nvmDir, v, 'bin'));
      }
    } catch { /* nvm not installed */ }

    const allPaths = [...nvmPaths, ...extras, ...existing.split(':')];
    return [...new Set(allPaths)].join(':');
  }

  private resolveCliPath(): string {
    const fullPath = this.getFullPath();

    // Try `which kyberbot` with full PATH
    try {
      const globalPath = execSync('which kyberbot', {
        encoding: 'utf-8',
        env: { ...process.env, PATH: fullPath },
      }).trim();
      if (globalPath) return globalPath;
    } catch { /* not found */ }

    // Check common global install locations directly
    const home = process.env.HOME || '';
    const candidates = [
      // nvm installs
      ...(() => {
        try {
          const nvmDir = join(home, '.nvm/versions/node');
          return require('fs').readdirSync(nvmDir).map((v: string) => join(nvmDir, v, 'bin', 'kyberbot'));
        } catch { return []; }
      })(),
      '/usr/local/bin/kyberbot',
      '/opt/homebrew/bin/kyberbot',
      join(home, '.npm-global/bin/kyberbot'),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }

    // Check agent root node_modules
    const agentRoot = this.store.getAgentRoot();
    if (agentRoot) {
      const localCli = join(agentRoot, 'node_modules', '@kyberbot', 'cli', 'dist', 'index.js');
      if (existsSync(localCli)) return localCli;
    }

    throw new Error('kyberbot CLI not found. Install with: npm install -g @kyberbot/cli');
  }

  private pushLogLine(line: string): void {
    this.stdoutBuffer.push(line);
    if (this.stdoutBuffer.length > this.MAX_BUFFER_LINES) {
      this.stdoutBuffer.shift();
    }
    this.emit('log-line', line);
  }
}
