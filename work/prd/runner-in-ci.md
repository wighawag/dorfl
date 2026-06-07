---
title: runner-in-ci — run the existing engine headless in GitHub Actions (no issues)
slug: runner-in-ci
humanOnly: true
---

> **Launch snapshot, not maintained.** This PRD is the source material for slicing
> (`to-slices`); once sliced, technical detail moves into the slices and durable
> rationale into `docs/adr/`. Expect this to be outrun by the work — that is fine.
>
> **RESHAPED 2026-06-05** to `docs/adr/command-surface-and-journeys.md`: **CI is
> the `do` command, NOT `run --once`.** `run` is the cross-repo, parallel laptop
> daemon (registry + hub mirrors); CI is one repo, one triggered invocation that
> exits — exactly `do` (per-repo, in-place worker). The auth/secrets/`install-ci`/
> trigger design below is unchanged; only the engine it invokes changed from
> `run --once` to `do`.

## Problem Statement

Today autonomous execution is laptop-shaped: the `run` daemon needs my laptop
awake, my git/agent auth in place, and me to start it. I want the **back of the
funnel** — claim eligible `work/backlog/` items, build them in isolation, verify,
integrate — to run **fully headless in CI** (GitHub Actions first), so no local
machine is needed. This is purely a packaging/execution-location concern: it
reuses the existing pipeline and **knows nothing about GitHub issues**.

**CI uses `do`, not `run`.** `run` is the cross-repo, parallel daemon (it scans a
registry of hub mirrors). CI is the opposite shape: ONE repo (the workflow's
repo), ONE triggered invocation that EXITS, with a checkout already present. That
is exactly `do` — the per-repo, in-place worker (claim + build in the checkout +
integrate + exit). So CI never needs the registry/hub-mirror machinery; the CI
checkout IS the isolation.

This is one of three decoupled capabilities split out of a single discussion
(`runner-in-ci`, `auto-slice`, `issue-to-prd`); this one is the simplest and
highest-leverage because it reuses everything that already exists.

## Solution

Make the **`do`** worker runnable inside a GitHub Actions workflow, and provide an
`install-ci` command (per-capability) that scaffolds it:

- **`install-ci` (runner capability)** — generates a GitHub Actions workflow + a
  shared setup step that: installs Node + `agent-runner` + the configured agent
  harness, configures git identity, configures AI-provider auth, and runs
  **`agent-runner do`** (in-place, in the checkout) against this repo's
  `work/backlog/`. `do` with no slug auto-picks eligible work; `do -n <x>` drains
  up to x in sequence; `do <slug>` / `do <prd>` target a specific item (CI can be
  parametrised with a slug/PRD). Per-capability: flags select which capabilities'
  workflows are installed (here: the runner); adopt runner-in-CI without ever
  touching issue→PRD.
- **Auth** — mirror whitesmith's proven approach: a default **`models.json`** mode
  (one GitHub secret per provider API key, config generated inline) and an
  **`auth.json`** mode (a single `PI_AUTH_JSON` secret, plus a `GH_PAT` for OAuth
  token refresh). The setup is interactive (a wizard) with a non-interactive
  config-file path for re-use.
- **Trigger** — at minimum a manual `workflow_dispatch` (catch-up / debugging,
  optionally with a slug/PRD input) and a scheduled/`workflow_dispatch` tick that
  runs `do` (auto-pick, or `-n x`). `do` bounds itself (it does its work and
  EXITS — it is not a loop); CI concurrency groups prevent overlapping ticks. The
  claim CAS is the real serialiser across runs.
- **Integration in CI** — `do --propose` (the default) opens a PR via the `github`
  provider; `--merge` where the repo opts in. `do` (the in-place worker) owns all
  git-state transitions in-band, exactly like the laptop paths. Note `do` works
  IN-PLACE in the CI checkout (no hub mirror) — the container is the isolation.
- **Required repo settings + secrets** — document and (where possible) set them:
  "Allow GitHub Actions to create and approve pull requests", and the provider
  secrets, set automatically by the wizard.

## User Stories

1. As the maintainer, I want `agent-runner install-ci` to scaffold a GitHub
   Actions workflow that runs **`agent-runner do`** (the in-place worker) headless,
   so that autonomous building needs no local machine.
2. As the maintainer, I want provider auth configured via GitHub secrets (a
   `models.json` mode by default, an `auth.json` mode as an option), so that the
   CI job can authenticate the agent harness without my laptop.
3. As the maintainer, I want a `workflow_dispatch` trigger for catch-up/debugging
   and a scheduled tick for normal operation, so that work gets picked up
   unattended but I can also force a run.
4. As the maintainer, I want CI concurrency guards so overlapping ticks never
   collide, relying on the existing atomic claim to serialise across runs.
5. As the maintainer, I want completed work to integrate via `do --propose` (the
   default), so that CI runs land work as PRs exactly like the human propose path.
6. As the maintainer, I want `install-ci` to be per-capability (flag-selected), so
   that I can enable runner-in-CI without enabling issue→PRD.

## Implementation Decisions

(Made with the maintainer — do not relitigate.)

- **This is execution-location, not new engine behaviour.** The CI job calls
  **`do`** (the per-repo in-place worker); the claim CAS, the verify gate, and the
  integration seam are reused unchanged. No issue awareness. NOT `run` — `run` is
  the cross-repo parallel daemon; CI is one repo, one invocation, exits (= `do`).
- **`do` works in-place in CI (no hub mirror).** The CI checkout IS the isolation
  (the in-place isolation strategy, `command-surface-and-journeys` §3); the
  registry/hub-mirror machinery is laptop-only and unused here.
- **Auto-slice in the CI tick:** `do` slices eligible PRDs too (`do <prd>`, or the
  auto-pick step), slices-first then PRDs (per-repo toggle) — so CI can both build
  slices and decompose ready PRDs in one invocation.
- **`install-ci` uses the seams, never `gh` directly.** Workflow generation +
  secret-setting may shell out to `gh` *as the GitHub adapter of a CI seam*, but
  the command is structured per-capability and provider-pluggable (GitHub first),
  mirroring the existing harness/integration seams.
- **Auth modes mirror whitesmith.** `models.json` (default, per-provider secret)
  and `auth.json` (single `PI_AUTH_JSON` + `GH_PAT`). This keeps parity with a
  proven setup and lets users move between the two tools' conventions.
- **`do` bounds itself; CI adds concurrency groups.** No long-lived daemon in CI —
  each invocation is a bounded `do` (it does its work and exits). Per-repo or
  global concurrency groups prevent overlap; the claim CAS is the real serialiser.
- **Secrets/settings are documented and wizard-set where possible**, including the
  "create and approve pull requests" repo setting required for PR creation.

## Testing Decisions

- The generated workflow + setup step are **artifacts**; test by generating into a
  scratch/`--fake` directory and asserting on the produced YAML (no live Actions
  run). Mirror whitesmith's `--fake` approach.
- Stub `gh` for any secret-setting / repo-detection path (no network, no real
  GitHub). Verify the wizard's non-interactive config-file path reproduces the
  same output as the interactive one.
- The build pipeline (claim/gate/integrate) is already covered by the existing
  `do`/run tests; this slice does not re-test the pipeline, only the CI packaging
  (the generated workflow + the `do` invocation it wires).

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** this is CI/auth/secrets plumbing
  that lands GitHub Actions workflows and sets repository secrets — a
  security-sensitive, infrastructure-shaping change a human should drive. **The
  PRD-level `humanOnly` does NOT propagate to the slices** (resolved 2026-06-06,
  batch-qa): it means only that a human drove the SLICING of this PRD. Each
  slice's own `humanOnly` is decided by `to-slices` from building that slice —
  NOT inherited wholesale from this PRD. (A pure deterministic generator with a
  `--fake`-snapshot test may well be agent-buildable; a workflow-writing /
  secret-touching slice will lean `humanOnly` — but that is `to-slices`' call,
  per-slice.)
- **`needsAnswers`:** none at launch — the auth modes and trigger shape are
  decided (mirror whitesmith). If a slice surfaces an open infra question, flag it
  then.

### Slice-readiness notes (resolved 2026-06-06, batch-qa)

- **The `do` engine surface is only PARTIALLY landed — slices must `blockedBy`
  the missing pieces.** Verified against the code: `do <slug>` (in-place worker,
  `--propose`/`--merge` resolved at integrate-time) IS landed and stable in
  `work/done/` (`do-in-place`). But the shapes this PRD leans on for the CI tick
  are **NOT yet wired**: auto-pick (`do` with no arg) and `do -n <x>` are the
  `do-autopick` slice (still in `work/backlog/`); `do prd:<slug>` (the slicing
  path) is marked "not yet wired" in `cli.ts`; `do --remote` is the `do-remote`
  slice (still `work/backlog/`). **CI uses the IN-PLACE form only** (the checkout
  IS the isolation), so `do-remote` is irrelevant here — but a `runner-in-ci`
  slice whose workflow invokes auto-pick / `-n` / PRD-slicing MUST carry a
  `blockedBy` on `do-autopick` (and, for the PRD-slicing-in-CI tick, on the
  relevant `auto-slice` slug). A slice that only wires `do <slug>` needs no such
  block.
- **Auto-slice-in-CI is OUT OF SCOPE for `runner-in-ci` slices** (defer). These
  slices own only the workflow scaffold + auth + the `do` invocation. "`do` also
  slices ready PRDs" is `auto-slice`/`do` behaviour owned elsewhere — a
  `runner-in-ci` slice does not BUILD it, it only (optionally) invokes it, gated
  by the `blockedBy` above. (Consistent with the existing Out-of-Scope line
  "Auto-slicing of PRDs (that is `auto-slice`)".)
- **CI DEPENDS ON the review gate, not the reverse** (dependency direction fixed
  2026-06-06, batch-qa round 2). The review gate is a property of **`do`** (the
  per-repo worker runs `verify` then the review step). CI is merely a CALLER of
  `do`, so it INHERITS the review gate by invoking `do` — it does not provide it.
  Therefore `review` must NOT `sliceAfter`/`blockedBy` `runner-in-ci` (that stale
  arrow has been dropped from `review.md`); instead, **when `runner-in-ci` is
  sliced, a slice that wants review-gated CI runs should `blockedBy` the
  review-gate slice.** For a repo configured `review: on` + `autoMerge: on`, the
  CI tick is simply `do -n <N> --merge` and the gate rides along inside `do`.

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
