---
title: runner-in-ci — run the existing engine headless in GitHub Actions (no issues)
slug: runner-in-ci
humanOnly: true
---

> **Launch snapshot, not maintained.** This PRD is the source material for slicing
> (`to-slices`); once sliced, technical detail moves into the slices and durable
> rationale into `docs/adr/`. Expect this to be outrun by the work — that is fine.

## Problem Statement

Today the autonomous runner (`run --once` / `watch`) executes on a local machine:
it needs my laptop awake, my git/agent auth in place, and me to start it. I want
the **back of the funnel** — claim eligible `work/backlog/` items, build them in
isolation, verify, integrate — to run **fully headless in CI** (GitHub Actions
first), so no local machine is needed. This is purely a packaging/execution-location
concern: it reuses the existing engine unchanged and **knows nothing about GitHub
issues**. It reads `work/backlog/` exactly as the local runner does.

This is one of three decoupled capabilities split out of a single discussion
(`runner-in-ci`, `auto-slice`, `issue-to-prd`); this one is the simplest and
highest-leverage because it reuses everything that already exists.

## Solution

Make the existing `run --once` engine runnable inside a GitHub Actions workflow,
and provide an `install-ci` command (per-capability) that scaffolds it:

- **`install-ci` (runner capability)** — generates a GitHub Actions workflow + a
  shared setup step that: installs Node + `agent-runner` + the configured agent
  harness, configures git identity, configures AI-provider auth, and runs
  `agent-runner run --once` against this repo's `work/backlog/`. Per-capability:
  flags select which capabilities' workflows are installed (here: the runner);
  it must be possible to adopt runner-in-CI without ever touching issue→PRD.
- **Auth** — mirror whitesmith's proven approach: a default **`models.json`** mode
  (one GitHub secret per provider API key, config generated inline) and an
  **`auth.json`** mode (a single `PI_AUTH_JSON` secret, plus a `GH_PAT` for OAuth
  token refresh). The setup is interactive (a wizard) with a non-interactive
  config-file path for re-use.
- **Trigger** — at minimum a manual `workflow_dispatch` (catch-up / debugging) and
  a scheduled/`workflow_dispatch` tick that runs `run --once`. The runner already
  bounds itself (claims up to `maxParallel`, then stops); CI concurrency groups
  prevent overlapping ticks.
- **Integration in CI** — the existing integration seam does the landing
  (`propose` default → opens a PR via the `github` provider; `merge` where the
  repo opts in). The CI job is just another caller of the same engine; the runner
  still owns all git-state transitions in-band.
- **Required repo settings + secrets** — document and (where possible) set them:
  "Allow GitHub Actions to create and approve pull requests", and the provider
  secrets, set automatically by the wizard.

## User Stories

1. As the maintainer, I want `agent-runner install-ci` to scaffold a GitHub
   Actions workflow that runs `run --once` headless, so that the autonomous runner
   needs no local machine.
2. As the maintainer, I want provider auth configured via GitHub secrets (a
   `models.json` mode by default, an `auth.json` mode as an option), so that the
   CI job can authenticate the agent harness without my laptop.
3. As the maintainer, I want a `workflow_dispatch` trigger for catch-up/debugging
   and a scheduled tick for normal operation, so that work gets picked up
   unattended but I can also force a run.
4. As the maintainer, I want CI concurrency guards so overlapping ticks never
   collide, relying on the existing atomic claim to serialise across runs.
5. As the maintainer, I want completed work to integrate via the existing seam
   (propose by default), so that CI runs land work exactly like the local runner.
6. As the maintainer, I want `install-ci` to be per-capability (flag-selected), so
   that I can enable runner-in-CI without enabling issue→PRD.

## Implementation Decisions

(Made with the maintainer — do not relitigate.)

- **This is execution-location, not new engine behaviour.** The CI job calls
  `run --once` (and later optionally `watch`); the engine, claim CAS, isolation,
  verify gate, and integration seam are reused unchanged. No issue awareness.
- **`install-ci` uses the seams, never `gh` directly.** Workflow generation +
  secret-setting may shell out to `gh` *as the GitHub adapter of a CI seam*, but
  the command is structured per-capability and provider-pluggable (GitHub first),
  mirroring the existing harness/integration seams.
- **Auth modes mirror whitesmith.** `models.json` (default, per-provider secret)
  and `auth.json` (single `PI_AUTH_JSON` + `GH_PAT`). This keeps parity with a
  proven setup and lets users move between the two tools' conventions.
- **The runner bounds itself; CI adds concurrency groups.** No long-lived daemon
  in CI — each tick is a bounded `run --once`. Per-repo or global concurrency
  groups prevent overlap; the claim CAS is the real serialiser.
- **Secrets/settings are documented and wizard-set where possible**, including the
  "create and approve pull requests" repo setting required for PR creation.

## Testing Decisions

- The generated workflow + setup step are **artifacts**; test by generating into a
  scratch/`--fake` directory and asserting on the produced YAML (no live Actions
  run). Mirror whitesmith's `--fake` approach.
- Stub `gh` for any secret-setting / repo-detection path (no network, no real
  GitHub). Verify the wizard's non-interactive config-file path reproduces the
  same output as the interactive one.
- The engine itself is already covered by the existing `run --once` tests; this
  slice does not re-test the engine, only the CI packaging.

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** this is CI/auth/secrets plumbing
  that lands GitHub Actions workflows and sets repository secrets — a
  security-sensitive, infrastructure-shaping change a human should drive. So the
  slicing of this PRD is human-led, and most covering slices should also be
  `humanOnly` (especially anything that writes workflows or touches secrets).
- **`needsAnswers`:** none at launch — the auth modes and trigger shape are
  decided (mirror whitesmith). If a slice surfaces an open infra question, flag it
  then.

## Out of Scope

- Any GitHub-issue awareness (that is `issue-to-prd`).
- Auto-slicing of PRDs (that is `auto-slice`).
- A long-lived CI daemon/service; ticks stay bounded.
- Non-GitHub CI providers (GitHub first; the command is seam-shaped so others can
  follow, but only GitHub is built here).

## Further Notes

- whitesmith (`~/dev/github/wighawag/whitesmith`) is the reference for the
  `install-ci` wizard, auth modes, the composite setup action, and the
  `workflow_dispatch` + scheduled trigger shape. Reuse its patterns; do **not**
  reuse its label state-machine or issue lifecycle (out of scope here).
- Slice this PRD with `to-slices`. A natural first slice is the `install-ci`
  scaffolding + auth; a second is the workflow/trigger wiring.
