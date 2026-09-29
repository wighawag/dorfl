---
title: 'install-ci checks, and offers to set, the repository setting that lets GitHub Actions create pull requests'
slug: install-ci-enables-actions-pr-creation
blockedBy: []
---

## What to build

Found in the CI sandbox `wighawag/dorfl-ci-sandbox` (a private repository running the workflows `install-ci` generated from dorfl `main@e972795d`). Observation `install-ci-does-not-enable-actions-pr-creation`: a new repository has "Allow GitHub Actions to create and approve pull requests" off (`gh api repos/<r>/actions/permissions/workflow` shows `can_approve_pull_request_reviews: false`), and with it off every propose-mode PR the generated workflows open with `GITHUB_TOKEN` is refused. dorfl's own repository has it on, which hid this.

In `install-ci`'s GitHub setup (the same place it sets secrets and branch protection, `install-ci-github.ts` behind the CI-context seam), read the setting and, when it is off, set it (`PUT repos/<r>/actions/permissions/workflow` with `can_approve_pull_request_reviews=true`, keeping `default_workflow_permissions` as it is), reporting what it did; when the credential cannot (no admin), print the exact command, as the branch-protection path already does. `--fake` reports it without calling GitHub. Document the requirement in `docs/ci/README.md`.

## Acceptance criteria

- [ ] `install-ci` enables the setting when it is off and reports it; leaves it alone when on; prints the manual command when it cannot set it (tests through the fake CI context, no real GitHub).
- [ ] `default_workflow_permissions` is preserved.
- [ ] `docs/ci/README.md` states the requirement and why.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make a fresh consumer repository's propose mode work out of the box. Read `install-ci.ts` (where secrets, `delete_branch_on_merge` and branch protection are applied), the CI-context interface in `install-ci-core.ts`, and its GitHub and fake implementations in `install-ci-github.ts`. Mirror how branch protection reports success, failure and the manual retry.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Set it without prompting when the credential is admin; do not ask like `delete_branch_on_merge` does.** Why: the task body says "when it is off, set it", propose mode cannot work without the setting, and the branch-protection step already auto-configures when admin with no prompt. Alternative: a yes/no prompt like `delete_branch_on_merge`, which the title's "offers to set" could suggest. It touches only the `install-ci` run, which now changes one repo setting without asking when it is off and the credential is admin.
- **Check admin scope with the existing `getRepoAdminScope` before any write, and treat "unknown" as not admin.** Why: this mirrors branch protection, so it never tries a call likely to be refused. Alternative: try the PUT anyway and fall back on failure. It reuses the existing branch-protection seam method and adds no new concept.
- **When the setting cannot be read, leave `default_workflow_permissions` out of the write and out of the printed command.** Why: GitHub treats both fields of this PUT as optional, so leaving one out keeps its current value; sending a guessed `read` could narrow a repo that is set to `write`. Alternative: always send `read`, as the observation's example command does. This rests on GitHub's API docs saying both PUT fields are optional; I did not verify it against the live API.
- **Named the seam methods `getActionsWorkflowPermissions` / `setActionsWorkflowPermissions` after the GitHub endpoint, with the type `ActionsWorkflowPermissions` defined in `install-ci-core.ts`.** Why: other steps' types live in their step modules, but this one sits in the core because the seam's own signatures need it. It does not overlap any existing term in the glossary or code.
