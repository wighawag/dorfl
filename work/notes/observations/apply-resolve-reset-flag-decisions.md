# Decisions: `apply-resolve-reset-flag-discards-work-branch`

Date: 2026-07-14
Task: `work/tasks/ready/apply-resolve-reset-flag-discards-work-branch.md`
Files touched: `packages/dorfl/src/apply-stuck-action.ts` (new),
`packages/dorfl/src/needs-attention.ts` (extracted primitive),
`packages/dorfl/src/advance.ts` (dispatch wiring),
`packages/dorfl/test/apply-rung-stuck-action.test.ts` (new).

Recorded here so the done record has a discoverable home for the non-obvious
in-scope decisions (per the task prompt's instructions). Every decision below
is also duplicated as JSDoc at the choice site.

## 1. Concept spelling on the TASK path: deterministic `keep | reset | cancel` verbs, not a `resolveReset` verdict channel

The task's original prompt spoke of an optional `resolveReset:boolean` flag on
a `DecisionVerdict.resolve` outcome. The TASK apply-persist path never sees a
`DecisionVerdict` — the shared `decide()` engine is gated to
`namespace === 'observation'`, and the task body's `## Re-scope 2026-07-14`
explicitly forbids widening that gate. So the deterministic dispatcher is the
load-bearing shape here. The verb vocabulary lives in `apply-stuck-action.ts`
(`StuckActionVerb = 'keep' | 'reset' | 'cancel'`), mirroring
`apply-merge-action.ts` byte-for-byte (`parseStuckAnswer` mirrors
`parseMergeAnswer`; `detectAnsweredStuckAction` mirrors
`detectAnsweredMergeAction`; `maybeRunStuckAction` in `advance.ts` mirrors
`maybeRunMergeAction`).

Touches: `apply-stuck-action.ts`, `advance.ts` (new `stuckAction?` seam on
`AdvanceContext`). No new decision outcome; no widened
`runAgenticDecision` gate.

Alternative considered: a new `DecisionOutcome = 'resolve-reset'` — REJECTED
(the prompt explicitly says no new outcome; the flag-on-`resolve` shape is
the design on the observation path, and this task delivers the equivalent
mechanism on the TASK path as a sibling deterministic dispatcher).

## 2. Delete-before-clear ordering; a real push-delete failure REFUSES the whole apply

On `verb=reset`, the shared `deleteRemoteWorkBranchIfPresent` primitive fires
BEFORE the fall-through `applyAnsweredQuestions` clears `needsAnswers`. On a
partial failure (arbiter delete fails after the local tracking ref was
already cleared by the write-through ordering), `maybeRunStuckAction`
SHORT-CIRCUITS with `exitCode:1 outcome:'usage-error'`, leaves the sidecar
in place, and does NOT clear `needsAnswers`. The human sees the failure and
re-answers.

Alternative considered: clear-then-delete, or clear-anyway on a failed
delete — REJECTED because it would leave the item `needsAnswers:false` and
CLAIMABLE while still carrying the WIP branch we meant to discard — exactly
the stale-continue trap the `requeue --reset` code path in `needs-attention.ts`
spends a page of comment defending against. The two callers (this verb +
`requeue --reset`) MUST stay behaviourally identical.

`status: 'already-gone'` is tolerated as an idempotent no-op so the verb is
safely ignorable on an item with no work branch (an observation, or a task
never built) — that is the third acceptance case.

This introduces a NEW user-visible refusal shape on the apply-resolve path
(`exitCode:1 outcome:'usage-error'` when the arbiter push fails on a genuine
error). Documented in the `apply-stuck-action.ts` module JSDoc as the
intended contract, and asserted in the `refused` stub test.

Touches: `apply-stuck-action.ts`'s `performStuckAction` + `advance.ts`'s
`maybeRunStuckAction`.

## 3. `cancel` routes through the EXISTING `dispose` terminal

The `verb=cancel` case sets `applyOptions.dispose = {reason:
entry.answer.trim()}` on the fall-through persist so a bounced task answered
`cancel` `git mv`-s to `tasks/cancelled/` via the same regime-polymorphic
dispose path the agentic `dispose` verdict uses on the observation path.
Zero new terminal state. The human's answer text (verbatim) is the recorded
reason on the moved body's frontmatter.

## 4. Shared branch-delete primitive extracted from `needs-attention.ts`

`deleteRemoteWorkBranchIfPresent` is the SAME local-first write-through
delete the `requeue --reset` path already runs (the extraction refactored
`returnToBacklog`'s reset branch to call it, so the two callers cannot
drift). The primitive returns a discriminated status
(`deleted | already-gone | failed`) so each caller composes its own
context-specific error message but the ordering + already-gone tolerance
stays byte-identical.

Alternative considered: re-implement the three-step delete inside
`apply-stuck-action.ts` — REJECTED per the task's explicit
"reuse the SAME branch-delete" rule.
