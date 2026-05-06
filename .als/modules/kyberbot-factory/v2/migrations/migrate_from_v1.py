#!/usr/bin/env python3
"""
Prepared migration script — kyberbot-factory v1 → v2.

Status: STAGED placeholder. This script is authored by /als:change and is
intended to be exercised by /als:migrate. It does NOT modify live records on
its own and is not invoked during /als:change.

What v2 adds (see MANIFEST.md for the full contract):
  1. A new optional `## TESTS` body section between `## REVIEW` and
     `## DEPLOYMENT` in every job record under `kyberbot-factory/jobs/*.md`.
  2. A new auto-injected nullable frontmatter field `testing_session`,
     introduced because the v2 delamain declares
     `session-field: testing_session` on the new `testing` state.

Usage:
    python3 migrate_from_v1.py <als_system_root>

The first positional argument MUST be the absolute path to the ALS system
root — the directory containing `.als/system.ts`. The script fails closed if
that root is missing, if `.als/system.ts` is missing, or if the live module
data path cannot be resolved.

Migration is deterministic and idempotent:
  - Records that already contain `## TESTS` between `## REVIEW` and
    `## DEPLOYMENT` are left untouched.
  - Records whose frontmatter already contains `testing_session:` are left
    untouched on that field.
  - Running the script twice in a row produces the same result as running it
    once.

Failure modes (all exit non-zero with a message on stderr):
  - <als_system_root> does not exist or is not a directory.
  - <als_system_root>/.als/system.ts does not exist.
  - kyberbot-factory/jobs/ is missing under the system root.
  - A record cannot be parsed or is missing one of `## REVIEW` /
    `## DEPLOYMENT` (the TESTS block must be inserted between them).
  - Frontmatter cannot be parsed as YAML.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import List


MODULE_DATA_RELATIVE_PATH = "kyberbot-factory/jobs"

NEW_TESTS_BLOCK = "## TESTS\n\nnull\n\n"
TESTING_SESSION_FRONTMATTER_LINE = "testing_session: null"

REVIEW_HEADING_RE = re.compile(r"^## REVIEW\s*$", re.MULTILINE)
DEPLOYMENT_HEADING_RE = re.compile(r"^## DEPLOYMENT\s*$", re.MULTILINE)
TESTS_HEADING_RE = re.compile(r"^## TESTS\s*$", re.MULTILINE)
FRONTMATTER_BOUNDARY_RE = re.compile(r"^---\s*$", re.MULTILINE)
TESTING_SESSION_RE = re.compile(r"^testing_session\s*:", re.MULTILINE)
DEV_SESSION_ANCHOR_RE = re.compile(r"^dev_session\s*:.*$", re.MULTILINE)


class MigrationError(RuntimeError):
    pass


def fail(msg: str) -> "None":
    print(f"migrate_from_v1: {msg}", file=sys.stderr)
    sys.exit(1)


def resolve_system_root(argv: List[str]) -> Path:
    if len(argv) < 2:
        fail("missing required argument: <als_system_root>")
    root = Path(argv[1]).resolve()
    if not root.is_dir():
        fail(f"system root does not exist or is not a directory: {root}")
    if not (root / ".als" / "system.ts").is_file():
        fail(f"missing .als/system.ts under system root: {root}")
    return root


def resolve_module_data_dir(root: Path) -> Path:
    data_dir = root / MODULE_DATA_RELATIVE_PATH
    if not data_dir.is_dir():
        fail(
            f"missing module data path: {data_dir} "
            f"(expected {MODULE_DATA_RELATIVE_PATH} under {root})"
        )
    return data_dir


def split_frontmatter(text: str) -> tuple[str, str, str]:
    """Return (before_fm, fm_body, after_fm) where fm_body is the YAML between
    the two '---' fences (exclusive of the fences themselves), and `before_fm`
    ends at the start of the YAML body (immediately after the trailing newline
    of the opening fence)."""
    boundaries = list(FRONTMATTER_BOUNDARY_RE.finditer(text))
    if len(boundaries) < 2:
        raise MigrationError("frontmatter not found (expected two '---' fences)")
    first = boundaries[0]
    second = boundaries[1]
    fm_body = text[first.end() : second.start()]
    before_fm = text[: first.end()]
    after_fm = text[second.start() :]
    return before_fm, fm_body, after_fm


def add_testing_session_field(fm_body: str) -> tuple[str, bool]:
    """Add `testing_session: null` immediately after the `dev_session:` line
    (regardless of the dev_session value — null or UUID, both are valid).
    Returns (new_fm_body, changed)."""
    if TESTING_SESSION_RE.search(fm_body):
        return fm_body, False
    lines = fm_body.splitlines()
    out: List[str] = []
    inserted = False
    for line in lines:
        out.append(line)
        if not inserted and DEV_SESSION_ANCHOR_RE.fullmatch(line):
            out.append(TESTING_SESSION_FRONTMATTER_LINE)
            inserted = True
    if not inserted:
        raise MigrationError(
            "could not anchor on a 'dev_session:' frontmatter line to insert "
            "testing_session field"
        )
    return "\n".join(out) + ("\n" if fm_body.endswith("\n") else ""), True


def insert_tests_section(body: str) -> tuple[str, bool]:
    """Insert `## TESTS\\n\\nnull\\n` between `## REVIEW` and `## DEPLOYMENT`
    if not already present. Returns (new_body, changed)."""
    if TESTS_HEADING_RE.search(body):
        return body, False
    review_match = REVIEW_HEADING_RE.search(body)
    deployment_match = DEPLOYMENT_HEADING_RE.search(body)
    if not review_match:
        raise MigrationError("missing '## REVIEW' section")
    if not deployment_match:
        raise MigrationError("missing '## DEPLOYMENT' section")
    if deployment_match.start() <= review_match.start():
        raise MigrationError("'## DEPLOYMENT' appears before '## REVIEW'")
    insertion_point = deployment_match.start()
    new_body = body[:insertion_point] + NEW_TESTS_BLOCK + body[insertion_point:]
    return new_body, True


def migrate_record(path: Path) -> bool:
    """Migrate a single record file in place. Returns True if changed."""
    try:
        original = path.read_text(encoding="utf-8")
        before_fm, fm_body, after_fm = split_frontmatter(original)
        new_fm_body, fm_changed = add_testing_session_field(fm_body)
        new_after_fm, body_changed = insert_tests_section(after_fm)
    except MigrationError as e:
        fail(f"{path}: {e}")
        return False  # unreachable; satisfies type checker

    if not (fm_changed or body_changed):
        return False

    new_text = before_fm + new_fm_body + new_after_fm
    path.write_text(new_text, encoding="utf-8")
    return True


def main(argv: List[str]) -> int:
    root = resolve_system_root(argv)
    data_dir = resolve_module_data_dir(root)
    record_paths = sorted(data_dir.glob("*.md"))
    if not record_paths:
        print(f"no records found under {data_dir} — nothing to migrate")
        return 0
    changed = 0
    for path in record_paths:
        if migrate_record(path):
            changed += 1
            print(f"migrated: {path.relative_to(root)}")
        else:
            print(f"unchanged (already v2): {path.relative_to(root)}")
    print(f"done — {changed}/{len(record_paths)} record(s) migrated")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
