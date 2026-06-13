---
title: review-gate non-blocking nits for 'loop-advance-persists-treeless-rungs-to-arbiter' (Gate 2 approve)
date: 2026-06-13
status: open
slug: loop-advance-persists-treeless-rungs-to-arbiter
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'loop-advance-persists-treeless-rungs-to-arbiter' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the in-scope build decisions, which were NOT recorded in a '## Decisions' block (the slice still shows only the pre-build 'to record' placeholders, and the work is uncommitted so there is no PR description). The agent chose: (1) Option 1 (extract + reuse pushTreelessResult, ff-push parity); (2) placed the shared publish in a NEW file src/advance-treeless-publish.ts; (3) kept retries: 3 (the one-shot default). All three match the slice's lean defaults. Confirm you accept them and that the missing Decisions record is acceptable for this slice.
  (Slice '## Decisions (to record while building)' asked the agent to record the option chosen and where the shared publish lives. None was recorded. The choices are all the slice's recommended defaults, so this is a process/paper-trail gap, not a wrong call.)
- Ratify a small cross-path message change: extracting pushTreelessResult genericised the one-shot path's human-facing note text from 'advance --isolated: could not publish ... saved in the isolated clone' to 'advance: could not publish ... saved in the working clone'. Behaviour is unchanged and no test asserts on the text, but the one-shot operator-facing note is now slightly less specific.
  (The slice required the one-shot path's behaviour to be UNCHANGED. Functionally it is (the only difference is the prose of the non-fatal note), but the note text did change for the existing one-shot caller as a side effect of sharing the function.)
- Consider adding an arbiter-level assertion for at least one of the apply / triage-observation tree-less rungs (the surface case is covered end-to-end on the arbiter, but apply/triage publishing is only covered indirectly via the shared TREELESS_RUNGS gate).
  (The slice's first acceptance criterion names 'a surfaced needsAnswers sidecar (and an applied answer, and a triaged: marker)'. Only the surface sidecar is asserted on the arbiter. The push is rung-agnostic so the mechanism is exercised, but explicit apply/triage arbiter coverage would fully match the criterion's wording.)
