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

> FORWARD-POINTER (conductor, decided with the human 2026-09-27): do NOT warn for `dorfl verify`. `ci-split-phase-mode-and-guards` put `verify` in `AGENT_SPAWNING_VERBS` because it runs repository code, but it launches no agent, and the generated `verify.yml` persists only a `contents: read` credential (on repos not known to be public). Warning there would flag every private consumer's PR check, and the planned next-minor refusal would break it. Keep `verify` in `AGENT_SPAWNING_VERBS` (the workflow guard still reads it); exclude it from THIS warning explicitly, with a test that `verify` in the unsafe shape prints nothing, and say in a code comment that `ci-split-generate-workflows` must apply the same exemption.

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

## Decisions

- **Only the checkout's own git config is read, and included files are followed** (`git config --local --includes --null --list`). Why: the task says "`.git/config` holds a credential". Following includes matters because `actions/checkout` v6+ writes the auth header to a separate file pulled in by `includeIf`, so reading `.git/config` alone would miss every current pinned checkout (v7.0.1). Global, system and environment config are not read. That keeps the agent phase's own read token, which dorfl passes through `GIT_CONFIG_*`, from triggering the warning. Alternatives considered: reading the `.git/config` file directly (misses v6+), or using `git config --list` over every source (flags global setups the task did not ask about). This touches only the warning. The future refusal and `ci-split-generate-workflows` should use the same detection.
- **The checkout checked is the process's current directory.** CI steps run dorfl inside the checkout, so this matches the single-job shape. The alternative was working out a repo path per verb; not doing it means a run pointed at a different directory is judged by the directory it was started in.
- **Any failure to read git config (not a repository, git missing) counts as "no credential".** Why: the task says behaviour is otherwise unchanged, so the warning must never break a run. The planned refusal will need to decide this again, and should probably treat a failed read as unsafe.
- **The warning text starts each line with `!!`.** This is a new user-visible output format, chosen so the warning stands out in the Actions log next to dorfl's existing `>>` notes.
