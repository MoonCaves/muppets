/**
 * Simple file-based settings store.
 * Replaces electron-store to avoid ESM/CJS conflicts.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

interface StoreData {
  agentRoot: string | null;
  windowBounds: Record<string, { x: number; y: number; width: number; height: number }>;
  autoStart: boolean;
}

const DEFAULTS: StoreData = {
  agentRoot: null,
  windowBounds: {},
  autoStart: true,
};

export class AppStore {
  private data: StoreData;
  private filePath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true });
    this.filePath = join(userDataPath, 'settings.json');

    try {
      this.data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      this.data = { ...DEFAULTS };
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  getAgentRoot(): string | null {
    return this.data.agentRoot ?? null;
  }

  setAgentRoot(path: string): void {
    this.data.agentRoot = path;
    this.save();
  }

  getWindowBounds(name: string): { x: number; y: number; width: number; height: number } | undefined {
    return this.data.windowBounds?.[name];
  }

  setWindowBounds(name: string, rect: { x: number; y: number; width: number; height: number }): void {
    if (!this.data.windowBounds) this.data.windowBounds = {};
    this.data.windowBounds[name] = rect;
    this.save();
  }

  getAutoStart(): boolean {
    return this.data.autoStart ?? true;
  }

  setAutoStart(value: boolean): void {
    this.data.autoStart = value;
    this.save();
  }
}
