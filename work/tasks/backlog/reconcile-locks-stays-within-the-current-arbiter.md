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
