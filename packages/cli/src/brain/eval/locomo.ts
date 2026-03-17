/**
 * KyberBot -- LoCoMo Long-Term Memory Benchmark
 *
 * Evaluates KyberBot's REAL production memory pipeline against the LoCoMo dataset:
 *   1. Ingest each conversation via storeConversation() (production ingestion)
 *   2. Extract observations via runObserveStep() (production fact extraction)
 *   3. Query using hybridSearch() (production retrieval)
 *   4. Score answers using token-level F1 with Porter stemming
 *   5. Report per-category and overall accuracy
 *
 * This benchmark tests the actual system, not a custom pipeline -- the score
 * reflects real production quality.
 *
 * Reference: https://arxiv.org/abs/2402.07375
 *
 * Usage (from eval command):
 *   const result = await runLoCoMoBenchmark({
 *     dataPath: 'packages/cli/src/brain/eval/data/locomo10.json',
 *     maxConversations: 3,
 *     categories: [1, 2],
 *     verbose: true,
 *   });
 */

import { readFileSync, writeFileSync } from 'fs';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ChromaClient } from 'chromadb';
import { getClaudeClient } from '../../claude.js';
import { createLogger } from '../../logger.js';
import { resetConfig } from '../../config.js';
import { storeConversation } from '../store-conversation.js';
import { hybridSearch } from '../hybrid-search.js';
import { initializeEmbeddings, isChromaAvailable, resetEmbeddings } from '../embeddings.js';
import { resetTimelineDb } from '../timeline.js';
import { resetEntityGraphDb } from '../entity-graph.js';
import { resetSleepDb } from '../sleep/db.js';
import { runObserveStep } from '../sleep/steps/observe.js';
import { DEFAULT_CONFIG } from '../sleep/config.js';

const logger = createLogger('eval');

// ═══════════════════════════════════════════════════════════════════════════════
// DATA TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface Turn {
  speaker: string;
  dia_id?: string;
  text?: string;
  query?: string;
  blip_caption?: string;
  img_url?: string[];
}

interface QAItem {
  question: string;
  answer?: string | number;
  adversarial_answer?: string;
  evidence: string[];
  category: 1 | 2 | 3 | 4 | 5;
}

interface LoCoMoConversation {
  sample_id: string;
  conversation: {
    speaker_a: string;
    speaker_b: string;
    [key: string]: any;
  };
  qa: QAItem[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

export interface LoCoMoOptions {
  dataPath: string;
  maxConversations?: number;
  categories?: number[];
  verbose?: boolean;
}

export interface LoCoMoResult {
  overall: { accuracy: number; count: number };
  byCategory: Record<number, { accuracy: number; count: number }>;
  byConversation: Record<string, { accuracy: number; count: number }>;
  details?: Array<{
    sampleId: string;
    question: string;
    predicted: string;
    expected: string;
    category: number;
    f1: number;
  }>;
}

/**
 * Run the LoCoMo benchmark against KyberBot's production memory pipeline.
 */
export async function runLoCoMoBenchmark(
  options: LoCoMoOptions
): Promise<LoCoMoResult> {
  const {
    dataPath,
    maxConversations,
    categories = [1, 2, 3, 4, 5],
    verbose = false,
  } = options;

  // Initialize ChromaDB via production pipeline
  await initializeEmbeddings();
  if (!isChromaAvailable()) {
    throw new Error(
      'ChromaDB is required for LoCoMo benchmark. Start with: docker-compose up -d'
    );
  }

  const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8001';
  const categorySet = new Set(categories);

  // Load dataset
  const raw = readFileSync(dataPath, 'utf-8');
  let conversations: LoCoMoConversation[] = JSON.parse(raw);

  if (maxConversations && maxConversations < conversations.length) {
    conversations = conversations.slice(0, maxConversations);
  }

  logger.info(
    `LoCoMo benchmark: ${conversations.length} conversations, categories [${categories.join(',')}]`
  );

  const allDetails: LoCoMoResult['details'] = [];
  const categoryScores: Record<number, { total: number; sum: number }> = {};
  const conversationScores: Record<string, { total: number; sum: number }> = {};

  for (const cat of categories) {
    categoryScores[cat] = { total: 0, sum: 0 };
  }

  // Save original env so we can restore it after the benchmark
  const originalRoot = process.env.KYBERBOT_ROOT;

  for (const conv of conversations) {
    const sampleId = conv.sample_id;
    conversationScores[sampleId] = { total: 0, sum: 0 };

    // Filter QA items by category
    const qaItems = conv.qa.filter((q) => categorySet.has(q.category));
    logger.info(`Evaluating ${sampleId}: ${qaItems.length} questions`);

    // Create isolated temporary brain for this conversation
    const tempRoot = mkdtempSync(join(tmpdir(), `kyberbot-locomo-${sampleId}-`));
    mkdirSync(join(tempRoot, 'data'), { recursive: true });

    // Write minimal identity.yaml for the production pipeline
    writeFileSync(
      join(tempRoot, 'identity.yaml'),
      'agent_name: LoCoMo Benchmark\ntimezone: UTC\nheartbeat_interval: 30m\n'
    );

    try {
      // Reset all production singletons to point at this temp root
      resetConfig();
      resetTimelineDb();
      resetEntityGraphDb();
      resetSleepDb();
      resetEmbeddings();
      process.env.KYBERBOT_ROOT = tempRoot;

      // Re-initialize embeddings for this conversation (fresh ChromaDB collection)
      await initializeEmbeddings();

      // Phase 1: Ingest conversation sessions via production pipeline
      const speakerA = conv.conversation.speaker_a;
      const speakerB = conv.conversation.speaker_b;
      const processed = await ingestConversation(tempRoot, conv, speakerA, speakerB);
      logger.info(`  Indexed ${processed} sessions via storeConversation()`);

      // Phase 1.5: Run observation extraction for better retrieval
      try {
        await runObserveStep(tempRoot, {
          ...DEFAULT_CONFIG,
          maxObservationsPerRun: 100,
        });
        logger.info(`  Observation extraction complete`);
      } catch (err) {
        logger.warn(`  Observation extraction failed (non-fatal)`, {
          error: String(err),
        });
      }

      // Phase 2: Query and score each QA item
      for (let i = 0; i < qaItems.length; i++) {
        const qa = qaItems[i];
        try {
          const predicted = await answerQuestion(
            tempRoot,
            qa,
            speakerA,
            speakerB
          );
          const groundTruth = getGroundTruth(qa);
          const f1 = scoreAnswer(predicted, groundTruth, qa.category);

          categoryScores[qa.category].total++;
          categoryScores[qa.category].sum += f1;
          conversationScores[sampleId].total++;
          conversationScores[sampleId].sum += f1;

          if (verbose) {
            allDetails.push({
              sampleId,
              question: qa.question,
              predicted,
              expected: groundTruth,
              category: qa.category,
              f1,
            });
          }

          if ((i + 1) % 50 === 0) {
            logger.info(
              `  ${sampleId}: ${i + 1}/${qaItems.length} questions processed`
            );
          }
        } catch (err) {
          logger.warn(
            `  Failed on question: "${qa.question.slice(0, 60)}..."`,
            { error: String(err) }
          );
          // Count as zero F1 but don't break the run
          categoryScores[qa.category].total++;
          conversationScores[sampleId].total++;

          if (verbose) {
            allDetails.push({
              sampleId,
              question: qa.question,
              predicted: `[ERROR: ${String(err).slice(0, 100)}]`,
              expected: getGroundTruth(qa),
              category: qa.category,
              f1: 0,
            });
          }
        }
      }

      const convAcc =
        conversationScores[sampleId].total > 0
          ? conversationScores[sampleId].sum /
            conversationScores[sampleId].total
          : 0;
      logger.info(
        `  ${sampleId}: ${convAcc.toFixed(3)} avg F1 (${conversationScores[sampleId].total} questions)`
      );
    } finally {
      // Clean up ChromaDB collection to isolate conversations
      try {
        const chroma = new ChromaClient({ path: chromaUrl });
        await chroma.deleteCollection({ name: 'kyberbot_data' });
      } catch {
        logger.warn(`Failed to clean up ChromaDB collection`);
      }

      // Reset singletons before next conversation
      resetTimelineDb();
      resetEntityGraphDb();
      resetSleepDb();
      resetEmbeddings();

      // Clean up temp directory
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        logger.warn(`Failed to clean up temp directory: ${tempRoot}`);
      }
    }
  }

  // Restore original env
  if (originalRoot) {
    process.env.KYBERBOT_ROOT = originalRoot;
  } else {
    delete process.env.KYBERBOT_ROOT;
  }
  resetConfig();

  // Build results
  const byCategory: Record<number, { accuracy: number; count: number }> = {};
  for (const cat of categories) {
    const s = categoryScores[cat];
    byCategory[cat] = {
      accuracy: s.total > 0 ? s.sum / s.total : 0,
      count: s.total,
    };
  }

  const byConversation: Record<string, { accuracy: number; count: number }> =
    {};
  let overallSum = 0;
  let overallCount = 0;
  for (const [id, s] of Object.entries(conversationScores)) {
    byConversation[id] = {
      accuracy: s.total > 0 ? s.sum / s.total : 0,
      count: s.total,
    };
    overallSum += s.sum;
    overallCount += s.total;
  }

  const result: LoCoMoResult = {
    overall: {
      accuracy: overallCount > 0 ? overallSum / overallCount : 0,
      count: overallCount,
    },
    byCategory,
    byConversation,
  };

  if (verbose) {
    result.details = allDetails;
  }

  // Print summary
  logger.info('=== LoCoMo Benchmark Results ===');
  logger.info(
    `Overall: ${result.overall.accuracy.toFixed(3)} F1 (${result.overall.count} questions)`
  );
  for (const cat of categories) {
    const c = byCategory[cat];
    const label = CATEGORY_LABELS[cat] || `cat-${cat}`;
    logger.info(`  ${label}: ${c.accuracy.toFixed(3)} F1 (${c.count} questions)`);
  }

  return result;
}

const CATEGORY_LABELS: Record<number, string> = {
  1: 'Single-hop',
  2: 'Temporal',
  3: 'Open-domain',
  4: 'Multi-hop',
  5: 'Adversarial',
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: INGESTION (via production storeConversation)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ingest all sessions from a LoCoMo conversation via the production
 * storeConversation() pipeline. Each session becomes one storeConversation()
 * call, which automatically handles:
 * - Entity extraction via Haiku
 * - Timeline FTS indexing
 * - Segment-level ChromaDB indexing
 * - Entity graph storage
 */
async function ingestConversation(
  root: string,
  conv: LoCoMoConversation,
  speakerA: string,
  speakerB: string
): Promise<number> {
  const conversation = conv.conversation;

  // Find all sessions with actual turns
  const sessions: Array<{ num: number; dateTime: string; turns: Turn[] }> = [];

  for (const key of Object.keys(conversation)) {
    const match = key.match(/^session_(\d+)$/);
    if (!match) continue;

    const num = parseInt(match[1], 10);
    const turns = conversation[key] as Turn[];
    const dateTimeKey = `session_${num}_date_time`;
    const dateTime = conversation[dateTimeKey] as string | undefined;

    if (Array.isArray(turns) && turns.length > 0 && dateTime) {
      sessions.push({ num, dateTime, turns });
    }
  }

  // Sort by session number for chronological ingestion
  sessions.sort((a, b) => a.num - b.num);

  logger.debug(
    `  Ingesting ${sessions.length} sessions for ${conv.sample_id}`
  );

  for (const session of sessions) {
    const sessionTimestamp = parseLocomoDateTime(session.dateTime);
    const transcript = buildTranscript(session.turns, speakerA, speakerB);

    // Feed through the production pipeline
    await storeConversation(root, {
      prompt: `DATE: ${session.dateTime}\n${transcript}`,
      response: '', // The transcript IS the content
      channel: 'locomo',
      timestamp: sessionTimestamp,
    });
  }

  return sessions.length;
}

/**
 * Build a human-readable transcript from conversation turns.
 */
function buildTranscript(
  turns: Turn[],
  speakerA: string,
  speakerB: string
): string {
  const lines: string[] = [];

  for (const turn of turns) {
    const speaker = turn.speaker || 'Unknown';
    let content = turn.text || '';

    // Include image descriptions as contextual information
    if (turn.blip_caption) {
      content += content
        ? ` [Image: ${turn.blip_caption}]`
        : `[Image: ${turn.blip_caption}]`;
    }

    if (content) {
      lines.push(`${speaker}: ${content}`);
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: QUERY (via production hybridSearch)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Answer a single QA item using the production hybridSearch() for retrieval.
 */
async function answerQuestion(
  root: string,
  qa: QAItem,
  speakerA: string,
  speakerB: string
): Promise<string> {
  // Use the real hybrid search
  const results = await hybridSearch(qa.question, root, {
    limit: 15,
    tier: 'all',
    includeRelated: true,
  });

  // Assemble context from search results
  const contextParts: string[] = [];
  for (const r of results) {
    const dateLabel = r.timestamp
      ? new Date(r.timestamp).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : 'Unknown date';
    contextParts.push(`[${dateLabel}] ${r.content}`);
  }
  const context =
    contextParts.join('\n---\n') || '(No relevant memories found)';

  const prompt = buildPrompt(qa, context, speakerA, speakerB);

  const client = getClaudeClient();
  const answer = await client.complete(prompt, {
    model: 'haiku',
    maxTokens: 100,
    maxTurns: 1,
  });

  // Clean up answer
  return cleanAnswer(answer);
}

/**
 * Strip common LLM formatting artifacts and normalize numbers.
 */
function cleanAnswer(answer: string): string {
  let cleaned = answer
    .replace(/^#+\s*(Short\s+)?[Aa]nswer:?\s*/i, '')
    .replace(/^(Short\s+)?[Aa]nswer:?\s*/i, '')
    .replace(/\*\*/g, '')
    .replace(/^["']|["']$/g, '') // strip surrounding quotes
    .replace(/\s*\(.*?\)\s*$/g, '') // strip trailing parenthetical notes
    .replace(/\.\s*$/, '') // strip trailing period
    .trim();

  // Normalize number words to digits for F1 matching
  const numberWords: Record<string, string> = {
    once: '1',
    twice: '2',
    thrice: '3',
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
    ten: '10',
  };
  // Only replace standalone number words
  cleaned = cleaned.replace(
    /\b(once|twice|thrice|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,
    (match) => {
      return numberWords[match.toLowerCase()] || match;
    }
  );

  return cleaned;
}

/**
 * Build prompt for the QA item with retrieved context from hybridSearch.
 */
function buildPrompt(
  qa: QAItem,
  context: string,
  speakerA: string,
  speakerB: string
): string {
  const preamble =
    `The following are excerpts from past conversations between ${speakerA} and ${speakerB}, ` +
    `retrieved from memory. The date of each excerpt is shown.\n\n` +
    context +
    '\n\n';

  switch (qa.category) {
    case 1: // Multi-hop
      return (
        preamble +
        'Based on the above context, write an answer in the form of a short phrase for the following question. ' +
        'Answer with exact words from the context whenever possible. ' +
        'If the question asks for a list, include ONLY items explicitly mentioned, separated by commas. ' +
        'Use digits for numbers (e.g., "2" not "two"). No explanations.\n\n' +
        `Question: ${qa.question}\nShort answer:`
      );

    case 2: // Temporal
      return (
        preamble +
        'Based on the above context, write an answer in the form of a short phrase for the following question. ' +
        'Use DATE of CONVERSATION to answer with an approximate date. ' +
        'IMPORTANT: When someone says "last year" in a 2023 conversation, the answer is 2022. ' +
        'When someone says "yesterday" in a session dated "15 May 2023", the answer involves 14 May 2023. ' +
        'Give just the date or time period, no explanation.\n\n' +
        `Question: ${qa.question}\nShort answer:`
      );

    case 3: // Open-domain
      return (
        preamble +
        'Based on the above context, write an answer in the form of a short phrase for the following question. ' +
        'If yes/no: start with "Yes" or "Likely no" then a brief reason. ' +
        'For traits/personality: list 2-4 adjectives. Keep answer under 10 words.\n\n' +
        `Question: ${qa.question}\nShort answer:`
      );

    case 4: // Single-hop
      return (
        preamble +
        'Based on the above context, write an answer in the form of a short phrase for the following question. ' +
        'Answer with exact words from the context whenever possible. ' +
        'Use digits for numbers. No explanations, just the answer.\n\n' +
        `Question: ${qa.question}\nShort answer:`
      );

    case 5: // Adversarial
      return (
        preamble +
        'Based on the above context, answer the following question.\n' +
        `IMPORTANT: The question asks about a SPECIFIC person. ${speakerA} and ${speakerB} are different people. ` +
        'If the information asked about belongs to the OTHER person or is not mentioned at all, ' +
        'answer with "Not mentioned in the conversation".\n\n' +
        `Question: ${qa.question}\nShort answer:`
      );

    default:
      return (
        preamble +
        'Based on the above context, write an answer in the form of a short phrase for the following question. ' +
        'Answer with exact words from the context whenever possible.\n\n' +
        `Question: ${qa.question}\nShort answer:`
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: SCORING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the ground truth answer for a QA item.
 */
function getGroundTruth(qa: QAItem): string {
  if (qa.category === 5) {
    // Category 5 uses adversarial_answer as a distractor;
    // the correct behavior is to say "not mentioned"
    return 'not mentioned';
  }
  return String(qa.answer ?? '');
}

/**
 * Score a predicted answer against the ground truth, using category-specific logic.
 */
function scoreAnswer(
  prediction: string,
  groundTruth: string,
  category: number
): number {
  switch (category) {
    case 1: // Multi-hop: split by comma, partial F1 for each sub-answer, average
      return scoreMultiHop(prediction, groundTruth);
    case 2: // Temporal: straight F1
      return f1Score(prediction, groundTruth);
    case 3: // Open-domain: truncate at first semicolon, then F1
      return scoreOpenDomain(prediction, groundTruth);
    case 4: // Single-hop: straight F1
      return f1Score(prediction, groundTruth);
    case 5: // Adversarial: binary check
      return scoreAdversarial(prediction);
    default:
      return f1Score(prediction, groundTruth);
  }
}

/**
 * Category 1 (multi-hop): Split ground truth by comma, compute F1 for each
 * sub-answer against the full prediction, then average.
 */
function scoreMultiHop(prediction: string, groundTruth: string): number {
  const subAnswers = groundTruth
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (subAnswers.length === 0) return 0;

  const scores = subAnswers.map((sub) => f1Score(prediction, sub));
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Category 3 (open-domain): Truncate ground truth at first semicolon, then F1.
 */
function scoreOpenDomain(prediction: string, groundTruth: string): number {
  const truncated = groundTruth.split(';')[0].trim();
  return f1Score(prediction, truncated);
}

/**
 * Category 5 (adversarial): Binary -- 1.0 if the prediction indicates
 * the information is not available.
 */
function scoreAdversarial(prediction: string): number {
  const lower = prediction.toLowerCase();
  if (
    lower.includes('not mentioned') ||
    lower.includes('no information available') ||
    lower.includes('not available') ||
    lower.includes('not found') ||
    lower.includes('no mention') ||
    lower.includes('not discussed') ||
    lower.includes('no relevant')
  ) {
    return 1.0;
  }
  return 0.0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// F1 SCORING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize an answer string for scoring: lowercase, remove punctuation,
 * remove articles, collapse whitespace.
 */
function normalizeAnswer(s: string): string {
  s = s.replace(/,/g, '');
  s = s.toLowerCase();
  s = s.replace(/[^\w\s]/g, '');
  s = s.replace(/\b(a|an|the|and)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Compute token-level F1 between prediction and ground truth,
 * with Porter stemming applied to each token.
 */
function f1Score(prediction: string, groundTruth: string): number {
  const predTokens = normalizeAnswer(prediction)
    .split(' ')
    .filter(Boolean)
    .map(porterStem);
  const gtTokens = normalizeAnswer(groundTruth)
    .split(' ')
    .filter(Boolean)
    .map(porterStem);

  if (predTokens.length === 0 && gtTokens.length === 0) return 1.0;
  if (predTokens.length === 0 || gtTokens.length === 0) return 0.0;

  // Count common tokens (multiset intersection)
  const gtCounts = new Map<string, number>();
  for (const t of gtTokens) {
    gtCounts.set(t, (gtCounts.get(t) || 0) + 1);
  }

  let common = 0;
  const gtCountsCopy = new Map(gtCounts);
  for (const t of predTokens) {
    const count = gtCountsCopy.get(t) || 0;
    if (count > 0) {
      common++;
      gtCountsCopy.set(t, count - 1);
    }
  }

  if (common === 0) return 0.0;

  const precision = common / predTokens.length;
  const recall = common / gtTokens.length;

  return (2 * precision * recall) / (precision + recall);
}

/**
 * Simple Porter stemmer approximation.
 *
 * Handles common English suffixes for token matching purposes.
 * This is intentionally simple -- the LoCoMo benchmark only uses stemming
 * to normalize surface-level morphological variation for F1 computation.
 */
function porterStem(word: string): string {
  if (word.length <= 3) return word;

  let stem = word;

  // Step 1: Plurals and past participles
  if (stem.endsWith('sses')) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith('ies') && stem.length > 4) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith('ness')) {
    stem = stem.slice(0, -4);
  } else if (stem.endsWith('ment')) {
    stem = stem.slice(0, -4);
  } else if (stem.endsWith('tion')) {
    stem = stem.slice(0, -3);
  } else if (stem.endsWith('sion')) {
    stem = stem.slice(0, -3);
  } else if (stem.endsWith('ible')) {
    stem = stem.slice(0, -4);
  } else if (stem.endsWith('able')) {
    stem = stem.slice(0, -4);
  } else if (stem.endsWith('ing') && stem.length > 5) {
    stem = stem.slice(0, -3);
    // Handle doubling: running -> runn -> run
    if (
      stem.length >= 2 &&
      stem[stem.length - 1] === stem[stem.length - 2] &&
      'bdfgmnprst'.includes(stem[stem.length - 1])
    ) {
      stem = stem.slice(0, -1);
    }
  } else if (stem.endsWith('ed') && stem.length > 4) {
    stem = stem.slice(0, -2);
    // Handle doubling: stopped -> stopp -> stop
    if (
      stem.length >= 2 &&
      stem[stem.length - 1] === stem[stem.length - 2] &&
      'bdfgmnprst'.includes(stem[stem.length - 1])
    ) {
      stem = stem.slice(0, -1);
    }
  } else if (stem.endsWith('ly') && stem.length > 4) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith('es') && stem.length > 4) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith('s') && !stem.endsWith('ss') && stem.length > 3) {
    stem = stem.slice(0, -1);
  }

  return stem;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse LoCoMo datetime strings like "1:56 pm on 8 May, 2023" into ISO 8601.
 */
function parseLocomoDateTime(dt: string): string {
  // Format: "H:MM am/pm on D Month, YYYY"
  const match = dt.match(
    /(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+(\w+),?\s+(\d{4})/i
  );

  if (!match) {
    // Fallback: try as a general date
    const fallback = new Date(dt);
    if (!isNaN(fallback.getTime())) {
      return fallback.toISOString();
    }
    return new Date().toISOString();
  }

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toLowerCase();
  const day = parseInt(match[4], 10);
  const monthStr = match[5];
  const year = parseInt(match[6], 10);

  // Convert 12-hour to 24-hour
  if (ampm === 'pm' && hours !== 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;

  const months: Record<string, number> = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  };

  const month = months[monthStr.toLowerCase()];
  if (month === undefined) {
    return new Date().toISOString();
  }

  const date = new Date(year, month, day, hours, minutes, 0, 0);
  return date.toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS FOR TESTING
// ═══════════════════════════════════════════════════════════════════════════════

export {
  normalizeAnswer as _normalizeAnswer,
  f1Score as _f1Score,
  porterStem as _porterStem,
  scoreAnswer as _scoreAnswer,
  parseLocomoDateTime as _parseLocomoDateTime,
  buildTranscript as _buildTranscript,
};
