---
title: install-ci advance lifecycle workflow (capability C: triage / surface / apply + answer trigger)
slug: install-ci-advance-lifecycle-workflow
prd: runner-in-ci
blockedBy:
  [
    install-ci-core-and-github-adapter,
    advance-autopick-lifecycle-pools,
    observation-triage-tri-state-gate,
    surface-blockers-gate,
    run-uses-advance-tick,
  ]
covers: [1, 2, 3, 5, 6, 9]
---

## What to build

The `install-ci` capability that emits the **advance lifecycle** workflow — capability C: auto-triage observations + surface declared blockers + apply committed answers — by ABSORBING and parameterising the existing seed `docs/ci/advance-loop.yml.template` (do NOT hand-roll a second advance workflow). This is the "human is the clock" loop: CI drains the whole populated `work/` tree toward done while the human only answers committed question files on their own time.

End-to-end path:

- Emit the advance-lifecycle workflow by parameterising the EXISTING `advance-loop.yml.template` (the `advance-loop` PRD explicitly defers the unified `install-ci` surface to this PRD; this slice claims it and emits that template, not a competing workflow). Wire the shared composite setup/auth block from the core into it.
- **The absorbed template ALREADY carries capability F (merged-branch reap).** `docs/ci/advance-loop.yml.template` includes a `reap-merged-branches` job running `agent-runner gc --remote-branches --arbiter origin` on the same `schedule:` cron, plus a `REAP_MERGED_BRANCHES` dispatch input (ON by default, opt-out) — delivered by `reap-merged-remote-work-branches` (done). So emitting this template gives capability F for free: PRESERVE that job + input when parameterising; do NOT strip it, and do NOT mint a separate gc-sweep workflow (there is none — F rides this tick's schedule). The only F residue outside this template is the optional GitHub `delete_branch_on_merge` setting, owned by the core slice's wizard.
- Triggers: **cron** (scheduled drain) + **`workflow_dispatch`** (catch-up/debug) + the lifecycle-specific **`on: push work/questions/**`** trigger that re-runs the loop promptly when a question sidecar is answered. CI ALWAYS invokes `advance` (ADR `ci-config-policy-and-gate-family` §1: `advance` is a strict superset of `do`; the verb is never a user decision). The triage/surface/apply rungs + the answer trigger are exactly what `advance` adds over the plain build/slice behaviour `do` covers; with the lifecycle gates OFF the same `advance` tick degrades to that build/slice behaviour.
- The lifecycle gates govern what the tick does, via the `AGENT_RUNNER_*` env block: `AGENT_RUNNER_OBSERVATION_TRIAGE` (`off`/`ask`/`auto`, calm default `off`) for the observation INBOX, and `AGENT_RUNNER_SURFACE_BLOCKERS` (`off`/`on`, calm default `off`) for DECLARED `needsAnswers` work. These are ORTHOGONAL peers (raw inbox vs committed blocked items), both default calm, so out-of-the-box this workflow is build/slice-only and silent until the user opts in. Applying a committed answer is always allowed (no gate).
- Reuse the SAME propose=matrix / merge=sequential integration discipline as the build tick (it is a property of the integration mode, independent of which rungs the tick runs).
- IN-PLACE in the checkout, concurrency-guarded (e.g. per-ref for the advance loop), claim CAS as serialiser; explicit slug prefixes; the running CI job NEVER edits `.github/workflows/**`.
- Tested by emitting into `--fake` and structurally validating against `src/advance-ci-template.ts` (the seed's own validator), plus asserting the `push work/questions/**` trigger and the two lifecycle env vars are present.
- **File-orthogonality:** add this capability as a NEW self-registering emitter module via the core's capability-registry seam (from `install-ci-core-and-github-adapter`) — do NOT hand-edit a shared central list/switch, so this slice and the other capability workflow slices (build-tick, advance-lifecycle, intake, close-job) stay mergeable in parallel.

**Gate (agent-buildable):** this slice BUILDS a deterministic generator that parameterises an already-validated template, snapshot-tested under `--fake`; it does NOT itself land a live workflow or touch a real secret (the human runs `install-ci` and commits; US #9 forbids the CI job editing `.github/workflows/**`). The infrastructure-sensitivity is in the generated artifact at runtime, not in building this slice. So no `humanOnly` (the PRD-level flag does not propagate).

## Acceptance criteria

- [ ] `install-ci` emits the advance-lifecycle workflow by PARAMETERISING the existing `docs/ci/advance-loop.yml.template` (verified against `src/advance-ci-template.ts`), NOT a fresh hand-rolled advance workflow.
- [ ] Triggers include cron + `workflow_dispatch` + `on: push work/questions/**` (the answer-committed re-tick).
- [ ] The two lifecycle gates are surfaced in the `AGENT_RUNNER_*` env block (`AGENT_RUNNER_OBSERVATION_TRIAGE` with `off`/`ask`/`auto`; `AGENT_RUNNER_SURFACE_BLOCKERS` with `off`/`on`), both at their CALM defaults, so the out-of-the-box tick asks nothing until opted in; they are orthogonal (one can be on while the other is off).
- [ ] The propose=matrix / merge=sequential integration discipline matches the build-tick slice exactly (integration mode is verb-independent).
- [ ] The emitted template PRESERVES the existing `reap-merged-branches` job (`gc --remote-branches`) + the `REAP_MERGED_BRANCHES` dispatch input (capability F, already wired in the seed); they are not stripped, and no separate gc-sweep workflow is emitted.
- [ ] The job runs IN-PLACE, carries a concurrency group, uses explicit slug prefixes, and never edits `.github/workflows/**` (US #9).
- [ ] Tests generate into `--fake` and structurally validate the YAML (reuse `src/advance-ci-template.ts`); assert the answer trigger + both lifecycle env vars; no live Actions run, no network, stubbed `GitHubCIContext`.
- [ ] **Shared-write isolation:** `--fake` writes to `.fake/`, never a real `.github/`; tests assert the real `.github/` and any real secrets store are untouched after the run.

## Blocked by

- `install-ci-core-and-github-adapter` — the shared wizard / config / `--fake` / adapter foundation.
- `advance-autopick-lifecycle-pools` — adds the observation + `needsAnswers`-blocked pools to advance's AUTONOMOUS selection (without it the triage/surface rungs are explicit-invocation-only, so a CI/autonomous tick cannot run them; the PRD's slice-readiness notes make this a hard prerequisite for capability C). **All in `work/done/` (verified 2026-06-14).**
- `observation-triage-tri-state-gate` — the `off`/`ask`/`auto` gate governing the observation inbox pool this workflow's env block exposes.
- `surface-blockers-gate` — the `off`/`on` gate governing the declared-blocker pool.
- `run-uses-advance-tick` — unifies the autonomous tick onto the advance path the CI loop invokes.

## Prompt

> FIRST, check this slice against current reality (it is a launch snapshot and may have DRIFTED): re-read `work/prd/runner-in-ci.md` (the "do vs advance in CI" + "Config & gate model in CI" sections) and CONFIRM the five blockers are in `work/done/`: `advance-autopick-lifecycle-pools`, `observation-triage-tri-state-gate`, `surface-blockers-gate`, `run-uses-advance-tick`, and `install-ci-core-and-github-adapter`. Crucially, verify the LANDED gate names/semantics match what this slice's env block assumes (`AGENT_RUNNER_OBSERVATION_TRIAGE` = `off`/`ask`/`auto`; `AGENT_RUNNER_SURFACE_BLOCKERS` = `off`/`on`; both calm by default) — read those done slices, not just their titles. Also confirm `advance` AUTOPICK now enumerates the observation + blocked pools (the foundation `advance-autopick-lifecycle-pools` added); if it does NOT, capability C cannot run autonomously and this slice must go to `needs-attention/`. If any blocker landed differently than assumed, or an ADR superseded the gate model, do NOT build on the stale premise — route to `needs-attention/` with the discrepancy (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> GOAL: emit the advance LIFECYCLE workflow (capability C: triage observations / surface declared blockers / apply committed answers) by absorbing and parameterising the EXISTING `docs/ci/advance-loop.yml.template`. This is the "human is the clock" loop — CI drains the populated `work/` tree while the human only answers committed `work/questions/**` files.
>
> DOMAIN VOCABULARY: CI ALWAYS invokes `advance` (ADR `ci-config-policy-and-gate-family` §1: `advance` is a strict superset of `do`; the verb is never a user choice). The triage/surface/apply rungs + the `on: push work/questions/**` answer trigger are what `advance` adds over plain build/slice; with the lifecycle gates calm the same tick degrades to exactly that build/slice behaviour. The two lifecycle gates are ORTHOGONAL peers, both calm by default: `observationTriage` (`off`/`ask`/`auto`) governs the raw observation INBOX; `surfaceBlockers` (`off`/`on`) governs DECLARED `needsAnswers` work. "Groom my observations but leave my blocked work alone" (`observationTriage: ask` + `surfaceBlockers: off`) must be expressible. Applying a committed answer has NO gate. CI tunes all of this via the workflow `AGENT_RUNNER_*` env block — there is NO `autoAdvance` gate. The propose=matrix / merge=sequential discipline is identical to the build tick (integration mode is verb-independent).
>
> WHERE TO LOOK: the seed `docs/ci/advance-loop.yml.template` + `docs/ci/README.md` (this IS the advance-loop capability's output — parameterise it, do NOT fork a second advance workflow) and its validator `src/advance-ci-template.ts`. The shared core from `install-ci-core-and-github-adapter` provides the auth/setup block + the `GitHubCIContext` seam + `--fake`. The landed blockers' code/ADRs define the exact gate names and behaviour your env block must match.
>
> SEAMS TO TEST AT: generate into `--fake` with a stubbed `GitHubCIContext`; structurally validate the YAML via `src/advance-ci-template.ts`; assert the `push work/questions/**` trigger and both lifecycle env vars (with calm defaults) are present; assert no job touches `.github/workflows/**`. No live Actions run, no network.
>
> DONE means: the advance-lifecycle workflow is emitted from the parameterised seed template, the answer trigger + both calm-default lifecycle gates are wired through the env block, the integration discipline matches the build tick, and the shared-write isolation assertions pass (real `.github/` + real secrets untouched). Finish with `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green. Do NOT perform any git transitions — the runner/human owns those.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim install-ci-advance-lifecycle-workflow --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/install-ci-advance-lifecycle-workflow <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/install-ci-advance-lifecycle-workflow.md work/done/install-ci-advance-lifecycle-workflow.md
```
