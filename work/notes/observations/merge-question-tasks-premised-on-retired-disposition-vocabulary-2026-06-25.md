---
title: merge-question tasks are premised on the now-retired disposition vocabulary
date: 2026-06-25
---

## What was noticed

Retiring the sidecar disposition vocabulary (the now-merged PRD
`agentic-question-resolution-retire-disposition-vocabulary`: no `disposition=`
field, no `promote-* | keep | delete | dropped | needs-attention` tokens, no
picker; apply is now the agentic `decide(input, allowedOutcomes)` →
`{mint-task | mint-prd | delete-source | ask-follow-up}`) has INVALIDATED THE
PREMISE of unbuilt tasks from the sibling PRD
`land-time-reverify-and-parallel-merge-ceiling` (in `prds/tasked/`).

Drifted tasks (verified against the bytes on `main`, 2026-06-25):

- **`merge-question-surfacer`** (`tasks/backlog/`, covers US #14) — its
  `## What to build`, a scope bullet, AND an acceptance criterion all require
  emitting merge-questions "with `merge | hold | drop` **disposition vocabulary**"
  into the sidecar. There is no longer a `disposition=` field to emit into — a
  sidecar entry is binary (no-answer | answered). As written, the task cannot be
  built.
- **`apply-rung-merge-disposition`** (`tasks/backlog/`) — specifies extending the
  apply rung's `promote-slice`/`dropped` disposition-dispatch in
  `triage-persist.ts` to dispatch an answered `merge` disposition. That dispatch
  (and `triage-persist.ts`'s disposition routing, the `pickTerminal` picker,
  `answeredPromoteArtifact`) was removed by the keystone. No token-dispatch
  remains to mirror; `merge` is not a `DecisionOutcome` either.

`merge-questions-gate-axis` (the third sibling) only GATES whether the surfacer
runs; it does not itself emit a disposition, so it is less directly drifted but
depends on the surfacer's reshape.

## Why it matters

The GOAL of that PRD is still valid: surface unmerged `work/*` branches → human
answers → apply lands them (the LAND primitive: rebase → re-verify → advance).
Only the MECHANISM (disposition tokens) is gone. So the work is not abandoned —
it needs RE-TASKING against the new agentic / binary-sidecar model. A wired-in
re-scope (sketched by the surface agent while rebuilding the
`apply-rung-merge-disposition` sidecar): treat answer-driven runner ACTIONS
(merge/land, and the sibling stuck-lock requeue) as a DISTINCT dispatch layer,
keyed off the surfaced question's identity + the human's plain answer, rather than
forcing `merge` into the `decide()` content-outcome union. Resolve consistently
with that PRD's two open cross-cutting questions (sidecar→branch/lock-ref keying;
questions-folder shape).

## How it surfaced

While retiring the disposition vocabulary and then test-rebuilding the existing
question sidecars (delete sidecar → let the advance `surface` rung regenerate),
the surface agent re-grounded the `apply-rung-merge-disposition` sidecar against
current code and emitted a blocking "this task's premise appears STALE" question
(REVIEW-PROTOCOL lens 1 + 4c), naming `merge-question-surfacer` as carrying the
same premise. Verified by reading both task bodies directly.

## Suggested next step

Re-task `land-time-reverify-and-parallel-merge-ceiling` (it is in `prds/tasked/`,
so this is a re-open/re-decompose) against the new model BEFORE any of its
merge-question tasks are built. Until then these tasks should not be promoted to
the build pool.
