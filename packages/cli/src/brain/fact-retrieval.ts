/**
 * KyberBot — Fact-First Retrieval Engine
 *
 * Replaces the current RAG-first approach (search chunks -> build context)
 * with a fact-first approach:
 *   Layer 1: Search facts (FTS5 + ChromaDB)
 *   Layer 2: Entity expansion (same entity -> related facts)
 *   Layer 3: Supporting context (source conversation segments)
 *   Layer 4: Context optimization (prune to token budget, deduplicate)
 *
 * This produces better context because atomic facts match questions
 * more precisely than raw conversation chunks.
 */

import { createLogger } from '../logger.js';

const logger = createLogger('fact-retrieval');

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface FactSearchOptions {
  limit?: number;                 // max facts to return (default 15)
  tokenBudget?: number;           // max tokens for assembled context (default 4000)
  includeSupporting?: boolean;    // include source conversation segments (default true)
  maxSupportingPerFact?: number;  // max supporting chunks per fact (default 2)
}

export interface FactSearchResult {
  facts: Array<{
    id: number;
    content: string;
    category: string;
    confidence: number;
    timestamp: string;
    entities: string[];
    score: number;
    source: 'direct' | 'entity_expansion';
  }>;
  supporting_context: Array<{
    content: string;
    source_path: string;
    timestamp: string;
    related_fact_id: number;
  }>;
  assembled_context: string;
  token_estimate: number;
  stats: {
    direct_facts: number;
    expanded_facts: number;
    supporting_chunks: number;
    pruned_items: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOKEN ESTIMATION
// ═══════════════════════════════════════════════════════════════════════════════

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate word overlap ratio between two strings.
 * Returns a value between 0 and 1, where 1 means identical word sets.
 */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length >= 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length >= 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const smaller = Math.min(wordsA.size, wordsB.size);
  return intersection / smaller;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 1: DIRECT FACT SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

interface ScoredFact {
  id: number;
  content: string;
  category: string;
  confidence: number;
  timestamp: string;
  entities: string[];
  score: number;
  source: 'direct' | 'entity_expansion';
}

/**
 * Search for facts using both FTS5 keyword matching and ChromaDB semantic search.
 * Merges and deduplicates results, keeping the higher-scored entry when two
 * facts have >80% word overlap.
 */
async function searchFactsDirect(
  root: string,
  query: string,
  limit: number
): Promise<ScoredFact[]> {
  const { getTimelineDb } = await import('./timeline.js');
  const db = await getTimelineDb(root);

  // Ensure facts table and FTS index exist
  const { ensureFactsTable } = await import('./fact-store.js');
  await ensureFactsTable(root);
  await ensureFactsFts(db);

  const results: ScoredFact[] = [];

  // ── FTS5 keyword search ────────────────────────────────────────────────────
  const words = query
    .toLowerCase()
    .replace(/[?.,!'"]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3);

  if (words.length > 0) {
    const ftsQuery = words.join(' OR ');
    try {
      const ftsRows = db.prepare(`
        SELECT f.id, f.content, f.category, f.confidence, f.timestamp,
               f.entities_json, f.is_latest, f.expires_at
        FROM facts f
        JOIN facts_fts fts ON f.id = fts.rowid
        WHERE facts_fts MATCH ?
          AND COALESCE(f.is_latest, 1) = 1
          AND (f.expires_at IS NULL OR f.expires_at > datetime('now'))
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit * 2) as Array<{
        id: number;
        content: string;
        category: string;
        confidence: number;
        timestamp: string;
        entities_json: string;
        is_latest: number;
        expires_at: string | null;
      }>;

      for (const row of ftsRows) {
        results.push({
          id: row.id,
          content: row.content,
          category: row.category || 'general',
          confidence: row.confidence || 0.7,
          timestamp: row.timestamp,
          entities: JSON.parse(row.entities_json || '[]'),
          score: 0.6, // Base score for FTS results
          source: 'direct',
        });
      }
    } catch (err) {
      logger.debug('FTS search on facts failed', { error: String(err) });
    }
  }

  // ── ChromaDB semantic search ───────────────────────────────────────────────
  try {
    const { semanticSearch } = await import('./embeddings.js');
    const semanticResults = await semanticSearch(query, { limit: limit * 2, type: 'note' });

    for (const sr of semanticResults) {
      // Only include results whose source_path starts with 'fact://'
      if (!sr.metadata.source_path.startsWith('fact://')) continue;

      const semanticScore = 1 - sr.distance;

      // Try to find a matching FTS result by content overlap
      let merged = false;
      for (const existing of results) {
        if (wordOverlap(existing.content, sr.content) > 0.8) {
          // Combine scores — keep the better one but boost score
          existing.score = Math.max(existing.score, semanticScore);
          merged = true;
          break;
        }
      }

      if (!merged) {
        // Extract fact ID from source_path: fact://parentId/index
        const pathMatch = sr.metadata.source_path.match(/fact:\/\/.*?(\d+)$/);
        const factId = pathMatch ? parseInt(pathMatch[1], 10) : 0;

        // Look up the actual fact in SQLite to get full metadata
        const factRow = db.prepare(`
          SELECT id, content, category, confidence, timestamp, entities_json
          FROM facts
          WHERE source_path = ?
            AND COALESCE(is_latest, 1) = 1
        `).get(sr.metadata.source_path) as {
          id: number;
          content: string;
          category: string;
          confidence: number;
          timestamp: string;
          entities_json: string;
        } | undefined;

        if (factRow) {
          results.push({
            id: factRow.id,
            content: factRow.content,
            category: factRow.category || 'general',
            confidence: factRow.confidence || 0.7,
            timestamp: factRow.timestamp,
            entities: JSON.parse(factRow.entities_json || '[]'),
            score: semanticScore,
            source: 'direct',
          });
        } else {
          // ChromaDB has the fact but SQLite doesn't (or it was superseded)
          // Use the ChromaDB result directly
          results.push({
            id: factId,
            content: sr.content,
            category: sr.metadata.topics?.[0] || 'general',
            confidence: 0.7,
            timestamp: sr.metadata.timestamp,
            entities: sr.metadata.entities || [],
            score: semanticScore,
            source: 'direct',
          });
        }
      }
    }
  } catch (err) {
    logger.debug('Semantic search unavailable for fact retrieval', { error: String(err) });
  }

  // Deduplicate by content overlap (>80% word overlap -> keep higher scored)
  const deduplicated: ScoredFact[] = [];
  for (const fact of results) {
    let isDuplicate = false;
    for (const existing of deduplicated) {
      if (wordOverlap(existing.content, fact.content) > 0.8) {
        if (fact.score > existing.score) {
          // Replace with higher-scored version
          Object.assign(existing, fact);
        }
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      deduplicated.push(fact);
    }
  }

  // Sort by score descending
  deduplicated.sort((a, b) => b.score - a.score);

  return deduplicated.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 2: ENTITY EXPANSION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect entity names in the query and fetch their associated facts.
 * Results are scored at 0.7x to rank slightly below direct matches.
 */
async function expandByEntities(
  root: string,
  query: string,
  existingFacts: ScoredFact[],
  limit: number
): Promise<ScoredFact[]> {
  const expanded: ScoredFact[] = [];

  try {
    const { getEntityGraphDb } = await import('./entity-graph.js');
    const entityDb = await getEntityGraphDb(root);

    // Find entity names that appear in the query
    const queryLower = query.toLowerCase();
    const allEntities = entityDb.prepare(
      'SELECT id, name FROM entities ORDER BY mention_count DESC LIMIT 200'
    ).all() as Array<{ id: number; name: string }>;

    const matchedEntities = allEntities.filter(
      e => e.name.length >= 3 && queryLower.includes(e.name.toLowerCase())
    );

    if (matchedEntities.length === 0) return [];

    // Build a set of existing fact content for deduplication
    const existingContent = existingFacts.map(f => f.content);

    const { getFactsForEntity } = await import('./fact-store.js');

    for (const entity of matchedEntities.slice(0, 5)) {
      const entityFacts = await getFactsForEntity(root, entity.name, {
        latestOnly: true,
        limit: 10,
      });

      for (const ef of entityFacts) {
        // Skip if already in direct results (>80% overlap)
        const isDuplicate = existingContent.some(
          ec => wordOverlap(ec, ef.content) > 0.8
        ) || expanded.some(
          ex => wordOverlap(ex.content, ef.content) > 0.8
        );

        if (isDuplicate) continue;

        // Apply 0.7x score multiplier for entity-expanded facts
        const baseScore = ef.confidence || 0.7;
        expanded.push({
          id: ef.id,
          content: ef.content,
          category: ef.category || 'general',
          confidence: ef.confidence,
          timestamp: ef.timestamp,
          entities: ef.entities,
          score: baseScore * 0.7,
          source: 'entity_expansion',
        });
      }
    }
  } catch (err) {
    logger.debug('Entity expansion failed', { error: String(err) });
  }

  // Sort by score and limit
  expanded.sort((a, b) => b.score - a.score);
  return expanded.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 3: SUPPORTING CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

interface SupportingChunk {
  content: string;
  source_path: string;
  timestamp: string;
  related_fact_id: number;
  score: number; // inherited from the fact for pruning
}

/**
 * For the top facts, find the source conversation segments that contain
 * the original context from which the fact was extracted.
 */
async function findSupportingContext(
  root: string,
  facts: ScoredFact[],
  maxFacts: number,
  maxPerFact: number
): Promise<SupportingChunk[]> {
  const supporting: SupportingChunk[] = [];

  try {
    const { getTimelineDb } = await import('./timeline.js');
    const db = await getTimelineDb(root);

    const topFacts = facts.slice(0, maxFacts);

    for (const fact of topFacts) {
      // Facts have source_path like "fact://parentId/index"
      // The parent conversation ID is stored in source_conversation_id
      let parentPath: string | null = null;

      // Try to find fact in SQLite to get source_conversation_id
      const factRow = db.prepare(
        'SELECT source_path, source_conversation_id FROM facts WHERE id = ?'
      ).get(fact.id) as { source_path: string; source_conversation_id: string } | undefined;

      if (factRow) {
        // Reconstruct conversation path from source_conversation_id
        // source_conversation_id is the parent path without the fact prefix
        parentPath = factRow.source_conversation_id;
      }

      if (!parentPath) continue;

      // Search timeline_events for the parent conversation and nearby segments
      const segments = db.prepare(`
        SELECT source_path, summary, timestamp
        FROM timeline_events
        WHERE source_path LIKE ? OR source_path = ?
        ORDER BY timestamp ASC
        LIMIT ?
      `).all(
        `${parentPath}%`,
        parentPath,
        maxPerFact
      ) as Array<{
        source_path: string;
        summary: string;
        timestamp: string;
      }>;

      for (const seg of segments) {
        if (!seg.summary || seg.summary.trim().length < 10) continue;

        supporting.push({
          content: seg.summary,
          source_path: seg.source_path,
          timestamp: seg.timestamp,
          related_fact_id: fact.id,
          score: fact.score,
        });
      }
    }
  } catch (err) {
    logger.debug('Supporting context retrieval failed', { error: String(err) });
  }

  return supporting;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYER 4: CONTEXT OPTIMIZATION
// ═══════════════════════════════════════════════════════════════════════════════

interface OptimizedContext {
  facts: ScoredFact[];
  supporting: SupportingChunk[];
  assembled: string;
  tokenEstimate: number;
  prunedCount: number;
}

/**
 * Assemble all facts and supporting context into a token-budget-optimized
 * context string ready for LLM consumption.
 *
 * Pruning order:
 *   1. Drop supporting context (lowest scored first)
 *   2. Drop entity-expanded facts (lowest scored first)
 *   3. Never drop direct fact matches
 */
function optimizeContext(
  facts: ScoredFact[],
  supporting: SupportingChunk[],
  tokenBudget: number,
  limit: number
): OptimizedContext {
  let prunedCount = 0;

  // Start with all facts sorted by score, capped at limit
  let keptFacts = [...facts].sort((a, b) => b.score - a.score).slice(0, limit);
  let keptSupporting = [...supporting].sort((a, b) => b.score - a.score);

  // Build context and check token budget
  let assembled = assembleContextString(keptFacts, keptSupporting);
  let tokens = estimateTokens(assembled);

  // Prune supporting context first (lowest scored)
  while (tokens > tokenBudget && keptSupporting.length > 0) {
    keptSupporting.pop();
    prunedCount++;
    assembled = assembleContextString(keptFacts, keptSupporting);
    tokens = estimateTokens(assembled);
  }

  // Prune entity-expanded facts next (lowest scored)
  while (tokens > tokenBudget && keptFacts.some(f => f.source === 'entity_expansion')) {
    // Find the lowest-scored entity_expansion fact
    const idx = keptFacts.reduceRight((foundIdx, f, i) => {
      if (f.source === 'entity_expansion' && foundIdx === -1) return i;
      if (f.source === 'entity_expansion' && foundIdx !== -1 && f.score < keptFacts[foundIdx].score) return i;
      return foundIdx;
    }, -1);

    if (idx === -1) break;

    keptFacts.splice(idx, 1);
    prunedCount++;
    assembled = assembleContextString(keptFacts, keptSupporting);
    tokens = estimateTokens(assembled);
  }

  return {
    facts: keptFacts,
    supporting: keptSupporting,
    assembled,
    tokenEstimate: tokens,
    prunedCount,
  };
}

/**
 * Format facts and supporting context into a structured text block
 * suitable for direct inclusion in an LLM prompt.
 */
function assembleContextString(
  facts: ScoredFact[],
  supporting: SupportingChunk[]
): string {
  const sections: string[] = [];

  // Known facts section
  if (facts.length > 0) {
    const factLines = facts.map(f => {
      const confidence = f.confidence.toFixed(2);
      return `- [${f.category}] ${f.content} (confidence: ${confidence})`;
    });
    sections.push(`## Known Facts\n${factLines.join('\n')}`);
  }

  // Supporting context section
  if (supporting.length > 0) {
    // Deduplicate supporting chunks by content overlap
    const uniqueSupporting: SupportingChunk[] = [];
    for (const chunk of supporting) {
      const isDup = uniqueSupporting.some(
        u => wordOverlap(u.content, chunk.content) > 0.8
      );
      if (!isDup) uniqueSupporting.push(chunk);
    }

    const contextLines = uniqueSupporting.map(s => {
      const date = formatTimestamp(s.timestamp);
      return `[${date}] ${s.content}`;
    });
    sections.push(`## Supporting Context\n${contextLines.join('\n---\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Format an ISO timestamp into a human-readable date string.
 */
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return timestamp;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FTS5 INDEX FOR FACTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ensure a FTS5 virtual table exists for the facts table.
 * Safe to call multiple times — uses CREATE ... IF NOT EXISTS.
 */
async function ensureFactsFts(db: import('better-sqlite3').Database): Promise<void> {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
        content,
        category,
        entities,
        content=facts,
        content_rowid=id
      );
    `);

    // Create triggers to keep FTS in sync (idempotent via IF NOT EXISTS)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts(rowid, content, category, entities)
        VALUES (new.id, new.content, new.category, new.entities_json);
      END;

      CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, content, category, entities)
        VALUES ('delete', old.id, old.content, old.category, old.entities_json);
      END;

      CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, content, category, entities)
        VALUES ('delete', old.id, old.content, old.category, old.entities_json);
        INSERT INTO facts_fts(rowid, content, category, entities)
        VALUES (new.id, new.content, new.category, new.entities_json);
      END;
    `);

    // Backfill: populate FTS from existing facts that aren't indexed yet.
    // Only runs when the FTS table is empty but facts exist.
    const ftsCount = (db.prepare('SELECT COUNT(*) as c FROM facts_fts').get() as { c: number }).c;
    const factsCount = (db.prepare('SELECT COUNT(*) as c FROM facts').get() as { c: number }).c;

    if (ftsCount === 0 && factsCount > 0) {
      logger.info(`Backfilling facts_fts with ${factsCount} existing facts`);
      db.exec(`
        INSERT INTO facts_fts(rowid, content, category, entities)
        SELECT id, content, category, entities_json FROM facts;
      `);
    }
  } catch (err) {
    // FTS setup might fail if the table already exists with different schema
    logger.debug('Facts FTS setup skipped or failed', { error: String(err) });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACT ACCESS TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Increment the access count on facts that were returned in search results.
 * Helps the sleep agent identify frequently-accessed facts for prioritization.
 */
async function trackFactAccess(root: string, factIds: number[]): Promise<void> {
  if (factIds.length === 0) return;

  try {
    const { getTimelineDb } = await import('./timeline.js');
    const db = await getTimelineDb(root);

    const stmt = db.prepare(`
      UPDATE facts
      SET access_count = COALESCE(access_count, 0) + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    for (const id of factIds) {
      if (id > 0) stmt.run(id);
    }

    logger.debug('Tracked fact access', { count: factIds.length });
  } catch (err) {
    logger.debug('Failed to track fact access', { error: String(err) });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fact-first retrieval: search structured facts instead of raw conversation
 * chunks, expand via entity graph, and assemble optimized context.
 *
 * @param query - Natural language search query
 * @param root - Agent root directory (contains data/ with SQLite databases)
 * @param options - Search configuration
 * @returns Structured result with facts, supporting context, and assembled text
 */
export async function factFirstSearch(
  query: string,
  root: string,
  options: FactSearchOptions = {}
): Promise<FactSearchResult> {
  const {
    limit = 15,
    tokenBudget = 4000,
    includeSupporting = true,
    maxSupportingPerFact = 2,
  } = options;

  logger.debug('Fact-first search starting', { query, limit, tokenBudget });

  // Layer 1: Direct fact search (FTS5 + ChromaDB)
  const directFacts = await searchFactsDirect(root, query, limit * 2);

  logger.debug('Layer 1 complete', { directFacts: directFacts.length });

  // Layer 2: Entity expansion
  const expandedFacts = await expandByEntities(
    root,
    query,
    directFacts,
    limit
  );

  logger.debug('Layer 2 complete', { expandedFacts: expandedFacts.length });

  // Merge direct + expanded (direct first for scoring priority)
  const allFacts = [...directFacts, ...expandedFacts];

  // Layer 3: Supporting context
  let supporting: SupportingChunk[] = [];
  if (includeSupporting && allFacts.length > 0) {
    supporting = await findSupportingContext(
      root,
      allFacts,
      5,          // top 5 facts get supporting context
      maxSupportingPerFact
    );
    logger.debug('Layer 3 complete', { supportingChunks: supporting.length });
  }

  // Layer 4: Context optimization
  const optimized = optimizeContext(allFacts, supporting, tokenBudget, limit);

  logger.debug('Layer 4 complete', {
    keptFacts: optimized.facts.length,
    keptSupporting: optimized.supporting.length,
    tokenEstimate: optimized.tokenEstimate,
    pruned: optimized.prunedCount,
  });

  // Track fact access for all returned facts
  const factIds = optimized.facts.map(f => f.id);
  await trackFactAccess(root, factIds);

  // Build the result
  const result: FactSearchResult = {
    facts: optimized.facts.map(f => ({
      id: f.id,
      content: f.content,
      category: f.category,
      confidence: f.confidence,
      timestamp: f.timestamp,
      entities: f.entities,
      score: f.score,
      source: f.source,
    })),
    supporting_context: optimized.supporting.map(s => ({
      content: s.content,
      source_path: s.source_path,
      timestamp: s.timestamp,
      related_fact_id: s.related_fact_id,
    })),
    assembled_context: optimized.assembled,
    token_estimate: optimized.tokenEstimate,
    stats: {
      direct_facts: directFacts.length,
      expanded_facts: expandedFacts.length,
      supporting_chunks: supporting.length,
      pruned_items: optimized.prunedCount,
    },
  };

  logger.info('Fact-first search completed', {
    query: query.slice(0, 60),
    totalFacts: result.facts.length,
    tokenEstimate: result.token_estimate,
  });

  return result;
}
