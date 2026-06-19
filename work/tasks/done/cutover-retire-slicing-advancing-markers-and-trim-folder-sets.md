---
title: Cut-over 9c — retire the slicing/advancing markers + trim the status folder sets
slug: cutover-retire-slicing-advancing-markers-and-trim-folder-sets
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [cutover-claim-body-stays-and-complete-sources-from-backlog, cutover-needs-attention-becomes-lock-stuck-recovery-surface]
covers: [5, 7]
---

> **This is sub-slice 9c of the capstone re-slice (decided conductor + human, 2026-06-18).**

## What to build

With claim's body move gone (9a) and `needs-attention` now the lock `stuck` state
(9b), remove the remaining legacy transient WRITES — the `slicing/` and `advancing/`
markers — and TRIM the status folder sets to the durable set only. After this slice,
`main`'s ONLY `work/` moves are the three durable resting transitions
(`backlog → done`, `prd → prd-sliced`, `backlog → dropped`).

- **Slicing:** remove `acquireSlicingLock`'s `git mv prd→slicing` marker CAS and the
  abort `slicing/ → prd/` bounce (`slicing-acquires-unified-lock` already added the
  unified `action: slice` lock + keeps the durable `prd → prd-sliced` success move —
  only the transient marker goes). The unified lock is the sole slicing exclusion.
- **Advancing:** remove `acquireAdvancingLock`'s `work/advancing/<entry>.md` marker
  CAS (`advancing-acquires-unified-lock` already added the unified `action: advance`
  lock for the tree-less rungs; the build/slice rungs rely on the inner `do`'s lock).
  The unified lock is the sole advancing exclusion.
- **Folder sets:** remove `in-progress`, `needs-attention`, `slicing`, `advancing`
  from `LEDGER_STATUS_FOLDERS` (`ledger-lint.ts`) and `WORK_FOLDERS`
  (`ledger-write.ts`) and the private `integration-core.ts` set, keeping the durable
  set: `backlog`/`done`/`dropped` for slices, `prd`/`prd-sliced` for PRDs. (`backlog`
  STAYS the pool — the `backlog → todo` rename is the deferred STEP-B PRD, NOT this
  work.) Retarget any remaining `slicing/`/`advancing/` reader (`advance.ts`,
  `slicing.ts`, `review-gate.ts`, `cli.ts`) onto the lock.

> POST-#9 EXCLUSION PROOF (carried from the original #9, owned here because this is
> where the advancing marker is removed): with the advancing marker gone, the
> build-slice/slice-prd advance rungs are guarded SOLELY by the inner `do`'s
> claim/slice unified lock (they never took the unified lock at the advance layer,
> per `advancing-acquires-unified-lock` option a). PROVE (test) that advance∥claim and
> advance∥slice on a build-slice/slice-prd item remain mutually exclusive through the
> inner `do`'s lock ALONE, and that the brief advance-layer TOCTOU (two advancers both
> classifying the item as build/slice before the inner `do`) resolves to exactly one
> winner at the inner lock.

## Acceptance criteria

- [ ] Slicing no longer writes the `slicing/` marker (nor the abort bounce); the
      unified `action: slice` lock is the sole exclusion; the durable `prd →
      prd-sliced` success move is unchanged.
- [ ] Advancing no longer writes the `work/advancing/<entry>.md` marker; the unified
      `action: advance` lock (tree-less rungs) + the inner `do` lock (build/slice
      rungs) are the sole exclusion.
- [ ] `in-progress`/`needs-attention`/`slicing`/`advancing` are removed from
      `LEDGER_STATUS_FOLDERS` / `WORK_FOLDERS` / the integration-core set; the durable
      set remains (`backlog`/`done`/`dropped`; `prd`/`prd-sliced`). No
      `slicing/`/`advancing/` folder read remains anywhere.
- [ ] `main`'s only `work/` moves are the three durable resting transitions; nothing
      writes the retired folders anywhere in the runner.
- [ ] Post-#9 exclusion proof: advance∥claim and advance∥slice on a build/slice item
      stay mutually exclusive via the inner `do`'s lock alone (advancing marker gone);
      the advance-layer TOCTOU resolves to one winner at the inner lock (tested).
- [ ] Every existing slicing/advance/integration/scan test passes, retargeted off the
      retired folders.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `cutover-claim-body-stays-and-complete-sources-from-backlog` (9a — `in-progress`
  consumers already moved off it).
- `cutover-needs-attention-becomes-lock-stuck-recovery-surface` (9b — `needs-attention`
  consumers already moved off the folder, so trimming the sets is safe).

## Prompt

> Remove the last legacy transient WRITES and trim the folder sets. 9a removed claim's
> body move; 9b moved `needs-attention` onto the lock `stuck` state. Now remove
> slicing's `git mv prd→slicing` marker + abort bounce (`slicing-lock.ts` —
> `slicing-acquires-unified-lock` already added the unified `action: slice` lock and
> keeps the durable `prd → prd-sliced` success move; only the transient marker goes),
> and advancing's `work/advancing/<entry>.md` marker CAS (`advancing-lock.ts` —
> `advancing-acquires-unified-lock` already added the unified lock for tree-less
> rungs). Then remove `in-progress`/`needs-attention`/`slicing`/`advancing` from
> `LEDGER_STATUS_FOLDERS` (`ledger-lint.ts`), `WORK_FOLDERS` (`ledger-write.ts`), and
> the private `integration-core.ts` set, keeping the durable set
> (`backlog`/`done`/`dropped`; `prd`/`prd-sliced`). Retarget any remaining
> `slicing/`/`advancing/` reader (`advance.ts`, `slicing.ts`, `review-gate.ts`,
> `cli.ts`). PRD US #5, #7; ADR `docs/adr/ledger-status-on-per-item-lock-refs.md`.
>
> `backlog` STAYS the pool (the `backlog → todo` rename is the deferred STEP-B PRD; do
> NOT introduce `todo/`). Do NOT delete `drop-bookkeeping-rebase` (9d) — but after
> this slice no transient status lands on a branch, which is what MAKES 9d possible.
>
> Carry the POST-#9 EXCLUSION PROOF (this is where the advancing marker is removed):
> prove (test) that advance∥claim and advance∥slice on a build-slice/slice-prd item
> stay mutually exclusive through the inner `do`'s unified lock ALONE (the build/slice
> rungs never took the unified lock at the advance layer), and that the advance-layer
> TOCTOU resolves to one winner at the inner lock. Register any new git-`file://`-CAS
> race test in `vitest.config.ts` `RACE_SENSITIVE`. "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. Record non-obvious in-scope decisions per the slice template.
