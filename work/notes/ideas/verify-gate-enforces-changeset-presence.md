---
title: make `verify` enforce a changeset for package changes (so autonomous agents cannot land code without a release note), adopting the anon-pi pattern
slug: verify-gate-enforces-changeset-presence
type: idea
status: incubating
---

# `verify` should enforce a changeset for `packages/` changes

> Captured 2026-07-14 after a release. The `0.2.0` release's headline feature (the `stuck`-lock-state retirement arc) shipped across ~7 PRs but carried NO changeset for the feature itself — only 3 patch changesets from an unrelated prose/scan cleanup slice. A human had to HAND-WRITE the `minor` changeset at release time to make the changelog reflect the actual work. That backfill is the smell: nothing in the acceptance gate forces an autonomous `do`/`advance` agent to leave a release note, so the changelog silently drifts from reality.

## The gap

This repo's `dorfl.json` `verify` is:

```
pnpm format:check && pnpm build && pnpm test
```

There is no changeset check. So a `work/<slug>` branch that IMPLEMENTS code under `packages/dorfl/` can pass the full gate with an empty `.changeset/`, and the change lands with no release note. For an autonomous runner that is the common case (the agent builds the code, runs the gate green, the runner integrates) — the changelog only stays complete if a human remembers to add the changeset, which defeats the point of the autonomous pipeline.

## The pattern to adopt (proven in `anon-pi`)

`~/dev/github/wighawag/anon-pi` already solves this. Its `dorfl.json` `verify` wires the changeset status check straight into the gate:

```
pnpm format:check && pnpm changeset status --since=main && pnpm -r build && pnpm -r test
```

`changeset status --since=main` EXITS NON-ZERO when a tracked file under the package changed relative to `main` with no accompanying changeset — so the acceptance gate FAILS a code branch that forgot its release note, and the agent must produce one as part of doing the task. It is checked, not merely a convention an agent can forget.

Key nuances from anon-pi's rule (carry these over, do not copy the command blindly):

- **Scope is the package dir, not "did a user feel it".** The gate keys on `git diff --since=main` under `packages/<pkg>/`. ANY tracked file under it (incl. `test/**`, `tsconfig.json`, a comment-only edit) needs a changeset; a change with NO tracked file under the package dir (edits under `work/`, root docs like `AGENTS.md`, CI/tooling outside the package) needs NEITHER a changeset NOR a gate run.
- **No-user-facing-effect package change ⇒ EMPTY changeset.** A test/tsconfig/comment-only edit under the package still needs an entry: `pnpm changeset add --empty`. Do NOT add an empty changeset for a docs-/`work/`-only change (it wrongly bumps the package + clutters release notes).
- **Pick the bump honestly** (`patch`/`minor`/`major`) per semver for a real code change.

## Agents must be AWARE of it (where anon-pi documents it)

The gate only helps if agents know to satisfy it BEFORE hitting a red gate. anon-pi documents the convention in TWO places, and dorfl should mirror that:

- **`CONTEXT.md`** — a one-line pointer under the repo conventions: "Every package change requires a changeset (`pnpm changeset`); enforced by the `verify` gate via `pnpm changeset status --since=main`. See `AGENTS.md`."
- **`AGENTS.md`** — the full `## Changeset convention` section: needs-a-changeset vs does-not (keyed on the package dir), the `--empty` escape hatch for no-release package edits, the docs-only corollary (neither changeset nor gate run), and the exact `verify` line. anon-pi's wording is a good template to adapt.

Because dorfl is BOTH a user AND the author of the protocol, also consider whether the `setup` skill's shipped default `verify` / the protocol's guidance should teach this to TARGET repos (so every dorfl-managed repo gets the changeset gate + the agent-facing note), not just this repo.

## dorfl-specific adaptations to work out when tasked

- This repo's `verify` uses `pnpm -r build && pnpm -r test` (recursive) and there are 3 workspace projects (incl. `website/`). The changeset gate is a ROOT concern; place `pnpm changeset status --since=main` once in the root `verify`, not per-package.
- `--since=main` needs `main` reachable in the CI/worktree that runs `verify`. Confirm the fresh-gate worktree + the advance-lifecycle CI checkout both have an `origin/main` (or local `main`) ref for the `--since` diff to resolve; if not, pick the ref form that works in the isolated worktree the runner gates in.
- `website/` (`@dorfl/website`) is a separate workspace package; decide whether it participates in the changeset gate or is excluded (it is not published to npm the same way `dorfl` is).

## Why this is an idea, not a live change

Filed as an idea rather than bolted onto `verify` mid-release: it changes the acceptance gate for EVERY future task (a real blast radius), needs the agent-facing docs to land WITH it (or the first tasks after it just hit a confusing red gate), and needs the `--since=main`-in-isolated-worktree detail verified. Promote to a task when ready; keep the release itself (`0.2.0`) independent of it.
