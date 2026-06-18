---
title: Retarget ADVANCING-lock onto the unified lock
slug: advancing-acquires-unified-lock
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [unified-item-lock-module-from-tracer, lock-entry-state-machine-and-invariants]
covers: [1, 3, 18]
---

## What to build

Retarget the ADVANCING lock off the `work/advancing/<entry>.md` marker on `main`
onto the unified per-item lock, as an `action: advance` hold on the SAME per-item
ref. After this slice, the surface/apply/triage advance phase acquires the unified
lock (`action: advance`) instead of CAS-publishing a marker into `work/advancing/`
on `main`. The item never moves; the hold is purely on the lock ref.

This slice realises issue #3 (cross-action exclusion) ATOMICALLY: because advance is
now the SAME lock as claim and slice, an item CANNOT be advanced while it is being
implemented, nor claimed while it is being advanced, the second acquirer loses the
SAME CAS. There is no advisory eligibility bar and no TOCTOU window; the exclusion IS
the lock. This removes the branch-inheritance source for advancing markers too (no
`work/advancing/` in main's tree to inherit).

The advance flow is runner-mediated (the agent never touches the lock ref), exactly
as the landed advancing-lock already is, only the substrate changes from a `main`
marker to the per-item ref.

## Acceptance criteria

- [ ] `acquireAdvancingLock` / `releaseAdvancingLock` acquire/release the unified
      per-item lock with `action: advance`; no `work/advancing/<entry>.md` marker is
      written to `main`.
- [ ] advance∥claim and advance∥slice on the SAME item: the second acquirer loses
      the SAME lock CAS atomically (no advisory check, no TOCTOU); tested on a
      `--bare file://` arbiter.
- [ ] An advance hold can reach the `stuck` state (the advance-stuck cell), carrying
      its reason on the lock entry.
- [ ] The acquire/release stays runner-mediated; the agent never touches the lock ref.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `unified-item-lock-module-from-tracer` (the lock API).
- `lock-entry-state-machine-and-invariants` (acquire/mark-stuck/release; the
  advance-stuck cell).

## Prompt

> Retarget the ADVANCING lock onto the unified per-item lock. Today it CAS-publishes a
> `work/advancing/<type>-<slug>.md` marker onto `main` from a throwaway branch
> (`packages/agent-runner/src/advancing-lock.ts`,
> `acquireAdvancingLock`/`releaseAdvancingLock`, addressed via `advancingMarkerPath` /
> `listAdvancingMarkers`), read it first; it is the closest existing analogue and the
> production lock module generalises it. New behaviour: acquire the unified per-item
> lock with `action: advance`; write NO marker to `main`. PRD
> `work/prd/ledger-status-per-item-lock-refs.md` (US #1, #3, #18); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`; state machine in the trail's
> "### The C8 lock-entry STATE MACHINE".
>
> This is the slice where issue #3 becomes ATOMIC: advance is now the SAME lock as
> claim and slice, so advance∥claim and advance∥slice on one item are mutually
> exclusive BY CONSTRUCTION (the second acquirer loses the same CAS), no advisory
> eligibility bar, no TOCTOU. Prove that with a race test on a `--bare file://`
> arbiter (`test/helpers/gitRepo.ts`). Keep the acquire/release RUNNER-mediated (the
> agent never touches the lock ref). The advance hold must be able to go `stuck`
> (the advance-stuck cell that the old marker could not represent cleanly).
>
> The `<type>-<slug>` addressing seam (`advancingMarkerPath`) is what the lock module
> keys on, reuse it. "Done" = `pnpm -r build && pnpm -r test && pnpm format:check`
> green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. Record non-obvious in-scope decisions per the slice template.
