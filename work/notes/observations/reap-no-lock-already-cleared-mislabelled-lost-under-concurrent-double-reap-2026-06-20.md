---
title: gc --reap-stale-locks mislabels an already-cleared lock as `lost` (concurrent double-reap → spurious exit 1)
date: 2026-06-20
status: open
priority: low
reviewOf: gc-ledger-reap-stale-locks-opt-in-flag
---

## What was noticed

While merging the opt-in reaper (PR #183, Gate-3), the Gate-2 review surfaced a real
but minor edge, ratified non-blocking at merge and recorded here.

In `reapStaleItemLocks` (`item-lock.ts`), the `cleared-stale` branch routes the
actual clear through `reconcileItemLockAgainstMain` and maps any outcome that is
NOT `cleared-stale`/`kept-stuck`/`kept-in-flight` to `lost`. That bucket includes
`no-lock` — which, under a CONCURRENT double-reap of the SAME stale lock, is what
the LOSER sees: the other reaper already deleted the ref, so the loser's re-read
returns `no-lock`. The loser then counts it as `lost`, and `reapReportNeedsAttention`
makes the sweep exit 1 — even though nothing needs attention (the lock WAS
successfully reaped, just by the other process).

So a routine concurrent `gc --ledger --reap-stale-locks` can false-positive into a
non-zero exit.

## Why it is low-priority

- It errs on the SAFE side (fail-loud, never mis-reaps or `--force`s).
- It only manifests under CONCURRENT double-reap of the same lock — an unusual
  manual operation (the reaper is a human-invoked sweep, not a daemon).
- The two-reaper test tolerates it (`lost <= 1`), so it is a known, bounded edge.

## Suggested fix

Treat a `no-lock` reconcile outcome inside the reaper's `cleared-stale` branch as
BENIGN (the lock is already gone = the desired end state), e.g. a `reaped`/`already`
no-op outcome that does NOT count toward `reapReportNeedsAttention`, distinct from a
genuine `lost` (the lease was rejected because the ref changed to a DIFFERENT value).
That separates "already cleared, all good" from "lease genuinely lost the race", so a
clean concurrent sweep exits 0. Small change to the outcome classification +
one test assertion (the loser sees `already`/benign, not `lost`).

Also (nit 1 from the same review): the reaper's exit-code contract (0 when all stale
reaped + only healthy in-flight remain; 1 when a `kept-stuck` survives or a delete
was `lost`/`error`) is correct but was not recorded in a `## Decisions` block — worth
a one-line note if this is revisited.
