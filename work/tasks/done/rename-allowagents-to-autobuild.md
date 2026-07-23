---
title: 'advance — RENAME `allowAgents` → `autoBuild` (the clean breaking-config migration, alias/deprecation window) so the gate family is symmetric (autoBuild/autoSlice/autoTriage) — SEQUENCED LAST'
slug: rename-allowagents-to-autobuild
spec: advance-loop
blockedBy: [advance-drivers-and-gates, advance-rung-triage]
covers: [36]
---

> NOT `humanOnly` (MAINTAINER-RESOLVED §3): the maintainer OVERRODE the earlier "slicer may mark it humanOnly" latitude — this is a clean, well-specified, agent-buildable breaking-config migration with an alias/deprecation window (precedent `rename-reviewpr-to-review`, `remove-sliced-marker-step-b`). Keep it IN-SET, sequenced LAST; do NOT spin it into a separate SPEC.

## What to build

The `allowAgents` → `autoBuild` config rename — a clean, ISOLATED breaking-config migration with an alias/deprecation window — DONE AFTER the advance family lands, so the gate family becomes symmetric (`autoBuild` / `autoSlice` / `autoTriage`). Build the rest of the advance work with `allowAgents` named as-is; this slice does the rename ALONE afterwards.

### Precise scope

- Rename the config key `allowAgents` → `autoBuild` across the config surface: `dorfl.json` (the per-repo file), `config.ts` / `env-config.ts` / `repo-config.ts` (the `REPO_ALLOWED_KEYS` entry, the resolution chain, the `DORFL_*` env var, the CLI flag `--allow-agents`/`--no-allow-agents` → `--auto-build`/`--no-auto-build`), and the docs / WORK-CONTRACT references.
- **Alias/deprecation window:** the OLD `allowAgents` key/flag/env still WORKS for a deprecation window (mapped to `autoBuild` with a deprecation warning), so existing repo configs don't break on upgrade. Mirror the precedent migration (`rename-reviewpr-to-review`) for the exact alias/warning shape.
- After this, the gate family reads symmetrically: `autoBuild` (build a ready slice) / `autoSlice` (slice a ready SPEC) / `autoTriage` (auto-disposition an observation) — all default off, all resolved through the same chain.

## Acceptance criteria

- [ ] `autoBuild` is the new name across `dorfl.json`, `config.ts` / `env-config.ts` / `repo-config.ts` (allowed keys, resolution chain, env var, CLI flag), docs, and WORK-CONTRACT.
- [ ] The OLD `allowAgents` key/flag/env still works for a deprecation window (aliased to `autoBuild` with a deprecation warning) — existing configs don't break on upgrade.
- [ ] The gate family is symmetric: `autoBuild`/`autoSlice`/`autoTriage`, all default off, all resolved through the same chain.
- [ ] Tests: `autoBuild` resolves through flag/env/per-repo/global/default; the old `allowAgents` alias still resolves (with a deprecation signal); the existing gate-composition tests pass under the new name. House config-resolution test style; no shared/global location touched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-drivers-and-gates` — the gate family (including `autoBuild`'s consumers) is wired there; rename AFTER it lands so the rename is isolated.
- `advance-rung-triage` — introduces `autoTriage` (the third gate the symmetry completes); rename after it so the family is renamed coherently in one pass.

## Prompt

> RENAME the config key `allowAgents` → `autoBuild` — a clean, ISOLATED breaking-config migration with an alias/deprecation window, SEQUENCED LAST so the gate family becomes symmetric (`autoBuild`/`autoSlice`/`autoTriage`). Read the SPEC `advance-loop` (in `work/spec-sliced/advance-loop.md` or `work/slicing/advance-loop.md` while being sliced — NOT `work/spec/`) (US #36, "The allowAgents → autoBuild rename", and MAINTAINER-RESOLVED §3 — it is IN-SET, NOT `humanOnly`, sequenced LAST). Build the rest of the advance work with `allowAgents` as-is; this slice does the rename ALONE. The OLD key/flag/env must still work for a deprecation window (aliased to `autoBuild` with a deprecation warning) so existing configs don't break. Mirror the precedent migration `rename-reviewpr-to-review` for the alias/warning shape.
>
> READ FIRST: `packages/dorfl/src/repo-config.ts` (`REPO_ALLOWED_KEYS` has `allowAgents` — rename + alias), `packages/dorfl/src/config.ts` + `env-config.ts` (the resolution chain + `DORFL_*` env var + the CLI flag), the `rename-reviewpr-to-review` migration (the precedent alias/deprecation pattern — look in `work/done/` / git history), and the docs / WORK-CONTRACT references to `allowAgents`. Grep the whole codebase for `allowAgents`.
>
> FIRST, check this slice against current reality (drift). If the gate family or the precedent migration landed differently than assumed, reconcile or route to `needs-attention/`.
>
> TDD with vitest, house config-resolution style. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim rename-allowagents-to-autobuild --arbiter origin
git fetch origin && git switch -c work/rename-allowagents-to-autobuild origin/main
git mv work/in-progress/rename-allowagents-to-autobuild.md work/done/rename-allowagents-to-autobuild.md
```
