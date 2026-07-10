/**
 * The `install-ci` ADVANCE-LIFECYCLE capability (prd `runner-in-ci`, task
 * `install-ci-advance-lifecycle-workflow`; capability C: auto-triage observations
 * + surface declared blockers + apply committed answers). This module GENERATES
 * the advance-lifecycle workflow by ABSORBING and PARAMETERISING the existing seed
 * `docs/ci/advance-loop.yml.template` (the advance-loop capability's output) — it
 * does NOT hand-roll a competing advance workflow. It also STRUCTURALLY VALIDATES
 * the emitted YAML, mirroring the snapshot-assertion style of
 * `advance-ci-template.ts` (the package depends on
 * NO YAML lib, so the checks are presence/shape assertions over the raw text).
 *
 * This is the "human is the clock" loop: CI drains the populated `work/` tree
 * toward done while the human only answers committed question sidecars on their own
 * time. Over the build/task tick (its sibling capability), the advance-lifecycle
 * tick adds exactly three things — and they are the whole reason `advance` (not
 * `do`) is the verb here:
 *
 *   - the LIFECYCLE rungs (triage observations / surface declared blockers / apply
 *     a committed answer), gated by the two calm-default lifecycle gates below;
 *   - the on-answer-committed trigger `on: push work/questions/**`, which re-runs
 *     the loop promptly when a question sidecar is answered;
 *   - (already in the absorbed seed) capability F — the `reap-merged-branches` job
 *     (`gc --remote-branches`) on the same `schedule:` cron, opt-out via the
 *     `sweepMergedBranches` dispatch input.
 *
 * The discipline is VERBATIM from the seed:
 *
 *   - CI ALWAYS invokes `advance` (ADR `ci-config-policy-and-gate-family` §1):
 *     `advance` is a strict superset of `do`, and with the lifecycle gates at their
 *     calm defaults it degrades to exactly `do`'s build/task behaviour. The verb
 *     is NEVER a user decision; the workflow tunes behaviour via the
 *     `DORFL_*` env block, not by swapping the verb. There is NO
 *     `autoAdvance` gate.
 *   - The two LIFECYCLE gates are ORTHOGONAL peers, both calm by default:
 *     `DORFL_OBSERVATION_TRIAGE` (`off`/`ask`/`auto`, calm `off`) governs the
 *     raw observation INBOX; `DORFL_SURFACE_BLOCKERS` (`true`/`false`, calm
 *     `false`) governs DECLARED `needsAnswers` work. "Groom my observations but
 *     leave my blocked work alone" = `OBSERVATION_TRIAGE: ask` + `SURFACE_BLOCKERS:
 *     false`. Applying a committed answer has NO gate.
 *   - ONE word `integrationMode` drives BOTH the job SHAPE AND the
 *     `--propose`/`--merge` flag (they can never desync): `propose` ⇒ a DYNAMIC
 *     matrix (`dorfl scan --json | jq` enumerates one leg per eligible id,
 *     each leg carries `--propose` so it can NEVER merge to `main`); `merge` ⇒ ALSO
 *     a MATRIX (one leg per item; build/gate/review fan out, the LAND tail is
 *     serialised by the engine's `mergeRetries` CAS-retry loop — the git-alone
 *     floor — NOT by the workflow shape; PRD
 *     `land-time-reverify-and-parallel-merge-ceiling`). This is integration-mode
 *     behaviour, IDENTICAL to the build tick (integration mode is
 *     verb-independent).
 *   - CI runs IN-PLACE (the CI container IS the isolation): no
 *     `--isolated`/`--remote`/registry. A CI concurrency group (per-ref) prevents
 *     overlapping ticks; the claim CAS is the real cross-run serialiser.
 *   - All invocations use explicit slug prefixes (`task:`/`prd:`), never bare
 *     (ADR `command-surface-and-journeys` §3a).
 *   - The running CI job NEVER edits `.github/workflows/**` (US #9): it requests
 *     NO `workflows` permission and cannot rewrite its own triggers.
 *
 * The structural validator is the dependency-free counterpart of "the workflow
 * parses + carries the right discipline" the task's acceptance criteria require;
 * the test generates this artifact under `--fake` and asserts every invariant.
 */

import type {ResolvedCIConfig} from './install-ci-core.js';
import {providerSecretsWithBlock} from './install-ci-core.js';

/** The capability id (the registry key + the emitted workflow file stem). */
export const ADVANCE_LIFECYCLE_CAPABILITY_ID = 'advance-lifecycle';

/** The wizard-facing label for the advance-lifecycle capability. */
export const ADVANCE_LIFECYCLE_CAPABILITY_LABEL =
	'Auto-triage observations + surface declared blockers + apply committed answers (the advance lifecycle loop: cron + dispatch + on-answer-committed)';

/** The repo-relative path (under the output base) of the emitted workflow. */
export const ADVANCE_LIFECYCLE_WORKFLOW_PATH =
	'workflows/advance-lifecycle.yml';

/**
 * Generate the advance-lifecycle workflow YAML by PARAMETERISING the seed
 * `docs/ci/advance-loop.yml.template`. Deterministic: the same config produces
 * byte-identical output. The workflow is a FIXED shell (ADR §6: all policy is
 * env/config, so the artifact carries no config-derived policy beyond the env-block
 * scaffolding) — `config` is accepted for parity with the `CapabilityEmitter` seam
 * and future per-config wiring, but the advance-lifecycle shape itself is
 * config-independent.
 *
 * This is the absorbed seed, with two parameterisations: (1) it wires the SHARED
 * composite setup action (`./.github/actions/dorfl-setup`, emitted by the
 * core task) into every job; (2) it surfaces the engine gate family — including
 * the two calm-default LIFECYCLE gates — as the `DORFL_*` env block, so the
 * out-of-the-box tick asks nothing until the user opts in. The seed's capability-F
 * reap job + `sweepMergedBranches` input are PRESERVED verbatim (NOT stripped); no
 * separate gc-sweep workflow is emitted.
 */
export function generateAdvanceLifecycleWorkflow(
	config: ResolvedCIConfig,
): string {
	// The agent-running jobs (propose / merge) pass the configured provider
	// secret(s) to the setup action ONCE via `with:`; the action forwards them to
	// `$GITHUB_ENV` so `pi` can authenticate (models-json mode). auth-json mode has
	// no provider keys here (it uses auth.json), so the block is empty.
	const setupWith = providerSecretsWithBlock(config);
	return `\
# dorfl — the ADVANCE LIFECYCLE loop in CI (capability C: auto-triage
# observations + surface declared blockers + apply committed answers, prd
# runner-in-ci). EMITTED by \`dorfl install-ci\` by PARAMETERISING the seed
# \`docs/ci/advance-loop.yml.template\` (the advance-loop capability's output) — the
# human commits it. DO NOT hand-edit a copy — re-run install-ci to upgrade the
# shell, and edit the workflow SHAPE in the seed template, not here.
#
# THIS is the "human is the clock" loop: CI drains the populated work/ tree toward
# done while the human only answers committed question sidecars (work/questions/**)
# on their own time.
#
# CI ALWAYS invokes \`advance\` (NEVER a user-chosen verb): \`advance\` is a strict
# superset of \`do\`, and with the lifecycle gates at their calm defaults (below) it
# degrades to exactly \`do\`'s build/task behaviour (ADR
# ci-config-policy-and-gate-family §1). The triage/surface/apply rungs + the
# on-answer-committed trigger are EXACTLY what \`advance\` adds over the build/task
# tick. There is NO \`autoAdvance\` gate — the lifecycle decomposes into the gate
# family in the env block.
#
# ONE WORD, ONE MEANING — \`integrationMode\` drives BOTH the job SHAPE AND the
# \`--propose\`/\`--merge\` flag the legs pass, so they can NEVER desync:
#   * propose ⇒ a DYNAMIC matrix (one leg per eligible id, enumerated via
#               \`dorfl scan --json | jq\`), each leg \`advance --propose\`
#               opening its OWN PR — a leg can NEVER merge to main.
#   * merge   ⇒ ALSO a MATRIX (one leg per item; build/gate/review fan out, the
#               LAND tail — rebase + CAS push to \`main\` — is serialised by the
#               engine's \`mergeRetries\` CAS-retry loop, NOT by the workflow shape.
#               PRD \`land-time-reverify-and-parallel-merge-ceiling\`: a
#               non-fast-forward push triggers re-rebase + re-gate + retry, never
#               a \`--force\`. The cross-job serialiser is the CAS-retry FLOOR;
#               there is NO host-specific \`concurrency:\` group on the merge job).
# This is integration-mode behaviour, IDENTICAL to the build/task tick
# (integration mode is verb-independent). The CLAIM CAS, not the matrix, is the
# real cross-run serialiser: a leg that loses the claim race exits clean.
#
# CI runs IN-PLACE (the CI container IS the isolation): NO --isolated/--remote/
# registry (laptop-only affordances). The concurrency group below stops
# overlapping ticks of the same ref from colliding.
#
# SAFETY (US #9): the running job is FORBIDDEN from editing the workflows tree
# under .github. It requests NO \`workflows\` permission, so it can never rewrite
# its own triggers.

name: advance-lifecycle

on:
  schedule:
    # Cron tick: drain whatever the human has answered/produced since the last run
    # (triage / surface / apply + build / task). Adjust the cadence to taste
    # (here: hourly).
    - cron: '0 * * * *'
  push:
    # On-answer-committed: a push that touches an answered question sidecar
    # (\`work/questions/**\`) re-runs the loop so the human's answer is applied
    # promptly. This is the lifecycle-specific trigger \`do\` cannot provide.
    paths:
      - 'work/questions/**'
  workflow_dispatch:
    inputs:
      integrationMode:
        description: "Integration mode (drives BOTH the integration flag passed to \`advance\` AND the job shape): propose ⇒ a matrix, each leg \`advance --propose\` (one PR per item); merge ⇒ a matrix, each leg \`advance --merge\` (one item — build/gate/review fan out in parallel; the LAND tail is serialised by the engine's \`mergeRetries\` CAS-retry loop, not by the workflow shape)."
        required: false
        default: 'propose'
        type: choice
        options:
          - propose
          - merge
      sweepMergedBranches:
        description: 'Reap merged remote work/* branches on the scheduled tick (gc --remote-branches): delete only branches PROVABLY MERGED into <arbiter>/main, so out-of-band human/UI PR merges stop leaving their work/<slug> branches lingering on the arbiter. ON by default; set false to opt out. An in-flight (un-merged) branch is NEVER touched.'
        required: false
        default: true
        type: boolean
      # ── GATE-FAMILY one-shot overrides (dispatch only) ──────────────────────
      # Override an engine gate for THIS manual run only, riding the env layer of
      # flag > env > per-repo > global > default. Modelled as \`type: choice\` with a
      # BLANK first option (not \`type: boolean\`, which cannot represent "unset"):
      # blank ⇒ emit NOTHING (the committed .dorfl.json wins, today's
      # behaviour); a non-blank choice ⇒ export the matching DORFL_* for this
      # run. The blank is load-bearing: env-config coercion THROWS on an empty
      # string, so the per-job step below only writes when the input is non-blank.
      autoBuild:
        description: 'One-shot override of the autoBuild gate (DORFL_AUTO_BUILD) for THIS dispatch run only. Blank ⇒ no override (config wins).'
        required: false
        default: ''
        type: choice
        options:
          - ''
          - 'true'
          - 'false'
      autoTask:
        description: 'One-shot override of the autoTask gate (DORFL_AUTO_TASK) for THIS dispatch run only. Blank ⇒ no override (config wins).'
        required: false
        default: ''
        type: choice
        options:
          - ''
          - 'true'
          - 'false'
      observationTriage:
        description: 'One-shot override of the observationTriage gate (DORFL_OBSERVATION_TRIAGE) for THIS dispatch run only. Blank ⇒ no override (config wins).'
        required: false
        default: ''
        type: choice
        options:
          - ''
          - 'off'
          - 'ask'
          - 'auto'
      surfaceBlockers:
        description: 'One-shot override of the surfaceBlockers gate (DORFL_SURFACE_BLOCKERS) for THIS dispatch run only. Blank ⇒ no override (config wins).'
        required: false
        default: ''
        type: choice
        options:
          - ''
          - 'true'
          - 'false'

# Serialise overlapping ticks of the same ref; the claim CAS is the real
# cross-run serialiser, this just avoids redundant concurrent ticks.
concurrency:
  group: advance-lifecycle-\${{ github.ref }}
  cancel-in-progress: false

# NO \`workflows\` permission: the running job can NEVER edit the workflows tree
# under .github (US #9). \`contents: write\` + \`pull-requests: write\` are all this
# tick needs (commit work, open PRs); it never rewrites its triggers.
permissions:
  contents: write
  pull-requests: write

env:
  # The resolved integration mode: the dispatch input when present, else \`propose\`
  # (the conservative default — one PR per item, a human merges). This single value
  # selects BOTH the job shape (via the \`if:\` guards below) AND the integration flag
  # the \`advance\` legs pass (\`--propose\`/\`--merge\`), so they can never desync.
  INTEGRATION_MODE: \${{ github.event.inputs.integrationMode || 'propose' }}
  # Reap merged remote work/* branches on the scheduled tick (capability F). ON by
  # default (the empty dispatch input on a \`schedule\`/\`push\` trigger reads as the
  # default); set the \`sweepMergedBranches\` dispatch input to \`false\` to opt out.
  # This is the provider-agnostic hygiene sweep (\`gc --remote-branches\`) for
  # out-of-band human/UI PR merges, whose work/<slug> branch nothing else deletes.
  SWEEP_MERGED_BRANCHES: \${{ github.event.inputs.sweepMergedBranches || 'true' }}

  # ── The engine GATE FAMILY is resolved FROM CONFIG, not carried here ─────────
  # CI is NOT a special policy surface (ADR ci-config-policy-and-gate-family §5):
  # it runs the SAME engine gates, resolved through flag > env > per-repo > global
  # > default. The SAME .dorfl.json the laptop uses applies here. This
  # workflow emits NO DORFL_AUTO_BUILD / DORFL_AUTO_TASK /
  # DORFL_OBSERVATION_TRIAGE / DORFL_SURFACE_BLOCKERS line on a
  # SCHEDULE/PUSH tick, so the env layer carries NO defaults there — your committed
  # .dorfl.json wins (then the global config, then the strict built-in
  # defaults autoBuild:false / autoTask:false / observationTriage:'off' /
  # surfaceBlockers:false). The ONE exception is a manual \`workflow_dispatch\` where
  # you fill a gate override input (above): the per-job step then exports that ONE
  # DORFL_* for that run only (blank input ⇒ still nothing). The override
  # MUST be wired into every job that resolves the gate family — including the
  # \`enumerate\` scan (it gates the matrix pools via observationTriage/surfaceBlockers
  # /autoTask/autoBuild), not just the agent-running jobs — or the override is inert
  # for the very pools it targets. To enable CI autonomy durably, set the gate(s) in
  # .dorfl.json (applies everywhere) — NOT by re-running install-ci (ADR §6:
  # install-ci is one-time).

jobs:
  # ── ENUMERATE (propose only) ────────────────────────────────────────────────
  # Build the DYNAMIC matrix from the eligible-pool scan. \`scan --json\` reports
  # BOTH the registry/hub-mirror pool (\`repos[].items[]\`, \`repos[].specs[]\`,
  # \`repos[].lifecycle\`) AND the in-place working checkout (\`cwd.repo.items[]\`,
  # \`cwd.repo.specs[]\`, \`cwd.repo.lifecycle\`); CI runs IN-PLACE so the items live
  # in the latter (a fresh runner has no registered mirror). \`jq\` unions + dedups
  # the build/task pools AND the LIFECYCLE pools into a deduplicated GitHub
  # Actions matrix list of explicit \`task:<slug>\` / \`prd:<slug>\` / \`obs:<slug>\`
  # ids (CI MUST use explicit prefixes). The lifecycle legs run the WHOLE
  # answer-loop in propose mode (not only merge): \`obs:\` (triage untriaged
  # observations), surface \`task:\`/\`prd:\` (\`needsAnswers\`, no answered sidecar)
  # AND apply \`task:\`/\`prd:\` (\`needsAnswers\`, answered sidecar — consume the
  # committed answer, closing the on-answer \`push: work/questions/**\` loop). Each
  # becomes one matrix leg → one independent \`advance --propose\`. Skipped in merge
  # mode. Inert with calm-default gates (empty triage/surface pools).
  enumerate:
    runs-on: ubuntu-latest
    outputs:
      items: \${{ steps.scan.outputs.items }}
      any: \${{ steps.scan.outputs.any }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/dorfl-setup
      - name: apply dispatch gate overrides (one-shot, this run only)
        # MUST run BEFORE \`scan\`: scan's matrix pools are gated by the SAME engine
        # gate family (autoTask/autoBuild + lifecycle observationTriage/
        # surfaceBlockers), so an override that does not reach this job produces an
        # empty matrix and is silently inert. \`if:\` + the inner \`[ -n ... ]\` guard
        # keep schedule/push (and a blank dispatch field) exporting NOTHING — an
        # empty DORFL_* would make env-config coercion throw.
        if: \${{ github.event_name == 'workflow_dispatch' }}
        run: |
          [ -n "\${{ github.event.inputs.autoBuild }}" ] && echo "DORFL_AUTO_BUILD=\${{ github.event.inputs.autoBuild }}" >> "$GITHUB_ENV"
          [ -n "\${{ github.event.inputs.autoTask }}" ] && echo "DORFL_AUTO_TASK=\${{ github.event.inputs.autoTask }}" >> "$GITHUB_ENV"
          [ -n "\${{ github.event.inputs.observationTriage }}" ] && echo "DORFL_OBSERVATION_TRIAGE=\${{ github.event.inputs.observationTriage }}" >> "$GITHUB_ENV"
          [ -n "\${{ github.event.inputs.surfaceBlockers }}" ] && echo "DORFL_SURFACE_BLOCKERS=\${{ github.event.inputs.surfaceBlockers }}" >> "$GITHUB_ENV"
          true
      - id: scan
        # Enumerate eligible items as namespaced ids, one matrix leg per id. CI
        # uses explicit \`task:\` / \`prd:\` / \`obs:\` prefixes, never bare (ADR
        # command-surface §3a). Eligible TASKS ⇒ \`task:<slug>\` legs (\`advance\`
        # builds them); TASKABLE PRDS ⇒ \`prd:<slug>\` legs (\`advance\` auto-tasks
        # them, capability B — \`DORFL_AUTO_TASK\` above). LIFECYCLE pools:
        # \`lifecycle.triage[]\` ⇒ \`obs:<slug>\` (the \`obs:\` prefix is fixed here),
        # \`lifecycle.surface[]\` + \`lifecycle.apply[]\` ⇒ \`.namespace + ":" + .slug\`
        # (surface: \`task:\`/\`prd:\` blocker-question legs; apply: \`task:\`/\`prd:\`
        # AND \`observation:\` legs — an answered observation sidecar is consumed by
        # the apply rung too, so it MUST carry through here). CI runs IN-PLACE, so we use
        # \`scan --here\`: it reports ONLY the cwd checkout (\`cwd.repo.*\`) and SKIPS
        # the cross-repo registry loop (no N-mirror fetches; a fresh runner has no
        # registered mirror anyway). The \`cwd\` arbiter is the checkout's own clone,
        # so the fetch-first is a near-noop. \`jq\` still reads the (now-empty)
        # \`repos[]\` branches harmlessly; we union + dedup so the matrix has one
        # leg per item.
        run: |
          items="$(dorfl scan --json --here \\
            | jq -c '[(.repos[].items[]?, .cwd.repo.items[]?) | select(.eligibility.eligible == true) | "task:" + .slug] + [(.repos[].specs[]?, .cwd.repo.specs[]?) | select(.eligibility.eligible == true) | "prd:" + .slug] + [(.repos[].lifecycle.triage[]?, .cwd.repo.lifecycle.triage[]?) | "obs:" + .slug] + [(.repos[].lifecycle.surface[]?, .cwd.repo.lifecycle.surface[]?, .repos[].lifecycle.apply[]?, .cwd.repo.lifecycle.apply[]?) | .namespace + ":" + .slug] | unique')"
          echo "items=\${items}" >> "$GITHUB_OUTPUT"
          if [ "$(echo "\${items}" | jq 'length')" -gt 0 ]; then
            echo "any=true" >> "$GITHUB_OUTPUT"
          else
            echo "any=false" >> "$GITHUB_OUTPUT"
          fi

  # ── PROPOSE: a MATRIX of independent jobs (one PR per item) ──────────────────
  # True parallelism — each item is an independent PR, so a matrix is the right
  # parallel shape and \`-n\` is NOT needed. Each leg passes \`--propose\`, tying the
  # integration mode to THIS shape: it sits at the top of the precedence chain, so
  # the workflow mode always wins over the repo config default and a leg can NEVER
  # merge to main. Explicit \`task:\`/\`prd:\` prefixes only, never bare.
  advance-propose:
    needs: enumerate
    if: \${{ (github.event.inputs.integrationMode || 'propose') == 'propose' && needs.enumerate.outputs.any == 'true' }}
    runs-on: ubuntu-latest
    strategy:
      # Independent PRs: one failing item must NOT cancel the others.
      fail-fast: false
      # Cap concurrent legs (config \`maxParallel\`, install-ci --max-parallel):
      # each leg spawns a FULL agent session (build + Gate-2 review), so an
      # unbounded fan-out over a large item set exhausts the model-provider API
      # rate limit (429s that strand legs as transient-infra stuck) AND thrashes
      # the arbiter-main CAS. A bounded fan-out drains steadily instead.
      max-parallel: ${config.maxParallel}
      matrix:
        item: \${{ fromJson(needs.enumerate.outputs.items) }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/dorfl-setup${setupWith}
      - name: apply dispatch gate overrides (one-shot, this run only)
        # Mirror of the enumerate-job override (see there): export each gate's
        # DORFL_* ONLY on a workflow_dispatch with a non-blank input, so the
        # one-shot override also reaches the \`advance\` leg that builds the item.
        if: \${{ github.event_name == 'workflow_dispatch' }}
        run: |
          [ -n "\${{ github.event.inputs.autoBuild }}" ] && echo "DORFL_AUTO_BUILD=\${{ github.event.inputs.autoBuild }}" >> "$GITHUB_ENV"
          [ -n "\${{ github.event.inputs.autoTask }}" ] && echo "DORFL_AUTO_TASK=\${{ github.event.inputs.autoTask }}" >> "$GITHUB_ENV"
          [ -n "\${{ github.event.inputs.observationTriage }}" ] && echo "DORFL_OBSERVATION_TRIAGE=\${{ github.event.inputs.observationTriage }}" >> "$GITHUB_ENV"
          [ -n "\${{ github.event.inputs.surfaceBlockers }}" ] && echo "DORFL_SURFACE_BLOCKERS=\${{ github.event.inputs.surfaceBlockers }}" >> "$GITHUB_ENV"
          true
      - name: advance one item in-place (propose ⇒ opens a PR)
        # In-place in this checkout (no --isolated/--remote): the CI container IS
        # the isolation. \`--propose\` can ONLY ride a matrix leg, never the merge
        # job, so a parallel merge-to-main is structurally impossible.
        # \`--propose\` shells \`gh\` to open the PR, which reads \`GH_TOKEN\` from the
        # env (a workflow PERMISSION is not a credential). Prefer a dedicated
        # \`DORFL_GH_TOKEN\` secret (a PAT / App token) so PRs carry YOUR
        # identity AND trigger downstream workflows (PRs opened with the built-in
        # \`GITHUB_TOKEN\` are \`github-actions[bot]\` and do NOT trigger further
        # \`on: pull_request\` runs). Falls back to the auto \`GITHUB_TOKEN\` so it
        # works zero-config; the job's \`pull-requests: write\` scopes that token.
        env:
          GH_TOKEN: \${{ secrets.DORFL_GH_TOKEN || secrets.GITHUB_TOKEN }}
        # \`--watch\` streams the build agent's high-signal turns (assistant text,
        # tool calls, finish) into THIS job log live, so the run shows the agent
        # working instead of freezing after "Start work". A read-only observer (no
        # outcome/gate/git effect). It fits because each matrix leg names ONE item
        # (one pi session to tail) — the merge job is now a per-item matrix too
        # (see below) and streams the same way.
        run: dorfl advance "\${{ matrix.item }}" --propose --watch --arbiter origin

  # ── MERGE: a MATRIX of independent jobs (parallel build/gate/review, serialised land) ──
  # PRD \`land-time-reverify-and-parallel-merge-ceiling\` (stories 4 + 6): each item
  # gets its own leg; build/gate/review run concurrently across siblings; the LAND
  # TAIL is serialised by the engine's \`mergeRetries\` CAS-retry loop — the
  # git-alone floor — NOT by the workflow shape. A non-fast-forward push triggers
  # re-rebase + re-gate + retry up to the resolved \`mergeRetries\` cap; never a
  # \`--force\`. NO host-specific \`concurrency:\` group on this job (it would be
  # load-bearing for cross-job safety, breaking the floor framing).
  # The fully-autonomous-to-main path (this job + all gates on) is still a LOUD,
  # NON-DEFAULT opt-in: the default integrationMode is \`propose\`, so reaching
  # merge-to-main requires deliberately dispatching/pinning \`merge\`.
  advance-merge:
    needs: enumerate
    if: \${{ (github.event.inputs.integrationMode || 'propose') == 'merge' && needs.enumerate.outputs.any == 'true' }}
    runs-on: ubuntu-latest
    strategy:
      # Independent landings: one failing item must NOT cancel the others; a
      # loser of the CAS race re-rebases + re-gates + retries.
      fail-fast: false
      # Cap concurrent legs (config \`maxParallel\`, see advance-propose): a FULL
      # agent session per leg, so bound the fan-out to avoid API-429s + CAS thrash.
      max-parallel: ${config.maxParallel}
      matrix:
        item: \${{ fromJson(needs.enumerate.outputs.items) }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/dorfl-setup${setupWith}
      - name: apply dispatch gate overrides (one-shot, this run only)
        # Mirror of the enumerate-job override (see there): export each gate's
        # DORFL_* ONLY on a workflow_dispatch with a non-blank input. The
        # merge job re-scans the pool inside \`advance -n\`, so it needs the override
        # too for the lifecycle/task pools to reflect it.
        if: \${{ github.event_name == 'workflow_dispatch' }}
        run: |
          [ -n "\${{ github.event.inputs.autoBuild }}" ] && echo "DORFL_AUTO_BUILD=\${{ github.event.inputs.autoBuild }}" >> "$GITHUB_ENV"
          [ -n "\${{ github.event.inputs.autoTask }}" ] && echo "DORFL_AUTO_TASK=\${{ github.event.inputs.autoTask }}" >> "$GITHUB_ENV"
          [ -n "\${{ github.event.inputs.observationTriage }}" ] && echo "DORFL_OBSERVATION_TRIAGE=\${{ github.event.inputs.observationTriage }}" >> "$GITHUB_ENV"
          [ -n "\${{ github.event.inputs.surfaceBlockers }}" ] && echo "DORFL_SURFACE_BLOCKERS=\${{ github.event.inputs.surfaceBlockers }}" >> "$GITHUB_ENV"
          true
      - name: advance one item in-place (merge ⇒ rebase + CAS land on main)
        # In-place (no --isolated/--remote). \`--merge\` ties the integration mode
        # to THIS (matrix) shape: it sits at the top of the precedence chain, so
        # the workflow mode always wins over the repo's \`.dorfl.json\` default.
        # Cross-job land safety comes from the engine's CAS-retry loop, not from
        # this workflow's job shape. \`gh\` (merge / PR housekeeping) reads
        # \`GH_TOKEN\` from the env.
        env:
          GH_TOKEN: \${{ secrets.DORFL_GH_TOKEN || secrets.GITHUB_TOKEN }}
        # \`--watch\` streams the build agent's high-signal turns into THIS job
        # log live; each leg names ONE item, so it fits the same way it does on
        # the propose legs.
        run: dorfl advance "\${{ matrix.item }}" --merge --watch --arbiter origin

  # ── REAP merged remote work/* branches (capability F, the hygiene sweep) ─────
  # PRESERVED from the seed (NOT a separate gc-sweep workflow): the provider-
  # agnostic counterpart of the worktree reaper. Deletes remote \`work/<slug>\`
  # branches that are PROVABLY MERGED into \`origin/main\`, so an out-of-band
  # human/UI PR merge stops leaving its branch lingering on the arbiter.
  # Independent of the integration mode (both propose- and merge-mode repos
  # accumulate out-of-band-merged branches), so it runs on EVERY tick regardless
  # of \`integrationMode\` — gated ONLY by the \`sweepMergedBranches\` opt-out (ON by
  # default). It NEVER touches an un-merged/in-flight branch and NEVER \`--force\`s.
  # Plain git, so it works against any provider (incl. a \`--bare\` arbiter).
  #
  # OPTIONAL belt-and-suspenders for a GitHub arbiter: enable the repo-level
  # "Automatically delete head branches" setting (\`delete_branch_on_merge\`), owned
  # by the install-ci wizard — an ADDITIVE GitHub-only convenience, NOT a
  # replacement for this sweep (the only thing that reaps on a \`--bare\`/non-GitHub
  # arbiter).
  reap-merged-branches:
    if: \${{ (github.event.inputs.sweepMergedBranches || 'true') == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/dorfl-setup
      - name: reap merged remote work/* branches + orphan sidecars (gc --remote-branches)
        # Deletes ONLY branches provably merged into origin/main; reports
        # deleted-vs-retained-with-reason. Safe to run every tick (idempotent).
        # This invocation ALSO reaps ORPHAN question sidecars: a
        # sidecar under the questions queue (<type>-<slug>.md) whose source item
        # was deleted out-of-band (git rm; the sidecar's working-tree source no
        # longer exists). The orphan sweep rides THIS scheduled invocation
        # precisely so it is never "in the code but never invoked in CI".
        run: dorfl gc --remote-branches --arbiter origin
`;
}

/** A single structural problem found in the generated workflow. */
export interface AdvanceLifecycleProblem {
	/** A short, stable id for the violated invariant (for tests/assertions). */
	id: string;
	/** Human-readable description of what is missing or wrong. */
	message: string;
}

/** The result of {@link validateAdvanceLifecycleWorkflow}. */
export interface AdvanceLifecycleValidation {
	/** True iff the workflow satisfies EVERY structural invariant. */
	ok: boolean;
	/** Each violated invariant (empty when `ok`). */
	problems: AdvanceLifecycleProblem[];
}

/**
 * Structurally validate the advance-lifecycle workflow against the task's
 * acceptance criteria. Dependency-free (no YAML lib): presence/shape assertions
 * over the raw text, mirroring {@link validateAdvanceCiTemplate}.
 */
export function validateAdvanceLifecycleWorkflow(
	text: string,
): AdvanceLifecycleValidation {
	const problems: AdvanceLifecycleProblem[] = [];
	const require = (id: string, present: boolean, message: string): void => {
		if (!present) {
			problems.push({id, message});
		}
	};

	// The OPERATIVE (non-comment) lines: the prohibitions below (no `--isolated`/
	// `--remote`/`do`/`autoAdvance`/`.github/workflows` self-edit) are about what
	// the job DOES, not what the explanatory comments MENTION. A YAML `#` comment
	// line is documentation, so strip full-line comments before the negative checks.
	// The positive presence checks run over the full text (comments are harmless).
	const operative = text
		.split('\n')
		.filter((line) => !/^\s*#/.test(line))
		.join('\n');

	// --- Always invokes `advance`, NEVER `do` ----------------------------------
	require('invokes-advance', /dorfl advance\b/.test(
		text,
	), 'the workflow must invoke the `advance` driver (CI always runs `advance`).');
	require('never-invokes-do', !/dorfl do\b/.test(
		operative,
	), 'the workflow must NEVER invoke `do` directly (CI always invokes `advance`, ' +
		'ADR ci-config-policy-and-gate-family §1).');

	// --- Triggers: cron + workflow_dispatch + the on-answer-committed push -------
	require('trigger-cron', /\bschedule:\s*[\s\S]*?-\s*cron:/.test(
		text,
	), 'must trigger on a cron schedule (`on.schedule[].cron`).');
	require('trigger-workflow-dispatch', /\bworkflow_dispatch:/.test(
		text,
	), 'must trigger on `workflow_dispatch` (manual catch-up/debug).');
	require('dispatch-integration-mode-input', /workflow_dispatch:[\s\S]*?inputs:[\s\S]*?integrationMode:/.test(
		text,
	), 'the `workflow_dispatch` must carry an `integrationMode` input.');
	// The DEFINING lifecycle trigger: an on-answer-committed push (a push touching
	// `work/questions/**`) re-runs the loop so a freshly-answered sidecar applies
	// promptly. This is what `advance` adds over the build/task tick.
	require('trigger-on-answer-committed', /\bpush:\s*[\s\S]*?paths:[\s\S]*?work\/questions\//.test(
		text,
	), 'must trigger on-answer-committed (a push touching `work/questions/**`) — ' +
		'the lifecycle answer loop.');

	// --- integrationMode drives BOTH shape and flag (one word, one meaning) -----
	require('integration-mode-one-word', /integrationMode:/.test(text) &&
		/github\.event\.inputs\.integrationMode/.test(
			text,
		), 'the dispatch input must be `integrationMode` (one word driving BOTH the ' +
		'flag and the derived job shape).');

	// --- propose ⇒ a DYNAMIC matrix enumerated via `scan --json` ----------------
	require('propose-matrix', /strategy:\s*[\s\S]*?matrix:/.test(
		text,
	), '`propose` mode must emit a MATRIX of jobs (`strategy.matrix`).');
	require('propose-enumerates-via-scan', /dorfl scan --json/.test(
		text,
	), 'the matrix items must be ENUMERATED via the eligible-pool scan ' +
		'(`dorfl scan --json`).');
	require('propose-one-advance-per-item', /dorfl advance "?\$\{\{\s*matrix\./.test(
		text,
	), 'each matrix leg must run one `dorfl advance <matrix item>` ' +
		'(one PR per item).');
	require('propose-leg-carries-propose-flag', /advance-propose:[\s\S]*?dorfl advance "?\$\{\{\s*matrix\.[\s\S]*?--propose\b/.test(
		text,
	), 'each `propose` matrix leg must pass `--propose` so the integration mode is ' +
		'TIED to the matrix shape (a leg can never merge to main / desync from the ' +
		'dispatch mode).');

	// --- merge ⇒ a MATRIX per item (parallel build/gate/review, serialised land) -
	// PRD `land-time-reverify-and-parallel-merge-ceiling` stories 4 + 6: build/
	// gate/review fan out; the LAND tail is serialised by the engine's
	// `mergeRetries` CAS-retry loop (the git-alone floor), NOT the workflow.
	require('merge-matrix', /advance-merge:[\s\S]*?strategy:\s*[\s\S]*?matrix:/.test(
		text,
	), 'the `merge` job must use a MATRIX (parallel build/gate/review per item; ' +
		"the land tail is serialised by the engine's `mergeRetries` CAS-retry " +
		"loop, not by the workflow's job shape).");
	require('merge-leg-carries-merge-flag', /advance-merge:[\s\S]*?dorfl advance "?\$\{\{\s*matrix\.[\s\S]*?--merge\b/.test(
		text,
	), 'each `merge` matrix leg must pass `--merge` so the integration mode is ' +
		'TIED to the matrix shape (a leg can never propose-only / desync from the ' +
		'dispatch mode).');
	// No host-specific cross-job serialiser on the merge job: a GitHub Actions
	// `concurrency:` block there would make cross-job land safety depend on a host
	// feature, breaking the git-alone-floor framing (Applied Answer q1).
	require('merge-no-host-concurrency-serialiser', !/advance-merge:[\s\S]*?\n\s{4}concurrency:/.test(
		text,
	), 'the `merge` job must NOT carry a `concurrency:` group: a host-specific ' +
		'serialiser would make the cross-job land safety depend on a GitHub Actions ' +
		"feature; the engine's `mergeRetries` CAS-retry loop is the git-alone floor.");

	// --- The DORFL_* gate family must NOT be carried as workflow env -----
	// The workflow emits NO active gate env line for any of AUTO_BUILD / AUTO_TASK
	// / OBSERVATION_TRIAGE / SURFACE_BLOCKERS: the env layer is the OPTIONAL CI-only
	// override layer, NOT the carrier of defaults. Emitting any of them would FORCE
	// env to win over the repo's own .dorfl.json (the precedence is
	// flag > env > per-repo > global > default), silently shadowing per-repo gate
	// config in CI — exactly the bug this task closes. A user who genuinely wants a
	// CI-SPECIFIC override adds the env var themselves (the opt-in CI override the
	// env layer is FOR). Check the OPERATIVE (non-comment) lines so the explanatory
	// header comment that NAMES these keys is not a false positive.
	require('no-gate-env-auto-build', !/DORFL_AUTO_BUILD\s*:/.test(
		operative,
	), 'the workflow must NOT emit an `DORFL_AUTO_BUILD:` env assignment ' +
		'(env carries no defaults; the gate is resolved from per-repo config / built-in default).');
	require('no-gate-env-auto-task', !/DORFL_AUTO_TASK\s*:/.test(
		operative,
	), 'the workflow must NOT emit an `DORFL_AUTO_TASK:` env assignment ' +
		'(env carries no defaults; the gate is resolved from per-repo config / built-in default).');
	require('no-gate-env-observation-triage', !/DORFL_OBSERVATION_TRIAGE\s*:/.test(
		operative,
	), 'the workflow must NOT emit an `DORFL_OBSERVATION_TRIAGE:` env ' +
		'assignment (env carries no defaults; resolved from per-repo config / built-in default).');
	require('no-gate-env-surface-blockers', !/DORFL_SURFACE_BLOCKERS\s*:/.test(
		operative,
	), 'the workflow must NOT emit an `DORFL_SURFACE_BLOCKERS:` env ' +
		'assignment (env carries no defaults; resolved from per-repo config / built-in default).');
	// --- Gate-family DISPATCH OVERRIDES (one-shot, dispatch only) ---------------
	// Each gate is exposed as a `workflow_dispatch` input AND its override is wired
	// (as a guarded `$GITHUB_ENV` write, NOT a YAML `env:` key — so the
	// `no-gate-env-*` invariants above still hold) into EVERY job that resolves the
	// gate family: `enumerate` (it gates the matrix pools via `scan`), plus the two
	// agent-running jobs. The enumerate wiring is the load-bearing one: without it a
	// dispatch override of `observationTriage`/`surfaceBlockers`/`autoTask` produces
	// an empty matrix and is silently inert (the bug this task's review caught).
	for (const input of [
		'autoBuild',
		'autoTask',
		'observationTriage',
		'surfaceBlockers',
	]) {
		require(`dispatch-${input}-input`, new RegExp(
			`workflow_dispatch:[\\s\\S]*?inputs:[\\s\\S]*?\\b${input}:`,
		).test(
			text,
		), `the \`workflow_dispatch\` must carry a \`${input}\` gate-override input.`);
	}
	for (const [input, envVar] of [
		['autoBuild', 'DORFL_AUTO_BUILD'],
		['autoTask', 'DORFL_AUTO_TASK'],
		['observationTriage', 'DORFL_OBSERVATION_TRIAGE'],
		['surfaceBlockers', 'DORFL_SURFACE_BLOCKERS'],
	] as const) {
		// The override is a guarded shell write: `[ -n <input> ] && echo <ENV>=<input> >> $GITHUB_ENV`.
		const guardedWrite = new RegExp(
			`\\[ -n "\\$\\{\\{ github\\.event\\.inputs\\.${input} \\}\\}" \\][\\s\\S]*?${envVar}=`,
		);
		require(`dispatch-${input}-guarded-write`, guardedWrite.test(
			text,
		), `the \`${input}\` override must be a blank-guarded write of \`${envVar}\` ` +
			'to `$GITHUB_ENV` (blank dispatch input / schedule / push emit nothing).');
	}
	// The ENUMERATE job MUST carry the override before its `scan` step — else the
	// matrix pools are built from the un-overridden gates and the override is inert.
	require('enumerate-carries-gate-override', /enumerate:[\s\S]*?DORFL_OBSERVATION_TRIAGE=[\s\S]*?id: scan/.test(
		text,
	), 'the `enumerate` job must apply the dispatch gate override BEFORE its `scan` ' +
		'step (scan gates the matrix pools by the gate family; otherwise the ' +
		'override is silently inert for the lifecycle/task pools).');
	// The override must be GUARDED by the workflow_dispatch event so schedule/push
	// runs never even enter the write step.
	require('gate-override-dispatch-guarded', /if:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch'\s*\}\}/.test(
		text,
	), 'the gate-override step must be guarded by `if: github.event_name == ' +
		"'workflow_dispatch'` so schedule/push ticks export nothing.");

	// There is NO autoAdvance gate (the lifecycle decomposes into the gate family).
	require('no-auto-advance-gate', !/DORFL_AUTO_ADVANCE\b/.test(operative) &&
		!/autoAdvance/.test(
			operative,
		), 'there must be NO `autoAdvance` gate (the lifecycle decomposes into the ' +
		'existing gate family; ADR ci-config-policy-and-gate-family §2).');

	// --- Capability F: the reap job + sweep input PRESERVED (not stripped) ------
	require('reap-merged-branches-job', /reap-merged-branches:/.test(
		text,
	), "the absorbed seed's `reap-merged-branches` job (capability F) must be " +
		'PRESERVED, not stripped.');
	require('reap-uses-gc-remote-branches', /dorfl gc --remote-branches\b/.test(
		text,
	), 'the reap job must run `dorfl gc --remote-branches` (the provider-' +
		'agnostic merged-branch sweep).');
	require('reap-sweep-dispatch-input', /sweepMergedBranches:/.test(
		text,
	), 'the `sweepMergedBranches` dispatch input (capability F, opt-out) must be ' +
		'preserved.');
	// The ORPHAN-SIDECAR reap (prd
	// `agentic-question-resolution-retire-disposition-vocabulary`, US #10) rides
	// the SAME scheduled `dorfl gc --remote-branches` invocation, so it provably
	// FIRES on the cron tick (not behind an un-passed flag). The reap step that
	// runs `gc --remote-branches` MUST be checked out WITH a working tree (the
	// orphan sweep is working-tree based: it reads `work/questions/` + the
	// lifecycle folders from the checkout). `actions/checkout` provides that, and
	// the step's name/comment names the orphan-sidecar duty so the linkage is not
	// silently lost on a future template edit.
	require('reap-checks-out-working-tree', /reap-merged-branches:[\s\S]*?uses:\s*actions\/checkout/.test(
		text,
	), 'the reap job must `actions/checkout` a working tree before ' +
		'`gc --remote-branches`: the orphan-sidecar sweep that rides that invocation ' +
		'reads `work/questions/` + the lifecycle folders from the checkout.');
	require('reap-names-orphan-sidecars', /reap-merged-branches:[\s\S]*?orphan sidecar/i.test(
		text,
	), 'the reap step (running `gc --remote-branches`) must name the ORPHAN ' +
		'SIDECAR reap it ALSO performs (US #10), so the scheduled invocation that ' +
		'fires it is visible and not silently dropped on a future edit.');

	// --- CI runs IN-PLACE: no isolation machinery ------------------------------
	require('no-isolated-flag', !/--isolated\b/.test(
		operative,
	), 'CI runs IN-PLACE (the container IS the isolation): no `--isolated` flag.');
	// Guard `--remote` the LAPTOP affordance, but NOT `--remote-branches` (the
	// preserved capability-F `gc --remote-branches` sweep): a negative lookahead
	// for a following `-`/word char so the gc flag is not a false positive.
	require('no-remote-flag', !/--remote(?![-\w])/.test(
		operative,
	), 'CI runs IN-PLACE: no `--remote` flag (laptop-only affordance).');

	// --- A CI concurrency group ------------------------------------------------
	require('concurrency-group', /\bconcurrency:\s*[\s\S]*?group:/.test(
		text,
	), 'must carry a CI `concurrency.group` so overlapping ticks never collide.');

	// --- US #9: NO `workflows` permission; cannot self-edit triggers ------------
	require('no-workflows-permission', !/\bworkflows:\s*write\b/.test(
		text,
	), 'the running job must request NO `workflows` permission (US #9: it can ' +
		'never edit `.github/workflows/**` / rewrite its own triggers).');
	require('never-edits-dot-github-workflows', !/\.github\/workflows\//.test(
		operative,
	), 'no emitted job step may touch `.github/workflows/**` (US #9).');

	// --- Explicit slug prefixes, never bare ------------------------------------
	require('explicit-task-prefix', /"task:" \+ \.slug/.test(text) ||
		/task:/.test(
			text,
		), 'CI must use explicit `task:`/`prd:` slug prefixes, never bare (ADR ' +
		'command-surface-and-journeys §3a).');

	// --- The propose `enumerate` matrix must UNION taskable prds --------------
	// (`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`): a
	// task-only `jq` would render `DORFL_AUTO_TASK: 'true'` dead on the
	// hourly cron — a ready ungated PRD would never become a matrix leg. The `jq`
	// must enumerate `prd:<slug>` ids from `scan --json`'s taskable-SPEC pool
	// (`repos[].specs[]` + `cwd.repo.specs[]`) alongside the eligible-task legs.
	require('propose-enumerates-taskable-specs', /"prd:" \+ \.slug/.test(text) &&
		/\.specs\[\]/.test(
			text,
		), 'the propose-mode `enumerate` `jq` must union taskable specs into the ' +
		"matrix as `prd:<slug>` legs (read from `scan --json`'s `repos[].specs[]` " +
		'+ `cwd.repo.specs[]` pools), so a ready ungated SPEC becomes one auto-task ' +
		'matrix leg per item alongside the eligible-task legs ' +
		'(`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`).');

	// --- The propose `enumerate` matrix must UNION the LIFECYCLE pools ----------
	// (`ci-propose-matrix-enumerates-lifecycle-items`): a build/task-only `jq`
	// runs the answer-loop ONLY in merge mode — a `needsAnswers` item is
	// `eligible:false` and untriaged observations are not in the task/prd pools at
	// all, so NO lifecycle rung (triage/surface/apply) ever gets a propose leg. The
	// `jq` must enumerate the three lifecycle sub-pools from `scan --json`
	// (`repos[].lifecycle.*` + `cwd.repo.lifecycle.*`): `triage[]` → `obs:<slug>`,
	// and `surface[]`/`apply[]` → `.namespace + ":" + .slug`. Match all four shape
	// signals so a regression that drops any one leg is caught.
	require('propose-enumerates-lifecycle-items', /"obs:" \+ \.slug/.test(text) &&
		/\.lifecycle\.triage\[\]/.test(text) &&
		/\.lifecycle\.surface\[\]/.test(text) &&
		/\.lifecycle\.apply\[\]/.test(text) &&
		/\.namespace \+ ":" \+ \.slug/.test(
			text,
		), 'the propose-mode `enumerate` `jq` must union the LIFECYCLE pools into the ' +
		"matrix (read from `scan --json`'s `repos[].lifecycle.*` + " +
		'`cwd.repo.lifecycle.*`): `triage[]` as `obs:<slug>` legs, and ' +
		'`surface[]`/`apply[]` as `.namespace + ":" + .slug` (`task:`/`prd:`, plus ' +
		'`observation:` for an answered-observation apply leg) legs, ' +
		'so the WHOLE answer-loop (triage + surface + apply) runs in propose mode, ' +
		'not only in merge mode ' +
		'(`ci-propose-matrix-enumerates-lifecycle-items`).');

	// --- Wires the SHARED composite setup action -------------------------------
	require('uses-shared-setup-action', /uses:\s*\.\/\.github\/actions\/dorfl-setup\b/.test(
		text,
	), 'every job must wire the shared composite setup action ' +
		'(`./.github/actions/dorfl-setup`, emitted by the core task).');

	return {ok: problems.length === 0, problems};
}
