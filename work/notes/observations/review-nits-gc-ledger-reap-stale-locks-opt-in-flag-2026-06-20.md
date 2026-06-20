---
title: review-gate non-blocking nits for 'gc-ledger-reap-stale-locks-opt-in-flag' (Gate 2 approve)
date: 2026-06-20
status: open
reviewOf: gc-ledger-reap-stale-locks-opt-in-flag
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'gc-ledger-reap-stale-locks-opt-in-flag' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the unrecorded in-scope exit-code decision: a `--reap-stale-locks` sweep exits 0 when it reaped every stale lock and only healthy in-flight holds remain, and exits 1 when a `kept-stuck` survives or a leased delete was `lost`/`error`. The slice prompt explicitly asked to RECORD this decision per ADR-FORMAT, but the PR/commit body has no `## Decisions` block. Confirm this exit mapping is the intended contract (it mirrors the default `gc --ledger` fail-loud surface) and capture it.
  (cli.ts reaper block: `process.exit(result.duplicates.length > 0 || reapReportNeedsAttention(reap) ? 1 : 0)`, where `reapReportNeedsAttention` returns true for `kept-stuck`/`lost`/`error` entries. The decision is correct and consistent with `itemLockReportNeedsAttention`, but undocumented.)
- In a concurrent double-reap, the LOSER whose per-item `reconcileItemLockAgainstMain` re-read finds the ref ALREADY GONE returns `no-lock`, which the reaper buckets into the `else` branch as `lost` (counted toward needs-attention -> exit 1). But nothing actually needs attention: the lock was successfully reaped by the other reaper. Should a `no-lock` reconcile (already-cleared) be treated as benign (e.g. a `reaped`/no-op outcome) rather than `lost`, so a routine concurrent sweep does not false-positive into exit 1?
  (reapStaleItemLocks: the `cleared-stale` branch maps any non-`cleared-stale`/non-`kept-*` reconcile outcome (including `no-lock`) to `lost`. The two-reaper test only asserts `lost <= 1` and the ref-gone-once invariant, tolerating this. It errs on the SAFE (fail-loud) side and only manifests under concurrent double-reap (an unusual manual op), so it is non-blocking, but the `lost` label conflates 'lease genuinely lost the race' with 'already cleared, all good'.)
