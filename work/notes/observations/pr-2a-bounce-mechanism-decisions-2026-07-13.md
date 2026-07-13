---
title: PR-2a bounce-atomic-cutover — non-obvious in-scope decisions
date: 2026-07-13
---

Decisions taken while building `bounce-atomic-cutover-retire-stuck-lock` (PR-2a).
Linked from the done record. Not ADR-worthy on their own (the underlying design
lives in ADR `ledger-status-on-per-item-lock-refs` § Addendum + the spec
`surface-stuck-as-questions-and-retire-stuck-lock-state`), but each is a
choice a reviewer might reasonably ask about.

## D-A. Classifier fold reuses the existing `cleared-stale` outcome (no new `ReconcileOutcome` value)

The PR-2a fold on `classifyItemLockAgainstMain` /
`reconcileItemLockAgainstMain` treats a NON-terminal `active` lock over an
item SURFACED on `<arbiter>/main` (`needsAnswers:true` body + matching
sidecar) as `cleared-stale`, reusing the existing outcome rather than
introducing a `cleared-crash-orphan`. Rationale: the reap end-state is
identical (`isReapableTerminalOrphan(cleared-stale) === true`), and adding a
new enum value would ripple through `formatItemLockReport` /
`itemLockReportNeedsAttention` / the `ReapOutcome` mapping / the `cli.ts`
help copy for no reap-behaviour delta. The crash-window distinction lives in
the `ReconcileResult.message` field (`"CRASH-WINDOW ORPHAN — SURFACED …"`);
`terminalOnMain: false` also distinguishes the arm mechanically for any
future caller that keys off both fields. Alternative considered: add
`cleared-crash-orphan`; rejected as invasive relative to the PR-2a goal
(the mechanism, not the vocabulary).

## D-B. `resumeItemLock` on a crash-orphan returns `transitioned` (ref cleared)

The additive wiring inside `resumeItemLock`: an `active` held lock whose item
is surfaced on `<arbiter>/main` (non-terminal) is cleared via the SHARED
`leasedDeleteLockRef` and reported as `outcome: 'transitioned'` with a
crash-window message, rather than `not-held` or a new outcome. Rationale:
`transitioned` matches the parallel established by `requeueItemLock` (which
also removes the entry and returns `transitioned`); the ref genuinely moved
state (held → cleared) at OUR call site. The alternative `not-held` would
falsely say "there was nothing to release," which is wrong — the CAS was
ours. This preserves the existing `wrong-state` path for a genuinely-active
NOT-surfaced hold (the 84-assertion invariant).

## D-C. `resumeItemLock` fetches `<arbiter>/main` before probing (was not fetched before)

`fetchHeldEntry` only refreshes the lock ref namespace; the surfaced-on-main
probe now added would otherwise read a stale local tracking ref. Added a
soft `git fetch --quiet <arbiter>` right before the probe. Cost: one extra
fetch on the `active` branch of `resumeItemLock`; benign (only fires when
the lock is active, which is the exceptional case for `resume`).

## D-D. `surfaceStuckToNeedsAttention.itemPath` is now optional (additive, no caller break)

PR-1 defined `itemPath: string` as required. PR-2a makes it optional and,
when absent, uses `resolveBounceItemBodyPathOnMain` (the D1 probe). All
existing PR-1 tests continue to pass an explicit `itemPath` and keep working
unchanged. Body-absent (probe returns `undefined`) surfaces a distinct
`bodyAbsent: true` on the result AND still releases the lock — the
"no dead-end held lock" invariant of the D1 decision. No caller signature
change (D1's rule): PR-2b's seam re-point will call this without
`itemPath` and let the probe resolve.

## D-E. Duplicated D1 probe order between `needs-attention.ts` and `item-lock.ts`

`isItemSurfacedOnMain` inside `item-lock.ts` inlines the same
task/spec/observation folder list as `resolveBounceItemBodyPathOnMain` in
`needs-attention.ts` (rather than importing). Rationale: importing across
these two files would introduce a cyclic import
(`needs-attention.ts` already imports from `item-lock.ts`). The list is
tiny and closed; the two must stay in sync. If PR-2b or later extends the
probe order, both sites move together. Alternative considered: extract a
`bounce-probe.ts` module both import — deferred as unnecessary churn for a
2-entry table.

## What's NOT decided here (PR-2b territory)

The three bounce seams (`applyNeedsAttentionTransition` /
`applyTreelessNeedsAttentionTransition` / `releaseTaskingLock`) are
UNTOUCHED per PR-2a's green-split rule. `bounceToStuckLock` and
`markStuckItemLock` still exist; the 84 pinned
`stuckLockOnArbiter(...).toBe(true)` assertions are untouched and green.
The seam flip + assertion migration + exit-code flip land atomically as
PR-2b.
