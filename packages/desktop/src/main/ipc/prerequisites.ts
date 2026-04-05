/**
 * Prerequisite detection: Docker + Claude Code.
 * Both are required before the user can proceed.
 * Uses expanded PATH to find binaries in packaged app.
 */

import { ipcMain } from 'electron';
import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { IPC, PrerequisiteStatus } from '../../types/ipc.js';
import { AppStore } from '../store.js';

function getFullPath(): string {
  const home = process.env.HOME || '';
  const existing = process.env.PATH || '';
  const extras = [join(home, '.local/bin'), '/usr/local/bin', '/opt/homebrew/bin', join(home, '.npm-global/bin'), '/usr/bin', '/bin'];
  const nvmPaths: string[] = [];
  try {
    const nvmDir = join(home, '.nvm/versions/node');
    for (const v of readdirSync(nvmDir)) {
      nvmPaths.push(join(nvmDir, v, 'bin'));
    }
  } catch {}
  return [...new Set([...nvmPaths, ...extras, ...existing.split(':')])].join(':');
}

const fullPath = getFullPath();
const execOpts = { encoding: 'utf-8' as const, timeout: 10000, env: { ...process.env, PATH: fullPath }, stdio: 'pipe' as const };

export function registerPrerequisiteHandlers(store: AppStore): void {
  ipcMain.handle(IPC.PREREQ_CHECK, async (): Promise<PrerequisiteStatus> => {
    const docker = checkDocker();
    const claude = checkClaude();
    const kyberbot = checkKyberbot();
    const agentRoot = checkAgentRoot(store);
    return { docker, claude, kyberbot, agentRoot };
  });
}

function checkDocker(): PrerequisiteStatus['docker'] {
  try {
    const version = execSync('docker --version', execOpts).trim();
    try {
      execSync('docker info', execOpts);
      return { installed: true, running: true, version };
    } catch {
      return { installed: true, running: false, version };
    }
  } catch {
    return { installed: false, running: false, version: null };
  }
}

function checkClaude(): PrerequisiteStatus['claude'] {
  try {
    const version = execSync('claude --version', execOpts).trim();
    return { installed: true, version };
  } catch {
    return { installed: false, version: null };
  }
}

function checkKyberbot(): { installed: boolean; version: string | null } {
  try {
    const version = execSync('kyberbot --version', execOpts).trim();
    return { installed: true, version };
  } catch {
    return { installed: false, version: null };
  }
}

function checkAgentRoot(store: AppStore): PrerequisiteStatus['agentRoot'] {
  const path = store.getAgentRoot();
  if (!path) return { configured: false, path: null, hasIdentity: false };
  const hasIdentity = existsSync(join(path, 'identity.yaml'));
  return { configured: true, path, hasIdentity };
}
