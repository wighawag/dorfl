---
title: Document the `dorflBin` pin model + the version-upgrade ritual
slug: dorfl-bin-docs-and-upgrade-ritual
spec: dorfl-self-version-pinning-and-bootstrap-forward
blockedBy: [dorfl-bootstrap-self-forward]
covers: [1, 2, 5]
---

## What to build

User-facing documentation for the `dorflBin` pin model, so the mechanism is discoverable
and the mental model is clear:

- **The model:** dorfl is a TOOL (like `prettier`/`tsc`), the globally-installed `dorfl`
  is a BOOTSTRAP, a repo declares its dorfl via `dorflBin` in `dorfl.json`, and bare
  `dorfl` self-forwards to it (announced on stderr; opt out with `DORFL_NO_FORWARD=1` or
  `--no-forward`). Agents/humans keep typing bare `dorfl` (project-independent); the repo
  decides the version.
- **How to declare it, per ecosystem:** JS repo → `"dorflBin": "node_modules/.bin/dorfl"`
  (with `dorfl` pinned as a devDep); any repo with npx → `"dorflBin": "npx dorfl@<version>"`;
  a vendored binary → `"dorflBin": "./bin/dorfl"`; a toolchain manager → `"mise exec
  dorfl@<version> --"` etc. dorfl does NOT resolve or download a version — the command
  names whatever the environment already provides.
- **The upgrade ritual** (keep the three aligned): bump `dorflBin` (the pinned dorfl) →
  run `dorfl sync` (re-sync `work/protocol/` docs to the new version) → re-run
  `install-ci` ONLY if the workflow TEMPLATES changed (not for a routine version bump).
- **No trust gate, and why:** `dorflBin` is honoured verbatim at the same trust as the
  committed `verify` command; running `dorfl` in a repo already trusts its `dorfl.json`.

## Acceptance criteria

- [ ] The docs (the repo's user-facing docs — e.g. the website/docs pages and/or README,
      wherever dorfl documents config keys + CI) describe the `dorflBin` field, the
      bootstrap-forward behaviour, the announce + both opt-outs, and the per-ecosystem
      declaration examples.
- [ ] The upgrade ritual (bump `dorflBin` → `dorfl sync` → `install-ci` only if templates
      changed) is documented as the single aligned procedure.
- [ ] The docs state there is NO version resolution/cache (use `npx dorfl@<version>`) and
      NO trust gate (same trust as `verify`), so a reader does not expect a version
      manager.
- [ ] Cross-references are correct: `dorfl sync` (docs) vs `dorflBin` (executable) are
      distinguished; `setup`'s pin nudge points here.
- [ ] Docs-only task: no behaviour change, so the acceptance gate is the build/format
      checks + a docs review, not new runtime tests.

## Blocked by

- `dorfl-bootstrap-self-forward` — document the behaviour once it exists (so the docs
  describe shipped reality, not intent).

## Prompt

> Document the `dorflBin` pin model shipped by `dorfl-bin-config-field` +
> `dorfl-bootstrap-self-forward`. Read the spec
> `dorfl-self-version-pinning-and-bootstrap-forward` (all of Solution + Out of Scope) —
> this covers stories 1, 2, 5.
>
> Find where dorfl documents its `dorfl.json` config keys and its CI setup (the
> `website/`/docs pages and/or README — grep for where `verify`, `agentCmd`, `install-ci`,
> and `dorfl sync` are documented and add `dorflBin` alongside). Write: the mental model
> (dorfl = tool, global = bootstrap, repo declares `dorflBin`, bare `dorfl` forwards);
> per-ecosystem declaration examples (JS devDep path, `npx dorfl@<version>`, vendored
> `./bin/dorfl`, `mise`/`asdf`); the announce + `DORFL_NO_FORWARD=1` / `--no-forward`
> opt-outs; the upgrade ritual (bump `dorflBin` → `dorfl sync` → `install-ci` only if
> templates changed); and the explicit non-goals (no version resolution/cache — use `npx
> dorfl@<version>`; no trust gate — same trust as `verify`).
>
> Docs-only: no runtime behaviour changes. Match the existing docs voice/structure; do not
> invent a new docs section scheme. Run `pnpm format && pnpm -r build` (docs build if
> applicable) before finishing; add a changeset if the docs live in a released package (a
> `patch`, or an empty changeset if docs-only per CONTEXT/AGENTS conventions).
