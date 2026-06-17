---
title: Expose engine gates as workflow_dispatch inputs on advance-lifecycle
slug: advance-lifecycle-dispatch-gate-inputs
issue: 151
origin: issue
originTrust: trusted
covers: []
blockedBy: []
---

## What to build

Let a human override the engine GATE FAMILY for a single manual run of the `advance-lifecycle` workflow, the same way `integrationMode` is already overridable on dispatch.

Today the advance-lifecycle workflow resolves the gate family (`autoBuild`, `autoSlice`, `observationTriage`, `surfaceBlockers`) purely through the engine's flag > env > per-repo > global > default chain, and the workflow INTENTIONALLY emits no `AGENT_RUNNER_*` env line so the committed `.agent-runner.json` wins. That is correct as a default, but it means a human who wants to flip a gate ON for ONE manual `workflow_dispatch` run has to either edit the workflow, edit `.agent-runner.json`, or set a repo variable — all of which are sticky changes. We want the same one-shot affordance dispatch already gives `integrationMode` / `sweepMergedBranches`.

Add four `workflow_dispatch` inputs (one per gate) to the seed template `docs/ci/advance-loop.yml.template` AND propagate the same change to this repo's emitted `.github/workflows/advance-lifecycle.yml`:

- `autoBuild` (boolean, default unset)
- `autoSlice` (boolean, default unset)
- `observationTriage` (choice: `off` / `auto` / etc. matching the engine's accepted values, default unset)
- `surfaceBlockers` (boolean, default unset)

For each input, when (and ONLY when) the dispatch value is set, export the corresponding `AGENT_RUNNER_*` env var into the workflow `env:` block so it rides the env layer of the precedence chain for that one run. When the input is unset (the scheduled tick, the `push` trigger, or a dispatch that leaves the field blank), emit NOTHING — preserving today's behaviour where the committed config wins.

Keep the existing comment in `env:` accurate: it currently states the workflow emits no `AGENT_RUNNER_*` lines; rewrite it to say the workflow emits them ONLY when a dispatch override is supplied, and that on schedule/push it still emits nothing so config wins.

## Acceptance criteria

- `docs/ci/advance-loop.yml.template` declares the four new `workflow_dispatch` inputs alongside `integrationMode` / `sweepMergedBranches`, each with a `description` that names the gate, the env var it maps to, and notes the override is one-run-only.
- The emitted `.github/workflows/advance-lifecycle.yml` is regenerated/edited to match (this repo eats its own dogfood; `diff` of the input-handling shape between the template and the emitted file is consistent with how `integrationMode` is handled in both today).
- On a `workflow_dispatch` run where (say) `autoBuild=true` is supplied, the `AGENT_RUNNER_AUTO_BUILD` env var is set to `true` for every job in the workflow; on a run where the input is left blank (including scheduled / push triggers), `AGENT_RUNNER_AUTO_BUILD` is NOT exported.
- The other three gates behave the same way with their respective `AGENT_RUNNER_*` env vars.
- `integrationMode` and `sweepMergedBranches` behaviour is unchanged.
- The clarifying comment block in `env:` is updated to reflect the new "dispatch override exports, schedule/push does not" rule and still points readers at `.agent-runner.json` as the durable knob.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Prompt

Read `.github/workflows/advance-lifecycle.yml` and `docs/ci/advance-loop.yml.template` end-to-end before touching anything: the workflow's long comment blocks document the gate-family precedence chain and explicitly justify emitting NO `AGENT_RUNNER_*` env lines today — your change has to keep that invariant true on schedule/push and only break it on an explicit dispatch override.

Use the existing `integrationMode` / `sweepMergedBranches` pattern as the template: a `workflow_dispatch.inputs.<name>` entry (with `description`, `required: false`, no default for the gate inputs so blank reads as "don't override"), and a corresponding line in the workflow `env:` block that conditionally exports the env var via `${{ github.event.inputs.<name> && format(...) || '' }}` or the cleanest GitHub-Actions idiom for "emit nothing when blank". If the cleanest shape is per-job rather than top-level `env:`, that is fine — what matters is that schedule/push runs emit nothing and dispatch-with-value runs export the matching `AGENT_RUNNER_*`.

Remember `AGENTS.md`: the SOURCE OF TRUTH for protocol docs is `skills/setup/protocol/`, but THIS file is the CI seed in `docs/ci/` and its emitted twin under `.github/workflows/` — edit both and keep them shape-consistent. After editing, run `pnpm format` then verify with `pnpm -r build && pnpm -r test && pnpm format:check`.

## Needs attention

PR/code review (Gate 2) blocked this work:
- The dispatch gate-override step is wired into advance-propose-matrix and advance-merge but NOT into the `enumerate` job, yet `enumerate` runs `agent-runner scan --json` whose lifecycle pools are gated by `observationTriage` and `surfaceBlockers` via the same flag>env>per-repo>global>default chain (scan.ts `lifecycleGatesFrom` ⇒ triage=`observationTriage!=='off'`, surface=`surfaceBlockers===true`). A workflow_dispatch run that supplies `observationTriage=auto` to override a config of `'off'` (or `surfaceBlockers=true` over `false`) produces an empty `.lifecycle.triage[]`/`.lifecycle.surface[]` and therefore zero `obs:`/surface matrix legs — the override is impotent for the very use case the slice motivates. The slice AC also says verbatim "for every job in the workflow". Should the same `if: github.event_name == 'workflow_dispatch'` + `[ -n ... ]` write-to-$GITHUB_ENV step be inserted into `enumerate` (before the `scan` step) so the lifecycle-gate overrides actually shape the matrix? (.github/workflows/advance-lifecycle.yml lines ~178-208 (enumerate job: checkout, setup, scan — no gate-override step); packages/agent-runner/src/scan.ts lines 45-51 (`lifecycleGatesFrom`) and the surface/triage pool builders that consume it; the slice's What-to-build paragraph explicitly motivating the change with the lifecycle gates.)
PR/code review (Gate 2) did not reach an approve verdict within reviewMaxRounds=2 round(s); forcing needs-attention (never silently merged or looped).
