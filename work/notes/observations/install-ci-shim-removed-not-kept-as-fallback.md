# Decision (2026-07-21): install-ci CI resolver shim REMOVED entirely, not kept as a no-`dorflCmd` JS fallback

Task `install-ci-shim-converges-on-dorfl-cmd` (spec `dorfl-self-version-pinning-and-bootstrap-forward` §6 / story 4) required choosing, at build time, between two options for the bespoke `node_modules/.bin/dorfl` `$PATH` shim in the emitted `dorfl-setup` composite action:

- **A (chosen): remove the shim entirely** and rely on the global bootstrap's self-forward to `dorflCmd`.
- **B (rejected): keep it as a thin fallback** that applies only when a JS repo declares NO `dorflCmd`.

**Chose A.** Why:
- The spec's explicit goal is ONE code path (CI and laptop pin dorfl by the SAME generic mechanism, JS and non-JS alike). Keeping the shim maintains two code paths and re-introduces exactly the JS-specific, CI-only special case the convergence is meant to eliminate.
- Double-resolution hazard: if a repo declares BOTH a devDep AND `dorflCmd`, the shim would `exec` the project-local `node_modules/.bin/dorfl`, which then reads the same `dorfl.json`, sees `dorflCmd`, and forwards AGAIN — a confusing extra hop that defeats "one code path".
- The no-`dorflCmd` JS repo is exactly the un-adopted case: `setup` now nudges it to declare `dorflCmd: "node_modules/.bin/dorfl"` (one line), after which the generic forward gives it the pin in CI and on the laptop identically. A repo that declares no `dorflCmd` correctly floats to the global bootstrap — the same behaviour both places (onboarding-safe).

**What it touches:** only the STRING-TEMPLATING in `install-ci-core.ts` `generateSetupAction` (the removed PREFER-LOCAL RESOLVER block) + the install-ci tests asserting the emitted action. The `verify` required-check name, git identity, harness install, workspace-mode install path, and `--fake` mode are all UNCHANGED. The decision is also recorded inline at the choice site (a comment where the resolver block used to be) and in the changeset `.changeset/install-ci-shim-converges-on-dorfl-cmd.md`.
