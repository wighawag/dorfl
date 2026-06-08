---
title: review-gate non-blocking nits for 'slicer-loop-flag-family' (Gate 2 approve)
date: 2026-06-08
status: open
slug: slicer-loop-flag-family
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'slicer-loop-flag-family' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for batch-qa triage (promote-to-slice / keep / delete).

- Should the loop's INTERNAL N-cap field also be renamed maxReview → slicerLoopMax (RunSliceReviewLoopOptions.maxReview, runOneExecution, the ~12 doc-comment/log references in slicer-review-loop.ts), to fully satisfy the slice's 'grep finds no maxReview left meaning the OLD thing' criterion?
  (slicing.ts translates slicerLoopMax→maxReview at the runSliceReviewLoop call (slicing.ts:369), so the internal maxReview is the SAME concept under its pre-rename name. The prompt's where-to-look enumerated only the loop's reviewModel for this file (not maxReview), so the agent stayed literal. Not blocking: the residue is purely-internal and never spans to the gate (which uses the distinct word reviewMaxRounds), so the CLI/code-level unmistakability the slice exists for is achieved. Flag for a tidy follow-up.)
- The user-visible needs-attention message at slicing.ts:802 (decompositionUnclearReason) still reads 'maxReview exhausted with unresolved blockers' — naming a flag this slice deleted from the CLI/config. Update it (and the loop file's own maxReview doc-comments) to the new slicer-loop-max language?
  (The slice's AC 'In-tree specs/docs naming the old loop flags are updated for honesty' was applied to work/prd/review.md's prose but not to this runtime message or slicer-review-loop.ts's own comments — an inconsistent application of the honesty criterion. A human reading that needs-attention body would look for a --max-review knob that no longer exists.)
- Ratify the agent's choice to edit work/prd/review.md (the GATE PRD) — rather than only this slice's source PRD slicing-coherence — for the maxReview→slicerLoopMax prose update?
  (No PR ## Decisions block was present to start from. review.md's RESOLVED DESIGN is where the loop's maxReview concept was specified, and the rename-reviewpr-to-review precedent updated work/prd/review.md the same way, so the choice is sound — but it is an unrecorded in-scope scope decision worth a human's ratification.)
