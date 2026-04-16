/**
 * KyberBot — Orchestration Activity Log
 *
 * Append-only audit trail for all orchestration events.
 * Every mutation (issue transition, goal update, comment, etc.)
 * logs an entry here for observability and debugging.
 */

import { getOrchDb } from './db.js';
import type { ActivityEntry } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════════════════

export function logActivity(entry: Omit<ActivityEntry, 'id' | 'created_at'>): void {
  const db = getOrchDb();
  db.prepare(`
    INSERT INTO activity_log (actor, action, entity_type, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    entry.actor,
    entry.action,
    entry.entity_type,
    entry.entity_id ?? null,
    entry.details ?? null,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════════════════════════

export interface ActivityFilters {
  actor?: string;
  entity_type?: string;
  entity_id?: string;
  limit?: number;
  after?: string;
}

export function getActivityLog(filters: ActivityFilters = {}): ActivityEntry[] {
  const db = getOrchDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.actor) {
    conditions.push('actor = ?');
    params.push(filters.actor);
  }
  if (filters.entity_type) {
    conditions.push('entity_type = ?');
    params.push(filters.entity_type);
  }
  if (filters.entity_id) {
    conditions.push('entity_id = ?');
    params.push(filters.entity_id);
  }
  if (filters.after) {
    conditions.push('created_at > ?');
    params.push(filters.after);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;

  return db.prepare(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit) as ActivityEntry[];
}
