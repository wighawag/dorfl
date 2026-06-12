# CI integration for the `advance` loop (the `install-ci` notion)

This directory holds the **GitHub Actions workflow TEMPLATE** that wires the
`advance` loop into CI — "on cron / on-answer-committed → run the right shape"
(PRD `advance-loop`, US #27/28). It is the lightweight `install-ci` deliverable:
CI adoption is **one step** and is **not entangled with the tick** (the workflow
only INVOKES the existing `advance` driver).

## One-step adoption

`install-ci` here is a **documented template copy**, not a CLI subcommand
(rationale below). To opt a repo into the CI advance loop:

1. Copy [`advance-loop.yml.template`](./advance-loop.yml.template) to
   `.github/workflows/advance-loop.yml` in the target repo:

   ```sh
   cp docs/ci/advance-loop.yml.template .github/workflows/advance-loop.yml
   ```

2. Provide the `agent-runner-setup` composite action the template references at
   `.github/actions/agent-runner-setup` (installs Node + `agent-runner` + the
   agent harness, configures git identity + provider auth). Its auth/secrets shape
   is the separate `runner-in-ci` PRD's concern — this template only assumes such a
   setup step exists and INVOKES the driver.

3. Pick the integration shape — either with the `workflow_dispatch` `mode` input
   or by pinning `integration` in the repo's `.agent-runner.json`:
   - `propose` (default) → a **matrix** of independent jobs, one PR per item;
   - `merge` → a **single sequential** job (rebase-chains to `main`).

## The two CI shapes (US #27)

| mode      | shape                          | why                                                                                       |
| --------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `propose` | a MATRIX of independent jobs   | propose-mode items are independent PRs → true parallelism; `-n` not even needed.          |
| `merge`   | a SINGLE SEQUENTIAL job        | merge-mode items chain via rebase (ADR §10); parallel merge jobs would thrash the main-CAS. |

The propose matrix enumerates its items via the **mirror-side eligible-pool scan**
(`agent-runner scan --json`, the hub-mirror enumeration the loop driver also
consumes), so CI fans out over exactly the eligible pool. The merge job runs the
one-shot driver `agent-runner advance -n <x>` (`-n` is ALWAYS sequential —
parallelism comes only from the propose matrix, never from `-n`).

### Matrix enumeration scope

`agent-runner scan --json` reports the hub-mirror queue as eligible **slices**
(`repos[].items[]`). So the propose **matrix** fans out over eligible slices —
one PR per slice. Sliceable **PRDs** (the `do prd:`/slice rung) are advanced via
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
- **`workflow_dispatch`** — a manual catch-up/debug run, with the `mode` input.

## Why a `.template` (no live self-trigger here)

The file is shipped as `advance-loop.yml.template`, NOT a live
`.github/workflows/advance-loop.yml`, **on purpose**: a live workflow committed in
the agent-runner repo itself would self-trigger and loop the tool on its OWN
`work/` tree unintentionally. The `.template` suffix keeps it inert here; it only
becomes live when a consumer copies it into their own `.github/workflows/`.

## Why a documented copy, not a CLI `install-ci` subcommand

The PRD calls this "the `install-ci` notion", not a hard CLI surface, and lets the
slice pick the lighter option. A documented template copy is chosen because:

- it is the lighter deliverable (a file + this doc, no new CLI verb, no wizard);
- the **`install-ci` CLI surface is already owned by the separate `runner-in-ci`
  PRD** (a per-capability scaffolder that also wires auth/secrets for the BUILD
  `do` path). Minting an `install-ci` CLI verb HERE would collide with that
  concept at a broader layer and fork it. Keeping this an advance-specific
  documented template lets `runner-in-ci` later own the unified `install-ci`
  command (which can emit this very template as its advance-loop capability)
  without this slice pre-claiming the name.
