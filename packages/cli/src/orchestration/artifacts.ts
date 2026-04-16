/**
 * KyberBot — Orchestration Artifacts
 *
 * CRUD for artifact records — files and deliverables created by agents
 * during their work. Each artifact links to an agent and optionally
 * to the issue it was produced for.
 */

import { getOrchDb } from './db.js';
import { logActivity } from './activity.js';
import type { Artifact } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════════════════

export function createArtifact(data: {
  file_path: string;
  description?: string;
  agent_name: string;
  issue_id?: number;
}): Artifact {
  const db = getOrchDb();
  const result = db.prepare(`
    INSERT INTO artifacts (file_path, description, agent_name, issue_id)
    VALUES (?, ?, ?, ?)
  `).run(
    data.file_path,
    data.description ?? null,
    data.agent_name,
    data.issue_id ?? null,
  );

  const id = Number(result.lastInsertRowid);

  logActivity({
    actor: data.agent_name,
    action: 'artifact.created',
    entity_type: 'artifact',
    entity_id: String(id),
    details: JSON.stringify({ file_path: data.file_path, description: data.description }),
  });

  return getArtifact(id)!;
}

export function deleteArtifact(id: number): void {
  const db = getOrchDb();
  db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════════════════════════

export function getArtifact(id: number): Artifact | null {
  const db = getOrchDb();
  return db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Artifact | null;
}

export function listArtifacts(filters: {
  agent_name?: string;
  issue_id?: number;
  limit?: number;
} = {}): Artifact[] {
  const db = getOrchDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.agent_name) {
    conditions.push('LOWER(agent_name) = LOWER(?)');
    params.push(filters.agent_name);
  }
  if (filters.issue_id) {
    conditions.push('issue_id = ?');
    params.push(filters.issue_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 200;

  return db.prepare(
    `SELECT * FROM artifacts ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit) as Artifact[];
}
