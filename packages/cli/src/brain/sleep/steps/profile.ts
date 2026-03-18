/**
 * KyberBot — Sleep Agent: Profile Generation Step
 *
 * Regenerates the user profile from the fact store when the cached
 * version is stale. The profile is a lightweight JSON snapshot of key
 * facts, ready for instant injection into system prompts.
 *
 * Runs after the observe step and before entity-hygiene.
 */

import { createLogger } from '../../../logger.js';
import { generateUserProfile, getCachedProfile, cacheProfile, getProfileAge } from '../../user-profile.js';
import type { SleepConfig } from '../config.js';

const logger = createLogger('sleep:profile');

export interface ProfileResult {
  count: number;   // 1 if regenerated, 0 if skipped
  processed: number;
  errors?: string[];
}

export async function runProfileStep(
  root: string,
  config: SleepConfig
): Promise<ProfileResult> {
  if (!config.enableUserProfile) {
    return { count: 0, processed: 0 };
  }

  // Only regenerate if the cache is stale
  const age = getProfileAge(root);
  const refreshMinutes = config.profileRefreshMinutes || 60;

  if (age < refreshMinutes) {
    logger.debug('User profile cache is fresh, skipping regeneration', {
      ageMinutes: Math.round(age),
      thresholdMinutes: refreshMinutes,
    });
    return { count: 0, processed: 1 };
  }

  try {
    const profile = await generateUserProfile(root);
    cacheProfile(root, profile);

    logger.info('User profile regenerated', {
      factCount: profile.fact_count,
      entityCount: profile.top_entities.length,
    });

    return { count: 1, processed: 1 };
  } catch (err) {
    const message = `Profile generation failed: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn(message);
    return { count: 0, processed: 1, errors: [message] };
  }
}
