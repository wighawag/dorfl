---
needsAnswers: false
---

# Flaky fixture failures: fresh-gate `m.oldName is not a function` + self-renaming-folder "No projects found"

> Observed 2026-07-11 while running the full `dorfl` test suite for the `author-convert-from-prd-to-spec-skill` task.

On one run of `pnpm --filter dorfl test`, a single test failed with `TypeError: m.oldName is not a function` at `/tmp/dorfl-fresh-gate-*/tip/caller.js` (a spawned-subprocess fixture), alongside repeated `No projects found in "/tmp/dorfl-self-renaming-folder-*/project"` output. Re-running the same suite passed all 2956 tests (206 files) with no code change, so this looks like a flaky/transient fixture issue (subprocess/tmp race), not a real regression from this task. Not investigated further; flagged here so the signal is captured.

## Applied answers 2026-07-12

### q1: What should become of this flaky-fresh-gate / self-renaming-folder observation — delete it (single unreproduced occurrence, no live signal), keep it open pending recurrence, or mint a task to investigate the specific 'm.oldName is not a function' + 'No projects found' failure mode?

Keep open pending recurrence. It is a single unreproduced occurrence with no live signal, so do not mint an investigation task yet, but the failure mode is specific enough ('m.oldName is not a function' + 'No projects found') that deleting it would throw away a useful fingerprint if it recurs. Revisit and promote (or delete) on the next occurrence.

## Applied answers 2026-07-12

### q1: What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).

Resolve (keep the note on record). It is a single unreproduced occurrence with no live signal, so do not mint an investigation task yet, but the failure mode is specific enough ('m.oldName is not a function' + 'No projects found') that the note is worth keeping as a fingerprint. Re-open / promote to an investigation task only if it recurs.

## Applied answers 2026-07-14

### q1: What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).

Resolve (keep the note on record as a fingerprint). This matches the disposition already recorded in the note body's 'Applied answers 2026-07-12' section: a single unreproduced occurrence with no live signal, so do not mint an investigation task, but the failure mode ('m.oldName is not a function' + 'No projects found') is a specific enough fingerprint to keep. Note also that the underlying `/tmp` fixture teardown race class has since been hardened (retry-hardened `rmrf` + git auto-gc-off in `packages/dorfl/test/helpers/gitRepo.ts`), which makes recurrence less likely; re-open / promote only if it recurs anyway.
