/**
 * KyberBot — Orchestration Projects
 *
 * CRUD for projects. Projects group related goals and issues
 * under a single deliverable or product.
 */

import { getOrchDb } from './db.js';
import { logActivity } from './activity.js';
import type { Project } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════════════════

export function createProject(project: {
  name: string;
  description?: string | null;
}): Project {
  const db = getOrchDb();
  const result = db.prepare(`
    INSERT INTO projects (name, description) VALUES (?, ?)
  `).run(project.name, project.description ?? null);

  const id = Number(result.lastInsertRowid);

  logActivity({
    actor: 'human',
    action: 'project.created',
    entity_type: 'project',
    entity_id: String(id),
    details: JSON.stringify({ name: project.name }),
  });

  return getProject(id)!;
}

export function updateProject(id: number, updates: Partial<Pick<Project, 'name' | 'description' | 'status'>>): Project {
  const db = getOrchDb();
  const fields: string[] = [];
  const params: (string | null)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      params.push(value ?? null);
    }
  }

  if (fields.length > 0) {
    fields.push('updated_at = datetime(\'now\')');
    params.push(String(id));
    db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  return getProject(id)!;
}

export function deleteProject(id: number): void {
  const db = getOrchDb();
  // Clear project references from goals and issues
  db.prepare('UPDATE goals SET project_id = NULL WHERE project_id = ?').run(id);
  db.prepare('UPDATE issues SET project_id = NULL WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);

  logActivity({
    actor: 'human',
    action: 'project.deleted',
    entity_type: 'project',
    entity_id: String(id),
    details: null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════════════════════════

export function getProject(id: number): Project | null {
  const db = getOrchDb();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | null;
}

export function listProjects(filters: { status?: string } = {}): Project[] {
  const db = getOrchDb();
  if (filters.status) {
    return db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY name').all(filters.status) as Project[];
  }
  return db.prepare('SELECT * FROM projects ORDER BY name').all() as Project[];
}
