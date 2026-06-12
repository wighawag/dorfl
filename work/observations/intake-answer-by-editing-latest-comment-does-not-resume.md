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

## Update 2026-06-12 — the gap is bigger than the event classifier (concurrency + watermark)

Verified against current code while triaging: the single-fix framing above (add a `latest-comment-edited` event kind) is NECESSARY but NOT SUFFICIENT. There are THREE independent reasons an edit-to-answer (and even a mid-run NEW comment) can be silently lost:

1. **Event classifier (the original signal):** `classifyIntakeEvent` (`src/intake-event.ts`) returns `ignore` for EVERY `issue-comment-edited` (the `IntakeEvent` shape carries only `kind`, no buried-vs-latest distinction) — confirmed live.

2. **The `seen=<ids>` watermark is comment-ID-based and EDIT-BLIND.** Resumption is set-arithmetic over `seenSet` (`computeSeenDelta`, `src/intake-marker.ts` + `src/intake.ts` ~L707): the triage's "is there unseen human input?" check ranges over comment IDs. Editing an already-`seen` comment keeps its ID, so the triage computes "nothing unseen" and SKIPS — EVEN IF the classifier were fixed to say `re-evaluate`. A complete fix must make the seen-set detect "edited since last seen" (track `updated_at` / a per-id body hash, not just the id).

3. **The `processing`-lock back-off DROPS a mid-run trigger with no re-tick.** A trigger arriving while the lock label is held returns `outcome: 'locked'` + a note and does NOTHING (`src/intake.ts` ~L478-487) — no queue, no "re-run needed" residue. Meanwhile the in-flight run already SNAPSHOTTED the comments (computed `seenDelta`) BEFORE the late change landed. So a comment/edit arriving between the in-flight run's snapshot and its lock-release is lost until the NEXT external trigger — a real lost-update window, and it is true for a NEW comment too, not only an edit. A complete fix needs either a re-check-before-release (re-read the thread after the work and re-run if new/edited input appeared) OR a "dirty / re-run-needed" flag the lock release honours.

So the `runner-in-ci` resumption design must address ALL THREE (classifier + edit-aware watermark + lock-release re-check), not just add the one event kind. Severity is higher than first framed: silent lost-UPDATES, not merely an edit-framing miss. (Surfaced 2026-06-12 by the concurrency question "what if the edit lands while the agent has already read the thread but is still processing, and the lock blocks the trigger?".)
