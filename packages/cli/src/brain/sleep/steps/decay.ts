/**
 * Decay Step
 *
 * Applies time-based decay to memories:
 * - Older memories get higher decay scores
 * - Decay reduces priority over time
 * - Access count counteracts decay (frequently accessed = important)
 * - Pinned items are exempt from decay
 */

import { createLogger } from '../../../logger.js';
import { getTimelineDb } from '../../timeline.js';
import { SleepConfig } from '../config.js';

const logger = createLogger('sleep:decay');

export interface DecayResult {
  count: number;
  processed: number;
  errors?: string[];
}

/** Detect repetitive content (heartbeat tasks, etc.) by checking title */
function isRepetitiveContent(title: string): boolean {
  const REPETITIVE_PATTERNS = [
    /heartbeat\s+task/i,
    /heartbeat-state/i,
    /check\s+posthog/i,
  ];
  return REPETITIVE_PATTERNS.some(p => p.test(title));
}

export async function runDecayStep(
  root: string,
  config: SleepConfig
): Promise<DecayResult> {
  const db = await getTimelineDb(root);
  const now = Date.now();
  let updated = 0;
  let processed = 0;
  const errors: string[] = [];

  try {
    const items = db.prepare(`
      SELECT id, title, source_path, timestamp, priority, decay_score, access_count, is_pinned
      FROM timeline_events
      WHERE tier != 'archive' OR tier IS NULL
      ORDER BY priority DESC
      LIMIT ?
    `).all(config.batchSize * 2) as Array<{
      id: number;
      title: string | null;
      source_path: string;
      timestamp: string;
      priority: number | null;
      decay_score: number | null;
      access_count: number | null;
      is_pinned: number | null;
    }>;

    processed = items.length;

    for (const item of items) {
      try {
        if (item.is_pinned) continue;

        const timestamp = new Date(item.timestamp).getTime();
        const ageHours = (now - timestamp) / (1000 * 60 * 60);

        const decayBoost = Math.min(config.maxDecay * 0.2, ageHours * config.decayRatePerHour);

        // Apply extra decay for repetitive content (heartbeat tasks, etc.)
        let effectiveDecayBoost = decayBoost;
        if (isRepetitiveContent(item.title || '') && config.repetitiveDecayMultiplier) {
          effectiveDecayBoost *= config.repetitiveDecayMultiplier;
        }

        const newDecay = Math.min(config.maxDecay, (item.decay_score || 0) + effectiveDecayBoost);

        const accessBoost = isRepetitiveContent(item.title || '')
          ? 0  // repetitive content doesn't benefit from access count
          : Math.min(0.3, (item.access_count || 0) * 0.05);
        const decayPenalty = effectiveDecayBoost / 2;
        const newPriority = Math.max(0, Math.min(1, (item.priority ?? 0.5) - decayPenalty + accessBoost));

        const decayChanged = Math.abs(newDecay - (item.decay_score || 0)) > 0.001;
        const priorityChanged = Math.abs(newPriority - (item.priority ?? 0.5)) > 0.001;

        if (decayChanged || priorityChanged) {
          db.prepare(`
            UPDATE timeline_events
            SET decay_score = ?, priority = ?
            WHERE id = ?
          `).run(newDecay, newPriority, item.id);
          updated++;
        }
      } catch (error) {
        errors.push(`Failed to decay item ${item.id}: ${error}`);
      }
    }

    logger.debug('Decay step completed', { processed: items.length, updated });
  } catch (error) {
    logger.error('Decay step failed', { error: String(error) });
    errors.push(`Decay step failed: ${error}`);
  }

  return { count: updated, processed, errors: errors.length > 0 ? errors : undefined };
}
