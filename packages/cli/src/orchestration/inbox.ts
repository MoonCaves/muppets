/**
 * KyberBot — Orchestration Human Inbox
 *
 * Escalation system for items needing human attention.
 * Agents create inbox items when they hit blockers, need decisions,
 * or want to report status. Humans review and respond.
 */

import { getOrchDb } from './db.js';
import { logActivity } from './activity.js';
import type { InboxItem, InboxUrgency, InboxStatus } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════════════════

export function createInboxItem(item: {
  source_agent: string;
  title: string;
  body?: string | null;
  urgency?: InboxUrgency;
  related_issue_id?: number | null;
}): InboxItem {
  const db = getOrchDb();
  const result = db.prepare(`
    INSERT INTO inbox (source_agent, title, body, urgency, related_issue_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    item.source_agent,
    item.title,
    item.body ?? null,
    item.urgency ?? 'normal',
    item.related_issue_id ?? null,
  );

  const id = Number(result.lastInsertRowid);

  logActivity({
    actor: item.source_agent,
    action: 'inbox.created',
    entity_type: 'inbox',
    entity_id: String(id),
    details: JSON.stringify({ title: item.title, urgency: item.urgency ?? 'normal' }),
  });

  return getInboxItem(id)!;
}

export function acknowledgeInboxItem(id: number): void {
  const db = getOrchDb();
  db.prepare('UPDATE inbox SET status = \'acknowledged\' WHERE id = ? AND status = \'pending\'')
    .run(id);

  logActivity({
    actor: 'human',
    action: 'inbox.acknowledged',
    entity_type: 'inbox',
    entity_id: String(id),
    details: null,
  });
}

export function resolveInboxItem(id: number, resolvedBy: string): void {
  const db = getOrchDb();
  db.prepare(`
    UPDATE inbox SET status = 'resolved', resolved_at = datetime('now'), resolved_by = ?
    WHERE id = ? AND status != 'resolved'
  `).run(resolvedBy, id);

  logActivity({
    actor: resolvedBy,
    action: 'inbox.resolved',
    entity_type: 'inbox',
    entity_id: String(id),
    details: null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════════════════════════

export function getInboxItem(id: number): InboxItem | null {
  const db = getOrchDb();
  return db.prepare('SELECT * FROM inbox WHERE id = ?').get(id) as InboxItem | null;
}

export function listInbox(filters: {
  status?: InboxStatus;
  urgency?: InboxUrgency;
  limit?: number;
} = {}): InboxItem[] {
  const db = getOrchDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.urgency) {
    conditions.push('urgency = ?');
    params.push(filters.urgency);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;

  return db.prepare(
    `SELECT * FROM inbox ${where} ORDER BY
      CASE urgency WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
      created_at DESC
    LIMIT ?`
  ).all(...params, limit) as InboxItem[];
}

export function getPendingInboxCount(): number {
  const db = getOrchDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM inbox WHERE status = \'pending\'').get() as { count: number };
  return row.count;
}
