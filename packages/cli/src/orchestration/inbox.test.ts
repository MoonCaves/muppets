/**
 * KyberBot — inbox kind + artifact join tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resetOrchDb, getOrchDb } from './db.js';
import {
  createInboxItem, listInbox, listInboxWithArtifacts,
  getInboxItem, getInboxItemWithArtifacts, getPendingInboxCount,
  acknowledgeInboxItem,
} from './inbox.js';
import { createArtifact } from './artifacts.js';

let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'kyberbot-inbox-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  resetOrchDb();
  getOrchDb(); // initialize schema
});

afterEach(() => {
  resetOrchDb();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

function seedIssue(id: number, title: string): void {
  const db = getOrchDb();
  db.prepare(
    "INSERT INTO issues (id, title, created_by, status) VALUES (?, ?, 'system', 'done')",
  ).run(id, title);
}

describe('inbox kind', () => {
  it('defaults to needs_action when not specified', () => {
    const item = createInboxItem({ source_agent: 'atlas', title: 'help' });
    expect(item.kind).toBe('needs_action');
  });

  it('persists explicit completed kind', () => {
    const item = createInboxItem({ source_agent: 'atlas', title: 'done thing', kind: 'completed' });
    expect(item.kind).toBe('completed');
  });

  it('filters list by kind', () => {
    createInboxItem({ source_agent: 'a', title: 'escalation' });
    createInboxItem({ source_agent: 'a', title: 'finished', kind: 'completed' });
    createInboxItem({ source_agent: 'a', title: 'another finished', kind: 'completed' });
    expect(listInbox({ kind: 'needs_action' })).toHaveLength(1);
    expect(listInbox({ kind: 'completed' })).toHaveLength(2);
  });

  it('count-by-kind separates the counters', () => {
    createInboxItem({ source_agent: 'a', title: 'esc' });
    createInboxItem({ source_agent: 'a', title: 'done', kind: 'completed' });
    expect(getPendingInboxCount('needs_action')).toBe(1);
    expect(getPendingInboxCount('completed')).toBe(1);
    expect(getPendingInboxCount()).toBe(2);
  });
});

describe('listInboxWithArtifacts', () => {
  it('joins artifacts via related_issue_id', () => {
    seedIssue(7, 'ship the thing');
    createArtifact({ file_path: '/tmp/foo.md', agent_name: 'atlas', issue_id: 7 });
    createArtifact({ file_path: '/tmp/bar.json', agent_name: 'atlas', issue_id: 7 });
    createInboxItem({
      source_agent: 'atlas',
      title: 'Completed: ship the thing (2 artifacts)',
      kind: 'completed',
      related_issue_id: 7,
    });

    const items = listInboxWithArtifacts({ kind: 'completed' });
    expect(items).toHaveLength(1);
    expect(items[0].artifacts.map(a => a.file_path).sort()).toEqual(['/tmp/bar.json', '/tmp/foo.md']);
  });

  it('returns an empty artifacts array when no related issue', () => {
    createInboxItem({ source_agent: 'atlas', title: 'finished', kind: 'completed' });
    const items = listInboxWithArtifacts({ kind: 'completed' });
    expect(items[0].artifacts).toEqual([]);
  });

  it('does not bleed artifacts across unrelated issues', () => {
    seedIssue(1, 'a'); seedIssue(2, 'b');
    createArtifact({ file_path: '/tmp/a.md', agent_name: 'x', issue_id: 1 });
    createArtifact({ file_path: '/tmp/b.md', agent_name: 'x', issue_id: 2 });
    createInboxItem({ source_agent: 'x', title: 'A done', kind: 'completed', related_issue_id: 1 });
    createInboxItem({ source_agent: 'x', title: 'B done', kind: 'completed', related_issue_id: 2 });
    const items = listInboxWithArtifacts({ kind: 'completed' });
    const aItem = items.find(i => i.related_issue_id === 1)!;
    const bItem = items.find(i => i.related_issue_id === 2)!;
    expect(aItem.artifacts.map(x => x.file_path)).toEqual(['/tmp/a.md']);
    expect(bItem.artifacts.map(x => x.file_path)).toEqual(['/tmp/b.md']);
  });
});

describe('getInboxItemWithArtifacts', () => {
  it('returns null for unknown id', () => {
    expect(getInboxItemWithArtifacts(9999)).toBeNull();
  });

  it('returns item + artifacts for a known id', () => {
    seedIssue(3, 't');
    createArtifact({ file_path: '/tmp/x.md', agent_name: 'atlas', issue_id: 3 });
    const created = createInboxItem({ source_agent: 'atlas', title: 'done', kind: 'completed', related_issue_id: 3 });
    const fetched = getInboxItemWithArtifacts(created.id);
    expect(fetched?.kind).toBe('completed');
    expect(fetched?.artifacts).toHaveLength(1);
  });
});

describe('acknowledge — auto-ack on view', () => {
  it('flips pending → acknowledged idempotently', () => {
    const item = createInboxItem({ source_agent: 'a', title: 't' });
    expect(item.status).toBe('pending');
    acknowledgeInboxItem(item.id);
    const after = getInboxItem(item.id)!;
    expect(after.status).toBe('acknowledged');
    // Second call is a no-op
    acknowledgeInboxItem(item.id);
    expect(getInboxItem(item.id)?.status).toBe('acknowledged');
  });
});
