---
needsAnswers: true
---

# Flaky fixture failures: fresh-gate `m.oldName is not a function` + self-renaming-folder "No projects found"

> Observed 2026-07-11 while running the full `dorfl` test suite for the `author-convert-from-prd-to-spec-skill` task.

On one run of `pnpm --filter dorfl test`, a single test failed with `TypeError: m.oldName is not a function` at `/tmp/dorfl-fresh-gate-*/tip/caller.js` (a spawned-subprocess fixture), alongside repeated `No projects found in "/tmp/dorfl-self-renaming-folder-*/project"` output. Re-running the same suite passed all 2956 tests (206 files) with no code change, so this looks like a flaky/transient fixture issue (subprocess/tmp race), not a real regression from this task. Not investigated further; flagged here so the signal is captured.
