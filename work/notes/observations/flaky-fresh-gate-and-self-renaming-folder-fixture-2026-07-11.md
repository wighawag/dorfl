---
needsAnswers: true
---

# Flaky fixture failures: fresh-gate `m.oldName is not a function` + self-renaming-folder "No projects found"

> Observed 2026-07-11 while running the full `dorfl` test suite for the `author-convert-from-prd-to-spec-skill` task.

On one run of `pnpm --filter dorfl test`, a single test failed with `TypeError: m.oldName is not a function` at `/tmp/dorfl-fresh-gate-*/tip/caller.js` (a spawned-subprocess fixture), alongside repeated `No projects found in "/tmp/dorfl-self-renaming-folder-*/project"` output. Re-running the same suite passed all 2956 tests (206 files) with no code change, so this looks like a flaky/transient fixture issue (subprocess/tmp race), not a real regression from this task. Not investigated further; flagged here so the signal is captured.

## Applied answers 2026-07-12

### q1: What should become of this flaky-fresh-gate / self-renaming-folder observation — delete it (single unreproduced occurrence, no live signal), keep it open pending recurrence, or mint a task to investigate the specific 'm.oldName is not a function' + 'No projects found' failure mode?

Keep open pending recurrence. It is a single unreproduced occurrence with no live signal, so do not mint an investigation task yet, but the failure mode is specific enough ('m.oldName is not a function' + 'No projects found') that deleting it would throw away a useful fingerprint if it recurs. Revisit and promote (or delete) on the next occurrence.
