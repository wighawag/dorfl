---
title: ADVANCING acquires the unified lock for the tree-less rungs only (interim dual-write; advancing/ marker kept)
slug: advancing-acquires-unified-lock
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [unified-item-lock-module-from-tracer, lock-entry-state-machine-and-invariants]
covers: [1, 3, 18]
---

> **RE-SCOPED 2026-06-18 to Option A (interim dual-write) + the advance-tick nesting fix (decided conductor + human).**
> Two layers of re-scope, read both:
>
> 1. **Interim dual-write** (symmetric to claim/slicing): removing the
>    `work/advancing/<entry>.md`-on-`main` marker in isolation would break the
>    consumers that still read the `advancing/` folder (`ledger-lint.ts`,
>    `ledger-write.ts`, `cli.ts`, `advancing-lock.ts`) + their tests, while the
>    folder-retirement that fixes them is the capstone #9. So advancing KEEPS today's
>    `work/advancing/<entry>.md` marker CAS exactly as-is, for ALL rungs, and the
>    marker removal + folder retirement are DEFERRED to
>    `retire-transient-folders-and-drop-rebase` (#9).
>
> 2. **The advance-tick nesting fix (the reason this slice first STOPped).**
>    `performAdvance` is a DRIVER: for the `build-slice` and `slice-prd` rungs it
>    ORCHESTRATES an inner `performDo`, which ITSELF acquires the SAME unified
>    `slice-<slug>` / `prd-<slug>` lock. So the advancing hold and the inner `do`'s
>    lock are NESTED (one logical operation), not two racers — taking the unified
>    lock for those rungs would DEADLOCK the advance tick against itself (the inner
>    claim/slice loses the create-only CAS on the ref its own outer wrapper holds;
>    there is no re-entrancy/auto-steal, per the ADR). THE DECIDED FIX (option a):
>    advancing takes the unified lock ONLY for the TREE-LESS rungs (`surface`,
>    `apply`, `triage`) — which have NO inner `do` and so genuinely need the unified
>    hold to realise issue-3 exclusion. The `build-slice` / `slice-prd` rungs do NOT
>    take the unified lock; their exclusion is the INNER `do`'s claim/slice lock,
>    which IS the single exclusion point (the same `slice-<slug>` / `prd-<slug>` ref).
>    This keeps the ADR's no-re-entrancy posture intact and confines the change to
>    `advance.ts` + `advancing-lock.ts`.
>
> CONSEQUENCE carried to #9 (recorded in `work/observations/`): after #9 removes the
> legacy advancing marker, the build/slice rungs are guarded SOLELY by the inner
> `do`'s unified lock. #9 must PROVE (test) that advance∥claim and advance∥slice on a
> build-slice/slice-prd item remain mutually exclusive through the inner `do`'s lock
> alone, and that the brief advance-layer TOCTOU resolves to one winner at the inner
> lock. An advance-driven build/slice in flight is represented by the inner `do`'s
> lock (`slice-<slug>` held `implement`, or `prd-<slug>` held `slice`), NOT a distinct
> `advance`-action lock; that conflation is ACCEPTED (it is honest about what is
> actually running).

## What to build

Make the ADVANCING lock ALSO acquire the item's unified per-item lock
(`action: advance`) **for the TREE-LESS rungs only** (`surface`, `apply`,
`triage`), **in addition to** today's CAS-published `work/advancing/<entry>.md`
marker on `main`. The `build-slice` and `slice-prd` rungs KEEP publishing the marker
but do NOT take the unified lock (the inner `performDo` they orchestrate already
takes the SAME unified ref; taking it again at the advance layer would deadlock the
tick against itself).

Concretely, after this slice:

- For a **tree-less rung** (`surface`/`apply`/`triage`): `acquireAdvancingLock`
  keeps CAS-publishing today's `work/advancing/<entry>.md` marker UNCHANGED, and
  ADDITIONALLY acquires the unified per-item lock (`action: advance`). If the lock
  acquire is `lost` (the item is already held for implement/slice/advance), the
  advancing acquire loses definitively (no retry) and does NOT publish the marker
  either. `releaseAdvancingLock` deletes the marker AND releases the unified lock.
  The advance hold can reach `stuck` via the lock's mark-stuck transition.
- For a **build-slice / slice-prd rung**: `acquireAdvancingLock` keeps publishing
  the marker UNCHANGED and does NOT take the unified lock; the inner `performDo`'s
  claim (`slice-<slug>`, `implement`) or slicing (`prd-<slug>`, `slice`) lock is the
  single exclusion point. `releaseAdvancingLock` deletes the marker; there is no
  unified lock to release at the advance layer for these rungs.

The acquire/release stays runner-mediated (the agent never touches the lock ref).
The marker removal + `advancing/` folder retirement are OUT OF SCOPE here, owned by
#9. So is the post-#9 "inner lock alone still excludes the build/slice rungs" proof
(see the banner) — #9 owns it.

> IMPLEMENTATION NOTE: the rung kind is already classified before the lock step
> (`classifyTick` in `advance.ts`, the LOCK step is #3). Thread the classified rung
> kind into the advancing acquire/release so it can take/skip the unified lock per
> rung. Keep `advancing-lock.ts` itself rung-agnostic if cleaner (e.g. an
> `acquireUnified: boolean` option set by `advance.ts` per rung), so the
> tree-less-only policy lives where the rung is known.

## Acceptance criteria

- [ ] For a TREE-LESS rung (`surface`/`apply`/`triage`): `acquireAdvancingLock`
      ADDITIONALLY acquires the unified per-item lock (`action: advance`); today's
      `work/advancing/<entry>.md` marker CAS is KEPT. A lock `lost` makes the acquire
      lose definitively (no retry) and publishes NO marker. `releaseAdvancingLock`
      releases the unified lock AND deletes the marker.
- [ ] For a BUILD-SLICE / SLICE-PRD rung: `acquireAdvancingLock` does NOT take the
      unified lock (the inner `performDo`'s claim/slice lock is the exclusion point);
      the marker CAS is KEPT. The advance tick does NOT deadlock against itself
      (the previously-failing `run-uses-advance-tick` / `advance-registry-set`
      build/slice paths stay green).
- [ ] advance∥claim and advance∥slice on the SAME item for a TREE-LESS rung: the
      second acquirer loses the SAME lock CAS atomically (no advisory check, no
      TOCTOU); tested on a `--bare file://` arbiter.
- [ ] A tree-less advance hold can reach the `stuck` state (the advance-stuck cell),
      carrying its reason on the lock entry.
- [ ] The acquire/release stays runner-mediated; the agent never touches the lock ref.
- [ ] Every EXISTING advancing/advance test still passes (the `advancing/` marker
      still lands on `main` for ALL rungs); this slice does NOT remove the marker or
      retire the folder, and does NOT deadlock the build/slice advance rungs.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `unified-item-lock-module-from-tracer` (the lock API).
- `lock-entry-state-machine-and-invariants` (acquire/mark-stuck/release; the
  advance-stuck cell).

## Prompt

> Make the ADVANCING lock ALSO acquire the unified per-item lock (`action: advance`)
> FOR THE TREE-LESS RUNGS ONLY (`surface`/`apply`/`triage`), IN ADDITION to today's
> `work/advancing/<type>-<slug>.md` marker CAS. READ THE RE-SCOPED BANNER FIRST: the
> `build-slice` / `slice-prd` rungs must NOT take the unified lock, because
> `performAdvance` (`packages/dorfl/src/advance.ts`) orchestrates an inner
> `performDo` for those rungs that ITSELF acquires the SAME unified ref — taking it at
> the advance layer too would DEADLOCK the tick against itself (verified: it red-ed 9
> advance-tick tests). The inner `do`'s claim/slice lock IS the exclusion point for
> those rungs.
>
> Read `packages/dorfl/src/advancing-lock.ts`
> (`acquireAdvancingLock`/`releaseAdvancingLock`, addressed via `advancingMarkerPath`
> / `listAdvancingMarkers`) and `advance.ts` (`performAdvance`, `classifyTick`, the
> LOCK step #3, the build/slice rungs that call `performDo`) first. KEEP the marker
> CAS as-is for ALL rungs. The rung kind is known at the lock step (classified before
> it), so thread it in: for a tree-less rung, ALSO `acquireItemLock({item, action:
> 'advance'})` (keyed through `lockEntryFor`, the SAME `<type>-<slug>` seam) — a
> `lost` loses definitively and publishes NO marker; release also releases the unified
> lock. For a build/slice rung, do NOT touch the unified lock at the advance layer.
> Prefer keeping `advancing-lock.ts` rung-agnostic via an `acquireUnified: boolean`
> option set per rung by `advance.ts`, so the tree-less-only policy lives where the
> rung is known. PRD `work/prd/ledger-status-per-item-lock-refs.md` (US #1, #3, #18);
> ADR `docs/adr/ledger-status-on-per-item-lock-refs.md`; state machine in the trail's
> "### The C8 lock-entry STATE MACHINE".
>
> Do NOT remove the `work/advancing/<entry>.md` marker and do NOT retire the
> `advancing/` folder (capstone #9). Do NOT make the inner `do` re-entrant or add
> auto-steal (that was the rejected option b; it contradicts the ADR's
> no-heartbeat/no-auto-sweep model). Keep acquire/release RUNNER-mediated. A tree-less
> advance hold must be able to go `stuck` via the lock's mark-stuck transition.
>
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`): a tree-less rung
> takes the unified lock and proves advance∥claim / advance∥slice exclusion on the
> same item; a build/slice rung does NOT take the unified lock and the advance tick
> does NOT deadlock (the `run-uses-advance-tick` / `advance-registry-set` build/slice
> paths stay green); the marker still lands for all rungs. "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. Record non-obvious in-scope decisions per the slice template.
