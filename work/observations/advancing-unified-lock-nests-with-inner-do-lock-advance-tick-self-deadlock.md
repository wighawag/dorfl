---
title: advancing-acquires-unified-lock self-deadlocks the advance tick (the advancing hold NESTS with the inner do's unified lock)
date: 2026-06-18
status: open
prd: ledger-status-per-item-lock-refs
relatesTo: [advancing-acquires-unified-lock, release-lock-verb-and-gc-stuck-report, retire-transient-folders-and-drop-rebase]
blocks: [advancing-acquires-unified-lock, release-lock-verb-and-gc-stuck-report, retire-transient-folders-and-drop-rebase]
---

## What was noticed

Driving slice #5 `advancing-acquires-unified-lock` (interim dual-write) STOPped at
build time with a verified architectural collision the slice (and the PRD's slicing)
did not anticipate.

`performAdvance` (`packages/agent-runner/src/advance.ts`) is a DRIVER layered on top
of `do`: it (1) classifies the rung, (2) takes `acquireAdvancingLock` keyed on the
item's `<type>-<slug>`, then (3) for the `build-slice` and `slice-prd` rungs it
ORCHESTRATES the inner `performDo(...)`, which ITSELF acquires the SAME unified
per-item lock:

- build-slice: the advancing hold is unified `slice-<slug>`; the inner
  `performDo('slice:<slug>')` → `performClaim` → `acquireItemLock({item:'slice:<slug>',
  action:'implement'})` loses the create-only CAS on the ref its OWN outer wrapper
  already holds.
- slice-prd: the advancing hold is unified `prd-<slug>`; the inner
  `performDo('prd:<slug>')` → `acquireSlicingLock` → unified `prd-<slug>` loses for
  the same reason.

So the advancing lock and the inner `do` lock are NESTED (one logical operation),
not two racers. Because we deliberately made a lock `lost` STRICTLY DEFINITIVE with
NO auto-steal / no re-entrancy (claim slice #3 fix + the ADR's "no auto-sweep; a
human asserts a lock is dead"), the inner acquire definitively returns `lost` and
the advance tick DEADLOCKS AGAINST ITSELF.

Evidence: implementing the slice exactly as written (mirroring the landed
`slicing-acquires-unified-lock`) made 9 previously-green advance-tick tests fail
(`test/run-uses-advance-tick.test.ts` claimedAndDone/needsAttention drop to 0;
`test/advance-registry-set.test.ts` multi-mirror build/slice batches). Pure-unit
advance∥claim / advance∥slice race tests + the stuck-cell test all pass; only the
advance-tick ORCHESTRATION path breaks. The slicing slice (#4) avoided this only
because it left the advancing lock as a plain marker (no unified hold), so the
`slice-prd` wrapper did not contend with the inner slicing lock. #5 is the first to
put a unified hold on the OUTER advancing wrapper.

## The fork (needs a human decision; blocks #5, #8, #9)

(a) `performAdvance` takes the unified lock ONLY for the tree-less rungs
    (surface / apply / triage — which have no inner `do` lock), and does NOT take it
    for the build-slice / slice-prd rungs (whose inner claim/slice is the single
    exclusion point). Scoped, ADR-faithful (no re-entrancy hack), touches `advance.ts`.

(b) Make the inner `do` recognise a unified lock already held by the SAME driving
    operation as re-entrant (a same-process driver token). Touches
    `claim-cas.ts`/`slicing-lock.ts` and brushes the no-auto-steal ADR unless tightly
    scoped to an in-process token.

Recommendation (conductor): option (a). The build-slice/slice-prd rungs are pure
orchestration of an inner `do` that ALREADY takes the unified lock — that inner
claim/slice IS the exclusion point, so the outer advancing hold is redundant for
those rungs and only the tree-less rungs (which have no inner `do`) genuinely need
the unified hold to realise issue-3 exclusion. This keeps the ADR's no-re-entrancy
posture intact and confines the change to `advance.ts`. The slice text must then
state: advancing takes the unified lock ONLY for the tree-less rungs; the
build/slice rungs rely on the inner `do`'s lock; the legacy `advancing/` marker
dual-write stays for ALL rungs until #9.

## Disposition

Park #5 in the stuck-set pending the human's choice of (a)/(b). #8 (release-lock,
deps #5) and #9 (capstone, deps #5) stay blocked behind it. #6
(needs-attention-as-stuck-lock-state, deps #2/#3 only) is INDEPENDENT and continues.
