---
title: 'Rewrite deriveIntakeFlags so author-trust drives placement + stamp, not the file-emit mode'
slug: derive-intake-flags-trust-drives-placement-not-mode
spec: untrusted-origin-carries-via-stamp-intake-placement-symmetry-and-ci-gate-resolution
blockedBy: [intake-task-placement-symmetry]
covers: [3, 13]
---

## What to build

Rewrite the intake author-trust derivation (`deriveIntakeFlags` in `intake-trigger-template.ts`) + the matching runtime bash in `generateIntakeWorkflow` so author-trust feeds PLACEMENT + the `--origin-trust` stamp, and NO LONGER derives a `--merge/--propose` file-emit mode for the task or spec.

- `deriveIntakeFlags`: author-trust yields (a) the `originTrust` stamp value (unchanged) and (b) the placement-default selection signal (trusted vs untrusted). It no longer returns a task/spec `'merge' | 'propose'` file-emit mode driven by trust. The file-emit mode becomes config/gate-derived (the spec mode stays gate-derived as today; the task mode is the operator/config value).
- Update the `IntakeIntegrationFlags` interface + the workflow's runtime `bash` step to match: pass the `--*-land-in` selection + `--origin-trust` to `dorfl intake`, not a trust-derived `--merge-task`/`--propose-task`.
- Update the unit test that asserts the shell derivation is byte-equivalent to the function (the shell≡function discipline) to the new rule.

Net behaviour: whether a document is a PR is now the operator/config per-transition mode, never a function of `author_association`. Author-trust only picks the landing folder + stamps the file.

## Acceptance criteria

- [ ] `deriveIntakeFlags` no longer emits a trust-derived task/spec file-emit mode; it emits the origin-trust stamp + the placement selection.
- [ ] The `IntakeIntegrationFlags` interface reflects the new shape (no trust-driven `spec`/`task` mode fields, or repurposed).
- [ ] The workflow runtime bash mirrors the new function exactly, and the shell≡function unit test asserts it.
- [ ] A trusted vs untrusted author differ ONLY in placement + stamp, not in whether a document is PR'd.
- [ ] Tests cover: untrusted ⇒ untrusted stamp + untrusted placement selection; trusted ⇒ trusted stamp + trusted placement selection; file-emit mode is independent of trust.

## Blocked by

- Blocked by `intake-task-placement-symmetry` (the task path must consume placement inputs before the derivation stops feeding it a mode).

## Prompt

> Goal: stop author-trust from deciding whether an intake task/spec DOCUMENT is a PR. After this task, author-trust affects only (1) which folder the document lands in and (2) the `originTrust` stamp; the merge-vs-propose of the DOCUMENT is the operator/config per-transition mode.
>
> Domain: `intake-trigger-template.ts` holds `deriveIntakeFlags` (the pure policy the CI workflow encodes at runtime) + `generateIntakeWorkflow` (which emits a `bash` step mirroring that function) + `validateIntakeWorkflow`. Today `deriveIntakeFlags` returns `{spec, task}` file-emit modes derived from `autoBuild`/`autoTask` gates COMPOSED with author-trust (`task: autoBuild || !authorTrusted ? 'propose' : 'merge'`). You are removing author-trust from the MODE and moving it to placement + the stamp. The shell in the workflow and the function MUST stay byte-equivalent (there is a test asserting this — update both together).
>
> Where to look: `deriveIntakeFlags` + `IntakeIntegrationFlags` + `isAuthorTrusted` in `intake-trigger-template.ts`; the `steps.policy` bash block in `generateIntakeWorkflow`; the `deriveIntakeFlags` unit test + the shell≡function assertion. The `--origin-trust` stamp derivation already exists (keep it); the `--*-land-in` flags are consumed by intake's dispatch (wired in the prior task) — this task makes the WORKFLOW pass them based on trust.
>
> Test at the `deriveIntakeFlags` unit seam + the shell-equivalence test. Governing decision: `docs/adr/untrusted-origin-carries-via-stamp-not-forced-staging.md`.
>
> Note: the two hardcoded gate-env lines + the `no-gate-env-*` validators are the NEXT task; here focus on the trust→placement+stamp rewrite of the derivation. RECORD the interface reshape decision per the ADR gate. Done: derivation rewritten, shell matches, tests green, gate green.
