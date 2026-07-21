---
title: Converge the install-ci resolver shim onto the generic `dorflCmd` bootstrap forward
slug: install-ci-shim-converges-on-dorfl-cmd
spec: dorfl-self-version-pinning-and-bootstrap-forward
humanOnly: true
blockedBy: [dorfl-bootstrap-self-forward]
covers: [4]
---

## What to build

Once bare `dorfl` self-forwards from `dorflCmd` (task `dorfl-bootstrap-self-forward`),
`install-ci`'s bespoke CI resolver SHIM — the `$PATH` shim in the emitted `dorfl-setup`
composite action that hardcodes a preference for `node_modules/.bin/dorfl` over the
global — is redundant and JS-specific. Converge it onto the generic mechanism so CI and
the laptop use ONE code path (JS and non-JS alike):

- The emitted `dorfl-setup` action's `dorfl` on `$PATH` should be the GLOBAL bootstrap,
  which now forwards to the repo's declared `dorflCmd` by itself. The JS-only
  `node_modules/.bin/dorfl`-preference shim is removed OR reduced to a thin fallback that
  only applies when a repo declares NO `dorflCmd` (so a JS repo that pins via a devDep but
  never set `dorflCmd` still resolves the project-local copy — decide which at build time
  and record the choice).
- The generated workflow YAML / composite action stays coherent (the `verify` required
  check name, the git identity, the harness install are all unchanged); only the dorfl
  resolution step changes.

## Acceptance criteria

- [ ] The emitted `dorfl-setup` composite action no longer depends on the JS-specific
      `node_modules/.bin/dorfl` shim as the ONLY pinning path: a repo that declares
      `dorflCmd` gets the pinned dorfl in CI via the generic bootstrap forward.
- [ ] The decision (delete the shim entirely vs keep it as a no-`dorflCmd` JS fallback) is
      made explicitly and recorded (a `## Decisions` note or ADR), with the emitted action
      matching that decision.
- [ ] The install-ci tests that assert the emitted `dorfl-setup` / workflow content are
      updated to the new shape and pass; the `verify` required-context name and other
      steps are unchanged (no regression to branch-protection wiring).
- [ ] `--fake` snapshot mode still writes to `.fake/` and sets no secrets (unchanged).
- [ ] Tests isolate any emitted-file fixtures in a scratch dir; `.github/` of the real
      repo is untouched by tests.

## Blocked by

- `dorfl-bootstrap-self-forward` — the generic forward must exist before the CI shim can
  defer to it.

## Prompt

> `humanOnly`: this task edits CI auth/setup scaffolding (the `install-ci`-emitted
> `dorfl-setup` composite action + workflow templates) that provisions the runner's
> environment and sits next to secret/branch-protection wiring — by nature a human should
> drive it (WORK-CONTRACT `humanOnly` = never-for-agents-by-nature: release/CI/secrets).
>
> Goal: converge the CI resolver shim onto the generic `dorflCmd` bootstrap forward added
> by `dorfl-bootstrap-self-forward`, so CI and the laptop pin dorfl by the SAME mechanism.
> Read the spec `dorfl-self-version-pinning-and-bootstrap-forward` Solution §6 (story 4).
>
> Look at the `install-ci` code that emits the `dorfl-setup` composite action (the shim is
> the `printf`-generated `$PATH` script that prefers `${GITHUB_WORKSPACE}/node_modules/.bin/dorfl`
> over the global — task `install-ci-prefer-project-local-dorfl`; the emitter is the
> PREFER-LOCAL RESOLVER block in `install-ci-core.ts`, and the install-ci tests that assert
> the emitted action content are its coverage). Now that the global
> bootstrap forwards to `dorflCmd` on its own, that shim is redundant for a repo that
> declares `dorflCmd`. DECIDE and record: remove the shim entirely (rely on the bootstrap
> forward), or keep it ONLY as a fallback for a JS repo that pinned via a devDep but set no
> `dorflCmd`. Update the emitted action + the install-ci tests that assert its content.
> Keep everything else in the emitted CI (the `verify` required-check name, git identity,
> harness install, `--fake` mode) unchanged. Run `pnpm format && pnpm -r build && pnpm -r
> test` and add a changeset before finishing.
