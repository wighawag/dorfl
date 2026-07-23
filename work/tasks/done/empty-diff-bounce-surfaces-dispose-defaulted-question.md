---
title: 'An empty-diff / "nothing to do" bounce surfaces a dispose-defaulted (cancel-to-terminal) question'
slug: empty-diff-bounce-surfaces-dispose-defaulted-question
spec: surface-stuck-as-questions-and-retire-stuck-lock-state
blockedBy: [bounce-surfaces-stuck-sidecar-and-releases-lock, apply-disposition-delete-to-dispose-regime-polymorphic]
covers: [7]
---

## What to build

Handle the "empty diff / produced no change" bounce specially. Because "nothing to do" is a NON-DETERMINISTIC LLM judgement (not ground truth), a blind requeue would INFINITE-LOOP: the next leg re-runs, re-judges "nothing to do", re-bounces, forever.

So an empty-diff bounce ALSO surfaces a sidecar (via the surface-on-bounce transition from the keystone task), but with a DISPOSE-DEFAULTED question — of the shape *"`<slug>`: the agent produced no change (`<reason>`). Cancel this item? [default: yes]"* with `needsAnswers:true`. "Cancel" here dispatches the `dispose` outcome (regime-polymorphic — for a task it is a `git mv → tasks/cancelled/`, RETAINED), NOT a hard delete and NOT a requeue.

The engine GUARANTEES the ENVELOPE + the safe DEFAULT (there is always at least a dispose/cancel disposition question defaulting to cancel-to-terminal); the LLM owns the prose/context. This (a) breaks the requeue loop, (b) preserves the context (why the agent saw nothing to do), (c) gives the human a one-glance confirm/override, (d) unifies "nothing to do" into the same sidecar mechanism.

Thin vertical: the empty-diff classification at the bounce path → the dispose-defaulted question envelope → the apply wiring so an answered "cancel" reaches the `dispose` outcome → a loop-safety test.

## Acceptance criteria

- [ ] An empty-diff / no-source-change bounce surfaces a sidecar whose disposition question DEFAULTS to dispose/cancel-to-terminal (not requeue), distinct from a requeue-defaulted needs-attention bounce.
- [ ] Answering "cancel" dispatches the `dispose` outcome (a TASK → `git mv tasks/cancelled/`, retained; NOT a `git rm`).
- [ ] The requeue loop is broken: a second no-change leg on the same item RE-SURFACES the same dispose question rather than blindly re-queuing (assert no infinite re-queue).
- [ ] The engine guarantees at least one dispose-defaulted disposition question exists for the empty-diff case even if the agent surfaced no questions of its own.
- [ ] Tests cover the empty-diff classification, the dispose-default, and the no-infinite-loop property, mirroring the existing bounce/apply test style.
- [ ] Acceptance gate green: `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- `bounce-surfaces-stuck-sidecar-and-releases-lock` — provides the surface-on-bounce transition this rides.
- `apply-disposition-delete-to-dispose-regime-polymorphic` — provides the `dispose` outcome the "cancel" answer dispatches.

## Prompt

> Goal: make the "empty diff / nothing to do" bounce surface a DISPOSE-DEFAULTED (cancel-to-terminal) question instead of a blind requeue, so a non-deterministic "nothing to do" verdict can never infinite-loop. Per the spec `surface-stuck-as-questions-and-retire-stuck-lock-state` (user story 7, resolved decision #2 empty-diff half).
>
> FIRST, drift-check: confirm the two blocking tasks landed as assumed — the bounce now SURFACES a sidecar + releases the lock (`bounce-surfaces-stuck-sidecar-and-releases-lock`), and the apply disposition is the regime-polymorphic `dispose` (`apply-disposition-delete-to-dispose-regime-polymorphic`). If either landed differently, route to needs-attention with the discrepancy.
>
> Domain vocabulary: an empty-diff bounce today is detected as "the agent produced no source change vs the arbiter main" (a no-op/stop). `dispose` is the regime-polymorphic disposition (task → `git mv tasks/cancelled/` retained; observation → `git rm`; spec → `git mv specs/dropped/`). A sidecar question may carry a suggested `default` (the humility aid the surface machinery already supports). "Envelope + default owned by the engine, prose owned by the LLM": the engine guarantees the dispose-defaulted question exists; the agent writes the context.
>
> Where to look (by concept): the empty-diff / no-change detection at the bounce path (the empty-diff stop reason); the surface-on-bounce transition (from the keystone task) that writes the sidecar; the sidecar entry's `default` field; the apply-rung dispatch to the `dispose` outcome. Seams to test at: drive an empty-diff bounce and assert the surfaced question defaults to dispose/cancel; drive a SECOND no-change leg and assert it re-surfaces rather than re-queuing (the anti-infinite-loop property); answer "cancel" and assert the task moves to `tasks/cancelled/`.
>
> Done = empty-diff bounces surface a dispose-defaulted question, "cancel" reaches `dispose` (task→cancelled/), the requeue loop is provably broken, and the acceptance gate is green. RECORD any non-obvious in-scope decision (e.g. exactly how "empty-diff" is distinguished from a reason-carrying bounce at the classification point) durably, linked from the done record.
