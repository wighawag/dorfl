---
title: 'install-ci --max-parallel help describes concurrency slots, not matrix legs'
slug: install-ci-max-parallel-help-describes-slots
blockedBy: [pin-the-pi-harness-transitive-dependencies]
---

## What to build

Carried by issue #426 (the first live intake run failed on the harness, see `pin-the-pi-harness-transitive-dependencies`). If intake re-runs on #426 after the harness fix and produces its own task for this, drop this one as a duplicate.

The help text of `dorfl install-ci --max-parallel` (`packages/dorfl/src/cli.ts`) still says the value caps concurrent advance-lifecycle matrix legs. Since `ci-split-generate-workflows` there is no matrix: the value is the number of `dorfl-slot-<n>` concurrency groups the per-item `dorfl-item-dispatch.yml` runs queue in (observation `install-ci-max-parallel-help-still-says-matrix-legs-2026-09-28`).

## Acceptance criteria

- [ ] The help text and any adjacent doc comment describe the slots.
- [ ] No behaviour change.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- `pin-the-pi-harness-transitive-dependencies`

## Prompt

> Goal: fix a stale help string. Read the `--max-parallel` option of `install-ci` in `packages/dorfl/src/cli.ts` and the dispatch job in `advance-lifecycle-template.ts` for the real meaning.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
