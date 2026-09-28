---
title: 'Generate the split workflows: dorfl-item, the per-item dispatch wrapper, intake and advance-lifecycle, setup roles, pins and the workflow guard'
slug: ci-split-generate-workflows
spec: ci-agent-job-without-write-token
humanOnly: true
blockedBy: [ci-split-build-path, ci-split-build-path-non-integrate-intents, ci-split-agent-result-and-reruns, ci-split-landed-vs-gated-report, ci-split-intake, ci-split-tasking, ci-split-treeless-rungs, ci-split-answered-merge-action, ci-split-handoff-lfs-objects, release-workflow-restores-no-cache]
covers: [3, 14, 16, 17, 18, 20]
---

## What to build

Change the `install-ci` generators (and the seed template `docs/ci/advance-loop.yml.template` with its validators) to emit the split shape. It lands only after every path supports `--phase`, so a release never generates workflows that call a phase dorfl cannot run.

- `dorfl-item.yml` (`workflow_call` only, no workflow-level `concurrency`) with the lock, agent and apply jobs; `dorfl-item-dispatch.yml` (`workflow_dispatch` wrapper, `run-name: dorfl-item <item>`, slot `concurrency` with `queue: max`, calling `dorfl-item.yml`); `intake.yml` calling `dorfl-item.yml` under its per-issue group; `advance-lifecycle.yml` with `enumerate` plus a `dispatch` job (`actions: write` only, no checkout, no setup) that skips items with a non-completed run and forwards `integrationMode`, the timeout, the slot and the four gate overrides.
- The composite setup action gains `role: writer` (Node and dorfl only, installed from `$RUNNER_TEMP` with `--ignore-scripts`, no harness, no provider key, no project-setup hook) next to `role: agent`; `reap-merged-branches` and `close-job` switch to the writer role; no role restores any cache.
- `actions/upload-artifact` and `actions/download-artifact` (at least 4.1.3) join `ACTION_PINS` in `install-ci-action-pins.ts`, each pinned to a full commit SHA resolved and recorded by the procedure that file's header describes.
- The stale template comments that say a lost CAS re-gates are corrected (decision 2): `docs/ci/advance-loop.yml.template` (the header and the merge-job comments), `advance-lifecycle-template.ts` (the same comments in the generated text), and the validator notes in `advance-ci-template.ts`. The protocol docs, `docs/ci/README.md` and the config comments are task `ci-split-docs-drift-and-rollout`.
- **This repository's own workflows are regenerated in the same task** (`.github/workflows` and `.github/actions/dorfl-setup`, as commit `40a7f5fc` did for the pins), because the workflow guard also scans the checked-in files and would otherwise stay red. The regenerated files also stop restoring a cache, which is why task `release-workflow-restores-no-cache` must land first (it fixes `release.yml` and `deploy-gh-pages.yml`, which the generators do not own).

`humanOnly` because this task edits `.github/`: the new apply job refuses `.github/` changes from CI (decision 4) and `GITHUB_TOKEN` cannot push workflow files, and because it emits the security boundary itself (the job permissions and credentials), which a human must own.

### Design reference (carried verbatim from the spec)

#### 2. Job shape

Two new workflow files (decision 1):

- **`dorfl-item.yml`** runs ONE item as three jobs. Its only trigger is `workflow_call`, it has no workflow-level `concurrency`, and its inputs and secrets have one shape.
- **`dorfl-item-dispatch.yml`** is a thin `workflow_dispatch` wrapper: one run per advance item, holding the parallelism slot (`concurrency` with `queue: max`, the exact shape the spike measured on a dispatched workflow), whose single job `uses: ./.github/workflows/dorfl-item.yml`. The artifact namespace is still that one run's, so "one item per run" holds.

`intake.yml` calls `dorfl-item.yml` directly under its existing per-issue `concurrency` group (an intake run already carries exactly one issue, decision 10), so no slot group ever applies to intake. There is no matrix any more: GitHub cannot chain one matrix leg to the matching leg of the next job, and a matrix would put every item's artifact in one shared namespace.

```yaml
# dorfl-item-dispatch.yml, a sketch of the shape only (the generator owns the real text)
on:
  workflow_dispatch:
    inputs:
      item: {type: string, required: true}
      integrationMode: {type: choice, options: [propose, merge], required: true, default: propose}
      slot: {type: string, required: true, default: '0'}
      autoBuild / autoTask / observationTriage / surfaceBlockers: {type: choice, blank first option, as today}
run-name: dorfl-item <inputs.item>          # what the dispatch job de-duplicates on
permissions: {}
concurrency: {group: dorfl-slot-<inputs.slot>, cancel-in-progress: false, queue: max}
jobs:
  item:
    permissions: {contents: write, issues: write, pull-requests: write, actions: read, checks: read}   # the union dorfl-item.yml narrows (apply needs the two reads)
    uses: ./.github/workflows/dorfl-item.yml
    with: {item, integrationMode, the four gate overrides}
    secrets: {ANTHROPIC_API_KEY, DORFL_GH_TOKEN}                         # explicit, never `inherit`

# dorfl-item.yml
on:
  workflow_call:
    inputs: {item: string, integrationMode: string, the four gate overrides: string}
    # intake policy (origin trust, document mode) is NOT an input: the lock job
    # derives it from github.event (a called workflow sees its caller's event)
    # and from dorfl.json at baseSha, and publishes it as outputs.
    secrets: {ANTHROPIC_API_KEY: {required: false}, DORFL_GH_TOKEN: {required: false}}
permissions: {}
jobs:
  lock:
    permissions: {contents: write, issues: write, pull-requests: write}
    outputs: {acquired, needsAgent, rung, baseSha, lockSha, continueTip, handoffName, agentTimeoutMinutes, originTrust, documentMode, seenCommentIds}
    steps: checkout fetch-depth=0; dorfl-setup role=writer; export gate overrides; dorfl <verb> "$ITEM" --phase lock
  agent:
    needs: lock
    if: needs.lock.outputs.acquired == 'true' && needs.lock.outputs.needsAgent == 'true'
    permissions: {contents: read, issues: read}
    timeout-minutes: fromJSON(needs.lock.outputs.agentTimeoutMinutes)
    steps: checkout ref=baseSha fetch-depth=0 persist-credentials=false lfs=true; dorfl-setup role=agent; export gate overrides; dorfl <verb> "$ITEM" --phase agent --watch --handoff-out DIR; upload-artifact (if always)
  apply:
    needs: [lock, agent]
    if: always() && needs.lock.outputs.acquired == 'true'
    permissions: {contents: write, issues: write, pull-requests: write, actions: read, checks: read}   # read the agent job's annotations (timeout vs cancel)
    steps: checkout ref=baseSha fetch-depth=0; dorfl-setup role=writer; export gate overrides; download-artifact (continue-on-error); dorfl <verb> "$ITEM" --phase apply --agent-result "$AGENT_RESULT" --agent-timeout-minutes "$AGENT_TIMEOUT_MINUTES" --handoff-in DIR   # both via env: from needs.*
```

- Workflow-level `permissions: {}` in every generated workflow; each job grants its own. The calling job (in `dorfl-item-dispatch.yml` and in `intake.yml`) grants the union of what the three jobs request (`contents`, `issues`, `pull-requests: write`; `actions`, `checks: read`), because a called workflow can only narrow what its caller grants.
- **The base is the arbiter tip, never the run's commit.** A dispatched run's `github.sha` is `main` at dispatch time, and with `queue: max` a run can wait for hours. The lock job therefore fetches `<arbiter>/main` and uses ITS tip as `baseSha` and as the tree it classifies against; `github.sha` is used only to load the local composite action. The agent and apply jobs check out `needs.lock.outputs.baseSha`, so all three jobs agree on the base.
- **advance-lifecycle.yml:** `enumerate` computes the item list as today. A `dispatch` job then starts one `dorfl-item-dispatch.yml` run per item. It holds `permissions: {actions: write}` and nothing else, has NO checkout and NO setup (so no repository code runs next to `actions: write`), and only runs the preinstalled `gh`: `gh workflow run dorfl-item-dispatch.yml -R "$REPO" --ref "$DEFAULT_BRANCH" -f item=... -f slot=...` over `needs.enumerate.outputs.items`, with every value passed through `env:`. It forwards `integrationMode` and the four gate overrides of the tick. For each item it prints the item, its slot, and whether it was dispatched or skipped. The `advance-propose` / `advance-merge` matrix jobs disappear.
- **No duplicate runs across ticks.** A tick now ends as soon as it has dispatched, so the next tick can come while earlier item runs still wait in a slot. Before dispatching, the `dispatch` job lists the `dorfl-item-dispatch.yml` runs whose status is not `completed` (`gh run list --workflow dorfl-item-dispatch.yml --json displayTitle,status`) and skips any item whose `dorfl-item <item>` run is queued, pending or in progress. A duplicate that still slips through (a race between two ticks) is harmless: its lock job re-classifies at the fresh arbiter tip, so an item that already advanced is a no-op or a lost lock, and it exits without writing.
- **Parallelism cap:** each dispatched run joins the concurrency group `dorfl-slot-<slot>` (slot = item index mod `maxParallel`) with `queue: max`, so at most `maxParallel` item runs execute at once and the rest wait first-in-first-out (measured). A slot holds at most 100 pending runs; beyond that GitHub cancels, and the next tick re-dispatches because the items are still eligible.
- **Gate overrides reach every job.** The four one-shot overrides (`autoBuild`, `autoTask`, `observationTriage`, `surfaceBlockers`) are inputs of both new workflows and are exported in the lock, agent and apply jobs with the same line-break guard as today's step. The lock job validates each as its enum (blank means no override), because the gate family decides the rung.
- **Inputs are validated.** `integrationMode` is a `choice` input (GitHub rejects other values on dispatch) and the lock phase refuses anything but `propose` / `merge` again, since the `workflow_call` path is a free string. `slot` is required with a default, so a manual dispatch cannot produce an empty group name.
- **The agent job keeps `--watch`,** so the job log still streams the agent's turns as today's legs do.
- `enumerate` drops to `contents: read`. `reap-merged-branches` keeps `contents: write` and `close-job` keeps `issues: write`; neither runs an agent, and both move to `dorfl-setup role=writer` (today they install the harness, write `models.json` and run the project-setup hook while holding a write scope). `verify` is unchanged.
- Every checkout uses `fetch-depth: 0`: the apply job needs full history for `merge-base --is-ancestor`, the bundle's `^baseSha` prerequisite and the rebase. The local composite action resolves only after a checkout, so checkout is always the first step.
- All three jobs run on GitHub-hosted runners (`ubuntu-latest`). The design assumes each job gets a fresh machine; on a non-ephemeral self-hosted runner, files and processes an agent planted would survive into a later lock or apply job. The workflow guard enforces the hosted label for generated workflows, and `docs/ci/README.md` states that self-hosted runners must be ephemeral (one job per machine) before these workflows may use them.
- No generated job restores an Actions cache, agent jobs included: neither setup role uses `setup-node` / `pnpm/action-setup` caching or an `actions/cache` step. An agent can write default-branch cache entries through its runtime token, so a restore in a write job would run its code with write access, and a restore in another item's agent job would let it steer that item's handoff (ADR `ci-agent-job-holds-no-write-token`, trust model).
- Every value still reaches a `run:` script through `env:` (the no-`${{ }}`-in-`run:` rule), including every `needs.lock.outputs.*` value.
- Secrets: the provider key(s) go to the agent job only; `DORFL_GH_TOKEN` and the write-scoped `GITHUB_TOKEN` go to lock and apply only; the agent job gets `GITHUB_TOKEN`, which its job `permissions` make read-only.
- `timeout-minutes`: the LOCK job computes the agent timeout as today's `agentDeadlineMinutes + checkpointHeadroomMinutes`, read from `dorfl.json` at `baseSha` (trusted, and the same for advance and intake, so no caller passes a timeout), and publishes it as the `agentTimeoutMinutes` output; the agent job reads it with `fromJSON(needs.lock.outputs.agentTimeoutMinutes)`, and the apply job receives it through `env:` for its timeout check (decision 5). `enumerate` no longer computes a timeout. Lock and apply get fixed bounds: 15 and 30 minutes.
- The per-issue `concurrency` group of `intake.yml` and the per-ref group of `advance-lifecycle.yml` stay on those workflows.
- `download-artifact` in the apply job is called without `run-id`, so it reads only its own run's artifacts; the name is `needs.lock.outputs.handoffName`.

#### 9. Setup for the write jobs (no repository code)

The composite `dorfl-setup` action gains a role (or a sibling action). `role: writer` installs Node and dorfl only: no harness, no provider key, no `models.json`, no project-setup hook, no install of the project's dependencies. The dorfl install runs from `$RUNNER_TEMP`, outside the checkout, with `--ignore-scripts`, so a repository `.npmrc` cannot redirect the registry. `role: agent` is today's action. `reap-merged-branches` and `close-job` use `role: writer` too. In workspace mode see decision 8. The local composite action itself is read from the checked-out `main`, which the `.github/` rule keeps agents from changing through CI.

#### 10. Tokens per job

| job | `GITHUB_TOKEN` scope | persisted credential | other secrets |
| --- | --- | --- | --- |
| lock | `contents`, `issues`, `pull-requests`: write | allowed (no agent) | `DORFL_GH_TOKEN` if set |
| agent | `contents: read`, `issues: read` | `persist-credentials: false` | provider API key(s) only |
| apply | `contents`, `issues`, `pull-requests`: write; `actions`, `checks`: read | allowed (no agent) | `DORFL_GH_TOKEN` if set |

In the agent job, dorfl's own git fetches (the final rebase onto `<arbiter>/main`, the kept branch, the merge action's clone) use the read token through per-command `GIT_CONFIG_COUNT` / `http.extraheader`, which `scrubAgentEnv` already removes from the agent's environment. The agent can still read that token from `/proc`; it only reads. On a public repository the token is still needed for `gh issue view` rate limits. No `id-token` permission anywhere in the agent job.

#### 12. Costs and constraints

- **Two extra jobs per item**, each with a checkout and a dorfl setup (about one to two minutes each), and more queue latency between phases. The lock job runs even for items that turn out to be no-ops. On top of that, each tick adds one `dispatch` job, and each item run pays GitHub's per-run scheduling overhead plus the time it waits in its slot. Runner minutes roughly double for short rungs (surface, triage) and grow little for builds.
- **New pinned actions:** `actions/upload-artifact` and `actions/download-artifact` join `ACTION_PINS` in `install-ci-action-pins.ts`, each pinned to a full 40-character commit SHA resolved and recorded by the procedure that file's header describes (peeled tag, cross-checked with `gh api`), in the Dependabot format, and covered by the existing pin-preservation logic and `install-ci-actions-pinned.test.ts`.
- **No `${{ }}` inside `run:`** in any new job; the existing `install-ci-no-expression-in-run.test.ts` covers the new files automatically once the generators emit them.
- **The agent job still needs a read token on private repositories** (this task), and the agent can read it.
- **One workflow run per item** (decision 1): the Actions list shows one `dorfl-item` run per item per tick instead of one run with a matrix; the tick's summary lives in the `dispatch` job's log (it prints the item, its slot, and dispatched or skipped for each; `gh workflow run` does not reliably return the new run's id, so the log links runs by their `dorfl-item <item>` run name). The `dispatch` job holds `actions: write` and runs no checkout, no setup and no agent. Runs waiting in a slot's queue consume no runner minutes. A slot queues at most 100 runs; overflow is cancelled and re-dispatched by the next tick.
- Job outputs are limited in size (1 MB per job), so the lock job outputs only small facts; the list of comment ids for intake is the largest (bounded by the thread).
- Reusable workflows: the caller must grant the union of permissions; secrets are passed explicitly (never `secrets: inherit`), so `DORFL_GH_TOKEN` cannot reach the agent job by default.
- ADR `docs/adr/ci-agent-job-holds-no-write-token.md` already records the decision; do not write a second one.

1. **Workflow guard (new).** Parse every workflow and composite action the generators emit, for every config shape, plus the repository's own checked-in `.github/workflows`. For each job, resolve the effective token scope (job `permissions`, else workflow `permissions`, else "repository default", which counts as write; `write-all` counts as write; for a called workflow, also cap by the caller) and the checkout's `persist-credentials`. Fail when a step runs an agent-spawning `dorfl` verb (a NEW exported `AGENT_SPAWNING_VERBS` set, a deliverable of this spec; nothing by that name exists today) without `--phase lock` / `--phase apply` in a job whose checkout persists credentials or whose token has any `write` scope. Also fail when a `--phase lock|apply` job receives a provider API key, and when an agent job references any secret other than the provider key(s) and `GITHUB_TOKEN`. Also fail when a generated workflow runs an agent-spawning verb inside a `strategy.matrix` job or calls `dorfl-item.yml` or `dorfl-item-dispatch.yml` from a matrix (one item per run, decision 1), when ANY generated job restores an Actions cache, when a job holding `actions: write` has a checkout or a setup step, when `dorfl-item.yml` declares a workflow-level `concurrency`, and when a lock, agent or apply job does not run on a GitHub-hosted label. The every-verb-is-classified unit test already exists from task `ci-split-phase-mode-and-guards`; reuse its `AGENT_SPAWNING_VERBS`, do not write a second one.
5. **Red first.** The workflow guard (the part this task owns; the hostile-artifact tests belong to task `ci-split-apply-rejects-hostile-bundle`) and the hostile-artifact tests must be run against the current code first and the failures quoted in the builder's final report: the workflow guard must list today's `intake` job and the `advance-propose` / `advance-merge` jobs by name (a meaningful red, not a crash); the hostile-artifact tests fail because no apply phase exists, and each must then go green for the stated reason, not by accident.

> FORWARD-POINTER (conductor, collected from the Gate-3 reviews of every task this one depends on; these are the contracts the landed code actually exposes, read them in `src/` before generating):
>
> 1. **Lock outputs transport:** the lock phase writes its facts to `$GITHUB_OUTPUT` itself (`emitLockOutputs`, `ci-lock-outputs.ts`); the agent and apply jobs read them back from ONE env var, `DORFL_LOCK_OUTPUTS`, set to `${{ toJSON(needs.lock.outputs) }}` through `env:` (empty strings mean unset; `parseLockOutputs` re-validates every value). Do not invent per-key flags.
> 2. **Phase CLI surface:** agent `--phase agent --handoff-out <dir>`; apply `--phase apply --handoff-in <dir> --agent-result <needs.agent.result> --agent-timeout-minutes <needs.lock.outputs.agentTimeoutMinutes>` (`--agent-result` is REQUIRED; its absence is a usage error). The handoff dir must be under `$RUNNER_TEMP`. The apply job's timeout check reads the Actions API with `GITHUB_TOKEN` only, plus the default `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_API_URL`, and finds the agent job by the name suffix ` / agent` (keep the agent job's id `agent`). `advance --phase` routes build / tasking / tree-less from the lock job's `rung` output, so ONE `dorfl advance "$ITEM" --phase <p>` line per job serves every rung; intake uses `dorfl intake <N> --phase <p>`.
> 3. **`verify` is exempt from the guard's single-job rule** (decided with the human 2026-09-27, task `ci-split-warn-single-job-workflows`): it is in `AGENT_SPAWNING_VERBS` (it runs repository code) but launches no agent, and `verify.yml` persists a `contents: read` credential on private repos; reuse `SINGLE_JOB_WARNING_EXEMPT_VERBS` from `single-job-warning.ts` rather than a second list, and test that today's `verify.yml` passes the guard.
> 4. **`seenCommentIds` are GitHub node ids (`IC_...`)**, not integers (`ci-split-intake` Decisions); the intake lock derives origin trust from `$GITHUB_EVENT_PATH` (comment association, else issue association) unless `--origin-trust` is passed.
> 5. **Pin the lifecycle push trigger to the default branch:** add `branches: [main]` (the default branch) under `advance-lifecycle.yml`'s `push:` in the template and the regenerated file, with a template test. Observation `advance-lifecycle-push-trigger-lands-an-unreviewed-work-branch-on-main`: today a work-branch push touching `work/questions/**` runs the lifecycle on that branch and its tree-less publish landed an unreviewed branch on `main` (this repo, 2026-09-27). The tree-less apply phase now refuses such a publish (`checkTreelessPublishScope`), but the trigger itself must not fire off `main`.
> 6. **LFS:** the agent job checks out with `lfs: true` and runs `git lfs install --local` (`ci-split-handoff-lfs-objects` left both to this task).
> 7. The RED FIRST run for the guard must name today's `intake`, `advance-propose` and `advance-merge` jobs (a meaningful red, not a crash), as the criteria say; quote it.

## Acceptance criteria

- [ ] WORKFLOW GUARD (new), per the reference: every generated file for every config shape plus this repository's checked-in `.github/workflows`; fails on an agent-spawning verb without `--phase lock|apply` in a job whose checkout persists credentials or whose token has any write scope; on a provider key in a lock or apply job; on an agent job referencing a secret other than the provider key(s) and `GITHUB_TOKEN`; on agents in a matrix; on any cache restore; on `actions: write` in a job with a checkout or setup; on a workflow-level `concurrency` in `dorfl-item.yml`; on a lock/agent/apply job without a GitHub-hosted label.
- [ ] RED FIRST: the guard is run against the currently generated workflows before the generator change, and the report quotes it naming today's `intake` job and the `advance-propose` / `advance-merge` jobs.
- [ ] A template test asserts the four gate overrides are inputs of both new workflows, forwarded by `dispatch`, and exported in the lock, agent and apply jobs; and that `dispatch` skips an item with a non-completed `dorfl-item <item>` run (with `gh` stubbed).
- [ ] The existing template, pin and no-`${{ }}`-in-`run:` tests pass over the new files; the pin tests cover the two new actions.
- [ ] The acceptance gate is green.
- [ ] Job wiring, asserted by template tests over the generated files: every workflow has `permissions: {}` at workflow level; lock grants exactly `contents`, `issues`, `pull-requests: write`; apply grants those plus `actions: read` and `checks: read` (to tell a timed-out agent job from a cancelled one, decision 5); the agent job grants exactly `contents: read` and `issues: read` and checks out with `persist-credentials: false`, `fetch-depth: 0`, `lfs: true` at `needs.lock.outputs.baseSha`; the agent job's setup runs `git lfs install --local`; apply has `needs: [lock, agent]` and `if: always() && needs.lock.outputs.acquired == 'true'`; the agent job is skipped when `needsAgent` is false; `upload-artifact` uses `retention-days: 1`; `download-artifact` has no `run-id`; the lock job fetches the arbiter tip and outputs it as `baseSha`.
- [ ] In workspace install mode (this repository), all three jobs build dorfl from the same base sha, and the generated workflow carries a comment saying that in merge mode this runs code an earlier agent landed on `main` inside the write jobs (decision 8).
- [ ] This repository's regenerated `.github/workflows` and composite action pass the workflow guard and the existing workflow tests.
- [ ] The calling jobs in `dorfl-item-dispatch.yml` and `intake.yml` grant every scope any job of `dorfl-item.yml` requests (`contents`, `issues`, `pull-requests: write`; `actions`, `checks: read`), asserted by a template test; and the workflow guard fails when a job of a called workflow requests a scope its caller does not grant.

## Blocked by

- `ci-split-build-path`
- `ci-split-build-path-non-integrate-intents`
- `ci-split-agent-result-and-reruns`
- `ci-split-landed-vs-gated-report`
- `ci-split-intake`
- `ci-split-tasking`
- `ci-split-treeless-rungs`
- `ci-split-answered-merge-action`
- `ci-split-handoff-lfs-objects`
- `release-workflow-restores-no-cache`

## Prompt

> Update dorfl's CI generators (`install-ci-core.ts`, the `*-template.ts` generators, `install-ci-action-pins.ts`, `docs/ci/advance-loop.yml.template`, `advance-ci-template.ts`'s validator) to emit the split workflows described in the reference, add the workflow guard test (red first), and regenerate this repository's own `.github/` with the new generator in the same change. Build it locally: CI refuses `.github/` changes.
>
> Background: spec `ci-agent-job-without-write-token` (now in `work/specs/tasked/`) and ADR `docs/adr/ci-agent-job-holds-no-write-token.md`, whose numbered decisions 1 to 12 are cited below as "decision N". The goal: make it structurally impossible for a CI agent (an agent with a shell that any GitHub user can prompt-inject through `intake`) to use a repository write credential. Every CI item runs as three jobs: **lock** (write token, no agent, no repository code), **agent** (read-only token, `persist-credentials: false`), **apply** (write token, no agent, no repository code, treats the agent's handoff as hostile). Evidence for the one-run-per-item shape: `work/notes/findings/github-actions-job-output-key-and-per-run-artifact-isolation.md`.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If a dependency landed differently than this task assumes, or an ADR superseded an assumption here, do NOT build on the stale premise: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal"). Building on a stale task produces wrong-but-compiling work.
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md` for what that block is and is not; if a choice meets the ADR gate in `ADR-FORMAT.md`, also write an ADR in `docs/adr/` and name it there). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Writer role is a sibling action, not a `role:` input on `dorfl-setup`.** The project-setup hook is an opaque fragment spliced first into `dorfl-setup` (ADR `install-ci-project-provisioning-native-passthrough`). A composite action can't skip an opaque block of steps based on an input. So `dorfl-setup` stays the agent role unchanged, and `.github/actions/dorfl-setup-writer` is the writer role. The alternatives were moving the hook into a nested action, which contradicts that ADR, or rewriting the `if:` of the user's opaque steps. Spec §9 allows "or a sibling action". This touches task `ci-split-docs-drift-and-rollout`, whose upgrade notes say "roles".
- **The lock job in workspace mode builds from a pre-fetched arbiter tip.** The lock job can't know `baseSha` before dorfl runs, so it fetches `origin/main`, builds dorfl from that sha via `git archive` into `$RUNNER_TEMP`, and prints a warning if the published `baseSha` differs. The agent and apply jobs build from `baseSha`. So "all three jobs build from the same base sha" holds except when `main` moves during the lock job's setup; that race is reported, not blocked. Making it strict would need a dorfl flag to pass the base in, which is outside this task. Failing the lock job on a mismatch was rejected because it would send items to needs-attention whenever `main` moved.
- **`intake.yml` does not pass `DORFL_GH_TOKEN`.** This keeps intake's writes under the built-in token, as before the split. The advance dispatch wrapper does pass it. This is a user-visible identity choice for intake PRs and comments.
- **The item decides the verb.** `issue:<N>` means intake; anything else means `advance --<integrationMode>`. `integrationMode` is optional in `workflow_call` (default `propose`) and is checked in every phase script. The scripts also refuse an empty item or one starting with `-`.
- **Every job runs the same gate-override step.** Lock, agent, apply and `enumerate` all use one step that refuses line breaks and checks each override against its allowed values. The spec only asked for the value check in the lock job.
- **The per-item workflows come from a new capability.** A self-registering `dorfl-item` capability emits `dorfl-item.yml` and `dorfl-item-dispatch.yml` rather than the lifecycle and intake capabilities each emitting them, which would have written the files twice.
- **`dispatch` targets `github.event.repository.default_branch || 'main'`.** A scheduled run's event may not carry `repository`.
- **The guard is test code.** It lives in `test/helpers/workflow-guard.ts`, not `src/`. It reuses `AGENT_SPAWNING_VERBS` and `SINGLE_JOB_WARNING_EXEMPT_VERBS` rather than defining its own lists. For this repository's checked-in files, it treats the inputs of the checked-in `dorfl-setup` action as the provider keys.
