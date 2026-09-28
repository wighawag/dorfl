/**
 * Worker for the three-process tree-less split test
 * (`test/ci-phase-treeless-e2e.test.ts`, task `ci-split-treeless-rungs`).
 * Spawned as its OWN node process via `tsx`, once per phase, so the lock, agent
 * and apply phases share nothing but the handoff directory and the lock outputs
 * (the `DORFL_LOCK_OUTPUTS` env the parent passes, exactly as a workflow would).
 *
 * It does what the CLI does for `advance <item> --phase <p>` (enter the process
 * phase, then `performTreelessPhase`). In the AGENT phase the three agent seams
 * return the scenario's canned emits. In the LOCK and APPLY phases the seams
 * are the PRODUCTION ones on the null harness (`true` as the agent command), so
 * any agent launch there throws the phase guard's `PhaseGuardError` and fails
 * the process. The phase result is printed as one JSON line.
 */

import {performTreelessPhase} from '../../src/ci-phase-treeless.js';
import {activateProcessPhase} from '../../src/phase-recorder.js';
import {NullHarness} from '../../src/harness.js';
import {harnessSurfaceGate} from '../../src/surface-gate.js';
import {harnessTriageGate} from '../../src/triage-gate.js';
import {harnessApplyDecider} from '../../src/apply-decide.js';
import type {Phase} from '../../src/phase.js';
import type {AgentJobResult} from '../../src/ci-agent-result.js';
import type {ObservationTriage} from '../../src/config.js';
import type {ScenarioEmits} from './treeless-scenarios.js';

interface WorkerArgs {
	phase: Phase;
	cwd: string;
	arg: string;
	observationTriage?: ObservationTriage;
	handoffDir?: string;
	runnerTemp?: string;
	githubOutput?: string;
	/** apply: `needs.agent.result`; default `success`. */
	agentJobResult?: AgentJobResult;
	emits: ScenarioEmits;
	/** The answered merge (task `ci-split-answered-merge-action`): the agent job's job worktrees. */
	workspacesDir?: string;
	/** The answered merge: the acceptance gate on the rebased tip. */
	verify?: string;
	/** The answered merge: the opt-in re-stale check. */
	strictMergeApproval?: boolean;
}

async function main(): Promise<void> {
	const args = JSON.parse(process.argv[2]!) as WorkerArgs;
	activateProcessPhase(args.phase);
	const harness = new NullHarness();
	const seams =
		args.phase === 'agent'
			? {
					surfaceGate: async () => {
						if (args.emits.surface === undefined) {
							throw new Error('no canned surface emit');
						}
						return args.emits.surface;
					},
					triageGate: async () => {
						if (args.emits.triage === undefined) {
							throw new Error('no canned triage emit');
						}
						return args.emits.triage;
					},
					applyDecide: async () => {
						if (args.emits.verdict === undefined) {
							throw new Error('no canned verdict');
						}
						return args.emits.verdict;
					},
				}
			: {
					surfaceGate: harnessSurfaceGate({harness, agentCmd: 'true'}),
					triageGate: harnessTriageGate({harness, agentCmd: 'true'}),
					applyDecide: harnessApplyDecider({harness, agentCmd: 'true'}),
				};
	const notes: string[] = [];
	const result = await performTreelessPhase({
		phase: args.phase,
		arg: args.arg,
		cwd: args.cwd,
		arbiter: 'origin',
		observationTriage: args.observationTriage,
		handoffDir: args.handoffDir,
		runnerTemp: args.runnerTemp,
		githubOutput: args.githubOutput,
		publishJitterMs: 0,
		mergeJitterMs: 0,
		workspacesDir: args.workspacesDir,
		verify: args.verify,
		strictMergeApproval: args.strictMergeApproval,
		...seams,
		agentResult:
			args.phase === 'apply' ? (args.agentJobResult ?? 'success') : undefined,
		note: (m) => notes.push(m),
	});
	process.stdout.write(JSON.stringify({...result, notes}) + '\n');
}

main().catch((err: unknown) => {
	const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
	process.stderr.write(msg + '\n');
	process.exit(1);
});
