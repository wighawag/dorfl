---
title: review-gate non-blocking nits for 'reconcile-stale-needs-attention-folder-prose-after-lock-cutover' (Gate 2 approve)
date: 2026-07-10
status: open
reviewOf: reconcile-stale-needs-attention-folder-prose-after-lock-cutover
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'reconcile-stale-needs-attention-folder-prose-after-lock-cutover' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Priority-2 docstring drift missed at three sites the task's file names had drifted for: tasking.ts:1125 and :1144 (task listed these as slicing.ts:1086/:1105 — the file was renamed), and tasker-review-loop.ts:78 (task listed slicer-review-loop.ts:62). All three still say the spec is 'routed to work/needs-attention/'. Also failure-cause.ts:5 ('routes to work/needs-attention/') — not on the task list but same drift class. Task marks P2 as 'fix if cheap' and these are pure docstrings, not user-visible; worth a mop-up follow-up.
  (grep 'to work/needs-attention' src/ → src/tasking.ts:1125,1144, src/tasker-review-loop.ts:78, src/failure-cause.ts:5)
- test/work-layout-guard.test.ts:213 uses the OLD prose 'surfaced to work/needs-attention/ on' as a should-NOT-flag example. The test still passes (it exercises the path-literal detector, not the exact string), but the example is now stale vs the reworded runtime string ('marked stuck on its per-item lock ...') this task landed in complete.ts. Cheap to refresh next pass.
  (packages/dorfl/test/work-layout-guard.test.ts:213 quoted string vs the new complete.ts surfaceAutonomousStrand message.)
- No Decisions block in the PR description. The one in-scope choice — the standardised wording 'marked stuck on its per-item lock (...); requeue once resolved' — mirrors the phrasing #243 already established in do.ts, so it is coherent and low-risk; still worth surfacing so a human can ratify the wording as the canonical replacement for the retired 'routed to work/needs-attention/' idiom.
  (git log ef912302 shows a bare commit message with no Decisions section; diff introduces the new phrasing across integration-core.ts, complete.ts, start.ts, ledger-write.ts.)
