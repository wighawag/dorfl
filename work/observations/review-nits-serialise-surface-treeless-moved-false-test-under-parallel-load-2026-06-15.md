---
title: review-gate non-blocking nits for 'serialise-surface-treeless-moved-false-test-under-parallel-load' (Gate 2 approve)
date: 2026-06-15
status: open
slug: serialise-surface-treeless-moved-false-test-under-parallel-load
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'serialise-surface-treeless-moved-false-test-under-parallel-load' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Sibling slice serialise-review-gate-test-under-parallel-load also edits the same RACE_SENSITIVE array in packages/agent-runner/vitest.config.ts. If both are in flight, they touch the same lines region and could conflict on merge. Worth confirming ordering, though each addition is distinct and additive.
  (Two slices found under work/ both named serialise-...-test-under-parallel-load; both append a distinct entry to the RACE_SENSITIVE array (vitest.config.ts:26). This landed diff adds only 'test/surface-treeless-moved-false.test.ts' and is internally clean; the note is purely about parallel landing with the sibling.)
