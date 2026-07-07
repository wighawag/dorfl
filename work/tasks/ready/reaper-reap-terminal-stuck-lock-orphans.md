## Why

A lock that is `stuck` while its item is TERMINAL on `main` (`done`/`dropped`/`brief-tasked`) currently orphans forever. `reconcileItemLockAgainstMain` (packages/dorfl/src/item-lock.ts ~L1004-1014) returns `outcome: 'kept-stuck'` for `terminalOnMain && state==='stuck'`, and `reapStaleItemLocks` (~L1392+) reaps ONLY the `cleared-stale` class (terminal-on-main + active). So a stuck build that later reaches `done/` by ANY path (human finish, re-drive, manual fixup+merge) leaves a permanent orphan lock the auto-reaper refuses to touch.

Concrete incidents:
- `slice-claim-cas-spinner` (2026-06-19 → cleared 2026-06-20 by manual `git push origin --delete refs/dorfl/lock/…`, PR #140).
- Re-confirmed 2026-06-28 on a `task-apply-rung-merge-disposition`-shaped orphan; the manual `dorfl release-lock` escape hatch now works for current-vocabulary lock entries, but the AUTO-reaper carve-out is still unbuilt.

The cited ADR `ledger-status-on-per-item-lock-refs` already says the durable `main` record is authoritative over a stale lock and explicitly allows `done` + `stuck` to co-exist during a rebase-conflict bounce. Auto-reaping the terminal+stuck case is the reaper honoring that recovery rule.

## Contract change (this is NOT a pure bugfix)

This loosens the load-bearing "stuck means a human must look at the WORK, so it is NEVER auto-cleared" invariant. The carve-out is narrow and MUST be preserved:

- `stuck` + item TERMINAL on `main` (`done`/`dropped`/`brief-tasked`) => REAPABLE (work is finished + durably recorded on main; the lock is now an orphan, not a signal).
- `stuck` + item NON-TERMINAL on `main` => STILL KEPT, exactly as today. This is the case that genuinely needs human attention and must never be auto-reaped.

Split the `kept-stuck` outcome in `reconcileItemLockAgainstMain` into two distinct outcomes so the reaper can act on one and not the other (e.g. `cleared-stuck-terminal` / `reapable-stuck-terminal` vs. keep `kept-stuck` reserved for stuck+in-flight). Extend `reapStaleItemLocks` to reap the new terminal-stuck class alongside `cleared-stale`.

## Scope

1. `packages/dorfl/src/item-lock.ts`:
   - `reconcileItemLockAgainstMain`: classify `stuck` + terminal-on-main as its OWN reapable outcome (not `kept-stuck`). Keep `kept-stuck` semantics for stuck + non-terminal only.
   - `reapStaleItemLocks`: broaden the reap fence to include the new terminal-stuck outcome. Keep the log/summary shape sensible (probably a distinct `[reaped-stuck-terminal]` marker vs the existing `[cleared-stale]`, so operators can see which orphan class was hit).
2. Pin tests (the whole point of a contract change is a pinning test):
   - terminal-on-main + stuck lock => reaped by `gc --ledger --reap-stale-locks`.
   - non-terminal + stuck lock => STILL kept (not reaped). This is the invariant we must not regress.
   - existing `cleared-stale` (terminal + active) behavior unchanged.
   - existing `kept-in-flight` (active + non-terminal) behavior unchanged.
3. ADR note ratifying the extension. The existing ADR `ledger-status-on-per-item-lock-refs` authorises "main is authoritative" but does NOT by itself say a stuck lock should be auto-cleared; add an ADR (or an addendum, whichever fits the repo's ADR style) explicitly recording: terminal-on-main + stuck is now an auto-reapable orphan class, with the carve-out that stuck + non-terminal remains human-only.

## Cross-refs (put these in the ADR + code comments where useful)

- Lock-side twin of the branch-side observation `gc-remote-branches-cannot-reap-squash-merged-work-branch-2026-06-28` — same orphan root shape (durable `main` record says terminal, but a narrower ancestry-only / active-only predicate can't see it). Fixing both aligns the reaper on the "main record is authoritative" rule.
- Sibling `release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries` — the manual escape hatch that once blocked hand-clearing this same orphan; not in scope here but worth mentioning in the ADR as the complementary recovery path (human-recovery is fixed for current-vocabulary entries; this task closes the AUTO-recovery gap).
- Sibling observation `reaper-no-lock-outcome-benign-not-lost` (the `no-lock` mislabel, now a task) — same reaper surface, different classification bug; don't conflate.

## Acceptance

- `pnpm -r build && pnpm -r test && pnpm format:check` green.
- New tests pin BOTH directions of the contract change (terminal-stuck reaped; in-flight-stuck kept).
- ADR (or addendum) landed recording the contract loosening + the carve-out.
- Code comments at the classification site and reap fence point at the ADR so the next reader sees why `stuck` is now conditionally reapable.