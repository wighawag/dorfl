---
title: review-gate non-blocking nits for 'intake-closes-issue-on-bounce' (Gate 2 approve)
date: 2026-06-10
status: open
slug: intake-closes-issue-on-bounce
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-closes-issue-on-bounce' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the choice to set `commented: close.closed` on the bounce path — i.e. `commented` is reported true iff the atomic CLOSE succeeded.
  (In `dispatchComment`'s bounce branch the result sets both `closed: close.closed` AND `commented: close.closed`. This re-uses the existing `commented` flag to mean "the closing comment landed (atomically, as part of the close)". It is defensible — the comment genuinely posts atomically with the close, so when the close fails no comment landed — but `commented` previously meant "a `postIssueComment` succeeded", and a future consumer distinguishing "posted a standalone comment" from "closed-with-comment" would now see `commented=true` for a bounce. The slice specified only the additive `closed?` and did not call out re-using `commented` on the bounce path; an in-scope decision the agent made on its own, worth a human nod.)
- Ratify including the whitespace-only reformat of a pre-existing, unrelated base-branch observation file (`work/observations/review-nits-intake-self-awareness-resumption-tracking-2026-06-10.md`) in this slice's diff.
  (Running `pnpm format` (the repo's documented fix step) to keep the gate green rewrapped a base-branch markdown file that is committed unformatted and RED on `format:check` independent of this slice (the SAME recurring cross-touch the prior slice already flagged). The change is pure whitespace/line-wrap, no content change, and the agent honestly captured it in a new observation (`preexisting-unformatted-observation-file-reformatted-by-intake-closes-bounce-2026-06-10.md`) that also proposes a standalone 'format the base' chore. Content-neutral and well-documented; flagging only so the human ratifies the cross-touch rather than treating it as scope creep — and considers the proposed base-format chore to stop every future slice inheriting it.)
- Ratify the PRD edits that went BEYOND the four spots the slice literally enumerated — user-story #5 and the 'Loop closure' section header were also amended.
  (The slice's acceptance criterion named the BOUNCE decision-table row, the Loop-closure/'never closes' lines, and the Out-of-Scope `closeIssue` framing. The agent additionally rewrote user-story #5 (to include the terminal close) and the 'Loop closure' section header (`— except BOUNCE`). These are coherent, correct improvements that keep the PRD internally consistent with the reversal, but they are slightly broader than the literal instruction — recording for ratification.)
