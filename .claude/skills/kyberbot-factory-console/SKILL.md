---
name: kyberbot-factory-console
description: Operator console for the kyberbot factory — create, manage, and advance jobs through the pipeline.
---

# kyberbot-factory-console

Operator console for the kyberbot factory. Surfaces the attention queue, handles job creation, and moves jobs through the pipeline using the universal operator action pattern.

## Input

- "kyberbot factory console"
- "what jobs need my attention"
- "create a new factory job"

## Procedure

### 1. Attention queue

Scan `kyberbot-factory/jobs/` for jobs in operator-owned states:

| State | Meaning |
|-------|---------|
| `draft-input` | Draft gate flagged missing detail — operator must fill in PURPOSE / REQUIREMENTS / type before pipeline can start |
| `research-input` | Research agent has questions |
| `plan-input` | Planning agent has questions |

Newly-filed jobs (state `drafted`) are not in the attention queue — they are picked up by the dispatcher and routed by the `draft-gate` agent. If the gate finds the job sufficient, it advances straight to `research`; if not, the job lands in `draft-input` for operator clarification.

Present via AskUserQuestion:

1. **Create new job** — always the first option, always shown.
2. **Attention items** — jobs in operator-owned states. Label format: `[{STATE}] {id}  {title}` (e.g., `[PLAN-INPUT] KF-002  Add WebSocket support`).

If no items require attention, show only "Create new job" and "Exit".

The operator selects an item (entering the action pattern) or creates a new job.

### 2. Operator action pattern

When the operator selects a job, read the delamain transitions where `from` = current state. Group by class and present via AskUserQuestion:

| Action | Description | When shown |
|--------|-------------|------------|
| **Review** | Read the job file and display it inline | Always |
| **Respond** | Do the state-specific work, then choose a transition | If any advance or rework transitions exist |
| **Shelve** | Shelve the job | Always |
| **Cancel** | Cancel the job | Always |
| **Exit** | Return to attention queue | Always |

If a state has no advance or rework transitions, omit the Respond action.

#### Review

Read the full job file with the Read tool and display its content for the operator. After display, return to the action menu for this job.

#### Respond

Respond is a two-phase action: do the work, then choose direction.

##### Phase 1 — Do the work

What "do the work" means depends on the state:

| State | Phase 1 |
|-------|---------|
| `draft-input` | Read the latest `draft-gate:` ACTIVITY_LOG entry to see which sufficiency checks failed. Walk the operator through filling in the missing pieces (PURPOSE, REQUIREMENTS, type) directly in the job file. Then advance back through `drafted` so the gate re-evaluates. |
| `research-input` | Answer research agent questions (read RESEARCH_QUESTIONS, present to operator, collect answers, append) |
| `plan-input` | Answer planner agent questions (read PLAN_QUESTIONS, present to operator, collect answers, append) |

Phase 1 is guided, not delegated. Walk the operator through each step — present one question at a time, collect the response, run verification where possible, then move to the next. The agent is an active partner, not a questionnaire.

##### Phase 2 — Choose direction

After the work is done, read the delamain transitions from the current state and present the legal options:

| Transition class | Presented as |
|------------------|-------------|
| **advance** | Advance to {state} — one option per target |
| **rework** | Rework to {state} — one option per target |

If a class has multiple targets, show one option per target. If a class has zero targets, omit it.

#### After every transition

1. Update `updated` to today's date
2. Append to `## ACTIVITY_LOG` with transition context
3. Update delamain state as the last edit. Always.
4. Run:
   ```bash
   git add -A && git commit -m "kyberbot-factory: {id} {from-state} → {to-state}"
   ```

After the commit, return to step 1 (re-scan the attention queue).

### 3. Creating a job

Collect from the operator:
- **title**: what is this job called
- **description**: one-line summary
- **type**: `feature`, `enhancement`, `defect`, `hotfix`, `security`, or `chore`
- **requirements**: what it must do, constraints, acceptance criteria — must be clear enough for agents to research and plan against
- **tags**: optional list

Set defaults:
- `id`: scan `kyberbot-factory/jobs/` for existing files, determine the next highest integer, format as `KF-{NNN}`
- `status`: `drafted`
- `created`: today
- `updated`: today

Create the job file at `kyberbot-factory/jobs/{id}.md` using the job entity shape. Append to ACTIVITY_LOG: `- {today}: Created.`

Run:
```bash
git add -A && git commit -m "kyberbot-factory: {id} created"
```

Then return to step 1 (attention queue). The dispatcher will pick the new job up automatically — `draft-gate` runs first and either advances the job to `research` (if PURPOSE / REQUIREMENTS / type all check out) or routes it to `draft-input` for operator follow-up.

## Scope

- **Manages**: job entity — create, transition, and close operations via the attention queue and action pattern.
- **Does not manage**: read-only queries (use `kyberbot-factory-inspect`).
