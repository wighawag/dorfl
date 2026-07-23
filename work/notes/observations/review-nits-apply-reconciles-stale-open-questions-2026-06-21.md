---
title: 'review-gate non-blocking nits for ''apply-reconciles-stale-open-questions'' (Gate 2 approve)'
date: 2026-06-21
status: open
reviewOf: apply-reconciles-stale-open-questions
needsAnswers: false
triaged: keep
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'apply-reconciles-stale-open-questions' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The literal marker string (`

`) is given as an example in the brief and is needed by BOTH parallel slices to agree, yet neither slice is formally authoritative over the string. Should one slice (probably slice B, which edits the templates) be named as the canonical source, with slice A referencing it, to remove the coordination risk if the two slices land out of order or pick different tags?
  (Brief D1 phrases the marker as 'e.g. an HTML comment fence `

`'. Slice apply-reconciles-resolved-brief-body says 'The marker convention is decided by the brief (D1)' and writes tests with marker-fenced inputs it constructs itself. Slice templates-mark-transient-open-questions-block says 'exact marker tag chosen if it differs from `<!-- open-questions -->`' may be recorded in the done record. Both `blockedBy: []`. Mitigation already in place: both slices cite the same example string and read the brief first, so divergence is unlikely — hence non-blocking, but worth a reviewer eyeballing at landing time.)

## Applied answers 2026-06-22

### q1: Triage the non-blocking review nit on the open-questions marker string (`<!-- open-questions -->` / `<!-- /open-questions -->`): should one of the two parallel slices (apply-reconciles-resolved-brief-body and templates-mark-transient-open-questions-block) be named the canonical source of the literal marker tag (likely slice B, which edits the templates), with the other slice referencing it — or is the current 'both cite the same example from brief D1' arrangement enough?

KEEP — the current "both cite the same example from brief D1" arrangement is enough. Verified: both slices are still pending and parallel; slice A is STRUCTURAL (it matches the marker PAIR and reads the brief, it does NOT hardcode the literal tag), and slice B owns the template tag. So even if B picks a different literal, A matches whatever pair B emits — the coordination risk is genuinely low and a landing-time reviewer eyeball is proportionate. Promote a canonical-source slice only if the two slices later actually pick different tags. Disposition: keep.

disposition: keep
