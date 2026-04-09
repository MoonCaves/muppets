/**
 * SQLite Auto-Recovery
 *
 * Detects corrupted databases and recovers them automatically.
 * Used by all DB modules on initialization. The sql.js migration
 * (v1.3.0-v1.3.1) corrupted some databases via Buffer pooling.
 * This ensures affected users recover transparently on next startup.
 */

import Database from 'better-sqlite3';
import { existsSync, renameSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { createLogger } from '../logger.js';

const logger = createLogger('db-recovery');

/**
 * Open a SQLite database with automatic corruption recovery.
 * If the database is corrupted, attempts recovery via sqlite3 CLI,
 * then falls back to creating a fresh database.
 *
 * @param dbPath Full path to the .db file
 * @returns A healthy Database instance
 */
export function openWithRecovery(dbPath: string): Database.Database {
  // Try normal open + integrity check
  try {
    const db = new Database(dbPath);
    const check = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (check[0]?.integrity_check === 'ok') {
      return db; // Healthy
    }
    db.close();
    logger.warn(`Database corruption detected: ${dbPath}`);
  } catch (err) {
    logger.warn(`Database failed to open: ${dbPath}`, { error: String(err) });
  }

  // Attempt recovery via sqlite3 CLI (.recover command)
  const recoveredPath = dbPath + '.recovered';
  const corruptedPath = dbPath + '.corrupted';

  try {
    logger.info(`Attempting recovery of ${dbPath}...`);
    execSync(`sqlite3 "${dbPath}" ".recover" | sqlite3 "${recoveredPath}"`, {
      timeout: 30_000,
      stdio: 'pipe',
    });

    // Verify recovered DB
    const recoveredDb = new Database(recoveredPath);
    const check = recoveredDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    recoveredDb.close();

    if (check[0]?.integrity_check === 'ok') {
      // Swap files
      renameSync(dbPath, corruptedPath);
      renameSync(recoveredPath, dbPath);
      logger.info(`Recovery successful: ${dbPath} (corrupted file saved as .corrupted)`);
      return new Database(dbPath);
    }

    // Recovery produced another bad file
    unlinkSync(recoveredPath);
    logger.warn('Recovery produced invalid database — starting fresh');
  } catch (err) {
    logger.warn('Recovery via sqlite3 CLI failed', { error: String(err) });
    try { unlinkSync(recoveredPath); } catch { /* ignore */ }
  }

  // Last resort: rename corrupted file and start fresh
  try {
    if (existsSync(dbPath)) {
      renameSync(dbPath, corruptedPath);
    }
  } catch { /* ignore */ }

  logger.info(`Starting fresh database: ${dbPath}`);
  return new Database(dbPath);
}
