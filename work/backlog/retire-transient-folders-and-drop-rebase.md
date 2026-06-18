---
title: Retire the transient folders + remove drop-bookkeeping-rebase
slug: retire-transient-folders-and-drop-rebase
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [claim-acquires-unified-lock-no-body-move, slicing-acquires-unified-lock, advancing-acquires-unified-lock, needs-attention-as-stuck-lock-state, complete-lock-then-durable-main-move-crash-safe]
covers: [5, 6, 7]
---

## What to build

The capstone. Once nothing writes `in-progress`, `needs-attention`, `slicing`, or
`advancing` on `main` (the four retarget slices have landed), RETIRE those transient
folders from the status sets and DELETE the now-dead `drop-bookkeeping-rebase`
module + its call sites. After this slice, `main`'s ONLY `work/` moves are the three
durable resting transitions (`backlog → done`, `prd → prd-sliced`, `backlog →
dropped`), and a work branch cut from `main` inherits NO transient status at all.

Concretely: remove the transient folders from `LEDGER_STATUS_FOLDERS` /
`WORK_FOLDERS` (keeping the durable set `backlog`/`done`/`dropped` for slices and
`prd`/`prd-sliced` for PRDs, note `backlog` stays the pool until the deferred STEP-B
rename); delete `drop-bookkeeping-rebase.ts` and the call sites that referenced it
(the integration rebase and the onboard continue-rebase); and prove a branch
continue/rebase is now a PLAIN rebase with NO drop step and NO rename/rename ledger
conflict (the old `drop-bookkeeping-rebase` tests are removed with the module).

## Acceptance criteria

- [ ] `in-progress`, `needs-attention`, `slicing`, `advancing` are removed from the
      status folder sets; the durable set remains (`backlog`/`done`/`dropped`;
      `prd`/`prd-sliced`).
- [ ] `drop-bookkeeping-rebase.ts` and its call sites are deleted; the integration
      rebase and the onboard continue-rebase no longer reference a drop step.
- [ ] A work branch cut from `main` carries NO transient status; a continue/rebase is
      a PLAIN rebase with no drop step and no rename/rename ledger conflict (tested).
- [ ] `main`'s only `work/` moves are the three durable resting transitions; nothing
      writes the retired folders anywhere in the runner.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- All four retargets + crash-safe complete must land first (they are what stop the
  four transient folders being written): `claim-acquires-unified-lock-no-body-move`,
  `slicing-acquires-unified-lock`, `advancing-acquires-unified-lock`,
  `needs-attention-as-stuck-lock-state`, `complete-lock-then-durable-main-move-crash-safe`.

## Prompt

> The capstone of the lock substrate. Once the four retargets (claim/slice/advance/
> needs-attention) and crash-safe complete have landed, nothing writes the transient
> folders on `main` anymore, so retire them and delete the machinery that only
> existed to mitigate their branch-inheritance. PRD
> `work/prd/ledger-status-per-item-lock-refs.md` (US #5, #6, #7); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`.
>
> Remove `in-progress`/`needs-attention`/`slicing`/`advancing` from the status folder
> sets (`LEDGER_STATUS_FOLDERS` in `ledger-lint.ts`, `WORK_FOLDERS` in
> `ledger-write.ts`), keeping the DURABLE set (`backlog`/`done`/`dropped` for slices,
> `prd`/`prd-sliced` for PRDs). NOTE: `backlog` STAYS the pool here, the
> `backlog → todo` rename is the DEFERRED STEP-B `folder-taxonomy-reorg-and-rename`
> PRD, NOT this work (read the PRD's VOCABULARY CORRECTION banner). DELETE
> `drop-bookkeeping-rebase.ts` and its call sites (the integration rebase and the
> onboard continue-rebase that dropped protocol-bookkeeping commits), they are dead
> because no transient status lands on a branch to conflict. Prove a continue/rebase
> is now a PLAIN rebase with no drop step and no rename/rename ledger conflict; the
> old drop-rebase tests go with the module.
>
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`): a branch cut from
> `main` carries no transient status; a continue is a clean plain rebase. "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. This removal is broad; record non-obvious in-scope decisions per
> the slice template.
