<!-- LAST VERIFIED: 2026-05-09 against upstream tag v1.9.5 -->
<!-- Re-verify at every upstream release. Update this line if checks pass. -->

# Gap Revival — Re-Attachment Checklist

> This is the document that makes a future "Ian shipped a new main, does our extension still work?"
> check take 5 minutes instead of 5 hours.
>
> When upstream ships a new main, run this checklist.
> If all 4 checks pass, our extension reattaches cleanly.
> If any fail, see the "if this fails" section for that point.

---

## Obsolescence Check — Run Before Reattachment

Before applying the checklist below, ask whether this extension is still necessary. Two questions take 2 minutes and can save hours of unnecessary reattachment work.

**1. Did upstream ship their own immortality fix?**
```bash
git log upstream/main -- packages/cli/src/brain/sleep/steps/decay.ts
```
Look for commits mentioning: immortal, decay cap, FadeMem, accessBoost, priority ceiling, or linear stack-to-cap pattern.

If yes → read their fix. If their logic prevents priorities from drifting to 1.0 with bounded math, our gap-revival extension may be redundant for the immortality use case (our wrapper still adds gap-scaled revival bonus on top, which is separate value — evaluate separately).

**2. Did upstream add per-access timestamp tracking or anything resembling our `gap_revival_state` side table?**
```bash
git log upstream/main --grep=access_timestamp
git log upstream/main -- packages/cli/src/brain/timeline.ts
```
If yes → our side table may be redundant. The gap revival math could potentially run on their data instead of ours.

**3. Did upstream change priority field semantics** — e.g., add tiers, change how priority influences enrichment queue selection, or move priority calculation out of `decay.ts`? Check `git log upstream/main -- packages/cli/src/brain/sleep/steps/decay.ts` for structural changes.

If yes → STOP. Don't reattach until you've verified the wrapper still does what we think it does. Re-do the priority-override.ts integration test against their new priority semantics.

**Verdict matrix:**

| Answers | Action |
|---------|--------|
| All three "no" | Extension still necessary. Run the checklist below. |
| Q1 yes | Consider dropping our FadeMem-equivalent, keeping only the gap-revival bonus. Smaller diff, less to maintain. |
| Q2 yes | Consider migrating to read their access timestamps instead of maintaining our own side table. Drop the trigger, drop the side table, math runs on their data. |
| Q3 yes | **STOP.** Re-verify priority-override.ts assumptions before reattaching anything. |
| All three yes | Extension may be entirely redundant. Drop it, keep math files as reference, retire the wrapper. |

---

## Attachment Points (3 total)

### Point 1: After-decay hook

**File:** `packages/cli/src/brain/sleep/index.ts`
**Function we're hooking:** `runDecayStep` (imported from `./steps/decay.js`)
**What we need:** Run our priority override after their decay loop completes, before the result is used.

**Current call sites (2):**
- Line ~97: `const decayResult = await runDecayStep(root, cfg);` — main sleep cycle
- Line ~263: `const decayResult = await runDecayStep(root, cfg);` — secondary sleep path

**Our attachment:** A const reassignment in `sleep/index.ts` intercepts both call sites at the import-binding level. `makeWrappedDecayStep` factory lives in `integration.ts`.

**If this fails (function renamed/restructured):**
Find the new function that updates `timeline_events.priority` during a sleep cycle. It will be in `sleep/index.ts` or a step file it imports. Wrap the call site(s). The hook is post-decay, pre-next-step.

---

### Point 2: Access-recording — SQLite trigger

**Mechanism:** DB-layer trigger on `timeline_events.access_count`, defined in `schema.sql`.
**What we need:** Timestamp captured to `gap_revival_state` whenever `access_count` increments from any call site.

**Write-site map (upstream main, verified by grep, 2026-05-08):**

`timeline_events.access_count` has THREE production write sites + 1 eval site in upstream main:

| File | Line (repomix) | What it is | Capture? |
|------|---------------|------------|----------|
| `brain/sleep/steps/consolidate.ts` | ~24048 | Dedup bookkeeping — bulk-sums `access_count` when merging duplicate events. Increment is `+N` (N ≥ 2). **NOT a user access.** | NO |
| `brain/timeline.ts` (`incrementTimelineEventCount`) | ~37390 | Named function (+1). Called from `store-conversation.ts:~36403` when same title appears within 2min/24h (re-mention dedup). IS a recency signal. | YES |
| `commands/search.ts` (`trackSearchAccess`) | ~45188 | Real user search hit via direct SQL. Increment is exactly `+1`. | YES |
| `commands/eval.ts` | ~40758 | eval/benchmark consolidation. Bulk `+?`. Test code only. | NO |

`recall.ts` and `fact-retrieval.ts` write `entities.access_count`, a different table — not in our scope.

**Why the trigger, not a function wrapper:**
`incrementTimelineEventCount` exists and covers the re-mention dedup path. But it covers only 1 of 2 user-access production sites — it misses `search.ts` direct SQL entirely. Wrapping the named function alone leaves the most common access path (search) unrecorded. Patching `search.ts` directly violates fork doctrine. The trigger fires at the DB layer and catches both user-access sites without touching any upstream file.

**WHERE clause filters dedup noise:**
```sql
WHEN NEW.access_count = OLD.access_count + 1
```
Real user accesses are always +1. consolidate.ts bulk writes are +N (≥2). The clause lets the former through and skips the latter. See § "What We're NOT Capturing" below.

**Trigger body is data-capture only:**
Two SQL operations: append timestamp to rolling window, increment `accesses_before_window` if cap exceeded. No math. No priority writes. A bug in our activation formula cannot corrupt their write path.

**Startup canary check (`hook-on-access.ts`):**
On boot, fires one test UPDATE to a real `timeline_events` row and verifies `gap_revival_state` was updated within 1 second. If not: log loud, refuse to start. This is the only mechanism that catches a silently-broken trigger at boot instead of weeks later.

**If this fails (upstream restructures DB writes):**
Check whether they've consolidated to a single write path (function or abstraction). If so, function-wrapping regains parity and has better discoverability — switch back. Run verification command #2 below to confirm capture is working.

---

### Point 3: Repetitive content classifier

**File:** `packages/cli/src/brain/sleep/steps/decay.ts`
**Function:** `isRepetitiveContent` (line 25, **NOT exported** — private to module)
**What we need:** Same content classified the same way so our bypass logic aligns with theirs.

**Our attachment:** We own our own copy in `repetitive-guard.ts`. We do NOT import from upstream. Zero patch needed.

**If this fails (their patterns change):**
```bash
# Compare their classifier against ours
grep -A 15 "function isRepetitiveContent" packages/cli/src/brain/sleep/steps/decay.ts
cat packages/cli/src/brain/sleep/fork-extensions/repetitive-guard.ts
```
Update our copy to be a superset. If they add new patterns, we add them too. If they remove patterns, decide whether to keep ours (usually yes — our guard is intentionally broader).

---

## Schema Attachment

**Their table we read from:** `timeline_events`
**Columns we depend on:** `id`, `access_count`, `priority`, `title`, `created_at`

**Our side table:** `gap_revival_state` — foreign-keyed to `timeline_events.id`

**If a column we depend on is renamed/dropped:**
The failure will surface in `priority-override.ts` and `hook-on-access.ts`. Check our SELECT statements in those two files. Run the verification commands below to confirm.

---

## Verification Commands

After reattachment, run these to confirm nothing broke:

```bash
# 1. Verify our side table exists and is populated
sqlite3 /home/kermit/my-agent/data/timeline.db "SELECT COUNT(*) FROM gap_revival_state;"

# 2. Verify hook fires on access — trigger a search and check for new row
# NOTE: recall writes entities.access_count, not timeline_events.access_count — it won't fire our trigger.
# Use search — it fires trackSearchAccess → direct SQL on timeline_events.access_count (+1) → trigger.
kyberbot search "Ryan"
sqlite3 /home/kermit/my-agent/data/timeline.db \
  "SELECT memory_id, json_array_length(access_timestamps) as ts_count \
   FROM gap_revival_state ORDER BY rowid DESC LIMIT 5;"

# 3. Verify priority override applies — check a known-returning entity
sqlite3 /home/kermit/my-agent/data/timeline.db \
  "SELECT te.id, te.title, te.priority, grs.accesses_before_window \
   FROM timeline_events te \
   JOIN gap_revival_state grs ON te.id = grs.memory_id \
   ORDER BY te.priority DESC LIMIT 10;"

# 4. Verify priority distribution looks right (not clustered 0.85–0.99)
sqlite3 /home/kermit/my-agent/data/timeline.db \
  "SELECT \
     ROUND(priority, 1) as bucket, \
     COUNT(*) as count \
   FROM timeline_events \
   WHERE priority IS NOT NULL \
   GROUP BY bucket \
   ORDER BY bucket;"
```

---

## Constants to Recheck Each Upstream Release

| Constant | Where they define it | Our dependency |
|----------|---------------------|----------------|
| `decayRatePerHour` | sleep config | Reference docs only. No longer in our formula. |
| `repetitiveDecayMultiplier` | sleep config | Not used. We own the non-repetitive path entirely. |
| `intervalMs` | sleep config | Used in t_floor assumption: floor is 1h (`FLOOR_MS = 3_600_000` ms) applied before dividing by `YEAR_MS` in activation.ts. If cycle interval changes dramatically, recheck whether 1h is still a sensible guard. |

**If Ian changes `cycleHours` or `decayRatePerHour`:** nothing breaks. Our math is independent of those constants.

---

## What We're NOT Capturing

**consolidate.ts dedup merges** are intentionally excluded by the WHERE clause.

When the sleep agent detects near-duplicate events and merges them, it sums their `access_count` values (`COALESCE(access_count, 0) + ?` where `?` is the merged total). These bulk writes hit our trigger's filter (`NEW = OLD + 1` is FALSE for +2 or more) and are silently skipped.

This is correct behavior. Dedup merges are housekeeping, not user interactions. Including them would contaminate the access timestamp window with spurious "accesses" that never happened from a retrieval perspective.

**If Ian changes the merge arithmetic** (e.g., merges two items each with count=1, producing a +1 write), the WHERE clause would incorrectly capture it. Future-proof check: if you see `gap_revival_state` timestamps that don't correspond to real search/recall events, consolidate.ts arithmetic may have changed. Grep `consolidate.ts` for the access_count UPDATE and verify the increment is still bulk, not +1.

---

## Why Trigger Won — Decision Log

Three options were evaluated for access-recording (Point 2):

| Option | Coverage | Upstream patch required? | Verdict |
|--------|----------|--------------------------|---------|
| Function-wrap `incrementTimelineEventCount` | 1/2 user-access sites covered | No | Rejected — covers re-mention dedup path only; misses `search.ts` direct SQL (`trackSearchAccess`) entirely |
| Patch `search.ts` direct SQL | 2/2 user-access production sites | Yes | Rejected — violates fork doctrine |
| SQLite trigger on `timeline_events.access_count` | 2/2 user-access production sites | No | **Chosen** |

**The trigger wins because it's the only option that's both complete and zero-patch.**

**The discoverability cost is real.** Triggers are invisible in code review and easy to forget. We pay it down with:
1. The comment block in `schema.sql` explaining what the trigger does and why.
2. The startup canary check — trigger failure surfaces at boot, not weeks later.
3. This section — future reader knows exactly why it's a trigger.

**When to revisit:**
If Ian ships a refactor that consolidates all `access_count` increments to a single function or DB abstraction, function-wrapping regains parity and has better discoverability. At that point, drop the trigger and switch to the wrapper. The canary check in `hook-on-access.ts` stays either way.

---

## Files in This Extension

```
packages/cli/src/brain/sleep/fork-extensions/
├── REATTACHMENT.md          ← you are here
├── activation.ts            ← ACT-R activation math (pure, no upstream imports)
├── revival-bonus.ts         ← gap-scaled bonus formula (pure)
├── repetitive-guard.ts      ← our copy of the classifier (superset of upstream)
├── db-handle.ts             ← structural DbHandle interface (no upstream coupling)
├── db-types.ts              ← legacy type shims (scheduled for cleanup)
├── hook-on-access.ts        ← startup canary check (trigger verification on boot)
├── hook-after-decay.ts      ← hook orchestration (calls priority-override.ts)
├── priority-override.ts     ← applies final priority write
└── integration.ts           ← THE ONLY FILE that imports from upstream
```

`schema.sql` lives at `~/my-agent/fork-extensions/gap-revival/schema.sql` — applied to
the runtime DB at install time, not compiled into the framework.

**Zero diff against upstream files.** Their `decay.ts` is identical to `upstream/main`.

**After integration:** 4 lines changed in `sleep/index.ts` — 1 line modified, 3 lines
added, plus a 22-line re-verification comment block. Load-bearing changes:

```diff
-import { runDecayStep, DecayResult } from './steps/decay.js';
+import { runDecayStep as upstreamRunDecayStep, DecayResult } from './steps/decay.js';
+import { getTimelineDb } from '../timeline.js';
+import { makeWrappedDecayStep } from './fork-extensions/integration.js';
+const runDecayStep = makeWrappedDecayStep(upstreamRunDecayStep, getTimelineDb);
```

**No explicit boot call.** `initGapRevival` fires lazily on the first wrapper invocation.
See the comment block at the wrap site for re-verification commands.

This is the irreducible attachment cost under the lazy-DI pattern. Fork doctrine permits
it (hook point, no behavioral change to Ian's code).

---

## Build

Source lives in the framework tree at `packages/cli/src/brain/sleep/fork-extensions/`.
Standard `pnpm build` from the kyberbot root handles compilation — no separate build step.

**pnpm clean hazard:** `pnpm clean` wipes `packages/cli/dist/`, including
`dist/brain/sleep/fork-extensions/`. Recovery is `pnpm build` — source is in-tree,
nothing is lost.

**If Ian ever ships a directory named `fork-extensions/` himself:** rename ours (e.g.
`gap-revival-ext/`) and update the import path in `sleep/index.ts` line 30.

---

## Gap Revival Formula Reference

```
bonus = max(0, ln(gap_days / 21) × 0.20)
```

Applied when: new access detected AND gap to previous access > 21 days.

Reference points:
```
5wk (35d)  → +0.102
6wk (42d)  → +0.138
2mo (60d)  → +0.210
90d        → +0.290
6mo (180d) → +0.428
1yr (365d) → +0.571
2yr        → +0.707
3yr        → +0.788
```

Cap: `min(bonus, 1.0)` — defensive, rarely triggers.

t_floor in ACT-R activation: `const elapsed = Math.max(elapsed_ms, FLOOR_MS)` where `FLOOR_MS = 3_600_000` (1 hour in ms) — prevents near-infinite contribution from same-minute double-write.
