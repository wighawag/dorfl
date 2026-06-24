<!-- agent-runner-sidecar: item=observation:review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23 type=observation slug=review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23 allAnswered=false -->

## Q1

**What becomes of this observation — the two non-blocking Gate-2 nits on 'clean-break-fixture-folder-vocab-compat-seam' (the cosmetic 'slicing'->'tasking' rename in three test files, and the missing '## Decisions' block on the PR)?**

> Source: work/notes/observations/review-nits-clean-break-fixture-folder-vocab-compat-seam-2026-06-23.md (status: open, reviewOf: clean-break-fixture-folder-vocab-compat-seam, Gate 2 APPROVED).
>
> Finding 1 — the 'slicing'->'tasking' literal rename in test/tasking-acquires-unified-lock.test.ts:66, test/tasking-lock.test.ts:44, and test/ledger-read.test.ts:103 (vestigial 'tasking' union member added there). The observation itself verifies the rename is CORRECT: 'tasking' is not in FIXTURE_WORD_TO_KEY so it passes through unchanged to work/tasking/<slug>.md, matching the updated gitRepo.ts JSDoc L40-43 ('the retired transient "tasking" marker some readers still probe for ABSENCE'). The probes are .toBe(false) ABSENCE assertions that pass regardless of the literal — so the rename is cosmetic-coherence only, not a behaviour change. No code action seems required.
>
> Finding 2 — the PR (commit 17e768b) carries no '## Decisions' block. The observation explicitly notes 'nothing load-bearing was decided silently' (the 7-file scope expansion is covered by the task's 'Any remaining fixture call site' clause); the only thing that 'belonged' in a Decisions block was the cosmetic rename above. This is a process nit about future ratifiability of past PRs, not a fix to make in current code.
>
> Both findings are cosmetic / retrospective. Neither names a code defect, missing test, or unsafe behaviour. There is no obvious task to promote (the rename is already in main and is correct; the missing Decisions block is on a landed commit and cannot be retro-edited as work).

_Suggested default: delete — both nits are cosmetic-coherence / retrospective-process notes on a landed, approved PR; the rename is verified correct, the missing Decisions block is unfixable after the fact, and neither implies follow-up work. The signal (prefer a '## Decisions' block when a non-obvious naming choice is made) is general PR-authoring hygiene better carried by reviewer habit than by a durable open observation._

<!-- q1 fields: id=q1 disposition=delete -->

**Your answer** (write below this line):

delete. Confirmed: both nits are cosmetic-coherence / retrospective-process notes on a landed, approved PR. The 'slicing'->'tasking' literal rename is verified correct (the probes are `.toBe(false)` absence assertions that pass regardless of the literal), and the missing `## Decisions` block is on an already-merged commit that cannot be retro-edited into work. Neither implies follow-up code. The general signal (prefer a `## Decisions` block when a non-obvious naming choice is made) is PR-authoring hygiene carried by reviewer habit, not a durable open observation.
