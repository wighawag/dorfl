---
title: Dependency-aware auto-pick (`-n`) — schedule a blocker + its dependent together in one run (topo-ordered schedulable set), so a freshly-sliced PRD's chained slices drain in a single tick
slug: dependency-aware-autopick-scheduling
type: idea
status: incubating
---

# Dependency-aware auto-pick scheduling

> Captured 2026-06-12 as `work/observations/do-autopick-no-dependency-aware-scheduling.md`; promoted to an idea on triage (it is an ENHANCEMENT, not a defect — today's snapshot behaviour is correct, just limited). NOT built. Cross-ref: `work/prd/runner-in-ci.md` slice-readiness notes already flag this as out-of-scope-but-relevant to the CI cron drain.

## The limitation today

`do -n <x>` (the auto-pick COUNT form) cannot pick a set of slices that depend on each other and run them in the right order. Given slices A and B where **B `blockedBy: [A]`**, doing A first would unblock B — but auto-pick never schedules a blocker together with the dependent it would unblock. It is a **single static snapshot**.

### The mechanism (why — verified against current code)

The selection path is `performDoAuto` (`src/do-autopick.ts`) → `selectPrioritised` (`src/select-priority.ts`) → `resolveEligibility` (`src/eligibility.ts`):

1. `performDoAuto` calls `scanRepoPaths([cwd], config)` **once**, at the top, BEFORE any item runs.
2. Per-slice eligibility is resolved at that instant against `doneSlugs` = slugs in `work/done/` (`resolveBlockedBy`: `missing = blockedBy.filter(slug => !doneSlugs.has(slug))`; `eligible = gatePass && blockedBy.satisfied`).
3. `selectPrioritised` takes the first `count` of the ALREADY-eligible items.
4. `runSelectedInSequence` runs them one at a time and **does NOT re-scan** between items.

Consequence for A → B (B blocked on A, A not yet done at scan time): B is `eligible: false` at scan time, so it is never in the candidate pool; even after A lands in `work/done/`, the loop does not re-scan, so B never becomes eligible mid-run. So `do -n 2` picks A + some OTHER already-ready slice, never "A then B."

(The explicit-naming form `do A B` via `performDoArgs` bypasses the pool and runs them verbatim in order; the per-item claim path's readiness guard then governs B. That path is dependency-order-capable by operator choice; the AUTO-PICK path is not.)

## The opportunity

Make auto-pick **dependency-aware**: instead of a flat snapshot of currently-eligible items, build the per-repo dependency DAG over backlog slices and select a **schedulable set** — items eligible NOW plus items that become eligible once their (also-selected) blockers land — ordered by a topological sort. Then `do -n <x>` could pick a connected chain A → B → C and run them in sequence, each blocker satisfied by the prior step before it runs.

Most useful **right after a PRD is sliced**: the fresh slices from one PRD frequently chain (`blockedBy` links a tracer slice to the ones that extend it), and today NONE of the downstream ones are auto-pickable until a human/loop lands each blocker first. A dependency-aware `-n` would drain a freshly-created, internally-chained slice set in one go (and would let a single CI cron tick drain a chained set instead of needing multiple ticks — see the `runner-in-ci` cron-drain note).

## Behaviour to pin down if built (the open design questions)

- **Re-scan vs upfront DAG:** either re-scan `work/done/` after each item (cheap, simple — naturally picks up A landing before B's turn) OR compute the topo-ordered schedulable set upfront. Re-scan is the smaller change.
- **A failing mid-chain:** `runSelectedInSequence` does NOT stop on failure today (records each result, `exitCode` = first non-zero, continues). For a dependency chain that is arguably WRONG — if A fails, B's blocker is unmet and B should be SKIPPED (or it fails fast at its own readiness guard, "fine but noisy"). Decide: skip-downstream-on-blocker-failure vs let-each-fail-its-own-guard. Skipping the now-unreachable tail is cleaner.
- **Scope:** dependencies are per-repo only (eligibility is per-repo), so the DAG is per-repo — no cross-repo scheduling. Consistent with the existing model.

## Refs

- `src/do-autopick.ts` (`performDoAuto`, `runSelectedInSequence`), `src/select-priority.ts` (`selectPrioritised`), `src/eligibility.ts` (`resolveBlockedBy`), the readiness guard in `src/claim-cas.ts` / `test/readiness.test.ts`.
- `work/prd/runner-in-ci.md` (slice-readiness notes — the cron-drain multi-tick consequence).
