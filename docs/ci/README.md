# CI integration for the `advance` loop (the `install-ci` notion)

This directory holds the **GitHub Actions workflow TEMPLATE** that wires the
`advance` loop into CI: "on cron / on-answer-committed, run the right shape"
(prd `advance-loop`, US #27/28). It is the lightweight, advance-loop-specific CI
deliverable: CI adoption is **one step** and is **not entangled with the tick**
(the workflow only INVOKES the existing `advance` driver).

> **This template is the advance-loop CAPABILITY, not the whole CI story.** The
> unified, per-capability `install-ci` CLI (auth/secrets wizard, GitHub adapter,
> issue intake, the close-job, the gc sweep, and this advance loop, each
> independently selectable) is owned by the separate **`runner-in-ci`** prd
> (`work/prds/tasked/runner-in-ci.md`). That command will EMIT this very template as its
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
   is the separate `runner-in-ci` prd's concern — this template only assumes such a
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

| `integrationMode` | shape                        | `advance` invocation              | why                                                                                       |
| ----------------- | ---------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `propose`         | a MATRIX of independent jobs | `advance <item> --propose`        | propose-mode items are independent PRs → true parallelism; `-n` not even needed.          |
| `merge`           | a SINGLE SEQUENTIAL job      | `advance -n <x> --merge`          | merge-mode items land on `main` via rebase (ADR §10); this template keeps merge a single sequential job today (see the note below). |

**One word, one meaning.** The dispatch input is `integrationMode` — the SAME
vocabulary as `.dorfl.json`'s `integration` and `advance --propose`/
`--merge`. It is NOT a separate "job-shape" knob: the shape is DERIVED from the
mode, and the SAME value is passed to `advance` as `--propose`/`--merge`. So the
shape the legs run in and the integration mode they actually use can never desync
(the dangerous case the prior attempt missed: `propose` shape, parallel matrix, but
every leg silently merging to `main` because the repo config defaulted to `merge`).

The propose matrix enumerates its items via the **mirror-side eligible-pool scan**
(`dorfl scan --json`, the hub-mirror enumeration the loop driver also
consumes), so CI fans out over exactly the eligible pool. Each leg passes
`--propose`, so a matrix leg can NEVER merge to `main`. The merge job runs the
one-shot driver `dorfl advance -n <x> --merge` (`-n` is ALWAYS sequential —
parallelism comes only from the propose matrix, never from `-n`); `--merge` rides
ONLY this single sequential job, so a parallel merge-to-`main` is structurally
impossible in the SHIPPED template.

> **Why a single sequential merge job (and why that is a TEMPLATE choice, not a
> hard engine limit).** An earlier rationale here said parallel merge jobs "would
> thrash the main-CAS." That is no longer accurate: the engine now serialises ONLY
> the land-on-`main` TAIL via `integrateLock` (keyed per repo, in
> `integration-core.ts`/`run.ts`) while build/gate/review run concurrently, and a
> sibling that advanced `main` during the push window is handled by `mergeRetries`
> (re-rebase + re-gate + retry, never a `--force`), not a thrash. So concurrent
> merge is land-SAFE in-process. The CI template still ships merge as a single
> sequential `advance -n` job because the in-memory `integrateLock` does not span
> SEPARATE CI jobs (cross-job landing would fall back to the CAS-retry loop alone)
> and the retry cap was sized for in-process siblings, not a wide matrix. Driving a
> parallel merge matrix in CI is the open `land-time-reverify-and-parallel-merge-ceiling`
> prd (`work/prds/tasked/land-time-reverify-and-parallel-merge-ceiling.md`); do
> NOT change the shipped shape here ahead of it.

### Matrix enumeration scope

`dorfl scan --json` reports eligible **tasks** from BOTH the hub-mirror
queue (`repos[].items[]`) AND the in-place working checkout (`cwd.repo.items[]`);
the enumeration unions both pools, because CI runs in-place (a fresh runner has no
registered mirror, so the eligible tasks live in `cwd.repo.items[]`). So the
propose **matrix** fans out over eligible tasks — one PR per task. Taskable **prds** (the `do prd:`/tasking rung) are advanced via
the **sequential** path instead: the `merge` job's `advance -n <x>` covers both
pools (it drives the full eligible set sequentially), or you dispatch a named
`advance prd:<slug>`. This keeps the matrix to genuinely-independent PRs and does
NOT mint a new mirror-pool JSON CLI surface (that enumeration lives in
`scanMirrorPool`, consumed by the loop driver; exposing it as a CLI is a separate
concern, not this template's).

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

The `advance-loop` prd shipped this as a **documented template copy**, not a CLI
verb, on purpose:

- it is the lighter deliverable (a file + this doc, no new CLI verb, no wizard);
- the **`install-ci` CLI surface is owned by the separate `runner-in-ci` prd**
  (`work/prds/tasked/runner-in-ci.md`): a per-capability, provider-pluggable scaffolder
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
