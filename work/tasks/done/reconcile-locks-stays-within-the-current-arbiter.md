---
title: 'dorfl status --reconcile-locks must only touch the current repository's arbiter unless asked otherwise'
slug: reconcile-locks-stays-within-the-current-arbiter
blockedBy: []
---

## What to build

During the CI-split drive, `dorfl status --reconcile-locks` run from this repository's checkout (to release one finished lock) also released a lock in a different repository's arbiter (`etherfold`: `released 1 stale per-item lock(s) ... task-a-worker-hosted-tab-starts-from-a-...`). That release happened to be correct (the item was terminal), but a mutating command should not reach other repositories implicitly. `gc` already made the same choice: it is arbiter-scoped by default and needs an explicit `--all-arbiters` for the global sweep.

Scope `--reconcile-locks` to the current repository's arbiter by default (resolved from the cwd, like `gc`), and require an explicit flag (reuse `--all-arbiters` for consistency) to reconcile every known arbiter. Read-only `status` output can stay global.

## Acceptance criteria

- [ ] From inside a repository, `status --reconcile-locks` reconciles only that repository's arbiter (tested with two arbiters, one of which must be left untouched).
- [ ] `status --reconcile-locks --all-arbiters` reconciles every arbiter, as today.
- [ ] The help text says so.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: give `dorfl status --reconcile-locks` the same arbiter scoping `gc` has. Read the `status` command in `packages/dorfl/src/cli.ts` (`reconcileLocks`), the reconcile implementation it calls, and how `gc` resolves its default arbiter scope and `--all-arbiters`.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Refuse when no arbiter can be found (new error):** without `--all-arbiters`, `status --reconcile-locks` run outside a repository, or in one with no arbiter remote, now exits 1 instead of releasing on every arbiter. This matches `gc`'s behaviour. The alternatives were to quietly release nothing, or to fall back to the global release, which is what the task set out to remove. It only affects the `--reconcile-locks` write; plain `status` and `status --here` never refuse.
- **Reuse `--all-arbiters` rather than a new flag:** the task asked for this so it reads the same as `gc`. On `status` the flag only affects the `--reconcile-locks` write, and the help says so. It doesn't widen the report, which already covers every registered repository.
- **Which remote defines "current arbiter":** it comes from `--arbiter <remote>` if given, otherwise the configured `defaultArbiter`, as in `gc`. Unlike `gc`, `status --arbiter` accepts only a remote name, not a URL, because that is how `status` already defined the flag. Note that the report for the current directory still defaults its lock remote to `origin`. The two only differ if `defaultArbiter` is set to something other than `origin`.
- **Repository matching:** a repository counts as in scope when its `origin` URL gives the same repository key as the current directory's arbiter, the same keying `gc` uses. A repository whose `origin` can't be read is treated as out of scope, so nothing is released there.
