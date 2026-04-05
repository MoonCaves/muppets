/**
 * Service lifecycle IPC handlers.
 * Proxies to the LifecycleManager for start/stop/status.
 * Pushes status-change events to the renderer.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../types/ipc.js';
import { LifecycleManager } from '../lifecycle.js';

export function registerServiceHandlers(
  lifecycle: LifecycleManager,
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(IPC.SERVICES_START, async () => {
    await lifecycle.startCli();
    return { ok: true, status: lifecycle.status };
  });

  ipcMain.handle(IPC.SERVICES_STOP, async () => {
    await lifecycle.stopCli();
    return { ok: true, status: lifecycle.status };
  });

  ipcMain.handle(IPC.SERVICES_STATUS, () => {
    return {
      status: lifecycle.status,
      health: lifecycle.getHealth(),
    };
  });

  // Push status changes to renderer so dashboard updates immediately
  lifecycle.on('status-change', (status: string) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('services:status-change', status);
    }
  });
}
