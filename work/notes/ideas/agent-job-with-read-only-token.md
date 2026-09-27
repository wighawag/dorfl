---
title: 'run the CI agent in a job whose token cannot write, and apply its output in a separate agent-free job'
slug: agent-job-with-read-only-token
type: idea
status: incubating
created: 2026-09-26
---

# The agent job should hold no write token at all

## Problem

The generated `intake` workflow runs on any GitHub user's issue or comment and runs an agent with a shell over that text; the `advance` legs run agents over work items (some born from untrusted issues). Those jobs hold `contents`/`pull-requests`/`issues: write`. Today the only protection is that dorfl removes GitHub tokens from the agent's environment in GitHub Actions (`src/agent-env.ts`). The agent can still reach the job token through:

- the credential `actions/checkout` persists in `.git/config` (the agent jobs do not set `persist-credentials: false`, because dorfl's own pushes rely on it);
- its parent processes' environment (`/proc/<pid>/environ` of dorfl and the step shell, where `GH_TOKEN` lives);
- `sudo` on GitHub-hosted runners (read the runner's memory);
- anything it leaves behind for dorfl's write phase in the same job: planted hooks or git config, `git replace` objects, a redirected `.git`, binaries planted on PATH, background processes.

## What was tried and dropped

An in-job version was built and reviewed three times (Sept 2026): scrub the env, stop persisting the checkout credential and hand dorfl a token through a per-command `http.extraheader`, snapshot and restore git state around every agent launch, run CI git with hooks/fsmonitor/replace objects off, kill the agent's process group, run `git lfs push` by hand, stage only intended paths. Each review found another way through (hook firing during the restore, a shared clone rewound, `git replace`, the Gate-2 worktree counted as shared, a `.git` gitfile redirect, PATH plants reaching `git-lfs`/`gh`). The root cause is structural: the agent and the token share a user, a machine and a job. Only the environment scrub was kept. The rest is not worth carrying once the split exists.

## Feasibility (checked against the code, Sept 2026)

The split does NOT break dorfl. Every CI path has the same shape, with no network write between two agent launches and no write result fed back to an agent:

| path | writes before the agents | agents (local work + fetches only) | writes after the agents |
| --- | --- | --- | --- |
| intake | `processing` label (`intake.ts` addLabel) | decision agent, lone-task review loop | work branch, integrate (PR or merge), comment, close, label removal |
| advance build / `do` | advancing lock, claim, rebased kept branch push | build agent, gate, Gate-2 review (fresh worktree after a local rebase) | commit push, PR/merge, deadline WIP save, needs-attention routing, lock release |
| `do spec:` tasking | tasking lock | tasker agent and review rounds | integrate, candidate save, lock release |
| surface / triage / apply | tree-less lock | the rung's agent (apply may add a merge action with a review agent) | tree-less publish to main, lock release |

The merge-mode CAS retry loop (`integration-core.ts`, `for (let mergeAttempt ...)`) only re-rebases and re-pushes, no agent and no gate, so it belongs in the write job unchanged.

## Shape

Per item, three jobs (a matrix calling a small reusable workflow, since GitHub cannot chain one matrix leg to the matching leg of the next job):

1. **lock** (write, no agent): take the locks (claim, advancing, `processing` label).
2. **agent** (`permissions: contents: read, issues: read, pull-requests: read`, `persist-credentials: false`): run the agents, gates and local commits; upload a `git bundle` of the work branch, new `.git/lfs/objects`, and a record of intended writes (PR title/body, comments, routing).
3. **apply** (write, `needs: agent`, `if: always()`, no agent, no repo code): validate the artifact as HOSTILE (the agent controls its job and can rewrite it): target refs chosen from the item slug, not the artifact; bundle commits descend from the expected base; no path under `.github/`; size bounds. Then push, open the PR, comment, run `git lfs push`, release or mark-stuck the locks. On agent-job failure/cancel, release or surface.

In dorfl this means a CI-only phase mode (e.g. `--phase lock|agent|apply`) where the write seams (`ledgerWrite`, review/issue providers, integrator) RECORD in the agent phase and REPLAY in the apply phase. Roughly 40 `git push` sites and a dozen `gh` writes; most go through those seams, but `continue-branch.ts`, `needs-attention.ts`, `item-lock.ts` and `tasking.ts` push directly and need routing through them. Laptop, `run` and `advance -n` outside CI are untouched.

## Costs and open questions

- Two extra jobs per item (checkout + dorfl setup each, about 1 to 2 minutes).
- `actions/upload-artifact` / `download-artifact` join the SHA-pin table.
- The agent job still holds a read token; on a private repo the agent can leak read access to the source. Scrub it from the agent env (already done) and decide whether `prepare`/`verify` in the agent job should also run without it.
- The gate result is an attestation from the untrusted job. No worse than today (the agent can already make its own gate pass); the untrusted-origin safety remains the forced PR.
- A test must fail if any generated workflow spawns an agent in a job whose checkout persists credentials or whose token can write.
