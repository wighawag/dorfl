---
title: runner-in-ci - scaffold a configurable, headless agent-runner loop in CI (GitHub Actions first)
slug: runner-in-ci
humanOnly: true
---

> **Launch snapshot, not maintained.** This PRD is the source material for slicing (`to-slices`); once sliced, technical detail moves into the slices and durable rationale into `docs/adr/`. Expect this to be outrun by the work (that is fine).
>
> **RESHAPED 2026-06-12** to reflect the command surface as BUILT (it had drifted hard from a "CI = `run --once`" → "CI = `do`" snapshot written before the engine matured). Four shifts: (1) the CI entry point is no longer a single verb (CI invokes **`do`**, **`advance`**, **`intake`**, and **`gc`**, each for a different capability/trigger); (2) an `install-ci` deliverable already EXISTS in seed form (`docs/ci/advance-loop.yml.template` + `docs/ci/README.md`), shipped by the `advance-loop` PRD, which explicitly DEFERS the unified `install-ci` surface to THIS PRD, so this PRD must ABSORB and supersede that seed, not compete with it; (3) the config surface is far bigger than the original auth-only view (gates, integration mode, review, per-outcome intake modes) and the wizard must surface it; (4) the design is re-derived from USER STORIES ("what is the ideal CI setup?") rather than from one engine verb. The whitesmith reference, the `models.json`/`auth.json` auth modes, the `--fake` snapshot testing, and the provider-pluggable seam are unchanged in spirit; they are made concrete here against whitesmith's proven `GitHubCIContext` adapter shape.

## Problem Statement

Today autonomous execution is laptop-shaped: the `run` daemon needs my laptop awake, my git/agent auth in place, and me to start it. I want the whole **back of the funnel** (claim eligible `work/` items, slice ready PRDs, triage observations and surface questions, consider incoming issues, build in isolation, verify, integrate, and reap) to run **fully headless in CI** (GitHub Actions first), so no local machine is needed.

This is primarily a **packaging/execution-location** concern: it reuses the existing engine verbs unchanged and only wires the right verb to the right CI trigger, with the right integration mode, behind the right config gates. It is NOT new engine behaviour. The one genuinely new artifact is **`install-ci`**: a per-capability, provider-pluggable scaffolder (a wizard + a non-interactive config path) that generates the workflow(s), the shared setup/composite action, and the provider secrets, mirroring whitesmith's proven shape.

## What "the ideal CI setup" looks like (the capabilities)

CI should be able to do EVERY autonomous rung, each independently enable-able and each with its own integration policy (merge directly to main vs open a PR), all driven from config. The capabilities, mapped to the verb + trigger that already implements each:

| # | Capability | Verb in CI | Natural trigger(s) | Notes |
| --- | --- | --- | --- | --- |
| A | **Auto-build ready slices** | `do` (or `advance`) | cron + dispatch | `do -n <x>` / `do <slice:slug>` drains buildable slices. `do` is enough when the human triages/answers locally. |
| B | **Auto-slice ready PRDs** | `do` (or `advance`) | cron + dispatch | `do prd:<slug>` / auto-pick slices a ready PRD into backlog slices. Same verb as (A); `do` knows both rungs. |
| C | **Auto-triage observations + surface/apply questions** | `advance` | cron + **`on: push work/questions/**`** | ONLY `advance` has these rungs (triage / surface a question file / apply a committed answer). This is the "human is the clock" loop: CI drains the tree, the human only answers question files on their own time. |
| D | **Consider incoming issues → slice/PRD** | `intake` | `issues` opened/edited, `issue_comment`, label | `intake <N>` turns an issue into the right artifact (slice / PRD / ask / bounce). Per-outcome integration modes. Carries the author-trust axis (the one open question). |
| E | **Close issues when their work lands** | a CI close-job | PR merged to main | Runs the existing "PRD complete?" query + `closeIssue` over `issue:`/`prd:` fields. The job is CI's; the query already exists (`prd-complete-query`, done). |
| F | **Reap merged work branches** | `gc` (merged-branch sweep sub-mode) | cron (+ optional GitHub auto-delete-head-branch) | Keeps the arbiter clean. Owned by `reap-merged-remote-work-branches`; `install-ci` WIRES its scheduled trigger. |

Every capability is **independently selectable** (you can adopt auto-build-in-CI without ever wiring issue intake) and **independently integration-moded** (merge directly to main vs propose a PR), driven by config. There may be more rungs later; the scaffolder must be additive, not a fixed set of five bespoke workflows.

### `do` vs `advance` in CI: BOTH belong (the routing rule)

A common confusion is that `advance` replaces `do` in CI. It does not (`work/observations/do-vs-advance-in-ci-selection-vs-lifecycle.md`):

- For **SELECTION** ("what do I work on?"), `do -n` and `advance -n` are equivalent: both auto-pick over the SAME mirror-side eligible pool. `advance` does not simplify picking.
- `advance` earns its CI place on a DIFFERENT axis: the **lifecycle rungs** (triage / surface / apply) and the **answer-driven trigger** (`on: push work/questions/**`). `do` structurally cannot run that loop (no question/answer protocol).

So the routing rule the scaffolder encodes:

- A **build-only / slice-only** CI tick (capabilities A + B, human triages locally) ⇒ **`do -n`** is sufficient and simpler (two rungs, no sidecar machinery).
- A tick that must **drain a whole populated `work/` tree** toward done while the human only answers committed question files (capabilities A + B + C) ⇒ **`advance`**, with the `on: push work/questions/**` trigger.

The `install-ci` wizard picks the verb FROM the selected capabilities (C selected ⇒ `advance` + the answer trigger; only A/B ⇒ `do`). The propose=matrix / merge=sequential discipline (below) is a property of the INTEGRATION MODE, not the verb, so it applies to `do` and `advance` identically.

## Solution

Make the existing verbs runnable headless in GitHub Actions, and provide an **`install-ci`** command that scaffolds the chosen capabilities:

- **`install-ci` (the scaffolder)**: a per-capability, provider-pluggable wizard (plus a non-interactive config-file path) that generates: the GitHub Actions workflow(s) for the selected capabilities, a shared **composite setup action** (`.github/actions/agent-runner-setup`) that installs Node + `agent-runner` + the configured harness, configures git identity, and configures AI-provider auth, and sets the provider secrets. It ABSORBS the existing `docs/ci/advance-loop.yml.template` seed: the advance-loop capability is generated by emitting that template (parameterised) rather than hand-rolling a second workflow.
- **The verbs CI invokes** (all already built / building): `do` (A/B), `advance` (A/B/C, + the answer trigger), `intake` (D), the close-job query (E), `gc` sweep (F). No new engine verb is minted by this PRD.
- **Auth**: mirror whitesmith. A default **`models.json`** mode (one GitHub secret per provider API key, config generated inline) and an **`auth.json`** mode (a single `PI_AUTH_JSON` secret + a `GH_PAT` for OAuth token refresh). Interactive wizard with a non-interactive config-file path for re-use and snapshot tests.
- **Integration policy is config-driven, per capability.** Each enabled capability resolves to merge-directly-to-main vs open-a-PR (see the policy section); `install-ci` writes that into the generated workflow's invocation flags, never as a hidden engine default.
- **Triggers**: cron + `workflow_dispatch` for the build/slice tick; `on: push work/questions/**` for the advance answer loop; `issues`/`issue_comment`/label for intake; PR-merged-to-main for the close-job; cron for the gc sweep. `do`/`advance`/`intake`/`gc` each BOUND themselves (do work and EXIT, not loops); CI concurrency groups prevent overlapping ticks; the claim CAS is the real cross-run serialiser.
- **Integration in CI** is in-band, exactly like the laptop paths: the invoked verb owns all git-state transitions. CI runs **in-place in the checkout** (capabilities A to E): the CI container IS the isolation; no hub mirror, no `--isolated`, no registry. (`--isolated` / `--remote` are laptop affordances for building off a busy checkout or a foreign arbiter, IRRELEVANT in CI, which always has a clean dedicated checkout. The matrix-fan-out shape for `propose` enumerates via `scan --json`, but each leg still builds in-place in its own checkout.)
- **Required repo settings + secrets**: documented and (where possible) wizard-set: "Allow GitHub Actions to create and approve pull requests", the provider secrets, and (optionally) GitHub's "auto-delete head branches".

## User Stories

1. As the maintainer, I want **`agent-runner install-ci`** to scaffold the GitHub Actions workflow(s) + a shared composite setup action for the capabilities I select, so autonomous work needs no local machine.
2. As the maintainer, I want to **enable each capability independently** (auto-build, auto-slice, advance/triage/questions, issue intake, issue-close, branch-reap), so I can adopt auto-build-in-CI without ever wiring issue intake.
3. As the maintainer, I want each capability's **integration mode (merge directly to main vs open a PR) to be config-driven**, so I can let trusted, low-risk rungs merge and force human-reviewed PRs for the rest, including a loud, non-default "fully autonomous to main" opt-in.
4. As the maintainer, I want **provider auth via GitHub secrets** (a `models.json` mode by default, an `auth.json` mode as an option), so the CI job authenticates the harness without my laptop.
5. As the maintainer, I want a **`workflow_dispatch`** trigger for catch-up/debugging plus the right event/cron triggers per capability (cron build tick, `push work/questions/**` answer loop, `issues`/`issue_comment` for intake, PR-merge for close, cron for gc), so work is picked up unattended but I can also force a run.
6. As the maintainer, I want **CI concurrency guards** so overlapping ticks never collide, relying on the atomic claim to serialise across runs.
7. As the maintainer, I want `install-ci` to be **provider-pluggable** (GitHub first, behind a seam), so non-GitHub CI can follow without a rewrite.
8. As the maintainer, I want the wizard to have a **non-interactive config-file path** (`--config` / `--export-config`) and a **`--fake`** snapshot mode, so the generated artifacts are reproducible and testable without a live Actions run.
9. As the maintainer, I want `install-ci` to **scaffold workflows but NEVER let the running CI job edit `.github/workflows/**`**, so an autonomous run can never rewrite its own triggers or need elevated `workflows` permission.
10. As the maintainer, I want the **provider-agnostic logic** (the wizard, the auth/`models.json` builder, the config load/export, the `--fake` snapshot, the secret-orchestration logic) extracted into a reusable core behind a thin **CI-provider adapter** (GitHub first), so a second provider and the generated-code surface stay small.

## Implementation Decisions

(Made with the maintainer. Do not relitigate.)

- **Execution-location, not new engine behaviour.** CI invokes the EXISTING verbs (`do`/`advance`/`intake`/`gc` + the close-query); the claim CAS, the verify gate, the review gate, and the integration seam are reused unchanged. NOT `run`: `run` is the cross-repo parallel daemon; CI is one repo, one triggered invocation that exits.
- **`do` AND `advance` both belong in CI** (the routing rule above). Build-only ticks use `do`; lifecycle-draining ticks use `advance` (it adds the triage/surface/apply rungs + the `push work/questions/**` trigger `do` cannot provide). The wizard derives the verb from the selected capabilities.
- **CI runs IN-PLACE (no isolation machinery).** The CI checkout IS the isolation; `--isolated`/`--remote`/the registry are laptop-only and unused here. (The `advance --isolated` / `do --isolated` slices currently in flight do NOT affect CI: they are the busy-checkout/foreign-arbiter affordance, not the CI path.)
- **`install-ci` ABSORBS the existing seed.** `docs/ci/advance-loop.yml.template` + `docs/ci/README.md` (shipped by `advance-loop`, slice `advance-install-ci`) are the advance-loop capability's generated output. The `advance-loop` README explicitly defers the unified `install-ci` CLI surface to THIS PRD; this PRD claims it and emits that template as one capability. Do NOT fork a competing advance workflow.
- **The propose=matrix / merge=sequential discipline is reused verbatim** (from the seed template, validated by `src/advance-ci-template.ts`): `propose` ⇒ a MATRIX (one PR per item, enumerated via `agent-runner scan --json`, each leg carries `--propose` so it can never merge to main); `merge` ⇒ a SINGLE SEQUENTIAL job (`-n <x> --merge`, because merge-mode items rebase-chain and parallel merge would thrash the main-CAS). ONE word `integrationMode` drives BOTH the integration flag AND the job shape, so they cannot desync. This is integration-mode behaviour, identical for `do` and `advance`.
- **CI / automation MUST use explicit slug prefixes** (`do slice:foo` / `do prd:foo`), never bare, because a bare slug can become ambiguous over time and would halt the job (ADR command-surface-and-journeys §3a).
- **`install-ci` uses the seams, never `gh` directly.** Adopt whitesmith's proven `GitHubCIContext` adapter interface (`setSecret`, `repo`, `ghAvailable`, emit-workflow-files) as the CI-provider seam. The core (wizard / auth / `models.json` / config load+export / `--fake`) is provider-agnostic; the GitHub adapter is thin. GitHub is the first adapter.
- **Auth modes mirror whitesmith** (`models.json` default, `auth.json` option). Default to `models.json` SPECIFICALLY to avoid the `auth.json` mode's OAuth-refresh script + `GH_PAT` secret-rotation (the single CI→repo write and the messy whitesmith edge case, see below).
- **Each verb bounds itself; CI adds concurrency groups.** No long-lived daemon in CI. Per-capability concurrency groups (e.g. per-issue for intake, per-ref for the advance loop) prevent overlap; the claim CAS is the real serialiser.
- **Secrets/settings are documented and wizard-set where possible**, including "create and approve pull requests" and (optionally) "auto-delete head branches".

### The merge-vs-propose POLICY (config-driven, per capability) (carried from 2026-06-09, re-scoped)

When CI runs a transformation/build autonomously, IT (not the gate-free command) decides whether output is merged directly or proposed as a PR. This policy lives HERE (the CI driver), because the commands themselves are gate-free (an explicit invocation is its own authorization: `do`, `intake`); the per-repo config gates (`autoSlice`/`autoBuild`/`autoTriage`) gate the AUTONOMOUS/auto-pick path, which is exactly what CI is.

**The deriving rule: an artifact may be MERGED directly iff a human checkpoint still lies AHEAD of it before anything autonomous acts on it; if the next step is autonomous, it needs a PR (the human checkpoint) NOW.** Applied per artifact by the NEXT gate:

| CI emits | next gate | gate OFF (a human acts next) | gate ON (an agent acts next) |
| --- | --- | --- | --- |
| a **PRD** | `autoSlice` | `--merge` safe (a human must slice it; it sits inert in `prd/`) | `--propose` (an agent will auto-slice it, so insert a human PR review now) |
| a **slice** | `autoBuild` | `--merge` safe (a human must build it; it sits in `backlog/`) | `--propose` (an agent will auto-build it, so insert a human PR review now) |

So CI translates its gate state into the right mode and PASSES it to the command. For `intake` (whose output TYPE is decided at runtime), CI passes the PER-OUTCOME flags `intake` already exposes (`--merge-prd`/`--propose-prd`/`--merge-slice`/`--propose-slice` (granular) + `--merge`/`--propose` (aggregate), granular-overrides-aggregate, slice `intake-per-outcome-integration-modes`, done): e.g. `autoSlice` off + `autoBuild` on ⇒ `intake <N> --merge-prd --propose-slice`. For `do <slice>` / `do prd:` (type known up front) CI passes the single `--merge`/`--propose`. The command honors the flags; CI owns the derivation; the wizard writes the derivation into the generated workflow.

**Composed with AUTHOR-TRUST (the issue front-door axis).** Because anybody can file an issue, the merge decision for intake (D) also depends on WHO authored/triggered it: an UNTRUSTED author warrants `--propose` REGARDLESS of the gate. Resolved mode: `--propose` if (downstream gate ON) **OR** (author untrusted); `--merge` only if (gate OFF **AND** author trusted). The exact author-trust resolver is the one open `needsAnswers` below.

**The fully-gateless guardrail.** "All gates on AND `--merge` everywhere" (autonomous issue → slice → build → main, no human anywhere) is dangerous precisely because anybody can file issues. It MUST be a loud, deliberate, NON-DEFAULT opt-in, never reachable by accident. The default is conservative (propose / human-in-the-loop).

### Config & gate model in CI (no `autoAdvance` gate; CI policy = the existing gate family via the workflow env block) (ADR `ci-config-policy-and-gate-family`)

CI does NOT get a new "enable advanced features" config gate. The autonomous lifecycle decomposes FULLY into the existing flat per-action gate family (`autoBuild` / `autoSlice` / `autoTriage`), so there is no ungated rung for an `autoAdvance` flag to guard:

- **`autoBuild`** gates auto-building an undeclared slice; off ⇒ the rung does not run autonomously.
- **`autoSlice`** gates auto-slicing an undeclared PRD; off ⇒ the rung does not run autonomously.
- **`autoTriage`** does NOT gate "whether triage happens" but "whether the no-question cases are decided silently." OFF ⇒ the triage rung STILL runs, but it **surfaces a promote/keep/delete question every time** and waits (it never auto-decides); ON ⇒ it auto-dispositions ONLY the unambiguous cases (still never auto-deletes a non-duplicate / auto-promotes a judgement call).
- **surface a question / apply a committed answer** are ALWAYS allowed (they never auto-decide), so they need no gate.

**Counterintuitive but accepted:** because surface is always-allowed, `autoTriage` OFF produces MORE questions than ON (OFF surfaces a question even for the exact-duplicates ON would silently clear). `autoTriage` is NOT "off = quieter"; it trades human questions against autonomous action, and the name is an acknowledged trap (help text must lead with "off = surface a question for everything; it does not stop triage"). See ADR `ci-config-policy-and-gate-family` "Naming". The true "zero observation noise" rest state is NOT an `autoTriage` value but **verb selection**: `do` has no triage/surface/apply rungs, so a `do`-based CI tick never touches observations and never surfaces a question. So there are three rest states (`advance`+`autoTriage:on` = auto-clear-obvious + ask-the-rest; `advance`+`autoTriage:off` = ask-about-everything; `do` = never look at observations), and the lifecycle on/off switch is the verb, not a gate.

So "auto-advance the lifecycle" is already expressible as a combination of these three gates plus the always-on surface/apply rungs. A fourth `autoAdvance` name would be a redundant alias over a set already fully covered, and re-introduces the slice-by-slice incoherence the command-surface ADR removed.

**"Enable the advance loop at all" is CAPABILITY SELECTION, not a gate** (capability C above): the advance-specific rungs + the `on: push work/questions/**` trigger are selected by WHETHER `install-ci` emits the advance-loop workflow. (A finer `do`-vs-`advance` per-workflow knob is deferred; for now CI workflows use `advance` + the gate family.)

**CI-vs-laptop gate DIVERGENCE is the workflow ENV block, NOT a new config axis.** The gates resolve `flag > ENV (AGENT_RUNNER_*) > per-repo > global > default` (`env-config.ts`, the per-machine source CI has without committing a file). So "laptop auto-builds nothing (I drive it), but CI auto-builds + auto-slices" needs no CI-specific config field: the generated workflow sets an env block (`AGENT_RUNNER_AUTO_BUILD: 'true'`, `AGENT_RUNNER_AUTO_SLICE: 'true'`, `AGENT_RUNNER_AUTO_TRIAGE: 'false'`, …) while the committed `.agent-runner.json` keeps laptop-strict defaults. `install-ci` WRITES that env block from the wizard's per-capability answers. The single "enable advanced/lifecycle CI?" UX, if wanted, is a WIZARD PRESET that expands to (emit the advance workflow + the answer trigger + the env block), never a new `Config` field.

### `install-ci` is a SCAFFOLDER; the CI job NEVER edits workflows (safety boundary)

`install-ci` is a **human-run, one-time scaffolder** (like whitesmith's): it WRITES `.github/workflows/**` + the composite action + secrets, and the human commits them. The **running CI job is forbidden from touching `.github/workflows/**`**. This is a real safety line: the default `GITHUB_TOKEN` cannot push changes under `.github/workflows/` without the `workflows` permission, and an autonomous run must never need (or be granted) the ability to rewrite its own triggers. Stated as US #9; composes with `humanOnly: true`. (A slice that builds work touching workflow files is a human-reviewed PR like any other: the prohibition is on the CI JOB self-editing its triggers, not on the engine ever proposing workflow changes.)

### Provider-agnostic core + thin GitHub adapter (the extraction)

whitesmith's `src/providers/github-ci.ts` (~900 lines) is mostly NOT GitHub-specific. Extract along whitesmith's own seam so the generated-code/duplication surface shrinks and US #7/#10 are concrete, not aspirational:

- **Provider-agnostic core (build once, reuse):** the provider/model/auth config model (`ProviderEntry`, `AuthMode`, `CIConfigFile`); the `models.json` builder; the interactive wizard (provider/model/auth prompts); the config-file load + `--export-config` (+ `--include-secrets`) path; the `--fake` snapshot mechanism (write to `.fake/` instead of `.github/`); the secret-orchestration LOGIC (which secrets, dedup, prompt-or-take-from-config).
- **Thin CI-provider adapter (GitHub first):** whitesmith's `GitHubCIContext` interface is the prototype (`setSecret(name, value)`, `repo`, `ghAvailable`, and "emit the workflow files for these capabilities"). The workflow YAML emission is host-specific (GitHub Actions trigger/permissions/secrets syntax); for the advance-loop capability it emits the EXISTING `advance-loop.yml.template` parameterised, not a fresh hand-roll.

The agent-runner workflow surface is ONE workflow per ENABLED capability (build tick / advance loop / intake / close-job / gc sweep), NOT whitesmith's five bespoke label-state-machine workflows. Per-capability selection = which workflows/jobs the scaffolder emits.

### The `auth.json` / `GH_PAT` sharp edge (carried from whitesmith)

`auth.json` mode needs an OAuth-refresh script (whitesmith's `pi-mono#2743` workaround) AND a `GH_PAT` secret, because that script writes the rotated refresh token BACK via `gh secret set PI_AUTH_JSON` (the SINGLE CI-to-repo mutation in the whole design, and the one that needs a PAT, since the default token cannot rotate the secret). DEFAULT to `models.json` mode specifically to avoid this entirely. If `auth.json` mode is offered, the refresh script + `GH_PAT` requirement are carried over verbatim and documented as the known sharp edge.

## Testing Decisions

- The generated workflow + composite action + setup are **artifacts**; test by generating into a `--fake` / scratch directory and asserting on the produced YAML (no live Actions run). Mirror whitesmith's `--fake` approach. Reuse the existing `src/advance-ci-template.ts` structural validator for the advance-loop capability's output.
- **Stub the CI-provider seam** (whitesmith's `GitHubCIContext`: `setSecret`, repo detection, `ghAvailable`) for any secret-setting / repo-detection path: no network, no real GitHub. Verify the wizard's non-interactive config-file path reproduces the same output as the interactive one.
- The build/slice/triage/intake/close/gc pipelines are ALREADY covered by the existing `do`/`advance`/`intake`/`gc` tests; this PRD does not re-test them, only the CI packaging (the generated artifacts + the verb invocations they wire).

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** this is CI/auth/secrets plumbing that lands GitHub Actions workflows and sets repository secrets, a security-sensitive, infrastructure-shaping change a human should drive. **The PRD-level `humanOnly` does NOT propagate to the slices** (resolved 2026-06-06): it means only that a human drove the SLICING. Each slice's own `humanOnly` is decided by `to-slices` from building that slice. (A pure deterministic generator with a `--fake`-snapshot test may well be agent-buildable; a workflow-writing / secret-touching slice will lean `humanOnly`. That is `to-slices`' call, per-slice.)
- **`needsAnswers`: ONE open, the AUTHOR-TRUST resolver.** The merge-vs-propose policy composes with WHO authored/triggered an issue (untrusted → `--propose` regardless of the gate). The exact resolver (_(issue-author association) × (trigger-comment-author association) × (request channel: command vs every-issue) × (repo policy)_ → trusted/untrusted) and where it lives in the CI wiring is OPEN. It blocks ONLY the intake (D) author-trust + merge-policy slices, NOT the plain `do`/`advance`-in-CI workflow slices (A/B/C), the close-job (E), or gc (F). Auth modes and trigger shapes are otherwise decided (mirror whitesmith).

### Slice-readiness notes (re-verified 2026-06-12)

- **Most of the engine surface CI leans on is LANDED.** `do <slug>` (in-place), `do` auto-pick / `-n` / multi-arg, `do prd:` (slice a PRD), the `advance` verb + its five rungs + drivers, `intake` + per-outcome integration modes, `gc` (worktree reap), and the "PRD complete?" query are all in `work/done/`. The seed CI template + its validator are shipped. So the A/B/C/D/E capabilities have their engine pieces; `install-ci` mostly WIRES them.
- **Two engine pieces are still in flight (verify at slice time, `blockedBy` only if a slice depends on the laptop form):** `reap-merged-remote-work-branches` (F, the `gc` merged-branch SWEEP sub-mode that `install-ci` must schedule) is in `work/backlog/`; the `advance --isolated` / `do --isolated` slices are in `work/backlog/` but DO NOT affect CI (CI is in-place). A `runner-in-ci` slice that wires capability F MUST `blockedBy` `reap-merged-remote-work-branches`.
- **The dependency-aware-scheduling enhancement is out of scope but relevant to the cron drain.** `do -n` / `advance -n` are snapshot-once (NOT dependency-aware): a slice `blockedBy:[A]` ineligible at scan time is not drained in the same run even if A is also selected and lands first (`work/observations/do-autopick-no-dependency-aware-scheduling.md`). A freshly-sliced PRD's chained slices therefore need MULTIPLE cron ticks (or named-order invocation) to fully drain. The CI cron cadence absorbs this today; a dependency-aware `-n` would make a single tick drain a chained set. OUT OF SCOPE for `runner-in-ci` (it is a cross-verb engine enhancement), but the cron-drain docs should note the multi-tick behaviour so it is not mistaken for a bug.
- **Auto-slice-in-CI is OWNED by the verb, not by `runner-in-ci`.** A `runner-in-ci` slice does not BUILD "`do`/`advance` slices a ready PRD"; it only INVOKES it (capability B). Consistent with the Out-of-Scope line.
- **CI DEPENDS ON the review gate, not the reverse.** The review gate is a property of `do`/`advance` (they run `verify` then the review step). CI inherits it by invoking the verb; it does not provide it. A slice that wants review-gated CI runs `blockedBy`s the review-gate slice; for a repo configured `review: on` + `autoMerge: on`, the CI tick is simply `do -n <N> --merge` and the gate rides along.

## Out of Scope

> NOTE: the AUTONOMOUS merge-vs-propose policy + author-trust + the fully-gateless guardrail live HERE (the CI driver); the per-outcome mode KNOBS are `intake`'s/`do`'s (gate-free); CI DERIVES which knobs to set and the wizard writes them into the workflow.

- The issue→artifact TRANSFORM engine itself (that is `issue-intake`). CI SCHEDULES `intake` + owns the merge-vs-propose POLICY + author-trust; the transform is `issue-intake`'s.
- The PRD→slices TRANSFORM (that is `auto-slice`/`do`/`advance`). CI only INVOKES it.
- The `gc` merged-branch sweep MECHANISM (that is `reap-merged-remote-work-branches`). CI only WIRES its scheduled trigger.
- The "PRD complete?" QUERY (already done, `prd-complete-query`). CI's close-job CONSUMES it.
- Dependency-aware `-n` scheduling (a cross-verb engine enhancement, `work/observations/do-autopick-no-dependency-aware-scheduling.md`).
- `--isolated` / `--remote` / the registry / hub mirrors: laptop-only; CI is in-place.
- A new `autoAdvance` (or equivalent) CONFIG GATE. The lifecycle decomposes fully into the existing `autoBuild`/`autoSlice`/`autoTriage` family (ADR `ci-config-policy-and-gate-family`); CI-vs-laptop divergence is the workflow env block, not a new config field.
- A long-lived CI daemon/service; ticks stay bounded.
- Non-GitHub CI providers (GitHub first; the command is seam-shaped so others can follow, but only GitHub is built here).

## Further Notes

- whitesmith (`~/dev/github/wighawag/whitesmith`, `src/providers/github-ci.ts`) is the reference for the `install-ci` wizard, the `models.json`/`auth.json` auth modes, the `GitHubCIContext` adapter seam, the composite setup action, the `--fake` snapshot, the `--config`/`--export-config` non-interactive path, and the OAuth-refresh sharp edge. Reuse its patterns; do **NOT** reuse its label state-machine or issue lifecycle (out of scope here).
- The existing seed (`docs/ci/advance-loop.yml.template`, `docs/ci/README.md`, `src/advance-ci-template.ts`) is THIS PRD's starting point for the advance-loop capability: absorb it, do not duplicate it.
- ADR `ci-config-policy-and-gate-family` records the decision (no `autoAdvance` gate; CI policy = the existing gate family resolved via the generated workflow's `AGENT_RUNNER_*` env block). See "Config & gate model in CI" above.
- Slice this PRD with `to-slices`. A natural first slice is the provider-agnostic `install-ci` core + the GitHub adapter + auth (`--fake`-tested); then one slice per capability's workflow wiring (build tick, advance loop, intake, close-job, gc sweep), each independently selectable.
