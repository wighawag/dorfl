---
'dorfl': minor
---

`dorfl install-ci` now checks the repository setting "Allow GitHub Actions to create and approve pull requests", which a new GitHub repository has off and without which every propose-mode pull request the generated workflows open with `GITHUB_TOKEN` is refused. When it is off and the `gh` credential is repo-admin, install-ci turns it on (`PUT repos/<r>/actions/permissions/workflow` with `can_approve_pull_request_reviews=true`, keeping `default_workflow_permissions` as it was) and reports it; when it is already on it is left alone; when the credential is not admin, or the call is rejected, install-ci prints the exact `gh api` command to run by hand. `--fake` only reports the check. The CI provider context gains the optional `getActionsWorkflowPermissions` / `setActionsWorkflowPermissions` seam methods, and `installCI`'s result carries the outcome as `actionsPrCreation`.
