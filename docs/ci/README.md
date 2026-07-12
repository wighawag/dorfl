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

2. Provide the `dorfl-setup` composite action the template references at
   `.github/actions/dorfl-setup` (installs Node + `dorfl` + the
   agent harness, configures git identity + provider auth). Its auth/secrets shape
   is the separate `runner-in-ci` spec's concern — this template only assumes such a
   setup step exists and INVOKES the driver.

3. Pick the integration mode with the `workflow_dispatch` `integrationMode` input
   (default `propose`). This ONE value drives BOTH the job shape AND the
   integration flag passed to `advance`, so they can never disagree:
   - `propose` (default) → a **matrix** of independent jobs, each leg
     `advance <item> --propose`, one PR per item;
   - `merge` → a **single sequential** job `advance -n <x> --merge` (rebase-chains
     to `main`).

   The `--propose`/`--merge` flag sits at the TOP of `advance`'s precedence chain
   (flag > per-repo `.dorfl.json` `integration` > global > default), so the
   workflow mode always wins over a repo's config default. (You may still pin
   `integration` in `.dorfl.json` as the default for un-dispatched runs, but
   the workflow leg always passes the explicit flag matching its shape.)

## The two CI shapes (US #27)

| `integrationMode` | shape                                                                  | `advance` invocation         | why                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propose`         | a MATRIX of independent jobs                                           | `advance <item> --propose`   | propose-mode items are independent PRs → true parallelism, one PR per item.                                                                                                                                                                                                                          |
| `merge`           | a MATRIX of independent jobs (parallel build/gate/review; LAND serialised by the engine) | `advance <item> --merge` | merge-mode items land on `main` via rebase (ADR §10). Build/gate/review fan out per item; the cross-job land tail is serialised by the engine's `mergeRetries` CAS-retry loop — the git-alone floor — NOT by this workflow's job shape (per SPEC `land-time-reverify-and-parallel-merge-ceiling`). |

**One word, one meaning.** The dispatch input is `integrationMode` — the SAME
vocabulary as `.dorfl.json`'s `integration` and `advance --propose`/
`--merge`. It is NOT a separate "job-shape" knob: the shape is DERIVED from the
mode, and the SAME value is passed to `advance` as `--propose`/`--merge`. So the
shape the legs run in and the integration mode they actually use can never desync
(the dangerous case the prior attempt missed: `propose` shape, parallel matrix, but
every leg silently merging to `main` because the repo config defaulted to `merge`).

Both modes enumerate their items via the **mirror-side eligible-pool scan**
(`dorfl scan --json`, the hub-mirror enumeration the loop driver also
consumes), so CI fans out over exactly the eligible pool. Each propose leg passes
`--propose`, so a propose leg can NEVER merge to `main`; each merge leg passes
`--merge`, so its integration mode is tied to its job shape just as tightly. The
legs run the existing `advance <item>` driver (no `-n` in either shape —
parallelism comes from the matrix itself).

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
- **`mergeRetries`** (cross-job, the CAS-retry loop): a non-fast-forward push
  triggers re-rebase + re-gate + retry up to the resolved cap — never a
  `--force`, never a both-land-broken merge. Across runners this CAS loop IS the
  queue: losers re-rebase and re-gate, the winner lands; the LAST land's
  fresh-worktree gate ran on the current `main` tip.
- **`mergeRetries` is gate-family-resolved** (`merge-retries-gate-precedence`):
  flag > env > per-repo > global > default. A wide CI matrix can raise the cap
  without redeploying.

So concurrent merge legs in CI are LAND-SAFE: there is no scenario in which two
green, rebased trees both land semantically-broken, and no scenario in which the
runner is driven to `--force`. The throughput cost of a wide burst is bounded by
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
> stays. The merge JOB carries no `concurrency:` of its own — a host-specific
> serialiser there would be load-bearing for cross-job land safety, breaking
> the git-alone floor framing. A maintainer who wants the host accelerator on a
> GitHub arbiter may add one locally; it is intentionally not part of the
> shipped template.

### Matrix enumeration scope

`dorfl scan --json` reports eligible **tasks** from BOTH the hub-mirror
queue (`repos[].items[]`) AND the in-place working checkout (`cwd.repo.items[]`);
the enumeration unions both pools, because CI runs in-place (a fresh runner has no
registered mirror, so the eligible tasks live in `cwd.repo.items[]`). So the
propose **matrix** fans out over eligible tasks — one PR per task. Taskable **specs** (the `do spec:`/tasking rung) are advanced via
the **sequential** path instead: the `merge` job's `advance -n <x>` covers both
pools (it drives the full eligible set sequentially), or you dispatch a named
`advance spec:<slug>`. This keeps the matrix to genuinely-independent PRs and does
NOT mint a new mirror-pool JSON CLI surface (that enumeration lives in
`scanMirrorPool`, consumed by the loop driver; exposing it as a CLI is a separate
concern, not this template's).

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
- **on-answer-committed** — a push touching `work/questions/**` (a freshly-answered
  question sidecar) re-runs the loop so the answer is applied promptly.
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
  propose-matrix / merge-sequential split). It is validated by shipped code
  (`src/advance-ci-template.ts` + `test/advance-ci-template.test.ts`), so its
  structure is a contract, not a sketch.
- **`runner-in-ci`'s `install-ci`** will, when built, **EMIT this template**
  (parameterised with the auth/setup block) as its advance-loop capability,
  rather than hand-rolling a second advance workflow. Editing the workflow shape
  here is therefore the way to change what `install-ci` emits for that capability.

Until `install-ci` lands, adopt the advance loop by the manual copy at the top of
this doc.
