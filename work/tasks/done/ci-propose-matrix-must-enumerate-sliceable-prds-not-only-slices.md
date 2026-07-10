---
title: the CI advance-lifecycle PROPOSE-mode matrix must enumerate sliceable PRDs (prd:<slug> legs), not only slices — today scan --json is slice-only, so DORFL_AUTO_SLICE never fires on the hourly cron and a ready ungated SPEC is never auto-sliced
slug: ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices
blockedBy: []
covers: []
---

## What to build

The default CI tick cannot auto-slice a SPEC. The hourly `schedule` cron in the emitted `advance-lifecycle.yml` runs in `propose` mode (the default; the `advance-merge`/`-n` job is gated `== 'merge'` and never runs on cron). In `propose` mode the matrix is built by the `enumerate` job from:

```
dorfl scan --json | jq -c '[(.repos[].items[]?, .cwd.repo.items[]?) | select(.eligibility.eligible == true) | "slice:" + .slug] | unique'
```

`scan` (`packages/dorfl/src/scan.ts`) and the cwd section (`cwd-section.ts` → `scanRepoPaths` → `scoreItems`) enumerate ONLY `work/backlog/*.md` SLICES, scored through the BUILD gate (`resolveEligibility`). There is NO SPEC enumeration anywhere in the `scan --json` output — both `.repos[].items[]` and `.cwd.repo.items[]` are slice-only. SPEC enumeration (the `sliceablePrds` predicate over `work/spec` vs `work/spec-sliced`, gated on `autoSlice`) lives ONLY in `scanMirrorPool` (`mirror-pool-scan.ts`) and the in-place `do-autopick` pool — the paths consumed by `advance -n` / `run` / `do --remote -n`, which the cron tick never reaches.

Net: in the default propose tick the matrix can only ever contain `slice:` legs. A sliceable SPEC is structurally invisible to the enumerator, so `DORFL_AUTO_SLICE: 'true'` (which the advance-lifecycle gate env hardcodes precisely to enable capability B, "auto-slice ready PRDs") does nothing on the hourly cron. The advertised capability is dead on the default tick. (Confirmed by `skill-eval-engine`, authored ungated/ready, never sliced or even claim-attempted: `git log --all --grep skill-eval-engine` shows only the authoring + a later parking commit.)

GOAL: make a ready, ungated, sliceable SPEC reachable by the DEFAULT scheduled (propose) tick — one `advance prd:<slug> --propose` matrix leg per sliceable SPEC, exactly as each eligible slice already gets one `advance slice:<slug> --propose` leg. CI already uses explicit prefixes, so `prd:` legs are correct and supported by the command surface. The `autoSlice` policy still gates which PRDs are sliceable (resolved per-repo); this slice does NOT change WHAT is sliceable, only that the propose enumerator can SEE the sliceable-SPEC pool.

This is a fix along the `scan --json` → `jq` → matrix path plus the workflow template(s) that emit that path. As of 2026-06-16 THREE templates carry the slice-only `jq` (`advance-lifecycle-template.ts`, `advance-ci-template.ts`, `build-slice-tick-template.ts`) — see the `## Build-time note` for which are live (the `build-slice-tick` deletion is in-progress, NOT yet landed). It is FILE-ADJACENT to the gate-env slice on `advance-lifecycle-template.ts` (see `## Blocked by`).

## Decisions (resolved by the maintainer, 2026-06-16)

1. **Approach → (a): surface sliceable PRDs in `scan --json` and union them into the propose matrix as `prd:` legs.** Extend the `scan`/`cwd-section` JSON to ALSO report the sliceable-SPEC pool (reuse `sliceablePrds` + the `work/spec` vs `work/spec-sliced` read; resolve `autoSlice` per-repo exactly as `scanMirrorPool` does — do NOT fork the predicate), then update the `jq` in the live template(s) to also emit `"spec:" + .slug` for sliceable PRDs. Surgical, keeps the propose-matrix shape, one leg per item. (Option (b), running `-n` auto-pick on the cron tick, was rejected: it loses the one-PR-per-item matrix parallelism.)
2. **JSON shape → separate `specs[]` array.** The new pool lives under its own key (e.g. `.repos[].specs[]` and `.cwd.repo.specs[]`), each entry carrying at least `{slug, eligibility:{eligible}}` so the `jq` filter mirrors the slice one (`select(.eligibility.eligible == true) | "spec:" + .slug`). Do NOT reuse the slice-only `items[]` with a discriminator (slices and PRDs are different verbs and project to different prefixes; a separate key avoids polluting `items[]` that other consumers read).

## Build-time note: which templates to edit (NOT an open question — an ordering courtesy)

Three templates carry the slice-only `jq` (`advance-lifecycle-template.ts`, `advance-ci-template.ts`, `build-slice-tick-template.ts`); all three exist as of 2026-06-16. The sibling slice `install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick` (IN-PROGRESS) DELETES `build-slice-tick-template.ts`. RECOMMENDED ORDERING: build this AFTER that deletion lands (see Blocked by) so you only update the two survivors and never add SPEC-enumeration to a doomed file. DRIFT-CHECK at build time: `ls packages/dorfl/src/build-slice-tick-template.ts` — edit it only if it still exists; never resurrect it if gone.

## Acceptance criteria

- [ ] `dorfl scan --json` reports the sliceable-SPEC pool for each repo (and the cwd section), gated on the per-repo resolved `autoSlice`, REUSING the existing `sliceablePrds` predicate + the `work/spec`/`work/spec-sliced` read (no forked predicate). A test asserts a ready, ungated SPEC appears as sliceable in the JSON and a `humanOnly`/`needsAnswers`/`autoSlice:false`-gated SPEC does NOT.
- [ ] The emitted propose-mode `enumerate` job's `jq` unions sliceable PRDs into the matrix as `prd:<slug>` legs alongside `slice:<slug>` legs (deduped). A template test asserts the emitted YAML enumerates both prefixes.
- [ ] End-to-end at the enumeration seam: given a work tree with one eligible slice AND one sliceable SPEC, the propose matrix contains BOTH `slice:<slug>` and `prd:<slug>`. A test pins this (mirror the existing scan/enumerate tests).
- [ ] The structural validator(s) for the edited template(s) accept the SPEC-enumerating `jq` and still reject a regression to slice-only (if a validator currently pins slice-only enumeration, update it).
- [ ] No change to WHAT is sliceable: `autoSlice` still gates the SPEC pool; a config-less repo with `autoSlice` off still surfaces no SPEC legs. The fix only makes the already-sliceable pool VISIBLE to the propose enumerator. A test pins that the gate still binds.
- [ ] Only the LIVE template(s) are touched (per the `## Build-time note`: if `build-slice-tick-template.ts` still exists at build time it is either also updated or — preferably — this slice is ordered after its deletion so it is skipped; it is never resurrected if already gone); `intake`/`close-job` and non-gate env are unaffected.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- None STRICTLY, but a recommended ORDERING dependency on `install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick` (in `work/in-progress/`): that slice DELETES `build-slice-tick-template.ts` (one of the three templates carrying the `jq` this slice edits). Building this AFTER it lands means there is one fewer template to update and no risk of adding SPEC-enumeration to a doomed file. If you build this first instead, you must update all three live templates. Either is correct; ordering-after is cleaner. The overlap with the gate-env slice (`install-ci-emits-no-gate-env-let-config-decide`) is small — it edits the env block, this edits the `enumerate` job's `jq` (different regions of `advance-lifecycle-template.ts`) — so no hard `blockedBy` on it, just coordinate the rebase if both are mid-flight. (Left as `blockedBy: []` to keep this startable; the maintainer may promote the build-slice-tick ordering to a real `blockedBy` if auto-pick would otherwise grab this concurrently.)

## Prompt

> The maintainer has RESOLVED the design questions (see `## Decisions`): approach (a) (surface PRDs in `scan --json`, union `prd:` legs into the propose matrix) + a separate `specs[]` array key. Build to that.
>
> FIRST, drift-check: confirm the default cron tick still runs `propose` mode and that the propose `enumerate` job still builds its matrix from `dorfl scan --json | jq '... "slice:" + .slug'` (slice-only) in the LIVE template(s) — `packages/dorfl/src/advance-lifecycle-template.ts` is the retained superset; verify whether `build-slice-tick-template.ts` still exists (`ls packages/dorfl/src/build-slice-tick-template.ts` — as of 2026-06-16 it STILL EXISTS; the slice that deletes it, `install-ci-emits-one-advance-workflow-not-redundant-build-slice-tick`, is IN-PROGRESS, not landed) and skip it only if it is gone by build time. Confirm `scan`/`cwd-section` still enumerate slices only (no SPEC pool in `scan --json`), and that `scanMirrorPool` is where `sliceablePrds` lives. If a prior change already added SPEC legs to the propose matrix, route to needs-attention noting that.
>
> WHY: the hourly CI cron runs propose mode, whose matrix is built from a slice-only `scan --json`, so a ready ungated SPEC never becomes a matrix leg and `DORFL_AUTO_SLICE: 'true'` never fires on the scheduled tick. `skill-eval-engine` (authored ready) was never sliced for exactly this reason.
>
> GOAL (approach (a)): surface the sliceable-SPEC pool in `scan --json` (reuse `sliceablePrds` + the `work/spec`/`work/spec-sliced` read, resolve `autoSlice` per-repo as `scanMirrorPool` does — do not fork the predicate), then update the live propose `enumerate` `jq` to ALSO emit `prd:<slug>` legs for sliceable PRDs, so each ready SPEC becomes one `advance prd:<slug> --propose` leg. Do not change WHAT is sliceable (the `autoSlice` gate still binds); only make the pool visible to the propose enumerator.
>
> SEAM TO TEST AT: `scan --json` output (a ready ungated SPEC appears as sliceable; gated PRDs do not) + the emitted propose-matrix `jq` (enumerates both `slice:` and `prd:` legs) + the template structural validator + the end-to-end enumeration (a tree with one eligible slice + one sliceable SPEC yields both legs). Mirror the existing scan/`*-template.test.ts`/enumerate tests. No network.
>
> RELATED: `work/findings/autoslice-gate-conflates-verb-autonomy-and-review-loop.md` is ORTHOGONAL (it is about WHERE the autoSlice gate is checked — verb vs selection — not about the enumerator omitting PRDs). Do not conflate the two; this slice is purely "the propose enumerator must SEE the sliceable-SPEC pool".
>
> DONE: a ready, ungated, sliceable SPEC becomes a `prd:<slug>` matrix leg on the default propose tick; the `autoSlice` gate still binds; slice enumeration is unchanged; the validator matches; the approach decision is recorded; and `pnpm -r build && pnpm -r test && pnpm format:check` passes. Do NOT perform git transitions (no stage/commit/push, no folder moves) — the runner/human owns those.

---

### Claiming this slice

```sh
dorfl claim ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices --arbiter origin
git fetch origin && git switch -c work/ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices origin/main
git mv work/in-progress/ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices.md work/done/ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices.md
```
