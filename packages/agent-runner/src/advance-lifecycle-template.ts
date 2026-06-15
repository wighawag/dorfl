/**
 * The `install-ci` ADVANCE-LIFECYCLE capability (PRD `runner-in-ci`, slice
 * `install-ci-advance-lifecycle-workflow`; capability C: auto-triage observations
 * + surface declared blockers + apply committed answers). This module GENERATES
 * the advance-lifecycle workflow by ABSORBING and PARAMETERISING the existing seed
 * `docs/ci/advance-loop.yml.template` (the advance-loop capability's output) — it
 * does NOT hand-roll a competing advance workflow. It also STRUCTURALLY VALIDATES
 * the emitted YAML, mirroring the snapshot-assertion style of
 * `advance-ci-template.ts` / `build-slice-tick-template.ts` (the package depends on
 * NO YAML lib, so the checks are presence/shape assertions over the raw text).
 *
 * This is the "human is the clock" loop: CI drains the populated `work/` tree
 * toward done while the human only answers committed question sidecars on their own
 * time. Over the build/slice tick (its sibling capability), the advance-lifecycle
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
 *     calm defaults it degrades to exactly `do`'s build/slice behaviour. The verb
 *     is NEVER a user decision; the workflow tunes behaviour via the
 *     `AGENT_RUNNER_*` env block, not by swapping the verb. There is NO
 *     `autoAdvance` gate.
 *   - The two LIFECYCLE gates are ORTHOGONAL peers, both calm by default:
 *     `AGENT_RUNNER_OBSERVATION_TRIAGE` (`off`/`ask`/`auto`, calm `off`) governs the
 *     raw observation INBOX; `AGENT_RUNNER_SURFACE_BLOCKERS` (`true`/`false`, calm
 *     `false`) governs DECLARED `needsAnswers` work. "Groom my observations but
 *     leave my blocked work alone" = `OBSERVATION_TRIAGE: ask` + `SURFACE_BLOCKERS:
 *     false`. Applying a committed answer has NO gate.
 *   - ONE word `integrationMode` drives BOTH the job SHAPE AND the
 *     `--propose`/`--merge` flag (they can never desync): `propose` ⇒ a DYNAMIC
 *     matrix (`agent-runner scan --json | jq` enumerates one leg per eligible id,
 *     each leg carries `--propose` so it can NEVER merge to `main`); `merge` ⇒ a
 *     SINGLE SEQUENTIAL `advance -n <x> --merge` (merge contends on `main`, so it
 *     MUST linearise). This is integration-mode behaviour, IDENTICAL to the build
 *     tick (integration mode is verb-independent).
 *   - CI runs IN-PLACE (the CI container IS the isolation): no
 *     `--isolated`/`--remote`/registry. A CI concurrency group (per-ref) prevents
 *     overlapping ticks; the claim CAS is the real cross-run serialiser.
 *   - All invocations use explicit slug prefixes (`slice:`/`prd:`), never bare
 *     (ADR `command-surface-and-journeys` §3a).
 *   - The running CI job NEVER edits `.github/workflows/**` (US #9): it requests
 *     NO `workflows` permission and cannot rewrite its own triggers.
 *
 * The structural validator is the dependency-free counterpart of "the workflow
 * parses + carries the right discipline" the slice's acceptance criteria require;
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
 * composite setup action (`./.github/actions/agent-runner-setup`, emitted by the
 * core slice) into every job; (2) it surfaces the engine gate family — including
 * the two calm-default LIFECYCLE gates — as the `AGENT_RUNNER_*` env block, so the
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
# agent-runner — the ADVANCE LIFECYCLE loop in CI (capability C: auto-triage
# observations + surface declared blockers + apply committed answers, PRD
# runner-in-ci). EMITTED by \`agent-runner install-ci\` by PARAMETERISING the seed
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
# degrades to exactly \`do\`'s build/slice behaviour (ADR
# ci-config-policy-and-gate-family §1). The triage/surface/apply rungs + the
# on-answer-committed trigger are EXACTLY what \`advance\` adds over the build/slice
# tick. There is NO \`autoAdvance\` gate — the lifecycle decomposes into the gate
# family in the env block.
#
# ONE WORD, ONE MEANING — \`integrationMode\` drives BOTH the job SHAPE AND the
# \`--propose\`/\`--merge\` flag the legs pass, so they can NEVER desync:
#   * propose ⇒ a DYNAMIC matrix (one leg per eligible id, enumerated via
#               \`agent-runner scan --json | jq\`), each leg \`advance --propose\`
#               opening its OWN PR — a leg can NEVER merge to main.
#   * merge   ⇒ a SINGLE SEQUENTIAL \`advance -n <x> --merge\` — merge contends on
#               \`main\`, so it MUST linearise (parallel legs would thrash the
#               main-CAS). \`--merge\` rides ONLY this sequential job.
# This is integration-mode behaviour, IDENTICAL to the build/slice tick
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
    # (triage / surface / apply + build / slice). Adjust the cadence to taste
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
        description: 'Integration mode (drives BOTH the integration flag passed to \`advance\` AND the job shape): propose ⇒ a matrix, each leg \`advance --propose\` (one PR per item); merge ⇒ a single sequential \`advance -n --merge\` (rebase-chains to main).'
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

  # ── The engine GATE FAMILY, surfaced as the AGENT_RUNNER_* env block ─────────
  # CI is NOT a special policy surface (ADR ci-config-policy-and-gate-family §5):
  # it runs the SAME engine gates, resolved through flag > env > per-repo > global
  # > default. The SAME .agent-runner.json the laptop uses applies here; this env
  # block is just the optional CI-only override. Change behaviour by editing these
  # values (or a GitHub repo variable / .agent-runner.json key) — NOT by re-running
  # install-ci (ADR §6: install-ci is one-time).
  #
  # CALM DEFAULTS: the two LIFECYCLE gates sit at their quiet state, so out-of-the-
  # box this tick builds/slices and reports failures but asks NOTHING — it degrades
  # to exactly the build/slice tick's behaviour until you opt in. They are
  # ORTHOGONAL peers: OBSERVATION_TRIAGE governs the raw observation INBOX;
  # SURFACE_BLOCKERS governs DECLARED needsAnswers work. "Groom my observations but
  # leave my blocked work alone" = OBSERVATION_TRIAGE: ask + SURFACE_BLOCKERS:
  # false. Applying an already-committed answer has NO gate (a human's answer is
  # never stranded).
  AGENT_RUNNER_AUTO_BUILD: 'true' # capability A: auto-build ready slices
  AGENT_RUNNER_AUTO_SLICE: 'true' # capability B: auto-slice ready PRDs
  AGENT_RUNNER_OBSERVATION_TRIAGE: 'off' # calm default (off|ask|auto): leave the observation inbox untouched
  AGENT_RUNNER_SURFACE_BLOCKERS: 'false' # calm default (true|false): leave declared-blocked work silently blocked

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
      - uses: ./.github/actions/agent-runner-setup${setupWith}
      - name: advance one item in-place (propose ⇒ opens a PR)
        # In-place in this checkout (no --isolated/--remote): the CI container IS
        # the isolation. \`--propose\` can ONLY ride a matrix leg, never the merge
        # job, so a parallel merge-to-main is structurally impossible.
        # \`--propose\` shells \`gh\` to open the PR, which reads \`GH_TOKEN\` from the
        # env (a workflow PERMISSION is not a credential). Prefer a dedicated
        # \`AGENT_RUNNER_GH_TOKEN\` secret (a PAT / App token) so PRs carry YOUR
        # identity AND trigger downstream workflows (PRs opened with the built-in
        # \`GITHUB_TOKEN\` are \`github-actions[bot]\` and do NOT trigger further
        # \`on: pull_request\` runs). Falls back to the auto \`GITHUB_TOKEN\` so it
        # works zero-config; the job's \`pull-requests: write\` scopes that token.
        env:
          GH_TOKEN: \${{ secrets.AGENT_RUNNER_GH_TOKEN || secrets.GITHUB_TOKEN }}
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
      - uses: ./.github/actions/agent-runner-setup${setupWith}
      - name: advance the eligible pool sequentially in-place (merge ⇒ rebase-chains to main)
        # In-place (no --isolated/--remote). \`--merge\` rides ONLY this single
        # sequential job (never a matrix leg), so rebase-chained merges to main
        # happen one at a time — no parallel main-CAS thrash. The flag ties the
        # integration mode to this shape; it overrides the repo config default.
        # \`gh\` (merge / PR housekeeping) reads \`GH_TOKEN\` from the env.
        env:
          GH_TOKEN: \${{ secrets.AGENT_RUNNER_GH_TOKEN || secrets.GITHUB_TOKEN }}
        run: agent-runner advance -n 10 --merge --arbiter origin

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
      - uses: ./.github/actions/agent-runner-setup
      - name: reap merged remote work/* branches (gc --remote-branches)
        # Deletes ONLY branches provably merged into origin/main; reports
        # deleted-vs-retained-with-reason. Safe to run every tick (idempotent).
        run: agent-runner gc --remote-branches --arbiter origin
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
 * Structurally validate the advance-lifecycle workflow against the slice's
 * acceptance criteria. Dependency-free (no YAML lib): presence/shape assertions
 * over the raw text, mirroring {@link validateBuildSliceTickWorkflow} /
 * {@link validateAdvanceCiTemplate}.
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
	require('invokes-advance', /agent-runner advance\b/.test(
		text,
	), 'the workflow must invoke the `advance` driver (CI always runs `advance`).');
	require('never-invokes-do', !/agent-runner do\b/.test(
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
	// promptly. This is what `advance` adds over the build/slice tick.
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

	// --- The AGENT_RUNNER_* gate-family env block (calm lifecycle defaults) -----
	require('env-auto-build', /AGENT_RUNNER_AUTO_BUILD:/.test(
		text,
	), 'must expose the gate family via `AGENT_RUNNER_AUTO_BUILD` in the env block.');
	require('env-auto-slice', /AGENT_RUNNER_AUTO_SLICE:/.test(
		text,
	), 'must expose the gate family via `AGENT_RUNNER_AUTO_SLICE` in the env block.');
	// The two LIFECYCLE gates must be present at their CALM defaults so the
	// out-of-the-box tick degrades to build/slice-only with no questions. They are
	// ORTHOGONAL peers (one can be on while the other is off).
	require('env-observation-triage-calm', /AGENT_RUNNER_OBSERVATION_TRIAGE:\s*'off'/.test(
		text,
	), '`AGENT_RUNNER_OBSERVATION_TRIAGE` must default to the calm `off` state ' +
		'(off|ask|auto; no questions out of the box).');
	require('env-surface-blockers-calm', /AGENT_RUNNER_SURFACE_BLOCKERS:\s*'false'/.test(
		text,
	), '`AGENT_RUNNER_SURFACE_BLOCKERS` must default to the calm `false` state ' +
		'(true|false; no questions out of the box).');
	// There is NO autoAdvance gate (the lifecycle decomposes into the gate family).
	require('no-auto-advance-gate', !/AGENT_RUNNER_AUTO_ADVANCE\b/.test(
		operative,
	) &&
		!/autoAdvance/.test(
			operative,
		), 'there must be NO `autoAdvance` gate (the lifecycle decomposes into the ' +
		'existing gate family; ADR ci-config-policy-and-gate-family §2).');

	// --- Capability F: the reap job + sweep input PRESERVED (not stripped) ------
	require('reap-merged-branches-job', /reap-merged-branches:/.test(
		text,
	), "the absorbed seed's `reap-merged-branches` job (capability F) must be " +
		'PRESERVED, not stripped.');
	require('reap-uses-gc-remote-branches', /agent-runner gc --remote-branches\b/.test(
		text,
	), 'the reap job must run `agent-runner gc --remote-branches` (the provider-' +
		'agnostic merged-branch sweep).');
	require('reap-sweep-dispatch-input', /sweepMergedBranches:/.test(
		text,
	), 'the `sweepMergedBranches` dispatch input (capability F, opt-out) must be ' +
		'preserved.');

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
	require('explicit-slice-prefix', /"slice:" \+ \.slug/.test(text) ||
		/slice:/.test(
			text,
		), 'CI must use explicit `slice:`/`prd:` slug prefixes, never bare (ADR ' +
		'command-surface-and-journeys §3a).');

	// --- Wires the SHARED composite setup action -------------------------------
	require('uses-shared-setup-action', /uses:\s*\.\/\.github\/actions\/agent-runner-setup\b/.test(
		text,
	), 'every job must wire the shared composite setup action ' +
		'(`./.github/actions/agent-runner-setup`, emitted by the core slice).');

	return {ok: problems.length === 0, problems};
}
