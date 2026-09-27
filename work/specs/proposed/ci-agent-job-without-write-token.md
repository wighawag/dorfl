---
title: 'CI agents run in a job whose token cannot write; separate agent-free jobs take the locks and apply the writes'
slug: ci-agent-job-without-write-token
humanOnly: true
---

> Launch snapshot: records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked. They move into tasks/ADRs, and this spec settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Launch decisions (resolved by the maintainer, 2026-09-27)

The launch questions were answered as follows. Every later reference to "decision N" points here.

1. **Binding an artifact to its own matrix leg.** All legs of one workflow run share one artifact namespace, and an agent can reach its job's `ACTIONS_RUNTIME_TOKEN` (through `/proc` or `sudo`), so leg A's agent could upload (or delete and re-upload) an artifact under leg B's name, and B's apply job would land A's code under B's identity. Decided: the lock job mints a random per-leg key and hands it to that leg's agent and apply jobs through `needs.lock.outputs`; the apply job rejects any handoff whose MAC does not verify. The key is not a registered secret (a masked value is dropped from job outputs), so it is only as private as every place GitHub might show it. The first task is therefore a spike that must confirm ALL of: a job output cannot be read by a job that does not `needs` it (no REST endpoint, not on the run page); the key does not appear in the logs of the jobs that RECEIVE it, which rules out passing it through a step `env:` block (GitHub prints a step's `env:` values in the step log header, and the logs of a public repository are readable by any signed-in user), so the spike must find and prove a delivery that is not echoed, including with `ACTIONS_STEP_DEBUG` and runner diagnostic logging on; and an unmasked output is not dropped. If any of these fails, the plan becomes one workflow run per item: `enumerate` dispatches each item with `gh workflow run` (costing `actions: write` in `enumerate`, and replacing the matrix `max-parallel` knob with a `concurrency` group). Separate runs have separate artifact namespaces and separate runtime-token scopes, so that variant needs no key at all, and §7's binding check becomes "the artifact belongs to this run", which GitHub already guarantees.
2. **A lost CAS in the apply job.** The merge-mode retry loop in `performIntegration` re-runs only `rebaseOntoMainWithReconcile` and the push, never the gate (verified). Decided: keep the code's behaviour, and correct the drift in the same change: `WORK-CONTRACT.md` ("Land = rebase + re-verify + advance", in `skills/setup/protocol/` and mirrored to `work/protocol/`), the ADR `land-primitive-rebase-reverify-advance`, and the `advance-lifecycle` template comment ("re-rebase + re-gate + retry"). Re-running the agent phase on a lost race is recorded as a follow-up idea. Stated plainly, because the split changes the numbers: today the fresh gate runs seconds before the first push, so a lost race is rare; after the split the agent job's rebase and gate happen minutes before the apply job's first push (artifact upload, queueing, setup), so with parallel legs in merge mode `main` will usually have moved, the first push will usually be non-fast-forward, and the landed tree will usually be a re-rebase the gate never saw. The "gated on the rebased tip" property goes from nearly always true to often false in merge mode. Propose mode is unaffected (a human merges the PR, and the repository's own required checks run on it). To keep this visible, the apply phase compares the landed tip's tree with the gated tip's tree and reports "landed without re-gate after N lost races" in the run output and in the landed commit's trailer; §8 and the changeset say the same.
3. **Protected paths.** Decided: a fixed built-in list, not a config key: `.github/`, `CODEOWNERS` (repository root, `docs/`, `.github/`), `dorfl.json`, `.lfsconfig` (added because of decision 6, see §7) and `.gitattributes` (added after review: in merge mode a landed `merge=union` or `merge=binary` attribute changes how the apply job's own rebase resolves conflicts, and the CAS loop relies on a real conflict to stop). Plus a `work/` ledger rule for build bundles: the diff under `work/` may contain only this item's own transition, new `work/notes/*` files, and new ADRs; anything else (another item's body, a new file in a pool folder, a sidecar) is rejected in merge mode and listed in the PR body in propose mode.
4. **A legitimate task that edits a protected path** (dorfl's own repository has workflow-editing tasks). Decided: the apply job routes it to needs-attention with a reason that names the protected path and says to build it locally; CI never lands it.
5. **Agent job failed, timed out or was cancelled.** Decided: `failure` and timeout surface the item to needs-attention (sidecar + `needsAnswers: true`, lock released); `cancelled` only releases the lock; for intake every non-success removes the `processing` label and posts nothing.
6. **Git LFS.** Decided: full LFS support in this spec (not fail-closed). See §6 and §7 for the handoff and the validation; the LFS path gets its own hostile-artifact tests.
7. **The continue-branch rebase push.** Decided: the agent job rebases the kept `work/task-<slug>` locally; the apply job pushes it with `--force-with-lease` against the tip the lock job observed (`continueTip`). The lock job does no rebase. This applies to the build path (`start.ts` in-place continue) and to the answered merge action (`workspace.ts` `createJob`).
8. **Install source for the write jobs in workspace mode** (dorfl's own repository). Decided: all three jobs build dorfl from the same base sha; the generated workflow comment states that in merge mode this runs code an earlier agent landed on `main` in the write jobs, which is the trust merge mode already implies.
9. **Old workflows with a new dorfl.** Decided: warn now (in GitHub Actions, when an agent-spawning verb runs without `--phase` in a checkout whose `.git/config` holds a credential), refuse in the next minor version.
10. **Intake shape.** Decided: `intake.yml` calls the same reusable per-item workflow with `item: issue:<N>`.
11. **Skipping the agent job when the rung needs none.** Decided: in the first cut. The lock job outputs `needsAgent: false` for an answered task/spec `apply` with no `kind: merge` entry, a `kind: stuck` answer, the observation surface short-circuit and an intake triage skip.
12. **Cache poisoning** (the agent can write default-branch cache entries through the runtime token; dorfl's own `release.yml` restores a pnpm cache in a job that can publish to npm). Decided: a separate task, filed before this spec's tasks land: `work/tasks/backlog/release-workflow-restores-no-cache.md`.

## Problem Statement

dorfl's generated CI workflows run a `pi` agent with shell tools in jobs that hold repository write permissions. `intake.yml` runs whenever any GitHub user opens an issue or comments on one, so a prompt injection in issue text can steer an agent that shares a job with a `contents: write` / `pull-requests: write` / `issues: write` token. The `advance` legs run agents over work items, some of which were born from untrusted issues.

The previous release removes GitHub tokens from every autonomous agent's environment in GitHub Actions (`agent-env.ts`, applied at the single chokepoint `agentLaunchEnv` in `harness.ts`). That is only a first layer. An agent that shares a job with a write token can still reach it through:

- the credential `actions/checkout` persists in `.git/config` (the agent jobs do not set `persist-credentials: false`, because dorfl's own pushes rely on it);
- its parent processes' environment (`/proc/<pid>/environ` of dorfl and of the step shell, where `GH_TOKEN` lives);
- `sudo` on GitHub-hosted runners (read any process's memory);
- anything it leaves behind for dorfl's own write steps in the same job: hooks, git config, `git replace` objects, a redirected `.git`, binaries planted on `PATH`, background processes.

An in-job hardening (env scrub, no persisted credential with a per-command `http.extraheader`, git state snapshot and restore around each launch, hooks, fsmonitor and replace objects off, process-group kill, a manual `git lfs push`, staging only intended paths) was built, reviewed three times and dropped: each review found another way through. The root cause is structural. The agent and the token share a user, a machine and a job. Only the environment scrub was kept.

## Solution

Make it structurally impossible for a CI agent to use a repository write credential by never giving its job one. Every CI item runs as three jobs:

1. **lock** (write token, no agent, no repository code): classify the item and take its locks (per-item lock ref, `processing` label), then publish trusted facts (base sha, lock ref sha, rung, handoff key) as job outputs.
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
10. As a maintainer in merge mode, I want the compare-and-swap retry loop that lands on `main` to run in the write job unchanged, so that parallel legs still serialise on `main` without a `--force` and without re-running any agent.
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
- **`needsAnswers`:** omitted. The launch questions are answered (see Launch decisions); the only remaining unknown is the decision 1 spike, which is the first task rather than an open question.

## Implementation Decisions

### 1. Threat model and trust channels

- The agent controls everything in the agent job: files, processes, the job's outputs, its artifact, its `ACTIONS_RUNTIME_TOKEN` (so it can upload, and possibly delete, artifacts in the run's namespace, and write cache entries), and the read token. The design accepts all of that.
- **Trusted channel:** `needs.lock.outputs.*` (set by a job that ran no agent), the event payload, the committed config and tree at the base sha, and whatever the apply job reads from the arbiter itself.
- **Hostile channel:** everything the agent job produces: its artifact, its outputs, its `result`. `needs.agent.result == 'success'` is only a precondition for trying the replay, never evidence that the content is good.
- The gate verdict and the Gate-2 review verdict become attestations from the hostile job. That is no worse than today: the agent can already edit the code and the gate configuration it is judged by. The untrusted-origin safety stays the forced PR (ADR `untrusted-origin-build-checkpoint`), and the apply job recomputes that rule itself (§7).
- Accepted residue: the agent can still read and exfiltrate the provider API key, the read token and anything readable with it. Those are not write credentials.

### 2. Job shape

A new reusable workflow `.github/workflows/dorfl-item.yml` (`on: workflow_call`) runs one item as three jobs, because GitHub cannot chain one matrix leg to the matching leg of the next job. The advance matrix calls it once per item; intake calls it once per issue (decision 10).

```yaml
# dorfl-item.yml, a sketch of the shape only (the generator owns the real text)
on:
  workflow_call:
    inputs: {item: string, integrationMode: string, agentTimeoutMinutes: number}
    # intake policy (origin trust, document mode) is NOT an input: the lock job
    # derives it from github.event (the caller's event is visible to a called
    # workflow) and from dorfl.json at baseSha, and publishes it as outputs.
    secrets: {ANTHROPIC_API_KEY: {required: false}, DORFL_GH_TOKEN: {required: false}}
permissions: {}
jobs:
  lock:
    permissions: {contents: write, issues: write, pull-requests: write}
    outputs: {acquired, needsAgent, rung, baseSha, lockSha, continueTip, handoffName, handoffKey, originTrust, documentMode, seenCommentIds}
    steps: checkout fetch-depth=0; dorfl-setup role=writer; dorfl <verb> "$ITEM" --phase lock
  agent:
    needs: lock
    if: needs.lock.outputs.acquired == 'true' && needs.lock.outputs.needsAgent == 'true'
    permissions: {contents: read, issues: read}
    timeout-minutes: from the agentTimeoutMinutes input
    steps: checkout ref=baseSha fetch-depth=0 persist-credentials=false lfs=true; dorfl-setup role=agent; dorfl <verb> "$ITEM" --phase agent --handoff-out DIR; upload-artifact (if always)
  apply:
    needs: [lock, agent]
    if: always() && needs.lock.outputs.acquired == 'true'
    permissions: {contents: write, issues: write, pull-requests: write}
    steps: checkout ref=baseSha fetch-depth=0; dorfl-setup role=writer; download-artifact (continue-on-error); dorfl <verb> "$ITEM" --phase apply --agent-result "$AGENT_RESULT" --handoff-in DIR
```

- Workflow-level `permissions: {}` in every generated workflow; each job grants its own. The caller job in `advance-lifecycle.yml` / `intake.yml` grants the union, because a called workflow can only narrow what its caller grants.
- `enumerate` drops to `contents: read`. `reap-merged-branches` keeps `contents: write` and `close-job` keeps `issues: write`; neither runs an agent, and both move to `dorfl-setup role=writer` (today they install the harness, write `models.json` and run the project-setup hook while holding a write scope). `verify` is unchanged.
- Every checkout uses `fetch-depth: 0`: the apply job needs full history for `merge-base --is-ancestor`, the bundle's `^baseSha` prerequisite and the rebase. The local composite action resolves only after a checkout, so checkout is always the first step.
- All three jobs run on GitHub-hosted runners (`ubuntu-latest`). The design assumes each job gets a fresh machine; on a non-ephemeral self-hosted runner, files and processes an agent planted would survive into a later lock or apply job. The workflow guard enforces the hosted label for generated workflows, and `docs/ci/README.md` states that self-hosted runners must be ephemeral (one job per machine) before these workflows may use them.
- No job with a write scope restores an Actions cache: the writer setup role uses no `setup-node` / `pnpm/action-setup` caching and no `actions/cache` step (the agent can write default-branch cache entries through its runtime token).
- The agent job checks out `needs.lock.outputs.baseSha`, not the event sha, so all three jobs agree on the base.
- Every value still reaches a `run:` script through `env:` (the no-`${{ }}`-in-`run:` rule), including every `needs.lock.outputs.*` value.
- Secrets: the provider key(s) go to the agent job only; `DORFL_GH_TOKEN` and the write-scoped `GITHUB_TOKEN` go to lock and apply only; the agent job gets `GITHUB_TOKEN`, which its job `permissions` make read-only.
- `timeout-minutes`: the agent job keeps today's dynamic `agentDeadlineMinutes + checkpointHeadroomMinutes` from `enumerate`; lock and apply get fixed bounds: 15 and 30 minutes.
- The per-issue `concurrency` group of `intake.yml` and the per-ref group of `advance-lifecycle.yml` stay on the calling workflows.

### 3. Per-path phase map

Verified against the code: every CI path is writes, then agents plus local work, then writes, with no network write between two agent launches and no write result fed back to an agent. The review loops (intake lone-task review in `intake.ts`, tasker review rounds in `tasking.ts`, Gate-2 rounds in `review-gate.ts`) change only local files or memory between rounds.

| path | lock phase (writes before) | agent phase (agents, repository code, local git) | apply phase (writes after) |
| --- | --- | --- | --- |
| intake | read issue, comments and labels; `processing` label (`intake.ts` `addLabel`); deterministic triage (a skip needs no agent); record the comment ids read | decision agent; lone-task review rounds (in memory) | ask: comment; bounce: `closeIssue` with comment; task/spec: render the document, branch `work/intake-<type>-<slug>`, `performIntegration` (PR, or merge with the CAS loop), completion comment; always: remove the label |
| build (`advance task:`, `do`) | classify; claim (`acquireItemLock`, `action: implement`); record base and kept-branch tip | continue rebase (decision 7); build agent; stop and deadline detection; gate; Gate-2 review; done-move commit; local rebase; fresh-worktree gate on the rebased tip | push branch, PR or merge (the `applyCompleteTransition` loop); review comment; WIP save with auto-continue or surface on deadline; needs-attention route; lock release |
| tasking (`advance spec:`, `do spec:`) | tasking lock (`action: task`) | tasker agent; review rounds (candidate files on disk) | integrate the candidates with `specs/ready → specs/tasked`, or save candidates, `closeRequestOnBranch` and surface; lock release |
| surface | advancing lock (unified, `action: advance`) | `surface-questions` agent (or the deterministic observation short-circuit) | `persistSurfacedQuestions` on a fresh checkout; tree-less publish; lock release |
| triage | advancing lock | triage gate agent | triage persist (marker, or `promoteObservation` through `createItemThroughCas`); tree-less publish; lock release |
| apply, observation | advancing lock | agentic decision | route the verdict (mint through `createItemThroughCas` or `mintAdr`, delete, keep); tree-less publish; lock release |
| apply, task/spec content answers | advancing lock | none (decision 11) | `applyAnsweredQuestions`; tree-less publish; lock release |
| apply, `kind: stuck` | advancing lock | none | keep, reset (`deleteRemoteWorkBranchIfPresent`) or cancel; persist; publish; release |
| apply, `kind: merge` | advancing lock | `createJob` checkout of `work/task-<slug>`; local rebase; optional `strictMergeApproval` re-stale check; fresh-worktree gate (`prepare` + `verify` run the branch's code) | merge land with the CAS loop; `applyAnsweredQuestions`; publish; release |

Orderings the implementation must preserve: the tree-less publish (`runAdvanceTickWithTreelessPublish` in `advance-drivers.ts`) happens today AFTER `performAdvance` has released the advancing lock in its `finally`; and the answered merge lands before the answer is recorded, as two separate writes to `main`.

### 4. The phase mode inside dorfl

- A CI-only `--phase lock|agent|apply` option on the agent-spawning verbs CI uses (`intake`, `advance`; `do` for parity). Absent means today's single process. `--phase` requires `GITHUB_ACTIONS=true` (or an explicit test override), so it cannot change laptop behaviour by accident.
- A `Phase` value is threaded through the run context next to `env` and `note`.
- **Record at the seams, resume at the boundary.** In the agent phase the write seams are replaced by recording implementations: `ledgerWrite` (a recording `LedgerWriteStrategy`), the review provider (`ReviewProvider`), the issue provider (`IssueProvider`; reads pass through with the read token), the integrator (reached through `applyCompleteTransition`), and the new seams §5 introduces. The first post-agent write call captures its intent and halts the pipeline with a sentinel the phase driver catches. Nothing after the first write runs in the agent phase, which removes every dependency on a write result (PR URL, `mergeNonFastForward`, `publishedHead`, CAS rejection) by construction.
- The captured intent plus the pipeline's in-memory products (agent summary, review prose, questions, verdicts, reasons) form the handoff record. Replay is not blind: for every intent kind the spec of the task defines which fields the apply job recomputes from trusted inputs, which it takes from the record as bounded text, and which it derives from the validated bundle. Each intent kind names the tail function the apply phase resumes at.
- This forces a refactor of the long pipelines into a pre-boundary half and a post-boundary half: `performIntegration`'s `runRebaseToIntegrateTail` splits into "rebase and fresh gate" (agent) and "land loop and review comment" (apply); intake's `dispatchTask` / `dispatchSpec` split before `switchToWorkBranch`; tasking splits before its integrate or surface; the tree-less rungs split at their existing injectable persist seams (`surfacePersist`, `applyPersist`, the triage persist), which is earlier than the push on purpose (§6).
- **Phase guards (defence in depth, independent of the workflow shape):**
  - in the lock and apply phases, `agentLaunchEnv` (the chokepoint every autonomous launch already goes through) throws, and so do `runVerify`, `prepare` and every harness launch;
  - in the agent phase, a write seam call that is not recorded throws (an unrouted write is a bug the tests catch), and the job token cannot write anyway;
  - in the apply phase, dorfl reads the artifact only from the directory passed on the command line, only the expected file names, and never executes anything from it.
- The lock phase writes its trusted facts to `$GITHUB_OUTPUT` through a small serializer that emits only shas, enums, booleans and dorfl-derived names (no free text from issues or items).

### 5. Write sites and the seams they must go through

Every network write in `packages/dorfl/src` outside tests, from `grep -n "'push'"` and the `gh` argument lists. "Seam" means the call already goes through `ledgerWrite`, the review provider, the issue provider or the integrator; "direct" means it bypasses them today and must be routed through a seam (new seam methods are fine) so the phase recorder sees it.

| site | what it writes | today | CI phase |
| --- | --- | --- | --- |
| `ledger-write.ts` `currentLedgerWrite.applyTransition` | nonce-stamped CAS push of a prepared transition commit to `main` | the seam | apply (`createItemThroughCas`, used by `promoteObservation` and `mintAdr`) |
| `item-lock.ts` `acquireItemLock` | create-only lock ref | direct | lock |
| `item-lock.ts` `releaseLockEntry`, `leasedDeleteLockRef` | leased lock ref delete | direct | apply (lease on the lock job's `lockSha`) |
| `item-lock.ts` `amendHeldEntry` | lock entry amend | direct | apply, where a CI path still uses it |
| `item-lock.ts` `requeueItemLock` | lock amend | direct | human verb only, not a CI path |
| `integrator.ts` `mergePushOnce`, `pushBranch`, `deleteMergedHeadBranch` | merge push to `main`, branch push, merged-head delete | seam (`applyCompleteTransition`) | apply |
| `continue-branch.ts` `pushProposeBranchWithStaleLeaseRetry` | propose branch push | inside the integrator seam | apply |
| `continue-branch.ts` `pushContinuedBranchWithStaleLeaseRetry` | kept branch rebase push | direct, from `start.ts` (in-place continue), `workspace.ts` `createJob` (merge action, remote), `isolation.ts` | apply (decision 7) |
| `needs-attention.ts` `routeToNeedsAttention` | WIP commit and work branch push | seam when called through `applyNeedsAttentionTransition`; direct from `do.ts` (deadline checkpoint save) | apply |
| `needs-attention.ts` `deleteRemoteWorkBranchIfPresent` | remote work branch delete | direct (`apply-stuck-action.ts` reset, `returnToBacklog`) | apply |
| `needs-attention.ts` `attemptReconcile` | reconciled kept branch push | direct | human verb (`requeue --reconcile`), not a CI path |
| `tasking.ts` `persistTaskingCandidates` | `work/spec-<slug>` branch push | direct | apply |
| `advance-treeless-publish.ts` `pushTreelessResult` | `HEAD:main` push of a tree-less commit | direct, from the drivers | apply |
| `reap-branches.ts` `sweepRemoteMergedBranches` | merged branch delete | direct | `gc --remote-branches` in a no-agent job, unchanged |
| `github.ts` `GitHubProvider`: `pr create`, `pr edit` (two sites), `pr reopen`, `pr close`, `pr comment` | PR writes | review provider seam | apply |
| `issue-provider.ts` `GitHubIssueProvider`: `issue comment`, `issue close`, `issue edit --add-label/--remove-label` (two sites), `label create` | issue writes | issue provider seam | lock (label add, label create), apply (comment, close, label remove) |
| `integration-core.ts` callers of `postPRComment` / `postPRCommentOnBranch` | Gate-2 review comment | review provider seam | apply |
| `tasking.ts` caller of `closeRequestOnBranch` | close a stale spec PR on a bounce | review provider seam | apply |
| `close-job.ts` `closeIssue` | close landed issues | issue provider seam | `close-merged-issues`, no agent, unchanged |
| `install-ci-github.ts` `gh api` writes | secrets, rulesets, branch protection | its own wrapper | human-run `install-ci`, out of scope |

`gh pr view`, `gh pr list` (`merge-question-surfacer.ts`), `gh issue view` and `gh label list` are reads.

Correction to the idea note: it estimated about 40 push sites. The count is 17 `push` invocations in 8 files, plus 11 `gh` write argument lists in the 2 provider adapters (and `install-ci-github.ts`, out of scope).

### 6. The handoff

One artifact per leg, named from `needs.lock.outputs.handoffName` (derived from the item by dorfl in the lock job and sanitised to artifact-name rules, since an item id contains `:`), uploaded with `retention-days: 1` (artifacts of a public repository are downloadable by any signed-in user, so they must hold nothing that is not going to be public anyway), containing only:

- `handoff.json`: `{schema: 1, item, intent, products, mac}`. `intent` is a closed union with one kind per boundary, listed in the table below. `products` holds the bounded free text: PR body from the agent summary, Gate-2 review prose, needs-attention reason and questions, verdict fields, candidate task file contents. `mac` per decision 1.
- `work.bundle`, for code-carrying intents only (`integrate`, and `needs-attention` / `deadline-checkpoint` / `stop` / `agent-failed` when there is WIP): `git bundle create work.bundle <work-branch> ^<baseSha>`, exactly one ref.
- `lfs/<oid>`: every object referenced by an LFS pointer blob added or changed in the bundle's new commits, copied from the agent job's `.git/lfs/objects/`. Every such oid must be present, including one the agent copied from elsewhere in the repository (the agent job's checkout fetched it), so the apply job never has to ask the LFS server what exists.

LFS in the agent job: the checkout uses `lfs: true` (read token), and the setup runs `git lfs install --local` so a commit of an LFS-tracked path stores a pointer and the object under `.git/lfs/objects/`, as on a laptop. dorfl's handoff writer finds the pointers by scanning the blobs of the new commits (a blob that parses as a pointer counts, whatever `.gitattributes` says), not by trusting `git lfs ls-files`. Accepted consequence: a legitimate text file that happens to parse as a pointer (a test fixture, say) is treated as one, and its object must be present or the handoff is rejected.

**The intent kinds.** For every kind: what the apply job recomputes from trusted inputs (lock outputs, workflow inputs, the tree at `baseSha`, the arbiter, the event), what it takes from the record (bounded text or enums, validated), what it takes from the validated bundle, and the tail function it resumes at. A field not listed is not read from the artifact at all.

| intent | recomputed from trusted inputs | taken from the record | from the bundle | apply resumes at |
| --- | --- | --- | --- | --- |
| `integrate` (build) | item, work branch name, arbiter, integration mode (workflow flag, then the untrusted-origin rule on the task at `baseSha`), `deleteMergedHead` | PR title (single line, at most 72 characters), PR body, Gate-2 review prose | work branch tip (done-move included) | the land half of `runRebaseToIntegrateTail` (the `applyCompleteTransition` loop), then the review comment, then the lock release |
| `integrate` (answered merge) | item, branch, mode `merge`, the answered `kind: merge` entry read from `main` | none | rebased tip of `work/task-<slug>` | the same land loop, then `applyAnsweredQuestions`, the tree-less publish and the release |
| `merge-restale` | item, the answered entry | none | none | the `strictMergeApproval` follow-up question and re-pause, publish, release |
| `needs-attention` | item, branch, sidecar path | reason, questions | WIP tip, if any | the write half of `routeToNeedsAttention` (branch push) and the surface (sidecar, `needsAnswers: true`), then the release |
| `deadline-checkpoint` | item, branch, `maxAutoCheckpoints` from config at `baseSha` | none | WIP tip; the checkpoint count is recounted from the new commits | the write half of `routeDeadlineCheckpoint`: branch push, then auto-continue release or surface |
| `stop` | item, branch | reason, stop kind (enum) | WIP tip, if any | the write half of `saveAgentStop` |
| `agent-failed` | item, branch | failure detail | WIP tip, if any | the write half of `saveAgentFailure` |
| `tasking-land` | spec slug, the spec move to `specs/tasked/`, candidate folder (`work/tasks/backlog/`), mode, the origin stamp of the spec at `baseSha` | candidate task files keyed by safe slug, PR body | none | the tasking integrate (`performIntegration` with its tasking lifecycle), then the release |
| `tasking-surface` | spec slug, branch `work/spec-<slug>`, mode | candidate task files, reason, questions | none | `persistTaskingCandidates` (commit rebuilt in the apply job), `closeRequestOnBranch` in propose mode, `surfaceTaskingBlock` |
| `surface` | item, item path at `baseSha`, sidecar path, engine-built base questions | the agent's questions | none | `persistSurfacedQuestions`, publish, release |
| `triage` | item, the resolved `observationTriage` gate | the triage verdict fields | none | the triage persist (`promoteObservation` or the `triaged:` marker), publish, release |
| `apply-decision` | item, the answered sidecar read from `main` | the decision verdict (kind enum; minted title, body and slug; reason) | none | the verdict router (`createItemThroughCas`, `mintAdr`, delete, keep), publish, release |
| `intake-ask` | issue number, marker, seen comment ids (lock output) | question text | none | `dispatchComment`, label removal |
| `intake-bounce` | issue number, marker, seen comment ids | bounce text | none | `closeIssue` with the comment, label removal |
| `intake-task`, `intake-spec` | issue number, placement, origin-trust stamp, document mode, seen comment ids, the slug (derived from the verdict, then checked by `slug-safety.ts`) | title (single line), body, and for a spec the two gate booleans the prompt judged | none | render the document, `switchToWorkBranch`, `performIntegration`, completion comment, label removal |

There are 15 kinds: `integrate` has two rows (build and answered merge) and `intake-task` / `intake-spec` share one. The answered merge action's re-stale outcome (`strictMergeApproval`) needs its own kind, `merge-restale`. The implementing tasks may merge or split kinds, but every kind must keep all four columns filled.

Deliberately NOT handed over as a bundle: intake documents, tasking candidates and tree-less rung results. For those the apply job re-renders and re-commits from the structured products on a fresh checkout of `main`, exactly as dorfl does today after the agent returns. Reason: on those paths dorfl stages only dorfl-chosen paths today (`tasking.ts` `git add -- <paths>`, `intake.ts` `git add -- <relPath>`, the persist helpers write one sidecar or body), so accepting a bundle would silently widen what the agent can land. The build path commits with `git add -A` today, so a bundle does not widen it (the new `.github/` rule narrows it).

### 7. Apply-phase validation (the artifact is hostile)

Validate everything, then write. Any rejection writes nothing from the artifact, releases the lock (or surfaces the item with the rejection reason, per decision 5; for intake, removes the label), and exits non-zero so the run is red.

- **Identity and targets from trusted inputs only.** Item, rung, base sha, lock sha, kept-branch tip, integration mode, placement, origin trust and handoff key come from `needs.lock.outputs`, the workflow inputs and the tree at `baseSha`. The work branch name is `workBranchRef(type, slug)` computed in the apply job. The bundle is read with `git -c transfer.fsckObjects=true fetch <bundle> refs/heads/<that-name>:refs/dorfl/incoming/tip`; every other ref in the bundle is ignored. `handoff.json`'s `item` must equal the trusted item.
- **Binding** (decision 1): the MAC over `handoff.json`, the bundle's sha256 and every `lfs/` file's sha256 verifies with the leg's key (or, in the one-run-per-item fallback, nothing extra is needed).
- **Schema:** an unknown `schema`, an unknown `intent.kind`, an intent kind the trusted rung cannot produce (a surface leg cannot hand over `integrate`), or unknown fields: reject.
- **History:** `baseSha` is an ancestor of the tip (`git merge-base --is-ancestor`); the new set `git rev-list tip ^<arbiter>/main` (after a fresh fetch in the apply job) is non-empty, bounded (at most 200 commits) and has no merge commit (dorfl only rebases; a kept branch a human repaired with a merge is routed to needs-attention with the reason "the work branch contains a merge commit; rebase it and requeue"), so a per-commit diff against its single parent covers every change. A commit the agent passes off as `main` but that is not on the real `main` is simply part of the new set and gets the same checks.
- **Paths:** no new commit adds, modifies, deletes or renames anything under `.github/`, checked per commit and not only on the final tree, because a pushed branch runs the workflow files in its own history when a PAT triggers them. Other protected paths and the `work/` ledger rule per decisions 3 and 4. No symlink pointing outside the repository; no gitlink.
- **Recomputed policy:** the untrusted-origin forced propose is evaluated from the task at `baseSha`, never from the bundle; merge mode requires the trusted `integrationMode` and the recomputed rule to agree.
- **Intake inputs:** the lock job derives the origin trust (from `github.event.comment.author_association`, else `github.event.issue.author_association`, as `intake.yml` does today) and the document mode (`intakeIntegration ?? integration` from `dorfl.json` at `baseSha`) and publishes both as outputs. The agent job reads the issue with its read token but passes the decision agent only the comments whose ids are in the lock job's `seenCommentIds`, so a comment posted after the lock is neither read nor marked seen.
- **Structured products:** every slug passes `slug-safety.ts`; tasking candidate paths must be `work/tasks/backlog/<safe-slug>.md` and new-or-changed relative to `baseSha` (the fence `newOrChangedStagedTasks` applies today); intake document paths are recomputed from the verdict slug and the trusted placement, and the document is re-rendered (`renderBacklogTask`, the spec renderer) in the apply job, so the `origin` / `originTrust` stamp comes from the trusted event and not from the agent job. Re-rendering is not enough on its own: `renderBacklogTask` writes `title: ${title}` unescaped today (`intake.ts`), so a title containing a line break and `---` ends the frontmatter before the stamp lines and pushes them into the body. The apply job therefore (a) rejects any title that is not a single line or contains a control character, (b) renders every agent-supplied frontmatter scalar YAML-quoted, and (c) re-parses the rendered frontmatter and asserts that `origin`, `originTrust`, `slug` and `issue` equal the trusted values before committing. The same re-parse check applies to tasking candidates: their `origin` / `originTrust` are overwritten with the spec's stamp at `baseSha`, and a candidate whose frontmatter does not parse, or carries `humanOnly` / `needsAnswers` values the tasking review loop did not set, is rejected. (The same injection exists on today's single-job path; the separate task `intake-frontmatter-title-injection-strips-origin-stamp` fixes it there first.) The intake `seen=` delta written into the marker comes from the comment ids the lock job read (a lock output), never from a re-read in the apply job (which would mark comments seen that no agent read) and never from the agent job.
- **Size limits** (set in code, never read from the artifact): artifact 200 MB; bundle 100 MB; one blob 20 MB; LFS objects 500 MB in total; `handoff.json` 2 MB; PR title 72 characters (the existing `PR_TITLE_MAX`); PR body and each comment 60,000 characters (under GitHub's 65,536); each reason or question 10,000 characters.
- **LFS** (decision 6): the apply job scans every blob added or changed by the new commits for LFS pointers with a strict parser (the spec v1 format: at most 1024 bytes, `version https://git-lfs.github.com/spec/v1`, `oid sha256:<64 hex>`, `size <n>`, keys in order, nothing else). For every pointer, `lfs/<oid>` must exist, be a regular file, have exactly `size` bytes and hash to `oid`; a missing, extra, oversized or mismatching object rejects the whole handoff. Files in `lfs/` that no pointer references are rejected too (they would only consume LFS quota). The objects are pushed with `git lfs push --object-id <arbiter> <oids>` from the apply job's checkout of the trusted base (so `.lfsconfig` and the LFS endpoint come from `main`, never from the bundle), before any ref is pushed, so a ref never lands pointing at a missing object. Every other git command in the apply job runs with `GIT_LFS_SKIP_SMUDGE=1`. Because the LFS endpoint is configured by `.lfsconfig`, it joins the protected paths of decision 3 (an agent that changed it in merge mode could redirect a later push). Content addressing means a hostile object can only be itself: it cannot overwrite another object.
- **Artifact extraction:** download into an empty directory under `$RUNNER_TEMP`, read only the expected file names, reject symlinks and any other entry. `actions/download-artifact` must be at least 4.1.3, the release that fixed arbitrary file write during extraction (CVE-2024-42471).
- **Agent result:** `needs.agent.result` must be `success` before any replay is attempted. `skipped` is accepted only when the lock job said `needsAgent == 'false'`; then there is no artifact and the apply job runs the deterministic rung itself. `failure`, `cancelled` and a timeout go to the failure handling of decision 5 and never read the artifact.
- **Lock ownership:** before its FIRST write, the apply job checks that the item's lock ref still equals `lockSha`; if not, it writes nothing and exits (the lock was released, reaped or re-taken). Every later lock operation is leased on the sha the apply job last observed (`lockSha`, or the sha its own amend produced), so an apply job never releases a lock another run holds now. The lock `holder` is `dorfl[bot]` for every CI leg, so it cannot tell legs apart; the sha can. The agent job makes the same read-only check before launching any agent, so a stale leg does not spend an agent run.
- **Re-runs:** "Re-run failed jobs" replays the old lock outputs and, for the apply job, the old artifact. That is safe because of the ownership check above: the first apply already released or surfaced the item, so the re-run finds the lock gone and writes nothing. The way to retry an item is a new run (the next tick, or a dispatch), which takes a fresh lock. The apply job prints that instruction when it refuses a re-run.

### 8. The merge-mode compare-and-swap loop

`performIntegration`'s land loop moves to the apply job unchanged. Verified: each iteration calls `ledgerWrite.applyCompleteTransition`; on `mergeNonFastForward` it sleeps a jitter and calls `rebaseOntoMainWithReconcile`, which fetches `<arbiter>/main`, runs `readArbiterLedgerPlacement`, rebases with `merge.directoryRenames=false`, and on a conflict tries `reconcileSiblingLedgerConflict` / `reconcileDivergentDoneMove` or routes to needs-attention through `ledgerWrite.applyNeedsAttentionTransition`. None of that launches an agent or runs `prepare` / `verify`: the fresh-worktree gate runs once, before the loop. So the apply job needs only git and dorfl. The rebase and reconcile commits it makes treat the hostile content as data: the apply job's hooks and git config come from its own fresh checkout, and a bundle cannot carry either. Decision 2 keeps this loop gate-free, and because the split makes a lost first push the common case in merge mode (see decision 2), the apply phase reports every land whose tree differs from the gated tree.

### 9. Setup for the write jobs (no repository code)

The composite `dorfl-setup` action gains a role (or a sibling action). `role: writer` installs Node and dorfl only: no harness, no provider key, no `models.json`, no project-setup hook, no install of the project's dependencies. The dorfl install runs from `$RUNNER_TEMP`, outside the checkout, with `--ignore-scripts`, so a repository `.npmrc` cannot redirect the registry. `role: agent` is today's action. `reap-merged-branches` and `close-job` use `role: writer` too. In workspace mode see decision 8. The local composite action itself is read from the checked-out `main`, which the `.github/` rule keeps agents from changing through CI.

### 10. Tokens per job

| job | `GITHUB_TOKEN` scope | persisted credential | other secrets |
| --- | --- | --- | --- |
| lock | `contents`, `issues`, `pull-requests`: write | allowed (no agent) | `DORFL_GH_TOKEN` if set |
| agent | `contents: read`, `issues: read` | `persist-credentials: false` | provider API key(s) only |
| apply | `contents`, `issues`, `pull-requests`: write | allowed (no agent) | `DORFL_GH_TOKEN` if set |

In the agent job, dorfl's own git fetches (the final rebase onto `<arbiter>/main`, the kept branch, the merge action's clone) use the read token through per-command `GIT_CONFIG_COUNT` / `http.extraheader`, which `scrubAgentEnv` already removes from the agent's environment. The agent can still read that token from `/proc`; it only reads. On a public repository the token is still needed for `gh issue view` rate limits. No `id-token` permission anywhere in the agent job.

### 11. What does not change

- Laptop `do`, `advance`, `advance -n`, `intake`, `complete`, `start` / `work-on`, and the `run` daemon: no `--phase`, today's single-process behaviour.
- The `agent-env.ts` scrub stays; it now mainly protects the read token.
- `close-job`, `verify`, `reap-merged-branches` and `deploy-gh-pages` run no agent and keep their shape; `close-job` and `reap-merged-branches` switch to the writer setup role (§2), and the workflow-level `permissions: {}` convention reaches all generated files.
- The ledger, lock and question protocols (`WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`) are unchanged in substance; only the land-invariant wording changes (decision 2).

### 12. Costs and constraints

- **Two extra jobs per item**, each with a checkout and a dorfl setup (about one to two minutes each), and more queue latency between phases. The lock job runs even for legs that turn out to be no-ops. Runner minutes roughly double for short rungs (surface, triage) and grow little for builds.
- **New pinned actions:** `actions/upload-artifact` and `actions/download-artifact` join `ACTION_PINS` in `install-ci-action-pins.ts`, each pinned to a full 40-character commit SHA resolved and recorded by the procedure that file's header describes (peeled tag, cross-checked with `gh api`), in the Dependabot format, and covered by the existing pin-preservation logic and `install-ci-actions-pinned.test.ts`.
- **No `${{ }}` inside `run:`** in any new job; the existing `install-ci-no-expression-in-run.test.ts` covers the new files automatically once the generators emit them.
- **The agent job still needs a read token on private repositories** (§10), and the agent can read it.
- Job outputs are limited in size (1 MB per job), so the lock job outputs only small facts; the list of comment ids for intake is the largest (bounded by the thread).
- Reusable workflows: the caller must grant the union of permissions; secrets are passed explicitly (never `secrets: inherit`), so `DORFL_GH_TOKEN` cannot reach the agent job by default.
- A new ADR records the decision ("CI agents run in a job with no write token"), because it is hard to reverse, surprising without context and a real trade-off (`ADR-FORMAT.md` gate).

### 13. Upgrade path and changeset

- `dorfl install-ci` regenerates `intake.yml` and `advance-lifecycle.yml`, adds `dorfl-item.yml`, and updates the composite setup action (roles). Existing SHA pins are kept as today. The seed template `docs/ci/advance-loop.yml.template` (parameterised by `advance-lifecycle-template.ts`) and `docs/ci/README.md` change with it, and so do the structural validators (`validateAdvanceCiTemplate` and the intake/lifecycle template tests).
- The setup action pins `dorfl@<version>`, so regenerated workflows always run a dorfl that understands `--phase`. An old workflow with a new dorfl keeps working unchanged and gets the warning of decision 9.
- `DORFL_GH_TOKEN`: no consumer action needed; the generated workflows now route it to lock and apply only.
- dorfl's own `.github/workflows` are regenerated in the same change (as `40a7f5fc` did for the pins), and the guard test also runs over the checked-in files so this repository cannot drift.
- Changeset: `minor` (a new CLI option, a new workflow file, a changed job shape, and consumer action required). It states what changed and why (the three leak routes the env scrub could not close), the cost (two extra jobs per item), the new actions and their pins, the protected-path rejection (and what a workflow-editing task now does), that in merge mode most lands will now be re-rebased after the gate ran (decision 2) and how to see it in the run output, and "re-run `dorfl install-ci` after upgrading".

### 14. Drift found while verifying the idea note

- `WORK-CONTRACT.md` and the `advance-lifecycle` template comment say a lost CAS re-arms the gate; the code does not (decision 2).
- An inline comment in `performAdvance` (`advance.ts`, the lock step) still says the `work/advancing/<entry>.md` marker CAS is kept for all rungs; `advancing-lock.ts` says the marker is gone (the comment is stale; the code agrees with `advancing-lock.ts`).
- `renderBacklogTask` (and the spec renderer) in `intake.ts` write agent-supplied titles into frontmatter unescaped, which lets an intake agent strip the `originTrust` stamp today (§7; separate task `intake-frontmatter-title-injection-strips-origin-stamp`).
- The idea note's "roughly 40 push sites" is 17 (§5).

## Testing Decisions

Good tests here assert external behaviour: what a generated workflow grants, what the arbiter holds after each phase, and what the apply phase refuses. Prior art: `install-ci-no-expression-in-run.test.ts` and `install-ci-checkout-credentials.test.ts` (parse every generated file with `yaml` for every config shape), `install-ci-actions-pinned.test.ts`, `do.test.ts` / `intake.test.ts` / `answered-observation-apply-e2e.test.ts` (bare-repo arbiters from `test/helpers/gitRepo.ts`, stub harnesses and providers), `cross-job-land-worker.ts` (multi-process land).

The implementation must add at least:

1. **Workflow guard (new).** Parse every workflow and composite action the generators emit, for every config shape, plus the repository's own checked-in `.github/workflows`. For each job, resolve the effective token scope (job `permissions`, else workflow `permissions`, else "repository default", which counts as write; `write-all` counts as write; for a called workflow, also cap by the caller) and the checkout's `persist-credentials`. Fail when a step runs an agent-spawning `dorfl` verb (a NEW exported `AGENT_SPAWNING_VERBS` set, a deliverable of this spec; nothing by that name exists today) without `--phase lock` / `--phase apply` in a job whose checkout persists credentials or whose token has any `write` scope. Also fail when a `--phase lock|apply` job receives a provider API key, and when an agent job references any secret other than the provider key(s) and `GITHUB_TOKEN`. Also fail when a job with a `write` scope restores an Actions cache, and when a lock, agent or apply job does not run on a GitHub-hosted label. A companion unit test asserts that every CLI verb is classified as agent-spawning or not, so a new verb cannot escape the set.
2. **Phase guard (new).** In the lock and apply phases, `agentLaunchEnv`, every harness launch, `runVerify` and `prepare` throw; in the agent phase, an unrecorded write seam call throws.
3. **Hostile artifact (new).** Drive the apply phase against crafted handoffs over a real bare arbiter, and assert for each that nothing from the artifact reached the arbiter (a `git for-each-ref` snapshot of the arbiter is unchanged apart from the lock release or needs-attention surface) and that the reported reason names the rule: bundle ref is not the expected `work/task-<slug>` (for example it carries `refs/heads/main` or another item's branch); a `.github/` change, including one added and then reverted inside the range; commits not descending from `baseSha` (unrelated root, or based on a commit that is not on `main`); a merge commit in the range; `handoff.json` naming another item; an unknown schema or an intent kind the rung cannot produce; an over-limit bundle or text field; a tasking candidate outside `work/tasks/backlog/` (including `..` and `work/tasks/ready/`); an intake verdict with an unsafe slug; an intake title containing a line break and `---` (the rendered document must still carry the trusted `originTrust`, or the handoff is rejected); a tasking candidate that sets its own `originTrust`; a re-run of the apply job after the lock was released (writes nothing); a MAC that does not verify, including a valid handoff from another leg replayed under this leg's name; LFS: a pointer with no object, an object whose hash or size does not match its pointer, a malformed pointer, an unreferenced extra object, an object over the size limit, and a `.lfsconfig` change; a symlink in the artifact directory.
4. **End to end (new): lock, agent and apply for a build and for an intake.** Three separate processes in three separate clones of one bare arbiter, sharing only the handoff directory and the lock outputs. The agent-phase clone has a push URL that cannot accept pushes, and the test asserts the arbiter's refs are byte-identical before and after the agent phase, and that the stub issue/review providers recorded no write call in it. Then assert the apply phase produced today's outcome: for the build, a propose PR (stub provider) and, in a second case, a merge on `main` including one forced non-fast-forward that exercises the CAS loop; for the intake, the task document at the trusted placement with the trusted `originTrust` stamp, the completion comment and the label removal. Also one case per failure mode (agent failed, cancelled, skipped) asserting the lock and the label are released or surfaced per decision 5. Plus an LFS build case: the stub agent commits a file under an LFS-tracked pattern; the arbiter is a local bare repository served through git-lfs's standalone file transfer (`file://` URL), and the test asserts the object reached the arbiter's LFS store before the ref, and that the agent-phase clone did not upload it. That case needs `git-lfs` on the machine; it must not silently skip in CI (GitHub-hosted runners have it), and locally it may skip with a message naming the missing binary.
5. **Red first.** The workflow guard and the hostile-artifact tests must be run against the current code first and the failures recorded in the done record: the workflow guard must list today's `intake` job and the `advance-propose` / `advance-merge` jobs by name (a meaningful red, not a crash); the hostile-artifact tests fail because no apply phase exists, and each must then go green for the stated reason, not by accident.
6. Existing template tests (`advance-lifecycle-template.test.ts`, `intake-trigger-template.test.ts`, `advance-ci-template.test.ts`, `install-ci-*.test.ts`) are updated for the three-job shape; the pin tests cover the two new actions.

Tests must not touch the real environment: every test uses temporary repositories with `GIT_CONFIG_GLOBAL=/dev/null` as today, and no test calls GitHub.

## Out of Scope

- Stopping the agent from exfiltrating the provider API key or the read token. Neither can write; a separate provider-side key scope or proxy would be its own spec.
- Cache poisoning through `ACTIONS_RUNTIME_TOKEN`: the separate task `release-workflow-restores-no-cache` (decision 12).
- Re-verifying on the rebased tip after a lost CAS in the apply job (decision 2); a follow-up idea.
- The laptop, `run` daemon and `--isolated` / `--remote` paths: they hold the human's own credentials by design.
- Any change to `install-ci`'s one-time secret and branch-protection wizard beyond emitting the new files.
- Reviving the dropped in-job hardening (git state snapshot, hook suppression, process-group kill): once the agent job holds no write token it buys nothing.

## Further Notes

- Source: `work/notes/ideas/agent-job-with-read-only-token.md`. This spec carries its feasibility table, shape, dropped attempt and open questions, so the idea note was discharged (deleted) in the same change as this spec.
- The feasibility claim ("no write between two agent launches") was checked in `intake.ts` (`performIntake`, `decideAndDispatch`, `dispatchTask`), `do.ts` (claim, onboarding, agent, `performComplete`), `integration-core.ts` (`performIntegration`, `runRebaseToIntegrateTail`), `tasking.ts` (review loop, `persistTaskingCandidates`, `surfaceTaskingBlock`), `advance.ts` (`performAdvance`, `surfaceRung`, `applyRung`, `maybeRunMergeAction`, `maybeRunStuckAction`), `advance-drivers.ts` and `apply-merge-action.ts`, at commit `b87e5f8b`.
- The answered merge action runs `prepare` / `verify` on branch code an earlier agent wrote. It has no agent, but it runs repository code, so it belongs in the agent job for the same reason.
