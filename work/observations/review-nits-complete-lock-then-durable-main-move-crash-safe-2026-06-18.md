---
title: review-gate non-blocking nits for 'complete-lock-then-durable-main-move-crash-safe' (Gate 2 approve)
date: 2026-06-18
status: open
reviewOf: complete-lock-then-durable-main-move-crash-safe
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'complete-lock-then-durable-main-move-crash-safe' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the propose-mode lock release: in propose mode complete releases the per-item lock even though the durable move is on the pushed work branch, not on main yet, so the item is briefly neither lock-held nor terminal-on-main until the PR merges. Is releasing here (rather than holding across the PR) the intended interim behaviour?
  (complete.ts calls releaseClaimLockAfterDurableMove on the success fall-through before the merge/propose branching, and the 'still completes (and releases) on the propose path' test asserts the lock is gone while done/ is absent from main. This is CONSISTENT with the established slicing.ts:725-730 precedent (slicing releases on the propose 'completed' outcome and defers cross-PR ordering to this capstone), so it is coherent, not a fork. It was recorded only as inline comments, not in a ## Decisions block.)
- reconcileItemLockAgainstMain is built, exported, and fully tested but has no production caller (no gc/cli/run/do invokes it). Will slice #8 (release-lock-verb-and-gc-stuck-report) actually wire this function into the gc --ledger stuck-lock report / recovery surface, so the recovery runs operationally rather than only in tests?
  (grep confirms NO production CLI/gc/run/do caller of reconcile. The slice's acceptance criteria only require recovery to exist and converge (proven by tests), and the gc/CLI surface is #8's scope, so this is correctly out of THIS slice. But #8's slice body does not explicitly name reconcileItemLockAgainstMain, risking the recovery staying unwired (effectively dead in production) after #8 lands. The ADR specifies recovery surfaces via release-lock + a stuck-lock report in gc --ledger.)
- The non-obvious in-scope decisions (propose-path release semantics, the best-effort/never-fail-completion release policy, the backs-off-on-concurrent-change clear) were recorded only as inline code comments, with no ## Decisions block in the PR/commit description. Should these be lifted into a Decisions block for human ratification per the slice template?
  (git log body for 1f673cd is empty and the slice file has no Decisions section; the slice prompt explicitly says 'Record non-obvious in-scope decisions per the slice template.' The decisions are well-documented in code comments, so this is a process/visibility nit, not a correctness gap.)
