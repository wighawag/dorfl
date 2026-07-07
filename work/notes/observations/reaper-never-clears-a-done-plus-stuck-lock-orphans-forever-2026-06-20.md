---
title: the stale-lock reaper never clears a lock that is TERMINAL-on-main + STUCK, so a stuck lock for an item that has since reached done/ orphans forever (only cleared-stale = terminal+active is reaped)
type: observation
status: spotted
spotted: 2026-06-20
slug: reaper-never-clears-a-done-plus-stuck-lock-orphans-forever
needsAnswers: true
---

## What was seen

A lingering lock `refs/dorfl/lock/slice-claim-cas-spinner` survived
`gc --ledger --reap-stale-locks`. The lock entry:

```
entry: slice-claim-cas-spinner
action: implement
state: stuck
since: 2026-06-19T16:09:06Z
reason: continuing the kept work/slice-claim-cas-spinner: rebase ... conflicted ...
```

The item `claim-cas-spinner` is TERMINAL on `main` (it is in `work/tasks/done/`, merged
2026-06-20 via PR #140). So this is a `done`-on-main + `stuck`-lock combination. The
reaper did not clear it; it had to be removed by a manual
`git push origin --delete refs/dorfl/lock/slice-claim-cas-spinner`.

## Root cause (verified against item-lock.ts)

`reapStaleItemLocks` reaps ONLY the `cleared-stale` class = TERMINAL-on-main + `active`.
Its scope fence explicitly NEVER reaps a `kept-stuck` (terminal + stuck) or a
`kept-in-flight` (active + non-terminal), because a stuck lock normally means "a human
must look at the WORK". So a TERMINAL + STUCK lock is, by construction, never reaped.

But the ADR `ledger-status-on-per-item-lock-refs` explicitly allows `done` + `stuck` to
CO-EXIST (a just-completed item bounced on a rebase-conflict) and says recovery should
treat the `main` durable record as AUTHORITATIVE over a stale lock. The reaper does not
apply that rule to the stuck case: once the item is `done`, a `stuck` lock is no longer
"needs attention on the work" (the work is done + merged) \u2014 it is a stale orphan that
the durable `main` record should authorise clearing. As shipped, the only way to clear
it is a hand-run `release-lock` (and even THAT is blocked here \u2014 see the sibling
observation on pre-cutover lock entries being un-releasable).

## Why it matters

A stuck build that later reaches `done/` by ANY path (a human finishes it, a re-drive
lands it, a manual fixup+merge like PR #140) leaves a permanent orphan lock the reaper
refuses to touch. Orphan locks are exactly what the reaper exists to clean; the
done+stuck case slips through its fence. Over time a repo accumulates un-reapable stuck
locks for long-since-done items.

## Suggested fix shape (decide when slicing)

Extend the reaper (or `reconcileItemLockAgainstMain`'s classification) so a `stuck` lock
whose item is TERMINAL on `main` (`done`/`dropped`/`brief-tasked`) is treated as a
reapable stale orphan (the `main` record is authoritative \u2014 the ADR's recovery rule),
DISTINCT from a `stuck` lock whose item is still non-terminal (which genuinely needs
human attention and must still NEVER be auto-reaped). I.e. split `kept-stuck` into
"stuck + terminal => reapable" vs "stuck + in-flight => keep". Pin with a test: a
done-on-main item with a lingering stuck lock is reaped; a non-terminal stuck lock is
still kept.

## Refs

- `packages/dorfl/src/item-lock.ts` \u2014 `reapStaleItemLocks` scope fence
  (`cleared-stale` only) + `reconcileItemLockAgainstMain` classification.
- `docs/adr/ledger-status-on-per-item-lock-refs.md` \u2014 `done` + `stuck` co-existence +
  "main record authoritative over a stale lock".
- Sibling: `reaper-no-lock-outcome-benign-not-lost` (the `no-lock` mislabel, now a task)
  and `release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries` (why a manual
  `release-lock` could not clear THIS one either).
- The incident: the orphaned `slice-claim-cas-spinner` lock from PR #140's stranded
  build (2026-06-19), cleared by a manual ref-delete 2026-06-20.

## Applied answers 2026-06-22

### q1: How should this observation be dispositioned: promote to a slice that extends the reaper to treat stuck+terminal-on-main locks as reapable (split kept-stuck into stuck+terminal => reapable vs stuck+in-flight => keep, with a pinning test), keep as an open observation, or another route?

promote-slice, but treat it as a CONTRACT change, not a pure bugfix. Verified: the reaper reaps ONLY the `cleared-stale` class (terminal-on-main + active) and never `kept-stuck` (terminal + stuck), so a `done` + stuck lock orphans forever. The fix — split `kept-stuck` into stuck+terminal (reapable) vs stuck+in-flight (keep), with a pinning test that the non-terminal stuck case still NEVER reaps — loosens the load-bearing "stuck is never auto-cleared, it means human attention" invariant. So ship it WITH the carve-out + pin test AND an ADR note ratifying that terminal-on-main + stuck is now reapable (the cited ADR authorises "main is authoritative" but does not by itself say a stuck lock should be auto-cleared, so record the extension explicitly). Cross-ref the release-lock escape-hatch sidecar (same orphan, complementary recovery path). Disposition: promote-slice (as a contract change).

## Update 2026-06-28 — re-confirmed still NOT auto-reaped; manual release-lock path DOES work now

Hit the SAME class again while clearing a stale-lock backlog by hand: a
`task-apply-rung-merge-disposition` lock sat at `implement/stuck` while the item
rested in `work/tasks/ready/` (non-terminal at that moment), and `gc --ledger
--reap-stale-locks` correctly KEPT it (`[kept] … [implement/stuck]`). That part
is the non-terminal stuck case, which must stay kept — fine.

The ORIGINAL defect (terminal-on-main + stuck = orphan the auto-reaper refuses)
is STILL present in code: `reconcileItemLockAgainstMain` in
`packages/dorfl/src/item-lock.ts` (~L1004-1014) still returns `outcome:
'kept-stuck'` for `terminalOnMain && state==='stuck'`, and `reapStaleItemLocks`
(L1392+) still reaps ONLY `cleared-stale`. So the promote-slice above is NOT yet
built — the carve-out (stuck+terminal => reapable) does not exist.

What HAS changed (the "might be fixed already" nuance): the MANUAL escape hatch
works now. `dorfl release-lock task:apply-rung-merge-disposition` cleared the
stuck lock cleanly (`refs/dorfl/lock/… deleted on origin`), so the sibling
`release-lock-cannot-name-pre-cutover-slice-prefixed-lock-entries` bug that once
blocked even the hand-clear is no longer in the way for current-vocabulary lock
entries. So: human-recovery = fixed; AUTO-reaper carve-out = still open. The
promote-slice for the auto-reaper extension remains valid.

See also the branch-side twin spotted the same day:
`gc-remote-branches-cannot-reap-squash-merged-work-branch-2026-06-28` (the
remote `work/<slug>` branch orphan from a squash merge — same root shape: the
durable `main` record says terminal, but the ancestry-only predicate can't see
it).
