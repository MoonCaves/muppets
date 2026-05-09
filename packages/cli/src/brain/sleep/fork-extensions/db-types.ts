/**
 * Gap Revival Extension — Minimal SQLite DB Interface
 *
 * Structural interface that is satisfied by both `better-sqlite3` and `libsql`
 * (the synchronous SQLite binding used by KyberBot's timeline module).
 *
 * Using this instead of `import type { Database } from 'better-sqlite3'` keeps
 * the extension free of peer-dep coupling to the upstream library choice.
 */

export interface MinimalStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

export interface MinimalDb {
  prepare(sql: string): MinimalStatement;
}
