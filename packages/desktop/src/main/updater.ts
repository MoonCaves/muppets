/**
 * Auto-updater via electron-updater + GitHub Releases.
 */

import { autoUpdater } from 'electron-updater';
import { BrowserWindow, dialog } from 'electron';

export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  // Don't check in development
  if (process.env.NODE_ENV === 'development') return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const win = getMainWindow();
    if (!win) return;

    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Available',
      message: `KyberBot ${info.version} is available. Download now?`,
      buttons: ['Download', 'Later'],
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', () => {
    const win = getMainWindow();
    if (!win) return;

    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded. Restart to apply?',
      buttons: ['Restart', 'Later'],
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // Check after 10 second delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silently fail if no GitHub releases configured
    });
  }, 10_000);
}
