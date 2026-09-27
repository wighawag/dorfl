---
title: 'CI agents run in a job whose token cannot write; separate agent-free jobs take the locks and apply the writes'
slug: ci-agent-job-without-write-token
humanOnly: true
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked. They move into tasks/ADRs, and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

> **Tasked 2026-09-27.** The launch decisions and the durable why moved to ADR `docs/adr/ci-agent-job-holds-no-write-token.md`; the implementation and testing detail moved, verbatim where it matters, into the `ci-split-*` tasks (`work/tasks/`). Evidence for decision 1: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md` and `docs/spikes/ci-handoff-key-delivery/`. Two prerequisite tasks filed while writing this spec: `intake-frontmatter-title-injection-strips-origin-stamp` and `release-workflow-restores-no-cache`.

## Problem Statement

dorfl's generated CI workflows run a `pi` agent with shell tools in jobs that hold repository write permissions. `intake.yml` runs whenever any GitHub user opens an issue or comments on one, so a prompt injection in issue text can steer an agent that shares a job with a `contents: write` / `pull-requests: write` / `issues: write` token. The `advance` jobs run agents over work items, some of which were born from untrusted issues.

The previous release removes GitHub tokens from every autonomous agent's environment in GitHub Actions (`agent-env.ts`, applied at the single chokepoint `agentLaunchEnv` in `harness.ts`). That is only a first layer. An agent that shares a job with a write token can still reach it through:

- the credential `actions/checkout` persists in `.git/config` (the agent jobs do not set `persist-credentials: false`, because dorfl's own pushes rely on it);
- its parent processes' environment (`/proc/<pid>/environ` of dorfl and of the step shell, where `GH_TOKEN` lives);
- `sudo` on GitHub-hosted runners (read any process's memory);
- anything it leaves behind for dorfl's own write steps in the same job: hooks, git config, `git replace` objects, a redirected `.git`, binaries planted on `PATH`, background processes.

An in-job hardening (env scrub, no persisted credential with a per-command `http.extraheader`, git state snapshot and restore around each launch, hooks, fsmonitor and replace objects off, process-group kill, a manual `git lfs push`, staging only intended paths) was built, reviewed three times and dropped: each review found another way through. The root cause is structural. The agent and the token share a user, a machine and a job. Only the environment scrub was kept.

## Solution

Make it structurally impossible for a CI agent to use a repository write credential by never giving its job one. Every CI item runs as three jobs:

1. **lock** (write token, no agent, no repository code): classify the item and take its locks (per-item lock ref, `processing` label), then publish trusted facts (base sha, lock ref sha, rung, artifact name) as job outputs.
2. **agent** (read-only token, `persist-credentials: false`): run the agents, the gate (`prepare` / `verify`), the Gate-2 review and every local commit exactly as today, stopping at the first write. Upload a handoff: a `git bundle` of the work branch when the path carries code, any new LFS objects, and a typed record of what the agents produced and what dorfl intends to write.
3. **apply** (write token, `needs: agent`, `if: always()`, no agent, no repository code): treat the handoff as hostile, validate it against the trusted lock outputs, then perform every write through dorfl's existing seams: push, PR, comments, label, merge with the unchanged compare-and-swap retry loop, lock release. When the agent job failed, timed out or was cancelled, release or surface the item instead.

Agents keep every tool they have, including shell. Nothing changes on a laptop, for `run`, or for `advance -n` outside CI: without `--phase`, dorfl keeps today's single-process behaviour.

## User Stories

1. As a maintainer of a public repository, I want an injected instruction in an issue to be unable to push, merge, label, comment or open a PR with my repository's credentials, so that `intake` can stay open to any GitHub user.
2. As a maintainer, I want the agent to keep its shell and every tool it has, so that build quality does not drop to buy the isolation.
3. As a maintainer, I want the job that runs the agent to hold a token with no write scope and a checkout with no persisted credential, so that there is nothing in the agent's job that can write.
4. As a maintainer, I want every write (lock ref, branch push, PR, comment, label, merge to `main`) performed by a job that runs no agent and no code from the repository or from the agent's output, so that nothing the agent planted can execute with the write token.
5. As a maintainer, I want the write job to choose every target ref, folder and policy (integration mode, placement, origin trust) from the item slug, the lock job's outputs, the base commit and the committed config, never from the agent's artifact, so that a forged artifact cannot redirect a write.
6. As a maintainer, I want the write job to reject an artifact whose commits do not descend from the base the lock job recorded, so that an agent cannot splice in unrelated history.
7. As a maintainer, I want the write job to reject any change under `.github/` in any new commit (even one a later commit reverts), so that an agent cannot change the workflows or the composite setup action that later write jobs run.
8. As a maintainer, I want size limits on the artifact, the bundle, the commit count, each blob, the LFS objects and every free-text field, so that a hostile artifact cannot exhaust the write job.
9. As a maintainer, I want an item's lock released (or the item surfaced to needs-attention) when its agent job fails, times out or is cancelled, so that a crashed agent never strands a lock or a `processing` label.
10. As a maintainer in merge mode, I want the compare-and-swap retry loop that lands on `main` to run in the write job unchanged, so that parallel item runs still serialise on `main` without a `--force` and without re-running any agent.
11. As a maintainer, I want the intake flow (the `processing` label, the ask/bounce comments, the task/spec document integration) split the same way, so that the most exposed workflow gets the strongest boundary.
12. As a maintainer, I want every advance rung (build, tasking, surface, triage, apply, including the answered merge action and the answered stuck action) split the same way, so that no rung is left where an agent shares a job with a write token.
13. As a maintainer, I want the writes of tasking, intake and the tree-less rungs re-derived in the write job from the agents' structured output, so that those paths keep today's guarantee that only dorfl-chosen paths are written.
14. As a maintainer, I want a test that fails if any generated workflow runs an agent-spawning `dorfl` verb in a job whose checkout persists credentials or whose token can write, so that the boundary cannot regress silently.
15. As a maintainer, I want dorfl itself to refuse to launch an agent or run `prepare` / `verify` while in the lock or apply phase, so that a dorfl bug cannot bring an agent or repository code into a write job.
16. As a maintainer, I want the write jobs to receive no provider API key, so that even a dorfl bug that tried to launch an agent there would fail.
17. As a maintainer, I want `DORFL_GH_TOKEN` (a PAT or App token) passed only to the lock and apply jobs, so that a write-capable personal token never enters the agent job.
18. As a maintainer of a private repository, I want the agent job to keep a read-only token for dorfl's own fetches, passed per command and scrubbed from the agent's environment, so that CI keeps working on private repositories.
19. As a laptop user, I want `do`, `advance`, `advance -n`, `intake` and `run` to behave exactly as today, so that the split costs nothing outside CI.
20. As a consumer, I want to upgrade by re-running `dorfl install-ci`, with the new actions pinned to full commit SHAs like every other action dorfl emits, so that the upgrade is one command and keeps my existing pins.
21. As a consumer who has not re-run `install-ci` yet, I want the old single-job workflows to keep working with the new dorfl and to tell me they are the unsafe shape, so that upgrading dorfl never breaks CI.
22. As a maintainer, I want a changeset that says what changed, why, what it costs (two extra jobs per item) and what I have to do, so that the release notes are enough to act on.
23. As a reviewer of a PR the apply job opened, I want the PR body to say when the agent's artifact changed ledger files outside its own item, so that I notice an agent editing other items.
24. As a maintainer, I want an end-to-end test of lock, agent and apply for a build and for an intake, run as three processes in three clones where the agent phase cannot push, so that the split is proven to work and proven to write nothing from the agent phase.

### Autonomy notes

- **`humanOnly: true`:** this is a security boundary. A human must drive the tasking; the emitted tasks can be agent-buildable.
- **`needsAnswers`:** omitted. The launch questions are answered (see the ADR); decision 1 was settled by a spike (one workflow run per item).

## Out of Scope

- Stopping the agent from exfiltrating the provider API key or the read token. Neither can write; a separate provider-side key scope or proxy would be its own spec.
- Cache poisoning through `ACTIONS_RUNTIME_TOKEN`: the separate task `release-workflow-restores-no-cache` (decision 12).
- Re-verifying on the rebased tip after a lost CAS in the apply job (decision 2); a follow-up idea.
- The laptop, `run` daemon and `--isolated` / `--remote` paths: they hold the human's own credentials by design.
- Any change to `install-ci`'s one-time secret and branch-protection wizard beyond emitting the new files.
- Reviving the dropped in-job hardening (git state snapshot, hook suppression, process-group kill): once the agent job holds no write token it buys nothing.
