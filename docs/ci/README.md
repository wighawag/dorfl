# CI integration for the `advance` loop (the `install-ci` notion)

This directory holds the **GitHub Actions workflow TEMPLATE** that wires the
`advance` loop into CI: "on cron / on-answer-committed, run the right shape"
(spec `advance-loop`, US #27/28). It is the lightweight, advance-loop-specific CI
deliverable: CI adoption is **one step** and is **not entangled with the tick**
(the workflow only INVOKES the existing `advance` driver).

> **This template is the advance-loop CAPABILITY, not the whole CI story.** The
> unified, per-capability `install-ci` CLI (auth/secrets wizard, GitHub adapter,
> issue intake, the close-job, the gc sweep, and this advance loop, each
> independently selectable) is owned by the separate **`runner-in-ci`** spec
> (`work/specs/tasked/runner-in-ci.md`). That command will EMIT this very template as its
> advance-loop capability. Until then, copy this template by hand (below). See
> "Relationship to the `install-ci` CLI" at the bottom.

## One-step adoption

`install-ci` here is a **documented template copy**, not a CLI subcommand
(rationale below). To opt a repo into the CI advance loop:

1. Copy [`advance-loop.yml.template`](./advance-loop.yml.template) to
   `.github/workflows/advance-loop.yml` in the target repo:

   ```sh
   cp docs/ci/advance-loop.yml.template .github/workflows/advance-loop.yml
   ```

2. Provide the files the template calls, which `dorfl install-ci` generates: the
   per-item workflows `.github/workflows/dorfl-item-dispatch.yml` and
   `.github/workflows/dorfl-item.yml`, the agent-role setup action
   `.github/actions/dorfl-setup` (installs Node + `dorfl` + the agent harness,
   configures git identity + provider auth, runs your project-setup hook) and the
   writer-role setup action `.github/actions/dorfl-setup-writer` (Node + `dorfl`
   only). Their auth/secrets shape is the separate `runner-in-ci` spec's concern;
   this template only assumes they exist and INVOKES the driver (see "The three-job
   shape" below). (If the repo pins its dorfl via
   **`dorflCmd`** in `dorfl.json`, CI's bare `dorfl` self-forwards to that pin by the
   same mechanism the laptop uses, so CI and local run the same version — see
   [`docs/dorfl-cmd/README.md`](../dorfl-cmd/README.md). The writer-role jobs are
   the exception: `dorfl-setup-writer` sets `DORFL_NO_FORWARD=1`, because it never
   installs the dependencies a `dorflCmd` like `node_modules/.bin/dorfl` points
   into, so those jobs run the dorfl version `install-ci` pinned.)

3. Pick the integration mode with the `workflow_dispatch` `integrationMode` input
   (default `propose`). This ONE value drives BOTH the job shape AND the
   integration flag passed to `advance`, so they can never disagree:
   - `propose` (default) → one workflow run per item, each
     `advance <item> --propose`, one PR per item;
   - `merge` → one workflow run per item, each `advance <item> --merge`
     (each item lands on `main` by rebase + compare-and-swap push).

   The `--propose`/`--merge` flag sits at the TOP of `advance`'s precedence chain
   (flag > per-repo `dorfl.json` `integration` > global > default), so the
   workflow mode always wins over a repo's config default. (You may still pin
   `integration` in `dorfl.json` as the default for un-dispatched runs, but
   the workflow leg always passes the explicit flag matching its shape.)

## The three-job shape: the agent job holds no write token

Every CI item (an advance item, or an issue for `intake`) runs as three jobs in `dorfl-item.yml`, in a workflow run of its own (ADR `ci-agent-job-holds-no-write-token`):

| job     | token                                                        | runs                                                                                                                                                                  |
| ------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lock`  | write (`contents`, `issues`, `pull-requests`), no agent      | classifies the item at the arbiter's current `main`, takes its locks and publishes trusted facts (the base sha, the rung, whether an agent is needed) as job outputs. |
| `agent` | read-only, `persist-credentials: false`, the provider key    | the agents, the acceptance gate and the Gate-2 review, exactly as before; it stops at the first write and uploads a handoff artifact instead of pushing.             |
| `apply` | write, plus `actions: read` and `checks: read`, no agent     | `if: always()`: treats the handoff as hostile, validates it against the lock job's outputs, then does every write (land, PR, comment, needs-attention, lock release). |

**Why.** The `intake` workflow runs an agent with a shell over issue text any GitHub user can write, so a prompt injection is expected, not hypothetical. Removing tokens from the agent's environment was only a first layer: an agent that shares a job with a write token can still reach it through the credential `actions/checkout` persists in `.git/config`, its parent processes' environment, or `sudo` on a hosted runner. A hardening of the single job was built and dropped because every review found another way through. So the agent now runs in a job whose token cannot write, and the jobs that can write run no agent and no repository code (the writer-role setup action installs Node and dorfl only: no harness, no provider key, no project-setup hook, no dependency install, no cache). The agent keeps every tool, including its shell. The provider key and the read token can still be read by the agent; neither can write. On a laptop nothing changes: there is one process and no `--phase`.

The lock job skips the agent job when the item needs none (an answered question with nothing to build, an observation with nothing to ask, an intake triage skip). The apply job acts on the agent job's result first: `failure` or a timeout surfaces the item to needs-attention, a real cancel only releases the lock, and for intake every non-success only removes the `processing` label.

### One run per item, and the slot cap

All jobs of one workflow run share one artifact namespace, and an agent with a shell can recover its job's `ACTIONS_RUNTIME_TOKEN`, so inside a matrix one item's agent could plant another item's handoff. The advance tick therefore no longer uses a matrix: `advance-lifecycle.yml` runs no agent, its `enumerate` job (`contents: read`) lists the eligible items, and its `dispatch` job (`actions: write` only, no checkout, no setup) starts one `dorfl-item-dispatch.yml` run per item with `gh workflow run`. That run calls `dorfl-item.yml`, so "this artifact came from this item's agent job" is enforced by GitHub, with no key to leak. `intake.yml` already handles one issue per run and calls `dorfl-item.yml` with `item: issue:<N>`.

The old matrix `max-parallel` is now `maxParallel` concurrency slots (`install-ci --max-parallel`, default 2): item *i* joins the group `dorfl-slot-<i mod maxParallel>` with `queue: max`, so at most that many item runs execute at once and the rest wait first-in-first-out without using runner minutes. A slot holds at most 100 pending runs; beyond that GitHub cancels runs, and the next tick dispatches the item again. The tick does not dispatch an item whose `dorfl-item <item>` run has not completed yet; a duplicate that slips through a race is harmless, because its lock job re-classifies at the fresh arbiter tip.

### Protected paths: build workflow-editing tasks locally

The apply job rejects a handoff whose commits change a protected path. The list is fixed and built in (not a config key): anything under `.github/`, `CODEOWNERS` (at the root, `docs/` or `.github/`), `dorfl.json`, `.lfsconfig`, and `.gitattributes` at any depth, matched case-insensitively. A change there would let an agent rewrite the workflows, the reviewers, dorfl's own configuration or how the apply job's rebase resolves conflicts. The item goes to needs-attention with a reason that names the path and says to build the task locally: CI never lands such a change, in either mode. So a task that legitimately edits a workflow (dorfl's own repository has them) is built on a laptop (`dorfl do <task>` or `dorfl work-on <task>`), where the single-process path has no such rule and a human is at the keyboard.

The same check holds a build to its own ledger under `work/`: in merge mode the work branch may change only its own item's transition and add new `work/notes/*` files; anything else (another item's body, a new file in a pool folder, a question sidecar) is rejected. In propose mode those paths are listed in the PR body for the reviewer instead.

### Your project-setup hook must not restore an Actions cache

Your project-setup hook (`projectSetup.<provider>`, spliced first into `.github/actions/dorfl-setup`) runs in the agent job. dorfl's generated jobs never restore an Actions cache, agent jobs included, but the hook is yours: it must not restore one either. No `actions/cache` or `actions/cache/restore` step, no `cache:` input on `actions/setup-node` (or another `setup-*` action), and `package-manager-cache: false` on `actions/setup-node` v5 and later.

Why: every run on the default branch shares its cache, and any agent can write entries to it through its runtime token. If item B's agent job restores a dependency store that item A's agent poisoned, A controls B's build and handoff, and in merge mode can land code through B: exactly the cross-item substitution that one run per item removes. A hook that restores a cache anyway is your accepted risk. The cost is one uncached dependency install per agent job. The same rule applies to your own workflows' write jobs, below.

### Self-hosted runners must be ephemeral

The separation between the jobs is the machine: every job needs a fresh one. GitHub-hosted runners give that. A self-hosted runner that serves several jobs keeps the files and processes one job leaves behind, so an agent could plant a process, a git hook or a poisoned tool that a later lock or apply job, holding a write token, then runs. If you use self-hosted runners for these workflows, make them ephemeral (one job per machine, e.g. the runner's `--ephemeral` mode or an autoscaler that creates a fresh VM or container per job).

### Upgrading from single-job workflows

Re-run `dorfl install-ci` after upgrading dorfl, then commit what it writes:

- It regenerates `intake.yml` and `advance-lifecycle.yml`, adds `dorfl-item.yml` and `dorfl-item-dispatch.yml`, and adds the writer-role setup action `.github/actions/dorfl-setup-writer` next to `.github/actions/dorfl-setup` (which stays the agent role). Existing SHA pins in files it rewrites are kept, as before. The new third-party actions, `actions/upload-artifact` and `actions/download-artifact`, are pinned to full commit SHAs.
- The setup actions install `dorfl@<the version that generated them>`, so regenerated workflows always run a dorfl that understands the hidden `--phase` option.
- `DORFL_GH_TOKEN`: nothing to do. The generated workflows now pass it to the lock and apply jobs only, never to an agent job. `intake.yml` does not pass it at all: intake writes under the built-in `GITHUB_TOKEN`.
- The `advance-lifecycle` push trigger (`work/questions/**`) is now limited to `branches: [main]`. Older generated workflows fire it for any branch whose push touches a question sidecar; regenerating fixes that.
- If you copied `docs/ci/advance-loop.yml.template` by hand, copy it again: it now needs the per-item workflows and both setup actions.

An old single-job workflow with a new dorfl keeps working unchanged, but every agent-spawning verb run in it without `--phase`, in a checkout whose git config persists a credential, prints a warning that any agent it launches can read that token and that re-running `dorfl install-ci` upgrades the workflow. `dorfl verify` is exempt (it launches no agent). The next minor version turns that warning into a refusal.

What it costs: two extra jobs per item, one Actions run per item, and a `dispatch` job per tick. Runs waiting in a slot cost no runner minutes. In merge mode, expect most lands to be re-rebased after the gate ran (next section).

## The two CI modes (US #27)

| `integrationMode` | shape                                   | `advance` invocation       | why                                                                                                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propose`         | one workflow run per item               | `advance <item> --propose` | propose-mode items are independent PRs → true parallelism, one PR per item.                                                                                                                                                                                                                                     |
| `merge`           | one workflow run per item (LAND serialised by the engine) | `advance <item> --merge` | merge-mode items land on `main` via rebase (ADR §10). Build/gate/review fan out per item; the cross-run land tail is serialised by the engine's `mergeRetries` CAS-retry loop in each item's apply job (the git-alone floor), NOT by the workflow shape (per SPEC `land-time-reverify-and-parallel-merge-ceiling`). |

**One word, one meaning.** The dispatch input is `integrationMode` — the SAME
vocabulary as `dorfl.json`'s `integration` and `advance --propose`/
`--merge`. It is NOT a separate "job-shape" knob: the shape is DERIVED from the
mode, and the SAME value is passed to `advance` as `--propose`/`--merge`. So the
shape the legs run in and the integration mode they actually use can never desync
(the dangerous case the prior attempt missed: `propose` shape, parallel matrix, but
every leg silently merging to `main` because the repo config defaulted to `merge`).

Both modes enumerate their items via the **mirror-side eligible-pool scan**
(`dorfl scan --json`, the hub-mirror enumeration the loop driver also
consumes), so CI fans out over exactly the eligible pool. Each propose item run
passes `--propose`, so it can NEVER merge to `main`; each merge item run passes
`--merge`, so its integration mode is tied to the tick's just as tightly. The
item runs use the existing `advance <item>` driver (no `-n` in either mode:
parallelism comes from the per-item runs and their slots).

### Parallel-merge fan-out and the cross-job serialiser (the floor)

An earlier version of this doc said parallel merge jobs "would thrash the
main-CAS" and therefore shipped merge as a single sequential `advance -n` job.
That claim is wrong and is now retracted: the engine has been land-safe under
parallel landings for a while, and the template now matches.

The engine's actual safety story:

- **`integrateLock`** (in-process, in `integration-core.ts`/`run.ts`,
  keyed per repo): serialises ONLY the land-on-`main` TAIL within a single
  process, so build/gate/review run concurrently across siblings on the same
  runner. It is the IN-PROCESS optimisation; it does NOT span separate CI jobs.
- **`mergeRetries`** (cross-job, the CAS-retry loop, run by each item's apply
  job): a non-fast-forward push triggers a re-rebase onto the moved `main` and a
  retried push, up to the resolved cap; never a `--force`, and a textual conflict
  on the re-rebase routes to needs-attention. Across runs this CAS loop IS the
  queue: the winner lands, the losers re-rebase and retry. A lost CAS does NOT
  re-run the gate: the gate ran in the agent job, minutes before the apply job's
  first push, so with parallel item runs in merge mode `main` has usually moved
  and most lands are a re-rebase the gate never saw. The apply phase reports each
  one: its output says "`<branch>` landed without re-gate after N lost races", and
  the landed commit carries a `Landed-Without-Regate:` trailer (list them with
  `git log --format='%h %(trailers:key=Landed-Without-Regate,valueonly)' main`).
  A land that won its first push, or whose re-rebase kept the gated tree, carries
  neither. Propose mode is unaffected: a human merges the PR, and the
  repository's own required checks run on it.
- **`mergeRetries` is gate-family-resolved** (`merge-retries-gate-precedence`):
  flag > env > per-repo > global > default. A wide CI matrix can raise the cap
  without redeploying.

So concurrent merge runs in CI never `--force` and never auto-resolve a
conflict. They do not prove that the landed tree passes the gate when a race was
lost: two individually green items that break only together can both land, and
the `Landed-Without-Regate` trailer is how you find those lands. The throughput cost of a wide burst is bounded by
the cap — past the cap a loser bounces to needs-attention rather than land
incorrectly.

**Cross-job serialiser — floor, accelerator, optional host sugar (per the SPEC's
Applied Answer q1):**

- **Floor (git-alone, host-agnostic):** the scaled `mergeRetries` CAS-retry
  loop. Pure ref CAS against the arbiter; works on a bare `--bare` arbiter with
  `NoneProvider`; this is what the shipped template depends on.
- **Accelerator (portable):** an optional cross-job ref-lock (a CAS-claim on a
  `refs/dorfl/land-lock` sentinel ref) so losers QUEUE rather than burn
  retries then bounce. Tracked separately; degrades to every host. NOT shipped
  yet; the floor is correct without it.
- **Host sugar (optional):** a GitHub Actions `concurrency:` group on the
  merge job is allowed only as host-specific convenience LAYERED ON TOP of the
  floor. The shipped template deliberately does NOT include one (see the
  decision note below): if it did, removing it on a host without
  `concurrency:` would silently lose safety, which is exactly the dependency
  the floor framing forbids.

> **No `concurrency:` block on the merge job by default.** The workflow-level
> `concurrency: advance-loop-${{ github.ref }}` group (which only deduplicates
> overlapping ticks of the same shape) is unrelated to land serialisation and
> stays. The `dorfl-slot-<n>` groups on the item runs only cap how many items run
> at once; they do not serialise the land. The land carries no `concurrency:` of its own — a host-specific
> serialiser there would be load-bearing for cross-job land safety, breaking
> the git-alone floor framing. A maintainer who wants the host accelerator on a
> GitHub arbiter may add one locally; it is intentionally not part of the
> shipped template.

### Enumeration scope

`dorfl scan --json` reports eligible **tasks** and taskable **specs** from BOTH
the hub-mirror queue (`repos[].items[]`, `repos[].specs[]`) AND the in-place
working checkout (`cwd.repo.items[]`, `cwd.repo.specs[]`); the `enumerate` job
unions both pools, because CI runs in-place (a fresh runner has no registered
mirror, so the eligible items live in `cwd.repo`). It emits explicit
`task:<slug>` / `spec:<slug>` ids, and the `dispatch` job starts one item run per
id. This does NOT mint a new mirror-pool JSON CLI surface (that enumeration lives
in `scanMirrorPool`, consumed by the loop driver; exposing it as a CLI is a
separate concern, not this template's).

### Merge questions for unmerged work branches

The `surface-merge-questions` job (no agent, `contents: write` and `pull-requests: read`, `GH_TOKEN` set to the built-in `GITHUB_TOKEN` so `gh` can list the open PRs) runs `dorfl surface-merge-questions`: it fetches the arbiter and asks a merge question (a `kind: merge` sidecar entry, answered `merge | hold | drop`) for every unmerged `work/task-<slug>` branch that has no open PR, whose task rests in `tasks/ready/` or `tasks/backlog/`, whose per-item lock is free or kept by its finished propose build, and whose tip carries the done-move. An open PR is already the land decision, so on GitHub these questions are for branches whose PR was closed without merging; on a git-alone arbiter they are how a propose build lands. The questions are published to `main`. An answered `merge` is enumerated like any answered sidecar, and its item run takes over the lock the propose build kept and lands the branch (rebase, re-verify on the rebased tip, advance). The `mergeQuestions` config key gates it: `ask` (default) or `off`. `enumerate` stays read-only. The bare laptop `dorfl advance` runs the same pass before it selects. If the open PRs of a GitHub arbiter cannot be listed, the pass asks about no branch and the command exits non-zero with an `error:` line, so the job goes red instead of silently skipping every branch.

## Writing a CI-safe `verify` gate (the toolchain-boundary pitfalls)

`dorfl-setup` provisions ONLY what dorfl itself needs — Node, `dorfl`, the agent
harness, git identity, provider auth. It deliberately does **not** provision the
PROJECT's toolchain (its package manager, its own Node version, its dependency
install, rust, system packages). This is the **project-toolchain boundary**
(ADR `install-ci-project-provisioning-native-passthrough`): the boundary is
**documented, not detected** — dorfl never guesses your stack. Two concrete
consequences bite a real repo's `verify` gate if the gate is not self-sufficient,
and both fail the GitHub `verify` check while a repo's `merge`-mode work still
lands (because dorfl's own fresh-worktree merge-gate DOES run `prepare` — see
below), so they are easy to miss.

**Pitfall 1 — `dorfl verify` does NOT run `prepare`.** The standalone `dorfl
verify` command is the PURE acceptance gate: it runs your declared `verify`
command and nothing else. It does **not** run the repo's `prepare` step first
(that only runs in the runner's fresh-worktree lifecycle — `do`/`run`/`advance` →
`performIntegration`, where a fresh job worktree genuinely needs deps). So in the
GitHub `verify` job, whatever your gate assumes is installed (a package manager on
`PATH`, `node_modules/`, generated files) must be provisioned by YOU, before
`dorfl verify` runs. A gate like `pnpm build && pnpm test` dies at `pnpm: command
not found` (exit 127), or later on missing deps, if nothing installed pnpm +
ran `pnpm install` first.

**Pitfall 2 — git-history-dependent gate steps on a detached PR checkout.** A gate
step that inspects git history relative to `main` — the classic case is
`changeset status --since=main` (Changesets) — fails on a PR checkout, which is a
**detached HEAD with only `origin/main`**, no local `main` branch. Changesets
reports `Failed to find where HEAD diverged from "main"`. The gate needs a local
`main` ref (and often full history, `fetch-depth: 0`).

**The fix: provision the project toolchain via the project-setup hook.** Put your
package-manager setup + dependency install (and any history fixup) as the FIRST
steps of `dorfl-setup`, before dorfl-install. This is exactly what the `install-ci`
project-setup hook (`projectSetup.<provider>`) splices in verbatim; on GitHub it is
native Actions step YAML. A GitHub `pnpm` example:

```yaml
# in .github/actions/dorfl-setup/action.yml, FIRST under runs.steps:
- name: Setup pnpm
  uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
  with: { version: 10.28.1 }
# No Actions cache: this hook runs in the agent job (see "Your project-setup
# hook must not restore an Actions cache" above).
- name: Setup Node.js
  uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
  with: { node-version: '22', package-manager-cache: false }
- name: Install project dependencies
  shell: bash
  # --ignore-scripts: `verify` runs on fork pull requests, so without it a
  # dependency's install script runs on the runner before any gate does. Drop it
  # only if your project genuinely needs install-time scripts (see below).
  run: pnpm install --frozen-lockfile --ignore-scripts
# Pitfall 2: give `changeset status --since=main` a local main to diff against
- name: Ensure a local main branch
  shell: bash
  run: |
    git fetch origin main --quiet || true
    if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
      git branch --force main origin/main
    fi
```

(Requires the workflow's `actions/checkout` to use `fetch-depth: 0`.)

**Action pins.** Every third-party action `install-ci` emits is pinned to a full commit SHA with the version in a trailing comment (`actions/checkout@<sha> # v7.0.1`), the format Dependabot writes; pin the actions in your project-setup snippet the same way. When `install-ci` rewrites a file under `.github/` that already pins an action to a SHA (matched by `owner/repo`, not by position), it keeps your reference and its comment instead of dorfl's default, so a Dependabot bump survives regeneration. It never replaces a SHA with a tag. To let Dependabot reach the composite action, list `/.github/actions/*` in the `github-actions` entry's `directories` alongside `/`.

**Pitfall 3 — a gate step that cannot pass on the changesets Version PR.** If your
gate asserts "every changed package has a changeset" (`changeset status
--since=main`), it can NEVER be green on the changesets **Version PR**
(`changeset-release/main`), whose whole job is to CONSUME the changesets (delete
them + bump versions). Guard that one step to skip on that branch, e.g. in the
`verify` command:

```jsonc
"verify": "pnpm format:check && { [ \"$GITHUB_HEAD_REF\" = \"changeset-release/main\" ] && echo 'skip changeset status on the Version PR' || pnpm changeset status --since=main; } && pnpm build && pnpm test"
```

The guard keys on `GITHUB_HEAD_REF` (set only on `pull_request` events), so the
check still runs on every feature PR and in dorfl's own (env-var-unset) merge-gate.

**Why a `merge`-mode repo can hit these late.** With `integration: merge`, feature
work lands on `main` via dorfl's OWN fresh-worktree gate (which runs `prepare` in
a clean worktree), NOT the GitHub `verify` PR check. So the GitHub `verify` check
can be red for one of the pitfalls above while work still lands — the check only
blocks human/`propose` PRs and the Version PR's mergeability. Fix the gate anyway:
a perpetually-red required check trains everyone to ignore it.

## Security posture of the generated workflows

Everything `install-ci` emits follows four rules. Consumers are told not to hand-edit the generated files (a re-run overwrites them), so these live in the generator; re-run `dorfl install-ci` after upgrading dorfl to pick up changes.

**No `${{ }}` inside a `run:` script.** An expression in `run:` is substituted as text before the shell starts, so its value becomes part of the script (GitHub Actions script injection). Every value a step needs (the matrix item, dispatch inputs, the issue number, step outputs) is passed through the step's `env:` mapping and read back as a quoted variable, `"${VAR}"`. This matters most for the advance matrix: an item id is a slug read from `work/` (frontmatter `slug:` or the file name), and some slugs are drafted from issue content. dorfl sanitises every slug it mints (`src/slug-safety.ts`) and the slug resolvers refuse anything outside the safe set, but a hand-written slug is only checked when a verb resolves it, so the workflow must not trust it as script text either. A test parses every generated file and fails if any `run:` value contains `${{`; keep the rule when you add a project-setup hook step.

**Pinned global installs.** The composite `dorfl-setup` action installs `dorfl@<the version that generated it>`, so CI runs the same CLI that wrote its workflows, and the `pi` harness at the exact version that dorfl release declares (`PI_HARNESS_VERSION` in `install-ci-core.ts`). The harness is installed into a job-local directory from a generated `package.json` whose npm `overrides` pin every pi package it loads (`PI_HARNESS_PINNED_DEPENDENCIES`), because the harness declares them with caret ranges that float within a `0.x` minor; a `Check the agent harness loads (pi)` step then runs `pi --version` and fails setup if the install cannot start. Neither floats to `latest`: the agent job holds a provider key, and the lock and apply jobs (the writer-role `dorfl-setup-writer`, which installs the same pinned `dorfl` and no harness) hold a write token.

**Install-time scripts are the project's call.** dorfl installs none of your dependencies (the toolchain boundary above), so it cannot add `--ignore-scripts` to your install for you. The example hook above uses it because `verify` runs on fork pull requests. The tradeoff: with it, a dependency's `preinstall`/`install`/`postinstall` and your own root `prepare` do not run, so if your build relies on one (a native addon compiled at install, a `prepare` that generates code the gate needs), either run that step explicitly in the hook after the install, or drop the flag and accept that a fork PR's dependency scripts execute on the runner. Fork PR runs get a read-only token and no secrets, and `verify` has only `contents: read`, which bounds the damage but does not remove it.

**`persist-credentials: false` only on public repositories.** `install-ci` asks the provider for the repository's visibility (`gh repo view --json visibility`). When it is public, the `verify` and `close-job` checkouts set `persist-credentials: false`: both jobs have `contents: read`, so the token could only read, and on a public repo reads need no token, so nothing is lost and the token is no longer left in `.git/config` for later steps (your hook's installs, your gate) to read. When the repository is private or internal, or the visibility cannot be determined (no authenticated `gh`, `--fake` without one), the checkout keeps the token, because a `git fetch origin main` in your gate or hook needs it on a private repo. If you change the repository's visibility, re-run `install-ci`. The agent job of `dorfl-item.yml` always sets `persist-credentials: false`, whatever the visibility (dorfl passes its read token to its own git commands per command instead); the lock and apply jobs push, so they keep the token, and they run no agent.

### Your own workflows: no Actions cache in a job that can write or publish

This rule is for the workflows you write yourself, next to the ones `install-ci` generates: **in a repository where dorfl runs agents on the default branch, a workflow job that holds a write permission (`contents: write`, `pages: write`, ...) or `id-token: write` (npm trusted publishing, cloud OIDC, Pages deploy) must not restore an Actions cache.** That means no `actions/cache` or `actions/cache/restore` step, no `cache:` input on `actions/setup-node` (or the other `setup-*` actions), and `package-manager-cache: false` on `actions/setup-node` v5 and later, which otherwise turns caching on by itself from `package.json`'s `packageManager`. Count the job's `permissions`, else the workflow's; a job with neither gets the repository's default token, which may be read-write.

Why: the Actions cache is shared per branch, and entries written on the default branch are restored by every later job on it. The intake and advance agents run in default-branch jobs, and an agent with a shell can reach its job's `ACTIONS_RUNTIME_TOKEN` (from a parent process's `/proc/<pid>/environ`, or with `sudo` on a GitHub-hosted runner). dorfl strips that token from the agent's own environment, but it cannot remove it from the job, so a prompt-injected agent can write a cache entry under the key your release job looks up. The release job then restores the poisoned dependency store and runs it with your publishing identity. Moving the agent to a job without a write token does not close this, because every job gets a runtime token. The cost of the rule is one uncached dependency install per run of those jobs; read-only jobs such as `verify` may keep their cache. dorfl's own `release.yml` and `deploy-gh-pages.yml` follow it, and `packages/dorfl/test/workflows-no-cache-in-write-jobs.test.ts` fails if a cache restore comes back in a write-holding job there; you can copy that check for your repository.

## Required repository setting: let GitHub Actions create pull requests

Propose mode needs the repository setting **"Allow GitHub Actions to create and approve pull requests"** (Settings → Actions → General → Workflow permissions) to be ON. The generated workflows open their pull requests with the job's built-in `GITHUB_TOKEN` (unless you configured the optional PR-identity token), and while this setting is off GitHub refuses every pull request created with that token, so intake and propose builds open no PR. A new repository has it OFF (`gh api repos/<owner>/<repo>/actions/permissions/workflow` answers `"can_approve_pull_request_reviews": false`); an older repository may already have it on, which is why the problem can hide.

`dorfl install-ci` checks it for you, with the same posture as branch protection:

- already on: it is left alone;
- off, and your `gh` credential is repo-admin: install-ci turns it on and reports it, keeping `default_workflow_permissions` (the `GITHUB_TOKEN`'s default read/write scope) exactly as it was;
- off (or unreadable), and the credential is not admin: install-ci calls nothing and prints the exact command to run as an admin, plus the settings page. A rejected call (for example an organization policy that forbids it) is reported as FAILED with the same command to retry by hand;
- `--fake`: reports the check without calling GitHub.

The command to run yourself (pass back your current `default_workflow_permissions`, `read` on a new repository, so it is not changed):

```sh
gh api -X PUT repos/<owner>/<repo>/actions/permissions/workflow \
  -F can_approve_pull_request_reviews=true -f default_workflow_permissions=read
```

If your organization disables this setting for its repositories, the repository-level call is refused: enable it at the organization level, or configure the optional PR-identity token so the pull requests are opened by that identity instead of `GITHUB_TOKEN`.

## Pull requests opened with `GITHUB_TOKEN` wait for an approval before `verify` runs

GitHub does not start workflows freely for events created by a job's built-in `GITHUB_TOKEN`, so one workflow cannot trigger another by accident. For a pull request opened with that token (its author is `github-actions[bot]`), GitHub does create the `pull_request` runs, including `verify`, but in the state `action_required`: they wait until someone with write access approves them. Until then the PR shows `verify` as waiting, not red or green, and a branch protection that requires `verify` blocks the merge. This is GitHub's behaviour, not dorfl's, and no workflow setting turns it off.

**How to approve.** Open the pull request, go to **Files changed**, click the **Awaiting approval** button (top right), then **Approve workflows to run** in the panel it opens. Look at the diff first: approving runs your workflows on that branch. A run left unapproved for 30 days expires and is marked failed.

**Which pull requests it affects.** Only pull requests, so only `propose` mode (merge mode lands on `main` with no PR):

- **Advance pull requests (build and tasking)** are opened by the apply job with `DORFL_GH_TOKEN` when that secret is set, else with `GITHUB_TOKEN`. Set `DORFL_GH_TOKEN` (the optional PR-identity token `install-ci` offers: a personal access token or GitHub App token with `contents`, `issues` and `pull-requests` write on the repository) and these PRs are opened under that identity, so `verify` starts on its own. The trade-off: the PRs, their comments and their pushes carry that identity instead of `github-actions[bot]`, and the token is one more long-lived write credential to rotate. It reaches the lock and apply jobs only, never an agent job (see "The three-job shape" above).
- **Intake pull requests always need the approval.** `intake.yml` deliberately passes no `DORFL_GH_TOKEN` (decision recorded in task `ci-split-generate-workflows`): intake runs an agent over issue text any GitHub user can write, and its writes stay under the built-in identity. Setting `DORFL_GH_TOKEN` does not change intake; approve its `verify` run by hand. That approval is also a useful moment to read what an issue made the agent draft.

`install-ci` reminds you of this in its closing summary when it did not set `DORFL_GH_TOKEN` in that run. If you set the secret earlier (or by hand with `gh secret set DORFL_GH_TOKEN`), the reminder about advance pull requests does not apply.

## The close-job runs on every push to `main` and hourly

The generated `close-job.yml` runs `dorfl close-merged-issues`, which closes the source issue of a lone task once it is in `work/tasks/done/`, and the issue of a spec once all its tasks are done. It triggers on a `push` to `main`, so a pull request a human merges closes its issue at once. That push trigger alone is not enough: for the same reason as above, GitHub starts no workflow for a push made with a job's `GITHUB_TOKEN`, so a land the CI pushes itself (merge mode, an answered `merge` question, a tree-less publish) never starts the close-job. The workflow therefore also runs on an hourly `schedule` (the same `'0 * * * *'` cron as `advance-lifecycle`) and on `workflow_dispatch` for a manual catch-up, so such an issue closes within the hour. Repeating is safe: the command keeps no state, re-derives from `main` what is complete on every run, and skips an issue that is already closed (logged as `already closed`, with no second close or comment, and not counted in `closed N issue(s)`).

## Branch protection and the tree-less answer-loop (a required-check caveat)

The answer-loop's tree-less rungs (`surface` / `apply` / `triage-observation`) publish their ledger writes (a question sidecar, a `triaged:` marker, an applied answer) by a **direct `git push HEAD:main`** of a freshly-made commit. This is deliberate: `integrationMode` governs how CODE integrates (build/slice branches → PR or merge), it does NOT govern the question ledger, so tree-less writes go straight to `main` in BOTH modes (SPEC `ci-advance-surfaces-questions-not-only-builds`).

That direct push collides with one specific branch-protection shape: **a required status check enforced on EVERY push to `main`**. If `main`'s CLASSIC protection lists a required context (e.g. `required_status_checks.contexts: ["verify"]`), GitHub rejects the fresh tree-less commit with `GH006: Protected branch update failed ... Required status check "verify" is expected` (`protected branch hook declined`). A required check can never be green on a commit that was never PR'd/built, so the push is structurally impossible and no retry can cure it — the work stays saved in the working clone for the next pass, and the loop does not drain.

**The shape you can adopt today.** Keep the required check OUT of any per-push gate on `main`, so the tree-less loop can push direct:

- Classic protection: `strict: true` ("require branches up to date before merging") with an **empty** `checks` array, and no branch ruleset requiring a status check on `main`. Direct pushes are not gated on a check; force-push and deletion stay blocked. This is what this repo runs today.

> **A gotcha with the "put the required check in a ruleset with `do_not_enforce_on_create`" idea.** `install-ci-branch-protection.ts` was designed to keep the required `verify` check in a branch **ruleset** with `do_not_enforce_on_create: true`, on the theory that this gates PR **merges** while exempting the tree-less direct push. It does NOT work for the answer-loop: `do_not_enforce_on_create` exempts branch **creation** only, NOT **updates**. The tree-less loop **updates** `main` on every tick, so an active ruleset re-gates exactly the direct push we wanted to allow (rejected with `GH013 ... Required status check "verify" is expected`), and `enforce_admins: false` does NOT help because rulesets need explicit `bypass_actors` (an empty list bypasses no one, not even a repo admin). Provisioning that ruleset therefore BREAKS the loop rather than unblocking it. The genuinely-correct shape adds `bypass_actors` for the loop's own bot identity (and optionally repo admins), but that identity is only known at `install-ci` time (a GitHub App id, a machine-user id, or nothing for the ephemeral `GITHUB_TOKEN`), so it cannot be a static ruleset body — it is an unbuilt `install-ci` feature. Until then, adopt the no-ruleset shape above.

> **Two caveats worth knowing before you gate `main`:**
>
> 1. **A required-check rejection is now TERMINAL, not retried.** The tree-less publish (`pushTreelessResult`) distinguishes a permanent protected-branch / required-check / hook rejection (`GH006`/`GH013`, `protected branch`, `hook declined`) from a transient fast-forward race. A permanent rejection stops at the FIRST attempt with an honest note naming the protection cause — it no longer burns the whole retry ceiling on identical, unwinnable round-trips. The work is still saved locally for the next pass; it just fails fast and loud instead of spinning.
> 2. **If you genuinely want EVERY direct push to `main` gated, the answer-loop needs a different landing path.** Any per-push required check on `main` (classic `contexts` OR an active ruleset without a bot bypass actor) blocks the tree-less direct push. If your policy really is "no un-checked commit ever touches `main`," the answer-loop cannot land as-is: it needs the install-time bypass-actor feature above, a bot admin-bypass token, or an alternative publish path (per-sidecar PRs are explicitly out of scope). Weigh this before hard-gating direct pushes.

## Triggers

- **cron** — a scheduled tick drains whatever has been answered since the last run.
- **on-answer-committed** — a push to `main` touching `work/questions/**` (a
  freshly-answered question sidecar) re-runs the loop so the answer is applied
  promptly. A work-branch push never triggers it.
- **`workflow_dispatch`** — a manual catch-up/debug run, with the `integrationMode`
  input (drives both the integration flag and the job shape).

## Why a `.template` (no live self-trigger here)

The file is shipped as `advance-loop.yml.template`, NOT a live
`.github/workflows/advance-loop.yml`, **on purpose**: a live workflow committed in
the dorfl repo itself would self-trigger and loop the tool on its OWN
`work/` tree unintentionally. The `.template` suffix keeps it inert here; it only
becomes live when a consumer copies it into their own `.github/workflows/`.

## Relationship to the `install-ci` CLI (a documented copy, for now)

The `advance-loop` spec shipped this as a **documented template copy**, not a CLI
verb, on purpose:

- it is the lighter deliverable (a file + this doc, no new CLI verb, no wizard);
- the **`install-ci` CLI surface is owned by the separate `runner-in-ci` spec**
  (`work/specs/tasked/runner-in-ci.md`): a per-capability, provider-pluggable scaffolder
  (auth/secrets wizard + GitHub adapter) that wires EVERY autonomous CI rung
  (auto-build / auto-task via `do`/`advance`, the advance answer loop, issue
  `intake`, the issue close-job, and the `gc` merged-branch sweep), each
  independently selectable and independently integration-moded. Minting an
  `install-ci` CLI verb HERE would fork that broader concept.

So the division of labour is settled:

- **This directory** owns the advance-loop workflow SHAPE (the cron +
  answer-committed triggers, the `integrationMode`-drives-both discipline, the
  enumerate + one-run-per-item dispatch). It is validated by shipped code
  (`src/advance-ci-template.ts` + `test/advance-ci-template.test.ts`), so its
  structure is a contract, not a sketch.
- **`runner-in-ci`'s `install-ci`** will, when built, **EMIT this template**
  (parameterised with the auth/setup block) as its advance-loop capability,
  rather than hand-rolling a second advance workflow. Editing the workflow shape
  here is therefore the way to change what `install-ci` emits for that capability.

Until `install-ci` lands, adopt the advance loop by the manual copy at the top of
this doc.
