---
title: 'requeue --reset and --reconcile must work on a surfaced item whose lock the surface already released'
slug: requeue-reset-and-reconcile-work-after-the-lock-was-released
blockedBy: []
---

## What to build

During the CI-split drive, `ci-split-landed-vs-gated-report` was surfaced to needs-attention (a continue rebase conflict). The surface released its per-item lock, as surfaces now do, which left no dorfl way to recover it: `dorfl requeue --reconcile <slug>` and `dorfl requeue --reset <slug>` both refused with "has no held per-item lock on origin" (nothing to requeue). The conductor had to delete the remote `work/task-<slug>` branch by hand (with the human's authorisation) to get the `--reset` effect.

A surfaced item with a kept work branch is exactly what `--reconcile` (non-destructive re-sync and retry) and `--reset` (discard the branch, start fresh) exist for. Make both work when the lock is already released: act on the kept branch and the item's sidecar, take whatever short lock the operation needs, and keep `--reset` destructive-only-on-explicit-request exactly as today. Plain `requeue` (keep and continue) on a released lock can stay a no-op with a clear message, since the next claim already continues from the kept branch.

## Acceptance criteria

- [ ] `requeue --reset <slug>` on a surfaced item with a released lock deletes the kept remote branch and leaves the item claimable from scratch (tested against a bare arbiter).
- [ ] `requeue --reconcile <slug>` on the same state re-syncs and retries the rebase without discarding work (tested).
- [ ] The refusal message for a truly unknown slug is unchanged.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: close the recovery gap where a surfaced task (lock already released by the surface) cannot be reset or reconciled through dorfl. Read the requeue implementation in `packages/dorfl/src/needs-attention.ts` (the 'has no held per-item lock' refusal and `attemptReconcile`), the surface path's lock release, and the CLI `requeue` command. Test against a local bare arbiter like the existing requeue tests.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **What counts as recoverable without a held lock: the body is in the pool or staging on `<arbiter>/main` and the kept branch is on the arbiter. The question sidecar is not required.** Why: a plain requeue that already released the lock leaves the same shape, and `--reset` or `--reconcile` should work there too. An unknown slug has no body, and a pooled item with no branch has nothing to reset or reconcile, so both keep the old refusal. The alternative was to require the sidecar, which is narrower and would leave the plain-requeue case with the same gap. Touches: `requeue` only.
- **The short lock is taken with action `implement` (the work-branch action), create-only, like a claim. If someone else holds it, requeue refuses without changing anything.** Why: it stops a concurrent claim from continuing from a branch while it is being deleted or rebased. The alternative was to take no lock, which leaves that race open. Touches: per-item lock refs, which are briefly held by the requeuer's identity.
- **Requeue never touches the question sidecar or `needsAnswers`.** Why: answering or clearing a surfaced question belongs to the answer and apply path (for example the apply-rung `reset` answer). Clearing it from requeue would add a second way to resolve questions. The effect is that after `--reset` the item is claimable from scratch by a human (`do`/`start` only warns about `needsAnswers`). An autonomous runner still won't pick it until the question is answered. The alternative was to have `--reset` also resolve the stuck question. Touches: the `apply` stuck and reset flow, and whether autonomous runners can pick the item.
- **Plain `requeue` on a released item with a kept branch keeps the existing refusal and adds a note after it.** Why: existing tests and callers match `/no held per-item lock/`, and the task allows it to stay a no-op with a clear message. Touches: the `requeue` output only.
