---
title: Cut-over 9d — delete drop-bookkeeping-rebase; prove a plain rebase (no rename/rename ledger conflict)
slug: cutover-delete-drop-bookkeeping-rebase-and-prove-plain-rebase
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [cutover-claim-body-stays-and-complete-sources-from-backlog, cutover-needs-attention-becomes-lock-stuck-recovery-surface, cutover-retire-slicing-advancing-markers-and-trim-folder-sets]
covers: [6]
---

> **This is sub-slice 9d of the capstone re-slice (decided conductor + human, 2026-06-18),
> the final piece.**

## What to build

Once NO transient status lands on a work branch (9a removed claim's body move; 9b
moved `needs-attention` onto the lock stuck state; 9c removed the slicing/advancing
markers), the `drop-bookkeeping-rebase` machinery is DEAD — it existed only to drop
the `route-to-needs-attention` (and historical `in-progress → needs-attention`)
MOVE-ONLY bookkeeping commits a branch inherited, so a replay/rebase did not hit a
rename/rename ledger conflict. With nothing to inherit, delete it and prove a plain
rebase.

- Delete `drop-bookkeeping-rebase.ts` and its call sites: the integration rebase
  (`integration-core.ts`) and the onboard continue-rebase (`continue-branch.ts`).
  Remove the `Dorfl-Bookkeeping: route-to-needs-attention` trailer producer
  (`needs-attention.ts` no longer emits a route-to-needs-attention move-only commit
  after 9b, so the trailer has no producer).
- Prove a branch continue/rebase is now a PLAIN rebase: a work branch cut from `main`
  carries NO transient status, so a continue onto fresh `main` rebases cleanly with
  NO drop step and NO rename/rename ledger conflict. The old `drop-bookkeeping-rebase`
  tests are removed WITH the module; add/keep a test that the plain rebase is clean.

This delivers SPEC US #6 (the drop-bookkeeping-rebase module + call sites removed for
good) and completes defect #2's dissolution (branch inheritance gone).

## Acceptance criteria

- [ ] `drop-bookkeeping-rebase.ts` is deleted; the integration rebase and the onboard
      continue-rebase no longer reference a drop step; the
      `Dorfl-Bookkeeping: route-to-needs-attention` trailer has no producer and
      its consumer is gone.
- [ ] A work branch cut from `main` carries NO transient status; a continue/rebase is
      a PLAIN rebase with no drop step and no rename/rename ledger conflict (tested).
- [ ] The old drop-bookkeeping-rebase tests are removed with the module; a new test
      proves the clean plain-rebase continue.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green with the module
      and its references fully gone (no dangling import).
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `cutover-claim-body-stays-and-complete-sources-from-backlog` (9a),
  `cutover-needs-attention-becomes-lock-stuck-recovery-surface` (9b),
  `cutover-retire-slicing-advancing-markers-and-trim-folder-sets` (9c) — all three
  must land first; together they ensure no transient status lands on a branch, which
  is what makes the drop-rebase dead code.

## Prompt

> Delete the now-dead `drop-bookkeeping-rebase` machinery and prove a plain rebase.
> After 9a/9b/9c, no transient status lands on a work branch (claim does not move the
> body; needs-attention is the lock stuck state, not a folder move; the
> slicing/advancing markers are gone). So `drop-bookkeeping-rebase.ts` — which exists
> only to drop the `route-to-needs-attention` move-only bookkeeping commits a branch
> inherited (it keys on the `Dorfl-Bookkeeping: route-to-needs-attention` git
> trailer) — is dead. Read `drop-bookkeeping-rebase.ts` and its call sites
> (`integration-core.ts` integration rebase, `continue-branch.ts` onboard
> continue-rebase) and the trailer producer in `needs-attention.ts`. SPEC US #6; ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`.
>
> Delete the module + both call sites + the trailer producer/consumer. Prove (test) a
> branch cut from `main` carries no transient status and a continue/rebase onto fresh
> `main` is a PLAIN rebase: no drop step, no rename/rename ledger conflict. The old
> drop-rebase tests go WITH the module; add a clean-plain-rebase continue test.
>
> FIRST check this slice against reality: confirm 9a/9b/9c actually removed all
> transient-status writes (grep that nothing emits the route-to-needs-attention
> trailer or `git mv`s into `in-progress`/`needs-attention`/`slicing`/`advancing`). If
> something still does, that producer must be retargeted FIRST (route the slice to
> needs-attention with the discrepancy rather than deleting a still-live drop step).
> "Done" = `pnpm -r build && pnpm -r test && pnpm format:check` green with the module
> fully gone (no dangling import).
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> SPEC propagation. Record non-obvious in-scope decisions per the slice template.
