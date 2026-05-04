/**
 * KyberBot — deleteIssue tests
 *
 * Covers the cancel-pile cleanup path: hard-delete an issue, drop its
 * comments, sever inbox/artifact links, idempotent on missing id.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resetOrchDb, getOrchDb } from './db.js';
import { createIssue, getIssue, deleteIssue, addComment, getComments } from './issues.js';
import { createArtifact, listArtifacts } from './artifacts.js';
import { createInboxItem, getInboxItem } from './inbox.js';

let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'kyberbot-delissue-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  resetOrchDb();
  getOrchDb();
});

afterEach(() => {
  resetOrchDb();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

describe('deleteIssue', () => {
  it('hard-deletes the issue', () => {
    const i = createIssue({ title: 'gone', created_by: 'human' });
    deleteIssue(i.id, 'human');
    expect(getIssue(i.id)).toBeFalsy(); // libsql returns undefined for no row
  });

  it('is idempotent on missing id', () => {
    expect(() => deleteIssue(99999, 'human')).not.toThrow();
  });

  it('cascades comments', () => {
    const i = createIssue({ title: 't', created_by: 'human' });
    addComment(i.id, 'human', 'note 1');
    addComment(i.id, 'human', 'note 2');
    expect(getComments(i.id)).toHaveLength(2);
    deleteIssue(i.id, 'human');
    expect(getComments(i.id)).toEqual([]);
  });

  it('null-outs inbox related_issue_id (does not delete inbox row)', () => {
    const i = createIssue({ title: 't', created_by: 'human' });
    const ib = createInboxItem({
      source_agent: 'atlas', title: 'completed: t',
      kind: 'completed', related_issue_id: i.id,
    });
    deleteIssue(i.id, 'human');
    const after = getInboxItem(ib.id);
    expect(after).not.toBeNull();
    expect(after!.related_issue_id).toBeNull();
  });

  it('null-outs artifact issue_id (keeps the artifact row)', () => {
    const i = createIssue({ title: 't', created_by: 'human' });
    const a = createArtifact({ file_path: '/tmp/a.md', agent_name: 'x', issue_id: i.id });
    deleteIssue(i.id, 'human');
    const remaining = listArtifacts({ agent_name: 'x' });
    expect(remaining.find(r => r.id === a.id)?.issue_id).toBeNull();
  });

  it('orphans child issues parent_id', () => {
    const parent = createIssue({ title: 'p', created_by: 'human' });
    const child = createIssue({ title: 'c', created_by: 'human', parent_id: parent.id });
    deleteIssue(parent.id, 'human');
    const after = getIssue(child.id);
    expect(after).not.toBeNull();
    expect(after!.parent_id).toBeNull();
  });
});
