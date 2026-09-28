/**
 * Worker for the three-process intake split test
 * (`test/ci-phase-intake-e2e.test.ts`, task `ci-split-intake`). Spawned as its
 * OWN node process via `tsx`, once per phase, so the lock, agent and apply
 * phases share nothing but the handoff directory, the lock outputs (the
 * `DORFL_LOCK_OUTPUTS` env the parent passes, as a workflow would) and the
 * file-backed issue stand-in (`file-issue-provider.ts`, in place of GitHub).
 *
 * It does what the CLI does for `intake <N> --phase <p>` (enter the process
 * phase, then `performIntakePhase`), with a canned decision verdict and a
 * converging lone-task review in place of the model. It prints the phase
 * result as one JSON line on stdout.
 */

import {performIntakePhase} from '../../src/ci-phase-intake.js';
import {activateProcessPhase} from '../../src/phase-recorder.js';
import type {IntakeVerdict} from '../../src/intake.js';
import type {Phase} from '../../src/phase.js';
import type {AgentJobResult} from '../../src/ci-agent-result.js';
import {fileIssueProvider} from './file-issue-provider.js';

interface WorkerArgs {
	phase: Phase;
	cwd: string;
	issueNumber: number;
	stateFile: string;
	handoffDir?: string;
	runnerTemp?: string;
	githubOutput?: string;
	eventPath?: string;
	/** agent: the canned decision verdict. */
	verdict?: IntakeVerdict;
	/** apply: `needs.agent.result`; default `success`. */
	agentJobResult?: AgentJobResult;
}

async function main(): Promise<void> {
	const args = JSON.parse(process.argv[2]!) as WorkerArgs;
	activateProcessPhase(args.phase);
	const notes: string[] = [];
	const result = await performIntakePhase({
		phase: args.phase,
		issueNumber: args.issueNumber,
		cwd: args.cwd,
		issueProvider: fileIssueProvider(args.stateFile),
		handoffDir: args.handoffDir,
		runnerTemp: args.runnerTemp,
		githubOutput: args.githubOutput,
		eventPath: args.eventPath,
		agentResult:
			args.phase === 'apply' ? (args.agentJobResult ?? 'success') : undefined,
		decide: async () => {
			if (args.verdict === undefined) throw new Error('no canned verdict');
			return args.verdict;
		},
		reviewTask: async () => ({verdict: 'approve', findings: []}),
		mergeJitterMs: 0,
		note: (m) => notes.push(m),
	});
	process.stdout.write(JSON.stringify({...result, notes}) + '\n');
}

main().catch((err) => {
	process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
	process.exit(3);
});
