---
title: 'The advancing-lock create path still retries a refused main push as contention'
type: observation
status: spotted
spotted: 2026-10-29
---

The ledger write seam now distinguishes a REFUSED `main` push (the remote declined it and `main` did not move, e.g. a protected branch) from a lost race: `applyTransition` returns `kind: 'refused'` with the remote's error text (`packages/dorfl/src/ledger-write.ts`, `classifyFailedPush`). The tree-less move loop in `needs-attention.ts` (`runTreelessLedgerMove`) stops on it and reports it, which fixed `requeue -m` on a protected `main` (ADR `requeue-note-falls-back-to-the-kept-branch-when-main-refuses`).

The advancing-lock create attempt in `packages/dorfl/src/advancing-lock.ts` (the `ledgerWrite.applyTransition` call with `kind: 'advancing'`, near the end of the create attempt) still maps every non-`published` result to `{kind: 'rejected'}`, so `runCasContentionLoop` retries a refusal up to its budget, printing the "main advanced under us" retry line on each attempt and finally "main is contended". On a protected `main` that is the same misreport the requeue had: nothing moved, the remote refused the write. `CasAttemptResult` and `CasContentionLoopResult` have no refused kind, so fixing it means adding one and deciding how `advance` surfaces it (its outcome union has `contended` and `lost`).

Why it matters: an operator on a protected `main` is told to "try again shortly" for a write that will never succeed.
