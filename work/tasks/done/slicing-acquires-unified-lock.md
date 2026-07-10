---
title: SLICING additionally acquires the unified lock (interim dual-write; slicing/ marker kept)
slug: slicing-acquires-unified-lock
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [unified-item-lock-module-from-tracer, lock-entry-state-machine-and-invariants]
covers: [1, 3]
---

> **RE-SCOPED 2026-06-18 to Option A (interim dual-write).** Symmetric to the claim
> re-scope: removing the `work/slicing/<slug>.md`-on-`main` marker in isolation would
> break the many consumers that still read the `slicing/` folder (`advance.ts`,
> `needs-attention.ts`, `ledger-read.ts`, `review-gate.ts`, `integration-core.ts`,
> `slicing.ts`, `ledger-write.ts`, `config.ts`, `ledger-lint.ts`) and the tests that
> assert it, while the folder-retirement that fixes them is the capstone #9. So this
> slice makes slicing ADDITIONALLY acquire the per-item lock (`action: slice`) while
> KEEPING today's `git mv spec→slicing` marker exactly as-is. The marker removal + the
> `slicing/` folder retirement are DEFERRED to `retire-transient-folders-and-drop-rebase`
> (#9). The durable `spec → spec-sliced` move on success was always a `main` move and
> stays one.

## What to build

Make the SLICING lock ALSO acquire the item's unified per-item lock
(`action: slice`) at acquire time, **in addition to** today's `git mv spec→slicing`
marker on `main`. This is the additive, back-compatible half of the slicing
retarget: it introduces the lock as the cross-action exclusion primitive WITHOUT
removing the `slicing/`-on-`main` marker the rest of the runner still consumes.

Concretely, after this slice:

- `acquireSlicingLock` keeps writing today's `work/slicing/<slug>.md` marker via the
  shared-`main` CAS UNCHANGED, and ADDITIONALLY acquires the unified per-item lock
  (`action: slice`). If the lock acquire is `lost` (the item is already held for
  implement/advance/slice), the slicing acquire loses definitively (no retry) and
  does NOT write the marker either, the two mechanisms agree on the winner.
- `releaseSlicingLock` keeps its existing behaviour (release-on-SUCCESS drives the
  durable `spec → spec-sliced` `main` move atomic with the emitted backlog slices;
  release-on-ABORT bounces `slicing/ → spec/`) UNCHANGED, and ADDITIONALLY releases
  the unified per-item lock.
- The slicing-release STALE-EDIT check (held SPEC body edited under the lock → fail
  loud, never emit from a stale snapshot) is preserved exactly.

Because the slicing hold is now ALSO the SAME per-item lock as claim and advance,
slicing a SPEC is mutually exclusive with claiming/advancing the SAME item by
construction (the second acquirer loses the SAME lock CAS), even though the legacy
marker still co-exists. The marker removal + `slicing/` folder retirement are OUT OF
SCOPE here and owned by #9 (see the RE-SCOPED banner).

## Acceptance criteria

- [ ] `acquireSlicingLock` ADDITIONALLY acquires the unified per-item lock
      (`action: slice`); today's `git mv spec→slicing` marker write is KEPT unchanged
      (interim dual-write). A lock `lost` makes the acquire lose definitively (no
      retry) and writes NO marker in that case.
- [ ] `releaseSlicingLock` ADDITIONALLY releases the unified per-item lock; the
      existing release behaviour is unchanged: release-on-SUCCESS still performs the
      durable `spec → spec-sliced` `main` move atomic with the emitted backlog slices,
      release-on-ABORT still bounces `slicing/ → spec/`.
- [ ] The slicing-release stale-edit check still fires (held body edited under the
      lock → fail loud; never emit slices from a stale snapshot).
- [ ] A slice action on an item already held for implement/advance loses the SAME
      lock CAS (atomic cross-action exclusion); tested on a `--bare file://` arbiter.
- [ ] Every EXISTING slicing/advance/integration test still passes (the `slicing/`
      marker still lands on `main`); this slice does NOT remove the marker or retire
      the folder.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `unified-item-lock-module-from-tracer` (the lock API).
- `lock-entry-state-machine-and-invariants` (the acquire/release/complete transitions).

## Prompt

> Make the SLICING lock ALSO acquire the unified per-item lock, IN ADDITION to
> today's behaviour. Today it `git mv work/spec/<slug>.md → work/slicing/<slug>.md` as
> a micro-commit raced via the shared-`main` CAS
> (`packages/dorfl/src/slicing-lock.ts`,
> `acquireSlicingLock`/`releaseSlicingLock`), read it first, noting the release's
> stale-edit (content-identity) check (exit 4 `stale`). KEEP all of that as-is. ADD:
> on a successful acquire, ALSO acquire the unified per-item lock (`action: slice`)
> via the lock module (`acquireItemLock`, keyed through `lockEntryFor`); if the lock
> acquire is `lost`, the slicing acquire loses (no retry) and writes NO marker. On
> release, ALSO release the unified lock (`releaseItemLock`). SPEC
> `work/spec/ledger-status-per-item-lock-refs.md` (US #1, #3); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`; state machine in the trail's
> "### The C8 lock-entry STATE MACHINE".
>
> READ the RE-SCOPED banner at the top of this slice: this is the INTERIM DUAL-WRITE
> half only. Do NOT remove the `work/slicing/<slug>.md` marker, do NOT stop the
> `slicing/ → spec/` abort bounce, do NOT retire the `slicing/` folder. Those break
> the `slicing/`-folder consumers (`advance.ts`, `needs-attention.ts`, `ledger-read.ts`,
> `review-gate.ts`, `integration-core.ts`, `slicing.ts`, …) + their tests, whose
> retargets are the capstone slice #9; they are explicitly OUT OF SCOPE here. The
> DURABLE `spec → spec-sliced` move on a successful slice STAYS a `main` move (it always
> was). KEEP the slicing-release stale-edit check. Because this is now ALSO the SAME
> lock as claim/advance, prove slice∥claim and slice∥advance mutual exclusion on the
> same item via the lock.
>
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`); prove the EXISTING
> slicing tests still pass (the marker still lands). "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> SPEC propagation. Record non-obvious in-scope decisions per the slice template.
