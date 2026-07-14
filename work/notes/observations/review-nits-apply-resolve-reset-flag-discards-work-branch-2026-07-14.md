---
title: review-gate non-blocking nits for 'apply-resolve-reset-flag-discards-work-branch' (Gate 2 approve)
date: 2026-07-14
status: open
reviewOf: apply-resolve-reset-flag-discards-work-branch
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'apply-resolve-reset-flag-discards-work-branch' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify the verb-source deviation from the original prompt: the acceptance criterion literally says 'the apply verdict shape carries an optional resolveReset boolean', but the landed design is a deterministic detectAnsweredStuckAction verb dispatcher (keep|reset|cancel) with NO resolveReset channel on DecisionVerdict. The 2026-07-14 re-scope and the last applied-answer explicitly authorise this pivot (the TASK path never sees a DecisionVerdict, and widening runAgenticDecision was forbidden), and the decisions note ratifies it — flagging so the human confirms the swap is intentional.
  (packages/dorfl/src/apply-stuck-action.ts (new dispatcher); work/notes/observations/apply-resolve-reset-flag-decisions.md §1)
- Ratify the new user-visible refusal shape on the resolve path: a real (non already-gone) push --delete failure on verb=reset short-circuits the apply with exitCode:1 outcome:'usage-error' and leaves the sidecar surfaced. This is a NEW refusal on the apply-resolve leg. Documented in the module JSDoc, mirrors requeue --reset's abort-on-failed-delete contract, asserted in the 'refused' stub test — but it is worth explicit human ratification since the earlier applied-answer flagged 'address the branch-delete-failure refusal shape'.
  (packages/dorfl/src/advance.ts maybeRunStuckAction refused branch; apply-stuck-action.ts module docs; decisions note §2)
- Ratify the un-gated namespace: maybeRunStuckAction runs for ANY namespace on the apply rung (BEFORE the observation-only runAgenticDecision gate), and deleteRemoteWorkBranchIfPresent hardcodes workBranchRef('task', slug). For a hypothetical stuck-answered spec or observation, the reset verb would target work/task-<slug> (harmless already-gone) and cancel would dispose via the polymorphic regime. Currently bounces are task-shaped, so it is fine — but the dispatcher itself is not narrowed to input.namespace==='task', so a future spec/obs bounce would silently take this path.
  (packages/dorfl/src/advance.ts applyRung ~line 1055 (kind-check runs pre-namespace gate); needs-attention.ts deleteRemoteWorkBranchIfPresent hardcodes 'task')
