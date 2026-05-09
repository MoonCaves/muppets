/**
 * Gap Revival Extension — DbHandle Interface
 *
 * Structural interface covering every DB method called across the gap-revival
 * source tree. Pure interfaces — zero upstream imports.
 *
 * Satisfied by both better-sqlite3 and libsql (KyberBot's sync SQLite binding).
 * Using a structural interface keeps the extension free of peer-dep coupling to
 * whichever SQLite driver Ian ships at any given release.
 *
 * Call surface enumerated from grep audit (2026-05-09):
 *   hook-after-decay.ts:44   db.prepare(sql).all()
 *   hook-on-access.ts:36     db.prepare(sql).get()
 *   hook-on-access.ts:50     db.prepare(sql).run(id)
 *   hook-on-access.ts:56     db.prepare(sql).get(id)
 *   priority-override.ts:79  db.prepare(sql).run(val, id)
 *
 * Files with no DB calls (pure math/logic): activation.ts, revival-bonus.ts,
 * repetitive-guard.ts, integration.ts (passes db through, no direct calls).
 *
 * Supersedes db-types.ts (MinimalDb → DbHandle rename + audit docs).
 * db-types.ts will be removed in Step 3 once all imports are updated.
 */

export interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

export interface DbHandle {
  prepare(sql: string): Statement;
}
