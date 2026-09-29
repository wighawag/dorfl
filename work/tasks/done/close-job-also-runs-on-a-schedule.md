---
title: 'The generated close-job also runs on an hourly schedule, so lands the CI pushes itself still close their issue'
slug: close-job-also-runs-on-a-schedule
blockedBy: []
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@071cb5a1`). Observation `close-job-misses-lands-pushed-by-the-ci-apply-job`: the generated `close-job.yml` triggers only on `push` to `main`, and GitHub starts no workflow for a push made with a job's `GITHUB_TOKEN`. So a land the CI apply job pushes itself (merge mode, an answered `merge` question, any tree-less publish) never runs the close-job: issue #14 stayed open after its lone task landed through an answered merge. A spec issue whose LAST task lands that way stays open the same way.

`dorfl close-merged-issues` keeps no state: every run re-derives from `main` what is complete and closes it, so running it on a timer is safe. Decided by the human (2026-09-29): add a schedule trigger to the close-job; do not fold closing into another job.

1. In `close-job-template.ts`, add `schedule:` with the same hourly cron the generated `advance-lifecycle` uses (`'0 * * * *'`), plus `workflow_dispatch:`, next to the existing `push: branches: [main]` trigger (which stays: a human-merged PR still closes its issue immediately). Keep the job's permissions exactly as they are (`contents: read`, `issues: write`), keep `pull_request` forbidden, keep the concurrency group.
2. Replace the validator rule `no-cron-trigger` with a rule that REQUIRES the schedule (and one for `workflow_dispatch`), and update the header comment and the in-YAML comments that say the close-job is "NOT a cron drain": state why the schedule exists (CI-pushed lands trigger nothing). Update the tests and any docs (`docs/ci/README.md`) that describe the close-job trigger.
3. The close-job must not re-close or re-report an issue that is already closed. Today every run logs `>> closed issue #5 (...)` and counts it in `closed N issue(s)` for an issue closed hours earlier. With an hourly run this becomes hourly noise (and a risk of a repeated close comment). Skip an already-closed issue with its own decision (for example `already-closed`), without calling the close, and do not count it as closed. Find out how the provider seam can tell (the `IssueProvider` may need a read of the issue state, or `closeIssue` may already report it); keep the check behind the provider seam, no direct `gh` in `close-job.ts`.

Do NOT edit this repository's own `.github/` (its workflows are managed separately); change only the generator, its validator, tests and docs.

## Acceptance criteria

- [ ] The generated `close-job.yml` triggers on `push` to `main`, on an hourly `schedule` and on `workflow_dispatch`; permissions and concurrency are unchanged (tested through the generator and the validator).
- [ ] The validator requires the schedule; the old `no-cron-trigger` rule and the "not a cron drain" wording are gone (tested: a workflow without the schedule is flagged).
- [ ] An issue that is already closed is not closed again, gets no comment, is reported with its own decision and is not counted in `closed` (tested with the memory issue provider).
- [ ] No file under this repository's `.github/` changes.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: close an item's issue even when the land that completed it was pushed by the CI itself. Read `packages/dorfl/src/close-job-template.ts` (the generator and `validateCloseJobWorkflow`), `close-job.ts` (`runCloseJob`, the decisions), the `IssueProvider` seam in `issue-provider.ts`, the tests of both, and the `schedule:` block of `advance-lifecycle-template.ts` for the cron to reuse. The observation named in the task body has the evidence.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **How the close-job tells an issue is already closed: the existing `getIssue()` read, not a change to `closeIssue`.** Chosen because `getIssue()` already returns the lower-cased `state` through the provider, and `gh issue close` does not reliably report "already closed" (it can succeed or only warn). The alternative was to widen `CloseIssueResult` with an `alreadyClosed` flag and parse `gh` output, which is more fragile and would change a method intake's bounce also uses. This affects only `runCloseJob`; the `IssueProvider` interface is unchanged. The cost is one extra read per issue that qualifies to close.
- **If the state read fails, the close-job assumes the issue is open and tries the close as before.** A failed read (the GitHub version throws when `gh` fails) must never be what keeps an issue open: the close then either succeeds or reports `close-failed` with the real cause. The alternative, reporting a new "read-failed" decision and skipping the close, would bring back the stuck-open issue this task fixes. This affects only the close-job's decisions.
- **The state is read only when an issue actually qualifies to close.** An issue that is `not-landed`, `not-complete` or `cancelled` keeps that decision even if someone closed it by hand, so no provider calls are added for those. A test covers this.
- **Validator rule names are `trigger-cron` and `trigger-workflow-dispatch`,** the same ids `validateAdvanceLifecycleWorkflow` already uses for the same checks, so the two validators use one vocabulary.
