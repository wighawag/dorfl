---
title: 'Laptop do/advance/intake paths and shared rung bodies still note the line they return as the result'
slug: laptop-verbs-print-their-result-line-twice
---

2026-09-29, seen while building `ci-phase-logs-each-line-once`. That task removed the double `>>` lines from the CI phase drivers (`ci-phase-*.ts`), but the same "note the message, then return it for the CLI to print" pattern remains outside them: `performIntake`'s triage skip in `packages/dorfl/src/intake.ts` (~line 877), the `usage-error` / `merge-refused` returns of `applyRung` in `packages/dorfl/src/advance.ts`, and `acquireTaskingLock` / `acquireAdvancingLock` refusals on the laptop paths. For example, `dorfl do no-such-task` (isolated, the default) prints `>> 'work/tasks/ready/no-such-task.md' not found on origin/main ...` and then `error: <the same text>`. On the CI tree-less apply phase, a failing `applyRung` result can still show `>> X` then `error: X`.

Separately: `dorfl do <slug> --phase lock` WITHOUT `--in-place` takes the isolated `do` branch in `cli.ts` before the `--phase` dispatch, so it runs the whole single-process build (which then trips the lock-phase guard) instead of the lock phase. The generated workflows use `advance ... --phase`, so CI is not affected, but `do --phase` is advertised as a phase entry point (`runBuildPhaseAndExit('do', ...)`).
