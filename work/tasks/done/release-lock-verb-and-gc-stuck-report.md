---
title: release-lock <item> verb + stuck-lock report in gc --ledger
slug: release-lock-verb-and-gc-stuck-report
spec: ledger-status-per-item-lock-refs
humanOnly: true
blockedBy: [lock-entry-state-machine-and-invariants, advancing-acquires-unified-lock]
covers: [12, 13, 14, 21]
---

> **FORWARD-POINTER (planted by the conductor, 2026-06-18).** Slice #7
> `complete-lock-then-durable-main-move-crash-safe` built and TESTED
> `reconcileItemLockAgainstMain` (in `item-lock.ts`) — the recovery that, for a
> terminal-on-`main` item with a lingering lock, clears a stale ACTIVE lock (the
> `main` record is authoritative) while KEEPING a `stuck` lock (the `done`+`stuck`
> co-existence). But it currently has NO production caller (it only runs in #7's
> tests). THIS slice is its home: wire `reconcileItemLockAgainstMain` into the
> `gc --ledger` surface so the stuck/orphaned-lock report uses it to DISTINGUISH a
> genuinely stuck/held lock (reported, not cleared) from a stale-active lock over a
> terminal item (the report may note it as reconcilable, but per the no-auto-sweep
> rule a human still asserts the clear via `release-lock` / `gc --ledger`'s explicit
> action — do NOT auto-clear in the plain report). Without this wiring the recovery
> stays dead in production. Confirm the exact gc behaviour (report-only vs offer-clear)
> against the ADR's "a human asserts a lock is dead" before building.

## What to build

Generalise the landed human-recovery surface from advancing-only to the unified
lock. Add a `release-lock <item>` verb that clears a NAMED lock (generalising
`release-advancing`), and a stuck/orphaned-lock REPORT in `gc --ledger` that lists
lingering lock entries (generalising the advancing-marker report), wiring in the
`reconcileItemLockAgainstMain` recovery from #7 (see the FORWARD-POINTER above).
There is NO liveness heartbeat and NO auto-sweep: a human asserts a lock is dead
and clears it.

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
- [ ] `reconcileItemLockAgainstMain` (built in #7) is WIRED into the `gc --ledger`
      surface (it had no production caller before this slice): the stuck-lock report
      uses it to tell a genuinely held/stuck lock (reported) from a stale-active lock
      over a terminal-on-`main` item, WITHOUT auto-clearing in the plain report
      (a human still asserts the clear, per the no-auto-sweep ADR rule).
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
> (`packages/dorfl/src/advancing-lock.ts` `listAdvancingMarkers`, the `gc.ts` /
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

## Needs attention

PR/code review (Gate 2) blocked this work:
- `gc --ledger` now exits non-zero (fail-loud) on ANY held per-item lock, including a normal in-flight `active` lock. Should the fail-loud exit (and arguably the report inclusion) be scoped to the stuck/stale classifications (`kept-stuck` / `cleared-stale`) only, so a healthy concurrent build does not make a routine `gc --ledger` health check exit 1? (cli.ts gc action: `process.exit(result.duplicates.length > 0 || result.advancingMarkers.length > 0 || lockReport.locks.length > 0 ? 1 : 0)`. The same report prints `kept-in-flight — normal; left untouched.` for that lock, then exits 1 — internally contradictory. The advancing-marker precedent it copies is not equivalent: an advancing marker is deleted on clean finish, but the implement/slice/advance lock is held for the whole build by design (ADR L33-34, PRD US#4/#8: active lock = in-progress, read by `status` as healthy). ADR L94-95/L100 + PRD US#14/#21 scope this surface to the STUCK/crash-orphaned lock, not every held one. Trivially reversible (gate the exit on the stuck/stale verdicts) but it makes a routine command misreport normal daemon/drive-backlog operation.)
PR/code review (Gate 2) did not reach an approve verdict within reviewMaxRounds=2 round(s); forcing needs-attention (never silently merged or looped).

## Requeue 2026-06-18

Gate-2 BLOCKED on a real, narrow defect (everything else is good, KEEP it). The defect: in cli.ts the gc action exits non-zero on ANY held per-item lock (process.exit(... || lockReport.locks.length > 0 ? 1 : 0)), so a NORMAL in-flight 'active' lock (a healthy concurrent build) makes a routine 'gc --ledger' health check exit 1 — and the same report prints 'kept-in-flight — normal; left untouched' for that very lock, then exits 1 (internally contradictory). Per the ADR (ledger-status-on-per-item-lock-refs L94-95/L100) + PRD US#14/#21, this surface is scoped to the STUCK / crash-orphaned lock, NOT every held one (an active lock = in-progress, read by status as HEALTHY).

FIX (narrow): scope the fail-loud gc exit to the STUCK/STALE classifications only — i.e. exit 1 when there is a kept-stuck lock OR a cleared-stale/reconcilable-stale lock (the genuine attention cases), but DO NOT exit 1 for a kept-in-flight (active, non-terminal) lock. A 'gc --ledger' run whose only locks are healthy in-flight 'active' holds should exit 0 and report them as normal/in-flight (informational), exactly as status treats an active lock as healthy. Keep the duplicates / advancingMarkers exit conditions unchanged. Keep everything else you built (the release-lock verb, the gc stuck-lock report, the reconcileItemLockAgainstMain wiring, absent-ref = no locks, vanished-own-lock detection) — only the exit-condition scoping is wrong. Add/adjust a test: gc --ledger with ONLY an active in-flight lock exits 0 (reports it as normal); with a stuck or stale-terminal lock exits 1 (reports it for attention).
