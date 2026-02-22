/**
 * KyberBot — ASCII Splash Screen
 *
 * Displays the startup banner and service status.
 * Design matches Samantha's visual style: block-letter ASCII,
 * emerald green borders, 76-char width.
 */

import chalk from 'chalk';
import { ServiceStatus } from './types.js';
import { getAgentName } from './config.js';

// Color palette — matches Samantha's design language
const EMERALD = chalk.hex('#50C878');  // Primary — borders, logo, branding
const PRIMARY = chalk.hex('#FF6B6B');  // Warm — ready message, agent name
const ACCENT = chalk.hex('#FFE66D');   // Yellow — URLs, highlights
const DIM = chalk.dim;

const WIDTH = 76;

const KYBERBOT_ASCII = `
██╗  ██╗██╗   ██╗██████╗ ███████╗██████╗ ██████╗  ██████╗ ████████╗
██║ ██╔╝╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔═══██╗╚══██╔══╝
█████╔╝  ╚████╔╝ ██████╔╝█████╗  ██████╔╝██████╔╝██║   ██║   ██║
██╔═██╗   ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██╗██╔══██╗██║   ██║   ██║
██║  ██╗   ██║   ██████╔╝███████╗██║  ██║██████╔╝╚██████╔╝   ██║
╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝  ╚═════╝    ╚═╝`;

const BORDER_TOP = '╔' + '═'.repeat(WIDTH) + '╗';
const BORDER_BOTTOM = '╚' + '═'.repeat(WIDTH) + '╝';
const BORDER_SIDE = '║';

function centerText(text: string, width: number = WIDTH): string {
  const stripped = text.replace(/\x1B\[[0-9;]*[mK]/g, '');
  const padding = Math.max(0, Math.floor((width - stripped.length) / 2));
  return ' '.repeat(padding) + text;
}

function padLine(text: string, width: number = WIDTH): string {
  const stripped = text.replace(/\x1B\[[0-9;]*[mK]/g, '');
  const padding = Math.max(0, width - stripped.length);
  return text + ' '.repeat(padding);
}

export function displaySplash(root: string): void {
  console.clear();

  // Top border
  console.log(EMERALD(BORDER_TOP));
  console.log(EMERALD(BORDER_SIDE) + ' '.repeat(WIDTH) + EMERALD(BORDER_SIDE));

  // ASCII logo — each line centered and emerald
  const asciiLines = KYBERBOT_ASCII.trim().split('\n');
  for (const line of asciiLines) {
    const centered = centerText(line);
    console.log(EMERALD(BORDER_SIDE) + EMERALD(padLine(centered)) + EMERALD(BORDER_SIDE));
  }

  // Spacing
  console.log(EMERALD(BORDER_SIDE) + ' '.repeat(WIDTH) + EMERALD(BORDER_SIDE));

  // Tagline
  const tagline = EMERALD('Your AI.') + DIM(' Your rules. Powered by Claude Code.');
  console.log(EMERALD(BORDER_SIDE) + padLine(centerText(tagline)) + EMERALD(BORDER_SIDE));

  // Spacing + bottom border
  console.log(EMERALD(BORDER_SIDE) + ' '.repeat(WIDTH) + EMERALD(BORDER_SIDE));
  console.log(EMERALD(BORDER_BOTTOM));

  console.log();

  // Metadata below the border
  let agentName: string;
  try {
    agentName = getAgentName();
  } catch {
    agentName = 'KyberBot';
  }

  console.log(DIM('  Agent: ') + chalk.white(agentName));
  console.log(DIM('  Root:  ') + chalk.white(root));
  console.log();
}

export function displayServiceStatus(services: ServiceStatus[]): void {
  const maxNameLength = Math.max(...services.map(s => s.name.length));

  for (const service of services) {
    const name = service.name.padEnd(maxNameLength + 2);
    const statusIcon = getStatusIcon(service.status);
    const statusText = getStatusText(service.status);
    const extra = service.extra ? DIM(` ${service.extra}`) : '';

    console.log(`  ${statusIcon} ${name} ${statusText}${extra}`);
  }
  console.log();
}

function getStatusIcon(status: ServiceStatus['status']): string {
  switch (status) {
    case 'running': return chalk.green('✓');
    case 'starting': return chalk.yellow('◐');
    case 'stopped': return chalk.gray('○');
    case 'error': return chalk.red('✗');
    case 'disabled': return chalk.gray('─');
  }
}

function getStatusText(status: ServiceStatus['status']): string {
  switch (status) {
    case 'running': return chalk.green('[RUNNING]');
    case 'starting': return chalk.yellow('[STARTING]');
    case 'stopped': return chalk.gray('[STOPPED]');
    case 'error': return chalk.red('[ERROR]');
    case 'disabled': return chalk.gray('[DISABLED]');
  }
}

export function displayShutdownMessage(): void {
  console.log();
  console.log(DIM('  Shutting down...'));
}

export function displayReadyMessage(): void {
  let agentName: string;
  try {
    agentName = getAgentName();
  } catch {
    agentName = 'KyberBot';
  }

  console.log(DIM('═'.repeat(WIDTH + 2)));
  console.log();
  console.log('  ' + PRIMARY.bold(`${agentName} is ready.`));
  console.log();
  console.log(DIM('═'.repeat(WIDTH + 2)));
  console.log();
}
