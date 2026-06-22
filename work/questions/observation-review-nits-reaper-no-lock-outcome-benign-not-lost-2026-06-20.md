<!-- agent-runner-sidecar: item=observation:review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20 type=observation slug=review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20 allAnswered=false -->

## Q1

**Nit #1: ratify the JSDoc on `reapReportNeedsAttention` as the recorded exit-code contract, or require a `## Decisions` block be added to the done record / an ADR?**

> Acceptance criterion #4 of 'reaper-no-lock-outcome-benign-not-lost' asked for a `## Decisions` block recording the reaper's exit-code contract (0 when all stale locks reaped and only healthy in-flight locks remain; 1 when a `kept-stuck` survives or a delete genuinely lost / errored; `already-reaped` is benign). The done record `work/tasks/done/reaper-no-lock-outcome-benign-not-lost.md` has no `## Decisions` section and the commit body is empty; the contract IS captured as a JSDoc comment on `reapReportNeedsAttention` in `packages/agent-runner/src/item-lock.ts`, satisfying the spirit but not the letter.

_Suggested default: keep — ratify the JSDoc as the recorded contract (spirit satisfied, code is the durable home; no slice needed)_

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

KEEP — ratify the JSDoc on `reapReportNeedsAttention` as the recorded exit-code contract. The contract is durably captured in the code next to the predicate it governs; that satisfies the spirit of the acceptance criterion. (The missing literal `## Decisions` block is part of a recurring pattern being captured as one meta-observation rather than reopened per-slice.) Disposition: keep.

## Q2

**Nit #2: is the new `reconcileItemLockAgainstMain` behaviour (extra `git ls-remote` round-trip on every leased-delete rejection, plus local `update-ref -d` of a stale tracking ref when the remote ref is empty) the intended contract for ALL callers (recovery, not just the reaper), or should it be refactored into a reaper-internal helper?**

> Change is in `packages/agent-runner/src/item-lock.ts` around the new `remoteEmpty` branch in the leased-delete rejection arm. It (a) changes outcome shape for non-reaper callers — a rejected leased delete that used to surface as `error` may now surface as `no-lock`, and (b) mutates local refs as a side-effect of a function whose name suggests a read-style reconcile.

_Suggested default: promote-slice — at minimum a small slice to either (i) rename / split into a reaper-internal helper, or (ii) document the broadened contract on the function and audit non-reaper callers for the new `error`→`no-lock` shape_

<!-- q2 fields: id=q2 disposition=promote-slice -->

**Your answer** (write below this line):

promote-slice, option (ii): DOCUMENT the broadened contract on `reconcileItemLockAgainstMain` and AUDIT non-reaper callers for the `error`→`no-lock` shape change. This is the one genuine non-churn item in this sidecar: the extra `ls-remote` round-trip + local stale-ref drop now fire for ALL callers (including recovery), so a rejected leased delete that used to surface as `error` may now surface as `no-lock` — a real shared-behaviour change worth pinning + auditing. A full rename/split (option i) is likely over-engineering given the codebase already separates the read-only classifier from this mutating reconcile. Disposition: promote-slice.

## Q3

**Nit #3: accept the predicate-boundary regression guard, or require an end-to-end test that exercises the real-race code path inside `reconcileItemLockAgainstMain` (the new `else` after the `remoteEmpty` check)?**

> In `packages/agent-runner/test/gc-reap-stale-locks.test.ts` the genuine-`lost` regression guard feeds a synthetic `ReapReport` to `reapReportNeedsAttention` rather than reproducing a leased-delete rejection where the ref moved to a different sha. The test itself notes a deterministic end-to-end repro needs a TOCTOU window not exposed for testing, so the contract is pinned at the predicate boundary; the real-race branch is unexercised by this diff.

_Suggested default: keep — accept the predicate-boundary pin as a deliberate trade-off (the alternative requires exposing a TOCTOU seam purely for testing); revisit only if the real-race branch regresses in the wild_

<!-- q3 fields: id=q3 disposition=keep -->

**Your answer** (write below this line):

KEEP — accept the predicate-boundary regression guard as a deliberate trade-off. Exposing a TOCTOU seam purely to drive an end-to-end test of the real-race branch is a poor trade (production complexity for test-only benefit). Revisit only if the real-race branch regresses in the wild. Disposition: keep.

## Q4

**After per-nit triage, what is the terminal routing for this observation as a whole?**

> Observation is `work/notes/observations/review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20.md`, status `open`, holding three non-blocking Gate-2 nits on the approved slice `reaper-no-lock-outcome-benign-not-lost`. Once each nit is dispositioned (ratify-in-place / promote-slice / etc.), the observation file itself needs a terminal disposition.

_Suggested default: delete — once each nit is individually dispositioned (e.g. nit #2 promoted to a follow-up slice, nits #1 and #3 ratified), the observation has served its purpose and can be deleted rather than kept as a stale open note_

<!-- q4 fields: id=q4 disposition=delete -->

**Your answer** (write below this line):

DELETE — once the nits are dispositioned (Q1 keep, Q2 promoted to a follow-up slice, Q3 keep) the observation has served its purpose. Delete it rather than leave a stale open note, CONTINGENT on Q2's follow-up slice actually being created so the promote-slice content is not lost. Disposition: delete (after Q2's slice exists).
