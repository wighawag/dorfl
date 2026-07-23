---
title: 'Add an opt-in `gc --ledger --reap-stale-locks` that auto-clears terminal-on-main stale locks (default stays report-only)'
slug: gc-ledger-reap-stale-locks-opt-in-flag
blockedBy: []
covers: []
---

## What to build

A human-invoked SWEEP for stranded per-item locks. Today `gc --ledger` REPORTS a
stale-active lock (a held `active` lock whose item is already TERMINAL on
`<arbiter>/main` — completed/cancelled task or tasked/dropped brief) and fails loud,
but it NEVER clears it: the human must run `release-lock <item>` per lock. The
recovery path (`reconcileItemLockAgainstMain`) DOES auto-clear such a lock, but only
when that slug is re-touched by a `complete`/`do` pass — a lock nobody re-touches
just lingers until reported.

Add an OPT-IN flag `gc --ledger --reap-stale-locks` that, for each
`cleared-stale`-eligible lock the report finds (terminal-on-main + stale `active`),
performs the SAME leased delete `reconcileItemLockAgainstMain` / `release-lock` use
(`--force-with-lease` on the lock ref, then `update-ref -d`), so one command sweeps
every orphaned terminal lock instead of N hand-run `release-lock`s.

CRUCIAL — preserve the existing trust model and the no-AUTO-sweep safety:

- The DEFAULT (`gc --ledger` with no flag) is UNCHANGED: report-only, fail-loud,
  never deletes. The reaper fires ONLY with the explicit `--reap-stale-locks` flag
  (a human asserting "clear the dead terminal locks"), exactly as `release-lock`'s
  trust model (a human names/authorises the clear; the tool never guesses liveness).
- It reaps ONLY the `cleared-stale` class (terminal-on-main + `active`). It MUST NOT
  touch a `kept-stuck` lock (terminal + `stuck` — kept for human attention, US #10)
  or a `kept-in-flight` lock (active + NON-terminal — a healthy concurrent build).
  A `stuck` lock and an in-flight lock are NEVER reaped, even with the flag.
- Each reap is a leased delete (`--force-with-lease=<ref>:<held-sha>`): if the lock
  changed concurrently the delete is REJECTED for that ref (reported, not forced) —
  never a blind `--force`.
- Report what was reaped vs kept, and keep the fail-loud exit semantics for any
  lock that still needs attention AFTER the sweep (e.g. a `kept-stuck`, or a
  `cleared-stale` whose leased delete lost the race).

Reuse the existing seam: the report already classifies locks via
`reconcileItemLockAgainstMain`'s read-only twin; the reaper is the write-path that
the recovery already implements (`reconcileItemLockAgainstMain` clears a
`cleared-stale`). Factor the leased-delete so the flag and the recovery share ONE
clear implementation, rather than duplicating it.

## Acceptance criteria

- [ ] `gc --ledger` with NO flag is byte-for-byte behaviour-unchanged: report-only,
      fail-loud on attention-needing locks, deletes nothing.
- [ ] `gc --ledger --reap-stale-locks` clears every `cleared-stale`-eligible lock
      (terminal-on-main + `active`) via the SAME leased delete as `release-lock`, and
      reports what it reaped.
- [ ] The reaper NEVER clears a `kept-stuck` (terminal + stuck) or a `kept-in-flight`
      (active + non-terminal) lock, even with the flag.
- [ ] A concurrent change to a lock ref makes its leased delete REJECT (reported),
      never `--force`.
- [ ] The flag covers all four terminals (a task at `tasks/done`/`tasks/cancelled`,
      a brief at `briefs/tasked`/`briefs/dropped`) via the existing
      `terminalMainPaths`.
- [ ] Tests cover: reap clears a terminal+active lock; leaves a stuck and an
      in-flight lock untouched; a lost lease is reported not forced; the no-flag
      default still deletes nothing. If any test drives the git-`file://`-CAS lock
      against a `--bare` arbiter with in-process racers, register it in the
      `RACE_SENSITIVE` list in `vitest.config.ts`.
- [ ] `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Blocked by

- None — can start immediately. The unified per-item lock + `gc --ledger` report +
  `reconcileItemLockAgainstMain` all exist on main.

## Prompt

> Build an opt-in `gc --ledger --reap-stale-locks` flag that auto-clears stranded
> TERMINAL locks (a held `active` lock whose item is already terminal on
> `<arbiter>/main`), while keeping the DEFAULT `gc --ledger` exactly report-only.
>
> FIRST, check against current reality: confirm `gc --ledger` today calls
> `reportItemLocks` (the read-only twin) and REPORTS a `cleared-stale`-eligible lock
> without deleting, and that `reconcileItemLockAgainstMain` already implements the
> leased-delete clear of such a lock. If a reaper flag already exists, route to
> needs-attention.
>
> Domain vocabulary: the unified per-item lock is `refs/dorfl/lock/<type>-<slug>`
> on the arbiter (no heartbeat — so there is NO age-based auto-sweep anywhere; a
> human asserts a lock is dead). The reconcile classes are `cleared-stale` (terminal
> + active = orphaned), `kept-stuck` (terminal + stuck = human attention),
> `kept-in-flight` (active + non-terminal = healthy build). `terminalMainPaths`
> (item-lock.ts) defines terminal across all four folders. The clear is a leased
> delete (`--force-with-lease=<ref>:<held-sha>` then `update-ref -d`), the SAME one
> `release-lock` and the recovery use — NEVER a blind `--force`.
>
> Where to look: the `gc --ledger` action in `cli.ts` (the `reportItemLocks` +
> `itemLockReportNeedsAttention` + `process.exit` block); `item-lock.ts`
> (`reconcileItemLockAgainstMain`'s leased-delete clear — factor it so the flag and
> the recovery share ONE clear path; `terminalMainPaths`; the read-only classifier).
> Follow the existing report/clear seam; do not invent a parallel mechanism.
>
> SCOPE FENCE: the reaper reaps ONLY the `cleared-stale` class. It must NOT touch a
> `kept-stuck` or a `kept-in-flight` lock even with the flag. The no-flag default
> must stay report-only + fail-loud + delete-nothing (a regression here is a block).
>
> "Done" means: the opt-in flag sweeps terminal stale locks via the shared leased
> delete, the default is unchanged, stuck/in-flight locks are never reaped, a lost
> lease is reported not forced, tests cover all four cases (+ register any new
> file-CAS race test in `RACE_SENSITIVE`), and `pnpm -r build && pnpm -r test &&
> pnpm format:check` is green. RECORD any non-obvious in-scope decision (e.g. the
> exact exit code when a reap clears everything vs leaves a stuck lock) per
> `ADR-FORMAT.md`.
