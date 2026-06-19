---
title: review-gate non-blocking nits for 'regroup-notes-and-task-board-rename' (Gate 2 approve)
date: 2026-06-19
status: open
reviewOf: regroup-notes-and-task-board-rename
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'regroup-notes-and-task-board-rename' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the stray in-progress/claim-cas-spinner.md was re-homed to the agent POOL tasks/todo/ (not tasks/done or a recreated transient folder). Is the pool the intended durable home for this lock-less item?
  (The slice steered this strongly ('it carries no lock, so it belongs in the pool tasks/todo/'), so the choice is well-grounded and the diff matches: work/in-progress/claim-cas-spinner.md -> work/tasks/todo/claim-cas-spinner.md, with no tasks/in-progress/ created. The agent did not record it in a ## Decisions block / ADR as the prompt requested; flagging for the human to ratify the placement of record.)
- Ratify the new test-helper seam fixtureFolderRel(key) in helpers/gitRepo.ts and specifically its LOOSE passthrough: an unknown key (e.g. legacy 'slicing') is returned UNCHANGED rather than throwing. Is silent passthrough the intended behaviour, or would a stricter fail-on-unknown-key be safer against a future typo masking a stale fixture?
  (This is a genuine in-scope design decision the slice did not specify. It is a good move: it routes the parameter-driven fixtures (existsOnArbiterMain, registerMirrorWithWork, pushWorkToMirrorOrigin) that cannot be statically swept through the single work-layout source, so a later rename flips here too. The looseness is documented in JSDoc and motivated by legacy 'slicing' probes. The risk is mild: a mistyped status word would pass through as a literal folder name and could silently miss the new layout. Not recorded in a ## Decisions block/ADR; non-blocking ratification.)
