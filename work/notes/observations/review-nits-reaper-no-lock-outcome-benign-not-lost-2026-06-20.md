---
title: review-gate non-blocking nits for 'reaper-no-lock-outcome-benign-not-lost' (Gate 2 approve)
date: 2026-06-20
status: open
reviewOf: reaper-no-lock-outcome-benign-not-lost
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'reaper-no-lock-outcome-benign-not-lost' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- The acceptance criterion asks for a `## Decisions` block (in the done record / PR description, or an ADR) recording the reaper's exit-code contract — but the done record `work/tasks/done/reaper-no-lock-outcome-benign-not-lost.md` has no `## Decisions` section and the commit body is empty. The contract IS captured as a JSDoc comment on `reapReportNeedsAttention` ("exits 0 when all stale locks are reaped and only healthy in-flight locks remain; exits 1 when a `kept-stuck` survives or a delete genuinely lost the race / errored; `already-reaped` is benign"), which satisfies the spirit, but the explicit ask was a `## Decisions` block discoverable from the work artifacts. Human: ratify the JSDoc as the recorded contract, or ask for the Decisions block to be added.
  (task acceptance criterion #4; `packages/agent-runner/src/item-lock.ts` JSDoc on `reapReportNeedsAttention` does record the contract)
- Ratify: `reconcileItemLockAgainstMain` now does an extra `git ls-remote <arbiter> <ref>` round-trip on every leased-delete rejection, AND when the remote ref is empty it `update-ref -d`s the local stale tracking ref. This is a sensible "reconcile the local view too" choice but it (a) changes the function's outcome shape for non-reaper callers — a rejected leased delete that used to surface as `error` may now surface as `no-lock`, and (b) mutates local refs as a side-effect of a function whose name suggests a read-style reconcile. Worth a human glance to confirm this is the intended contract of `reconcileItemLockAgainstMain` for ALL its callers (recovery, not just the reaper), not just a reaper-internal helper.
  (packages/agent-runner/src/item-lock.ts around the new `remoteEmpty` branch in the leased-delete rejection arm)
- Ratify: the genuine-`lost` regression guard is a synthetic `ReapReport` fed to `reapReportNeedsAttention`, not an end-to-end repro of a leased-delete rejection where the ref moved to a DIFFERENT sha. The test itself notes this ("reproducing a deterministic leased-delete REJECTION end-to-end requires a TOCTOU window inside `reconcileItemLockAgainstMain` that is not exposed for testing"), so we pin the contract at the predicate boundary instead. Acceptable trade-off, but the real-race code path inside `reconcileItemLockAgainstMain` (the new `else` after the `remoteEmpty` check) is not exercised by any test in this diff.
  (packages/agent-runner/test/gc-reap-stale-locks.test.ts — the second `it(...)` block)
