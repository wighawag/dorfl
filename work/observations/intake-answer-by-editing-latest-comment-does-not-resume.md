---
title: intake event-classification ignores ALL comment-edits, so a user answering intake's clarifying question by EDITING their latest comment (instead of posting a new reply) does not resume the loop
type: observation
status: spotted
spotted: 2026-06-09
---

## What was spotted

Caught during the Gate-3 conductor review of PR #54 (`intake-event-classification`). The Gate-2 nit raised it; recording it as the durable home.

`classifyIntakeEvent` (`src/intake-event.ts`) collapses EVERY `issue-comment-edited` event to `ignore` — it does not distinguish a BURIED prior comment from the user's LATEST comment. So a user who answers intake's ASK clarifying question by **editing their existing latest comment** (rather than posting a NEW reply) will NOT cause intake to resume.

## Why this is the PRD's limitation, not a slice defect (why PR #54 still APPROVED)

The slice + PRD both say verbatim: "editing a **buried PRIOR** comment is IGNORED" and the event vocabulary is `new-comment / issue-body-edited / prior-comment-edited`. There is NO distinct event kind in the spec for "edited the latest comment to answer." The "buried" framing exists to stop re-trigger loops. So the implementation meets the slice criterion verbatim, and the agent built exactly what was specified — this is a gap in the PRD's event model, surfaced by the build, not a coding miss.

The tension is with the PRD ASK-loop line "a later run resumes from the updated thread" — which is satisfied by a NEW comment or the next scheduled run, but NOT by an edit-to-answer.

## Why it matters

- A plausible, common user action (answer by editing your last comment) silently does nothing — intake never resumes, the issue looks stuck. A real UX trap once intake is live on real issues.

## Suggested fix (for a future slice / a `runner-in-ci` design input — NOT now)

Add a distinct event kind, e.g. `latest-comment-edited` ⇒ RE-EVALUATE, while keeping `buried-prior-comment-edited` ⇒ IGNORE (the loop-safety the current rule protects). This needs a "which comment was edited?" predicate (is the edited comment the newest on the thread?), which the seam can compute from `listComments` ordering. Cheap to reverse the current collapse; it constrains how `runner-in-ci`'s trigger maps provider events onto `IntakeEventKind`, so flag it as an input to that PRD.

## Refs

- PR #54 (`intake-event-classification`), merged 2026-06-09.
- `src/intake-event.ts` `classifyIntakeEvent`.
- Gate nits: `work/observations/review-nits-intake-event-classification-2026-06-09.md` (nit 1).
- Related: `work/prd-sliced/issue-intake.md` (the ASK loop "resumes from the updated thread"; the "buried prior-comment edit is IGNORED" line) — a candidate refinement to the PRD's event model, consumed by `runner-in-ci`'s trigger.
