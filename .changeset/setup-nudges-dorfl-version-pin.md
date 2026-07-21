---
'dorfl': patch
---

`setup` now nudges the user to PIN the dorfl version a repo runs with (reproducibility).

Agents are taught to invoke bare `dorfl` so the workflow stays project-independent, but bare `dorfl` then runs whatever version is globally installed — which drifts (a laptop on one version, CI floating to latest via `npm install -g dorfl`, a repo reasoned-about under a third). The `setup` skill's adoption conversation now includes a language-agnostic nudge, in the same style as its per-change-convention and `testFirst` nudges (folded into the plan, no extra question round): it asks once whether to pin the dorfl version, and records it the language-appropriate way — a root `package.json` devDependency for a JS repo (the `install-ci` CI shim already prefers a project-local `node_modules/.bin/dorfl`), or a vendored `./bin/dorfl` / `npx dorfl@<version>` / `mise` / `asdf` shim for a non-JS repo (never inventing a JS dependency). The scaffolded `CONTEXT.md` `## Conventions` stub carries a matching reminder. Forward-compatible with a future `dorflBin` pin field in `dorfl.json` (see the proposed spec `dorfl-self-version-pinning-and-bootstrap-forward`).
