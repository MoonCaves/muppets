---
report_id: MREP-kyberbot-factory-v1-to-v2-20260506-001
manifest_id: MUT-kyberbot-factory-v1-to-v2-20260506-001
module_id: kyberbot-factory
module_path: kyberbot-factory/jobs
from_version: 1
to_version: 2
primary_migration_script: .als/modules/kyberbot-factory/v2/migrations/migrate_from_v1.py
clone_result: passed
live_result: passed
created_on: 2026-05-06
updated_on: 2026-05-06
---

## Intent Snapshot

Cut over `kyberbot-factory` from v1 to v2. v2 inserts a new `testing` agent state (OpenAI Codex / gpt-5.5) between `in-review` and `done`, plus a paired `test-input` operator gate, a new optional `TESTS` body section, and an auto-injected `testing_session` frontmatter field. Live records (KF-001, KF-002, KF-003 — all currently `done` after the dispatcher worked through them in the background during the change-skill phase) require a purely additive schema migration to add the new section and frontmatter field.

## Preflight

- Live system root `/Users/ianborders/kyberbot` validated clean against `alsc validate`: `status: pass`, 0 errors, 0 warnings.
- Manifest contract verified: required frontmatter present, `status: staged`, `from_version: 1` matches live, `to_version: 2 = from_version + 1`, `skill_paths` resolve to `.als/modules/kyberbot-factory/v2/skills/kyberbot-factory-{console,inspect}` (both directories exist), `primary_migration_script` resolves to `.als/modules/kyberbot-factory/v2/migrations/migrate_from_v1.py` (file exists, executable), all 14 required H2 sections present in declared order.
- Git tree clean over the target system root (one transient runtime-state file `.claude/delamains/kyberbot-factory-jobs/runtime/worktree-state.json` left as working-tree dirt — not blocking, will be added to gitignore in a follow-up cleanup).
- Dispatcher state: `active_dispatches: 0`, `blocked_dispatches: 0`, `mode: running` — no in-flight jobs to strand.

## Clone Dry Run

- Clone path: `/tmp/als-migrate-kyberbot-kyberbot-factory-v1-to-v2-<timestamp>` (recreated three times during script-fix iterations; final passing clone is the third).
- Migration script ran on clone: `3/3 record(s) migrated` (KF-001, KF-002, KF-003), all idempotent on second run (re-runs print `unchanged (already v2)`).
- Two mechanical fixes were applied to the staged bundle during dry-run iterations and committed in `a07c64e`:
  1. `migrate_from_v1.py`: anchor regex for the `testing_session` insertion was looking for the literal string `dev_session: null`, but live records have real session UUIDs in that field. Switched to a regex anchor matching `dev_session: <anything>`.
  2. `migrate_from_v1.py`: `split_frontmatter` was double-adding a newline after the opening `---` fence, producing an invalid blank-line-then-fields YAML body. Fixed.
  3. `agents/testing.md`: OpenAI Codex agents reject the Anthropic-style `tools:` field and require `sandbox-mode` and `approval-policy` in frontmatter. Replaced `tools:` with the canonical codex-sdk frontmatter set (`sandbox-mode: workspace-write`, `approval-policy: on-request`, `approvals-reviewer: auto_review`, `reasoning-effort: medium`).
- After flipping the clone's `.als/system.ts` to `version: 2`, `alsc validate` against the clone returned `status: pass`, 0 errors, 0 warnings across the full system.
- `alsc deploy claude` against the clone wrote 2 skills (`kyberbot-factory-console`, `kyberbot-factory-inspect`) and 1 delamain (`kyberbot-factory-jobs`), with one non-fatal warning that the clone's projected dispatcher had no pre-existing `node_modules` to preserve (expected — clone is fresh).
- Failed clones from intermediate iterations were deleted on each retry per the migrate skill's "discard the failed attempt" rule. The final passing clone will be deleted at the end of Phase 3.

## Behavior Checks

- **Schema validation post-migration (clone):** `alsc validate` exits clean — confirms the v2 module shape (`TESTS` section + auto-injected `testing_session` field) matches the migrated record bodies.
- **Idempotency (clone):** running the migration script a second time produces `unchanged (already v2)` for every record — no double-insertion.
- **Projection (clone):** new agent file `.claude/delamains/kyberbot-factory-jobs/agents/testing.md` lands with the codex frontmatter intact.
- **Record state preservation (clone):** all three records retain pre-migration `status: done`. Frontmatter `id`, `title`, `description`, `type`, `created`, `updated`, `tags`, `research_session`, `planner_session`, `dev_session` values are byte-identical to v1 except for the inserted `testing_session: null` line. `## TESTS\n\nnull` block sits between `## REVIEW` and `## DEPLOYMENT`. ACTIVITY_LOG bodies untouched.
- Pipeline-level smoke (a fresh job traversing `dev → in-review → testing → done`) is intentionally deferred to post-cutover — the dry run cannot exercise the live dispatcher's pickup, and no test job exists in the clone.
- Console attention-queue surfacing of `test-input` is also deferred to post-cutover (no `test-input` records exist in the clone).

## Live Cutover

- Re-confirmed dispatcher idle (`active_dispatches: 0`, `blocked_dispatches: 0`) immediately before mutation.
- Ran `migrate_from_v1.py /Users/ianborders/kyberbot` against the live system — 3/3 records migrated (KF-001, KF-002, KF-003).
- Flipped `.als/system.ts`: `kyberbot-factory.version: 1 → 2`. Active `skills:` list unchanged.
- `alsc validate` against the live post-flip system: `status: pass`, 0 errors, 0 warnings.
- `alsc deploy claude /Users/ianborders/kyberbot kyberbot-factory`: `status: pass`, 2/2 skills written, 1/1 delamain written, 0 warnings. New `agents/testing.md` (codex/openai frontmatter) projected into `.claude/delamains/kyberbot-factory-jobs/agents/`. Updated `delamain.yaml` carries the new `testing` and `test-input` states plus the new transitions.
- No rollback needed — both validation and projection passed on the first live attempt.

## Outcome

- Manifest status flipped to `migrated`.
- Live system on `version: 2` with the v2 skills set active.
- All three live records (KF-001, KF-002, KF-003) carry the new `testing_session: null` frontmatter field and `## TESTS\n\nnull` body block; their `status: done` and ACTIVITY_LOG bodies are unchanged.
- Cutover commit: `migrate: cut over kyberbot-factory v1 to v2`.

## Notes

- The dispatcher worked KF-002 and KF-003 from `research-gate`/`planning-gate` all the way through `dev → in-review → done` while the change-skill phase was authoring v2. By the time `/als:migrate` started, all three live records were already terminal `done`. This made the migration scope purely additive (no in-flight state to navigate). Surfaced as a project-state surprise but not a migration risk.
- The dispatcher made real code changes during those background runs — KF-002 implemented `kyberbot fleet set-turns / get-turns` in `packages/cli/src/commands/fleet.ts`, and KF-003 enhanced `kyberbot fleet status` with `--json`, `--strict`, `lastBeat`, and remote-agent probing. Those commits (`a804ff2..54787a2`) are unrelated to the kyberbot-factory module migration but exist in the same repo. They will not be included in the migrate cutover commit per the migrate skill's "do not pull unrelated cleanup into the cutover commit" rule.
- A follow-up cleanup is pending: more dispatcher-runtime files (`runtime/worktree-state.json`, `telemetry/events.jsonl`, `runtime-manifest.json`, `scheduled_tasks.lock`) snuck into the baseline projection commit `1d264c6` and continue to be mutated by the running dispatcher. They should be added to `.gitignore` and `git rm --cached`'d in a separate cleanup commit; out of scope for this migration.
