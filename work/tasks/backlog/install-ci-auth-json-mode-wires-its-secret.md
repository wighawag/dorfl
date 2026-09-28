---
title: 'install-ci auth-json mode never passes PI_AUTH_JSON to the agent job'
slug: install-ci-auth-json-mode-wires-its-secret
needsAnswers: true
blockedBy: []
---

<!-- open-questions -->

## Open questions

1. Where does the auth.json refresh (which needs the write-capable `GH_PAT`) run now that the agent job may hold no write credential: drop the refresh in CI (the stored auth.json must stay valid), move it to a separate no-agent job that updates the secret, or something else?
2. Should `PI_AUTH_JSON` be passed through the reusable workflows the same way as `ANTHROPIC_API_KEY` (an explicit `secrets:` entry on `dorfl-item.yml`, the dispatch wrapper and `intake.yml`)?

<!-- /open-questions -->

## What to build

Observation `install-ci-auth-json-never-wires-pi-auth-json`: in `auth-json` provider mode the generated `dorfl-setup` action reads `$PI_AUTH_JSON` (and its refresh script reads `$GH_PAT`) from the environment, but `providerSecretsWithBlock` returns nothing for auth-json and no generated workflow sets either variable, so the "Configure agent auth (auth.json)" step would exit with "PI_AUTH_JSON secret is not set". Pre-existing, unchanged by the CI split.

Wiring `PI_AUTH_JSON` into the agent job is straightforward (it is the provider credential, like `ANTHROPIC_API_KEY`). `GH_PAT` is not: it is a write-capable token, and ADR `ci-agent-job-holds-no-write-token` forbids any write credential in the agent job, so the refresh cannot run there as designed.

## Acceptance criteria

- [ ] In auth-json mode the agent job receives `PI_AUTH_JSON` (and only the provider credentials); the workflow guard's agent-secret rule accepts it and still rejects anything else.
- [ ] The refresh follows the answer to the open question, and no write-capable token reaches the agent job (template test).
- [ ] This repository's `.github/` is regenerated only if its own mode is affected.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make install-ci's `auth-json` provider mode work under the split without putting a write token in the agent job. Read `generateSetupAction` and `providerSecretsWithBlock` in `packages/dorfl/src/install-ci-core.ts`, the auth-json refresh script, the workflow guard's agent-secret rule (`test/helpers/workflow-guard.ts`), and the observation named in the task body. Resolve the open question before building.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
