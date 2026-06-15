/**
 * The `install-ci` BUILD/SLICE TICK capability (PRD `runner-in-ci`, slice
 * `install-ci-build-slice-tick-workflow`; capabilities A auto-build + B
 * auto-slice). This module GENERATES the one fixed workflow file for the
 * build/slice tick and STRUCTURALLY VALIDATES it, mirroring the snapshot-assertion
 * style of `advance-ci-template.ts` (the package depends on NO YAML lib, so the
 * checks are presence/shape assertions over the raw text).
 *
 * The discipline is VERBATIM from the advance-loop seed
 * (`docs/ci/advance-loop.yml.template`), narrowed to the build/slice tick:
 *
 *   - CI ALWAYS invokes `advance` (ADR `ci-config-policy-and-gate-family` §1):
 *     `advance` is a strict superset of `do`, and with the lifecycle gates at
 *     their calm defaults it degrades to exactly `do`'s build/slice behaviour. The
 *     verb is NEVER a user decision; the workflow tunes behaviour via the
 *     `AGENT_RUNNER_*` env block, not by swapping the verb.
 *   - ONE word `integrationMode` drives BOTH the job shape AND the
 *     `--propose`/`--merge` flag (they can never desync): `propose` ⇒ a DYNAMIC
 *     matrix (`agent-runner scan --json | jq` enumerates one leg per eligible id,
 *     each leg carries `--propose` so it can NEVER merge to `main`); `merge` ⇒ a
 *     SINGLE SEQUENTIAL `advance -n <x> --merge` (merge contends on `main`, so it
 *     MUST linearise).
 *   - Triggers: cron (scheduled drain) + `workflow_dispatch` (manual
 *     catch-up/debug, carrying an `integrationMode` input). NO
 *     `push work/questions/**` trigger — that on-answer-committed loop is the
 *     SIBLING advance-lifecycle slice, not this build/slice tick.
 *   - The gate family is exposed via the workflow's `AGENT_RUNNER_*` env block
 *     (`AGENT_RUNNER_AUTO_BUILD` / `AGENT_RUNNER_AUTO_SLICE` + the two
 *     calm-default question gates), so out-of-the-box behaviour is build/slice-only
 *     with no questions. There is NO `autoAdvance` gate.
 *   - CI runs IN-PLACE (the CI container IS the isolation): no
 *     `--isolated`/`--remote`/registry. A CI concurrency group prevents overlapping
 *     ticks; the claim CAS is the real cross-run serialiser.
 *   - All invocations use explicit slug prefixes (`slice:`/`prd:`), never bare
 *     (ADR `command-surface-and-journeys` §3a).
 *   - The running CI job NEVER edits `.github/workflows/**` (US #9): it requests
 *     NO `workflows` permission and cannot rewrite its own triggers.
 *
 * The structural validator is the dependency-free counterpart of "the workflow
 * parses + carries the right discipline" the slice's acceptance criteria require;
 * the test generates this artifact under `--fake` and asserts every invariant.
 */

import type {EmittedFile, ResolvedCIConfig} from './install-ci-core.js';

/** The capability id (the registry key + the emitted workflow file stem). */
export const BUILD_SLICE_TICK_CAPABILITY_ID = 'build-slice-tick';

/** The wizard-facing label for the build/slice tick capability. */
export const BUILD_SLICE_TICK_CAPABILITY_LABEL =
	'Auto-build ready slices + auto-slice ready PRDs (the build/slice tick: cron + dispatch)';

/** The repo-relative path (under the output base) of the emitted workflow. */
export const BUILD_SLICE_TICK_WORKFLOW_PATH = 'workflows/build-slice-tick.yml';

/**
 * Generate the build/slice-tick workflow YAML. Deterministic: the same config
 * produces byte-identical output. The workflow is a FIXED shell (ADR §6: all
 * policy is env/config, so the artifact carries no config-derived policy beyond
 * the env-block scaffolding) — `config` is accepted for parity with the
 * {@link CapabilityEmitter} seam and future per-config wiring, but the build/slice
 * tick shape itself is config-independent.
 */
export function generateBuildSliceTickWorkflow(
	_config: ResolvedCIConfig,
): string {
	return `\
# agent-runner — the BUILD/SLICE tick in CI (capabilities A auto-build + B
# auto-slice, PRD runner-in-ci). EMITTED by \`agent-runner install-ci\`; the human
# commits it. DO NOT hand-edit a copy — re-run install-ci to upgrade the shell.
#
# CI ALWAYS invokes \`advance\` (NEVER a user-chosen verb): \`advance\` is a strict
# superset of \`do\`, and with the lifecycle question-gates at their calm defaults
# (below) it degrades to exactly \`do\`'s build/slice behaviour (ADR
# ci-config-policy-and-gate-family §1). "Calm build-only" is \`advance\` + both
# lifecycle gates off, NOT a different verb. There is NO \`autoAdvance\` gate.
#
# ONE WORD, ONE MEANING — \`integrationMode\` drives BOTH the job SHAPE AND the
# \`--propose\`/\`--merge\` flag the legs pass, so they can NEVER desync:
#   * propose ⇒ a DYNAMIC matrix (one leg per eligible id, enumerated via
#               \`agent-runner scan --json | jq\`), each leg \`advance --propose\`
#               opening its OWN PR — a leg can NEVER merge to main.
#   * merge   ⇒ a SINGLE SEQUENTIAL \`advance -n <x> --merge\` — merge contends on
#               \`main\`, so it MUST linearise (parallel legs would thrash the
#               main-CAS). \`--merge\` rides ONLY this sequential job.
# The CLAIM CAS, not the matrix, is the real cross-run serialiser: a leg that
# loses the claim race exits clean, never double-builds.
#
# CI runs IN-PLACE (the CI container IS the isolation): NO --isolated/--remote/
# registry (laptop-only affordances). The concurrency group below stops
# overlapping ticks of the same shape from colliding.
#
# SAFETY (US #9): the running job is FORBIDDEN from editing the workflows tree
# under .github. It requests NO \`workflows\` permission, so it can never rewrite
# its own triggers.

name: build-slice-tick

on:
  schedule:
    # Cron tick: drain ready slices (auto-build) + ready PRDs (auto-slice).
    # Adjust the cadence to taste (here: hourly).
    - cron: '0 * * * *'
  workflow_dispatch:
    inputs:
      integrationMode:
        description: 'Integration mode (drives BOTH the integration flag passed to \`advance\` AND the job shape): propose ⇒ a matrix, each leg \`advance --propose\` (one PR per item); merge ⇒ a single sequential \`advance -n --merge\` (rebase-chains to main).'
        required: false
        default: 'propose'
        type: choice
        options:
          - propose
          - merge

# Serialise overlapping ticks of the same shape; the claim CAS is the real
# cross-run serialiser, this just avoids redundant concurrent ticks.
concurrency:
  group: build-slice-tick-\${{ github.ref }}
  cancel-in-progress: false

# NO \`workflows\` permission: the running job can NEVER edit the workflows tree
# under .github (US #9). \`contents: write\` + \`pull-requests: write\` are all the
# build/slice tick needs (commit work, open PRs); it never rewrites its triggers.
permissions:
  contents: write
  pull-requests: write

env:
  # The resolved integration mode: the dispatch input when present, else \`propose\`
  # (the conservative default — one PR per item, a human merges). This single value
  # selects BOTH the job shape (via the \`if:\` guards below) AND the integration flag
  # the \`advance\` legs pass (\`--propose\`/\`--merge\`), so they can never desync.
  INTEGRATION_MODE: \${{ github.event.inputs.integrationMode || 'propose' }}

  # ── The engine GATE FAMILY, surfaced as the AGENT_RUNNER_* env block ─────────
  # CI is NOT a special policy surface (ADR ci-config-policy-and-gate-family §5):
  # it runs the SAME engine gates, resolved through flag > env > per-repo > global
  # > default. The SAME .agent-runner.json the laptop uses applies here; this env
  # block is just the optional CI-only override. Change behaviour by editing these
  # values (or a GitHub repo variable / .agent-runner.json key) — NOT by re-running
  # install-ci (ADR §6: install-ci is one-time).
  #
  # CALM DEFAULTS: the two lifecycle QUESTION-gates sit OFF, so out-of-the-box this
  # tick builds/slices and reports failures but asks NOTHING. Flip them on to opt
  # into the advance lifecycle (triage / surface) — no separate verb to discover.
  AGENT_RUNNER_AUTO_BUILD: 'true' # capability A: auto-build ready slices
  AGENT_RUNNER_AUTO_SLICE: 'true' # capability B: auto-slice ready PRDs
  AGENT_RUNNER_OBSERVATION_TRIAGE: 'off' # calm default: leave the observation inbox untouched
  AGENT_RUNNER_SURFACE_BLOCKERS: 'false' # calm default: leave declared-blocked work silently blocked

jobs:
  # ── ENUMERATE (propose only) ────────────────────────────────────────────────
  # Build the DYNAMIC matrix from the eligible-pool scan. \`scan --json\` reports
  # BOTH the registry/hub-mirror pool (\`repos[].items[]\`) AND the in-place working
  # checkout (\`cwd.repo.items[]\`); CI runs IN-PLACE so the eligible items live in
  # the latter (a fresh runner has no registered mirror). \`jq\` unions + dedups both
  # pools into a deduplicated GitHub Actions matrix list of explicit \`slice:<slug>\`
  # ids (CI MUST use explicit prefixes). Each becomes one matrix leg → one
  # independent \`advance\` → one PR. Skipped in merge mode.
  enumerate:
    if: \${{ (github.event.inputs.integrationMode || 'propose') == 'propose' }}
    runs-on: ubuntu-latest
    outputs:
      items: \${{ steps.scan.outputs.items }}
      any: \${{ steps.scan.outputs.any }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/agent-runner-setup
      - id: scan
        # Enumerate eligible items as namespaced ids, one matrix leg per id. CI
        # uses explicit \`slice:\` prefixes, never bare (ADR command-surface §3a).
        run: |
          items="$(agent-runner scan --json \\
            | jq -c '[(.repos[].items[]?, .cwd.repo.items[]?) | select(.eligibility.eligible == true) | "slice:" + .slug] | unique')"
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
  # merge to main. Explicit \`slice:\`/\`prd:\` prefixes only, never bare.
  advance-propose:
    needs: enumerate
    if: \${{ (github.event.inputs.integrationMode || 'propose') == 'propose' && needs.enumerate.outputs.any == 'true' }}
    runs-on: ubuntu-latest
    strategy:
      # Independent PRs: one failing item must NOT cancel the others.
      fail-fast: false
      matrix:
        item: \${{ fromJson(needs.enumerate.outputs.items) }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/agent-runner-setup
      - name: advance one item in-place (propose ⇒ opens a PR)
        # In-place in this checkout (no --isolated/--remote): the CI container IS
        # the isolation. \`--propose\` can ONLY ride a matrix leg, never the merge
        # job, so a parallel merge-to-main is structurally impossible.
        run: agent-runner advance "\${{ matrix.item }}" --propose --arbiter origin

  # ── MERGE: a SINGLE SEQUENTIAL job ───────────────────────────────────────────
  # merge-mode items chain via rebase; parallel jobs would thrash the main-CAS.
  # One sequential driver (\`advance -n <x>\`, ALWAYS sequential) drains the pool.
  # The fully-autonomous-to-main path (this job + all gates on) is a LOUD,
  # NON-DEFAULT opt-in: the default integrationMode is \`propose\`, so reaching
  # merge-to-main requires deliberately dispatching/pinning \`merge\`.
  advance-merge:
    if: \${{ (github.event.inputs.integrationMode || 'propose') == 'merge' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/agent-runner-setup
      - name: advance the eligible pool sequentially in-place (merge ⇒ rebase-chains to main)
        # In-place (no --isolated/--remote). \`--merge\` rides ONLY this single
        # sequential job (never a matrix leg), so rebase-chained merges to main
        # happen one at a time — no parallel main-CAS thrash. The flag ties the
        # integration mode to this shape; it overrides the repo config default.
        run: agent-runner advance -n 10 --merge --arbiter origin
`;
}

/** A single structural problem found in the generated workflow. */
export interface BuildSliceTickProblem {
	/** A short, stable id for the violated invariant (for tests/assertions). */
	id: string;
	/** Human-readable description of what is missing or wrong. */
	message: string;
}

/** The result of {@link validateBuildSliceTickWorkflow}. */
export interface BuildSliceTickValidation {
	/** True iff the workflow satisfies EVERY structural invariant. */
	ok: boolean;
	/** Each violated invariant (empty when `ok`). */
	problems: BuildSliceTickProblem[];
}

/**
 * Structurally validate the build/slice-tick workflow against the slice's
 * acceptance criteria. Dependency-free (no YAML lib): presence/shape assertions
 * over the raw text, mirroring {@link validateAdvanceCiTemplate}.
 */
export function validateBuildSliceTickWorkflow(
	text: string,
): BuildSliceTickValidation {
	const problems: BuildSliceTickProblem[] = [];
	const require = (id: string, present: boolean, message: string): void => {
		if (!present) {
			problems.push({id, message});
		}
	};

	// The OPERATIVE (non-comment) lines: the prohibitions below (no `--isolated`/
	// `--remote`/`do`/`autoAdvance`/`.github/workflows` self-edit) are about what
	// the job DOES, not what the explanatory comments MENTION. A YAML `#` comment
	// line is documentation, so strip full-line comments before the negative checks
	// (a leg legitimately documenting "no --isolated" must not trip the gate). The
	// positive presence checks run over the full text (comments are harmless there).
	const operative = text
		.split('\n')
		.filter((line) => !/^\s*#/.test(line))
		.join('\n');

	// --- Always invokes `advance`, NEVER `do` ----------------------------------
	require('invokes-advance', /agent-runner advance\b/.test(
		text,
	), 'the workflow must invoke the `advance` driver (CI always runs `advance`).');
	require('never-invokes-do', !/agent-runner do\b/.test(
		operative,
	), 'the workflow must NEVER invoke `do` directly (CI always invokes `advance`, ' +
		'ADR ci-config-policy-and-gate-family §1).');

	// --- Triggers: cron + workflow_dispatch (NOT the answer-loop push) ----------
	require('trigger-cron', /\bschedule:\s*[\s\S]*?-\s*cron:/.test(
		text,
	), 'must trigger on a cron schedule (`on.schedule[].cron`).');
	require('trigger-workflow-dispatch', /\bworkflow_dispatch:/.test(
		text,
	), 'must trigger on `workflow_dispatch` (manual catch-up/debug).');
	require('dispatch-integration-mode-input', /workflow_dispatch:[\s\S]*?inputs:[\s\S]*?integrationMode:/.test(
		text,
	), 'the `workflow_dispatch` must carry an `integrationMode` input.');
	// The build/slice tick must NOT carry the on-answer-committed push trigger —
	// that is the SIBLING advance-lifecycle (answer-loop) slice's concern.
	require('no-answer-loop-push-trigger', !/work\/questions\//.test(
		text,
	), 'the build/slice tick must NOT carry the `push work/questions/**` ' +
		'(answer-loop) trigger — that is the sibling advance-lifecycle slice.');

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
	require('propose-enumerates-via-scan', /agent-runner scan --json/.test(
		text,
	), 'the matrix items must be ENUMERATED via the eligible-pool scan ' +
		'(`agent-runner scan --json`).');
	require('propose-one-advance-per-item', /agent-runner advance "?\$\{\{\s*matrix\./.test(
		text,
	), 'each matrix leg must run one `agent-runner advance <matrix item>` ' +
		'(one PR per item).');
	require('propose-leg-carries-propose-flag', /advance-propose:[\s\S]*?agent-runner advance "?\$\{\{\s*matrix\.[\s\S]*?--propose\b/.test(
		text,
	), 'each `propose` matrix leg must pass `--propose` so the integration mode is ' +
		'TIED to the matrix shape (a leg can never merge to main / desync from the ' +
		'dispatch mode).');

	// --- merge ⇒ a SINGLE SEQUENTIAL `advance -n <x> --merge` -------------------
	require('merge-sequential-n-driver', /agent-runner advance -n\b/.test(
		text,
	), '`merge` mode must run a SINGLE SEQUENTIAL job invoking the `-n` driver ' +
		'(`agent-runner advance -n <x>`).');
	require('merge-job-carries-merge-flag', /agent-runner advance -n\b[^\n]*--merge\b/.test(
		text,
	), 'the `merge` job must pass `--merge` on its `advance -n` driver so the ' +
		'integration mode is TIED to the single-sequential shape.');
	require('merge-flag-not-on-matrix-leg', !/agent-runner advance "?\$\{\{\s*matrix\.[^\n]*--merge\b/.test(
		text,
	), '`--merge` must NOT ride a matrix leg (parallel merge-to-main would thrash ' +
		'the main-CAS); it belongs ONLY on the single sequential `advance -n` job.');
	require('merge-no-matrix', !/advance-merge:[\s\S]*?strategy:\s*[\s\S]*?matrix:/.test(
		text,
	), 'the `merge` job must NOT use a matrix (parallel merge jobs would thrash ' +
		'the main-CAS).');

	// --- The AGENT_RUNNER_* gate-family env block (calm defaults) ---------------
	require('env-auto-build', /AGENT_RUNNER_AUTO_BUILD:/.test(
		text,
	), 'must expose the gate family via `AGENT_RUNNER_AUTO_BUILD` in the env block.');
	require('env-auto-slice', /AGENT_RUNNER_AUTO_SLICE:/.test(
		text,
	), 'must expose the gate family via `AGENT_RUNNER_AUTO_SLICE` in the env block.');
	// The two question-gates must be present at their CALM defaults so the
	// out-of-the-box behaviour is build/slice-only with no questions.
	require('env-observation-triage-calm', /AGENT_RUNNER_OBSERVATION_TRIAGE:\s*'off'/.test(
		text,
	), '`AGENT_RUNNER_OBSERVATION_TRIAGE` must default to the calm `off` state ' +
		'(no questions out of the box).');
	require('env-surface-blockers-calm', /AGENT_RUNNER_SURFACE_BLOCKERS:\s*'false'/.test(
		text,
	), '`AGENT_RUNNER_SURFACE_BLOCKERS` must default to the calm `false` state ' +
		'(no questions out of the box).');
	// There is NO autoAdvance gate (the lifecycle decomposes into the gate family).
	require('no-auto-advance-gate', !/AGENT_RUNNER_AUTO_ADVANCE\b/.test(
		operative,
	) &&
		!/autoAdvance/.test(
			operative,
		), 'there must be NO `autoAdvance` gate (the lifecycle decomposes into the ' +
		'existing gate family; ADR ci-config-policy-and-gate-family §2).');

	// --- CI runs IN-PLACE: no isolation machinery ------------------------------
	require('no-isolated-flag', !/--isolated\b/.test(
		operative,
	), 'CI runs IN-PLACE (the container IS the isolation): no `--isolated` flag.');
	require('no-remote-flag', !/--remote\b/.test(
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
	require('explicit-slice-prefix', /"slice:" \+ \.slug/.test(text) ||
		/slice:/.test(
			text,
		), 'CI must use explicit `slice:`/`prd:` slug prefixes, never bare (ADR ' +
		'command-surface-and-journeys §3a).');

	return {ok: problems.length === 0, problems};
}
