---
title: review-gate non-blocking nits for 'reaper-no-lock-outcome-benign-not-lost' (Gate 2 approve)
date: 2026-06-20
status: open
reviewOf: reaper-no-lock-outcome-benign-not-lost
needsAnswers: false
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

## Applied answers 2026-06-22

### q1: Nit #1: ratify the JSDoc on `reapReportNeedsAttention` as the recorded exit-code contract, or require a `## Decisions` block be added to the done record / an ADR?

KEEP — ratify the JSDoc on `reapReportNeedsAttention` as the recorded exit-code contract. The contract is durably captured in the code next to the predicate it governs; that satisfies the spirit of the acceptance criterion. (The missing literal `## Decisions` block is part of a recurring pattern being captured as one meta-observation rather than reopened per-slice.) Disposition: keep.

disposition: keep

### q2: Nit #2: is the new `reconcileItemLockAgainstMain` behaviour (extra `git ls-remote` round-trip on every leased-delete rejection, plus local `update-ref -d` of a stale tracking ref when the remote ref is empty) the intended contract for ALL callers (recovery, not just the reaper), or should it be refactored into a reaper-internal helper?

promote-slice, option (ii): DOCUMENT the broadened contract on `reconcileItemLockAgainstMain` and AUDIT non-reaper callers for the `error`→`no-lock` shape change. This is the one genuine non-churn item in this sidecar: the extra `ls-remote` round-trip + local stale-ref drop now fire for ALL callers (including recovery), so a rejected leased delete that used to surface as `error` may now surface as `no-lock` — a real shared-behaviour change worth pinning + auditing. A full rename/split (option i) is likely over-engineering given the codebase already separates the read-only classifier from this mutating reconcile. Disposition: promote-slice.

### q3: Nit #3: accept the predicate-boundary regression guard, or require an end-to-end test that exercises the real-race code path inside `reconcileItemLockAgainstMain` (the new `else` after the `remoteEmpty` check)?

KEEP — accept the predicate-boundary regression guard as a deliberate trade-off. Exposing a TOCTOU seam purely to drive an end-to-end test of the real-race branch is a poor trade (production complexity for test-only benefit). Revisit only if the real-race branch regresses in the wild. Disposition: keep.

disposition: keep

### q4: After per-nit triage, what is the terminal routing for this observation as a whole?

DELETE — once the nits are dispositioned (Q1 keep, Q2 promoted to a follow-up slice, Q3 keep) the observation has served its purpose. Delete it rather than leave a stale open note, CONTINGENT on Q2's follow-up slice actually being created so the promote-slice content is not lost. Disposition: delete (after Q2's slice exists).

disposition: delete

## Recommended: delete

A human answered "delete": this item can be removed (git history is the archive). The agent leaves the deletion to the human per the capture-bucket contract.
