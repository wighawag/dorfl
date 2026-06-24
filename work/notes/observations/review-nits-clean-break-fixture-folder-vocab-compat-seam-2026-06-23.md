---
title: review-gate non-blocking nits for 'clean-break-fixture-folder-vocab-compat-seam' (Gate 2 approve)
date: 2026-06-23
status: open
reviewOf: clean-break-fixture-folder-vocab-compat-seam
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'clean-break-fixture-folder-vocab-compat-seam' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the in-scope choice to map the retired transient marker word 'slicing' -> 'tasking' (rather than dropping the union member). In tasking-acquires-unified-lock.test.ts and tasking-lock.test.ts the passthrough literal was renamed 'slicing'->'tasking', and a vestigial 'tasking' member was added to the local union in ledger-read.test.ts. This is correct (the marker's current name is tasking/, and 'tasking' is NOT in FIXTURE_WORD_TO_KEY so it passes through unchanged to work/tasking/<slug>.md, matching the updated gitRepo.ts JSDoc), but it was a non-obvious naming decision and the PR carries no '## Decisions' block. The probes are ABSENCE assertions (.toBe(false)) that pass regardless of the literal, so the rename is cosmetic-coherence only.
  (test/tasking-acquires-unified-lock.test.ts:66, test/tasking-lock.test.ts:44, test/ledger-read.test.ts:103; gitRepo.ts JSDoc L40-43 ("the retired transient 'tasking' marker some readers still probe for ABSENCE"))
- PR has no '## Decisions' block at all. Nothing load-bearing was decided silently (the scope expansion to 7 unnamed test files is explicitly covered by the task's 'Any remaining fixture call site' clause), but for future ratifiability the 'slicing'->'tasking' word choice belonged in a Decisions block.
  (git commit 17e768b body is empty apart from the subject line.)

## Applied answers 2026-06-24

### q1: What becomes of this observation — the two non-blocking Gate-2 nits on 'clean-break-fixture-folder-vocab-compat-seam' (the cosmetic 'slicing'->'tasking' rename in three test files, and the missing '## Decisions' block on the PR)?

delete. Confirmed: both nits are cosmetic-coherence / retrospective-process notes on a landed, approved PR. The 'slicing'->'tasking' literal rename is verified correct (the probes are `.toBe(false)` absence assertions that pass regardless of the literal), and the missing `## Decisions` block is on an already-merged commit that cannot be retro-edited into work. Neither implies follow-up code. The general signal (prefer a `## Decisions` block when a non-obvious naming choice is made) is PR-authoring hygiene carried by reviewer habit, not a durable open observation.

disposition: delete

## Recommended: delete

A human answered "delete": this item can be removed (git history is the archive). The agent leaves the deletion to the human per the capture-bucket contract.
