---
title: Add a `resolveReset` flag on the apply `resolve` verdict that discards the work branch (requeue --reset)
slug: apply-resolve-reset-flag-discards-work-branch
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: [bounce-surfaces-stuck-sidecar-and-releases-lock, apply-disposition-delete-to-dispose-regime-polymorphic, empty-diff-bounce-surfaces-dispose-defaulted-question, bounce-migrate-stuck-assertions-and-flip-exit-codes]
covers: [2]
---

## Re-scope 2026-07-13 (after a Gate-2 BLOCK on the first attempt)

The first build wired `resolveReset` into `applyAgenticDecision` (advance.ts), but that function runs ONLY for `namespace === 'observation'` (advance.ts ~line 1044: `runAgenticDecision = input.namespace === 'observation' && ...`). TASK/SPEC items DELIBERATELY skip the agentic decider and fall through to `applyAnsweredQuestions` (the simple persist), which has NO `resolve`-verdict dispatch. So the flag was UNREACHABLE for its actual target (a bounced TASK with a `work/<slug>` branch) and a permanent no-op on the only path it reached (observations have no `work/observation-<slug>` branch). Gate 2 blocked it (round-1 approve, round-2 block — corroboration caught a dead mechanism). Two fixes, both required:

1. **DISPATCH SITE (decided): the TASK apply-persist path, NOT the agentic decider.** Wire the `resolveReset` honouring into the TASK/SPEC persist path (`applyAnsweredQuestions` / a small branch in `performApply` BEFORE the fall-through persist) so a bounced TASK's answered `resolve` + `resolveReset:true` reaches the branch-delete. Do NOT widen the observation-only `runAgenticDecision` gate to tasks/specs — that changes how EVERY task apply-answer dispatches (a much bigger blast radius) and is explicitly out of scope here. The mechanism the first attempt built is REUSABLE AS-IS: the `resolveReset?: boolean` parser field on `DecisionVerdict` and the extracted shared `deleteRemoteWorkBranchIfPresent` primitive (`needs-attention.ts`) are correct — only the DISPATCH SITE was wrong. Keep them; move the dispatch to the task path.
2. **DEPENDENCY (added): blocks on `bounce-migrate-stuck-assertions-and-flip-exit-codes` (PR-2b).** This task is only END-TO-END testable once bounced TASKS actually surface as `needsAnswers:true` questions with an answered sidecar — which is exactly what PR-2b delivers (re-pointing the bounce seams to surface). Before PR-2b there is no bounced-task-with-answered-sidecar to drive the reset through, which is why the first attempt could only assert against a spy. Building AFTER PR-2b lets the acceptance test route a REAL task through the reset path end-to-end.

## What to build

Give the apply rung a way to dispatch the "discard the work-in-progress and rebuild from clean" answer (`requeue --reset`) for a surfaced/bounced item, WITHOUT adding a new decision outcome.

Add an OPTIONAL flag channel to the apply verdict (e.g. `resolveReset?: boolean`, the sibling of the existing `resolveReason?`) on the EXISTING `resolve` outcome. The `DecisionVerdict` is already a discriminated union carrying per-outcome optional channels, so this fits with NO new discriminator to thread through every switch:

- `resolve` with NO flag = today's continue-from-WIP (clear `needsAnswers`, leave the `work/<slug>` branch untouched so the next claim continues from its tip). Unchanged.
- `resolve` with `resolveReset: true` = dispatch the `requeue --reset` branch-delete (delete the remote `work/<slug>` branch FIRST) BEFORE clearing `needsAnswers`, so the next claim starts fresh.

The flag is NATURALLY SCOPED: it only means anything for a TASK with a pre-existing `work/<slug>` branch. It MUST be safely IGNORED (a no-op) when no such branch exists (an observation, or a task never built) — so it can never error; it just discards-if-present.

So the surfaced-item answer vocabulary becomes: continue → `resolve` (no flag); reset/retry-fresh → `resolve` + `resolveReset:true`; cancel → `dispose` (from the sibling task). Thin vertical: the verdict channel + its parser, the apply-rung wiring to the existing `requeue --reset` branch-delete, and tests.

**DISPATCH SITE (see the Re-scope above): the TASK apply path (`applyAnsweredQuestions` / the persist fall-through in `performApply`), NOT the observation-only agentic decider.** Reuse the already-built `resolveReset?: boolean` parser field + the shared `deleteRemoteWorkBranchIfPresent` primitive; only the dispatch site moves. Do NOT widen `runAgenticDecision` (the `namespace === 'observation'` gate) to tasks.

## Acceptance criteria

- [ ] The apply verdict shape carries an optional `resolveReset` boolean (parsed alongside `resolveReason`); the outcome union is UNCHANGED (no new outcome added).
- [ ] `resolve` + `resolveReset:true` deletes the remote `work/<slug>` branch (via the existing `requeue --reset` mechanism) and THEN clears `needsAnswers`; `resolve` without the flag leaves the branch untouched (today's behaviour).
- [ ] The flag is safely IGNORED (no error, no-op) when the item has no `work/<slug>` branch (observation, or task never built).
- [ ] Tests cover: reset-with-branch deletes the branch then clears needsAnswers; resolve-without-flag leaves the branch; reset-without-a-branch is a harmless no-op — mirroring the existing apply/requeue test style.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `bounce-surfaces-stuck-sidecar-and-releases-lock` — the surfaced bounced item is what a reset answer acts on.
- `apply-disposition-delete-to-dispose-regime-polymorphic` — touches the SAME decision-verdict shape / apply dispatch; serialised to avoid a merge conflict on that module.
- `empty-diff-bounce-surfaces-dispose-defaulted-question` — ALSO edits the `advance.ts` apply-rung dispatch (the `verdict.outcome` switch); serialised after it so the two apply-dispatch edits do not collide (TASKING-PROTOCOL §3 file-orthogonality). No logical dependency, purely merge-conflict avoidance.
- `bounce-migrate-stuck-assertions-and-flip-exit-codes` (PR-2b) — LOGICAL dependency (added 2026-07-13, see the Re-scope): a bounced TASK only surfaces as a `needsAnswers:true` question with an answered sidecar ONCE PR-2b re-points the bounce seams to surface. Without it there is no real task-with-answered-sidecar to drive the reset end-to-end, which is why the first attempt could only spy. Build after PR-2b.

## Prompt

> Goal: let an apply answer dispatch `requeue --reset` (discard the WIP branch, rebuild clean) via an OPTIONAL `resolveReset` flag on the existing `resolve` outcome — no new decision outcome. Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (user story 2, resolved decision #6).
>
> FIRST, drift-check: confirm the apply verdict is still a discriminated `DecisionVerdict` with per-outcome optional channels (e.g. `resolveReason?`), that `resolve` still means "clear needsAnswers, branch untouched", and that a `requeue --reset` CLI path exists that deletes the remote `work/<slug>` branch first then releases. If any changed, route to needs-attention with the discrepancy.
>
> Domain vocabulary: `resolve` = the apply outcome that harvests answers into the body, clears `needsAnswers`, deletes the sidecar, and leaves the `work/<slug>` branch alone (continue-from-WIP). `requeue --reset` = the CLI recovery mode that DELETES the remote `work/<slug>` branch FIRST (then releases) so the next claim starts FRESH; default `requeue` keeps the branch (continue). The `DecisionVerdict` already carries optional per-outcome channels (a `resolve` fills `resolveReason`) — add `resolveReset` the same way; the engine guards only the `outcome` discriminator, never the content.
>
> Where to look (by concept): the decision-verdict shape + its parser (where `resolveReason` lives); the apply-rung dispatch of the `resolve` outcome (the resolve-fully path); the `requeue --reset` branch-delete mechanism to reuse. Seams to test at: inject a `resolve` verdict with `resolveReset:true` for a task WITH a work branch and assert the branch is deleted then needsAnswers cleared; without the flag assert the branch survives; with the flag but NO branch assert a harmless no-op.
>
> Do NOT add a new decision outcome — the flag on `resolve` IS the decision. Ensure the reset path reuses the SAME branch-delete the `requeue --reset` verb uses (do not re-implement branch deletion). Done = the flag works and is safely ignorable, tests cover all three cases, gate green. RECORD any non-obvious in-scope decision (e.g. ordering of branch-delete vs needsAnswers-clear on a partial failure) durably, linked from the done record.

## Requeue 2026-07-13

Requeued after Gate-2 block + re-scope. --reset: the first attempt wired resolveReset into the observation-only agentic decider (dead for tasks); the corrected body dispatches on the TASK apply path and now blocks on PR-2b (bounce-migrate) so it is built when bounced tasks actually surface as questions. Discard the wrong-scoped WIP; rebuild fresh.
