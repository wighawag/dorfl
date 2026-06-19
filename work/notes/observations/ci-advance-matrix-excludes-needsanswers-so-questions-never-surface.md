---
title: CI advance-lifecycle matrix filters on eligibility.eligible, so needsAnswers items + untriaged observations never get a leg and questions never surface
type: observation
status: spotted
spotted: 2026-06-16
---

## What was seen

In a real repo using `advance-lifecycle.yml` (this very repo) with the gate family
ON (`.agent-runner.json`: `observationTriage: "auto"`, `surfaceBlockers: true`,
`autoBuild: true`, `autoSlice: true`), **no question sidecar is ever produced** by
CI: there is no `work/questions/` directory at all, despite ~10+ untriaged notes
sitting in `work/observations/`.

## Root cause (structural, in the workflow — NOT the config)

The surface machinery is correctly wired in the engine:

- `classifyTick` (`packages/agent-runner/src/advance-classify.ts`) classifies a
  gated item (`needsAnswers: true`, no sidecar) as the **`surface`** rung, and an
  untriaged observation as **`triage-observation`** (which delegates to the surface
  rung in the default/question-gated path).
- `surfaceRung` (`advance.ts`) spawns the `surface-questions` agent and persists
  `work/questions/<type>-<slug>.md`.

But CI never *feeds* those items to `advance`. The `enumerate` step in
`.github/workflows/advance-lifecycle.yml` builds the propose matrix from
`scan --json` filtered by **`select(.eligibility.eligible == true)`**, and
`resolveGate` (`packages/agent-runner/src/eligibility.ts`) returns
`eligible: false` whenever `needsAnswers === true`. So:

- a `needsAnswers: true` slice/PRD ⇒ `eligible: false` ⇒ filtered out of the
  matrix ⇒ no `advance` leg ⇒ the `surface` rung never runs;
- an untriaged **observation** is not in the eligible slice/PRD pool at all
  (`scan --json` enumerates `items[]` (slices) + `prds[]`, not observations), so
  the `triage-observation` rung never runs either.

Net: the only items that ever get an `advance` leg in CI are fully-ready ungated
ones, which classify as `build-slice`/`slice-prd` and never surface. The
"human is the clock" answer-loop is therefore unreachable from CI as shipped — the
cron tick can build/slice but can never *ask*.

## Why it matters

`surfaceBlockers: true` / `observationTriage: "auto"` look enabled but are dead in
the default CI shape: the workflow's eligibility filter excludes exactly the items
those gates act on. A user reasonably concludes "questions aren't surfacing" and
suspects their config, when the config is correct and the workflow's matrix-source
filter is the gap.

## Refs

- `.github/workflows/advance-lifecycle.yml` — `enumerate.steps.scan` jq:
  `select(.eligibility.eligible == true)` over `items[]` + `prds[]`.
- `packages/agent-runner/src/eligibility.ts` — `resolveGate`: `needsAnswers === true`
  ⇒ `false`.
- `packages/agent-runner/src/scan.ts` — `scan --json` pool is slices (`items[]`) +
  sliceable PRDs (`prds[]`); observations are not enumerated.
- `packages/agent-runner/src/advance-classify.ts` — `surface` / `triage-observation`
  rungs (the machinery that IS correct).
- `packages/agent-runner/src/advance-lifecycle-template.ts` — the seed template the
  workflow is emitted from (fix belongs in the SEED, not the emitted copy).

## Possible directions (not yet a decision)

1. Add a **surface/triage pool** to `scan --json` (gated items + untriaged
   observations) and a second matrix source in `enumerate`, emitting
   `slice:`/`prd:`/`obs:` legs for them so `advance` runs the surface/triage rung.
2. OR run a single non-matrix `advance` sweep leg that enumerates surfaceable items
   itself (the engine already classifies correctly; it just needs to be *invoked*
   on those ids).

Either way the fix is in `advance-lifecycle-template.ts` (the seed) + `scan.ts`,
mirrored to the emitted workflow. Needs a design decision before slicing.
