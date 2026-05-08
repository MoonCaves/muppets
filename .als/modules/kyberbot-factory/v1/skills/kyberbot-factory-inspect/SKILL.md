---
name: kyberbot-factory-inspect
description: Read-only queries across kyberbot factory jobs — status, search, and reporting.
---

# kyberbot-factory-inspect

Read-only queries across all factory jobs. Search, filter, and report on jobs without modifying any records.

## Input

- "show all factory jobs"
- "what jobs are in dev"
- "show KF-001"
- "factory status"
- "what's done"

## Procedure

### List all jobs

Scan `kyberbot-factory/jobs/` and present a summary table:

| ID | Title | Type | Status | Updated |
|----|-------|------|--------|---------|

### Filter by status

Read frontmatter across all jobs, filter by requested status or phase.

### Filter by type

Filter jobs by type value (`feature`, `enhancement`, `defect`, `hotfix`, `security`, `chore`).

### Show single job

Read and present the full record for a specific job ID.

### Pipeline summary

Count jobs per phase/status and present a dashboard view:

```
research: 2  |  implementation: 3  |  closed: 5
```

## Scope

- **Manages**: read-only queries on job entity
- **Does not manage**: creation, updates, transitions (use `kyberbot-factory-console`)
