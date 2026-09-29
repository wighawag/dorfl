---
title: 'Wire the merge-question surfacer into the advance tick and resolve its clash with the propose lock'
slug: wire-merge-questions-into-the-advance-tick
blockedBy: [merge-question-surfacer-finds-namespaced-work-branches]
needsAnswers: true
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `merge-question-surfacer-has-no-production-caller`: `surfaceMergeQuestions` has no production caller; `advance --merge-questions` is declared and never read; the `mergeQuestions` config key (default `ask`, documented as "a silently-dropped merge-question means finished, pushed work never lands") has no effect. And even with a surfaced and answered question, the answered-merge action cannot run on a propose-built branch: the propose build keeps the per-item lock "until the PR merges" (`propose-keep-lock-until-pr-merge`) and the answered-merge lock phase backs off (`already locked on origin`), measured on the sandbox (the ported CI answered-merge phases were only reachable after `dorfl release-lock`).

## Decided (answered by the human, 2026-09-29)

1. **Skip branches that already have an open PR.** On a host with PRs (GitHub), an open PR is already the human's land decision (merge or close it), so the surfacer writes no merge question for a work branch with an open PR. Merge questions are for branches with no PR: the git-alone floor, or a branch whose PR was closed unmerged.
2. **The lock clash is therefore moot on GitHub.** A branch the surfacer asks about has no open PR, so no propose build is holding its lock "until the PR merges". For the remaining no-PR case, if a stale lock of the same item's own propose build is still held, the answered-merge lock phase may take it over (same item, entry action `implement`); cover that case with a test.
3. **Remove `mergeQuestions: auto`** and the dead `advance --merge-questions` flag. The gate keeps `off` and `ask` (default `ask`); unattended landing is what merge mode is for. Update `config.ts`, the docs and any tests that mention `auto` or the flag.

### Decided in a second round (answered by the human, 2026-09-29, after the first build agent STOPPED on three open design questions)

4. **Takeover criterion (refines decision 2): mark a propose-kept lock.** When a propose land keeps the per-item lock "until the PR merges" (`propose-keep-lock-until-pr-merge`), it stamps the lock entry with a new marker saying it is kept for a propose PR (not a live build). The answered-merge lock phase may take over ONLY a lock carrying that marker, for the same item. The surfacer skips a branch whose lock is held WITHOUT that marker (a live build, including a rebuild of a bounced task's kept branch, whose tip can already carry the done-move, so "the tip has the done-move" is NOT a valid finished-build signal). Test both: takeover of a marked lock succeeds, an unmarked held lock is neither surfaced nor taken over.
5. **CI writer shape: a new no-agent writer job.** Surfacing is deterministic, so the generated `advance-lifecycle` workflow gains a no-agent job (like `reap-merged-branches`) that runs a new CLI entry point to surface merge questions (the `--merge-questions` flag is removed per decision 3, so this is a new command or subcommand), honouring `mergeQuestions: off|ask`. `enumerate` stays read-only. This changes the workflow TEMPLATES `install-ci` generates (and their seed `docs/ci/advance-loop.yml.template`); do NOT edit this repository's own `.github/` (its advance-lifecycle workflow is disabled on purpose). The entry point fetches the arbiter before listing branches.
6. **Selection, folders and squash merges.**
   - Selection (laptop `advance` and CI `enumerate`/`scan --here`) may pick an item whose lock is held when it has an answered `kind=merge` entry AND the lock carries the decision-4 marker; otherwise a held lock still excludes it.
   - The surfacer asks only about task bodies in `tasks/ready/` and `tasks/backlog/`. A body already in `done/` or `cancelled/` is terminal and is skipped; this also covers a squash-merged PR whose branch was not deleted (its body is in `done/` on `main`).
   - The apply step reads merge answers on bodies in both `tasks/ready/` and `tasks/backlog/`.

## Acceptance criteria

- [ ] With `mergeQuestions: ask`, the advance tick (laptop and the CI `enumerate` / dispatch path) surfaces a merge question for an unmerged work branch, per the decisions above (skipping branches with an open PR) (tested).
- [ ] An answered `merge` on such a branch lands through the answered-merge action without a manual `release-lock` (tested end to end, including the CI three-process harness).
- [ ] `mergeQuestions: off` surfaces nothing; `auto` and the `--merge-questions` flag are removed (config, CLI, docs, tests).
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- `merge-question-surfacer-finds-namespaced-work-branches`

## Prompt

> Goal: make the merge-question feature real, or retire it honestly. Read `merge-question-surfacer.ts`, `apply-merge-action.ts`, the tree-less and answered-merge CI phases (`ci-phase-treeless.ts`), the propose lock rule, `config.ts` (`mergeQuestions`), and the observation named in the task body. Follow the decisions recorded in the task body.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
