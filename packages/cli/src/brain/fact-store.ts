/**
 * KyberBot — Fact Store
 *
 * Stores structured facts extracted from conversations. Each fact is a
 * specific, verifiable statement with metadata (category, confidence,
 * entities, source conversation). Facts are stored in SQLite alongside
 * the timeline database and optionally indexed in ChromaDB for semantic
 * search.
 */

import { getTimelineDb } from './timeline.js';
import { indexDocument, isChromaAvailable } from './embeddings.js';
import { createLogger } from '../logger.js';

const logger = createLogger('fact-store');

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type FactCategory =
  | 'biographical'
  | 'preference'
  | 'event'
  | 'relationship'
  | 'temporal'
  | 'opinion'
  | 'plan'
  | 'general';

export const VALID_CATEGORIES: ReadonlySet<string> = new Set<FactCategory>([
  'biographical',
  'preference',
  'event',
  'relationship',
  'temporal',
  'opinion',
  'plan',
  'general',
]);

export interface FactInput {
  content: string;
  source_path: string;
  source_conversation_id: string;
  entities: string[];
  timestamp: string;
  confidence: number;
  category: FactCategory;
}

export interface StoredFact extends FactInput {
  id: number;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ensure the facts table exists in the timeline database.
 * Safe to call multiple times — uses CREATE TABLE IF NOT EXISTS.
 */
export async function ensureFactsTable(root: string): Promise<void> {
  const db = await getTimelineDb(root);

  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      source_path TEXT NOT NULL UNIQUE,
      source_conversation_id TEXT NOT NULL,
      entities_json TEXT DEFAULT '[]',
      timestamp TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      category TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_facts_source_conv
      ON facts(source_conversation_id);
    CREATE INDEX IF NOT EXISTS idx_facts_category
      ON facts(category);
    CREATE INDEX IF NOT EXISTS idx_facts_timestamp
      ON facts(timestamp);
    CREATE INDEX IF NOT EXISTS idx_facts_source_path
      ON facts(source_path);
  `);
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Store a single fact in the database and optionally index it in ChromaDB.
 */
export async function storeFact(root: string, fact: FactInput): Promise<number> {
  const db = await getTimelineDb(root);

  const result = db.prepare(`
    INSERT OR REPLACE INTO facts
      (content, source_path, source_conversation_id, entities_json, timestamp, confidence, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    fact.content,
    fact.source_path,
    fact.source_conversation_id,
    JSON.stringify(fact.entities),
    fact.timestamp,
    fact.confidence,
    fact.category,
  );

  const factId = result.lastInsertRowid as number;

  // Index in ChromaDB for semantic search (best-effort)
  try {
    if (isChromaAvailable()) {
      const chromaId = `fact_${fact.source_path.replace(/[^a-zA-Z0-9]/g, '_')}`;
      await indexDocument(chromaId, fact.content, {
        type: 'note',
        source_path: fact.source_path,
        title: `[fact] ${fact.content.slice(0, 80)}`,
        timestamp: fact.timestamp,
        entities: fact.entities,
        topics: [fact.category],
        summary: fact.content,
      });
    }
  } catch {
    // Embedding is best-effort
  }

  logger.debug('Stored fact', {
    id: factId,
    category: fact.category,
    confidence: fact.confidence,
    content: fact.content.slice(0, 60),
  });

  return factId;
}
