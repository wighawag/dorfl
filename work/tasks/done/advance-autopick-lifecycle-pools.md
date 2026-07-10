---
title: advance auto-pick draws the LIFECYCLE pools (untriaged observations + needsAnswers-blocked slices/PRDs) into the selection, so the gates have a pool to govern
slug: advance-autopick-lifecycle-pools
blockedBy: [ledger-one-slug-one-folder-lint-and-sweep]
covers: []
---

> Self-contained ENGINE slice (`covers: []`, no `prd:`). Source: a review pass (2026-06-12) of the gate slices found the gates presuppose an auto-pick path that does NOT exist. Decision ADR `docs/adr/ci-config-policy-and-gate-family.md`. This is the MISSING FOUNDATION the two gate slices (`observation-triage-tri-state-gate`, `surface-blockers-gate`) and the CI lifecycle story (`work/spec/runner-in-ci.md`) all depend on.

## The gap this fixes (verified 2026-06-12 against the code)

The advance auto-pick / `-n` / loop / CI selection enumerates EXACTLY TWO pools and NOTHING else:

- `performAdvanceAuto` (`advance-drivers.ts`, in-place) and `scanMirrorPool` (`mirror-pool-scan.ts`, loop/CI) both build only: **eligible slices** (`scoreItems`/`scanRepoPaths`, gated `autoBuild`) + **sliceable PRDs** (`sliceablePrds`, gated `autoSlice`).
- `scan.ts`/`ledger-read.ts` read only `work/backlog | done | spec | spec-sliced | needs-attention`. **NOTHING reads `work/observations/`.** (Exhaustively confirmed: no `observations` enumeration in scan/select/eligibility/pool/driver.)

Consequences TODAY:

1. **Observations are NEVER auto-selected.** The triage rung runs ONLY when an observation is EXPLICITLY named (`advance obs:<slug>`). A bare `advance` / `advance -n` / `run --advance` / CI tick never triages anything.
2. **`needsAnswers`-blocked slices/PRDs are NEVER auto-selected.** They are build-INELIGIBLE (the auto-eligible predicate excludes `needsAnswers:true`), so the SURFACE rung never fires for them except by EXPLICIT naming.

So the lifecycle rungs (triage / surface / apply) are EXPLICIT-INVOCATION-ONLY today. The whole "advance drains a populated `work/` tree, surfacing questions, human only answers" story (the `advance-loop` north star + the `runner-in-ci` premise) does NOT actually work autonomously yet, an autonomous tick only builds slices + slices PRDs. (The design INTENDED an observation candidate pool, see the `triaged: keep` "drops out of the candidate pool" marker in `frontmatter.ts`, but it was never wired into scan/select.)

## What to build

Extend the advance auto-pick SELECTION (both the in-place `performAdvanceAuto` and the mirror-side `scanMirrorPool`, via the shared scan/select layer) to ALSO enumerate the two LIFECYCLE pools, so a bare/`-n`/loop/CI `advance` can reach triage/surface/apply autonomously, not only by explicit naming:

- **Pool 3, untriaged observations**: observations in `work/observations/` that have NOT been settled (no `triaged:` terminal marker, the `triaged: keep` drop-out already designed in `frontmatter.ts`). These feed the `triage-observation` rung. (NOTE the classifier `advance-classify.ts` already maps an untriaged observation to `triage-observation`; the gap is purely that NOTHING enumerates observations INTO the selection.)
- **Pool 4, needsAnswers-blocked slices/PRDs**: slices/PRDs carrying `needsAnswers: true` (today excluded as build/slice-ineligible). These feed the `surface` rung (render the declared blocker into a sidecar). An ALREADY-surfaced item (active sidecar, `needsAnswers:true`) with all entries answered feeds `apply` (already classified by `advance-classify.ts`); a pending sidecar is a NO-OP (already handled).

This slice does NOT add the gates (those are the two gate slices that depend on THIS) and does NOT change the classifier or the rung bodies (they already handle these item types); it ONLY widens the SELECTION/scan so the lifecycle items ENTER the pool. The gates then govern these new pools at the selection layer, making the "`autoBuild` drops the build pool" analogy actually TRUE for the lifecycle pools.

### CRITICAL: do NOT contaminate `do` (the shared selection helper)

`performDoAuto` (`do-autopick.ts`) and `performAdvanceAuto` (`advance-drivers.ts`) BOTH call the SAME `selectPrioritised` + `sliceablePrds` (`select-priority.ts`). `do` has NO triage/surface/apply rungs, so if the lifecycle pools were added INSIDE `selectPrioritised` unconditionally, `do` auto-pick would start selecting observations / `needsAnswers` items and try to BUILD them (a bug). The lifecycle pools MUST be:

- **constructed by the `advance` caller only** (`performAdvanceAuto` / the mirror-side advance path), exactly as `sliceablePrds` is built by each caller and passed in, NOT baked into `selectPrioritised`;
- the shared helper may be EXTENDED to ACCEPT extra pools, but it must DEFAULT to none, so `performDoAuto` (which passes only its two pools) is provably UNCHANGED. A test asserts `do` auto-pick still selects ONLY slices + sliceable PRDs (never an observation or a `needsAnswers` item) after this slice.

### CRITICAL: the SelectedItem discriminator + per-item dispatch are NEW work

`SelectedItem.namespace` is today `'slice' | 'spec'` and the caller switches on it (`slice` -> build pipeline, `spec` -> `do prd:` dispatch). The lifecycle pools need the selected item to carry WHICH RUNG to run, so this slice must EXTEND the discriminator and `performAdvanceAuto`'s per-item dispatch to map: an untriaged observation -> the `obs:<slug>` triage arg; a `needsAnswers`-blocked slice/SPEC -> the surface path; an answered-sidecar item -> the apply path. "The classifier already handles these types" is true but the classifier runs INSIDE `performAdvance` per resolved ARG, the SELECTION->ARG mapping (which pool -> which tick arg) is genuinely NEW here. "Rung bodies unchanged" does NOT mean "no new dispatch": the dispatch from a selected lifecycle item to the right tick arg is part of this slice.

### Interim safety (DECIDED, not a coin-flip): the pools are born OFF

The gate slices (`observationTriage`/`surfaceBlockers`) are `blockedBy` THIS slice, so they land AFTER it. Therefore THIS slice must be SAFE STANDALONE: the lifecycle pools are enumerated but guarded behind a hardcoded internal OFF (the lifecycle pools contribute NOTHING to the `advance` selection by default), so landing this slice ALONE changes NO repo's behaviour. The gate slices then REPLACE that hardcoded OFF with the real `observationTriage`/`surfaceBlockers` config read. (This is the chosen path; do NOT instead leave it as "maybe land together" or "maybe hardcode", it IS hardcoded-off here, flipped on by the gates.)

## Acceptance criteria

- [ ] The advance auto-pick enumerates untriaged observations (`work/observations/`, excluding `triaged:`-settled ones) AND `needsAnswers`-blocked slices/PRDs + answered-sidecar items, built by the `advance` CALLER (`performAdvanceAuto`) and the mirror-side advance path, NOT inside `selectPrioritised`. ONE shared enumeration UNIT reused across in-place + mirror-side advance (not two divergent ones), but constructed caller-side and passed in.
- [ ] **`do` IS PROVABLY UNCHANGED (F-SHARE):** the lifecycle pools are NOT added to `selectPrioritised` unconditionally. `selectPrioritised` may be extended to ACCEPT extra pools but DEFAULTS to none, so `performDoAuto` (passing only its two pools) selects EXACTLY as before. A test asserts `do` auto-pick / `-n` never selects an observation or a `needsAnswers` item.
- [ ] **The SelectedItem discriminator + dispatch are extended (F-NAMESPACE):** `SelectedItem.namespace` (today `slice|spec`) is widened so a selected lifecycle item carries which rung to run, and `performAdvanceAuto`'s per-item dispatch maps observation -> `obs:<slug>` triage arg, `needsAnswers`-blocked -> surface path, answered-sidecar -> apply path. A test asserts each pool's selected item dispatches to the correct tick arg/rung.
- [ ] A bare `advance` / `advance -n <x>` (and a `run --advance` batch) reaches the `triage-observation` rung on an untriaged observation and the `surface` rung on a `needsAnswers` slice/SPEC WITHOUT explicit naming, proven by a test (today such a test selects NOTHING from these pools). NOTE: with the interim hardcoded-OFF (below), these tests must FORCE the pools on (the same internal hook the gate slices will wire to config) to exercise the path.
- [ ] **INTERIM SAFETY, born OFF (F-INTERIM, DECIDED):** the lifecycle pools are guarded behind a hardcoded internal OFF, so landing THIS slice alone contributes NOTHING to the advance selection and changes NO repo's behaviour. A test asserts the default (no gate yet) auto-triages/auto-surfaces NOTHING. The gate slices replace the hardcoded OFF with the `observationTriage`/`surfaceBlockers` config read.
- [ ] The classifier (`advance-classify.ts`) and the rung BODIES (`triageRung`/`surfaceRung`/`applyRung`) are UNCHANGED: this slice widens ENUMERATION + adds the selection->arg DISPATCH, but does not touch rung behaviour. (If a real classifier gap is found, record it; do not silently change rung behaviour.)
- [ ] `apply` of an already-answered sidecar runs autonomously: the new enumeration surfaces answered-sidecar items into the pool and dispatches them to apply (the CONSUME phase, always allowed even when the create-side pools are off, see the create-vs-consume invariant). A test covers an answered-sidecar item being auto-picked and applied.
- [ ] The `triaged: keep` / settled marker correctly DROPS a settled observation from the pool (it is never re-picked): a test asserts a settled observation is not re-enumerated.
- [ ] Selection ORDER across the now-FOUR pools has a SIMPLE INTERIM default (drain buildable work first, then lifecycle, generalizing today's slices-first), tested. The CONFIGURABLE order (presets + explicit list + `apply`-pinned-first, subsuming `prdsFirst`) is the SEPARATE slice `advance-selection-order-config` (`blockedBy` this one), so do NOT build the config field here, just leave a sane fixed order this slice's tests pin, which that slice then generalizes.
- [ ] Tests in the repo's vitest style (throwaway git repos, `GIT_CONFIG_GLOBAL=/dev/null`-style isolation, temp workspace dirs). No shared/global location written outside temp fixtures.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `ledger-one-slug-one-folder-lint-and-sweep` (FILE-SERIALISATION + SOUNDNESS): it edits `scan.ts` (the lint of folder residence) and this slice ALSO edits `scan.ts` (enumerating `work/observations/` + needsAnswers items into the pool), so serialise to avoid a merge conflict. It also pulls this slice AFTER the `ledger-integrity` cluster, which is the right soundness order: do not scale autonomous lifecycle transitions onto an un-hardened ledger. (This is the FOUNDATION the GATE slices depend on; it just sits after ledger-integrity.)

## Decisions (to record while building)

- **Interim gating before the gate slices exist.** The cleanest path: land THIS slice TOGETHER with `observation-triage-tri-state-gate` + `surface-blockers-gate` (one coherent change) so the new pools are born gated-off (calm). Alternative: land this with a temporary hardcoded "off" so it changes no behaviour until the gates arrive. Decide and record; do NOT ship a version that auto-triages every repo on upgrade.
- **Interim selection order across four pools** (slices, PRDs, observations, needsAnswers-blocked). Leave a SIMPLE fixed order here (likely buildable slices → sliceable PRDs → surface blocked → triage observations, i.e. drain before groom); the CONFIGURABLE version (presets / list / `apply`-first / subsume `prdsFirst`) is the sibling slice `advance-selection-order-config`. Do not pre-build the config field here.
- **What "untriaged" means precisely** for the observation pool (no `triaged:` marker? no active sidecar? both?). Pin it against `frontmatter.ts`'s `triaged: keep` drop-out + the sidecar `allAnswered`/pending model in `advance-classify.ts`.

## Prompt

> Widen the advance auto-pick SELECTION so it enumerates the LIFECYCLE pools (untriaged observations + `needsAnswers`-blocked slices/PRDs), not only the build/slice pools. This is the MISSING FOUNDATION a review pass found: today the lifecycle rungs (triage/surface/apply) are EXPLICIT-INVOCATION-ONLY because NOTHING enumerates observations or `needsAnswers` items into the pool, so a bare/`-n`/loop/CI `advance` can only build slices + slice PRDs. Source: review 2026-06-12; ADR `docs/adr/ci-config-policy-and-gate-family.md`. The two gate slices (`observation-triage-tri-state-gate`, `surface-blockers-gate`) and the CI story (`work/spec/runner-in-ci.md`) all depend on THIS.
>
> FIRST, drift-check + confirm the gap: `performAdvanceAuto` (`advance-drivers.ts`) and `scanMirrorPool` (`mirror-pool-scan.ts`) build ONLY the eligible-slice pool (`scoreItems`/`scanRepoPaths`, `autoBuild`) + the sliceable-SPEC pool (`sliceablePrds`, `autoSlice`); `scan.ts`/`ledger-read.ts` read only `backlog|done|spec|spec-sliced|needs-attention`, NOT `work/observations/`. The classifier `advance-classify.ts` ALREADY maps an untriaged observation → `triage-observation` and an answered sidecar → `apply`, so the rung bodies are fine; the gap is purely SELECTION. If reality differs, reconcile or route to `needs-attention/`.
>
> BUILD: extend the shared scan/select layer so the auto-pick (in-place `performAdvanceAuto` AND mirror-side `scanMirrorPool`) ALSO enumerates (3) untriaged observations from `work/observations/` (excluding `triaged:`-settled ones, the `frontmatter.ts` `triaged: keep` drop-out) and (4) `needsAnswers`-blocked slices/PRDs (today excluded as ineligible) + already-surfaced answered-sidecar items (for `apply`). ONE shared enumeration, not two divergent ones. Do NOT change the classifier or the rung bodies. Do NOT add the `observationTriage`/`surfaceBlockers` gates here (separate slices), but ensure the NEW pools are CALM by default (born gated-off, or landed together with the gate slices) so an upgrade does not auto-triage every repo. Define + test the selection ORDER across the four pools.
>
> TEST (TDD, vitest, house style): a bare `advance` auto-picks an untriaged observation → triage rung; auto-picks a `needsAnswers` slice → surface rung; auto-picks an answered-sidecar item → apply; a `triaged:`-settled observation is NOT re-picked; the calm/default state auto-triages/auto-surfaces NOTHING; the in-place and mirror-side enumerations agree. Isolate shared/global locations to temp fixtures.
>
> "Done" = the advance auto-pick reaches triage/surface/apply autonomously via the widened selection (both paths), the classifier/rungs are unchanged, settled observations drop out, the four-pool order is defined+tested, the default is calm, and the gate is green.
