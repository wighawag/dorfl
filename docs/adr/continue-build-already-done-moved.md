---
title: 'Continue-build on an already-done-moved branch is its own lifecycle state — `source: ''done''`, skip the move, exempt the move-reconcile'
status: accepted
created: 2026-06-17
decided: 2026-06-17
supersedes:
superseded_by:
---

# ADR: The CONTINUE-BUILD lifecycle state (`source: 'done'`) — a third build source for a dirty continue whose task is already in `work/tasks/done/`

## Context

A REQUEUED task that is CONTINUED runs on a kept work branch whose prior
attempt ALREADY `git mv`'d the task into `work/tasks/done/` and committed. If the
continue-agent produces NEW uncommitted source edits this run, two earlier
states are both wrong:

- **Silent recover** (task
  `autonomous-path-auto-recovers-already-committed-stranded-branch`): the
  folder-shape stranded-done auto-detect fires, the recover skips the
  build/commit steps, and the new work is SILENTLY DISCARDED — the exact live
  incident at
  `work/observations/recover-already-committed-discards-continue-agent-new-work.md`.
- **Needs-attention bounce** (blocker task
  `recover-autodetect-gated-on-nothing-to-commit`): a dirty tree gates the
  recover off and surfaces a continue-specific needs-attention with the
  recovery advice. No data loss — but no auto-land either, so a normal continue
  needs human intervention to finish.

The build path's source contract pre-this-task hard-typed
`source: 'in-progress' | 'needs-attention'`; both presuppose a FIRST-TIME
`git mv → work/tasks/done/` on this commit. A continue on a kept branch with the slug
ALREADY in `done/` is structurally outside that contract: the step-2 `git mv`
cannot run, and the reconcile arms (`readArbiterLedgerPlacement` +
`reconcileDivergentDoneMove`) reason about a move this commit DID NOT make.

## Decision

Add a THIRD source state — `source: 'done'`, the **continue-build** state — to
`IntegrationCoreInput`. The state means: the task is already in
`work/tasks/done/` on the kept branch (a prior attempt moved it), and THIS run
produced new uncommitted source edits to LAND on top.

On `source: 'done'` the integration core:

1. **SKIPS the step-2 `git mv`.** The slug is already in `done/`; there is
   nothing to move. The subsequent `git add -A` folds the agent's new edits
   into one atomic commit on top of the kept already-done-moved tip.
2. **EXEMPTS the originTrust read** that forces propose on an untrusted task
   on a `merge` config. The prior attempt's build transition already went
   through that checkpoint (it proposed if untrusted); the continue-build is
   layered on top of the kept tip and inherits that earlier decision.
3. **EXEMPTS the arbiter ledger placement pre-check + divergent-done-move
   reconcile** (`readArbiterLedgerPlacement` /
   `reconcileDivergentDoneMove`). Both reason about reconciling a move just
   made against the arbiter's placement; there is NO first-time move on this
   commit (the slug is in `done/` on both sides already). The sibling-ledger
   reconcile is NOT exempted — it covers OTHER slugs' ledger files and is
   independent of this slug's move semantics.
4. **STILL RUNS** prepare → gate → `git add -A` → commit → rebase → integrate
   on the new work, byte-for-byte the build path otherwise.

`complete.ts` resolves `source: 'done'` exactly when the blocker's gate detected
"dirty + done-stranded" (folder-shape stranded AND the working tree has
uncommitted source edits), replacing the needs-attention bounce. The
`committedRecovery` clean-strand fast-path, the `recovering` needs-attention
re-finish, and the explicit `complete --isolated` recover are UNCHANGED, as is
the unspoofable `isAncestor` already-integrated no-op.

### Why this contract — over the alternatives considered

- **Option A (chosen) — explicit `source: 'done'`.** The source axis already
  names which folder a build integrates FROM; adding the third folder it can
  integrate from extends the existing axis with the existing vocabulary
  (status = folder, mirrored from CONTEXT.md). The exemptions live AT the
  axis they belong to: the move/reconcile are conditioned on `source !==
  'done'` exactly where they live. New concept count: ZERO.
- **Option B — reuse the `IntegrationLifecycle` seam.** Rejected. `lifecycle`
  means NON-TASK throughout the core (spec tasking / intake emit — a file
  landing on `main` is inert); a continue-build IS a task build (it runs the
  gate, integrates code, can be `merge`d on the operator's flag). Riding the
  non-task seam to carry task-build state would silently re-mean the
  concept and bleed exemptions intended for non-task transitions into a
  task path. Conceptual coherence is a first-class quality (CONTEXT.md
  §Coherence); rejected on coherence alone.
- **Option C — mutate-then-restore (`done → in-progress → done`).** Rejected.
  A hidden `git mv done → in-progress` to satisfy the existing `source:
  'in-progress'` contract would (a) desync the arbiter placement check
  against a moved-then-unmoved local state, (b) require an
  apply-then-revert dance the rebase reasoning is not designed for, and
  (c) hide the structurally-new state from the contract — every later
  reader has to re-derive the trick. The explicit contract is cheaper
  forever.

## Consequences

- A dirty continue on an already-done-moved branch AUTO-LANDS via the normal
  build path; no data loss, no bounce.
- The clean-strand recover (`committedRecovery`), the needs-attention re-finish
  (`recovering`), and `complete --isolated` are unchanged — each remains the
  right answer for its own state. `committedRecovery` and `source: 'done'` are
  mutually exclusive by construction (a dirty tree resolves the latter, a
  clean tree the former).
- The continue-build commit subject keeps the `; done` transition tag — the
  task REMAINS in `done/`; the continuation is more `done` work on top, not a
  new lifecycle. A future task could introduce `; continued` if a per-attempt
  audit signal becomes useful; deferred.
- The originTrust exemption is deliberately consistent with this state's
  "no first-time move" rationale, not with the
  `untrusted-origin-build-checkpoint` ADR's "follow the build wherever it
  integrates from" principle. The trade-off: a continue-build cannot
  re-checkpoint an untrusted task on a `merge` config — but the kept tip's
  first attempt ALREADY checkpointed it (it proposed), so the continue commit
  is a continuation of that proposed work, not a fresh build that bypasses
  the checkpoint. The reviewer should flip this if the trade-off goes the
  other way for them.
