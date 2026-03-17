/**
 * Run Command
 *
 * Start all 6 KyberBot services in order:
 *   1. ChromaDB check
 *   2. Server (Express + brain API)
 *   3. Heartbeat
 *   4. Sleep Agent
 *   5. Channels (if configured)
 *   6. Tunnel (optional ngrok tunnel)
 *
 * Usage:
 *   kyberbot                      # Start everything (default command)
 *   kyberbot run                  # Same as above
 *   kyberbot run --no-channels    # Skip channels
 *   kyberbot run --no-sleep       # Skip sleep agent
 *   kyberbot run --no-heartbeat   # Skip heartbeat
 *   kyberbot run -v               # Verbose logging
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getRoot, getAgentName, getServerPort, getIdentity } from '../config.js';
import { createLogger, setLogLevel } from '../logger.js';
import { initMonitoring } from '../monitoring.js';
import {
  registerService,
  startAllServices,
  stopAllServices,
  getServiceStatuses,
} from '../orchestrator.js';
import {
  displaySplash,
  displayServiceStatus,
  displayReadyMessage,
  displayConnectionInfo,
  displayShutdownMessage,
} from '../splash.js';
import { startTunnel, getTunnelUrl } from '../services/tunnel.js';

const logger = createLogger('cli');

interface RunOptions {
  channels: boolean;
  sleep: boolean;
  heartbeat: boolean;
  verbose: boolean;
}

export function createRunCommand(): Command {
  return new Command('run')
    .description('Start all KyberBot services')
    .option('--no-channels', 'Disable messaging channels')
    .option('--no-sleep', 'Disable sleep agent')
    .option('--no-heartbeat', 'Disable heartbeat service')
    .option('-v, --verbose', 'Enable verbose (debug) logging', false)
    .action(async (options: RunOptions) => {
      try {
        const root = getRoot();

        if (options.verbose) {
          setLogLevel('debug');
        }

        // Initialize monitoring (Sentry, process error handlers)
        await initMonitoring();

        // Show splash screen
        displaySplash(root);

        // ─────────────────────────────────────────────────────────────
        // Service 1: ChromaDB check
        // ─────────────────────────────────────────────────────────────

        registerService({
          name: 'ChromaDB',
          enabled: true,
          start: async () => {
            // Start the Docker container first, then initialize embeddings
            const { startChromaDB } = await import('../brain/chromadb.js');
            const handle = await startChromaDB(root);
            const chromaStatus = handle.status();

            if (chromaStatus === 'running' || chromaStatus === 'disabled') {
              // Container is up (or Docker unavailable) — now try embeddings
              const { initializeEmbeddings } = await import('../brain/embeddings.js');
              const embeddingsOk = await initializeEmbeddings();
              return {
                stop: handle.stop,
                status: () => embeddingsOk ? 'running' as const : handle.status() as 'running' | 'disabled' | 'error',
              };
            }

            return handle;
          },
        });

        // ─────────────────────────────────────────────────────────────
        // Service 2: Server (Express + brain API + channels)
        // ─────────────────────────────────────────────────────────────

        registerService({
          name: 'Server',
          enabled: true,
          start: async () => {
            const { startServer } = await import('../server/index.js');
            return startServer();
          },
        });

        // ─────────────────────────────────────────────────────────────
        // Service 3: Heartbeat
        // ─────────────────────────────────────────────────────────────

        registerService({
          name: 'Heartbeat',
          enabled: options.heartbeat,
          start: async () => {
            const { startHeartbeat } = await import('../services/heartbeat.js');
            return startHeartbeat();
          },
        });

        // ─────────────────────────────────────────────────────────────
        // Service 4: Sleep Agent
        // ─────────────────────────────────────────────────────────────

        registerService({
          name: 'Sleep Agent',
          enabled: options.sleep,
          start: async () => {
            const { startSleepAgent } = await import('../brain/sleep/index.js');
            return startSleepAgent(root);
          },
        });

        // ─────────────────────────────────────────────────────────────
        // Service 5: Channels
        // ─────────────────────────────────────────────────────────────

        registerService({
          name: 'Channels',
          enabled: options.channels,
          start: async () => {
            // Channels are initialized as part of the server startup.
            // This entry exists for visibility in the service dashboard.
            let running = true;
            return {
              stop: async () => { running = false; },
              status: () => running ? 'running' as const : 'stopped' as const,
            };
          },
        });

        // ─────────────────────────────────────────────────────────────
        // Service 6: Tunnel (optional ngrok tunnel)
        // ─────────────────────────────────────────────────────────────

        const identity = getIdentity();

        // ─────────────────────────────────────────────────────────────
        // Backup: auto-initialize git if configured but not set up
        // ─────────────────────────────────────────────────────────────

        if (identity.backup?.enabled) {
          const { spawnSync } = await import('node:child_process');
          const branch = identity.backup.branch || 'main';

          // Initialize git if not already a repo
          const gitCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
            cwd: root,
            stdio: 'pipe',
          });
          if (gitCheck.status !== 0) {
            logger.info('Backup configured but git not initialized — setting up...');
            spawnSync('git', ['init', '-b', branch], { cwd: root, stdio: 'pipe' });
            if (identity.backup.remote_url) {
              spawnSync('git', ['remote', 'add', 'origin', identity.backup.remote_url], {
                cwd: root,
                stdio: 'pipe',
              });
            }
          }

          // Create initial commit if repo has no commits yet
          const hasCommits = spawnSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            stdio: 'pipe',
          });
          if (hasCommits.status !== 0) {
            logger.info('Creating initial backup commit...');
            // Ensure we're on the right branch
            spawnSync('git', ['checkout', '-B', branch], { cwd: root, stdio: 'pipe' });
            spawnSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
            spawnSync('git', ['commit', '-m', 'Initial agent state'], {
              cwd: root,
              stdio: 'pipe',
            });
            if (identity.backup.remote_url) {
              const pushResult = spawnSync('git', ['push', '-u', 'origin', branch], {
                cwd: root,
                stdio: 'pipe',
                encoding: 'utf-8',
              });
              if (pushResult.status === 0) {
                logger.info('Initial state pushed to GitHub');
              } else {
                logger.warn('Could not push to remote — will retry on next backup run');
              }
            }
          }
        }

        const tunnelEnabled = identity.tunnel?.enabled === true;
        registerService({
          name: 'Tunnel',
          enabled: tunnelEnabled,
          start: async () => startTunnel(getServerPort()),
        });

        // ─────────────────────────────────────────────────────────────
        // Start all registered services
        // ─────────────────────────────────────────────────────────────

        await startAllServices();

        // Display status dashboard
        const statuses = getServiceStatuses();

        // Add backup status to dashboard (not a service, runs via heartbeat)
        if (identity.backup?.enabled) {
          statuses.push({
            name: 'Backup',
            status: 'running',
            extra: `every ${identity.backup.schedule || '4h'} → ${identity.backup.remote_url || 'GitHub'}`,
          });
        } else {
          statuses.push({ name: 'Backup', status: 'disabled' });
        }

        displayServiceStatus(statuses);
        displayReadyMessage();
        displayConnectionInfo({
          port: getServerPort(),
          apiToken: process.env.KYBERBOT_API_TOKEN || undefined,
          tunnelUrl: getTunnelUrl() || undefined,
        });

        // ─────────────────────────────────────────────────────────────
        // Graceful shutdown on SIGINT / SIGTERM
        // ─────────────────────────────────────────────────────────────

        let shuttingDown = false;

        const shutdown = async (signal: string) => {
          if (shuttingDown) return;
          shuttingDown = true;

          displayShutdownMessage();
          logger.info(`Received ${signal}, shutting down...`);

          await stopAllServices();
          process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

        // Keep the process alive indefinitely
        await new Promise<void>(() => {
          // The process stays alive until a signal is received
        });
      } catch (error) {
        logger.error('Failed to start', { error: String(error) });
        console.error(chalk.red(`\nFailed to start: ${error}`));
        console.error(chalk.dim('\nMake sure you have run `kyberbot onboard` first.'));
        process.exit(1);
      }
    });
}
