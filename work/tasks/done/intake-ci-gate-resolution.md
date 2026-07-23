---
title: 'Stop intake.yml hardcoding DORFL_AUTO_* env; read resolved config; add anti-regression validators'
slug: intake-ci-gate-resolution
spec: untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution
blockedBy: [derive-intake-flags-trust-drives-placement-not-mode]
covers: [11, 12]
---

## What to build

Fix the CI gate-resolution shadowing: the generated `intake.yml` hardcodes `DORFL_AUTO_BUILD: 'false'` / `DORFL_AUTO_TASK: 'false'` in its `env:` block, which outranks the repo's committed `dorfl.json` (env > per-repo in the resolution chain). Align intake with the already-correct `advance` workflow.

- In `generateIntakeWorkflow` (`intake-trigger-template.ts`): DELETE the two `DORFL_AUTO_BUILD` / `DORFL_AUTO_TASK` env lines. Where a resolved gate value is still needed (the spec file-emit mode stays gate-derived), read it via `dorfl config --json` (the mechanism `advance` already uses), not a raw env var.
- Add structural validators to `validateIntakeWorkflow`: `no-gate-env-auto-build` and `no-gate-env-auto-task`, forbidding a `DORFL_AUTO_BUILD:` / `DORFL_AUTO_TASK:` env ASSIGNMENT, mirroring `advance-lifecycle-template.ts`'s equivalents.
- No `workflow_dispatch` override inputs (intake has no dispatch trigger).

Net behaviour: a repo with `autoBuild: true` in `dorfl.json` is HONORED by the intake derivation instead of shadowed by the retired hardcoded `false`.

## Acceptance criteria

- [ ] The generated `intake.yml` emits NO `DORFL_AUTO_BUILD:` / `DORFL_AUTO_TASK:` env assignment.
- [ ] Where a resolved gate is needed, the workflow reads it via `dorfl config --json` (as `advance` does).
- [ ] `validateIntakeWorkflow` gains `no-gate-env-auto-build` / `no-gate-env-auto-task` invariants that FAIL on a workflow emitting the env and PASS on the fixed one.
- [ ] A repo config with `autoBuild: true` is reflected in the derived behaviour (assert it is no longer shadowed).
- [ ] Tests: the generator snapshot/structural test asserts the env lines are gone + the validators fire; a config-resolution test asserts `dorfl.json` wins.

## Blocked by

- Blocked by `derive-intake-flags-trust-drives-placement-not-mode` (the derivation that reads the gates is rewritten first, so this task removes the env against the final derivation shape).

## Prompt

> Goal: make the intake CI workflow honor the repo's `dorfl.json` gates by construction (kill the env-shadowing bug), matching the `advance` workflow's established pattern.
>
> Domain: dorfl's gate resolution is flag > env (`DORFL_*`) > per-repo `dorfl.json` > global > default. The intake `env:` block hardcodes `DORFL_AUTO_BUILD: 'false'` / `DORFL_AUTO_TASK: 'false'`, so env ALWAYS wins over the repo's config — the documented "same dorfl.json applies in CI" is currently false for intake. The `advance` workflow already solved this: it emits NO gate env on a schedule/push tick and reads resolved config via `dorfl config --json`, and `validateAdvanceLifecycleWorkflow` has `no-gate-env-auto-build`/`no-gate-env-auto-task` invariants forbidding the env. Copy that pattern into intake.
>
> Where to look: `generateIntakeWorkflow` (the `env:` block with the two `DORFL_AUTO_*` lines + the `steps.policy` bash that reads them) and `validateIntakeWorkflow` in `intake-trigger-template.ts`; the reference is `advance-lifecycle-template.ts` — grep it for `no-gate-env-auto-build`, `dorfl config --json`, and how it exports a gate only on a manual dispatch. Note intake has NO `workflow_dispatch` trigger, so there are no override inputs to add; just remove the hardcoded defaults and read resolved config where the spec-mode derivation needs a gate.
>
> Test at the workflow generator/validator seam (the dependency-free structural assertions this module already uses) + a config-resolution test that a `dorfl.json` gate is honored. Governing decision: `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.
>
> Done: the env lines are gone, resolved config is read via `dorfl config --json`, the two new validators fire, `dorfl.json` gates are honored, tests green, gate green.
