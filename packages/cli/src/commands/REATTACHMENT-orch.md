# REATTACHMENT — orch.ts human-actor fork patch

After each `git merge upstream/main`, re-apply these 4 line changes in `orch.ts`:

Search for `// FORK: human-actor` — four occurrences.

Changes:
- `created_by: 'human'` → `created_by: 'julian'`
- `actor: 'human'` → `actor: 'julian'`
- `author: 'human'` → `author: 'julian'`
- `resolved_by: 'human'` → `resolved_by: 'julian'`

Upstream PR candidate: these should be driven by `identity.yaml` `owner_name` field so any user can configure their human actor. Ian would likely accept this. File under upstream-pr-author when ready.
