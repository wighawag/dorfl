---
'dorfl': patch
---

Converge the `install-ci` CI resolver shim onto the generic `dorflCmd` bootstrap forward.

The emitted `dorfl-setup` composite action historically installed the global `dorfl` (`npm install -g dorfl`) and then wrote a bespoke `$PATH` shim that preferred a project-local `node_modules/.bin/dorfl` over the global (task `install-ci-prefer-project-local-dorfl`). That shim was CI-only AND JS-specific (it hardcoded `node_modules/.bin`).

Now that the global bootstrap `dorfl` self-forwards to the repo-declared `dorflCmd` on its own (task `dorfl-bootstrap-self-forward`), that shim is redundant. This change REMOVES it entirely: CI's `npm install -g dorfl` leaves the bootstrap on `$PATH`, and the bootstrap forwards to the repo's declared `dorflCmd` by the SAME generic mechanism the laptop uses — one code path, JS and non-JS alike (spec `dorfl-self-version-pinning-and-bootstrap-forward` §6 / story 4).

A JS repo that pinned via a devDep declares `dorflCmd: "node_modules/.bin/dorfl"` (one line; `setup` nudges it) and gets the pin in CI via the forward; a repo with no `dorflCmd` runs the global bootstrap identically on CI and the laptop (onboarding-safe). Keeping a JS-only no-`dorflCmd` fallback was deliberately rejected — it would re-introduce the JS-specific CI-only special case the convergence removes, and a repo declaring both the devDep and `dorflCmd` would double-resolve (shim execs the local bin which then forwards again).

Everything else in the emitted CI is UNCHANGED: the `verify` required-check name, the `dorfl[bot]` git identity, the harness install, and the `--fake` snapshot mode. Only the dorfl-resolution step changed.
