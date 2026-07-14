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

Today the advance-lifecycle workflow resolves the gate family (`autoBuild`, `autoSlice`, `observationTriage`, `surfaceBlockers`) purely through the engine's flag > env > per-repo > global > default chain, and the workflow INTENTIONALLY emits no `DORFL_*` env line so the committed `dorfl.json` wins. That is correct as a default, but it means a human who wants to flip a gate ON for ONE manual `workflow_dispatch` run has to either edit the workflow, edit `dorfl.json`, or set a repo variable — all of which are sticky changes. We want the same one-shot affordance dispatch already gives `integrationMode` / `sweepMergedBranches`.

Add four `workflow_dispatch` inputs (one per gate) to the seed template `docs/ci/advance-loop.yml.template` AND propagate the same change to this repo's emitted `.github/workflows/advance-lifecycle.yml`:

- `autoBuild` (boolean, default unset)
- `autoSlice` (boolean, default unset)
- `observationTriage` (choice: `off` / `auto` / etc. matching the engine's accepted values, default unset)
- `surfaceBlockers` (boolean, default unset)

For each input, when (and ONLY when) the dispatch value is set, export the corresponding `DORFL_*` env var into the workflow `env:` block so it rides the env layer of the precedence chain for that one run. When the input is unset (the scheduled tick, the `push` trigger, or a dispatch that leaves the field blank), emit NOTHING — preserving today's behaviour where the committed config wins.

Keep the existing comment in `env:` accurate: it currently states the workflow emits no `DORFL_*` lines; rewrite it to say the workflow emits them ONLY when a dispatch override is supplied, and that on schedule/push it still emits nothing so config wins.

## Acceptance criteria

- `docs/ci/advance-loop.yml.template` declares the four new `workflow_dispatch` inputs alongside `integrationMode` / `sweepMergedBranches`, each with a `description` that names the gate, the env var it maps to, and notes the override is one-run-only.
- The emitted `.github/workflows/advance-lifecycle.yml` is regenerated/edited to match (this repo eats its own dogfood; `diff` of the input-handling shape between the template and the emitted file is consistent with how `integrationMode` is handled in both today).
- On a `workflow_dispatch` run where (say) `autoBuild=true` is supplied, the `DORFL_AUTO_BUILD` env var is set to `true` for every job in the workflow; on a run where the input is left blank (including scheduled / push triggers), `DORFL_AUTO_BUILD` is NOT exported.
- The other three gates behave the same way with their respective `DORFL_*` env vars.
- `integrationMode` and `sweepMergedBranches` behaviour is unchanged.
- The clarifying comment block in `env:` is updated to reflect the new "dispatch override exports, schedule/push does not" rule and still points readers at `dorfl.json` as the durable knob.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Prompt

Read `.github/workflows/advance-lifecycle.yml` and `docs/ci/advance-loop.yml.template` end-to-end before touching anything: the workflow's long comment blocks document the gate-family precedence chain and explicitly justify emitting NO `DORFL_*` env lines today — your change has to keep that invariant true on schedule/push and only break it on an explicit dispatch override.

Use the existing `integrationMode` / `sweepMergedBranches` pattern as the template: a `workflow_dispatch.inputs.<name>` entry (with `description`, `required: false`, no default for the gate inputs so blank reads as "don't override"), and a corresponding line in the workflow `env:` block that conditionally exports the env var via `${{ github.event.inputs.<name> && format(...) || '' }}` or the cleanest GitHub-Actions idiom for "emit nothing when blank". If the cleanest shape is per-job rather than top-level `env:`, that is fine — what matters is that schedule/push runs emit nothing and dispatch-with-value runs export the matching `DORFL_*`.

Remember `AGENTS.md`: the SOURCE OF TRUTH for protocol docs is `skills/setup/protocol/`, but THIS file is the CI seed in `docs/ci/` and its emitted twin under `.github/workflows/` — edit both and keep them shape-consistent. After editing, run `pnpm format` then verify with `pnpm -r build && pnpm -r test && pnpm format:check`.
