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
