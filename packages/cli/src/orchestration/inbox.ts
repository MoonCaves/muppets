/**
 * KyberBot — Orchestration Human Inbox
 *
 * Escalation system for items needing human attention.
 * Agents create inbox items when they hit blockers, need decisions,
 * or want to report status. Humans review and respond.
 */

import { getOrchDb } from './db.js';
import { logActivity } from './activity.js';
import type { InboxItem, InboxUrgency, InboxStatus, InboxKind, InboxItemWithArtifacts, Artifact } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════════════════

export function createInboxItem(item: {
  source_agent: string;
  title: string;
  body?: string | null;
  urgency?: InboxUrgency;
  kind?: InboxKind;
  related_issue_id?: number | null;
}): InboxItem {
  const db = getOrchDb();
  const result = db.prepare(`
    INSERT INTO inbox (source_agent, title, body, urgency, kind, related_issue_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    item.source_agent,
    item.title,
    item.body ?? null,
    item.urgency ?? 'normal',
    item.kind ?? 'needs_action',
    item.related_issue_id ?? null,
  );

  const id = Number(result.lastInsertRowid);

  logActivity({
    actor: item.source_agent,
    action: 'inbox.created',
    entity_type: 'inbox',
    entity_id: String(id),
    details: JSON.stringify({ title: item.title, urgency: item.urgency ?? 'normal', kind: item.kind ?? 'needs_action' }),
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
  kind?: InboxKind;
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
  if (filters.kind) {
    conditions.push('kind = ?');
    params.push(filters.kind);
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

/**
 * Like listInbox, but includes joined artifacts for each item via
 * related_issue_id. Used by the desktop's Completed tab to render the
 * task's deliverables alongside the notification.
 */
export function listInboxWithArtifacts(filters: {
  status?: InboxStatus;
  urgency?: InboxUrgency;
  kind?: InboxKind;
  limit?: number;
} = {}): InboxItemWithArtifacts[] {
  const items = listInbox(filters);
  if (items.length === 0) return [];
  const db = getOrchDb();
  const issueIds = items.map(i => i.related_issue_id).filter((id): id is number => id !== null);
  const artifactsByIssue = new Map<number, Artifact[]>();
  if (issueIds.length > 0) {
    const placeholders = issueIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM artifacts WHERE issue_id IN (${placeholders}) ORDER BY created_at DESC`,
    ).all(...issueIds) as Artifact[];
    for (const a of rows) {
      if (a.issue_id == null) continue;
      const list = artifactsByIssue.get(a.issue_id) ?? [];
      list.push(a);
      artifactsByIssue.set(a.issue_id, list);
    }
  }
  return items.map(i => ({
    ...i,
    artifacts: i.related_issue_id != null ? (artifactsByIssue.get(i.related_issue_id) ?? []) : [],
  }));
}

export function getInboxItemWithArtifacts(id: number): InboxItemWithArtifacts | null {
  const item = getInboxItem(id);
  if (!item) return null;
  const db = getOrchDb();
  let artifacts: Artifact[] = [];
  if (item.related_issue_id != null) {
    artifacts = db.prepare(
      'SELECT * FROM artifacts WHERE issue_id = ? ORDER BY created_at DESC',
    ).all(item.related_issue_id) as Artifact[];
  }
  return { ...item, artifacts };
}

export function getPendingInboxCount(kind?: InboxKind): number {
  const db = getOrchDb();
  if (kind) {
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM inbox WHERE status = \'pending\' AND kind = ?',
    ).get(kind) as { count: number };
    return row.count;
  }
  const row = db.prepare('SELECT COUNT(*) as count FROM inbox WHERE status = \'pending\'').get() as { count: number };
  return row.count;
}
