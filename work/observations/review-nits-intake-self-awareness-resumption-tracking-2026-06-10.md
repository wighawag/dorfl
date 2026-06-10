---
title: review-gate non-blocking nits for 'intake-self-awareness-resumption-tracking' (Gate 2 approve)
date: 2026-06-10
status: open
slug: intake-self-awareness-resumption-tracking
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-self-awareness-resumption-tracking' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: a malformed or unknown-`kind` intake marker is silently treated as ABSENT (the comment is then classified as a HUMAN comment), never throwing.
  (`parseIntakeMarker` returns `undefined` for a marker with no `kind` or an unknown `kind` (e.g. `kind=frobnicate`). This is a deliberate robustness choice (an unparseable hidden comment must never crash the triage), and it is tested. The consequence to ratify: a future intake that stamps a NEW kind this older code does not recognise would have that comment counted as a human comment by an old binary — which could make the triage treat intake's own future-kind comment as 'unseen' and falsely PROCEED. Acceptable for now (the kind vocabulary is closed at ask/bounced/created and `created` is already recognised), but worth a human nod since it is a forward-compat behaviour the slice did not explicitly specify.)
- Ratify the empty-thread (zero comments) → PROCEED branch the slice did not explicitly enumerate.
  (`triageIntake([])` returns `proceed` with empty enrichment, reasoning 'a fresh issue with no comments has genuine new material (the body)'. The slice's triage table is written in terms of 'last comment is intake's / someone else's' and does not call out the no-comment case. The choice is correct (a brand-new issue must be processed) and is tested, but it is an in-scope decision the agent made on its own.)
- Ratify the marker placement/formatting: the hidden HTML comment is appended AFTER the human-readable text, separated by a blank line (and the body is right-trimmed first; an empty body yields the bare tag).
  (`stampIntakeMarker` does `${text}\n\n${tag}`. The marker renders as nothing on GitHub so this is invisible in practice, but it is a user-visible layout decision (position + separator + empty-body handling) not pinned by the slice. Reasonable and tested; recording it for ratification.)
- Ratify reformatting a pre-existing, unrelated observation file (`work/observations/review-nits-slice-level-issue-field-...md`) as part of this slice's diff.
  (The agent ran `pnpm format` (the repo's documented fix step) to keep its gate green, which reformatted a base-branch file that was committed unformatted in caa8b21 and is RED on `main` independent of this slice. The change is pure whitespace/line-wrap (no content change) and the agent honestly captured the situation in a new observation (`preexisting-unformatted-observation-file-fails-format-check-2026-06-10.md`). It is a content-neutral, well-documented cross-touch; flagging only so the human ratifies including it in this slice's PR rather than fixing the base separately.)
