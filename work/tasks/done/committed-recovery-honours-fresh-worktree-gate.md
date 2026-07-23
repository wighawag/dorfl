---
title: 'committed-recovery tail honours freshWorktreeGate (rebase → fresh re-verify → integrate)'
slug: committed-recovery-honours-fresh-worktree-gate
spec: land-time-reverify-and-parallel-merge-ceiling
needsAnswers: false
blockedBy: [gate-on-rebased-tip-fresh-worktree, recovery-rebase-retry-against-moving-arbiter-main]
covers: [15, 16]
---

## What to build

Make `integration-core.ts`'s `recoverAlreadyCommitted` tail (the
`committedRecovery: true` path of `performIntegration`) RUN the
fresh-worktree gate on the REBASED tip before it integrates, when
`input.freshWorktreeGate` is set. Today this tail goes straight from
the rebase loop to `ledgerWrite.applyCompleteTransition` and NEVER
calls `runFreshWorktreeGate` — it does not even read
`input.freshWorktreeGate`. Its JSDoc says so deliberately ("the prior
attempt already gated"; "steps 1–3 are SKIPPED... runs ONLY the
rebase→integrate TAIL").

This was correct for the ORIGINAL caller of this tail (a stranded
already-built branch recovered by `complete --integration`, whose
pre-strand build already gated). It is NOT correct for the answered-
merge land (`apply-rung-merge-disposition`), which reuses this exact
committed-recovery shape (the work branch already carries its done-move
commit, so the build path's `git mv`/`git add -A`/commit would raise
`IntegrationNothingStaged`) but where `main` may have MOVED since the
branch's last build, so the rebased tip MUST be re-verified before it
lands. Without this, the SPEC's load-bearing invariant ("main never
receives a tree that fails verify"; the clean-rebase-but-broken merge
is refused) cannot hold on the merge path.

So: thread `freshWorktreeGate` into `recoverAlreadyCommitted` and, when
set (and not `skipVerify`), after the rebase loop succeeds and BEFORE
`applyCompleteTransition`, run the EXISTING `runFreshWorktreeGate` on
the rebased `HEAD`. On GREEN, integrate as today. On RED, do NOT
integrate: return the gate's blocking outcome (route to
needs-attention / surface), mirroring the build path's
`freshWorktreeGate && !skipVerify && !lifecycle` branch. Reuse the
existing `runFreshWorktreeGate` helper and the existing blocking-route
shape — do NOT fork a second gate or a second integrate primitive.

This is a CONTRACT CHANGE to a sibling module (`integration-core.ts`)
that other callers depend on, deliberately carved OUT of
`apply-rung-merge-disposition` so the dispatch task stays small and so
this composition decision is reviewed on its own. The default (no
`freshWorktreeGate` passed) MUST stay byte-identical to today: the
stranded-recovery caller that already gated keeps skipping the gate.

## Acceptance criteria

- [ ] `recoverAlreadyCommitted` accepts `freshWorktreeGate` and, when
      `true` and not `skipVerify`, runs `runFreshWorktreeGate` on the
      rebased tip AFTER the rebase loop, BEFORE
      `applyCompleteTransition`.
- [ ] GREEN gate → integrate (unchanged behaviour from there on).
- [ ] RED gate → NO integrate; returns the blocking outcome that routes
      to needs-attention / surface (same shape as the build path's
      fresh-gate refusal). `main` never receives the failing tree.
- [ ] When `freshWorktreeGate` is NOT passed, behaviour is
      byte-identical to today (the stranded-recovery caller is
      unaffected): no extra gate, no extra fetch.
- [ ] `performIntegration` threads `input.freshWorktreeGate` into the
      `committedRecovery` branch (today it is dropped there).
- [ ] Tests cover: committed-recovery with `freshWorktreeGate` +
      moved-main-that-breaks (RED → refusal, nothing on main);
      committed-recovery with `freshWorktreeGate` + clean (GREEN →
      lands); committed-recovery WITHOUT `freshWorktreeGate`
      (regression: unchanged, still skips the gate).
- [ ] Tests isolate global locations.
- [ ] Acceptance gate green.

## Blocked by

- `gate-on-rebased-tip-fresh-worktree` — supplies `runFreshWorktreeGate`
  and the rebased-tip gate composition this task reuses.
- `recovery-rebase-retry-against-moving-arbiter-main` — owns the
  `recoverAlreadyCommitted` rebase-retry loop this task inserts the gate
  AFTER; serialise by file to avoid conflicts (both edit the same tail).

## Prompt

> Read the `recoverAlreadyCommitted` function and the build path's
> `freshWorktreeGate && !input.skipVerify && !lifecycle` branch in
> `packages/dorfl/src/integration-core.ts`, and the ADR/SPEC invariant
> ("main never receives a tree that fails verify"). Thread
> `freshWorktreeGate` into `recoverAlreadyCommitted`; when set and not
> `skipVerify`, run the EXISTING `runFreshWorktreeGate` on the rebased
> tip after the rebase loop and before `applyCompleteTransition`,
> routing a RED gate to the same blocking outcome the build path uses
> (no integrate). Do NOT fork a second gate or a second integrate
> primitive; do NOT change behaviour when `freshWorktreeGate` is unset
> (the stranded-recovery caller must stay byte-identical). Tests must
> assert on external behaviour (what lands on main vs. routes to
> needs-attention, that verify ran on the rebased tip). Run the
> AGENTS.md acceptance gate.

## Requeue 2026-06-26

stuck: acceptance gate exit 1 on rebased tip (18:42Z); no work branch on origin; reset+requeued for fresh claim
