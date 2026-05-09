# PATCHES.md

> Fleet-only patches we carry on top of `upstream/main` (KybernesisAI/kyberbot).
> Update this doc whenever a patch lands, retires, or changes shape.
> Source of truth for the rebase-onto-upstream rhythm.

**Last rebase:** 2026-05-09 — `rebase/v1.9.5-2026-05-09` → `main` (fast-forward).
**Upstream base at rebase:** `upstream/main` ahead-by-0 of our merge-base.
**Patches in flight:** 5 (table below).

---

## Quick reference

| # | SHA | Type | Files | Lines | Rebase risk | Upstream status |
|---|-----|------|-------|-------|-------------|-----------------|
| 1 | `92c4cd2` | wrapper (test mocks) | 3 test files | +9 / −4 | trivial | dies when 3+4 land upstream |
| 2 | `986a817` | surgical patch (port) | `commands/bus.ts` | +6 / −5 | low | retire when `getFleetPort()` helper lands upstream |
| 3 | `50cbc7c` | real patch (schema + LLM) | fact-store, fact-extractor, observe | +129 / −10 | moderate | upstream-ready — PR paused, not currently active |
| 4 | `fd738c4` | real patch (deep) | 10 files across embeddings, config, channels, runtime | +282 / −29 | **HIGH** | upstream-feasible behind `KYBERBOT_FLEET_MODE` flag |
| 5 | `0967b48` | extension (new dir) | 11 files (sleep/index.ts + 10 in fork-extensions/) | +963 / −1 | low-moderate | local extension — not upstream-bound |

**Total drift from `upstream/main`:** +1389 / −49 across 25 files.

---

## Patch 1 — `92c4cd2` — test(fleet): vitest mock gaps for fleet-mode exports

**Type:** wrapper. Pure test glue.
**Files:** `packages/cli/src/{brain/system-prompt,server/channels/telegram,server/channels/whatsapp}.test.ts`.
**Diff:** +9 / −4.

**What it does.** Adds `getAgentNameForRoot` and `isFleetMode` to the `vi.mock('../config.ts', …)` blocks in three test files. Without these, the tests blow up because patch 4 added those exports to `config.ts` and the mocks didn't match the real module's surface.

**Why it exists.** Patch 4 changes the public shape of `config.ts`. The vitest mocks have to mirror that shape or the suite fails at module-resolution time.

**Retire when.** Patch 4 lands upstream. The mocks get folded into Ian's test files in the same PR.

**Rebase notes.** If Ian touches any of these three test files, re-apply manually — the mocks need both Ian's edits and our additions. Conflict markers will fire on the `vi.mock('../config.ts', …)` block. Trivial to resolve: union the two lists of exports.

---

## Patch 2 — `986a817` — fix(bus): use fleet listener port (3456)

**Type:** surgical patch. One-line port fix.
**Files:** `packages/cli/src/commands/bus.ts`.
**Diff:** +6 / −5.

**What it does.** Hardcodes the bus CLI to talk to port 3456 (the fleet manager's shared listener) instead of `getServerPort()` which returns the per-agent port (3457/3458). Routing bus calls through the per-agent port 401s on the API token auth, then silently 404s on the recovery path — so the bus *appears* broken from the CLI with no obvious error.

**Why it exists.** Upstream has one port helper (`getServerPort`) that conflates two concepts: per-agent direct-chat port and shared bus listener port. We need a `getFleetPort()` helper that's distinct.

**Retire when.** Upstream adds a `getFleetPort()` helper (or equivalent). Then this becomes a one-line swap from the hardcode to `getFleetPort()`.

**Rebase notes.** If Ian refactors `getServerPort` or adds his own port helper for fleet mode, this patch may conflict. The diagnostic tells: bus CLI commands silently 401 → check the port literal in `bus.ts`.

**Upstream PR.** Not yet drafted. Lower priority than patch 3 but a clean ~10-line PR when we get to it.

---

## Patch 3 — `50cbc7c` — fix(brain): speaker attribution on extracted facts

**Type:** real patch. Schema migration + LLM prompt + extractor logic.
**Files:** `packages/cli/src/brain/{fact-store,fact-extractor,observe}.ts`.
**Diff:** +129 / −10.

**What it does.** Closes the contamination path that produced the Class-A misattribution we measured pre-fleet (~1.3%, 20 of 1,564 high-confidence facts) and pre-this-patch (~0.5% post-fleet-mode, 4 of 850). The extractor was emitting facts without binding them to the speaker who said them — so the fact store stamped everything with the conversation owner's identity even when the underlying turn was a paste, quote, or acknowledgment.

- `fact-store.ts`: schema gains `speaker_id` (TEXT NOT NULL DEFAULT 'unknown' CHECK IN ('user','agent','external_party','system','unknown')) and `speech_type` (TEXT NOT NULL DEFAULT 'unknown' CHECK across 8 enum values). Migrations are additive and idempotent. Index on `(speaker_id, speech_type)`. `'unknown'` is the migration sentinel only — new writes must set explicit values. Composes cleanly with the ARP metadata columns Ian shipped in `upstream/main` `96f5989` (project_id, tags_json, classification, connection_id, source_did) — all 7 new columns land in one INSERT.
- `fact-extractor.ts`: prompt teaches the LLM to attribute every fact to a speaker_id and speech_type. Validation gate skips fact rows with `speaker_id='unknown'` or `speech_type='unknown'` rather than persisting them with a sentinel. Acknowledgment turns ('Thanks', 'Got it', 'Sure') are skipped at extraction time.
- `observe.ts`: same prompt teaching applied to the sleep-cycle observation step so periodic re-extraction maintains the same attribution discipline.

**Why it exists.** Speaker attribution is a generalizable improvement — single-agent users want it too. This is upstream-quality work.

**Retire when.** Ian merges the upstream PR Kermit is drafting via the `upstream-pr-author` skill. After merge, our commit gets dropped from the rebase and the schema columns + extractor prompt arrive via Ian's branch.

**Rebase notes.** Two surfaces of risk:
1. **Schema migration ordering** — if Ian adds new columns to the facts table, our additive migration must apply *after* his (or be re-ordered). Rebase will not auto-detect this. Verify with: `sqlite3 data/timeline.db ".schema facts"` post-rebase, confirm all 7 columns present.
2. **fact-extractor prompt** — if Ian rewrites the extractor LLM prompt, we'll need to re-thread our speaker_id/speech_type teaching into his new shape. Likely a manual merge.

**Upstream PR.** Paused — upstream PR strategy is not active. Will revisit for trivial single-bug fixes only.

---

## Patch 4 — `fd738c4` — feat(fleet): per-agent isolation across embeddings, channels, runtime

**Type:** real patch, deep. Threads agent identity through 10 files.
**Files:**
```
packages/cli/src/brain/embeddings.ts                       +99 / −x
packages/cli/src/claude.ts                                  +30 / −x
packages/cli/src/config.ts                                  +84 / −x
packages/cli/src/runtime/fleet-manager.ts                   +7  / −x
packages/cli/src/server/channels/conversation-history.ts    +10 / −x
packages/cli/src/server/channels/system-prompt.ts           +28 / −x
packages/cli/src/server/channels/telegram.ts                +18 / −x
packages/cli/src/server/channels/whatsapp.ts                +9  / −x
packages/cli/src/server/chat-sse.ts                         +17 / −x
packages/cli/src/server/management-api.ts                   +9  / −x
```
**Diff:** +282 / −29.

**What it does.** Hardens fleet-mode boundaries so multiple agents in a shared `kyberbot-fleet` PM2 process cannot leak state into each other's stores or channels. Single-agent / terminal use is unaffected — the strict checks below only fire when `KYBERBOT_FLEET_MODE` is set.

- `embeddings.ts`: `getCollectionNameForRoot` refuses singleton fallback in fleet mode (the documented cross-agent contamination vector).
- `config.ts`: `getIdentityForRoot` + `isFleetMode` helpers, per-root identity caching.
- `runtime/fleet-manager.ts`: passes agent root through to channel handlers at construction.
- `claude.ts`: subprocess wrapper stamps agent root onto child env.
- `server/channels/{telegram,whatsapp,system-prompt,conversation-history}.ts`: channels carry root explicitly, no `cwd`/first-identity fallback.
- `server/{chat-sse,management-api}.ts`: route by agent root from URL.

**Why it exists.** This is the fleet-mode foundation. Without it, two agents sharing one PM2 process write to the same Chroma collection, key conversation history off the same `chatId`, and stamp facts with whichever identity the runtime resolves first.

**Retire when.** Upstream adopts a fleet-mode design. Possible — Ian's been drifting toward multi-agent — but no signal yet that he's planning it. Until then, we carry.

**Rebase notes — this is where pain lives.** Every time Ian touches any of the 10 files above, we re-resolve. Recent example: tonight's `convoId` namespacing fix (Ian shipped per-agent port routing in v1.9.4 → we had to re-thread our agent identity through the in-memory histories Map at `telegram.ts:118`).

**Verification checklist for next rebase** (specifically around patch 4):

1. **Confirm `agentName`/`root` propagation through every channel file** — grep each channel for `this.root` and `agentName` at construction time. If any channel is missing the threading, fleet mode will silently fall back to first-identity.
2. **Confirm `convoId` is namespaced in the in-memory histories Map** — `grep -n 'agentName.*:.*telegram:' packages/cli/dist/server/channels/telegram.js` post-build. Expected: `${agentName}:telegram:${chatId}`.
3. **Runtime probe before declaring rebase done** — add a temporary `logger.info` at the convoId construction site, restart fleet, send a heartbeat-triggered telegram, read pm2 logs. Strip the logger before pushing.
4. **Dist-vs-source coherence** — `git log --oneline | head -5` vs `pm2 list` since-times. If process start predates the last relevant commit, the binary is stale; `pm2 restart kyberbot-fleet --update-env` is the remedy.

**Upstream PR.** Feasible behind the `KYBERBOT_FLEET_MODE` flag (single-agent path unchanged), but lower priority than patch 3. Not currently drafted.

---

## Patch 5 — `0967b48` — feat(brain/sleep): gap-revival extension

**Type:** extension (new directory). New files only — no edits to upstream files.
**Files:** `packages/cli/src/brain/sleep/index.ts` (modified) + `packages/cli/src/brain/sleep/fork-extensions/` (10 new files: 9 .ts modules + REATTACHMENT.md).
**Diff:** +963 / −1.

**What it does.** Wraps upstream's `runDecayStep` with a saturating ACT-R activation curve plus a gap-scaled revival bonus when items are re-accessed after long silences. Upstream's linear `accessBoost = min(0.3, access_count * 0.05)` saturates at 6 accesses and never recovers dormant items. This extension replaces that with priority that rises and falls based on real access patterns.

- `integration.ts`: factory — `makeWrappedDecayStep` returns a drop-in replacement for `runDecayStep`. `initGapRevival` fires lazily on first wrapper invocation (idempotent via `canaryPassed` guard).
- `hook-after-decay.ts`: post-decay orchestration — reads `gap_revival_state`, calls `overridePriority` per row.
- `hook-on-access.ts`: access-event hook — records access events, updates gap tracking, runs canary check.
- `priority-override.ts`: core logic — ACT-R activation curve + revival bonus formula.
- `activation.ts`, `revival-bonus.ts`: math implementations.
- `repetitive-guard.ts`: suppresses rapid-access spam (no double-counting within 60s window).
- `db-handle.ts`: structural DbHandle interface — covers every DB method called across the tree. Zero upstream imports; satisfied by both better-sqlite3 and libsql structurally.
- `db-types.ts`: legacy type file — retained on disk, no longer imported. Candidate for removal at Step 8 of future rebase.
- `REATTACHMENT.md`: full reattachment checklist, decision log, re-verification commands, pnpm-clean hazard note.

**Integration point in sleep/index.ts (lines 18, 29-30, 32-54):**
- Line 18: `import { runDecayStep as upstreamRunDecayStep, DecayResult } from './steps/decay.js'`
- Lines 29-30: `getTimelineDb` + `makeWrappedDecayStep` imports
- Lines 32-54: rationale comment block (ASSUMES, TO RE-VERIFY, IF ASSUMPTION BREAKS)
- Line 54: `const runDecayStep = makeWrappedDecayStep(upstreamRunDecayStep, getTimelineDb)`

Both call sites (file-local lines 97 and 263) resolve `runDecayStep` from this module-scope binding — one wrap covers both.

**Schema:** Side table `gap_revival_state` + SQLite trigger on `timeline_events.access_count`. Trigger uses `WHEN NEW.access_count = OLD.access_count + 1` to filter bulk writes, capturing only genuine single-access increments (search.ts and timeline.ts paths).

**Why it exists.** Upstream's decay model has a known immortality problem: items accessed 6+ times get permanently stuck at `accessBoost = 0.3` and never decay regardless of how long they've been dormant. Gap-revival restores natural priority curves.

**Retire when.** This is a local extension, not a patch against upstream code. There is no upstream retire path. The doc lives in-tree and travels with the extension indefinitely.

**Rebase notes.** Three surfaces of risk:
1. **Import alias at line 18** — if Ian renames `runDecayStep` or moves its export, the alias breaks silently. Re-verify with: `grep -n "runDecayStep" packages/cli/src/brain/sleep/index.ts` — expected: 1 import line + N call sites.
2. **getTimelineDb scope** — if Ian moves or renames `getTimelineDb` in `timeline.ts`, the import at line 29 breaks. Re-verify with: `grep -n "export.*getTimelineDb" packages/cli/src/brain/timeline.ts`.
3. **fork-extensions directory name** — if Ian ships his own `fork-extensions/` dir, merge conflict. Mitigation: rename ours (e.g., `gap-revival/`) and update the import path in sleep/index.ts.

Full reattachment checklist: `packages/cli/src/brain/sleep/fork-extensions/REATTACHMENT.md`.

**Upstream PR.** N/A — local extension, not upstream-bound.

---

## Rebase doctrine — what 2026-05-09 taught us

When we rebased onto v1.9.4 tonight, we walked into a field-confusion bug *for the second time in 24 hours*: we tested patch 1 by inspecting `source_conversation_id` in the facts table, when the patch actually keys the in-memory histories Map. Two completely different identifiers. The Phase 2 result told us nothing about patch 1's correctness.

**The lesson:**
> **Test design must probe the patched surface — not a sibling field with a similar-sounding name.** The `convoId` patch keys an in-memory Map, not a database column. Inspecting `source_conversation_id` was the same wrong-field test we caught yesterday and walked into again today. Patterns repeat unless they enter the test-design checklist explicitly.

**What that means in practice for the next rebase:**

- Before designing a verification test, write down: *"What is the patched surface? What field/structure/code path does this patch actually mutate?"*
- If the test probes a different field, the test is invalid no matter what it returns. Discard and redesign.
- If a "false negative" looks plausible, the first hypothesis to test is *not* "the patch is broken" — it is *"is the test probing the right surface."*
- Runtime probes (debug logger at the patched call site) are the gold standard. Database introspection is a downstream consequence and is easily wrong-field.

This lesson is doctrine candidate **#6 doubled** in the post-mortem batch (#231/#232). Full doctrine update lands when we batch all 9 candidates.

---

## Update protocol

**When a patch lands:** add a row to the Quick Reference table, write a full per-patch entry below, update the "Patches in flight" count at top.

**When a patch retires (upstream merges, or we drop it):** mark it `(retired YYYY-MM-DD — reason)` and move to a "Retired patches" section at the bottom of the doc. Don't delete — the history is useful for future rebase pattern-matching.

**When the rebase completes:** update the "Last rebase" date and "Upstream base at rebase" SHA at the top.

**When a rebase teaches a new lesson:** add to the "Rebase doctrine" section *and* propagate to `brain/fleet-engineering-doctrine.md`.

---

## Retired patches

*(none yet — first entry will be `50cbc7c` once the upstream PR merges)*
