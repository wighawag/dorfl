---
title: review-gate non-blocking nits for 'apply-disposition-delete-to-dispose-regime-polymorphic' (Gate 2 approve)
date: 2026-07-13
status: open
reviewOf: apply-disposition-delete-to-dispose-regime-polymorphic
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'apply-disposition-delete-to-dispose-regime-polymorphic' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the in-scope decision to write a `reason:` frontmatter marker on the SPEC branch too (the acceptance criteria only mandate `reason:` for TASK dispositions; the spec branch is only required to `git mv` to `specs/dropped/`). Rationale is recorded in the JSDoc `## Decisions` block on `disposeToTerminal` (symmetry across regimes + operator visibility without grepping commit history). The task's Done record itself has no `## Decisions` block — the decision lives only in code JSDoc.
  (packages/dorfl/src/apply-persist.ts disposeToTerminal '## Decisions' block; the task prompt asked to record non-obvious decisions durably and linked from the done record.)
- Stale doc-comment: the JSDoc note above the APPLY_ALLOWED_OUTCOMES assertion in cli-apply-decider-wiring.test.ts still names the set as '{task | spec | adr | delete | resolve | ask}' while the assertion (correctly) checks for 'dispose'. Worth a one-word update to keep the vocabulary rename total.
  (packages/dorfl/test/cli-apply-decider-wiring.test.ts around line 79-80.)
