# Muppets Dashboard

The orchestration dashboard at **muppets.remotelyhuman.com** — a single-page view of the agent fleet's goals, issues, inbox, KPIs, runs, activity, and org chart.

This README is the checkpoint for the working prototype as of 2026-05-10. Read this first when picking the project back up after a break.

---

## Status — working prototype, visual only

The dashboard reads cleanly from the live orchestration API and refreshes every 30s. **The only actionable element today is the two agent cards** at the top — clicking them navigates to `kermit.remotelyhuman.com/ui` and `rizzo.remotelyhuman.com/ui` for direct chat. Everything below the agent cards is read-only (no buttons that mutate state yet).

That's deliberate — the goal of this iteration was to surface the orchestration layer Ian (KybernesisAI) ships in upstream KyberBot, render it cleanly, and get the wiring right before adding write actions.

---

## Where it lives in the repo

| Thing | Path |
|---|---|
| Frontend entry | `packages/web/src/App.tsx` (host-gates on `muppets.*` and renders `MuppetsDashboard`) |
| Agent directory | `packages/web/src/components/dashboard/MuppetsDashboard.tsx` (~177 lines) |
| Orchestration panels | `packages/web/src/components/dashboard/OrchPanels.tsx` (~1086 lines) |
| Backend routes | `packages/cli/src/server/orchestration-api.ts` (mounted at `/fleet/orch/*`) |
| Orchestration core | `packages/cli/src/orchestration/` (issues, goals, inbox, runs, activity, artifacts, projects, org) |

The web package's other surface (per-agent chat UI at `kermit.*` / `rizzo.*`) is **not** the dashboard — same bundle, different host gate.

---

## Architecture

```
muppets.remotelyhuman.com  ─┐
                            ├──► same bundle, served by every kyberbot agent process
kermit.remotelyhuman.com   ─┤    (App.tsx routes by Host header prefix)
rizzo.remotelyhuman.com    ─┘

Browser  ──polls 30s──►  GET /fleet/orch/dashboard   ──► aggregate payload
                         GET /fleet/orch/issues      ──► full issues window
                         GET /fleet/orch/inbox       ──► pending items
                         GET /fleet/orch/runs        ──► last 30 heartbeat runs
                         GET /fleet/orch/activity    ──► last 40 events
                         GET /fleet/orch/artifacts   ──► last 20 artifacts
                         GET /fleet/orch/goals/:id/kpis  (per-goal, 60s polling)
```

**Stack:** React 18 + TypeScript + Vite + Tailwind. No router — single page, host-gated. Polling via a small `usePolledJson` hook with `cache: 'no-store'`. State held in component local refs; no global store needed at this scale.

**Backend:** Express router in the kyberbot CLI server. Reads from the orchestration SQLite layer (`agent_data.db` orch tables — issues, goals, inbox_items, activity_log, heartbeat_runs, artifacts, projects, org_chart).

**Auth:** muppets host serves the dashboard without a token prompt — it's a read-only fleet-internal view. The chat UI on `kermit.*` / `rizzo.*` does require `KYBERBOT_API_TOKEN`.

---

## Panel layout (6 rows)

| Row | Panel(s) | Source |
|---|---|---|
| 1 | **METRICS** — 6 KPI tiles: GOALS / IN PROGRESS / BLOCKED / INBOX / RUNS 24H success% / AGENTS | `/dashboard` + `/runs` |
| 2 | **KANBAN** — 4 columns (Backlog \| In Progress \| Blocked \| Done — Julian's order). Auxiliary statuses (todo, in_review, cancelled) shown as inline chips. | `/issues?limit=100` |
| 3 | **CAMPAIGN** (active goals) \| **INBOX** (pending items, full body) | `/dashboard` + `/inbox?status=pending` |
| 4 | **KPI_TRACKER** (per-goal KPIs with progress bars) \| **HEARTBEAT_RUNS** (last 12, status + duration + age) | `/goals/:id/kpis` + `/runs` |
| 5 | **ACTIVITY** (last 25 events) \| **ARTIFACTS** (last 10 outputs) | `/activity` + `/artifacts` |
| 6 | **PROJECTS** \| **ORG_CHART** (recursive reports_to tree) | `/dashboard` (org + projects) |

Header strip shows: `MUPPETS // AGENT_DIRECTORY`, live UTC clock, dark/light toggle.
Below the orch panels, a single LIVE/CONNECTING/OFFLINE indicator reflects last successful poll.

---

## What's actionable today

- ✅ **Click Kermit card** → `https://kermit.remotelyhuman.com/ui` (chat)
- ✅ **Click Rizzo card** → `https://rizzo.remotelyhuman.com/ui` (chat)
- ✅ **Dark/light toggle** (persists via `useTheme` hook)
- ❌ Everything else is display-only — no transitions, no inbox actions, no comments, no goal/KPI edits.

The orchestration API supports POST routes for all of these (`/issues/:id/transition`, `/inbox/:id/resolve`, `/issues/:id/comments`, `/goals` create, etc.) — they're just not wired into the UI yet.

---

## Build & deploy

```bash
# Local dev (runs on Vite, proxies to your local kyberbot server)
cd packages/web
pnpm dev

# Production build
pnpm build
# Output: packages/web/dist/

# Deploy: the kyberbot CLI server serves dist/ statically.
# After build, restart the fleet pm2 process so the binary picks up new dist/.
pm2 restart kyberbot-fleet --update-env
```

Verify after deploy:
```bash
curl -s https://muppets.remotelyhuman.com/ | grep -o 'index-[A-Za-z0-9_-]*\.js'   # bundle hash
curl -s https://muppets.remotelyhuman.com/fleet/orch/dashboard | jq '.goals.total' # API healthy
```

---

## Endpoint contracts consumed — verified against backend

The frontend only `GET`s. Shapes are TypeScript-asserted at the top of `OrchPanels.tsx`. All field names below were verified against `packages/cli/src/server/orchestration-api.ts` on 2026-05-10. If the backend changes a field name, the affected panel renders empty silently — no runtime guard.

Default poll: 30s for everything except per-goal KPIs (60s). All requests use `cache: 'no-store'`.

| Endpoint | Frontend field path | Backend response field | Status |
|---|---|---|---|
| `/dashboard` | `data.goals.items` | `goals.items` (active goals only) | ✅ |
| `/dashboard` | `data.goals.total/active/completed` | `goals.{total,active,completed}` | ✅ |
| `/dashboard` | `data.issues.counts` | `issues.counts` (all statuses) | ✅ |
| `/dashboard` | `data.issues.recent` | `issues.recent` (first 10 only) | ✅ — fallback only |
| `/dashboard` | `data.inbox.pending` | `inbox.pending` | ✅ |
| `/dashboard` | `data.inbox.items` | **never sent** | ⚠️ dead fallback — see risks |
| `/dashboard` | `data.activeAgents` | `activeAgents` (agents with status='running' run in last 20 runs) | ✅ wired, meaning is narrow |
| `/dashboard` | `data.org`, `data.projects`, `data.activity` | `org`, `projects`, `activity` | ✅ |
| `/issues?limit=100` | `issuesResp.issues` | `{ issues: Issue[] }` | ✅ |
| `/inbox?status=pending` | `inboxResp.items` | `{ items: InboxItem[] }` | ✅ |
| `/runs?limit=30` | `runsResp.runs` | `{ runs: HeartbeatRun[] }` | ✅ |
| `/activity?limit=40` | `activityResp.entries` | `{ entries: ActivityEntry[] }` | ✅ |
| `/artifacts?limit=20` | `artifactsResp.artifacts` | `{ artifacts: Artifact[] }` | ✅ |
| `/goals/:id/kpis` | `json.kpis` | `{ kpis: KPI[] }` | ✅ |

**Two backend behaviors worth knowing:**
- `data.projects` comes from `listProjects({ status: 'active' })` — it really is active-only, so "ACTIVE" in the panel meta is accurate.
- `data.activeAgents` means "agents with a heartbeat run currently in `running` status" (sampled from the most recent 20 runs) — not a live process check. An idle but healthy agent shows as 0.

---

## Known limits / things deliberately deferred

- **No write actions in the UI.** Issue transitions, inbox acknowledge/resolve, goal create — all backend-supported, none wired.
- **No filtering or search.** Kanban shows the most-recent 100 issues; there's no per-agent filter, no label filter, no assignee filter.
- **No drilldown.** Clicking an issue/goal/artifact does nothing. No detail modal, no link to source.
- **Agent cards are static metadata** (name, emoji, role, description hardcoded in `MuppetsDashboard.tsx`). They don't reflect actual online state — the "ONLINE" pulse is decorative.
- **`activeAgents`** in the dashboard payload is shown only as a count in the KPI strip; the list itself isn't surfaced. The count is narrow: agents with a heartbeat run in `running` state within the last 20 runs — an idle-but-healthy agent shows 0.
- **No auth on muppets host.** Anyone with the URL sees the full orchestration state (goals, issues, inbox, org chart). Currently URL-as-secret. Worth hardening before any sensitive data lands in goals/issues. The backend supports a token-auth middleware; the muppets host just doesn't require it.
- **No mobile pass.** Layout is responsive at 4-col → 1-col breakpoints, but small-screen kanban is not great.
- **Polling, not streaming.** Seven independent polled fetches, no SSE, no shared browser cache. Multiple open tabs multiply load linearly. At 2-agent scale this is trivial; at 10+ agents with many goals/issues it stays manageable because panel limits are capped (100 issues, 20 artifacts, 40 activity). The GoalKPITracker caps at 4 goals × 1 request each at 60s intervals.
- **`agentEmoji` is hardcoded by name** — adding a new fleet agent (e.g., Gonzo) requires a code change to `OrchPanels.tsx` or it gets the generic 🤖 fallback.
- **Artifacts panel meta says "TOTAL"** but it's limited to the last 20 by the fetch. Should read "RECENT" or "LAST 20."

---

## Runtime risks (things that could break silently)

These are behavioral bugs, not deferred features:

1. **Inbox silent-empty on secondary fetch failure.** The inbox panel's data chain is `inboxResp?.items ?? data?.inbox?.items ?? []`. The second fallback (`data?.inbox?.items`) is dead code — the `/dashboard` endpoint never sends `inbox.items`, only `inbox.pending`. If the `/inbox?status=pending` request fails (e.g., backend overload), the panel shows "inbox clear" with no error indicator even when there are pending items. Fix: surface an error state on the panel if `inboxResp` is null after load.

2. **KPI success rate shows 0% / RED when no heartbeat runs exist in 24h.** The calculation uses `totalRuns = recent24h.length || 1` — if no runs, `successRate = 0%` and the tile turns red. This looks like an alarm on a fresh install or after extended downtime. Fix: detect the `recent24h.length === 0` case and render `—` instead.

3. **OrgChartPanel crashes on cyclic `reports_to` data.** `renderNode()` recurses without a visited-set or depth guard. A cycle in the orch DB (A reports_to B, B reports_to A) will hit a call-stack overflow and crash the page. Unlikely with 2 known agents but the DB is writable by any agent. Fix: add a `visited: Set<string>` parameter to the recursive call.

4. **KPI strip counts vs Kanban card counts can diverge.** The BLOCKED/IN PROGRESS counts in the KPI strip come from `data.issues.counts` (all issues, computed server-side). The Kanban cards come from `/issues?limit=100`. If there are >100 issues, the Kanban underrepresents while the KPI is correct — looks like a display bug. Not urgent at current scale.

5. **`InboxItem.urgency === 'critical'` is a dead code path.** The backend urgency type is `'high' | 'normal' | 'low'` — no `'critical'`. The color branch in InboxPanel never fires. Either remove it or confirm whether the backend might extend the enum.

---

## Next iteration — open questions for Julian

These are the threads to pull when this picks back up:

1. **First write action.** The cheapest visible win is "acknowledge inbox item" — one button, one POST to `/inbox/:id/acknowledge`, immediate state flip. The backend endpoint exists. Alternative: drag-to-transition on the Kanban (more impressive but much more work). Pick one.

2. **Fix the three silent bugs before adding features.** In order of blast radius:
   - KPI success rate 0% false alarm (3 lines to fix)
   - OrgChartPanel cycle guard (add a visited Set, 5 lines)
   - Inbox silent-empty fallback (add a per-panel error state or at least a "⚠ inbox data unavailable" path)

3. **Online status truth.** The current agent card "ONLINE" pulse is hardcoded green — always lit. The `activeAgents` array is too narrow (running-heartbeat only). Real options: (a) last-seen timestamp in the orch DB updated by each heartbeat completion; (b) dedicated `/health` or `/ping` poll per agent. Option (a) is one column added to `heartbeat_runs`, zero new endpoints.

4. **Drilldown shape.** A slide-over side panel from the right works well for issue detail (title, description, comments, transitions) without needing a router. A router becomes useful if you want linkable URLs to issues/goals — e.g., `muppets.remotelyhuman.com/issues/42`. Decide this before building the first write action, since it determines how the action buttons compose.

5. **Auth on muppets host.** Right now URL-is-password. The muppets host doesn't pass `KYBERBOT_API_TOKEN` requirement the way chat does. The existing `tokenAuth` middleware in the server is already written — it's one line to require it on the muppets host gate. Options: (a) same token-in-URL as chat; (b) NetBird-only (muppets not exposed externally); (c) leave as URL-secret until orch data becomes sensitive.

6. **Consolidate polling.** Six independent 30s fetches means the browser fires a burst of 6 requests roughly every 30s (timers drift into sync over time). A `/dashboard/full` aggregate endpoint that returns all panel data in one response would halve the network load and simplify the component tree. Worth it if you add a 7th or 8th endpoint; probably not worth refactoring today.

7. **Filter axis.** Per-agent issue filter on the Kanban is the highest-value filter (Kermit vs Rizzo view). Implementation: add `?assigned_to=kermit` to the `/issues` fetch when a filter chip is selected. Zero backend changes needed.

---

## Recent commit & branch context

- **Branch:** `fix/memory-decay-immortality-2026-05` (the dashboard work landed here alongside other in-flight changes — not yet merged to production)
- **Anchor commit:** `e0ff3a5 feat(web): muppets agent directory + orchestration panels`
- **Current uncommitted delta:** ~814-line expansion of `OrchPanels.tsx` (the 6-row build out from the initial agent-directory + KPI-only landing)

When picking back up: `cd /home/kermit/kyberbot && git status -- packages/web/` to see what's still uncommitted.

---

## Full API Capability Inventory

This section maps every HTTP endpoint the KyberBot server exposes, sourced from reading the actual route files on 2026-05-10. Endpoints are grouped by router. The "Dashboard fit" column classifies each for the muppets iteration roadmap: **Visual-only** (read, render), **Interactive** (write, trigger, mutate), or **Internal plumbing** (machine-to-machine, not user-facing).

### Base server — always mounted (single-agent and fleet)

| Method | Path | What it does | Current consumer | Dashboard fit |
|--------|------|-------------|-----------------|---------------|
| GET | `/health` | System health: uptime, services, channels, memory, PID. Public (no auth). | CLI `kyberbot status` | Visual-only |
| GET | `/ui/*` | Serves the React web UI static bundle. | Browser (per-agent chat UI) | Internal plumbing |

### Brain API — `/brain/*`

All routes are auth-gated (Bearer token).

| Method | Path | What it does | Current consumer | Dashboard fit |
|--------|------|-------------|-----------------|---------------|
| GET | `/brain/health` | Quick brain health ping | CLI health checks | Internal plumbing |
| GET | `/brain/entities` | Search entity graph. Query params: `q`, `type`, `limit` (max 500). | CLI `kyberbot recall` | Visual-only |
| GET | `/brain/entities/:nameOrId` | Full context for one entity (relationships, timeline, memory tier). | CLI `kyberbot recall <entity>` | Visual-only |
| GET | `/brain/entities-stats` | Aggregate entity graph stats (count by type, total edges, tiers). | CLI `kyberbot timeline --stats` | Visual-only |
| GET | `/brain/timeline` | Query temporal event index. Params: `start`, `end`, `type`, `q`, `limit`. | CLI `kyberbot timeline` | Visual-only |
| GET | `/brain/timeline-stats` | Timeline row counts, date range, channel breakdown. | CLI `kyberbot timeline --stats` | Visual-only |
| GET | `/brain/graph` | Entity graph for visualization. Params: `limit`, `entityId` (2-hop), `types`. Returns `{nodes, edges}`. | None (designed for p5.js canvas) | Visual-only |
| POST | `/brain/search` | Hybrid semantic + full-text search. Body: `{query, limit, tier, minPriority}`. | CLI `kyberbot search` | Visual-only |

### Chat / Execute — real-time streaming

| Method | Path | What it does | Current consumer | Dashboard fit |
|--------|------|-------------|-----------------|---------------|
| POST | `/api/web/chat` | SSE streaming chat with Claude subprocess. Body: `{prompt, sessionId}`. Emits events: `init`, `text`, `tool_start`, `tool_end`, `status`, `result`, `error`. | Per-agent web UI (`kermit.*`, `rizzo.*`) | Interactive |
| POST | `/api/execute` | NDJSON streaming arbitrary Claude execution. Body: `{prompt, config:{model,effort,maxTurns,sessionId}, env:{}}`. | KyberBot Desktop app | Internal plumbing |

### Web API — `/api/web/*`

Memory blocks, identity, sessions.

| Method | Path | What it does | Current consumer | Dashboard fit |
|--------|------|-------------|-----------------|---------------|
| GET | `/api/web/memory/:block` | Read SOUL.md, USER.md, or HEARTBEAT.md as text. | Web UI sidebar `MemoryBlocks` | Visual-only |
| PUT | `/api/web/memory/:block` | Write SOUL.md, USER.md, or HEARTBEAT.md. | Web UI `MemoryBlockModal` | Interactive |
| GET | `/api/web/identity` | Read identity.yaml as JSON. | Web UI `AgentConfig` sidebar | Visual-only |
| PUT | `/api/web/identity` | Deep-merge field updates into identity.yaml. Validates `heartbeat_interval` format. | Web UI `AgentConfig` | Interactive |
| GET | `/api/web/sessions` | List last 30 chat sessions for this agent. | Web UI `ConversationsModal` | Visual-only |
| POST | `/api/web/sessions` | Create a new chat session. Returns `{sessionId}`. | Web UI new-chat flow | Interactive |
| GET | `/api/web/sessions/:id/messages` | All messages for one session (role, content, toolCalls, usage, costUsd). | Web UI `RecentConversations` | Visual-only |
| POST | `/api/web/sessions/:id/messages` | Save a message to a session. | Web UI (auto-save on send) | Interactive |
| GET | `/api/web/status` | Agent name + uptime + timestamp. Simple liveness. | Web UI status indicator | Visual-only |

### Management API — `/api/web/manage/*`

Skills, agents, channels, heartbeat, logs, memory files. All auth-gated.

| Method | Path | What it does | Current consumer | Dashboard fit |
|--------|------|-------------|-----------------|---------------|
| GET | `/api/web/manage/skills` | List all installed skills with metadata. | Web UI (none wired yet) | Visual-only |
| GET | `/api/web/manage/skills/:name` | Get one skill's metadata. | None | Visual-only |
| GET | `/api/web/manage/skills/:name/content` | Read SKILL.md content + lastModified. | None | Visual-only |
| PUT | `/api/web/manage/skills/:name/content` | Write SKILL.md, triggers CLAUDE.md rebuild. | None | Interactive |
| POST | `/api/web/manage/skills` | Create a new skill (scaffold from template). Body: `{name, description, requiresEnv, hasSetup}`. | None | Interactive |
| DELETE | `/api/web/manage/skills/:name` | Remove a skill directory. | None | Interactive |
| POST | `/api/web/manage/skills/rebuild` | Rebuild CLAUDE.md from all installed skills. | None | Interactive |
| GET | `/api/web/manage/agents` | List all sub-agents (loaded from `.claude/agents/`). | None | Visual-only |
| GET | `/api/web/manage/agents/:name` | Get one agent's metadata. | None | Visual-only |
| GET | `/api/web/manage/agents/:name/content` | Read agent .md file content. | None | Visual-only |
| PUT | `/api/web/manage/agents/:name/content` | Write agent .md, triggers CLAUDE.md rebuild. | None | Interactive |
| POST | `/api/web/manage/agents` | Scaffold a new sub-agent. Body: `{name, description, role, model, maxTurns, allowedTools}`. | None | Interactive |
| DELETE | `/api/web/manage/agents/:name` | Remove a sub-agent, rebuild CLAUDE.md. | None | Interactive |
| POST | `/api/web/manage/agents/:name/spawn` | Spawn agent with SSE streaming. Body: `{prompt}`. Emits `init`, `text`, `tool_start`, `result`, `error`, `keepalive` events. | None | Interactive |
| GET | `/api/web/manage/channels` | List active channels (telegram, whatsapp) with connection status. | None | Visual-only |
| GET | `/api/web/manage/channels/config` | Read channel config block from identity.yaml. | None | Visual-only |
| POST | `/api/web/manage/channels/:type` | Configure a channel (telegram or whatsapp). Body: channel config object. | None | Interactive |
| DELETE | `/api/web/manage/channels/:type` | Remove channel config from identity.yaml. | None | Interactive |
| GET | `/api/web/manage/heartbeat` | Parsed HEARTBEAT.md tasks + last-run timestamps from `heartbeat-state.json`. | None | Visual-only |
| PUT | `/api/web/manage/heartbeat` | Write HEARTBEAT.md content. Body: `{content}`. | None | Interactive |
| GET | `/api/web/manage/heartbeat/log` | Tail heartbeat.log. Param: `lines` (max 500, default 50). | None | Visual-only |
| POST | `/api/web/manage/heartbeat/run` | Trigger immediate heartbeat tick via `kyberbot heartbeat run`. Returns stdout/stderr. | None | Interactive |
| GET | `/api/web/manage/tunnel` | Tunnel URL and running state (ngrok). | None | Visual-only |
| GET | `/api/web/manage/brain-notes` | List all .md files across brain/, claude-memory, and identity roots sorted by mtime. | None | Visual-only |
| POST | `/api/web/manage/brain-notes/read` | Read a brain note by absolute path. Body: `{path}`. | None | Visual-only |
| POST | `/api/web/manage/remember` | Store a memory via the running server (avoids subprocess OOM). Body: `{text, response, channel, metadata}`. | CLI `kyberbot remember` (when server is up) | Internal plumbing |
| GET | `/api/web/manage/logs/:service` | Tail a service log. Service: `heartbeat` or `desktop`. Param: `lines` (max 500). | None | Visual-only |
| GET | `/api/web/manage/watched-folders/status` | Sync status for configured watched folders. | None | Visual-only |

### Bus API — `/api/bus/*`

Inter-agent message routing. Auth-gated.

| Method | Path | What it does | Current consumer | Dashboard fit |
|--------|------|-------------|-----------------|---------------|
| POST | `/api/bus/receive` | Receive a bus message from another agent or fleet. Body: `{message:{from, payload, type, topic}}`. Triggers Claude to handle it; stores in memory. | Fleet bus send path (`kyberbot bus send`) | Internal plumbing |
| POST | `/api/bus/register-fleet` | Fleet server registers its URL with this standalone agent. Body: `{fleetUrl, fleetToken}`. | Fleet startup handshake | Internal plumbing |
| GET | `/api/bus/fleet-connection` | Check if a fleet URL is registered with this agent. | None | Internal plumbing |

### ARP API — `/api/arp/*`

Typed agent-to-agent endpoints. Auth-gated.

| Method | Path | What it does | Current consumer | Dashboard fit |
|--------|------|-------------|-----------------|---------------|
| GET | `/api/arp/health` | Lists available ARP endpoints. | Cloud-bridge capability probe | Internal plumbing |
| POST | `/api/arp/notes.search` | Semantic search over brain notes with project/tag/classification filtering. | Cloud-bridge ARP dispatcher | Internal plumbing |
| POST | `/api/arp/notes.read` | Read a specific brain note by ID or path with obligations applied. | Cloud-bridge ARP dispatcher | Internal plumbing |
| POST | `/api/arp/knowledge.query` | Answer a knowledge query from the brain (semantic + entity graph). | Cloud-bridge ARP dispatcher | Internal plumbing |

### Fleet Manager — `/health`, `/fleet/*`, `/fleet/orch/*`, `/api/v1/*`

Fleet-mode only (when `kyberbot fleet start` is running). No auth on health; all others use fleet auth.

| Method | Path | What it does | Current consumer | Dashboard fit |
|--------|------|-------------|-----------------|---------------|
| GET | `/health` | Fleet-wide health: all agent statuses, sleep scheduler, memory. | CLI `kyberbot fleet status` | Visual-only |
| GET | `/fleet` | Rich fleet status: agent uptime, services per agent, channel status, tunnel, sleep. | CLI `kyberbot fleet status` | Visual-only |
| POST | `/fleet/agents` | Register a new agent into the running fleet. Body: `{name, root}`. | CLI `kyberbot fleet register` | Interactive |
| DELETE | `/fleet/agents/:name` | Remove an agent from the running fleet. | CLI `kyberbot fleet stop <name>` | Interactive |
| POST | `/fleet/bus/send` | Send a message from one agent to another via the in-process bus. Body: `{from, to, message, topic}`. | CLI `kyberbot bus send` | Internal plumbing |
| POST | `/fleet/bus/broadcast` | Broadcast a message to all agents. Body: `{from, message, topic}`. | CLI `kyberbot bus broadcast` | Internal plumbing |
| GET | `/fleet/bus/history` | Recent inter-agent bus messages. Params: `limit`, `agent`. | CLI `kyberbot bus history` | Visual-only |
| GET | `/fleet/orch/dashboard` | Aggregate orch snapshot: company, projects, org, goals, issues counts, inbox pending, activity, activeAgents. | **Muppets dashboard** | Visual-only |
| GET | `/fleet/orch/agents` | List fleet agents with name, description, and first 2000 chars of SOUL.md. | Desktop app | Visual-only |
| GET | `/fleet/orch/company` | Company name and settings. | Desktop app | Visual-only |
| PUT | `/fleet/orch/company` | Update company settings. | Desktop app | Interactive |
| GET | `/fleet/orch/projects` | List projects. Param: `status` filter. | **Muppets dashboard** (via `/dashboard`) | Visual-only |
| POST | `/fleet/orch/projects` | Create a project. Body: `{name, description}`. | None | Interactive |
| GET | `/fleet/orch/projects/:id` | Get one project. | None | Visual-only |
| PUT | `/fleet/orch/projects/:id` | Update a project. | None | Interactive |
| DELETE | `/fleet/orch/projects/:id` | Delete a project. | None | Interactive |
| GET | `/fleet/orch/org` | Full org chart (all nodes + CEO pointer). | **Muppets dashboard** (via `/dashboard`) | Visual-only |
| GET | `/fleet/orch/org/:agent` | One org node + direct reports. | Desktop app | Visual-only |
| PUT | `/fleet/orch/org/:agent` | Set/update an org node. Body: `{role, title, reports_to, is_ceo, department}`. | CLI `kyberbot orch init` | Interactive |
| DELETE | `/fleet/orch/org/:agent` | Remove agent from org chart. | CLI | Interactive |
| GET | `/fleet/orch/goals` | List goals. Params: `level`, `owner_agent`, `status`, `parent_goal_id`. | **Muppets dashboard** (via `/dashboard`) | Visual-only |
| POST | `/fleet/orch/goals` | Create a goal. Body: `{title, description, level, owner_agent, parent_goal_id, due_date}`. | Desktop app | Interactive |
| GET | `/fleet/orch/goals/:id` | Get one goal + KPIs + child goals. | Desktop app | Visual-only |
| PUT | `/fleet/orch/goals/:id` | Update a goal (title, status, due_date, etc.). | Desktop app | Interactive |
| DELETE | `/fleet/orch/goals/:id` | Delete a goal. | None | Interactive |
| GET | `/fleet/orch/goals/:id/kpis` | List KPIs for a goal. | **Muppets dashboard** (KPI_TRACKER panel) | Visual-only |
| PUT | `/fleet/orch/goals/:id/kpis` | Upsert a KPI. Body: `{name, target_value, current_value, unit}`. | Desktop app | Interactive |
| GET | `/fleet/orch/issues` | List issues. Params: `assigned_to`, `status` (comma-separated), `goal_id`, `priority`, `limit`. | **Muppets dashboard** (Kanban) | Visual-only |
| POST | `/fleet/orch/issues` | Create an issue. Body: `{title, description, goal_id, assigned_to, created_by, status, priority, labels, due_date}`. | Desktop app | Interactive |
| GET | `/fleet/orch/issues/:id` | Get one issue + comments. | Desktop app | Visual-only |
| PUT | `/fleet/orch/issues/:id` | Update an issue (any fields). | Desktop app | Interactive |
| DELETE | `/fleet/orch/issues/:id` | Hard-delete an issue. Orphans children. | None | Interactive |
| POST | `/fleet/orch/issues/:id/transition` | Move issue to a new status. Body: `{status, actor}`. Triggers assigned agent heartbeat on `todo`/`in_progress`. | Desktop app | Interactive |
| POST | `/fleet/orch/issues/:id/checkout` | Lock issue to an agent (prevents double-pickup). Body: `{agent}`. | Agent orchestration loop | Internal plumbing |
| POST | `/fleet/orch/issues/:id/release` | Release agent checkout lock. | Agent orchestration loop | Internal plumbing |
| GET | `/fleet/orch/issues/:id/comments` | Get all comments on an issue. | Desktop app | Visual-only |
| POST | `/fleet/orch/issues/:id/comments` | Add a comment. Body: `{author, content}`. `@mention` in content triggers named agent's heartbeat. | Desktop app | Interactive |
| GET | `/fleet/orch/inbox` | List inbox items. Params: `status`, `urgency`, `kind`, `countOnly`, `includeArtifacts`. | **Muppets dashboard** (Inbox panel) | Visual-only |
| POST | `/fleet/orch/inbox` | Create inbox item. Body: `{source_agent, title, body, urgency, kind, related_issue_id}`. | Agent orchestration loop | Internal plumbing |
| GET | `/fleet/orch/inbox/:id` | Get one inbox item (auto-acknowledges if pending). Param: `includeArtifacts`. | Desktop app | Visual-only |
| POST | `/fleet/orch/inbox/:id/acknowledge` | Mark inbox item acknowledged. | Desktop app | Interactive |
| POST | `/fleet/orch/inbox/:id/resolve` | Resolve an inbox item. Body: `{resolved_by}`. | Desktop app | Interactive |
| GET | `/fleet/orch/activity` | Activity log. Params: `actor`, `entity_type`, `entity_id`, `limit`, `after`. | **Muppets dashboard** (Activity panel) | Visual-only |
| GET | `/fleet/orch/artifacts` | List artifacts. Params: `agent_name`, `issue_id`, `limit`. | **Muppets dashboard** (Artifacts panel) | Visual-only |
| GET | `/fleet/orch/artifacts/:id` | Get one artifact's metadata. | Desktop app | Visual-only |
| GET | `/fleet/orch/artifacts/:id/content` | Read artifact file content from disk. | Desktop app | Visual-only |
| POST | `/fleet/orch/artifacts` | Register an artifact (file + agent + optional issue link). | Agent orchestration loop | Internal plumbing |
| GET | `/fleet/orch/runs` | List heartbeat runs. Params: `agent_name`, `type`, `limit`. | **Muppets dashboard** (Heartbeat Runs panel) | Visual-only |
| GET | `/fleet/orch/runs/:id` | Get one run record. | Desktop app | Visual-only |
| GET | `/fleet/orch/runs/:id/log` | Stream run log with byte offset support for live tailing. Params: `offset`. | Desktop app | Visual-only |
| POST | `/fleet/orch/heartbeat/:agent` | Trigger immediate heartbeat for one agent (CEO or worker path). | Desktop app | Interactive |
| GET | `/fleet/orch/settings` | Get orchestration settings (ceo_model, etc.). | Desktop app | Visual-only |
| PUT | `/fleet/orch/settings` | Update orchestration settings. | Desktop app | Interactive |
| GET | `/api/v1/state` | Symphony-style fleet-wide snapshot: all agent statuses, running/recent runs, reconcile tick info. | Desktop app / monitoring | Visual-only |
| GET | `/api/v1/agents/:name` | Agent-scoped detail: status, recent failures, phase history, current run. | Desktop app | Visual-only |
| POST | `/api/v1/refresh` | Queue an immediate reconcile tick. Coalesces within 5s window. | Desktop app | Interactive |

### Per-agent namespaced routes (fleet mode only)

In fleet mode each agent's full route tree is also mounted at `/agent/<name>/*` — all brain/chat/manage/bus/arp routes above apply under that prefix. Example: `/agent/kermit/brain/entities`.

---

## Proposed Interactive Features — Next Iteration

The dashboard today is a clean read-only control surface. The backend already supports the write half of everything visible. The following is a prioritized build plan for making the dashboard genuinely interactive, sequenced from lowest risk to most complex.

### Tier 1 — Quick wins, minimal risk (1-3 hours each)

These require a single POST from the UI with no complex state management.

**1. Acknowledge / resolve inbox items**

Each inbox card gets two small action buttons: "ACK" and "RESOLVE." `POST /fleet/orch/inbox/:id/acknowledge` and `/fleet/orch/inbox/:id/resolve` are already wired. On success, optimistically remove the item from the pending list and decrement the KPI tile count. This is the highest-value first write action — it closes the feedback loop Julian currently has to do via Telegram or CLI.

**2. Trigger agent heartbeat from the dashboard**

Add a "run now" button to each agent card (or a dedicated HEARTBEAT_RUNS panel action). `POST /fleet/orch/heartbeat/:agent`. Useful when waiting for a scheduled heartbeat to fire is inconvenient. Show the resulting run ID in a toast so you can track it in the runs panel.

**3. Issue status transition**

Each Kanban card gets a context menu or inline drag-to-column interaction. Start with a simple "Move to" dropdown on hover (backlog → todo → in_progress → blocked → done). `POST /fleet/orch/issues/:id/transition` with `{status, actor: 'human'}`. The backend already triggers the assigned agent's heartbeat automatically when transitioning to `todo` or `in_progress` — so this one button does two things.

**4. Fix the three silent bugs (pre-condition for write actions)**

Before shipping any write actions, fix these three first to avoid user confusion:
- KPI success rate 0% false alarm (renders RED when no runs in 24h)
- OrgChartPanel cycle guard (add `visited: Set<string>` to `renderNode()`)
- Inbox silent-empty on secondary fetch failure (add a per-panel error indicator)

### Tier 2 — Create flows (half-day each)

These require a form/modal.

**5. Create issue**

A "+ NEW ISSUE" button opens a slide-over with fields: title (required), description, assigned_to (dropdown from org chart agents), priority (radio), goal_id (dropdown from active goals). `POST /fleet/orch/issues`. This completes the loop: agents surface work via inbox, human creates structured issues to route it back.

**6. Add comment on issue**

Issue cards expand (or a slide-over opens) showing description and existing comments. A text input at the bottom posts to `POST /fleet/orch/issues/:id/comments`. The `@mention` feature is live in the backend — typing `@kermit` in a comment triggers Kermit's heartbeat automatically, no extra wiring needed.

**7. Update KPI current value**

The KPI_TRACKER panel gets an inline edit on `current_value`. Click the value, type a new number, press Enter — `PUT /fleet/orch/goals/:id/kpis` with `{name, current_value}`. This lets Julian update progress without going through CLI or chat.

**8. Create goal**

A "+ NEW GOAL" button alongside the CAMPAIGN panel. Fields: title, level (company/team/agent), owner_agent (dropdown), due_date. `POST /fleet/orch/goals`. Minimal form, high leverage.

### Tier 3 — Drilldown and navigation (full-day)

These require a navigation model decision (slide-over vs router).

**9. Issue drilldown slide-over**

Click any Kanban card to open a right-side panel with: full title, description, status badge, priority dot, assigned agent, goal link, and comment thread. Action buttons: transition, add comment, link to goal. This changes the Kanban from a status wall to an actual work surface. Recommend a slide-over (no URL change, no router needed) for the first iteration.

**10. Goal drilldown with KPI editing**

Click any goal in the CAMPAIGN panel to open a slide-over: title, level, status, due date, KPI list with inline `current_value` edits, and child goals list. Requires fetching `GET /fleet/orch/goals/:id` which returns goal + kpis + children in one call.

**11. Agent card live status**

Replace the hardcoded "ONLINE" pulse with real data. Two options:
- Option A (zero backend changes): use the `activeAgents` array from `/dashboard` to show "EXECUTING" vs "IDLE" state. 
- Option B (add one column): add a `last_heartbeat_completed_at` timestamp to the orch DB, update it on every run completion, expose it via `/dashboard`. Lets the card show "last beat: 3m ago."

Option A is a morning's work; Option B is a better long-term truth signal and worth the DB migration.

**12. Run log live streaming**

The `GET /fleet/orch/runs/:id/log` endpoint supports byte-offset polling for live tailing. The HeartbeatRuns panel currently shows status but not log content. Clicking a running run opens a live-tailing panel (poll with `?offset=N`, append new bytes, stop when run finishes). The backend already handles this correctly — this is purely a frontend build.

### Tier 4 — Management surface (multi-day)

These expose the management API, which currently has zero UI.

**13. Heartbeat task editor**

The `/api/web/manage/heartbeat` endpoints expose HEARTBEAT.md as structured tasks. A simple UI: list of parsed tasks (name, schedule, skill, window), an edit button that opens the raw HEARTBEAT.md in a text editor (like MemoryBlockModal on the per-agent UI), plus a "Run now" button that fires `POST /api/web/manage/heartbeat/run`. Auth required (unlike the muppets orch panels).

**14. Skill and sub-agent browser**

A management tab showing installed skills (from `/api/web/manage/skills`) and sub-agents (from `/api/web/manage/agents`). Click a skill to read its SKILL.md, edit it, save. This is the equivalent of the MemoryBlockModal pattern already shipping in the per-agent UI — same pattern, different data source.

**15. Entity graph visualization**

`GET /brain/graph` returns `{nodes, edges}` ready for a force-directed layout. A dedicated "KNOWLEDGE GRAPH" panel on the muppets page (or a full-screen modal) using D3 or a lightweight canvas renderer (p5.js is already mentioned in the brain-api comments). Nodes colored by type, sized by `mention_count`, edges labeled by `relationship`. Click a node to fetch `GET /brain/entities/:nameOrId` for the full context slide-over. This is the most visually distinctive feature gap vs other agent UIs.

### Authentication note for write actions

The orch panels currently have no auth (URL-as-secret). All write actions via `/fleet/orch/*` go through the same unauthenticated surface. Before shipping Tier 1 write actions, decide:
- Keep URL-as-secret (acceptable if muppets stays internal + NetBird-only)
- Add a simple PIN / token-in-URL scheme (one line at the fleet auth middleware level)
- Gate behind NetBird entirely (no external exposure, no auth needed)

The existing `authMiddleware` in `packages/cli/src/middleware/auth.js` is already written — applying it to the `/fleet/orch` router is a one-line change if a token approach is chosen.
