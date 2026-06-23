---
title: review-gate non-blocking nits for 'clean-break-fixture-folder-vocab-compat-seam' (Gate 2 approve)
date: 2026-06-23
status: open
reviewOf: clean-break-fixture-folder-vocab-compat-seam
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'clean-break-fixture-folder-vocab-compat-seam' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the in-scope choice to map the retired transient marker word 'slicing' -> 'tasking' (rather than dropping the union member). In tasking-acquires-unified-lock.test.ts and tasking-lock.test.ts the passthrough literal was renamed 'slicing'->'tasking', and a vestigial 'tasking' member was added to the local union in ledger-read.test.ts. This is correct (the marker's current name is tasking/, and 'tasking' is NOT in FIXTURE_WORD_TO_KEY so it passes through unchanged to work/tasking/<slug>.md, matching the updated gitRepo.ts JSDoc), but it was a non-obvious naming decision and the PR carries no '## Decisions' block. The probes are ABSENCE assertions (.toBe(false)) that pass regardless of the literal, so the rename is cosmetic-coherence only.
  (test/tasking-acquires-unified-lock.test.ts:66, test/tasking-lock.test.ts:44, test/ledger-read.test.ts:103; gitRepo.ts JSDoc L40-43 ("the retired transient 'tasking' marker some readers still probe for ABSENCE"))
- PR has no '## Decisions' block at all. Nothing load-bearing was decided silently (the scope expansion to 7 unnamed test files is explicitly covered by the task's 'Any remaining fixture call site' clause), but for future ratifiability the 'slicing'->'tasking' word choice belonged in a Decisions block.
  (git commit 17e768b body is empty apart from the subject line.)
