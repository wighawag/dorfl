---
title: do auto-pick (`-n`) is NOT dependency-aware — it cannot schedule a blocker + its dependent together in one run; a smarter scheduler would help freshly-sliced PRDs whose slices chain
date: 2026-06-12
status: open
---

## What was noticed

Investigating whether `do -n <x>` (the auto-pick COUNT form) can pick a set of slices that depend on each other and run them in the right order — e.g. slices A and B where **B `blockedBy: [A]`** — so that doing A first makes B runnable next. It cannot. The auto-pick is a **single static snapshot**: it never schedules a blocker together with the dependent it would unblock.

## Why (the mechanism — refs)

The selection path is `performDoAuto` (`src/do-autopick.ts`) → `selectPrioritised` (`src/select-priority.ts`) → `resolveEligibility` (`src/eligibility.ts`):

1. `performDoAuto` calls `scanRepoPaths([cwd], config)` **once**, at the top, BEFORE any item runs.
2. Per-slice eligibility is resolved at that instant against `doneSlugs` = slugs currently in `work/done/` (`resolveBlockedBy`: `missing = blockedBy.filter(slug => !doneSlugs.has(slug))`; `eligible = gatePass && blockedBy.satisfied`).
3. `selectPrioritised` takes the first `count` of the ALREADY-eligible items.
4. `runSelectedInSequence` runs them one at a time and **does NOT re-scan** between items.

Consequence for A → B (B blocked on A, A not yet done at scan time):

- **B is `eligible: false` at scan time**, so it is never in the candidate pool — `-n` cannot pick it.
- Even after A finishes and lands in `work/done/`, the loop does not re-scan, so B does not become eligible mid-run.
- So `do -n 2` picks A + some OTHER already-ready slice, never "A then B."

(The explicit-naming form `do A B` via `performDoArgs` bypasses the pool entirely and runs them verbatim in order; the per-item claim path's own readiness guard then governs B. That path is dependency-order-capable by operator choice; the AUTO-PICK path is not.)

## The opportunity (the actual ask — why this is worth building)

Auto-pick could be made **dependency-aware**: instead of a flat snapshot of currently-eligible items, build the per-repo dependency DAG over backlog slices and select a **schedulable set** — items that are eligible NOW plus items that become eligible once their (also-selected) blockers land, ordered by a topological sort. Then `do -n <x>` could pick a connected chain A → B → C and run them in sequence, each one's blocker satisfied by the prior step before it runs.

This is most useful **right after a PRD is sliced**: the fresh slices from one PRD frequently chain (`blockedBy` links a tracer slice to the ones that extend it), and today NONE of the downstream ones are auto-pickable until a human/loop lands each blocker first. A dependency-aware `-n` would let a single `do -n <x>` drain a freshly-created, internally-chained slice set in one go.

### Behaviour to pin down if built (so this note is actionable)

- **Re-scan vs upfront DAG:** either re-scan `work/done/` after each item (cheap, simple) OR compute the topo-ordered schedulable set upfront. Re-scan is the smaller change and naturally picks up A landing before B's turn.
- **A failing mid-chain:** `runSelectedInSequence` does NOT stop on failure today (it records each result, `exitCode` = first non-zero, and continues). For a dependency chain that's arguably WRONG — if A fails, B's blocker is unmet and B should be skipped (or it will fail fast at its own readiness guard, which is "fine but noisy"). A dependency-aware scheduler should decide: skip-downstream-on-blocker-failure vs let-each-fail-its-own-guard. Skipping the now-unreachable tail is the cleaner behaviour.
- **Scope:** dependencies are per-repo only (eligibility is per-repo), so the DAG is per-repo — no cross-repo scheduling. Consistent with the existing model.

## Disposition hint (for triage)

Candidate to promote to a `work/ideas/` entry or a slice once the behaviour above is decided (it is an enhancement, not a defect — today's snapshot behaviour is correct, just limited). Cross-ref: `src/do-autopick.ts` (`performDoAuto`, `runSelectedInSequence`), `src/select-priority.ts` (`selectPrioritised`), `src/eligibility.ts` (`resolveBlockedBy`), and the readiness guard in `src/claim-cas.ts` / `test/readiness.test.ts`.
