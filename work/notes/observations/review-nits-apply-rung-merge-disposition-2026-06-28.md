---
title: review-gate non-blocking nits for 'apply-rung-merge-disposition' (Gate 2 approve)
date: 2026-06-28
status: open
reviewOf: apply-rung-merge-disposition
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'apply-rung-merge-disposition' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: the restale re-surface APPENDS a new follow-up `kind: merge` question (via the existing `appendQuestions` seam in apply-persist) instead of CLEARING the prior `answer=merge` on the original entry. q1's applied answer literally said 'clears the answer back to no-answer and re-surfaces'. The append shape is a reasonable reinterpretation (it reuses the canonical re-pause seam and keeps history), but it means a future apply run will still see the OLD answered `kind:merge` entry first in `detectAnsweredMergeAction` (which returns the FIRST answered merge entry) — so the re-stale check runs against the stale answer again, not the human's fresh follow-up. Worth ratifying or switching to clear-the-answer semantics.
  (apply-merge-action.ts detectAnsweredMergeAction loops entries and returns first match; advance.ts maybeRunMergeAction restale branch uses appendQuestions with kind:merge.)
- Ratify: a `refused` merge-action is mapped to `{exitCode:1, outcome:'usage-error'}` on the rung. `performIntegration` already routed the bounce to needs-attention via its shared seam, so the usage-error shape is purely the rung-level signal — but 'usage-error' is a slightly odd label for 'red re-verify on rebased tip refused the land'. Confirm this matches the convention other rungs use for performIntegration-routed refusals, or rename to a more accurate outcome.
  (advance.ts maybeRunMergeAction returns outcome:'usage-error' on result.outcome==='refused'.)
- Ratify: the workspacesDir guard (clean refusal when workspacesDir is unset AND no test mergeAction is injected) is a new user-visible error path the task spec did not name explicitly. It is defensive and correct, but record it as a decision so a future caller that forgets to thread workspacesDir gets the documented refusal instead of a silent skip.
  (advance.ts maybeRunMergeAction: workspacesDir===undefined && mergeAction===undefined ⇒ usage-error with explanatory message.)
- Ratify: createJob is called with hard-coded `type: 'task'`. If a `kind: merge` sidecar is ever stamped on a non-task item (e.g. a prd-level unmerged branch), the branch name `work/task-<slug>` will not match. Today the surfacer only emits merge-questions for tasks, but flag the assumption so a future surfacer change does not silently mis-target.
  (apply-merge-action.ts performMergeAction: createJob({slug, type:'task', ...}).)
