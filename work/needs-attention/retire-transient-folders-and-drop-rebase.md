---
title: Retire the transient folders + remove drop-bookkeeping-rebase
slug: retire-transient-folders-and-drop-rebase
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [claim-acquires-unified-lock-no-body-move, slicing-acquires-unified-lock, advancing-acquires-unified-lock, needs-attention-as-stuck-lock-state, complete-lock-then-durable-main-move-crash-safe]
covers: [5, 6, 7]
---

> **SCOPE EXPANDED 2026-06-18 (Option A cut-over).** Slices #3/#4/#5 were re-scoped
> to INTERIM DUAL-WRITE: claim/slicing/advancing each now ALSO acquire the unified
> lock but STILL write their legacy `main` artifact (`in-progress/` body move,
> `slicing/` marker, `advancing/` marker), because removing those in isolation breaks
> the consumers (`complete`/`start`/`needs-attention`/`do`/`run` + tests) whose
> retargets land HERE. So this capstone now owns the FULL CUT-OVER, not just the
> folder retirement: (a) stop claim moving the body (claim writes nothing to `main`;
> `--resume` reads `backlog/`); (b) stop slicing/advancing writing their markers;
> (c) retarget every `in-progress/`/`slicing/`/`advancing/`-folder CONSUMER onto the
> lock-ref state (the held/stuck reads landed in #6 `needs-attention-as-stuck-lock-state`
> and the durable move ordering in #7 `complete-...-crash-safe`, this slice removes
> the LEGACY folder reads/writes those left dual-wired); (d) retire the transient
> folders + delete drop-rebase. It is a large but coherent slice; that is the
> deliberate Option-A trade (small green dual-write slices first, one cut-over last).

## What to build

The capstone CUT-OVER. The four retargets (#3 claim, #4 slicing, #5 advancing, #6
needs-attention) and crash-safe complete (#7) have landed, but #3/#4/#5 still
DUAL-WRITE their legacy `main` artifacts so the unmodified consumers stayed green.
This slice removes that legacy half end-to-end so `main`'s ONLY `work/` moves become
the three durable resting transitions (`backlog → done`, `prd → prd-sliced`,
`backlog → dropped`), and a work branch cut from `main` inherits NO transient status
at all.

Concretely, in dependency order WITHIN this slice:

1. **Stop the legacy transient WRITES.** Remove claim's `git mv backlog→in-progress`
   (claim now writes NOTHING to `main`, only the lock; this is US #16 protected-main
   + the original #3 "no body move"); remove slicing's `git mv prd→slicing` marker
   and its abort bounce; remove advancing's `work/advancing/<entry>.md` marker CAS.
   The lock acquire/release added in #3/#4/#5 becomes the SOLE transient mechanism.
2. **Retarget the legacy folder CONSUMERS onto the lock / `backlog/`.** `complete.ts`
   sources the durable `→ done` move from `backlog/` (not `in-progress/`); `start.ts`
   dispatch reads held-ness from the lock ref (a claimed item now rests in `backlog/`
   on `main`, so folder-only dispatch would re-claim it); `--resume` /
   `readSliceOnArbiter` read the body from `backlog/` + the lock; `do.ts`/`run.ts`
   onboard without a `claim.claimCommit` on `main` (claim no longer writes one) and
   bounce via the lock's stuck state, not an `in-progress → needs-attention` surface;
   any remaining `slicing/`/`advancing/` reader (`advance.ts`, `needs-attention.ts`,
   `ledger-read.ts`, `review-gate.ts`, `integration-core.ts`, `slicing.ts`,
   `ledger-lint.ts`, `cli.ts`) reads the lock instead. UPDATE the ~25 tests that
   assert the legacy on-`main` artifacts to assert the lock-ref state instead.
3. **Retire the folders + delete drop-rebase.** Remove `in-progress`/
   `needs-attention`/`slicing`/`advancing` from `LEDGER_STATUS_FOLDERS`
   (`ledger-lint.ts`) / `WORK_FOLDERS` (`ledger-write.ts`), keeping the durable set
   `backlog`/`done`/`dropped` for slices and `prd`/`prd-sliced` for PRDs (note
   `backlog` STAYS the pool until the deferred STEP-B rename); delete
   `drop-bookkeeping-rebase.ts` and its call sites (the integration rebase and the
   onboard continue-rebase); prove a branch continue/rebase is now a PLAIN rebase
   with NO drop step and NO rename/rename ledger conflict (the old drop-rebase tests
   go with the module).

> If this cut-over proves too large to land green in one pass, that is itself a
> needs-attention signal: STOP and surface a sub-slicing proposal (e.g. one
> consumer-family per slice) rather than guessing a partial cut-over.

## Acceptance criteria

- [ ] The legacy transient WRITES are removed: claim no longer `git mv`s
      `backlog→in-progress` (claim writes nothing to `main`; a protected-`main` claim
      succeeds); slicing no longer writes the `slicing/` marker; advancing no longer
      writes the `advancing/` marker. The unified lock is the SOLE transient mechanism.
- [ ] ADVANCE-TICK exclusion survives the advancing-marker removal: advancing took
      the unified lock only for the TREE-LESS rungs (`surface`/`apply`/`triage`); the
      `build-slice`/`slice-prd` rungs rely on the INNER `do`'s claim/slice lock (slice
      #5 option a, to avoid the nested-lock self-deadlock). With the advancing marker
      now gone, PROVE (test) that advance∥claim and advance∥slice on a
      build-slice/slice-prd item remain mutually exclusive through the inner `do`'s
      unified lock ALONE, and that the brief advance-layer TOCTOU (two advancers both
      classifying the item as build/slice before the inner `do`) resolves to exactly
      one winner at the inner lock. An advance-driven build/slice in flight is
      represented by the inner `do`'s lock (`slice-<slug>` `implement` / `prd-<slug>`
      `slice`), not a distinct `advance` lock (the accepted conflation).
- [ ] The legacy folder CONSUMERS are retargeted: `complete` sources `→ done` from
      `backlog/`; `start`/`--resume`/`do`/`run` read held/stuck-ness from the lock ref
      (not the `in-progress/`/`needs-attention/` folders) and the body from `backlog/`;
      no `slicing/`/`advancing/` folder read remains. The ~25 tests asserting the
      legacy on-`main` artifacts now assert the lock-ref state.
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
> READ the SCOPE EXPANDED banner at the top: #3/#4/#5 landed as INTERIM DUAL-WRITE
> (lock + legacy `main` artifact), so this slice owns the FULL cut-over, not just the
> folder retirement.
>
> FIRST, stop the legacy transient writes: remove claim's `git mv backlog→in-progress`
> (`performClaim` in `claim-cas.ts`) so claim writes nothing to `main`; remove
> slicing's `git mv prd→slicing` marker + abort bounce (`slicing-lock.ts`); remove
> advancing's `work/advancing/<entry>.md` marker CAS (`advancing-lock.ts`). The lock
> acquire/release (added in #3/#4/#5) is now the sole transient mechanism.
>
> THEN retarget the legacy folder CONSUMERS onto the lock / `backlog/`: `complete.ts`
> sources `→ done` from `backlog/`; `start.ts` reads held-ness from the lock ref (a
> claimed item now rests in `backlog/`, so folder-only dispatch would re-claim it);
> `--resume`/`readSliceOnArbiter` in `ledger-read.ts` read the body from `backlog/` +
> the lock; `do.ts`/`run.ts` onboard without a `claim.claimCommit` on `main` and
> bounce via the lock's stuck state; retarget any remaining `slicing/`/`advancing/`
> reader (`advance.ts`, `needs-attention.ts`, `review-gate.ts`, `integration-core.ts`,
> `slicing.ts`, `cli.ts`). UPDATE the ~25 tests that assert the legacy on-`main`
> artifacts to assert the lock-ref state.
>
> THEN remove `in-progress`/`needs-attention`/`slicing`/`advancing` from the status
> folder sets (`LEDGER_STATUS_FOLDERS` in `ledger-lint.ts`, `WORK_FOLDERS` in
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
> If the cut-over is too large to land green in one pass, STOP and surface a
> sub-slicing proposal (one consumer-family per slice) rather than guessing a partial
> cut-over.
>
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`): a branch cut from
> `main` carries no transient status; a continue is a clean plain rebase. "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. This removal is broad; record non-obvious in-scope decisions per
> the slice template.

## Needs attention

The capstone is too large to land green in one pass, and one sub-piece rests on an unresolved design decision — both of which the slice's own escape clause says should STOP-and-sub-slice rather than guess a partial cut-over.

SPECIFICS (where the premises understate / are unsettled):
1. Test surface ~3.6x the estimate. The slice estimates "~25 tests" asserting the legacy on-`main` artifacts. Actual: 91 of 170 test files reference `in-progress`/`needs-attention`/`slicing`/`advancing`/drop-rebase, because `in-progress/`/`needs-attention/` thread through nearly every command's tests (complete, start, run, do, integration-core, requeue, status, scan, recover-isolated, close-job, …), not just the four lock writers. A clean one-pass green is not realistic without partial-cut-over states that leave the tree red between consumer families.

2. `needs-attention/` is NOT a thin marker like `slicing/`/`advancing/`, and its retirement hides an unresolved design decision. Slice #6 (`needs-attention-as-stuck-lock-state`, a declared blockedBy) deliberately landed the `needs-attention/` FOLDER move as the AUTHORITATIVE stuck record, with the lock `state:stuck` mark as a redundant best-effort mirror (see `ledger-write.ts` `markStuckLockBestEffort`, doc-comment lines ~790-808 "the durable `needs-attention/` folder move above is the AUTHORITATIVE stuck record … the capstone (#9) retargets those", and the swallow-on-failure at ~838/846). The whole stuck-state machinery (`needs-attention.ts` ~1700 lines: `routeToNeedsAttention`/`surfaceToNeedsAttention`/`returnToBacklog`/`resolveFromNeedsAttention`/`readNeedsAttentionItems`/`extractReason`; `ledger-write.ts` `applyNeedsAttentionTransition`/`applyTreelessNeedsAttentionTransition`; the integration-core gate-fail/rebase-conflict bounce; `complete`'s `--from-needs-attention` recovery re-gate; `start`'s resolve-from-needs-attention; `requeue`; `status`/`scan` surfacing) reads the FOLDER and the body `.md`. Retiring the folder requires a DESIGN decision the slice does not pin: where the stuck item's BODY (today the reason is appended as prose in the moved `.md`, and the wip is the work-branch tip) and the human RECOVERY view live once there is no `work/needs-attention/<slug>.md`. The lock entry carries `reason` but not the body/wip, and there is no specified read-path for `status`/`requeue`/`complete-recovery` against a lock-only stuck state with the body still resting in `backlog/`. This is a user-visible-behaviour, hard-to-reverse decision, not a small factual gap.

3. claim's body-stay-in-`backlog/` ripples the entire `complete` SOURCE axis. `complete.ts` + `integration-core.ts` resolve the done-move source from `in-progress/`/`needs-attention/`/`done/` on the tree AND the arbiter, and the divergent-ledger rebase reconcile uses a private `LEDGER_STATUS_FOLDERS` set; sourcing `→done` from `backlog/` changes the done-move, the bounce, the `source` enum threaded through the core, and the reconcile — a consumer-family of its own.

SUGGESTED RE-SCOPE (one consumer-family per slice, build order; each green on `pnpm -r build && pnpm -r test && pnpm format:check` against a `--bare file://` arbiter):
  9a. Stop claim's body move + retarget the build/complete source axis: remove `git mv backlog→in-progress` in `claim-cas.ts` (claim writes nothing to `main`); retarget `complete.ts`/`integration-core.ts` to source `→done` from `backlog/`; `start`/`--resume`/`do`/`run` read held-ness from the lock ref (claimed item rests in `backlog/`); `readSliceOnArbiter`/ledger-read read the body from `backlog/`. Keep `in-progress` in the folder sets until 9c so the diff stays bounded. Update its consumer tests.
  9b. needs-attention → stuck-lock recovery surface (the design-bearing slice; needs a human decision FIRST on where the stuck body/reason/recovery view live without a `needs-attention/<slug>.md`): re-architect `routeToNeedsAttention`/`surfaceToNeedsAttention`/`returnToBacklog`/`resolveFromNeedsAttention`/`extractReason`, `applyNeedsAttentionTransition`, the integration-core bounce, `complete --from-needs-attention`, `start` resolve, `requeue`, `status`/`scan` onto the lock `stuck` state. Decide the reason/body home + recovery read-path before building.
  9c. Retire `slicing/`/`advancing/` markers + trim the folder sets: remove slicing's `git mv prd→slicing` + abort bounce (`slicing-lock.ts`), advancing's `work/advancing/<entry>.md` marker CAS (`advancing-lock.ts`); remove `in-progress`/`needs-attention`/`slicing`/`advancing` from `LEDGER_STATUS_FOLDERS` (`ledger-lint.ts`) + `WORK_FOLDERS` (`ledger-write.ts`) and the private `integration-core.ts` `LEDGER_STATUS_FOLDERS`, keeping the durable set (`backlog`/`done`/`dropped`; `prd`/`prd-sliced`). Retarget any remaining `slicing/`/`advancing/` reader (`advance.ts`, `slicing.ts`, `review-gate.ts`, `cli.ts`).
  9d. Delete `drop-bookkeeping-rebase.ts` + both call sites (`integration-core.ts` integration rebase, `continue-branch.ts` onboard continue-rebase) and prove a continue/rebase is a PLAIN rebase with no drop step and no rename/rename ledger conflict; the old drop-rebase tests go with the module. Depends on 9a/9b/9c (no transient status lands on a branch).

No source was changed; one observation note was added (`work/observations/retire-transient-folders-capstone-larger-than-one-green-pass.md`).
