/**
 * Central IPC handler registration.
 */

import { ipcMain, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { IPC } from '../../types/ipc.js';
import { LifecycleManager } from '../lifecycle.js';
import { AppStore } from '../store.js';
import { registerPrerequisiteHandlers } from './prerequisites.js';
import { registerServiceHandlers } from './services.js';
import { registerConfigHandlers } from './config.js';
import { registerLogHandlers } from './logs.js';
import { registerOnboardingHandlers } from './onboarding.js';

export function setupIpcHandlers(
  lifecycle: LifecycleManager,
  store: AppStore,
  getMainWindow: () => BrowserWindow | null,
): void {
  // Brain pop-out window
  let brainWindow: BrowserWindow | null = null;
  ipcMain.handle('brain:popout', () => {
    if (brainWindow && !brainWindow.isDestroyed()) {
      brainWindow.focus();
      return;
    }
    brainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'KyberBot — Brain Graph',
      backgroundColor: '#0a0a0a',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false,
      },
    });

    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
      const url = (process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173').replace(/\/$/, '');
      brainWindow.loadURL(`${url}/brain.html`);
    } else {
      brainWindow.loadFile(join(__dirname, '../../dist/brain.html'));
    }

    brainWindow.on('closed', () => { brainWindow = null; });
  });
  // Window controls (fire-and-forget)
  ipcMain.on(IPC.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on(IPC.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.isMaximized() ? win.unmaximize() : win?.maximize();
  });
  ipcMain.on(IPC.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // Domain handlers
  registerPrerequisiteHandlers(store);
  registerServiceHandlers(lifecycle, getMainWindow);
  registerConfigHandlers(store);
  registerLogHandlers(lifecycle, getMainWindow);
  registerOnboardingHandlers(store);
}
