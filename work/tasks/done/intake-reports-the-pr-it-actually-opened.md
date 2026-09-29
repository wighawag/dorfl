---
title: 'Intake (and every propose land) reports whether a PR was actually opened, and prints the gh error when it was not'
slug: intake-reports-the-pr-it-actually-opened
blockedBy: []
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `intake-reports-an-opened-pr-when-pr-creation-failed`: on issues #1 and #4, intake logged `... opened a PR carrying it (main untouched)` while no PR existed (the repository refused PR creation by Actions). `GitHubProvider.openRequest` returned `opened: false` with an `instruction` carrying the real `gh` error and a manual `gh pr create` command, but the intake completion message is built from `core.outcome === 'completed'` alone and the instruction is never printed, so the issue's completion comment also lacks the PR link and nobody learns the PR is missing.

Make every propose land tell the truth: when the request was not opened, the log says so and prints the provider's instruction, and intake's completion comment says the work is pushed on branch `<branch>` but no PR could be opened (with the reason), instead of implying a PR. Check the build path (`ci-phase-build.ts` apply, `complete`) and tasking for the same gap and fix them the same way.

## Acceptance criteria

- [ ] An intake whose PR creation fails logs that no PR was opened, prints the provider instruction, and posts a completion comment that names the pushed branch and says no PR exists (tested with a stub provider returning `opened: false`).
- [ ] A successful PR creation is unchanged (the comment still links the PR).
- [ ] The build and tasking propose lands report a failed PR creation the same way (tested).
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: stop dorfl claiming it opened a PR when it did not. Start from the completion-message code in `packages/dorfl/src/intake.ts` (search `opened a PR carrying it`), `IntegrationCoreResult.integration.requestOpened`, and `GitHubProvider.openRequest` / `degrade` in `github.ts`. The observation named in the task body has the evidence.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **The reason goes into the public issue comment in full.** What I chose: the comment quotes the provider's whole instruction verbatim. That text can include the suggested PR title and body and the manual `gh pr create` command. Why: the task asks for the comment to give the reason, and the instruction is the only honest source of it. Alternative considered: keep only the first line, but the `gh pr create` command can itself span lines (a quoted body), so cutting at a newline is unreliable. What it touches: only intake's completion comment.
- **Push-only is reported as "no PR" too.** What I chose: the `none` provider (a non-GitHub arbiter) and the `noPR` setting also produce the "no PR was opened" wording and log line. Why: no PR exists in those cases, so claiming one would be the same false report. Alternative considered: limit the wording to GitHub failures, which would keep the old false "opened a PR carrying it" message on push-only lands. What it touches: the log and messages of every propose land on a non-GitHub arbiter or with `noPR` set, which now carry the extra note line (for `noPR` the line reads "…No PR was opened (noPR is set…)").
- **The log line lives in the shared land code, not in each caller.** What I chose: print it once in `integration-core.ts`, and have callers only rephrase their summary. Why: no land path can forget it. Alternative considered: per-caller printing in intake, tasking and build, which is what the task literally lists. What it touches: `complete`, `run` and the recovery path also gain the line.
