---
'dorfl': patch
---

Document the `dorflCmd` pin model + the version-upgrade ritual (docs-only).

New reference page `docs/dorfl-cmd/README.md` explains the shipped pin model: dorfl is a TOOL like `prettier`/`tsc`, the globally-installed `dorfl` is a thin BOOTSTRAP, a repo declares which dorfl it runs via `dorflCmd` in `dorfl.json`, and bare `dorfl` self-forwards to it (announced on stderr; opt out with `--no-forward` / `DORFL_NO_FORWARD=1`). It covers the per-ecosystem declaration examples (JS devDep `node_modules/.bin/dorfl`, `npx dorfl@<version>`, a vendored `./bin/dorfl`, a `mise`/`asdf` shim), the fail-loud-on-broken-pin behaviour, the upgrade ritual (bump `dorflCmd` → `dorfl sync` → re-run `install-ci` only if the workflow templates changed), and the explicit non-goals (no version resolution/download/cache — write `npx dorfl@<version>` yourself; no trust gate — same trust as the committed `verify` command).

Cross-references added: the README `Pin the dorfl version (dorflCmd)` section, the website `dorfl.json` card, a `CONTEXT.md` glossary entry (distinguishing `dorflCmd` — the pinned EXECUTABLE — from `dorfl sync` — the `work/protocol/` DOCS), and the `docs/ci/README.md` shim note. The `setup` skill's version-pin nudge now points at the shipped `dorflCmd` field (and this page) instead of a placeholder `dorflBin`. No runtime behaviour changes.
