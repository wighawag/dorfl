---
title: review-gate non-blocking nits for 'surface-promote-prd-as-human-only-disposition' (Gate 2 approve)
date: 2026-06-24
status: open
reviewOf: surface-promote-prd-as-human-only-disposition
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'surface-promote-prd-as-human-only-disposition' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the agent captured a NEW, out-of-task observation note (`work/notes/observations/git-integration-tests-time-out-under-parallel-load-2026-06-24.md`) about two git-integration tests flaking under parallel load at the 5000ms per-test timeout. It is correctly bucketed (observation, `needsAnswers: true`, open question about raising `testTimeout` vs capping parallelism) and explicitly flagged as unrelated to this task. This is good capture-signal hygiene, not scope creep, but it is an in-scope-of-the-run decision the human should ratify (it adds a live signal to the inbox and names a real CI-flake risk worth triaging).
  (Added in commit 13bbf4b alongside the disposition change; the note disclaims any link to the surface/triage vocabulary change.)
- Minor test nit (no action required): in `triage-gate.test.ts` the new US#5 test guards `if (emit.auto) { expect(['duplicate','map']).toContain(emit.kind); }` AFTER `expect(emit.auto).toBe(false)`. Because `auto` is already asserted false, that inner block is unreachable at runtime — it functions only as a compile-time type-narrowing comment, never as an executed assertion. Harmless and arguably self-documenting, but it is not adding runtime coverage the way its comment implies.
  (packages/dorfl/test/triage-gate.test.ts — the `NEVER auto-promotes` case; the real assertion is the preceding `expect(emit.auto).toBe(false)`.)
