---
title: Retarget SLICING-lock onto the unified lock
slug: slicing-acquires-unified-lock
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [unified-item-lock-module-from-tracer, lock-entry-state-machine-and-invariants]
covers: [1, 3]
---

## What to build

Retarget the SLICING lock off the `git mv prd→slicing` marker on `main` onto the
unified per-item lock, as an `action: slice` hold. After this slice, acquiring the
slicing lock for a PRD ACQUIRES its per-item lock (`action: slice`) instead of moving
the PRD into a `work/slicing/` folder on `main`; the PRD body STAYS in `prd/`. On a
successful slice the release still drives the DURABLE `prd → prd-sliced` move on
`main` (a durable resting record, that stays a `main` move). On an aborted/unclear
slice the lock is released (the PRD is already resting in `prd/`; no folder bounce).

Crucially, because the slicing hold is now the SAME per-item lock as claim and
advance, slicing a PRD is mutually exclusive with claiming/advancing the SAME item by
construction. Preserve the slicing-release STALE-EDIT check (the held PRD body edited
under the lock → fail loud, never emit slices from a stale snapshot), it remains a
real backstop and is unchanged in spirit; only the lock substrate moves.

## Acceptance criteria

- [ ] `acquireSlicingLock` / `releaseSlicingLock` acquire/release the unified
      per-item lock with `action: slice`; the PRD body stays in `work/prd/<slug>.md`
      (no `work/slicing/` move on `main`).
- [ ] Release-on-SUCCESS still performs the durable `prd → prd-sliced` `main` move,
      atomic with the emitted backlog slices.
- [ ] Release-on-ABORT releases the lock with NO `main` move (the PRD rests in `prd/`).
- [ ] The slicing-release stale-edit check still fires (held body edited under the
      lock → fail loud; never emit slices from a stale snapshot).
- [ ] A slice action on an item already held for implement/advance loses the SAME
      lock CAS (atomic cross-action exclusion); tested on a `--bare file://` arbiter.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `unified-item-lock-module-from-tracer` (the lock API).
- `lock-entry-state-machine-and-invariants` (the acquire/release/complete transitions).

## Prompt

> Retarget the SLICING lock onto the unified per-item lock. Today it is a
> `git mv work/prd/<slug>.md → work/slicing/<slug>.md` micro-commit raced via the
> shared-`main` CAS (`packages/agent-runner/src/slicing-lock.ts`,
> `acquireSlicingLock`/`releaseSlicingLock`), read it first, noting the release's
> stale-edit (content-identity) check (exit 4 `stale`). New behaviour: acquire the
> unified per-item lock with `action: slice`; the PRD body STAYS in `work/prd/`.
> PRD `work/prd/ledger-status-per-item-lock-refs.md` (US #1, #3); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`; state machine in the trail's
> "### The C8 lock-entry STATE MACHINE".
>
> The DURABLE resting move `prd → prd-sliced` on a SUCCESSFUL slice STAYS a `main` move
> (it is a durable resting record, atomic with the emitted backlog slices), only the
> transient `slicing` HOLD moves to the lock ref. On abort, just release the lock (the
> PRD already rests in `prd/`; there is no `slicing/ → prd/` bounce because there is no
> `slicing/` folder anymore). KEEP the slicing-release stale-edit check, it is still a
> real backstop; only the lock substrate changes. Because this is now the SAME lock as
> claim/advance, prove slice∥claim and slice∥advance mutual exclusion on the same item.
>
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`). "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. Record non-obvious in-scope decisions per the slice template.
