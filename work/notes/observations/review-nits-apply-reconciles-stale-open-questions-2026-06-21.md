---
title: review-gate non-blocking nits for 'apply-reconciles-stale-open-questions' (Gate 2 approve)
date: 2026-06-21
status: open
reviewOf: apply-reconciles-stale-open-questions
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'apply-reconciles-stale-open-questions' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The literal marker string (`<!-- open-questions -->` / `<!-- /open-questions -->`) is given as an example in the brief and is needed by BOTH parallel slices to agree, yet neither slice is formally authoritative over the string. Should one slice (probably slice B, which edits the templates) be named as the canonical source, with slice A referencing it, to remove the coordination risk if the two slices land out of order or pick different tags?
  (Brief D1 phrases the marker as 'e.g. an HTML comment fence `<!-- open-questions -->` ... `<!-- /open-questions -->`'. Slice apply-reconciles-resolved-brief-body says 'The marker convention is decided by the brief (D1)' and writes tests with marker-fenced inputs it constructs itself. Slice templates-mark-transient-open-questions-block says 'exact marker tag chosen if it differs from `<!-- open-questions -->`' may be recorded in the done record. Both `blockedBy: []`. Mitigation already in place: both slices cite the same example string and read the brief first, so divergence is unlikely — hence non-blocking, but worth a reviewer eyeballing at landing time.)
