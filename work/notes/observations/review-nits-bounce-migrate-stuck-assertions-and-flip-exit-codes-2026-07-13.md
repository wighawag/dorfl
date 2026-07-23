---
title: 'review-gate non-blocking nits for ''bounce-migrate-stuck-assertions-and-flip-exit-codes'' (Gate 2 approve)'
date: 2026-07-13
status: open
reviewOf: bounce-migrate-stuck-assertions-and-flip-exit-codes
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'bounce-migrate-stuck-assertions-and-flip-exit-codes' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- Ratify: D3 exit-code flip was extended in complete.ts to 'prepare-failed', 'review-blocked' and 'review-unparseable' outcomes, which the task's explicit list did not name (it named agent-stopped/agent-failed/gate-failed/rebase-conflict). Correct extrapolation (they are all clean-surface bounces of the same shape) but an in-scope decision worth calling out.
  (packages/dorfl/src/complete.ts: surfaceExit() is applied to prepare-failed/gate-failed/review-blocked/review-unparseable/rebase-conflict.)
- Ratify: the retired bounceToStuckLock was renamed in-place to bounceThroughSurface (rather than removed with call sites inlined). Coherent name, but a new internal symbol.
  (packages/dorfl/src/ledger-write.ts: bounceThroughSurface() replaces bounceToStuckLock() and is what applyNeedsAttentionTransition / applyTreelessNeedsAttentionTransition now call.)
- Ratify: tasking-lock.ts adds a pre-surface readItemLock() probe so a NOT-HELD spec still returns the exit-2 'lost' contract (the old markStuckItemLock returned outcome:not-held directly; surfaceStuckToNeedsAttention does not). Preserves prior caller contract but is a new gate.
  (packages/dorfl/src/tasking-lock.ts around held===undefined branch returning {exitCode:2, outcome:'lost'}.)
- Ratify follow-up: in surface-treeless-moved-false.test.ts the 'run — moved:true happy path' assertion was relaxed to accept either 'needs-attention' or 'surface-unmoved' because runTreelessLedgerMove reports surface-unmoved in a bare-mirror worktree even though the D1 probe found the body. Recorded in work/notes/observations/pr2b-run-continue-conflict-surface-unmoved.md; may hide a small refspec bug in runTreelessLedgerMove.
  (work/notes/observations/pr2b-run-continue-conflict-surface-unmoved.md + the relaxed matcher in test/surface-treeless-moved-false.test.ts.)
- Nit: stale doc reference in ledger-write.ts JSDoc still says 'rides on {@link bounceToStuckLock} directly below' after the function was renamed to bounceThroughSurface.
  (packages/dorfl/src/ledger-write.ts:641 in the applyNeedsAttentionTransition JSDoc.)
