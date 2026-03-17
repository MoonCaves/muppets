/**
 * Pin Command
 *
 * Pin/unpin entities and memories to protect them from decay and archival.
 *
 * Usage:
 *   kyberbot pin <name>       # Pin an entity or memory
 *   kyberbot unpin <name>     # Unpin an entity or memory
 *   kyberbot pinned           # List all pinned items
 */

import { Command } from 'commander';
import {
  searchEntities,
  getEntityGraphDb,
} from '../brain/entity-graph.js';
import { getTimelineDb } from '../brain/timeline.js';
import { getRoot } from '../config.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function handlePin(name: string) {
  const root = getRoot();
  let pinned = 0;

  // Pin matching entities
  const entities = await searchEntities(root, name, { limit: 5 });
  if (entities.length > 0) {
    const db = await getEntityGraphDb(root);
    for (const entity of entities) {
      db.prepare('UPDATE entities SET is_pinned = 1 WHERE id = ?').run(entity.id);
      console.log(`  Pinned entity: ${entity.name} (${entity.type})`);
      pinned++;
    }
  }

  // Pin matching timeline events
  const timelineDb = await getTimelineDb(root);
  const events = timelineDb.prepare(`
    SELECT id, title FROM timeline_events
    WHERE LOWER(title) LIKE ?
    LIMIT 10
  `).all(`%${name.toLowerCase()}%`) as Array<{ id: number; title: string }>;

  if (events.length > 0) {
    for (const event of events) {
      timelineDb.prepare('UPDATE timeline_events SET is_pinned = 1 WHERE id = ?').run(event.id);
      console.log(`  Pinned memory: ${event.title}`);
      pinned++;
    }
  }

  if (pinned === 0) {
    console.log(`No entities or memories found matching "${name}".`);
  } else {
    console.log(`\nPinned ${pinned} items. They will be protected from decay and archival.`);
  }
}

async function handleUnpin(name: string) {
  const root = getRoot();
  let unpinned = 0;

  const entities = await searchEntities(root, name, { limit: 5 });
  if (entities.length > 0) {
    const db = await getEntityGraphDb(root);
    for (const entity of entities) {
      db.prepare('UPDATE entities SET is_pinned = 0 WHERE id = ?').run(entity.id);
      console.log(`  Unpinned entity: ${entity.name} (${entity.type})`);
      unpinned++;
    }
  }

  const timelineDb = await getTimelineDb(root);
  const events = timelineDb.prepare(`
    SELECT id, title FROM timeline_events
    WHERE LOWER(title) LIKE ? AND is_pinned = 1
    LIMIT 10
  `).all(`%${name.toLowerCase()}%`) as Array<{ id: number; title: string }>;

  if (events.length > 0) {
    for (const event of events) {
      timelineDb.prepare('UPDATE timeline_events SET is_pinned = 0 WHERE id = ?').run(event.id);
      console.log(`  Unpinned memory: ${event.title}`);
      unpinned++;
    }
  }

  if (unpinned === 0) {
    console.log(`No pinned items found matching "${name}".`);
  } else {
    console.log(`\nUnpinned ${unpinned} items.`);
  }
}

async function handlePinned() {
  const root = getRoot();

  // List pinned entities
  const entityDb = await getEntityGraphDb(root);
  const pinnedEntities = entityDb.prepare(
    'SELECT name, type, mention_count FROM entities WHERE is_pinned = 1 ORDER BY name'
  ).all() as Array<{ name: string; type: string; mention_count: number }>;

  // List pinned timeline events
  const timelineDb = await getTimelineDb(root);
  const pinnedEvents = timelineDb.prepare(
    'SELECT title, tier, timestamp FROM timeline_events WHERE is_pinned = 1 ORDER BY timestamp DESC'
  ).all() as Array<{ title: string; tier: string; timestamp: string }>;

  if (pinnedEntities.length === 0 && pinnedEvents.length === 0) {
    console.log('No pinned items.');
    return;
  }

  if (pinnedEntities.length > 0) {
    console.log('# Pinned Entities\n');
    for (const e of pinnedEntities) {
      console.log(`  - ${e.name} (${e.type}) — ${e.mention_count} mentions`);
    }
    console.log('');
  }

  if (pinnedEvents.length > 0) {
    console.log('# Pinned Memories\n');
    for (const e of pinnedEvents) {
      const date = new Date(e.timestamp).toLocaleDateString();
      console.log(`  - ${e.title} [${date}] (${e.tier})`);
    }
    console.log('');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

export function createPinCommand(): Command {
  return new Command('pin')
    .description('Pin an entity or memory (protects from decay and archival)')
    .argument('<name>', 'Entity or memory name to pin')
    .action(handlePin);
}

export function createUnpinCommand(): Command {
  return new Command('unpin')
    .description('Unpin an entity or memory')
    .argument('<name>', 'Entity or memory name to unpin')
    .action(handleUnpin);
}

export function createPinnedCommand(): Command {
  return new Command('pinned')
    .description('List all pinned entities and memories')
    .action(handlePinned);
}
