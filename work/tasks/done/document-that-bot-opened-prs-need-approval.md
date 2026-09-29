---
title: 'Document that PRs opened with GITHUB_TOKEN need an approval before verify runs, and how DORFL_GH_TOKEN avoids it'
slug: document-that-bot-opened-prs-need-approval
blockedBy: [install-ci-enables-actions-pr-creation]
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `bot-opened-prs-need-approval-before-verify-runs`: every PR the generated workflows opened with `GITHUB_TOKEN` (intake, build, tasking) got its `verify` run in `action_required` state; GitHub does not run workflows for events created by `GITHUB_TOKEN` until someone approves them. The advance path passes `DORFL_GH_TOKEN` when it is set (a PAT whose PRs trigger CI normally); `intake.yml` deliberately passes none (`ci-split-generate-workflows` Decisions: intake keeps the built-in identity), so intake PRs always need the approval.

Keep the generated workflows as they are. Document the behaviour in `docs/ci/README.md` (what `action_required` means, how to approve a run, that setting `DORFL_GH_TOKEN` avoids it for advance PRs, and that intake PRs keep the built-in identity and therefore always need it), and make `install-ci`'s closing summary mention it when `DORFL_GH_TOKEN` is not set.

## Acceptance criteria

- [ ] `docs/ci/README.md` explains the approval requirement, how to approve, and the `DORFL_GH_TOKEN` trade-off, including intake's deliberate choice.
- [ ] `install-ci`'s summary mentions it when no `DORFL_GH_TOKEN` was configured (tested through the fake context).
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- `install-ci-enables-actions-pr-creation`

## Prompt

> Goal: make an unavoidable GitHub behaviour visible to consumers. Read `docs/ci/README.md` (the token and secrets sections), `install-ci.ts`'s closing summary, and the `ci-split-generate-workflows` Decisions in `work/tasks/done/` about intake and `DORFL_GH_TOKEN`. No workflow changes.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **"No `DORFL_GH_TOKEN` configured" means this run did not report the secret as `set`.** That covers a skipped prompt, a failed set, and `--fake`, which touches no secrets. The provider context has no way to read existing secrets, so a secret set in an earlier run can't be seen. The message says "Unless that secret already exists on the repository" to cover that case. The alternative was adding a new "list secrets" method to the provider context for a single informational line; I judged that out of scope. This touches only `install-ci`'s output.
- **When the token was set, the summary still prints a short note that intake PRs always need the approval.** The acceptance criteria only require the note when the token is absent. I kept the intake line in both cases because it stays true either way and would otherwise surprise someone who set the token. The alternative was printing nothing when the token is set. This touches only `install-ci`'s output.
- **The changeset is a `patch`, not a `minor`.** The change is informational output plus docs, with no new flag or behaviour. It adds the exported helper `prApprovalReminderLines`, which is a small addition to the public interface.
