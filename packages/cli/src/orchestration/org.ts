/**
 * KyberBot — Orchestration Org Chart
 *
 * CRUD operations for the agent org chart. Agents are organized in a
 * strict tree hierarchy with one CEO at the root.
 */

import { getOrchDb } from './db.js';
import { logActivity } from './activity.js';
import type { OrgNode, Company } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANY
// ═══════════════════════════════════════════════════════════════════════════════

export function getCompany(): Company {
  const db = getOrchDb();
  return db.prepare('SELECT name, description, updated_at FROM company WHERE id = 1').get() as Company;
}

export function updateCompany(updates: { name?: string; description?: string }): Company {
  const db = getOrchDb();
  const fields: string[] = [];
  const params: (string | null)[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description ?? null); }

  if (fields.length > 0) {
    fields.push('updated_at = datetime(\'now\')');
    db.prepare(`UPDATE company SET ${fields.join(', ')} WHERE id = 1`).run(...params);

    logActivity({
      actor: 'human',
      action: 'company.updated',
      entity_type: 'company',
      entity_id: null,
      details: JSON.stringify(updates),
    });
  }

  return getCompany();
}

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════════════════

export function setOrgNode(node: {
  agent_name: string;
  role: string;
  title?: string | null;
  reports_to?: string | null;
  is_ceo?: boolean;
  department?: string | null;
}): OrgNode {
  const db = getOrchDb();

  // If setting as CEO, clear any existing CEO
  if (node.is_ceo) {
    db.prepare('UPDATE org_nodes SET is_ceo = 0 WHERE is_ceo = 1').run();
  }

  db.prepare(`
    INSERT INTO org_nodes (agent_name, role, title, reports_to, is_ceo, department)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_name) DO UPDATE SET
      role = excluded.role,
      title = excluded.title,
      reports_to = excluded.reports_to,
      is_ceo = excluded.is_ceo,
      department = excluded.department,
      updated_at = datetime('now')
  `).run(
    node.agent_name,
    node.role,
    node.title ?? null,
    node.reports_to ?? null,
    node.is_ceo ? 1 : 0,
    node.department ?? null,
  );

  logActivity({
    actor: 'system',
    action: 'org.set',
    entity_type: 'org',
    entity_id: node.agent_name,
    details: JSON.stringify({ role: node.role, reports_to: node.reports_to }),
  });

  return getOrgNode(node.agent_name)!;
}

export function removeOrgNode(agentName: string): void {
  const db = getOrchDb();

  // Clear references from children
  db.prepare('UPDATE org_nodes SET reports_to = NULL WHERE reports_to = ?').run(agentName);

  db.prepare('DELETE FROM org_nodes WHERE agent_name = ?').run(agentName);

  logActivity({
    actor: 'system',
    action: 'org.removed',
    entity_type: 'org',
    entity_id: agentName,
    details: null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// READ
// ═══════════════════════════════════════════════════════════════════════════════

export function getOrgNode(agentName: string): OrgNode | null {
  const db = getOrchDb();
  const row = db.prepare('SELECT * FROM org_nodes WHERE agent_name = ?').get(agentName) as any;
  return row ? mapOrgRow(row) : null;
}

export function getOrgChart(): OrgNode[] {
  const db = getOrchDb();
  const rows = db.prepare('SELECT * FROM org_nodes ORDER BY is_ceo DESC, agent_name ASC').all() as any[];
  return rows.map(mapOrgRow);
}

export function getDirectReports(agentName: string): OrgNode[] {
  const db = getOrchDb();
  const rows = db.prepare('SELECT * FROM org_nodes WHERE reports_to = ? ORDER BY agent_name').all(agentName) as any[];
  return rows.map(mapOrgRow);
}

export function getCeoAgent(): OrgNode | null {
  const db = getOrchDb();
  const row = db.prepare('SELECT * FROM org_nodes WHERE is_ceo = 1').get() as any;
  return row ? mapOrgRow(row) : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function mapOrgRow(row: any): OrgNode {
  return {
    agent_name: row.agent_name,
    role: row.role,
    title: row.title,
    reports_to: row.reports_to,
    is_ceo: row.is_ceo === 1,
    department: row.department,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
