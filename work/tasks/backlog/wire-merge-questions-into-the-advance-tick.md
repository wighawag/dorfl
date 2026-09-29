---
title: 'Wire the merge-question surfacer into the advance tick and resolve its clash with the propose lock'
slug: wire-merge-questions-into-the-advance-tick
needsAnswers: true
blockedBy: [merge-question-surfacer-finds-namespaced-work-branches]
---

<!-- open-questions -->

## Open questions

1. When a work branch already has an open PR on a host with PRs (GitHub), should the surfacer skip it (the PR merge is the human's answer, and merge questions are for the git-alone floor), or surface it too?
2. If merge questions do apply to propose-built branches: may the answered-merge lock phase take over a lock held by the same item's propose build (entry action `implement`, same item), or should the propose build release its lock when it surfaces a merge question?
3. Should `mergeQuestions: auto` exist at all (it lands without a human), or be removed along with the dead `--merge-questions` flag?

<!-- /open-questions -->

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `merge-question-surfacer-has-no-production-caller`: `surfaceMergeQuestions` has no production caller; `advance --merge-questions` is declared and never read; the `mergeQuestions` config key (default `ask`, documented as "a silently-dropped merge-question means finished, pushed work never lands") has no effect. And even with a surfaced and answered question, the answered-merge action cannot run on a propose-built branch: the propose build keeps the per-item lock "until the PR merges" (`propose-keep-lock-until-pr-merge`) and the answered-merge lock phase backs off (`already locked on origin`), measured on the sandbox (the ported CI answered-merge phases were only reachable after `dorfl release-lock`).

## Acceptance criteria

- [ ] With `mergeQuestions: ask`, the advance tick (laptop and the CI `enumerate` / dispatch path) surfaces a merge question for an unmerged work branch, per the answers to the open questions (tested).
- [ ] An answered `merge` on such a branch lands through the answered-merge action without a manual `release-lock` (tested end to end, including the CI three-process harness).
- [ ] `mergeQuestions: off` surfaces nothing; `auto` behaves as documented, or the documentation is corrected to what ships.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- `merge-question-surfacer-finds-namespaced-work-branches`

## Prompt

> Goal: make the merge-question feature real, or retire it honestly. Read `merge-question-surfacer.ts`, `apply-merge-action.ts`, the tree-less and answered-merge CI phases (`ci-phase-treeless.ts`), the propose lock rule, `config.ts` (`mergeQuestions`), and the observation named in the task body. Resolve the open questions first.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
