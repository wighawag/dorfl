---
title: 'release.yml restores no Actions cache, so a CI agent cannot poison what the publish job runs'
slug: release-workflow-restores-no-cache
humanOnly: true
blockedBy: []
---

## What to build

dorfl's own `.github/workflows/release.yml` runs `actions/setup-node` with `cache: pnpm`, then `pnpm install` and `changeset publish`, in a job that holds `contents: write`, `pull-requests: write` and `id-token: write` (npm trusted publishing). The Actions cache is shared per branch scope, and entries written on the default branch are restored by every later job on it.

The CI agents dorfl runs (intake, advance) run in jobs triggered on the default branch. An agent with a shell can reach its job's `ACTIONS_RUNTIME_TOKEN` (through `/proc/<pid>/environ` of its parent processes, or `sudo` on a GitHub-hosted runner) and write a cache entry under the key the release job will look up. The release job then restores the poisoned pnpm store and runs it while holding an npm publishing identity. This works today, and it keeps working after spec `ci-agent-job-without-write-token` lands, because that spec removes the write TOKEN from the agent job but cannot remove the runtime token every job gets.

Remove cache restores from every workflow job in this repository that holds a write permission or `id-token: write` (today: `release.yml`, and `deploy-gh-pages.yml`, which also uses `cache: pnpm` while holding `pages: write` and `id-token: write`), and add a guard so it cannot come back. Also document the rule for consumers in `docs/ci/README.md`: a workflow that holds write access or publishes must not restore an Actions cache in a repository where dorfl runs agents on the default branch.

## Acceptance criteria

- [ ] `release.yml` restores no Actions cache (no `cache:` input on `setup-node`, no `actions/cache` step); install stays `pnpm install --frozen-lockfile`.
- [ ] Every other workflow in `.github/workflows` that holds a `write` permission or `id-token: write` is checked the same way, and fixed if needed.
- [ ] A test parses the repository's own `.github/workflows/*.yml` and fails when a job with a write permission or `id-token: write` (effective: job `permissions`, else workflow `permissions`) restores a cache (a `cache` input on `actions/setup-node`, or any `actions/cache` / `actions/cache/restore` step). The test is shown to fail on the current `release.yml` before the fix.
- [ ] `docs/ci/README.md` states the consumer rule and why (the runtime token is reachable by an agent with a shell).
- [ ] A changeset (patch) records the change; the release job gets slower by one uncached install, which the changeset notes.

## Blocked by

- None. Can start immediately, and should land before the tasks of spec `ci-agent-job-without-write-token`.

## Prompt

> Goal: make sure no job in this repository that holds a write permission or an npm publishing identity restores an Actions cache, because a CI agent can write cache entries on the default branch through its job's `ACTIONS_RUNTIME_TOKEN`. Start with `.github/workflows/release.yml` (it uses `actions/setup-node` with `cache: pnpm` and holds `id-token: write`), then check the other workflows. Add a test next to the existing workflow tests in `packages/dorfl/test` (see `install-ci-no-expression-in-run.test.ts` for how they parse YAML with the `yaml` package and walk jobs) that reads the checked-in `.github/workflows/*.yml` and fails on a cache restore in a write-holding job; run it red on the current file first and report that. Document the consumer rule in `docs/ci/README.md`. Add a patch changeset under `.changeset/`. Background: `work/specs/proposed/ci-agent-job-without-write-token.md` (decision 12). This task is `humanOnly` because it touches the release workflow.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does `release.yml` still restore a cache, and does a job there still hold `id-token: write`? If not, route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not). Do no git.
