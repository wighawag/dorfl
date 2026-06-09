---
title: per-repo config — a committed repo-level config layered over global
slug: per-repo-config
prd: agent-runner
humanOnly: true
blockedBy: [scan]
covers: [3, 8]
---

## What to build

A **per-repo config layer**: a committed config file at a repo's root (e.g. `.agent-runner.json`) that overrides the global `~/.config/agent-runner/config.json` for that repo. This generalizes the config-resolution so repo-local properties — how this repo integrates, its `verify` gate, its arbiter — travel WITH the repo and are agreed by all collaborators and agents, rather than living only in one person's global config.

End-to-end:

- **A repo-level config file** (`.agent-runner.json` at repo root) holding a subset of config keys that are genuinely repo properties: at least `integration`, `verify`, `defaultArbiter` (extensible). It is committed (travels with the repo).
- **Layered resolution** — the effective config for a repo is, per key, highest wins: **flag (where a command offers one) > per-repo file > global config > built-in default**. This is the general mechanism; specific commands (e.g. `complete`'s `--merge`/`--propose`) sit on top at the flag level.
- **Multi-repo aware**: when the runner scans/operates across many repos, each repo's effective config is resolved against ITS OWN `.agent-runner.json` — so repo A can be `merge` while repo B is `propose` in the same run.
- Only the repo-appropriate subset is allowed in the per-repo file; global-only keys (e.g. `roots`, `maxParallel`, `humanWorktreesDir`) are ignored or rejected there with a clear message (they are about the runner/host, not a single repo).

This is the foundational layering other slices lean on: `complete-integration-flag` references the per-repo `integration` override; `verify` and arbiter selection can read their per-repo values through it.

## Acceptance criteria

- [ ] A repo's `.agent-runner.json` (at repo root) is read and layered OVER the global config for that repo.
- [ ] Per-key precedence is flag > per-repo > global > default; unit-tested for `integration` (and at least one other key, e.g. `verify`).
- [ ] Across multiple repos, each resolves against its own per-repo file (repo A `merge`, repo B `propose` in one run).
- [ ] Only repo-appropriate keys are honoured in the per-repo file; runner/host global-only keys are ignored/rejected with a clear message.
- [ ] A repo with no `.agent-runner.json` behaves exactly as today (global + defaults).
- [ ] Tests cover layering, multi-repo independence, and the rejected-key case.

## Blocked by

- `scan` — extends the config/detection core (the resolver + multi-repo plumbing).

## Prompt

> Implement a per-repo config layer for `agent-runner` in `packages/agent-runner/`. Read the existing `config.ts`. Add a committed repo-root config file (`.agent-runner.json`) that overrides the global config FOR THAT REPO, for a subset of keys that are genuinely repo properties (at least `integration`, `verify`, `defaultArbiter`; extensible). Resolution is per-key, highest wins: flag (where a command offers one) > per-repo file > global > built-in default. Make it MULTI-REPO aware: when operating across repos, each repo resolves against its own `.agent-runner.json`, so different repos can have different integration modes in one run. Reject/ignore runner/host-only keys (`roots`, `maxParallel`, `humanWorktreesDir`, …) in the per-repo file with a clear message. A repo without the file must behave exactly as today.
>
> This is the foundation `complete-integration-flag` (per-repo `integration`) and per-repo `verify`/arbiter selection build on — design the resolver generally, not just for one key.
>
> TDD with vitest: per-key layering precedence (test `integration` + one more); multi-repo independence; rejected global-only key; no-file = unchanged behaviour. Follow `AGENTS.md` (format with `pnpm format`; gate is check-only). Match house style; `commander` where a CLI surface is needed. "Done" = acceptance criteria met and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.
