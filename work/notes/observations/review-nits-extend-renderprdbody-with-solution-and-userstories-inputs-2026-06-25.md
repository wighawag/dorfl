---
title: review-gate non-blocking nits for 'extend-renderprdbody-with-solution-and-userstories-inputs' (Gate 2 approve)
date: 2026-06-25
status: open
reviewOf: extend-renderprdbody-with-solution-and-userstories-inputs
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'extend-renderprdbody-with-solution-and-userstories-inputs' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The golden test proves intakes default-scaffold shape only via .toContain (sections present + order), not a full byte-for-byte .toBe; only the promotion shape gets the byte-for-byte .toBe. Is that the intended split?
  (buildable-body.test.ts: the intake-scaffold test uses toContain/indexOf; the byte-for-byte toBe is on the promotion (neither-new-input) case. This is correct scoping (the intake byte-for-byte equivalence is the follow-on rewire tasks burden, since this task is additive-only and does not rewire intake), but the renderer-reproduces-intake-byte-for-byte claim in the task is not directly asserted here. I manually verified equivalence: renderer output (PS+Solution+UserStories, no OQ) ends ...<userStories>
, and intakes renderPrd builds the same sections then appends one 
, so the bytes match. The rewire task should lock this with a toBe.)
