/**
 * The `install-ci` ADVANCE-LIFECYCLE capability (spec `runner-in-ci`, task
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
 *   - the on-answer-committed trigger `on: push work/questions/**` (on the
 *     default branch only), which re-runs the loop promptly when a question
 *     sidecar is answered;
 *   - (already in the absorbed seed) capability F — the `reap-merged-branches` job
 *     (`gc --remote-branches`) on the same `schedule:` cron, opt-out via the
 *     `sweepMergedBranches` dispatch input;
 *   - (also in the seed) the no-agent `surface-merge-questions` job (`dorfl
 *     surface-merge-questions`, task `wire-merge-questions-into-the-advance-tick`),
 *     which asks a merge question for each unmerged work branch with no open PR,
 *     behind the `mergeQuestions` config gate.
 *
 * THE SPLIT (spec `ci-agent-job-without-write-token`, ADR
 * `ci-agent-job-holds-no-write-token`, task `ci-split-generate-workflows`): the
 * tick runs NO agent itself. `enumerate` (`contents: read`) lists the eligible
 * items; a `dispatch` job (`actions: write` ONLY, no checkout, no setup) starts
 * one `dorfl-item-dispatch.yml` run per item, which calls `dorfl-item.yml`
 * (lock, agent, apply; `dorfl-item-template.ts`). There is no matrix any more:
 * a matrix would put every item's artifact in one shared namespace (decision 1).
 *
 * The discipline:
 *
 *   - CI ALWAYS invokes `advance` (ADR `ci-config-policy-and-gate-family` §1),
 *     now inside the per-item workflow. There is NO `autoAdvance` gate.
 *   - The two LIFECYCLE gates are ORTHOGONAL peers, both calm by default
 *     (`observationTriage` off, `surfaceBlockers` false). Applying a committed
 *     answer has NO gate.
 *   - ONE word `integrationMode` drives the `--propose`/`--merge` flag every
 *     item run passes (the `dispatch` job forwards it). In merge mode the LAND
 *     tail (rebase + CAS push to `main`) is serialised by the engine's
 *     `mergeRetries` CAS-retry loop in the apply job, NOT by the workflow
 *     shape; a lost CAS re-runs the rebase and the push only, never the gate
 *     (decision 2), and the apply phase reports every land whose tree differs
 *     from the gated one.
 *   - CI runs IN-PLACE (the CI container IS the isolation): no
 *     `--isolated`/`--remote`/registry. A per-ref concurrency group prevents
 *     overlapping ticks; the claim CAS is the real cross-run serialiser.
 *   - All invocations use explicit slug prefixes (`task:`/`spec:`), never bare
 *     (ADR `command-surface-and-journeys` §3a).
 *   - The running CI job NEVER edits `.github/workflows/**` (US #9): it requests
 *     NO `workflows` permission and cannot rewrite its own triggers.
 *
 * The structural validator is the dependency-free counterpart of "the workflow
 * parses + carries the right discipline" the task's acceptance criteria require;
 * the test generates this artifact under `--fake` and asserts every invariant.
 */

import {ACTION_PINS, pinnedUses} from './install-ci-action-pins.js';
import type {ResolvedCIConfig} from './install-ci-core.js';
import {WRITER_SETUP_ACTION_USES} from './install-ci-core.js';
import {
	GATE_OVERRIDES,
	ITEM_DISPATCH_WORKFLOW_FILE,
	ITEM_RUN_NAME_PREFIX,
	gateOverridesStep,
} from './dorfl-item-template.js';

/** The capability id (the registry key + the emitted workflow file stem). */
export const ADVANCE_LIFECYCLE_CAPABILITY_ID = 'advance-lifecycle';

/** The wizard-facing label for the advance-lifecycle capability. */
export const ADVANCE_LIFECYCLE_CAPABILITY_LABEL =
	'Auto-triage observations + surface declared blockers + apply committed answers (the advance lifecycle loop: cron + dispatch + on-answer-committed)';

/** The repo-relative path (under the output base) of the emitted workflow. */
export const ADVANCE_LIFECYCLE_WORKFLOW_PATH =
	'workflows/advance-lifecycle.yml';

/**
 * The `dispatch` job's shell (a `run: |` body, 10-space indented): list the
 * `dorfl-item-dispatch.yml` runs that are not completed, then start one run per
 * item of `ITEMS` (slot = index mod `MAX_PARALLEL`), skipping an item whose
 * `dorfl-item <item>` run is still queued, pending or in progress. Every value
 * arrives through `env:`; it prints one line per item (dispatched or skipped).
 * Exported for the template test, which runs it with `gh` stubbed.
 */
export const DISPATCH_SCRIPT = `\
          set -euo pipefail
          # The item runs that have not completed yet (queued, waiting in a
          # slot, or in progress), by run name.
          active="$(gh run list -R "\${REPO}" --workflow ${ITEM_DISPATCH_WORKFLOW_FILE} --limit 1000 --json displayTitle,status --jq '.[] | select(.status != "completed") | .displayTitle')"
          mapfile -t items < <(printf '%s' "\${ITEMS}" | jq -r '.[]')
          i=0
          for item in "\${items[@]}"; do
            slot=$(( i % MAX_PARALLEL ))
            i=$(( i + 1 ))
            if printf '%s\\n' "\${active}" | grep -Fxq -- "${ITEM_RUN_NAME_PREFIX} \${item}"; then
              echo "skipped    \${item}  slot \${slot}  (its '${ITEM_RUN_NAME_PREFIX} \${item}' run is not completed)"
              continue
            fi
            args=(-f "item=\${item}" -f "slot=\${slot}" -f "integrationMode=\${INTEGRATION_MODE}")
${GATE_OVERRIDES.map(
	(g) =>
		`            if [ -n "\${${g.env.replace(/^DORFL_/, 'DISPATCH_')}}" ]; then args+=(-f "${g.input}=\${${g.env.replace(/^DORFL_/, 'DISPATCH_')}}"); fi`,
).join('\n')}
            gh workflow run ${ITEM_DISPATCH_WORKFLOW_FILE} -R "\${REPO}" --ref "\${DEFAULT_BRANCH}" "\${args[@]}"
            echo "dispatched \${item}  slot \${slot}  (run '${ITEM_RUN_NAME_PREFIX} \${item}')"
          done`;

/**
 * Generate the advance-lifecycle workflow YAML by PARAMETERISING the seed
 * `docs/ci/advance-loop.yml.template`. Deterministic: the same config produces
 * byte-identical output. The only config it reads is `maxParallel` (the number
 * of concurrency slots the `dispatch` job spreads the item runs over).
 */
export function generateAdvanceLifecycleWorkflow(
	config: ResolvedCIConfig,
): string {
	const enumerateGate = gateOverridesStep({
		source: 'github.event.inputs',
		ifDispatch: true,
		comment: `\
        # MUST run BEFORE \`scan\`: scan's pools are gated by the SAME engine
        # gate family (autoTask/autoBuild + lifecycle observationTriage/
        # surfaceBlockers), so an override that does not reach this job empties
        # the item list and is silently inert. \`if:\` + the inner \`[ -n ... ]\`
        # guard keep schedule/push (and a blank dispatch field) exporting
        # NOTHING: an empty DORFL_* would make env-config coercion throw. The
        # inputs reach the shell through \`env:\` as DATA, never as \`\${{ }}\` text
        # spliced into the script, and the \`case\` guards stop a value from
        # appending its own lines to $GITHUB_ENV.`,
	});
	const dispatchGateEnv = GATE_OVERRIDES.map(
		(g) =>
			`          ${g.env.replace(/^DORFL_/, 'DISPATCH_')}: \${{ github.event.inputs.${g.input} }}`,
	).join('\n');
	return `\
# dorfl — the ADVANCE LIFECYCLE loop in CI (capability C: auto-triage
# observations + surface declared blockers + apply committed answers, spec
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
# superset of \`do\`, and with the lifecycle gates at their calm defaults it
# degrades to exactly \`do\`'s build/task behaviour (ADR
# ci-config-policy-and-gate-family §1). There is NO \`autoAdvance\` gate.
#
# THE SPLIT (ADR ci-agent-job-holds-no-write-token): THIS workflow runs no agent.
# \`enumerate\` lists the eligible items; \`dispatch\` starts ONE
# dorfl-item-dispatch.yml run per item, which calls dorfl-item.yml: a lock job
# (write token, no agent), an agent job (read-only token, no persisted
# credential) and an apply job (write token, no agent). One run per item gives
# each item its own artifact namespace. Parallelism: the item runs spread over
# maxParallel concurrency slots (\`queue: max\`), so at most that many run at
# once and the rest wait without using runner minutes.
#
# ONE WORD, ONE MEANING — \`integrationMode\` is forwarded to every item run,
# which passes it to \`advance\` as \`--propose\`/\`--merge\`:
#   * propose ⇒ each item opens its OWN PR; an item run can NEVER merge to main.
#   * merge   ⇒ each item lands on main. The LAND tail (rebase + CAS push) is
#               serialised by the engine's \`mergeRetries\` CAS-retry loop in the
#               apply job, NOT by a workflow shape: a non-fast-forward push
#               re-rebases and retries, never a \`--force\`. A lost CAS does NOT
#               re-run the gate (the gate ran in the agent job, minutes
#               earlier); the apply phase reports every land whose tree differs
#               from the gated tree ("landed without re-gate after N lost
#               races") in its output and the landed commit's trailer.
# The CLAIM CAS, not the workflow, is the real cross-run serialiser: an item run
# that loses the claim race exits clean, and a duplicate run re-classifies at the
# fresh arbiter tip.
#
# CI runs IN-PLACE (the CI container IS the isolation): NO --isolated/--remote/
# registry (laptop-only affordances). The concurrency group below stops
# overlapping ticks of the same ref from colliding.
#
# SAFETY (US #9): no job here requests a \`workflows\` permission, so none can
# rewrite its own triggers.

name: advance-lifecycle

on:
  schedule:
    # Cron tick: drain whatever the human has answered/produced since the last run
    # (triage / surface / apply + build / task). Adjust the cadence to taste
    # (here: hourly).
    - cron: '0 * * * *'
  push:
    # On-answer-committed: a push to the DEFAULT BRANCH that touches an answered
    # question sidecar (\`work/questions/**\`) re-runs the loop so the human's
    # answer is applied promptly. Pinned to main: a work-branch push touching a
    # sidecar must never run the lifecycle on that branch.
    branches:
      - main
    paths:
      - 'work/questions/**'
  workflow_dispatch:
    inputs:
      integrationMode:
        description: "Integration mode, forwarded to every item run as \`advance --propose\`/\`--merge\`: propose ⇒ one PR per item; merge ⇒ each item lands on main (the LAND tail is serialised by the engine's \`mergeRetries\` CAS-retry loop, not by the workflow shape)."
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
      # blank ⇒ emit NOTHING (the committed dorfl.json wins); a non-blank choice ⇒
      # export the matching DORFL_* in \`enumerate\` and forward it to every item
      # run (its lock, agent and apply jobs).
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

# Nothing at workflow level: each job grants its own scopes. NO job requests a
# \`workflows\` permission (US #9).
permissions: {}

# ── The engine GATE FAMILY is resolved FROM CONFIG, not carried here ─────────
# CI is NOT a special policy surface (ADR ci-config-policy-and-gate-family §5):
# it runs the SAME engine gates, resolved through flag > env > per-repo > global
# > default. This workflow emits NO DORFL_AUTO_BUILD / DORFL_AUTO_TASK /
# DORFL_OBSERVATION_TRIAGE / DORFL_SURFACE_BLOCKERS line on a SCHEDULE/PUSH tick,
# so your committed dorfl.json wins (then the global config, then the strict
# built-in defaults autoBuild:false / autoTask:false / observationTriage:'off' /
# surfaceBlockers:false). The ONE exception is a manual \`workflow_dispatch\` where
# you fill a gate override input (above): \`enumerate\` exports it for its scan and
# \`dispatch\` forwards it to every item run. To enable CI autonomy durably, set
# the gate(s) in dorfl.json (applies everywhere) — NOT by re-running install-ci
# (ADR §6: install-ci is one-time).

jobs:
  # ── ENUMERATE ───────────────────────────────────────────────────────────────
  # List the eligible items. \`scan --json\` reports BOTH the registry/hub-mirror
  # pool (\`repos[].items[]\`, \`repos[].specs[]\`, \`repos[].lifecycle\`) AND the
  # in-place working checkout (\`cwd.repo.items[]\`, \`cwd.repo.specs[]\`,
  # \`cwd.repo.lifecycle\`); CI runs IN-PLACE so the items live in the latter (a
  # fresh runner has no registered mirror). \`jq\` unions + dedups the build/task
  # pools AND the LIFECYCLE pools into a list of explicit \`task:<slug>\` /
  # \`spec:<slug>\` / \`obs:<slug>\` ids (CI MUST use explicit prefixes): \`obs:\`
  # (triage untriaged observations), surface \`task:\`/\`spec:\` (\`needsAnswers\`,
  # no answered sidecar) AND apply \`task:\`/\`spec:\`/\`observation:\` (an answered
  # sidecar — consume the committed answer, closing the on-answer
  # \`push: work/questions/**\` loop). Read-only: it runs no agent and writes
  # nothing.
  enumerate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      items: \${{ steps.scan.outputs.items }}
      any: \${{ steps.scan.outputs.any }}
    steps:
      - uses: ${pinnedUses(ACTION_PINS.checkout)}
        with:
          fetch-depth: 0
      - uses: ${WRITER_SETUP_ACTION_USES}
${enumerateGate}
      - id: scan
        # Enumerate eligible items as namespaced ids, one item run per id.
        # Eligible TASKS ⇒ \`task:<slug>\` (\`advance\` builds them); TASKABLE SPECS
        # ⇒ \`spec:<slug>\` (\`advance\` auto-tasks them, capability B). LIFECYCLE
        # pools: \`lifecycle.triage[]\` ⇒ \`obs:<slug>\`, \`lifecycle.surface[]\` +
        # \`lifecycle.apply[]\` ⇒ \`.namespace + ":" + .slug\` (an answered
        # observation sidecar is consumed by the apply rung too, so
        # \`observation:\` MUST carry through here). \`scan --here\` reports ONLY
        # the cwd checkout (\`cwd.repo.*\`) and skips the cross-repo registry
        # loop; \`jq\` still reads the (now-empty) \`repos[]\` branches harmlessly.
        run: |
          items="$(dorfl scan --json --here \\
            | jq -c '[(.repos[].items[]?, .cwd.repo.items[]?) | select(.eligibility.eligible == true) | "task:" + .slug] + [(.repos[].specs[]?, .cwd.repo.specs[]?) | select(.eligibility.eligible == true) | "spec:" + .slug] + [(.repos[].lifecycle.triage[]?, .cwd.repo.lifecycle.triage[]?) | "obs:" + .slug] + [(.repos[].lifecycle.surface[]?, .cwd.repo.lifecycle.surface[]?, .repos[].lifecycle.apply[]?, .cwd.repo.lifecycle.apply[]?) | .namespace + ":" + .slug] | unique')"
          echo "items=\${items}" >> "$GITHUB_OUTPUT"
          if [ "$(echo "\${items}" | jq 'length')" -gt 0 ]; then
            echo "any=true" >> "$GITHUB_OUTPUT"
          else
            echo "any=false" >> "$GITHUB_OUTPUT"
          fi

  # ── DISPATCH: one dorfl-item-dispatch.yml run per item ──────────────────────
  # \`actions: write\` and NOTHING else, NO checkout and NO setup: no repository
  # code runs next to \`actions: write\`, only the runner's preinstalled \`gh\` and
  # \`jq\`. Each item run joins the slot dorfl-slot-<index mod maxParallel>
  # (\`queue: max\`), so at most maxParallel (install-ci --max-parallel) item runs
  # execute at once: each spawns a full agent session, and an unbounded fan-out
  # exhausts the model provider's rate limit and thrashes the arbiter-main CAS.
  # An item whose \`dorfl-item <item>\` run has not completed yet is SKIPPED (a
  # tick ends as soon as it has dispatched, so the next tick can come while
  # earlier runs still wait in a slot); a duplicate that slips through a race is
  # harmless (its lock job re-classifies at the fresh arbiter tip). Every value
  # reaches the script through \`env:\`; the log lists each item, its slot and
  # whether it was dispatched or skipped.
  dispatch:
    needs: enumerate
    if: \${{ needs.enumerate.outputs.any == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      actions: write
    steps:
      - name: dispatch one item run per item
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          REPO: \${{ github.repository }}
          DEFAULT_BRANCH: \${{ github.event.repository.default_branch || 'main' }}
          ITEMS: \${{ needs.enumerate.outputs.items }}
          MAX_PARALLEL: '${config.maxParallel}'
          INTEGRATION_MODE: \${{ github.event.inputs.integrationMode || 'propose' }}
${dispatchGateEnv}
        run: |
${DISPATCH_SCRIPT}

  # ── SURFACE MERGE QUESTIONS (no agent) ──────────────────────────────────────
  # Ask a merge question (a \`kind: merge\` sidecar entry the human answers
  # \`merge | hold | drop\`) for every unmerged \`work/task-<slug>\` branch with no
  # open PR (an open PR already is the land decision), whose task rests in
  # tasks/ready/ or tasks/backlog/, whose lock is free or kept by its finished
  # propose build, and whose tip carries the done-move; then publish the
  # questions to main. An answered \`merge\` is enumerated like any answered
  # sidecar and lands through the item run's apply rung. Gated by the
  # \`mergeQuestions\` config (off|ask, default ask): \`off\` surfaces nothing.
  # Deterministic: it runs no agent, so the writer-role setup (Node and dorfl
  # only). It fetches the arbiter before listing the branches.
  surface-merge-questions:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: ${pinnedUses(ACTION_PINS.checkout)}
        with:
          fetch-depth: 0
      - uses: ${WRITER_SETUP_ACTION_USES}
      - name: surface merge questions for unmerged work/* branches (surface-merge-questions)
        run: dorfl surface-merge-questions --arbiter origin

  # ── REAP merged remote work/* branches (capability F, the hygiene sweep) ─────
  # PRESERVED from the seed (NOT a separate gc-sweep workflow): the provider-
  # agnostic counterpart of the worktree reaper. Deletes remote \`work/<slug>\`
  # branches that are PROVABLY MERGED into \`origin/main\`, so an out-of-band
  # human/UI PR merge stops leaving its branch lingering on the arbiter.
  # Independent of the integration mode, so it runs on EVERY tick regardless
  # of \`integrationMode\` — gated ONLY by the \`sweepMergedBranches\` opt-out (ON by
  # default). It NEVER touches an un-merged/in-flight branch and NEVER \`--force\`s.
  # It runs no agent: the writer-role setup (Node and dorfl only).
  #
  # OPTIONAL belt-and-suspenders for a GitHub arbiter: enable the repo-level
  # "Automatically delete head branches" setting (\`delete_branch_on_merge\`), owned
  # by the install-ci wizard — an ADDITIVE GitHub-only convenience, NOT a
  # replacement for this sweep (the only thing that reaps on a \`--bare\`/non-GitHub
  # arbiter).
  reap-merged-branches:
    if: \${{ (github.event.inputs.sweepMergedBranches || 'true') == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: ${pinnedUses(ACTION_PINS.checkout)}
        with:
          fetch-depth: 0
      - uses: ${WRITER_SETUP_ACTION_USES}
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

	// --- The tick runs NO agent: it dispatches one item run per item ------------
	require('dispatches-item-runs', /gh workflow run dorfl-item-dispatch\.yml\b/.test(
		operative,
	), 'the `dispatch` job must start one `dorfl-item-dispatch.yml` run per item ' +
		'(`gh workflow run dorfl-item-dispatch.yml`), which calls dorfl-item.yml.');
	require('no-agent-verb-in-tick', !/dorfl (?:advance|do|intake|run)\b/.test(
		operative,
	), 'the tick itself must run NO agent-spawning verb: `advance` runs inside ' +
		'the per-item workflow (lock, agent, apply jobs).');
	require('never-invokes-do', !/dorfl do\b/.test(
		operative,
	), 'the workflow must NEVER invoke `do` directly (CI always invokes `advance`, ' +
		'ADR ci-config-policy-and-gate-family §1).');
	require('no-matrix', !/\bstrategy:\s*[\s\S]*?matrix:/.test(
		operative,
	), 'no job may use a `strategy.matrix`: one item per workflow run (a matrix ' +
		'shares one artifact namespace across items, decision 1).');

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
	// ... on the DEFAULT BRANCH only: a work-branch push touching a sidecar must
	// never run the lifecycle (observation
	// `advance-lifecycle-push-trigger-lands-an-unreviewed-work-branch-on-main`).
	require('push-pinned-to-main', /\bpush:\s*\n\s+(?:#[^\n]*\n\s+)*branches:\s*\n\s+-\s*main\b/.test(
		text,
	), 'the on-answer-committed `push` trigger must be pinned to the default ' +
		'branch (`branches: [main]`).');

	// --- integrationMode is forwarded to every item run (one word) -------------
	require('integration-mode-one-word', /integrationMode:/.test(text) &&
		/github\.event\.inputs\.integrationMode/.test(
			text,
		), 'the dispatch input must be `integrationMode` (one word, forwarded to ' +
		'every item run as `--propose`/`--merge`).');
	require('dispatch-forwards-integration-mode', /-f "integrationMode=\$\{INTEGRATION_MODE\}"/.test(
		operative,
	), 'the `dispatch` job must forward `integrationMode` to each item run.');
	require('dispatch-slot', /-f "slot=\$\{slot\}"/.test(operative) &&
		/i % MAX_PARALLEL/.test(
			operative,
		), 'the `dispatch` job must give each item run a slot (index mod ' +
		'maxParallel), the concurrency group that caps the parallelism.');
	require('dispatch-skips-active-runs', /gh run list[^\n]*--workflow dorfl-item-dispatch\.yml[^\n]*displayTitle,status/.test(
		operative,
	), 'the `dispatch` job must list the non-completed `dorfl-item-dispatch.yml` ' +
		'runs and skip an item whose `dorfl-item <item>` run is still active.');
	require('dispatch-actions-write-only', /\n {2}dispatch:[\s\S]*?\n {4}permissions:\s*\n {6}actions: write\s*\n {4}steps:/.test(
		text,
	), 'the `dispatch` job must hold `actions: write` and nothing else.');
	require('dispatch-no-checkout-no-setup', !/\n {2}dispatch:[\s\S]*?(?:\n {2}\S|$)/
		.exec(operative)?.[0]
		.match(/uses:/), 'the `dispatch` job must have NO checkout and NO setup ' +
		'(no repository code runs next to `actions: write`).');
	require('item-values-not-spliced-into-run', !/gh workflow run[^\n]*\$\{\{/.test(
		operative,
	), 'the item list and inputs must reach the dispatch script through `env:`, ' +
		'never as `${{ }}` text in the `run:` script.');

	// --- The DORFL_* gate family must NOT be carried as workflow env -----
	// The workflow emits NO active gate env line for any of AUTO_BUILD / AUTO_TASK
	// / OBSERVATION_TRIAGE / SURFACE_BLOCKERS: the env layer is the OPTIONAL CI-only
	// override layer, NOT the carrier of defaults. Emitting any of them would FORCE
	// env to win over the repo's own dorfl.json (the precedence is
	// flag > env > per-repo > global > default), silently shadowing per-repo gate
	// config in CI. Check the OPERATIVE (non-comment) lines so the explanatory
	// header comment that NAMES these keys is not a false positive.
	for (const [id, envVar] of [
		['no-gate-env-auto-build', 'DORFL_AUTO_BUILD'],
		['no-gate-env-auto-task', 'DORFL_AUTO_TASK'],
		['no-gate-env-observation-triage', 'DORFL_OBSERVATION_TRIAGE'],
		['no-gate-env-surface-blockers', 'DORFL_SURFACE_BLOCKERS'],
	] as const) {
		require(id, !new RegExp(`${envVar}\\s*:`).test(
			operative,
		), `the workflow must NOT emit an \`${envVar}:\` env assignment ` +
			'(env carries no defaults; the gate is resolved from per-repo config / built-in default).');
	}
	// --- Gate-family DISPATCH OVERRIDES (one-shot, dispatch only) ---------------
	// Each gate is a `workflow_dispatch` input, exported (a guarded `$GITHUB_ENV`
	// write, NOT a YAML `env:` key) in `enumerate` BEFORE its scan, and forwarded
	// by `dispatch` to every item run (whose lock, agent and apply jobs export it).
	for (const [input, envVar] of [
		['autoBuild', 'DORFL_AUTO_BUILD'],
		['autoTask', 'DORFL_AUTO_TASK'],
		['observationTriage', 'DORFL_OBSERVATION_TRIAGE'],
		['surfaceBlockers', 'DORFL_SURFACE_BLOCKERS'],
	] as const) {
		require(`dispatch-${input}-input`, new RegExp(
			`workflow_dispatch:[\\s\\S]*?inputs:[\\s\\S]*?\\b${input}:`,
		).test(
			text,
		), `the \`workflow_dispatch\` must carry a \`${input}\` gate-override input.`);
		const dispatchVar = envVar.replace(/^DORFL_/, 'DISPATCH_');
		const guardedWrite = new RegExp(
			`${dispatchVar}:\\s*\\$\\{\\{ github\\.event\\.inputs\\.${input} \\}\\}` +
				`[\\s\\S]*?\\[ -n "\\$\\{${dispatchVar}\\}" \\] && echo "${envVar}=\\$\\{${dispatchVar}\\}"`,
		);
		require(`dispatch-${input}-guarded-write`, guardedWrite.test(
			text,
		), `the \`${input}\` override must be a blank-guarded write of \`${envVar}\` ` +
			'to `$GITHUB_ENV` (blank dispatch input / schedule / push emit nothing).');
		require(`dispatch-forwards-${input}`, new RegExp(
			`args\\+=\\(-f "${input}=\\$\\{${dispatchVar}\\}"\\)`,
		).test(
			operative,
		), `the \`dispatch\` job must forward a non-blank \`${input}\` override to ` +
			'each item run.');
	}
	// The ENUMERATE job MUST carry the override before its `scan` step — else the
	// item list is built from the un-overridden gates and the override is inert.
	require('enumerate-carries-gate-override', /enumerate:[\s\S]*?DORFL_OBSERVATION_TRIAGE=[\s\S]*?id: scan/.test(
		text,
	), 'the `enumerate` job must apply the dispatch gate override BEFORE its `scan` ' +
		'step (scan gates the item pools by the gate family; otherwise the ' +
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
	// The ORPHAN-SIDECAR reap rides the SAME scheduled `dorfl gc
	// --remote-branches` invocation, which reads the working tree, so the reap
	// job must check one out, and its step must name the orphan-sidecar duty.
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
	require('reap-writer-role', /reap-merged-branches:[\s\S]*?uses:\s*\.\/\.github\/actions\/dorfl-setup-writer\b/.test(
		text,
	), 'the reap job runs no agent: it must use the writer-role setup ' +
		'(`./.github/actions/dorfl-setup-writer`: Node and dorfl only).');

	// --- The merge-question writer job (no agent) -------------------------------
	// Task `wire-merge-questions-into-the-advance-tick` (decision 5): surfacing is
	// deterministic, so a no-agent writer job runs it; `enumerate` stays
	// read-only.
	require('surface-merge-questions-job', /\n {2}surface-merge-questions:\s*\n {4}runs-on: ubuntu-latest\s*\n {4}permissions:\s*\n {6}contents: write\s*\n {4}steps:/.test(
		text,
	), 'the workflow must carry the `surface-merge-questions` job (contents: write, ' +
		'no agent) that asks the merge questions.');
	require('surface-merge-questions-runs-the-command', /surface-merge-questions:[\s\S]*?run: dorfl surface-merge-questions\b/.test(
		operative,
	), 'the `surface-merge-questions` job must run `dorfl surface-merge-questions`.');
	require('surface-merge-questions-writer-role', /surface-merge-questions:[\s\S]*?uses:\s*\.\/\.github\/actions\/dorfl-setup-writer\b/.test(
		text,
	), 'the `surface-merge-questions` job runs no agent: it must use the ' +
		'writer-role setup (`./.github/actions/dorfl-setup-writer`).');

	// --- CI runs IN-PLACE: no isolation machinery ------------------------------
	require('no-isolated-flag', !/--isolated\b/.test(
		operative,
	), 'CI runs IN-PLACE (the container IS the isolation): no `--isolated` flag.');
	// Guard `--remote` the LAPTOP affordance, but NOT `--remote-branches` (the
	// preserved capability-F `gc --remote-branches` sweep).
	require('no-remote-flag', !/--remote(?![-\w])/.test(
		operative,
	), 'CI runs IN-PLACE: no `--remote` flag (laptop-only affordance).');

	// --- A CI concurrency group ------------------------------------------------
	require('concurrency-group', /\bconcurrency:\s*[\s\S]*?group:/.test(
		text,
	), 'must carry a CI `concurrency.group` so overlapping ticks never collide.');

	// --- Permissions: nothing at workflow level; NO `workflows` permission -----
	require('workflow-permissions-empty', /^permissions: \{\}$/m.test(
		text,
	), 'the workflow must grant nothing at workflow level (`permissions: {}`); ' +
		'each job grants its own scopes.');
	require('enumerate-contents-read', /\n {2}enumerate:\s*\n {4}runs-on: ubuntu-latest\s*\n {4}permissions:\s*\n {6}contents: read\s*\n {4}outputs:/.test(
		text,
	), 'the `enumerate` job must hold `contents: read` only.');
	require('no-workflows-permission', !/\bworkflows:\s*write\b/.test(
		text,
	), 'the running job must request NO `workflows` permission (US #9: it can ' +
		'never edit `.github/workflows/**` / rewrite its own triggers).');
	require('never-edits-dot-github-workflows', !/\.github\/workflows\//.test(
		operative,
	), 'no emitted job step may touch `.github/workflows/**` (US #9).');

	// --- Explicit slug prefixes, never bare ------------------------------------
	require('explicit-task-prefix', /"task:" \+ \.slug/.test(
		text,
	), 'CI must use explicit `task:`/`spec:` slug prefixes, never bare (ADR ' +
		'command-surface-and-journeys §3a).');

	// --- The `enumerate` list must UNION taskable specs -------------------------
	// (`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`): a
	// task-only `jq` would render `DORFL_AUTO_TASK: 'true'` dead on the hourly
	// cron — a ready ungated SPEC would never become an item run.
	require('propose-enumerates-taskable-specs', /"spec:" \+ \.slug/.test(text) &&
		/\.specs\[\]/.test(
			text,
		), 'the `enumerate` `jq` must union taskable specs into the item list as ' +
		"`spec:<slug>` ids (read from `scan --json`'s `repos[].specs[]` + " +
		'`cwd.repo.specs[]` pools), so a ready ungated SPEC becomes one auto-task ' +
		'item run alongside the eligible-task items ' +
		'(`ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`).');
	require('propose-enumerates-via-scan', /dorfl scan --json/.test(
		text,
	), 'the items must be ENUMERATED via the eligible-pool scan ' +
		'(`dorfl scan --json`).');

	// --- The `enumerate` list must UNION the LIFECYCLE pools --------------------
	// (`ci-propose-matrix-enumerates-lifecycle-items`): `triage[]` → `obs:<slug>`,
	// and `surface[]`/`apply[]` → `.namespace + ":" + .slug`, so the WHOLE
	// answer-loop runs in propose mode too.
	require('propose-enumerates-lifecycle-items', /"obs:" \+ \.slug/.test(text) &&
		/\.lifecycle\.triage\[\]/.test(text) &&
		/\.lifecycle\.surface\[\]/.test(text) &&
		/\.lifecycle\.apply\[\]/.test(text) &&
		/\.namespace \+ ":" \+ \.slug/.test(
			text,
		), 'the `enumerate` `jq` must union the LIFECYCLE pools into the item list ' +
		"(read from `scan --json`'s `repos[].lifecycle.*` + " +
		'`cwd.repo.lifecycle.*`): `triage[]` as `obs:<slug>`, and ' +
		'`surface[]`/`apply[]` as `.namespace + ":" + .slug` ' +
		'(`ci-propose-matrix-enumerates-lifecycle-items`).');

	// --- No timeout is computed here: the item's lock job owns it ---------------
	// The agent job's `timeout-minutes` is the lock job's `agentTimeoutMinutes`
	// output (dorfl.json at the item's base), in dorfl-item.yml; no job here may
	// bake a numeric `timeout-minutes` either (the retired `legTimeoutMinutes`).
	require('no-static-timeout', !/timeout-minutes:\s*\d/.test(
		operative,
	), 'no job may set a baked-in numeric `timeout-minutes`: the agent timeout ' +
		"is the item lock job's `agentTimeoutMinutes` (dorfl.json at the base).");

	// --- Wires the writer-role setup action (no agent runs here) ---------------
	require('uses-writer-setup-action', /uses:\s*\.\/\.github\/actions\/dorfl-setup-writer\b/.test(
		text,
	), 'the jobs that set up dorfl here run no agent, so they must use the ' +
		'writer-role setup (`./.github/actions/dorfl-setup-writer`).');
	require('no-agent-setup-action', !/uses:\s*\.\/\.github\/actions\/dorfl-setup\s*$/m.test(
		operative,
	), 'no job here runs an agent, so none may use the agent-role setup ' +
		'(`./.github/actions/dorfl-setup`: the harness and the provider key).');

	return {ok: problems.length === 0, problems};
}
