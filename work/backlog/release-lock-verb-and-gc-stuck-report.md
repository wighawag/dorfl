---
title: release-lock <item> verb + stuck-lock report in gc --ledger
slug: release-lock-verb-and-gc-stuck-report
prd: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [lock-entry-state-machine-and-invariants, advancing-acquires-unified-lock]
covers: [12, 13, 14, 21]
---

## What to build

Generalise the landed human-recovery surface from advancing-only to the unified
lock. Add a `release-lock <item>` verb that clears a NAMED lock (generalising
`release-advancing`), and a stuck/orphaned-lock REPORT in `gc --ledger` that lists
lingering lock entries (generalising the advancing-marker report). There is NO
liveness heartbeat and NO auto-sweep: a human asserts a lock is dead and clears it.

Plus two robustness properties: an ABSENT lock ref is treated as "no locks held"
(exactly as `listAdvancingMarkers` treats an absent dir as `[]`), so accidental
deletion of the lock ref(s) is "all locks released" and RECOVERABLE (the work is
safe on the `work/<slug>` branches + `main`); and a held runner whose OWN lock
VANISHED mid-build must DETECT it (its release finds nothing) and abort /
needs-attention rather than silently clean-release.

## Acceptance criteria

- [ ] `release-lock <item>` clears a named lock entry (generalises `release-advancing`).
- [ ] `gc --ledger` reports lingering lock entries (held + stuck) with holder/since/
      reason; it does NOT auto-clear them (no auto-sweep, no heartbeat).
- [ ] An absent lock ref reads as "no locks held" ([]); deletion of the lock ref(s)
      is recoverable ("all locks released"), with the work still safe on the
      `work/<slug>` branches + `main`.
- [ ] A runner whose own lock vanished mid-build detects the missing ref on release
      and aborts / routes to needs-attention rather than silently clean-releasing.
- [ ] Tests use throwaway repos + a `--bare file://` arbiter; nothing writes outside
      its own temp fixtures.

## Blocked by

- `lock-entry-state-machine-and-invariants` (the release transition + invariants).
- `advancing-acquires-unified-lock` (so `release-advancing` is fully subsumed by the
  unified `release-lock`).

## Prompt

> FIRST, check this slice against current reality (it is a launch snapshot and may
> have DRIFTED): do the unified lock's release transition + the advancing retarget it
> depends on still match what landed? If a dependency landed differently, route the
> slice to `needs-attention/` with the discrepancy rather than building on a stale
> premise (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> Generalise the human-recovery surface from advancing-only to the unified lock. Read
> the landed `release-advancing` verb + the `gc --ledger` advancing-marker report
> (`packages/agent-runner/src/advancing-lock.ts` `listAdvancingMarkers`, the `gc.ts` /
> ledger-lint report, and slices `advancing-lock-human-release-verb-and-surface` /
> `advancing-lock-release-crash-safe` in `work/done/`). Add `release-lock <item>`
> (clears a NAMED unified lock) and a stuck/orphaned-lock report in `gc --ledger`. PRD
> `work/prd/ledger-status-per-item-lock-refs.md` (US #12, #13, #14); ADR
> `docs/adr/ledger-status-on-per-item-lock-refs.md`; the trail's Amendment 4.
>
> NO liveness heartbeat, NO auto-sweep, `gc --ledger` REPORTS; a human `release-lock`
> CLEARS (the same trust model as `release-advancing`). Two robustness properties:
> (1) an absent lock ref = "no locks held" (`[]`), so deleting the lock ref(s) is
> "all locks released" and recoverable (work safe on the `work/<slug>` branches +
> `main`); (2) a runner whose OWN lock vanished mid-build detects it on release (finds
> nothing) and aborts / needs-attention rather than silently clean-releasing.
>
> Test on a `--bare file://` arbiter (`test/helpers/gitRepo.ts`): name-and-clear a
> stuck lock; report lists lingering locks without clearing; absent ref = no locks;
> vanished-own-lock aborts. "Done" =
> `pnpm -r build && pnpm -r test && pnpm format:check` green.
>
> NOTE: `humanOnly: true` is a DECIDED review-gate (driven via `drive-backlog`), not
> PRD propagation. Record non-obvious in-scope decisions per the slice template.
