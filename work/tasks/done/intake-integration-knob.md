---
title: 'Add intakeIntegration knob; decouple intake document PR-mode from autoBuild/autoTask'
slug: intake-integration-knob
spec: intake-integration-knob-and-specs-land-in-proposed-rename
blockedBy: []
covers: [1, 2, 3, 4, 5, 6, 8]
---

## What to build

Add a per-repo `intakeIntegration` config knob (the twin of `taskingIntegration`) that governs the intake document PR-mode, and stop deriving that mode from the autonomy gates.

- New optional `intakeIntegration?: IntegrationMode` (`merge | propose`), resolved flag > env `DORFL_INTAKE_INTEGRATION` > per-repo > global > fall back to `integration` > default `propose`. Wire into config type/defaults, env-config, repo-config, and `dorfl config --json`.
- Rewrite `deriveIntakeFlags`: the intake task/spec document mode = the resolved `intakeIntegration` (a SINGLE value applied to both task and spec), NOT `autoBuild ? 'propose' : 'merge'` / `autoTask ? ...`. Author-trust still sets ONLY the `originTrust` stamp. Update `IntakeIntegrationFlags`, the runtime bash in `generateIntakeWorkflow` (read `intakeIntegration` via `dorfl config --json`, no longer autoBuild/autoTask for the mode), the structural validators, and the shell≡function test.
- The autonomy gates (`autoBuild`/`autoTask`) keep their own meaning (auto-build / auto-task selection); they simply no longer feed the intake document mode. The intake CLI's explicit `--merge-task`/`--merge-spec`/`--merge`/`--propose` flags still override.

Net: a repo with `autoBuild: true`/`autoTask: true` + `integration: merge` now MERGES intake documents to main (previously forced to a PR). Untrusted safety is unchanged (placement + the build-time stamp PR).

## Acceptance criteria

- [ ] `intakeIntegration` resolves through the full chain and falls back to `integration` when unset; `DORFL_INTAKE_INTEGRATION` honored; surfaced in `dorfl config --json`.
- [ ] `deriveIntakeFlags` document mode = resolved `intakeIntegration`, independent of `autoBuild`/`autoTask`; author-trust sets only the stamp.
- [ ] The workflow bash reads `intakeIntegration` (via `dorfl config --json`), not the gates, for the document mode; the shell≡function test asserts the new rule.
- [ ] With `autoBuild: true` + `integration: merge` (intakeIntegration unset), an intake task/spec document MERGES to main; an untrusted one merges the document but its later BUILD is forced to a PR by the stamp.
- [ ] Zero-config behaviour unchanged (everything propose; the gates default off).
- [ ] Tests cover config resolution, the derivation, and the intake integration behaviour (offline provider).

## Blocked by

- None — can start immediately.

## Prompt

> Goal: make the intake document PR-mode an operator/config choice (`intakeIntegration`, twin of `taskingIntegration`), decoupled from the autonomy gates, so a repo can have autonomous tasking+building AND intake documents that merge to main.
>
> Domain: dorfl has a per-transition integration family. `integration` (build mode), `taskingIntegration ?? integration` (tasking document mode — NOT tied to `autoTask`), and — after this task — `intakeIntegration ?? integration` (intake document mode). Today intake is the odd one out: `deriveIntakeFlags` derives the intake task/spec document mode from `autoBuild`/`autoTask` (`task = autoBuild ? 'propose' : 'merge'`), welding "may an agent act autonomously" to "does the document need a PR." Separate them: add `intakeIntegration` and read it for the mode; the gates go back to meaning only autonomy.
>
> Where to look: `config.ts` (the `taskingIntegration` field + `DEFAULT_CONFIG` + resolution — mirror it for `intakeIntegration`); `env-config.ts` / `repo-config.ts` (add the env/per-repo passthrough, env `DORFL_INTAKE_INTEGRATION`); `dorfl config --json` emission; `intake-trigger-template.ts` (`deriveIntakeFlags`, `IntakeIntegrationFlags`, `IntakeGateState`, `generateIntakeWorkflow`'s `steps.policy` bash, `validateIntakeWorkflow`, and the shell≡function test). The intake CLI already has `--merge-task`/`--merge-spec`/`--merge`/`--propose` explicit overrides — keep them working (operator-present top of precedence).
>
> Test at: config resolution (chain + fallback + env), the `deriveIntakeFlags` unit + shell-equivalence, and the intake integration seam (offline provider): `integration: merge` + `autoBuild: true` ⇒ document merges; untrusted ⇒ document merges but build proposes. Governing spec: `intake-integration-knob-and-specs-land-in-proposed-rename`; the untrusted-safety rationale is `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.
>
> RECORD any in-scope decision (e.g. how `IntakeIntegrationFlags` is reshaped) per the ADR gate; link from the done record. Done: knob resolves + falls back, gates no longer drive intake document mode, untrusted safety intact, tests green, gate green.
