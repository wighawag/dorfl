---
title: review-gate non-blocking nits for 'intake-event-classification' (Gate 2 approve)
date: 2026-06-09
status: open
slug: intake-event-classification
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-event-classification' but raised the following non-blocking findings (nits). They do not block integration; this is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the decision to treat ALL `issue-comment-edited` events as `ignore` unconditionally (rather than distinguishing a 'buried' prior comment from the user's LATEST comment). Is it acceptable that a user who answers intake's clarifying question by EDITING their existing latest comment — instead of posting a new reply — will NOT cause intake to resume? (The slice criterion reads 'BURIED prior-comment-edited ⇒ ignore'; the implementation collapses every `issue-comment-edited` to `ignore` and documents 'buried' as merely descriptive. This is a sound, loop-safe reading the PRD does not contradict (the PRD never defines a 'buried' predicate). But the PRD's ASK loop says 'a later run resumes from the updated thread' — an edit-to-answer would be silently ignored under this rule. Cheap to reverse later (add a distinct event kind), so non-blocking; flagging for the human to ratify or refine. Also: there is no PR `## Decisions` block to ratify against (work is uncommitted beyond the claim), so this decision was recovered from the source doc-comment rather than a declared decision.)
- Confirm the deliberately MINIMAL `IntakeEvent` shape (just `{kind}`) is the intended seam for CI's later trigger to consult — i.e. CI maps its provider event onto an `IntakeEventKind` and carries author/trust/trigger-policy fields entirely on its own side, never extending `IntakeEvent`. (The module documents that the event is minimal by design and that trigger policy is `runner-in-ci`'s. This is the right layering, but it is a cross-slice interaction (it constrains how `runner-in-ci` will consume this classifier). Worth a human nod that this is the intended consumption contract before `runner-in-ci` builds against it.)
