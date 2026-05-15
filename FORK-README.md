# FORK-README.md — MoonCaves/muppets

> **For agents coming in cold.** This document gives you everything you need to understand, maintain, and rebase this fork without any prior context. Read it fully before touching anything.

---

## What this repo is

This is `MoonCaves/muppets` — a private fork of `KybernesisAI/kyberbot` (Ian's open-source personal AI agent framework). It runs Jay's "Muppet Fleet": three AI agents (Kermit, Rizzo, Scooter) operating as a single PM2-managed process on a Hetzner server.

The fork adds fleet-mode features and fixes that Ian hasn't shipped upstream yet. The goal is **minimal divergence** — we carry only what we must, stay close to upstream, and drop patches the moment Ian ships equivalent functionality.

**Upstream:** `KybernesisAI/kyberbot`
**Fork:** `MoonCaves/muppets`
**Production branch:** `main` (single branch — all others were cleaned up 2026-05-16)
**Archived WIP:** tag `archive/chat-inlet-wip-2026-05-04` (incomplete OpenAI shim work, not in production)

---

## Infrastructure quick reference

| Thing | Value |
|---|---|
| Server | `ai-server` (Hetzner CPX31, `168.119.191.143`) |
| User | `kermit` |
| Repo path | `/home/kermit/kyberbot` |
| PM2 process | `kyberbot-fleet` (ID 17) |
| Fleet port | `3456` |
| ChromaDB | `http://localhost:8000` (Coolify-managed container) |
| SilverBullet data | `/home/kermit/silverbullet-data-new/` |

**SSH:** `ssh kermit` (password-free, configured in Mac `~/.ssh/config`)
**NVM required:** Always prefix Node/PM2/kyberbot commands with `source ~/.nvm/nvm.sh &&`

**Agent roots:**

| Agent | Root | Port | ChromaDB collection |
|---|---|---|---|
| Kermit | `/home/kermit/my-agent` | 3457 | `kyberbot_kermit` (`7f94f28b-...`) |
| Rizzo | `/home/kermit/rizzo-agent` | 3458 | `kyberbot_rizzo` (`249c09c4-...`) |
| Scooter | `/home/kermit/scooter-agent` | 3459 | `kyberbot_scooter` (`c02597e6-...`) |

---

## Fleet start/stop — the rules

### Starting the fleet

```bash
# If kyberbot-fleet is not registered in PM2 yet:
ssh kermit "source ~/.nvm/nvm.sh && pm2 start 'kyberbot fleet start' --name kyberbot-fleet --cwd /home/kermit && pm2 save"
# If already registered:
ssh kermit "source ~/.nvm/nvm.sh && pm2 start kyberbot-fleet"
```

### Restarting after a code change

**NEVER use `pm2 restart`** — it reuses cached dotenv and won't pick up env var changes.
The correct sequence:

```bash
ssh kermit "source ~/.nvm/nvm.sh && pm2 delete kyberbot-fleet"
# Wait 65 seconds — Telegram 409 conflict if you restart too fast
sleep 65
ssh kermit "source ~/.nvm/nvm.sh && pm2 start 'kyberbot fleet start' --name kyberbot-fleet --cwd /home/kermit && pm2 save"
```

### Checking fleet health

```bash
ssh kermit "curl -s http://localhost:3456/health | python3 -m json.tool"
```

### Port 3456 conflicts on restart

```bash
ssh kermit "lsof -ti :3456 | xargs kill -9 2>/dev/null"
```

---

## Quick state check — run this when you arrive cold

```bash
# Fleet running?
ssh kermit "source ~/.nvm/nvm.sh && pm2 list --no-color | grep kyberbot"
# Health
ssh kermit "curl -s http://localhost:3456/health | python3 -m json.tool | grep -E 'name|status'"
# How far behind upstream? (src only — ignore .als/ commits)
ssh kermit "cd /home/kermit/kyberbot && git fetch upstream --quiet 2>/dev/null && git log main..upstream/main --oneline -- packages/cli/src/ | wc -l && echo 'commits behind upstream (src only)'"
# Uncommitted changes?
ssh kermit "cd /home/kermit/kyberbot && git status --short"
# Last 5 commits
ssh kermit "cd /home/kermit/kyberbot && git log --oneline -5"
```


---

## Current patches — what we carry and why

22 commits ahead of `upstream/main` as of 2026-05-16.

### Patch 1 — `fd738c4` — Fleet isolation (THE BIG ONE) — Risk: HIGH
Per-agent isolation across embeddings, channels, and runtime. Without this, all agents share one ChromaDB collection and stamp facts with whichever identity loaded last.

**Files (10):** `brain/embeddings.ts`, `config.ts`, `runtime/fleet-manager.ts`, `claude.ts`, `server/channels/telegram.ts`, `whatsapp.ts`, `system-prompt.ts`, `conversation-history.ts`, `server/chat-sse.ts`, `management-api.ts`

**Retire when:** Ian ships `feature/multi-agent-runtime`.

**Rebase verification:**
```bash
grep -n 'agentName.*telegram:' packages/cli/dist/server/channels/telegram.js
# Expected output contains: ${agentName}:telegram:${chatId}
```

---

### Patch 2 — `50cbc7c` — Speaker attribution — Risk: MODERATE
Adds `speaker_id` and `speech_type` columns to facts table. Schema change is additive/idempotent.

**Files:** `brain/fact-store.ts`, `brain/fact-extractor.ts`, `brain/sleep/steps/observe.ts`

**Post-rebase verify:** `sqlite3 /home/kermit/my-agent/data/timeline.db '.schema facts' | grep speaker`

---

### Patch 3 — `986a817` — Fleet listener port fix — Risk: LOW
Bus CLI hardcoded to port 3456 (fleet) not per-agent port.
**File:** `commands/bus.ts` — **Retire when:** Ian adds `getFleetPort()`.

---

### Patch 4 — `92c4cd2` — Vitest mock fixes — Risk: TRIVIAL
Three test files needed updated `vi.mock('../config.ts')` blocks after Patch 1 changed config.ts exports.
**Retire when:** Patch 1 lands upstream.

---

### Patch 5 — `0967b48` — Gap-revival extension (ACT-R memory decay) — Risk: LOW-MODERATE
**STATUS: CURRENTLY DISABLED** (commented out 2026-05-12)

Wraps `runDecayStep` with ACT-R activation curve + gap-scaled revival bonus. Fixes decay immortality where items accessed 6+ times never decay.

**To re-enable — two lines in `brain/sleep/index.ts`:**
```typescript
import { makeWrappedDecayStep } from './fork-extensions/integration.js';
const runDecayStep = makeWrappedDecayStep(upstreamRunDecayStep, getTimelineDb);
```

**Full reattachment checklist:** `packages/cli/src/brain/sleep/fork-extensions/REATTACHMENT.md`
**Retire:** Never — local extension, not upstream-bound.

---

### Patch 6 — `91bc936` — Web UI chat fixes — Risk: HIGH on Ian web updates
Subdomain fixes for kermit/rizzo chat UI. **Retire when:** Open-WebUI replaces built-in UI.

---

### Patches 7-8 — `e0ff3a5`, `3fb4593` — Muppets web UI + docs
Fork-specific agent directory and orchestration panels in web UI. Low conflict risk.

---

### Patch 9 — `725a602` — GET /fleet/heartbeats endpoint — Risk: LOW
New API endpoint. **File:** `runtime/fleet-manager.ts`

---

### Patch 10 — `2e7ca9d` — B'' embedding fix — Risk: LOW
Null/zero-norm vectors throw before reaching ChromaDB instead of silent corruption.
**Files:** `brain/embeddings.ts`, `brain/store-conversation.ts`

---

### Patch 11 — `a5fb6bc` — Port collision warning — Risk: LOW
`mountBusRoutes()` extracted, mounted on both fleet + per-agent ports, explicit warning on collision.
**File:** `runtime/fleet-manager.ts`

---

### Patch 12 — `c066285`, `11a4afa` — Subprocess duration_ms telemetry — Risk: LOW
Wall-clock duration added to subprocess close/exit log events.
**File:** `claude.ts`

---

### Patch 13 — `40b36ed` — dotenv override:true — Risk: LOW
Per-agent `.env` files override process env. Required for fleet mode.

---

### Patch 14 — `4bfd654` — Haiku → LiteLLM routing — Risk: MODERATE
All Haiku calls route through LiteLLM at `OPENAI_BASE_URL` instead of Claude subprocess.
**LiteLLM proxy:** `https://ai-api.remotelyhuman.com` (Coolify-managed on ai-server)
**Fallback chain:** DeepInfra gpt-oss-120b → Groq llama-3.3-70b → DeepInfra gpt-oss-20b → Anthropic Haiku
**File:** `claude.ts` — **Retire when:** Ian ships OpenAI-compat routing.

---

### Patch 15 — `d7593bd` — Working tree cleanup commit — Risk: NONE
Previously-unstaged files committed: gap-revival disable, inbox auto-ack removal, OrchPanels updates.

---

### Patches 16-19 — `4b4c5b1`, `8d83671`, `c23a34b`, `86003fb` — Watched folders fleet mode — Risk: LOW-MODERATE

Wires `watched-folders` into fleet mode. Ian had the feature but never called `startWatchedFolders()` from `AgentRuntime.start()`.

**What's included:**
- `getIdentityForRoot(root)` swap in `watched-folders.ts` — fixes global singleton identity bug
- `AgentRuntime` wiring — named field `private watchedFolders: ServiceHandle | null = null`, started in `start()`, stopped in `stop()`
- `deleteBySourcePaths()` in `embeddings.ts` — ChromaDB chunk cleanup on file delete. Uses get-then-delete-by-ID pattern to handle both `{uuid}_chunk_0` and `{uuid}_seg_N_chunk_0` formats
- Cross-contamination fix in `cleanupFile()` — matches timeline by full `folder.path/relPath` not just filename (prevents `kermit/index.md` and `rizzo/index.md` cross-deleting each other)
- All three `cleanupFile` call sites pass `folderPath`

**SilverBullet folders:**
```
/home/kermit/silverbullet-data-new/kermit/   ← Kermit watches
/home/kermit/silverbullet-data-new/rizzo/    ← Rizzo watches
/home/kermit/silverbullet-data-new/scooter/  ← Scooter watches
```

**identity.yaml config (each agent):**
```yaml
watched_folders:
  - path: /home/kermit/silverbullet-data-new/{agentname}
    label: wiki
    enabled: true
    extensions: [.md]
```

**Open items (non-blocking):**
1. Edit-path seg_N orphans — old seg chunks accumulate in ChromaDB on file edit, not delete. Search ranking buries them. Fix when retrieval noise appears.
2. `col.get()` fetches all IDs client-side on every cleanup — fine at current scale.
3. Multi-path `$in` delete (folder removal) untested empirically.

**Retire when:** Ian wires `startWatchedFolders` in `AgentRuntime.start()` with fleet-safe identity.

---

## Rebase procedure — step by step

### Step 0 — Assess first, touch nothing

```bash
ssh kermit "cd /home/kermit/kyberbot && git fetch upstream"
# Check what Ian changed in actual runtime code (ignore .als/)
git log main..upstream/main --oneline -- packages/cli/src/
# Check if he touched our high-risk files
git log main..upstream/main --oneline --name-only -- \
  packages/cli/src/runtime/agent-runtime.ts \
  packages/cli/src/services/watched-folders.ts \
  packages/cli/src/brain/embeddings.ts \
  packages/cli/src/config.ts \
  packages/cli/src/claude.ts
```

### Step 1 — Check which patches can be retired

```bash
git log main..upstream/main --oneline | grep -i "fleet\|watched\|identity\|haiku\|litellm\|speaker"
```

Mark retired patches in this doc. Drop them from the cherry-pick list.

### Step 2 — Create working branch

```bash
ssh kermit "cd /home/kermit/kyberbot && git checkout -b rebase/$(date +%Y-%m-%d) upstream/main"
```

### Step 3 — Cherry-pick patches in order (oldest first)

```bash
git cherry-pick fd738c4  # P1 — fleet isolation
git cherry-pick 50cbc7c  # P2 — speaker attribution
git cherry-pick 986a817  # P3 — port fix
git cherry-pick 92c4cd2  # P4 — vitest mocks
git cherry-pick 0967b48  # P5 — gap-revival (disabled but must carry)
git cherry-pick 91bc936  # P6 — web UI fixes
git cherry-pick e0ff3a5 3fb4593  # P7/8 — web UI panels
git cherry-pick 725a602  # P9 — heartbeats endpoint
git cherry-pick 2e7ca9d  # P10 — B'' fix
git cherry-pick a5fb6bc  # P11 — port collision
git cherry-pick c066285 11a4afa  # P12 — telemetry
git cherry-pick 40b36ed  # P13 — dotenv
git cherry-pick 4bfd654  # P14 — Haiku/LiteLLM
git cherry-pick d7593bd  # P15 — working tree cleanup
git cherry-pick 4b4c5b1 8d83671 c23a34b 86003fb  # P16-19 — watched folders
```

Expect conflicts on P1, P2, P14, P16-19 if Ian touched those files. Resolve in favor of upstream's structure, re-thread our logic.

### Step 4 — Build

```bash
ssh kermit "source ~/.nvm/nvm.sh && cd /home/kermit/kyberbot && pnpm run build 2>&1 | grep -E 'error|Done'"
```

### Step 5 — Verify critical patches

```bash
# P1: convoId namespaced per-agent
grep -n 'agentName.*telegram:' packages/cli/dist/server/channels/telegram.js

# P16-19: watched-folders wired
grep -n 'startWatchedFolders' packages/cli/dist/runtime/agent-runtime.js
grep -n 'getIdentityForRoot' packages/cli/dist/services/watched-folders.js
```

### Step 6 — Runtime smoke test

```bash
ssh kermit "source ~/.nvm/nvm.sh && pm2 delete kyberbot-fleet && sleep 65 && pm2 start 'kyberbot fleet start' --name kyberbot-fleet --cwd /home/kermit"
sleep 10
ssh kermit "curl -s http://localhost:3456/health | python3 -m json.tool | grep -E 'name|status'"
# Drop a test file, verify ingest
ssh kermit "echo '# Rebase smoke test' > /home/kermit/silverbullet-data-new/rizzo/rebase-test-$(date +%s).md"
sleep 15
ssh kermit "sqlite3 /home/kermit/rizzo-agent/data/timeline.db 'SELECT title FROM timeline_events WHERE title LIKE "%rebase-test%"'"
```

### Step 7 — Fast-forward main and push

```bash
git checkout main
git merge --ff-only rebase/$(date +%Y-%m-%d)
git push origin main
```

### Step 8 — Update this doc

Update PATCHES.md header (last rebase date, upstream SHA). Mark retired patches. Update this doc's patch SHAs if cherry-picks produced new hashes.

---

## Known gotchas

**1. pm2 restart reuses cached dotenv** — Always delete + start. Never restart.
**2. Telegram 409** — Wait 65+ seconds between pm2 delete and pm2 start.
**3. `kyberbot fleet list` lies** — Verify with `pm2 list` then `pm2 logs`.
**4. Two ChromaDB containers** — Fleet uses port 8000 (Coolify-managed). `docker ps | grep chroma` to check.
**5. The singleton bug** — `getRoot()` and `getIdentity()` (no args) in fleet code = bug. Always `getIdentityForRoot(root)`.
**6. dist/ must match src/** — Build after every code change. If fleet behavior doesn't match src/, the binary is stale.
**7. kermit-solo conflicts with fleet** — Stop `pm2 stop kermit-solo` before starting fleet. Both hold Kermit's Telegram token.

---

## Env vars reference

| Var | Where | Purpose |
|---|---|---|
| `KYBERBOT_API_TOKEN` | Each agent `.env` | Per-agent API auth |
| `OPENAI_API_KEY` | Each agent `.env` + PM2 env | ChromaDB embeddings via LiteLLM |
| `OPENAI_BASE_URL` | Each agent `.env` | LiteLLM proxy (`https://ai-api.remotelyhuman.com`) |
| `CHROMA_URL` | Each agent `.env` | ChromaDB (`http://localhost:8000`) |
| Telegram `bot_token` | Each agent `identity.yaml` | Telegram channel |

---

## What Ian is likely to ship (watch for conflicts)

- **`feature/multi-agent-runtime`** → will absorb Patch 1. Largest conflict risk.
- **Fleet-mode watched folders** → will absorb Patches 16-19. Check changelog for "AgentRuntime watched folders".
- **`feat/arp-typed-endpoints`** → low risk, new files.
- **`fix/sleep-cycle-dedup`** → touches `brain/sleep/` — verify gap-revival extension still attaches if re-enabled.

---

## Archived work

**tag `archive/chat-inlet-wip-2026-05-04`** — POST `/v1/chat/completions` shim (OpenAI format → Claude subprocess → LiteLLM). Steps 1-4 done, step 5 (streaming) unverified. Not in production.
```bash
git checkout archive/chat-inlet-wip-2026-05-04
```

---

*Last updated: 2026-05-16. Maintained by CD (Claude). Update at end of every rebase or when patches land/retire.*
