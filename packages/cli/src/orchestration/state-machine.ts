/**
 * KyberBot — Issue State Machine
 *
 * Defines valid issue status transitions and their side effects.
 * All status changes go through this module to ensure consistency.
 */

import type { IssueStatus } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  backlog:     ['todo', 'cancelled'],
  todo:        ['in_progress', 'backlog', 'blocked', 'cancelled'],
  in_progress: ['in_review', 'done', 'blocked', 'todo', 'cancelled'],
  in_review:   ['done', 'in_progress', 'blocked', 'cancelled'],
  blocked:     ['todo', 'in_progress', 'cancelled'],
  done:        [],
  cancelled:   [],
};

export function isValidTransition(from: IssueStatus, to: IssueStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidTargets(from: IssueStatus): IssueStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}

export function isTerminal(status: IssueStatus): boolean {
  return status === 'done' || status === 'cancelled';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIDE EFFECTS
// ═══════════════════════════════════════════════════════════════════════════════

export type SideEffect =
  | { type: 'auto_checkout' }
  | { type: 'release_checkout' }
  | { type: 'clear_assignee' }
  | { type: 'log_activity'; action: string };

export function getTransitionSideEffects(from: IssueStatus, to: IssueStatus): SideEffect[] {
  const effects: SideEffect[] = [];

  // Every transition logs activity
  effects.push({ type: 'log_activity', action: `issue.transitioned.${from}_to_${to}` });

  switch (to) {
    case 'in_progress':
      effects.push({ type: 'auto_checkout' });
      break;

    case 'in_review':
    case 'done':
    case 'cancelled':
      effects.push({ type: 'release_checkout' });
      break;

    case 'blocked':
      effects.push({ type: 'release_checkout' });
      break;

    case 'backlog':
      effects.push({ type: 'release_checkout' });
      // Keep assignee when moving to backlog — allows re-triggering later
      break;

    case 'todo':
      effects.push({ type: 'release_checkout' });
      break;
  }

  return effects;
}
