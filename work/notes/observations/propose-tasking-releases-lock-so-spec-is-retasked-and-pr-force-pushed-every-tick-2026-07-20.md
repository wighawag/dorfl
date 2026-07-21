---
title: Propose-mode tasking releases the per-item lock on `completed`, so the spec stays in the auto-task pool on main and CI re-tasks it (force-pushing the open PR) every tick
type: observation
status: spotted
spotted: 2026-07-20
---

## What was seen

`dorfl install-ci`'s `advance-lifecycle` loop, running in **propose** mode against a repo with a taskable spec, opens ONE tasking PR for the spec and then **force-pushes that PR's branch on every scheduled tick forever** — regenerating the Gate-2 review each time. Observed live on https://github.com/wighawag/rocketh/pull/45 (`tasking(tag-tracking-selective-reset)`): the `github-actions[bot]` force-pushed `work/spec-tag-tracking-selective-reset` at 13:56, 15:51, 17:37, 19:33 … (≈ every 2h, hourly cron × `max-parallel: 2`), each push a brand-new tasking commit.

Ground truth confirming the mechanism:

- On `main`: `work/specs/ready/tag-tracking-selective-reset.md` is STILL present (spec still in the auto-task pool).
- On the work branch: the spec is moved to `work/specs/tasked/` (the tasking that opened the PR).
- So the durable `specs/ready → specs/tasked` move lives ONLY on the unmerged branch; `main` never sees it until the PR merges.

## Root cause (traced in `packages/dorfl/src`)

1. **Tasked-ness is folder residence on `main`.** `tasking-eligibility.ts` resolves a spec's taskability against `taskedSlugs` = residence in `work/specs/tasked/` (`resolveTaskedAfter`, and the pool builder). `scan.ts` `scoreSpecs(...)` builds the propose matrix's `spec:` legs from exactly this predicate.

2. **Propose tasking releases the lock immediately.** `tasking.ts` (~L822-838): on `core.outcome === 'completed'` — which INCLUDES `mode: 'propose'` (PR opened) as well as `merge` — it calls `releaseItemLock({item: 'spec:<slug>'})`, deleting `refs/dorfl/lock/spec-<slug>`. The doc-comment there explicitly flags this as a KNOWN interim gap: *"A propose (`mode: 'propose'`) is ALSO completed … the eventual hold-across-the-PR crash-safe ordering is the capstone task #7's concern, not this interim half."* That capstone was never built.

3. **So nothing keeps the spec out of the pool.** After a propose-tasking: the lock is GONE and the spec is STILL in `work/specs/ready/` on `main` (the move is only on the branch). Next `enumerate` tick: `scoreSpecs` sees the spec ready + not-tasked + lock not held ⇒ **eligible again** ⇒ another `advance spec:<slug> --propose` leg.

4. **Re-tasking force-recreates the branch + force-pushes.** `tasking.ts` `switchToWorkBranch` does `git switch -C work/spec-<slug> <arbiter>/main` (force-recreate off fresh main, per its own doc-comment: *"A pre-existing local work/<slug> (a re-run) is force-recreated off fresh main"*), and the propose integration pushes with `--force-with-lease` (`integrator.ts` ~L393/L629). Result: the SAME PR branch is force-pushed with a fresh tasking commit → the review workflow re-triggers → a new review is generated. Every tick.

## Why the prior fix does NOT cover this

Task `in-place-scan-subtracts-held-locked-slugs-from-propose-matrix` (done) made the in-place scan subtract **HELD** locks from the matrix. That fixes re-enumeration of stuck/active-**locked** items. But the tasking-propose path **releases** the lock on `completed`, so the spec is NOT held — held-subtraction can never see it. Note also the asymmetry in `scan.ts`: `scoreItems` (tasks) takes a `heldSlugs` set; `scoreSpecs` (specs) takes none. Even if it did, an already-released lock would not appear in it.

## Blast radius

- Any consumer repo that runs the `advance-lifecycle` loop in **propose** mode (the DEFAULT `integrationMode`) with a taskable spec sitting in `work/specs/ready/`. This is the default configuration, so it is the common path, not an edge case.
- Symptoms: the tasking PR is force-pushed and re-reviewed every tick (burning agent tokens + review cost + PR noise) until a human merges or closes it. The loop does NOT converge / is NOT calm-at-rest, violating the advance-loop US #31 "provably drains / stable when nothing changes" property.
- The SAME class of bug plausibly affects **task-build propose** (a `task:` leg): after a propose build completes and releases the lock, the task body stays in `work/tasks/ready/` on `main` (residence is not moved to `done/` until merge), so it too re-enters the pool and gets rebuilt + force-pushed every tick. NOT verified here — needs a separate check of the build/complete propose release path (`complete.ts`) and whether `scoreItems`'s held-subtraction masks it (it does not, since the lock is released). This observation is scoped to the tasking path where it was directly observed; flag the build path as a likely sibling.

## Candidate fixes (for triage — not decided)

The design intent (per the tasking.ts comment) is **hold the lock across the PR** in propose mode, so the item stays out of the pool until the PR merges or is closed. Options to weigh:

- **Do NOT release the lock on `completed` when `mode === 'propose'`** (release only on `merge`, where the durable move lands on main). Then `scoreSpecs`/`scoreItems` must subtract held specs too (the tasks side already subtracts held slugs; specs currently do not — close that asymmetry). The lock becomes the "PR is in flight" marker; it is reaped when the branch is (the `reap-merged-branches` / `gc` path already deletes provably-merged branches — extend to release the matching lock, and decide the closed-unmerged-PR recovery path so a human-closed PR does not strand the lock).
- **Enumerate-side: subtract slugs that already have an open work/<slug> branch (or open PR) on the arbiter** from the propose matrix (provider-agnostic: `git ls-remote --heads <arbiter> 'refs/heads/work/*'`). Cheaper, no lock-lifecycle change, but weaker (a stale branch with no PR would also suppress).
- At minimum, STOP the force-push: re-tasking should no-op (or fast-forward-only) when an equivalent branch already exists, never `git switch -C` + `--force-with-lease` over a live PR.

This needs a real decision (likely an ADR) about the propose-mode lock lifetime — it is the "capstone task #7" the tasking.ts comment defers.

## Update 2026-07-20 — FIXED (option 1: hold the lock across the PR)

Implemented the "keep the lock held across the open PR" mechanism (the maintainer's call, matching the deferred design intent):

- `tasking.ts` (`performTask`, `completed` branch): the `spec:<slug>` lock is now released ONLY when `resolvedMode === 'merge'` (the durable `specs/ready → specs/tasked` move landed on `main`, so residence carries tasked-ness). On `propose` the lock is KEPT HELD across the open PR — the held lock IS the "in-flight tasking" marker.
- `item-lock.ts`: added `heldSpecSlugsStrict` (fail-closed, SELECTION) + `heldSpecSlugs` (fail-open, surface/local) — the SPEC analogue of `heldTaskSlugs*`, keeping only `spec-<slug>` lock entries.
- `scan.ts` `scoreSpecs` + `scanRepoPaths`: new `heldSpecSlugs` param, subtracted from the taskable-spec pool (specs took NO held-subtraction before — this closes the asymmetry with `scoreItems`).
- `cwd-section.ts` (feeds CI `scan --json`) reads the held-spec set fail-CLOSED and threads it in; `advance-drivers.ts` (local autopick) subtracts the fail-open set from its `taskableSpecs` candidates.
- Lock-lifetime pinned by tests in `tasking-integration.test.ts`: propose ⇒ `listItemLocks` = `['spec-it']` (held); the propose/merge parity table asserts merge ⇒ `[]` (released), propose ⇒ `['spec-it']`.

Reaping: a MERGE lands the durable move (tasked-ness now self-signalled) + the reap/gc path deletes the merged branch; a human CLOSING the PR unmerged is a human-owned recovery via `release-lock` (same model as any abandoned in-flight item — no auto-steal). Full gate green (`pnpm -r build && pnpm format:check`; the only red is the PRE-EXISTING, unrelated `integration-core` N=7 `mergeRetries:0` timeout flake — see its own observation).

SIBLING RESOLVED (checked `complete.ts`): the task-BUILD propose path already did the right thing — task `propose-keep-lock-until-pr-merge` keeps the `task:<slug>` lock HELD across the open PR (released only when `durablyOnMain`: merge / already-landed / already-integrated), and `scoreItems` already subtracts held task slugs. So the build path was never affected by this bug; the TASKING path was simply the one that never received the equivalent "hold-across-the-PR" capstone. This fix brings tasking (`spec:<slug>`) into PARITY with the already-correct build path (`task:<slug>`) — same mechanism (hold on propose, release on land) + the now-symmetric held-slug pool subtraction on both the task and spec pools. No second fix needed.

## Refs

- `packages/dorfl/src/tasking.ts` — `completed` release (~L822-838), `switchToWorkBranch` force-recreate (~L950-970).
- `packages/dorfl/src/tasking-lock.ts` — release deletes the ref; module header documents the "hold across PR is capstone #7" deferral.
- `packages/dorfl/src/tasking-eligibility.ts` / `scan.ts` `scoreSpecs` — taskability = `specs/tasked/` residence, no held-slug subtraction on the spec pool.
- `packages/dorfl/src/integrator.ts` — propose push is `--force-with-lease` (~L393, ~L629).
- Prior (insufficient for this) fix: `work/tasks/done/in-place-scan-subtracts-held-locked-slugs-from-propose-matrix.md`.
- Live evidence: https://github.com/wighawag/rocketh/pull/45 (repeated bot force-pushes); `main` still holds `work/specs/ready/tag-tracking-selective-reset.md`.
