/**
 * The SPLIT CI ITEM workflows (spec `ci-agent-job-without-write-token` §2, ADR
 * `ci-agent-job-holds-no-write-token`; task `ci-split-generate-workflows`).
 *
 * Every CI item runs as three jobs in a workflow run of its own:
 *
 *  - **lock** (write token, no agent, no repository code): classify the item
 *    at the arbiter's current `main`, take its locks, publish trusted facts as
 *    job outputs (`ci-lock-outputs.ts`);
 *  - **agent** (a read-only token, `persist-credentials: false`): run the
 *    agents and upload the handoff;
 *  - **apply** (write token, no agent, no repository code, `if: always()`):
 *    validate the handoff as hostile and do every write.
 *
 * This module generates the two files that carry that shape:
 *
 *  - `dorfl-item.yml` ({@link generateItemWorkflow}): the three jobs, reached
 *    only through `workflow_call`, with NO workflow-level `concurrency`;
 *  - `dorfl-item-dispatch.yml` ({@link generateItemDispatchWorkflow}): the thin
 *    `workflow_dispatch` wrapper the advance tick starts once per item. It
 *    holds the parallelism slot (`concurrency: dorfl-slot-<slot>` with
 *    `queue: max`) and calls `dorfl-item.yml`.
 *
 * `intake.yml` calls `dorfl-item.yml` directly with `item: issue:<N>` under its
 * own per-issue group (decision 10). One item per run means one artifact
 * namespace per item (decision 1): the artifact the apply job downloads (no
 * `run-id`) can only come from this item's agent job.
 *
 * The item decides the verb: `issue:<N>` runs `dorfl intake <N>`, every other
 * namespaced id runs `dorfl advance <item> --<integrationMode>`, one line per
 * phase (`advance --phase` routes build / tasking / tree-less itself from the
 * lock job's `rung`).
 */

import {ACTION_PINS, pinnedUses} from './install-ci-action-pins.js';
import {LOCK_OUTPUT_KEYS} from './ci-lock-outputs.js';
import type {ResolvedCIConfig} from './install-ci-core.js';
import {
	PR_IDENTITY_SECRET_NAME,
	SETUP_ACTION_USES,
	WRITER_SETUP_ACTION_USES,
	providerSecretNames,
	providerSecretsWithBlock,
} from './install-ci-core.js';

/** The repo-relative path (under the output base) of the item workflow. */
export const ITEM_WORKFLOW_PATH = 'workflows/dorfl-item.yml';

/** The repo-relative path (under the output base) of the dispatch wrapper. */
export const ITEM_DISPATCH_WORKFLOW_PATH = 'workflows/dorfl-item-dispatch.yml';

/** The file name the advance tick dispatches (`gh workflow run <this>`). */
export const ITEM_DISPATCH_WORKFLOW_FILE = 'dorfl-item-dispatch.yml';

/** The `run-name` prefix of a dispatched item run (`dorfl-item <item>`). */
export const ITEM_RUN_NAME_PREFIX = 'dorfl-item';

/** The four one-shot gate overrides, with their `DORFL_*` env and values. */
export const GATE_OVERRIDES = [
	{input: 'autoBuild', env: 'DORFL_AUTO_BUILD', values: ['true', 'false']},
	{input: 'autoTask', env: 'DORFL_AUTO_TASK', values: ['true', 'false']},
	{
		input: 'observationTriage',
		env: 'DORFL_OBSERVATION_TRIAGE',
		values: ['off', 'ask', 'auto'],
	},
	{
		input: 'surfaceBlockers',
		env: 'DORFL_SURFACE_BLOCKERS',
		values: ['true', 'false'],
	},
] as const;

/**
 * The scopes every job of `dorfl-item.yml` requests, together: what a calling
 * job must grant (a called workflow can only narrow its caller's token).
 */
export const ITEM_WORKFLOW_CALLER_PERMISSIONS = `\
      contents: write
      issues: write
      pull-requests: write
      actions: read
      checks: read`;

/** `DISPATCH_AUTO_BUILD` for `DORFL_AUTO_BUILD`. */
function dispatchVar(env: string): string {
	return env.replace(/^DORFL_/, 'DISPATCH_');
}

/**
 * The gate-override step (a 6-space-indented workflow step): each of the four
 * one-shot overrides reaches the shell through `env:` from `source` (e.g.
 * `inputs` or `github.event.inputs`), is refused when it carries a line break or
 * is not its enum (blank means no override), and is exported as its `DORFL_*`
 * only when non-blank. `ifDispatch` adds the `workflow_dispatch` guard (the
 * lifecycle tick; a schedule or push run exports nothing).
 */
export function gateOverridesStep(options: {
	source: string;
	ifDispatch: boolean;
	comment: string;
}): string {
	const envLines = GATE_OVERRIDES.map(
		(g) =>
			`          ${dispatchVar(g.env)}: \${{ ${options.source}.${g.input} }}`,
	).join('\n');
	const all = GATE_OVERRIDES.map((g) => `\${${dispatchVar(g.env)}}`).join('');
	const enumLines = GATE_OVERRIDES.map(
		(g) =>
			`          case "\${${dispatchVar(g.env)}}" in ''|${g.values.join('|')}) ;; *) echo "::error::the ${g.input} override must be blank, ${g.values.join(', ')}"; exit 1 ;; esac`,
	).join('\n');
	const writeLines = GATE_OVERRIDES.map(
		(g) =>
			`          [ -n "\${${dispatchVar(g.env)}}" ] && echo "${g.env}=\${${dispatchVar(g.env)}}" >> "$GITHUB_ENV"`,
	).join('\n');
	const ifLine = options.ifDispatch
		? `\n        if: \${{ github.event_name == 'workflow_dispatch' }}`
		: '';
	return `\
      - name: apply dispatch gate overrides (one-shot, this run only)
${options.comment}${ifLine}
        env:
${envLines}
        run: |
          case "${all}" in
            *$'\\n'*|*$'\\r'*) echo "::error::a dispatch gate override contains a line break"; exit 1 ;;
          esac
${enumLines}
${writeLines}
          true`;
}

/** The standard comment on the item workflow's gate-override step. */
const ITEM_GATE_COMMENT = `\
        # The four one-shot gate overrides of the tick (blank: none, the
        # committed dorfl.json wins). Exported in the lock, agent AND apply jobs,
        # because each resolves the gate family (the lock job's classification
        # picks the rung from it). Each reaches the shell through \`env:\` as DATA,
        # a line break or a value outside its enum is refused (the
        # \`workflow_call\` inputs are free strings), and only a non-blank value is
        # written to $GITHUB_ENV (an empty DORFL_* makes the env coercion throw).`;

/**
 * The shell that runs ONE phase of the item: `issue:<N>` is intake, every
 * other id is `advance <item> --<integrationMode>`. `advanceExtra` and
 * `intakeExtra` are the phase-specific arguments (quoted shell words).
 */
function phaseScript(options: {
	phase: 'lock' | 'agent' | 'apply';
	advanceExtra: string;
	intakeExtra: string;
	prelude?: string;
}): string {
	const prelude = options.prelude ? `${options.prelude}\n` : '';
	return `\
          set -euo pipefail
          case "\${WORK_ITEM}" in
            ''|-*) echo "::error::the item must be a namespaced id (task:<slug>, spec:<slug>, obs:<slug>, issue:<N>)"; exit 1 ;;
          esac
          case "\${INTEGRATION_MODE}" in
            propose|merge) ;;
            *) echo "::error::integrationMode must be propose or merge"; exit 1 ;;
          esac
${prelude}          case "\${WORK_ITEM}" in
            issue:*) dorfl intake "\${WORK_ITEM#issue:}" --phase ${options.phase}${options.intakeExtra} --arbiter origin ;;
            *) dorfl advance "\${WORK_ITEM}" "--\${INTEGRATION_MODE}" --phase ${options.phase}${options.advanceExtra} --arbiter origin ;;
          esac`;
}

/** The `workflow_call` secrets block of `dorfl-item.yml`. */
function callSecretsBlock(config: ResolvedCIConfig): string {
	const names = [...providerSecretNames(config), PR_IDENTITY_SECRET_NAME];
	return names
		.map((name) => `      ${name}:\n        required: false`)
		.join('\n');
}

/**
 * The `secrets:` a calling job passes to `dorfl-item.yml`: explicit, never
 * `inherit`, so nothing reaches the item workflow by default. `withPrIdentity`
 * adds {@link PR_IDENTITY_SECRET_NAME} (the advance tick; intake keeps the
 * built-in token, as before the split).
 */
export function itemCallSecrets(
	config: ResolvedCIConfig,
	withPrIdentity: boolean,
): string {
	const names = [
		...providerSecretNames(config),
		...(withPrIdentity ? [PR_IDENTITY_SECRET_NAME] : []),
	];
	if (names.length === 0) {
		return '';
	}
	return (
		'\n    secrets:\n' +
		names.map((n) => `      ${n}: \${{ secrets.${n} }}`).join('\n')
	);
}

/**
 * Generate `dorfl-item.yml`: the lock, agent and apply jobs of ONE item.
 * Deterministic. See the module comment for the shape; every value reaches a
 * `run:` script through `env:`.
 */
export function generateItemWorkflow(config: ResolvedCIConfig): string {
	const workspace = config.installSource === 'workspace';
	const lockOutputs = LOCK_OUTPUT_KEYS.map(
		(k) => `      ${k}: \${{ steps.lock.outputs.${k} }}`,
	).join('\n');
	const gate = gateOverridesStep({
		source: 'inputs',
		ifDispatch: false,
		comment: ITEM_GATE_COMMENT,
	});
	const workspaceHeader = workspace
		? `
#
# WORKSPACE INSTALL MODE (this repository builds dorfl from source, decision 8
# of ADR ci-agent-job-holds-no-write-token): all three jobs build dorfl from
# the item's base sha (the arbiter's main tip the lock job classifies
# against). In MERGE mode this runs code an earlier agent landed on \`main\`
# inside the WRITE jobs (lock, apply), which is the trust merge mode already
# implies: that code is what \`main\` runs anyway.`
		: '';
	const lockBaseStep = workspace
		? `
      - name: resolve the arbiter tip to build dorfl from (workspace mode)
        id: base
        # The lock phase classifies against <arbiter>/main (its baseSha), not
        # this run's github.sha, so build dorfl from that same tip.
        run: |
          set -euo pipefail
          git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main
          echo "sha=$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')" >> "$GITHUB_OUTPUT"`
		: '';
	const lockSetupWith = workspace
		? `
        with:
          source-ref: \${{ steps.base.outputs.sha }}`
		: '';
	const lockBaseCheck = workspace
		? `
      - name: check dorfl was built from the base sha (workspace mode)
        # main can move between the fetch above and the lock phase's own fetch;
        # the agent and apply jobs build from the base sha either way.
        env:
          BUILT_FROM: \${{ steps.base.outputs.sha }}
          BASE_SHA: \${{ steps.lock.outputs.baseSha }}
        run: |
          if [ -n "\${BASE_SHA}" ] && [ "\${BASE_SHA}" != "\${BUILT_FROM}" ]; then
            echo "::warning::main moved during the lock job: its dorfl was built from \${BUILT_FROM}, the item's base is \${BASE_SHA} (the agent and apply jobs build from the base)."
          fi`
		: '';
	return `\
# dorfl — ONE CI ITEM as three jobs (spec ci-agent-job-without-write-token,
# ADR ci-agent-job-holds-no-write-token). EMITTED by \`dorfl install-ci\`; the
# human commits it. DO NOT hand-edit a copy: re-run install-ci to upgrade.
#
#   lock   write token, NO agent, NO repository code: classify the item at the
#          arbiter's current main (its tip is the base), take the locks, and
#          publish trusted facts as job outputs.
#   agent  read-only token, persist-credentials: false: run the agents, the
#          gate and the review, stop at the first write, upload the handoff.
#   apply  write token, NO agent, NO repository code, if: always(): treat the
#          handoff as HOSTILE, validate it against the lock outputs, do every
#          write (or release / surface the item when the agent job failed).
#
# Reached only through \`workflow_call\`: from dorfl-item-dispatch.yml (one run
# per advance item, holding the parallelism slot) and from intake.yml
# (\`item: issue:<N>\`, under its per-issue group). ONE item per run: the
# artifact namespace is this run's, so the apply job's download (no run-id)
# can only read this item's agent job. NO workflow-level concurrency here: the
# callers own it.
#
# The base is the arbiter tip, never the run's commit: a queued run may start
# hours after its dispatch. The lock job's checkout (github.sha) only loads the
# local composite action; dorfl fetches <arbiter>/main itself and publishes its
# tip as \`baseSha\`, which the agent and apply jobs check out.
#
# Secrets: the provider key(s) reach the AGENT job only; DORFL_GH_TOKEN and the
# write-scoped GITHUB_TOKEN reach lock and apply only. The agent job's
# GITHUB_TOKEN is read-only (its job permissions).
#
# All jobs run on GitHub-hosted runners: each job needs a FRESH machine. A
# self-hosted runner must be ephemeral (one job per machine), or files and
# processes an agent planted survive into a later lock or apply job.${workspaceHeader}

name: dorfl-item

on:
  workflow_call:
    inputs:
      item:
        description: 'The namespaced item id: task:<slug>, spec:<slug>, obs:<slug>, observation:<slug> (advance) or issue:<N> (intake).'
        required: true
        type: string
      integrationMode:
        description: 'propose or merge (advance items; the lock phase refuses anything else). Intake reads its document mode from dorfl.json.'
        required: false
        default: 'propose'
        type: string
      autoBuild:
        description: 'One-shot autoBuild override (blank: none).'
        required: false
        default: ''
        type: string
      autoTask:
        description: 'One-shot autoTask override (blank: none).'
        required: false
        default: ''
        type: string
      observationTriage:
        description: 'One-shot observationTriage override (blank: none).'
        required: false
        default: ''
        type: string
      surfaceBlockers:
        description: 'One-shot surfaceBlockers override (blank: none).'
        required: false
        default: ''
        type: string
    secrets:
${callSecretsBlock(config)}

# Nothing at workflow level: each job grants its own scopes (and a caller's
# grant caps them).
permissions: {}

jobs:
  # ── LOCK: write token, no agent, no repository code ─────────────────────────
  lock:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: write
      issues: write
      pull-requests: write
    # Exactly the lock phase's facts (ci-lock-outputs.ts), written by dorfl to
    # $GITHUB_OUTPUT. The agent and apply jobs read them back as ONE JSON value,
    # DORFL_LOCK_OUTPUTS = toJSON(needs.lock.outputs), which dorfl re-validates.
    outputs:
${lockOutputs}
    steps:
      - uses: ${pinnedUses(ACTION_PINS.checkout)}
        with:
          fetch-depth: 0${lockBaseStep}
      - uses: ${WRITER_SETUP_ACTION_USES}${lockSetupWith}
${gate}
      - name: lock the item (no agent, no repository code)
        id: lock
        # dorfl fetches <arbiter>/main, classifies the item at its tip (the
        # base), takes the locks and writes its facts to $GITHUB_OUTPUT (among
        # them agentTimeoutMinutes, read from dorfl.json at the base). Intake
        # derives the origin trust from this run's event and the document mode
        # from dorfl.json at the base.
        env:
          GH_TOKEN: \${{ secrets.${PR_IDENTITY_SECRET_NAME} || secrets.GITHUB_TOKEN }}
          WORK_ITEM: \${{ inputs.item }}
          INTEGRATION_MODE: \${{ inputs.integrationMode }}
        run: |
${phaseScript({phase: 'lock', advanceExtra: '', intakeExtra: ''})}${lockBaseCheck}

  # ── AGENT: read-only token, no persisted credential ────────────────────────
  agent:
    needs: lock
    if: \${{ needs.lock.outputs.acquired == 'true' && needs.lock.outputs.needsAgent == 'true' }}
    runs-on: ubuntu-latest
    # agentDeadlineMinutes + checkpointHeadroomMinutes from dorfl.json at the
    # base, computed by the lock job (a job output is a string: fromJSON).
    timeout-minutes: \${{ fromJSON(needs.lock.outputs.agentTimeoutMinutes) }}
    permissions:
      contents: read
      issues: read
    steps:
      - uses: ${pinnedUses(ACTION_PINS.checkout)}
        with:
          ref: \${{ needs.lock.outputs.baseSha }}
          fetch-depth: 0
          # Nothing in this job may hold a credential the agent could use: the
          # read token reaches dorfl's own git per command, never .git/config.
          persist-credentials: false
          lfs: true
      - uses: ${SETUP_ACTION_USES}${providerSecretsWithBlock(config)}
      - name: enable git LFS in this checkout
        run: git lfs install --local
${gate}
      - name: run the agents (stops at the first write, writes the handoff)
        env:
          # Read-only (this job's permissions): dorfl's fetches pass it per
          # command and scrub it from the agent's environment.
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          DORFL_LOCK_OUTPUTS: \${{ toJSON(needs.lock.outputs) }}
          WORK_ITEM: \${{ inputs.item }}
          INTEGRATION_MODE: \${{ inputs.integrationMode }}
        # \`--watch\` streams the build agent's turns into this job log.
        run: |
${phaseScript({
	phase: 'agent',
	advanceExtra: ' --watch --handoff-out "${RUNNER_TEMP}/dorfl-handoff"',
	intakeExtra: ' --handoff-out "${RUNNER_TEMP}/dorfl-handoff"',
})}
      - name: upload the handoff
        if: \${{ always() }}
        uses: ${pinnedUses(ACTION_PINS.uploadArtifact)}
        with:
          name: \${{ needs.lock.outputs.handoffName }}
          path: \${{ runner.temp }}/dorfl-handoff
          retention-days: 1
          if-no-files-found: ignore

  # ── APPLY: write token, no agent, no repository code ────────────────────────
  apply:
    needs: [lock, agent]
    if: \${{ always() && needs.lock.outputs.acquired == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 30
    # actions: read + checks: read tell a timed-out agent job from a cancelled
    # one (GitHub reports both as cancelled; decision 5).
    permissions:
      contents: write
      issues: write
      pull-requests: write
      actions: read
      checks: read
    steps:
      - uses: ${pinnedUses(ACTION_PINS.checkout)}
        with:
          ref: \${{ needs.lock.outputs.baseSha }}
          fetch-depth: 0
      - uses: ${WRITER_SETUP_ACTION_USES}
${gate}
      - name: download the handoff (this run's own artifact)
        # No run-id: only this run's artifacts, i.e. this item's agent job. A
        # missing artifact is the apply phase's to judge, not a job failure.
        if: \${{ needs.agent.result == 'success' }}
        continue-on-error: true
        uses: ${pinnedUses(ACTION_PINS.downloadArtifact)}
        with:
          name: \${{ needs.lock.outputs.handoffName }}
          path: \${{ runner.temp }}/dorfl-handoff
      - name: apply the item (validates the handoff as hostile, does every write)
        env:
          GH_TOKEN: \${{ secrets.${PR_IDENTITY_SECRET_NAME} || secrets.GITHUB_TOKEN }}
          # The agent job's timeout check reads the Actions API with THIS token
          # only (never DORFL_GH_TOKEN).
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          DORFL_LOCK_OUTPUTS: \${{ toJSON(needs.lock.outputs) }}
          AGENT_RESULT: \${{ needs.agent.result }}
          AGENT_TIMEOUT_MINUTES: \${{ needs.lock.outputs.agentTimeoutMinutes }}
          WORK_ITEM: \${{ inputs.item }}
          INTEGRATION_MODE: \${{ inputs.integrationMode }}
        run: |
${phaseScript({
	phase: 'apply',
	prelude: `\
          timeout_args=()
          if [ -n "\${AGENT_TIMEOUT_MINUTES}" ]; then
            timeout_args=(--agent-timeout-minutes "\${AGENT_TIMEOUT_MINUTES}")
          fi`,
	advanceExtra:
		' --agent-result "${AGENT_RESULT}" "${timeout_args[@]}" --handoff-in "${RUNNER_TEMP}/dorfl-handoff"',
	intakeExtra:
		' --agent-result "${AGENT_RESULT}" "${timeout_args[@]}" --handoff-in "${RUNNER_TEMP}/dorfl-handoff"',
})}
`;
}

/**
 * Generate `dorfl-item-dispatch.yml`: the `workflow_dispatch` wrapper the
 * advance tick starts once per item (`gh workflow run`). It holds the
 * parallelism slot and calls `dorfl-item.yml`. Deterministic.
 */
export function generateItemDispatchWorkflow(config: ResolvedCIConfig): string {
	const gateInputs = GATE_OVERRIDES.map(
		(g) => `\
      ${g.input}:
        description: 'One-shot override of the ${g.input} gate (${g.env}) for this item run only. Blank: no override (config wins).'
        required: false
        default: ''
        type: choice
        options:
          - ''
${g.values.map((v) => `          - '${v}'`).join('\n')}`,
	).join('\n');
	const gateWith = GATE_OVERRIDES.map(
		(g) => `      ${g.input}: \${{ inputs.${g.input} }}`,
	).join('\n');
	return `\
# dorfl — ONE ADVANCE ITEM per workflow run (spec
# ci-agent-job-without-write-token, decision 1 of ADR
# ci-agent-job-holds-no-write-token). EMITTED by \`dorfl install-ci\`; the human
# commits it. DO NOT hand-edit a copy: re-run install-ci to upgrade.
#
# The advance-lifecycle tick's \`dispatch\` job starts one run of THIS workflow
# per eligible item (\`gh workflow run\`); its single job calls dorfl-item.yml
# (lock, agent, apply). A run of its own per item gives the item its own
# artifact namespace, so no other item's agent can plant its handoff.
#
# PARALLELISM: each run joins the concurrency group dorfl-slot-<slot> (slot =
# item index mod maxParallel) with \`queue: max\`, so at most maxParallel item
# runs execute at once and the rest wait first-in-first-out, costing no runner
# minutes. A slot holds at most 100 pending runs; beyond that GitHub cancels,
# and the next tick re-dispatches (the item is still eligible).
#
# The run name \`dorfl-item <item>\` is what the tick de-duplicates on: an item
# whose run is not completed yet is not dispatched again.

name: dorfl-item-dispatch

run-name: ${ITEM_RUN_NAME_PREFIX} \${{ inputs.item }}

on:
  workflow_dispatch:
    inputs:
      item:
        description: 'The namespaced item id (task:<slug>, spec:<slug>, obs:<slug>, observation:<slug>).'
        required: true
        type: string
      integrationMode:
        description: 'propose: open a PR for the item; merge: land it on main (rebase + CAS push).'
        required: true
        default: 'propose'
        type: choice
        options:
          - propose
          - merge
      slot:
        description: 'The parallelism slot (the concurrency group dorfl-slot-<slot>).'
        required: true
        default: '0'
        type: string
${gateInputs}

# Nothing at workflow level: the calling job grants what dorfl-item.yml needs.
permissions: {}

concurrency:
  group: dorfl-slot-\${{ inputs.slot }}
  cancel-in-progress: false
  queue: max

jobs:
  item:
    # The union of what dorfl-item.yml's jobs request (a called workflow can
    # only narrow this): lock and apply write, apply reads the agent job's
    # check runs.
    permissions:
${ITEM_WORKFLOW_CALLER_PERMISSIONS}
    uses: ./.github/workflows/dorfl-item.yml
    with:
      item: \${{ inputs.item }}
      integrationMode: \${{ inputs.integrationMode }}
${gateWith}${itemCallSecrets(config, true)}
`;
}
