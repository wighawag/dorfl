---
title: 'Warn when an old single-job workflow runs an agent verb next to a persisted credential'
slug: ci-split-warn-single-job-workflows
spec: ci-agent-job-without-write-token
blockedBy: [ci-split-phase-mode-and-guards]
covers: [21]
---

## What to build

Decision 9: in GitHub Actions, when an agent-spawning verb (the `AGENT_SPAWNING_VERBS` set) runs WITHOUT `--phase` in a checkout whose `.git/config` holds a credential (an `http.*.extraheader` or a URL with userinfo), print a prominent warning that this is the unsafe single-job shape and that re-running `dorfl install-ci` upgrades it. Behaviour is otherwise unchanged. The next minor version turns the warning into a refusal; record that intent in the warning text and the changeset, not in code.

### Design reference (carried verbatim from the spec)

9. **Old workflows with a new dorfl.** Decided: warn now (in GitHub Actions, when an agent-spawning verb runs without `--phase` in a checkout whose `.git/config` holds a credential), refuse in the next minor version.

## Acceptance criteria

- [ ] Tests: warning printed in the unsafe case; not printed with `--phase`, outside GitHub Actions, or when no credential is persisted.
- [ ] The acceptance gate is green.

## Blocked by

- `ci-split-phase-mode-and-guards`

## Prompt

> Add the old-workflow warning to dorfl (decision 9), reusing `AGENT_SPAWNING_VERBS` and `inGitHubActions` (`agent-env.ts`). Never print the credential.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.
