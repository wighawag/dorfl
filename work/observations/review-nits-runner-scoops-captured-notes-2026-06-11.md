---
title: review-gate non-blocking nits for 'runner-scoops-captured-notes' (Gate 2 approve)
date: 2026-06-11
status: open
slug: runner-scoops-captured-notes
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'runner-scoops-captured-notes' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the scoop+report is deliberately scoped to exactly two capture buckets (work/observations/, work/findings/) via the hard-coded CAPTURE_NOTE_DIRS constant, and matches by `startsWith` on the staged path. Any other agent-authored work/ file (e.g. a new ADR under work/docs/adr/, an idea under work/ideas/) is committed by `git add -A` but NOT named in the report. Is the two-bucket scope correct, or should other agent-emitted-but-reportable buckets (notably ADRs) be reported too?
  (The source observation explicitly recommended this narrow scope ('only observations/ + findings/ ... to avoid scooping accidental scratch files'), so this is a faithful, defensible choice and the scratch.tmp test enforces it. Flagging only so the human ratifies the bucket list as the intended channel surface rather than an accident, since it silently governs what future agent-authored note types get surfaced.)
- Ratify: captured notes are scooped+reported ONLY on the SUCCESS integration commit (performIntegration). The failure/disposition commit paths that also run `git add -A` — needs-attention.ts (the WIP/abort work-preservation commits) and apply-persist.ts (out-of-scope/needs-attention lifecycle moves) — still PERSIST any agent-written note via their own `git add -A` but do NOT report it. Is 'report only on the success path' the intended boundary?
  (The slice text scopes the fix to 'a do prd: slice commit AND a do <slice> build integration', i.e. the success channel, so omitting the failure paths is within the stated scope and arguably correct (the needs-attention path already surfaces its own failure reason and a different report). Worth a human ratification because it is an unstated boundary decision: a note an agent captures right before STOPping/erroring lands in git but is not surfaced by this new report.)
- Ratify: reportScoopedNotes is called BEFORE the commit (it reads `git diff --cached` after `git add -A`, at line 603, with the commit at line 610). The report therefore announces the staged set, not the post-commit set. Confirm this is the intended ordering.
  (In practice the gap is negligible — the commit is a `gitHard` immediately after with no intervening mutation, so the staged set equals the committed set, and on a commit failure gitHard throws (the run aborts) so a 'scooped' line printed just before an aborted commit is the worst case. An alternative is to report AFTER the commit succeeds (strictly 'what landed'). Calling it pre-commit is reasonable and keeps the helper a pure read of the staged set; flagging only so the 'report exactly what landed' honest-reporting intent is consciously ratified against the pre-commit read.)
