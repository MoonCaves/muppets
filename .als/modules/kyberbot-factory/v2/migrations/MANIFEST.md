---
manifest_id: MUT-kyberbot-factory-v1-to-v2-20260506-001
module_id: kyberbot-factory
module_path: kyberbot-factory/jobs
skill_paths:
  - .als/modules/kyberbot-factory/v2/skills/kyberbot-factory-console
  - .als/modules/kyberbot-factory/v2/skills/kyberbot-factory-inspect
primary_migration_script: .als/modules/kyberbot-factory/v2/migrations/migrate_from_v1.py
from_version: 1
to_version: 2
change_class: schema_and_logic
data_migration_required: true
status: staged
created_on: 2026-05-06
updated_on: 2026-05-06
---

## Intent

Insert an automated testing layer between code review and `done` so that no job ships without a verified test pass. The testing agent is OpenAI Codex (gpt-5.5) — distinct from the Anthropic-driven research / planning / dev / review agents — and authors missing tests for REQUIREMENTS-implied behavior before running the suite.

## Wants

- New delamain state `testing`, agent-actor, OpenAI provider (gpt-5.5), resumable, sits after `in-review` and before `done` in the implementation phase.
- New delamain state `test-input`, operator-actor, gates ambiguous or failing test runs back to operator triage.
- New entity body section `TESTS` (between `REVIEW` and `DEPLOYMENT`) holds dated test runs, suites authored, command output summaries, pass/fail counts, and failure narratives.
- New testing agent `agents/testing.md` reading REQUIREMENTS / RESEARCH / PLAN / ARCHITECTURE, authoring missing tests in the project's existing framework, running the suite, gating on results.
- Console skill picks up `test-input` in its attention queue and Phase 1 work table.
- All existing live records (KF-001, KF-002, KF-003) gain an empty `## TESTS\n\nnull\n` block so they remain valid against the v2 shape.

## Does Not Want

- No change to `drafted` / `draft-input` / `research` / `research-gate` / `research-input` / `planning` / `planning-gate` / `plan-input` / `dev` flow.
- No change to entity frontmatter shape other than the auto-injected `testing_session` field that follows from declaring `session-field: testing_session` on the new state.
- No change to existing ACTIVITY_LOG content, identity contract (`KF-{NNN}`), tag list, or type enum.
- No change to skill ids — `kyberbot-factory-console` and `kyberbot-factory-inspect` remain the active set.
- No change to the dispatcher template, dispatcher VERSION, or runtime-manifest.config.json.

## Invariants

- Identity contract `KF-{NNN}` remains stable.
- Type enum `feature | enhancement | defect | hotfix | security | chore` is unchanged.
- The two terminal exit states `shelved` and `cancelled` remain reachable from every non-terminal state, including the two new states.
- `done` remains the only terminal pass-state.
- Active skills set in `.als/system.ts` remains `[kyberbot-factory-console, kyberbot-factory-inspect]`.
- Existing PURPOSE / REQUIREMENTS / RESEARCH / PLAN / REVIEW / DEPLOYMENT / REFERENCES / ACTIVITY_LOG sections retain their order and contracts.

## Contra-Invariants

- "PASS at `in-review` closes the job" no longer holds — `in-review` PASS now advances to `testing`, and only `testing` PASS or `test-input` operator override reaches `done`.
- The implementation phase now contains three states (`dev`, `in-review`, `testing`) instead of two.
- The `in-review.md` agent prompt's PASS branch no longer writes `status: done` — it writes `status: testing`.
- Existing live records that lack a `## TESTS` body region were valid against v1 and are no longer valid against v2 without the migration.

## Migration Constraints

- Live record migration must be deterministic and idempotent — running the script twice on the same record produces the same result.
- Migration must fail closed if `## REVIEW` or `## DEPLOYMENT` cannot both be located in a record (the TESTS block is inserted between them).
- Migration must not modify any frontmatter fields, ACTIVITY_LOG entries, or non-target body sections.
- Migration must not run against a non-ALS root or against a system whose active version has already been advanced past v1.
- Cutover must not strand in-flight jobs — at cutover time, KF-001 is `done` (terminal, unaffected), KF-002 is `research-gate` (no in-review/testing involvement yet), KF-003 is `planning-gate` (same). The schema migration is purely additive for these records.

## Current Module Understanding

- Active version v1 declares one entity (`job`), one delamain (`kyberbot-factory-jobs`), and two skills.
- Delamain v1 has 13 states across three phases (`research`, `implementation`, `closed`); the implementation phase has two states (`dev`, `in-review`).
- Entity v1 body has 12 sections: `PURPOSE`, `CURRENT_STATE`, `REQUIREMENTS`, `RESEARCH`, `RESEARCH_QUESTIONS`, `PLAN`, `PLAN_QUESTIONS`, `ARCHITECTURE`, `REVIEW`, `DEPLOYMENT`, `REFERENCES`, `ACTIVITY_LOG`. Only `PURPOSE` and `ACTIVITY_LOG` are non-nullable.
- Live records: KF-001 (`done`), KF-002 (`research-gate`), KF-003 (`planning-gate`). All three have the v1 12-section shape with literal `null` in nullable sections that have no content.
- No external module references; cross-module compatibility is not a concern.
- No prior migrations directory exists — v1 is the first version.

## Schema Changes

- Add body section `TESTS` between `REVIEW` and `DEPLOYMENT`. `allow_null: true`. Block set: paragraph, bullet_list, ordered_list, gfm table, heading depth 3-4, code with required language, blockquote.
- Auto-injected frontmatter field `testing_session` (id, allow_null: true) follows from declaring `session-field: testing_session` on the new `testing` state.
- No other entity field changes; no path-template, identity, or enum changes.

## Behavior Changes

- Delamain gains states `testing` (agent, openai, resumable, session-field `testing_session`, path `agents/testing.md`) and `test-input` (operator).
- Delamain transition `exit: in-review → done` is replaced by `advance: in-review → testing`.
- New transitions: `advance: testing → test-input`, `exit: testing → done`, `rework: test-input → dev`, `exit: test-input → done`.
- Global `shelved` and `cancelled` exit fan-ins extend to include `testing` and `test-input`.
- New agent `agents/testing.md` (gpt-5.5) authors missing tests, runs the suite, writes TESTS section, routes to `done` or `test-input`.
- `agents/in-review.md` PASS branch now advances to `testing` instead of `done`; FAIL branch is unchanged. The agent no longer runs the test suite (that's the testing agent's job) — it does reading-level review only.
- `kyberbot-factory-console/SKILL.md` attention queue gains `test-input`; Phase 1 work table gains a `test-input` row describing operator triage (rework → dev or advance → done).
- `kyberbot-factory-inspect/SKILL.md` is unchanged; its phase summary example renders state counts dynamically and does not need editing.

## Data Migration Plan

- For every record under `kyberbot-factory/jobs/*.md`:
  - Locate the `## REVIEW` heading and the next `## DEPLOYMENT` heading.
  - If `## TESTS` already exists between them, leave the record unchanged (idempotency).
  - Otherwise, insert a literal block between the two headings:
    ```
    ## TESTS

    null
    ```
  - Preserve trailing newlines and surrounding blank lines as-is.
- The `testing_session` frontmatter field is nullable; the migration must add `testing_session: null` to the frontmatter immediately after the existing `dev_session: null` line on every record.
- The migration does not modify ACTIVITY_LOG, frontmatter status, or any other section content.
- Records that cannot be located, parsed, or that fail the locate-REVIEW + locate-DEPLOYMENT precondition cause the script to fail closed with a non-zero exit and a clear error.

## Behavior Test Plan

- After cutover, `alsc validate` against the live system passes with `error_count: 0` and `warning_count: 0` for the `kyberbot-factory` module.
- After cutover, `alsc deploy claude` projects two skills and one delamain, with the delamain target carrying the `testing` and `test-input` states and the new `agents/testing.md` agent.
- A new job filed via `kyberbot-factory-console` after cutover progresses past `in-review` into `testing`, then either `done` (suite passes) or `test-input` (suite fails / ambiguity).
- The console attention queue surfaces `test-input` jobs alongside `draft-input` / `research-input` / `plan-input`.
- KF-001 (already `done`) remains `done` after migration, with a `## TESTS` block containing literal `null` and a `testing_session: null` frontmatter line.
- KF-002 and KF-003 retain their pre-migration statuses; their next dispatcher tick produces no anomalies traceable to the schema change.

## Cutover Gates

- All three live records have been migrated and pass `alsc validate` against v2.
- Active dispatcher has been drained (active_dispatches: 0) before flipping `.als/system.ts` `version: 1 → 2` so no in-flight session collides with the schema change.
- `.claude/delamains/kyberbot-factory-jobs/` has been redeployed via `alsc deploy claude` so the dispatcher reads the new agent set and transition graph.
- The OpenAI provider (codex-sdk) is reachable from the dispatcher's environment with valid credentials before the first `testing` dispatch fires.
- Operator has reviewed the prepared bundle and the active job statuses (KF-001 done, KF-002 research-gate, KF-003 planning-gate) are confirmed not stranded by the cutover.

## Risks

- The OpenAI codex-sdk dispatcher path has been used elsewhere in this plugin (per the changelog ALS-073's gpt-5.5 pricing fix at dispatcher VERSION 13) but has not yet been exercised inside this kyberbot-factory module — first `testing` dispatch is also the first OpenAI call in this module's history. Spend caps in the dispatcher's `runtime-manifest.config.json` ($30 Anthropic / $100 OpenAI per dispatch) must accommodate test-authoring runs that may iterate.
- The testing agent's "author missing tests" scope is broad. Without a tight test-authoring contract per project, the agent could fabricate tests that pass for the wrong reason. Mitigation lives in the agent prompt's quality bar; surfaces as a real risk only after the first non-trivial run.
- Existing in-review prompts in flight at cutover would still try to write `status: done`. KF-001 is the only record that has run through in-review and is already terminal — no in-flight risk in this specific repo state.
- The TESTS section block contract intentionally mirrors REVIEW; if the testing agent's freeform writing strays outside the block whitelist (paragraph / lists / table / heading 3-4 / code / blockquote), validation will fail at write time and the block must be rewritten — same constraint as REVIEW today.

## Sign-off

Operator approved the bundle effects after a four-question intent interview plus a one-question ambiguity flag (resumability), 2026-05-06. Approved option A on the resumability flag — testing is `resumable: true` with auto-injected `testing_session` frontmatter field. No `TEST_QUESTIONS` section. Bundle is staged for `/migrate` to perform the live cutover.
