---
title: advance auto-pick draws the LIFECYCLE pools (untriaged observations + needsAnswers-blocked slices/PRDs) into the selection, so the gates have a pool to govern
slug: advance-autopick-lifecycle-pools
blockedBy: []
covers: []
---

> Self-contained ENGINE slice (`covers: []`, no `prd:`). Source: a review pass (2026-06-12) of the gate slices found the gates presuppose an auto-pick path that does NOT exist. Decision ADR `docs/adr/ci-config-policy-and-gate-family.md`. This is the MISSING FOUNDATION the two gate slices (`observation-triage-tri-state-gate`, `surface-blockers-gate`) and the CI lifecycle story (`work/prd/runner-in-ci.md`) all depend on.

## The gap this fixes (verified 2026-06-12 against the code)

The advance auto-pick / `-n` / loop / CI selection enumerates EXACTLY TWO pools and NOTHING else:

- `performAdvanceAuto` (`advance-drivers.ts`, in-place) and `scanMirrorPool` (`mirror-pool-scan.ts`, loop/CI) both build only: **eligible slices** (`scoreItems`/`scanRepoPaths`, gated `autoBuild`) + **sliceable PRDs** (`sliceablePrds`, gated `autoSlice`).
- `scan.ts`/`ledger-read.ts` read only `work/backlog | done | prd | prd-sliced | needs-attention`. **NOTHING reads `work/observations/`.** (Exhaustively confirmed: no `observations` enumeration in scan/select/eligibility/pool/driver.)

Consequences TODAY:

1. **Observations are NEVER auto-selected.** The triage rung runs ONLY when an observation is EXPLICITLY named (`advance obs:<slug>`). A bare `advance` / `advance -n` / `run --advance` / CI tick never triages anything.
2. **`needsAnswers`-blocked slices/PRDs are NEVER auto-selected.** They are build-INELIGIBLE (the auto-eligible predicate excludes `needsAnswers:true`), so the SURFACE rung never fires for them except by EXPLICIT naming.

So the lifecycle rungs (triage / surface / apply) are EXPLICIT-INVOCATION-ONLY today. The whole "advance drains a populated `work/` tree, surfacing questions, human only answers" story (the `advance-loop` north star + the `runner-in-ci` premise) does NOT actually work autonomously yet, an autonomous tick only builds slices + slices PRDs. (The design INTENDED an observation candidate pool, see the `triaged: keep` "drops out of the candidate pool" marker in `frontmatter.ts`, but it was never wired into scan/select.)

## What to build

Extend the advance auto-pick SELECTION (both the in-place `performAdvanceAuto` and the mirror-side `scanMirrorPool`, via the shared scan/select layer) to ALSO enumerate the two LIFECYCLE pools, so a bare/`-n`/loop/CI `advance` can reach triage/surface/apply autonomously, not only by explicit naming:

- **Pool 3, untriaged observations**: observations in `work/observations/` that have NOT been settled (no `triaged:` terminal marker, the `triaged: keep` drop-out already designed in `frontmatter.ts`). These feed the `triage-observation` rung. (NOTE the classifier `advance-classify.ts` already maps an untriaged observation to `triage-observation`; the gap is purely that NOTHING enumerates observations INTO the selection.)
- **Pool 4, needsAnswers-blocked slices/PRDs**: slices/PRDs carrying `needsAnswers: true` (today excluded as build/slice-ineligible). These feed the `surface` rung (render the declared blocker into a sidecar). An ALREADY-surfaced item (active sidecar, `needsAnswers:true`) with all entries answered feeds `apply` (already classified by `advance-classify.ts`); a pending sidecar is a NO-OP (already handled).

This slice does NOT add the gates (those are the two gate slices that depend on THIS) and does NOT change the classifier or the rung bodies (they already handle these item types); it ONLY widens the SELECTION/scan so the lifecycle items ENTER the pool. The gates then govern these new pools at the selection layer, making the "`autoBuild` drops the build pool" analogy actually TRUE for the lifecycle pools.

NOTE on ordering vs the gates: this slice should land the pools in their SAFE default state. Since the gates default CALM (`observationTriage: off`, `surfaceBlockers: off`) and DO NOT EXIST YET when this lands, this slice must decide its interim default (see Decisions): the pools must NOT start auto-triaging/auto-surfacing on every repo the moment this lands, or it changes behaviour before the gates can calm it. Safest: gate the NEW pools behind the SAME calm-default the gate slices will introduce, OR land this slice and the `observationTriage`/`surfaceBlockers` gates together so the pools are born gated-off.

## Acceptance criteria

- [ ] The advance auto-pick selection enumerates untriaged observations (`work/observations/`, excluding `triaged:`-settled ones) AND `needsAnswers`-blocked slices/PRDs, in BOTH the in-place path (`performAdvanceAuto`) and the mirror-side path (`scanMirrorPool`), via the shared scan/select layer, NOT two divergent enumerations.
- [ ] A bare `advance` / `advance -n <x>` (and a `run --advance` batch) can now reach the `triage-observation` rung on an untriaged observation and the `surface` rung on a `needsAnswers` slice/PRD WITHOUT explicit naming, proven by a test that auto-picks each (today such a test would select NOTHING from these pools).
- [ ] INTERIM SAFETY (see Decisions): the new pools do NOT cause autonomous triage/surface on a repo that has not opted in. Either born gated-off behind the calm-default gate, or this slice lands together with the gate slices. A test asserts the calm/default state does NOT auto-triage or auto-surface.
- [ ] The classifier (`advance-classify.ts`) and the rung bodies (`triageRung`/`surfaceRung`/`applyRung`) are UNCHANGED: this slice only widens enumeration. (If a real classifier gap is found, record it; do not silently change rung behaviour.)
- [ ] `apply` of an already-answered sidecar continues to work (it is already classified `apply`); the new enumeration must surface answered-sidecar items into the pool so `apply` runs autonomously too (the CONSUME phase, always allowed). A test covers an answered-sidecar item being auto-picked and applied.
- [ ] The `triaged: keep` / settled marker correctly DROPS a settled observation from the pool (it is never re-picked): a test asserts a settled observation is not re-enumerated.
- [ ] Selection ORDER across the now-FOUR pools is defined and tested (slices / PRDs / observations / blocked-items; how `prdsFirst` and the lifecycle pools interleave). Default: drain buildable work first, then lifecycle. RECORD the chosen order.
- [ ] Tests in the repo's vitest style (throwaway git repos, `GIT_CONFIG_GLOBAL=/dev/null`-style isolation, temp workspace dirs). No shared/global location written outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None, can start immediately. (It is the FOUNDATION the gate slices depend on; build it FIRST.)

## Decisions (to record while building)

- **Interim gating before the gate slices exist.** The cleanest path: land THIS slice TOGETHER with `observation-triage-tri-state-gate` + `surface-blockers-gate` (one coherent change) so the new pools are born gated-off (calm). Alternative: land this with a temporary hardcoded "off" so it changes no behaviour until the gates arrive. Decide and record; do NOT ship a version that auto-triages every repo on upgrade.
- **Selection order across four pools** (slices, PRDs, observations, needsAnswers-blocked). Likely: buildable slices → sliceable PRDs → lifecycle (surface blocked, triage observations), i.e. drain ready work before grooming. Confirm against the `advance-loop` north star (the human-is-the-clock drain) and `prdsFirst`.
- **What "untriaged" means precisely** for the observation pool (no `triaged:` marker? no active sidecar? both?). Pin it against `frontmatter.ts`'s `triaged: keep` drop-out + the sidecar `allAnswered`/pending model in `advance-classify.ts`.

## Prompt

> Widen the advance auto-pick SELECTION so it enumerates the LIFECYCLE pools (untriaged observations + `needsAnswers`-blocked slices/PRDs), not only the build/slice pools. This is the MISSING FOUNDATION a review pass found: today the lifecycle rungs (triage/surface/apply) are EXPLICIT-INVOCATION-ONLY because NOTHING enumerates observations or `needsAnswers` items into the pool, so a bare/`-n`/loop/CI `advance` can only build slices + slice PRDs. Source: review 2026-06-12; ADR `docs/adr/ci-config-policy-and-gate-family.md`. The two gate slices (`observation-triage-tri-state-gate`, `surface-blockers-gate`) and the CI story (`work/prd/runner-in-ci.md`) all depend on THIS.
>
> FIRST, drift-check + confirm the gap: `performAdvanceAuto` (`advance-drivers.ts`) and `scanMirrorPool` (`mirror-pool-scan.ts`) build ONLY the eligible-slice pool (`scoreItems`/`scanRepoPaths`, `autoBuild`) + the sliceable-PRD pool (`sliceablePrds`, `autoSlice`); `scan.ts`/`ledger-read.ts` read only `backlog|done|prd|prd-sliced|needs-attention`, NOT `work/observations/`. The classifier `advance-classify.ts` ALREADY maps an untriaged observation → `triage-observation` and an answered sidecar → `apply`, so the rung bodies are fine; the gap is purely SELECTION. If reality differs, reconcile or route to `needs-attention/`.
>
> BUILD: extend the shared scan/select layer so the auto-pick (in-place `performAdvanceAuto` AND mirror-side `scanMirrorPool`) ALSO enumerates (3) untriaged observations from `work/observations/` (excluding `triaged:`-settled ones, the `frontmatter.ts` `triaged: keep` drop-out) and (4) `needsAnswers`-blocked slices/PRDs (today excluded as ineligible) + already-surfaced answered-sidecar items (for `apply`). ONE shared enumeration, not two divergent ones. Do NOT change the classifier or the rung bodies. Do NOT add the `observationTriage`/`surfaceBlockers` gates here (separate slices), but ensure the NEW pools are CALM by default (born gated-off, or landed together with the gate slices) so an upgrade does not auto-triage every repo. Define + test the selection ORDER across the four pools.
>
> TEST (TDD, vitest, house style): a bare `advance` auto-picks an untriaged observation → triage rung; auto-picks a `needsAnswers` slice → surface rung; auto-picks an answered-sidecar item → apply; a `triaged:`-settled observation is NOT re-picked; the calm/default state auto-triages/auto-surfaces NOTHING; the in-place and mirror-side enumerations agree. Isolate shared/global locations to temp fixtures.
>
> "Done" = the advance auto-pick reaches triage/surface/apply autonomously via the widened selection (both paths), the classifier/rungs are unchanged, settled observations drop out, the four-pool order is defined+tested, the default is calm, and the gate is green.
