---
title: Decouple intake document PR-mode from the autonomy gates via an `intakeIntegration` knob, and rename the `SpecsLandIn` value `pre-proposed → proposed`
slug: intake-integration-knob-and-specs-land-in-proposed-rename
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

Two coupled defects in the intake / placement config surface:

1. **Intake document PR-mode is welded to the autonomy gates.** `deriveIntakeFlags` derives the intake file-emit mode from `autoBuild`/`autoTask`: `task = autoBuild ? 'propose' : 'merge'`, `spec = autoTask ? 'propose' : 'merge'`. So a repo that wants autonomous tasking+building (`autoBuild: true`/`autoTask: true`) is FORCED to have every intake DOCUMENT be a PR, for trusted and untrusted authors alike. This makes the intended policy "task and build everything on main, and the ONLY PR is an untrusted implementation" INEXPRESSIBLE: the operator cannot have `autoBuild: true` (autonomy) AND intake documents merging to main at the same time. `autoBuild` is doing double duty — "may an agent act autonomously?" AND "does an intake document need a pre-merge PR?" — two orthogonal questions.

   Every OTHER transition already separates these: the tasking transition's document mode is `taskingIntegration ?? integration` (operator/config, NOT tied to `autoTask`), and the build mode is `integration`. Only INTAKE couples document-PR-mode to a gate. The autonomy gates should mean ONLY "may an agent act autonomously"; whether a document lands as a PR or a merge is the `integration`-family axis.

2. **The `SpecsLandIn` config VALUE `pre-proposed` does not match its folder `specs/proposed/`.** The task side is consistent (`tasksLandIn: 'backlog'` ↔ `tasks/backlog/`); the spec side is not (`'pre-proposed'` ↔ `specs/proposed/`). `pre-proposed` is a leftover of the earlier `pre-spec/` staging-folder prefix that survived the `folder-taxonomy-reorg-and-rename` rename to `proposed`. It is user-facing (`DORFL_SPECS_LAND_IN`, `--specs-land-in`, `dorfl.json`), so the mismatch is a papercut and a lifecycle inconsistency.

## Solution

**1. Add an `intakeIntegration` config knob (the twin of `taskingIntegration`).** Intake document mode becomes `intakeIntegration ?? integration` — operator/config only, resolved flag > env `DORFL_INTAKE_INTEGRATION` > per-repo > global > fall back to `integration` > default `propose`. `deriveIntakeFlags` STOPS reading `autoBuild`/`autoTask` for the document mode; the gates go back to meaning ONLY "may an agent act autonomously." Untrusted safety is unchanged and rests entirely on placement (`untrusted*LandIn`) + the build-time `originTrust: untrusted` stamp (the code PR). With this, the target config

```json
{ "integration": "merge", "autoBuild": true, "autoTask": true,
  "tasksLandIn": "ready", "specsLandIn": "ready",
  "untrustedTasksLandIn": "ready", "untrustedSpecsLandIn": "ready" }
```

does exactly what the operator wants: trusted issues task+build+merge entirely on main; an untrusted issue does the same EXCEPT its implementation build is forced to a PR by the stamp. No `intakeIntegration` line is needed for this case (it falls back to `integration: merge`).

**2. Rename the `SpecsLandIn` value `pre-proposed → proposed`** (HARD cutover, no alias — this repo has no external users yet, matching the `autoTriage → observationTriage` clean-cutover precedent) so the spec-side placement value matches its folder, mirroring the task side.

## User Stories

1. As a maintainer, I want a per-repo `intakeIntegration: merge | proposed` knob that governs the intake document PR-mode, resolved flag > env `DORFL_INTAKE_INTEGRATION` > per-repo > global > fall back to `integration` > default `propose`, so intake document mode is an operator/config choice like tasking, not a function of the autonomy gates.
2. As a maintainer, I want `deriveIntakeFlags` to STOP deriving the intake task/spec document mode from `autoBuild`/`autoTask`, so the autonomy gates mean ONLY "may an agent auto-task / auto-build," never "does the document need a PR."
3. As a maintainer who set `autoBuild: true` / `autoTask: true` with `integration: merge`, I want intake documents to MERGE to main (not become PRs), so I can have autonomy AND merged documents at once (previously mutually exclusive).
4. As a maintainer, I want the untrusted safety to remain the carried stamp (build-time code PR) + the placement default, unchanged by the `intakeIntegration` knob, so decoupling the document mode does NOT weaken the trust boundary.
5. As a maintainer, I want `intakeIntegration` to fall back to `integration` when unset (like `taskingIntegration`), so a single `integration: merge` merges documents across BOTH the tasking and intake transitions with no extra key.
6. As a maintainer, I want the CI intake workflow (`intake.yml`) derivation updated so it reads the resolved `intakeIntegration` (via `dorfl config --json`) for the document mode instead of `autoBuild`/`autoTask`, and the `deriveIntakeFlags` unit + shell-equivalence tests updated to the new rule.
7. As a maintainer, I want the `SpecsLandIn` value renamed `pre-proposed → proposed` everywhere (type, `DEFAULT_CONFIG`, env-config enum, repo-config passthrough, CLI `--specs-land-in` validation + help, `specLandingToSide`, tests) as a HARD cutover with no `pre-proposed` alias, so the spec-side placement value matches its folder `specs/proposed/` exactly as `tasksLandIn: backlog` matches `tasks/backlog/`.
8. As a maintainer, I want the built-in defaults documented and unchanged in effect for zero-config (everything propose, everything staged, nothing autonomous), so this is a safe, additive change: the only visible difference is when `autoBuild`/`autoTask` are on with `integration: merge`.

> Tasked — the implementation and testing detail moved into the two tasks (`intake-integration-knob`, `specs-land-in-proposed-rename`). The durable untrusted-safety rationale lives in `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.

## Out of Scope

- Splitting `intakeIntegration` into per-type `{task, spec}` (rejected — US #1 chose a single knob; the task/spec split existed only to carry the removed author-trust logic).
- Any change to the untrusted stamp / build-propose rule (unchanged; the safety boundary it holds is what MAKES decoupling the document mode safe).
- Renaming the `tasksLandIn` value (already consistent — `backlog` ↔ `tasks/backlog/`).
- A `pre-proposed` back-compat alias (rejected — hard cutover, no external users).

## Further Notes

- The `intakeIntegration` knob completes the per-transition integration family: `integration` (build), `taskingIntegration` (tasking), `intakeIntegration` (intake) — each a `merge|propose` mode that falls back to `integration`, none tied to an autonomy gate.
- Discovered while working out the rocketh config for "task+build all on main, only untrusted implementation is a PR" — which the old autoBuild-coupled intake mode could not express.
- The rename finding is recorded at `work/notes/observations/specs-land-in-value-pre-proposed-should-be-proposed-2026-07-23.md` (consumed by this spec).
