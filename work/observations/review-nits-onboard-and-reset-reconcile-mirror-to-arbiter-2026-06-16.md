---
title: review-gate non-blocking nits for 'onboard-and-reset-reconcile-mirror-to-arbiter' (Gate 2 approve)
date: 2026-06-16
status: open
slug: onboard-and-reset-reconcile-mirror-to-arbiter
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'onboard-and-reset-reconcile-mirror-to-arbiter' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the offline fallback policy: when `git ls-remote <arbiter>` exits non-zero (unreachable arbiter / offline), `branchAheadOfArbiter` falls back to the local `branchAheadOf` — meaning a stale tracking ref CAN still drive a continue while offline. The slice does not specify offline behaviour. The chosen direction (best-effort, same as today) is reasonable but is an in-scope decision the agent made on its own and should be ratified (or reversed to e.g. 'refuse to continue without arbiter confirmation').
  (packages/agent-runner/src/continue-branch.ts — `branchAheadOfArbiter`, the `if (ls.status === 0) … else fallback to branchAheadOf` arm. The PR description has no Decisions block recording this.)
- Ratify adding a `git ls-remote` round-trip to EVERY onboard path (in-place `start.ts`, in-place `isolation.ts`, bare-mirror `workspace.ts`). For file:// arbiters and the test suite this is free; for real network arbiters it adds one extra remote call per `do`/`run`/`start`. Acceptable cost for correctness but worth a human nod.
  (start.ts switchToWorkBranch, isolation.ts inPlaceStrategy, workspace.ts createJob — all now ls-remote on the continue-detection seam.)
- Ratify the choice to introduce a NEW sibling function `branchAheadOfArbiter` rather than upgrading `branchAheadOf` in place (or adding an `arbiterRemote` option to it). Both shapes survive; one is now the 'arbiter-authoritative' callable and the other the pure-local predicate. The split is coherent but creates two near-neighbour entry points future authors will have to choose between.
  (packages/agent-runner/src/continue-branch.ts — both `branchAheadOf` and new `branchAheadOfArbiter` exported; all three call sites migrated to the new one.)
