/**
 * Worker for the three-process tasking split test
 * (`test/ci-phase-tasking-e2e.test.ts`, task `ci-split-tasking`). Spawned as its
 * OWN node process via `tsx`, once per phase, so the lock, agent and apply
 * phases share nothing but the handoff directory and the lock outputs (the
 * `DORFL_LOCK_OUTPUTS` env the parent passes, exactly as a workflow would).
 *
 * It does what the CLI does for `do spec:<slug> --phase <p>` (enter the process
 * phase, then `performTaskingPhase`). In the AGENT phase the model is replaced
 * by test seams: a stub tasker that writes the given candidate files and the
 * trimmed spec, a converging improver loop, and a stub task-set review that
 * logs each call to `reviewLog` and approves with prose. In the LOCK and APPLY
 * phases the seams are the PRODUCTION ones on the null harness (`true` as the
 * agent command), so any agent launch there throws the phase guard's
 * `PhaseGuardError` and fails the process. A stub review provider appends every
 * call to `providerLog`. The phase result is printed as one JSON line.
 */

import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {performTaskingPhase} from '../../src/ci-phase-tasking.js';
import {activateProcessPhase} from '../../src/phase-recorder.js';
import {NullHarness} from '../../src/harness.js';
import {harnessTaskAcceptanceGate} from '../../src/review-gate.js';
import {harnessTaskReviewGate} from '../../src/tasker-review-loop.js';
import type {ReviewProvider} from '../../src/integrator.js';
import type {Phase} from '../../src/phase.js';
import type {AgentJobResult} from '../../src/ci-agent-result.js';

interface WorkerArgs {
	phase: Phase;
	cwd: string;
	arg: string;
	integration: 'propose' | 'merge';
	handoffDir?: string;
	runnerTemp?: string;
	githubOutput?: string;
	providerLog: string;
	reviewLog: string;
	/** agent: the candidate files the stub tasker writes (slug -> content). */
	candidates?: Record<string, string>;
	/** agent: the trimmed spec body the stub tasker writes. */
	trimmedSpec?: string;
	/** agent: the spec path (repository-relative) the tasker trims. */
	specRel?: string;
	/** apply: `needs.agent.result`; default `success`. */
	agentJobResult?: AgentJobResult;
}

function stubProvider(log: string): ReviewProvider {
	const record = (method: string, input: object): void => {
		const {env: _env, ...rest} = input as {env?: unknown};
		appendFileSync(log, JSON.stringify({method, ...rest}) + '\n');
	};
	return {
		name: 'github',
		async openRequest(input) {
			record('openRequest', input);
			return {
				opened: true,
				instruction: 'opened',
				url: 'https://github.example/o/r/pull/1',
			};
		},
		postPRComment(input) {
			record('postPRComment', input);
			return {posted: true, instruction: 'commented'};
		},
		postPRCommentOnBranch(input) {
			record('postPRCommentOnBranch', input);
			return {posted: true, instruction: 'commented'};
		},
		async closeRequestOnBranch(input) {
			record('closeRequestOnBranch', input);
			return {closed: true, instruction: 'closed'};
		},
	};
}

async function main(): Promise<void> {
	const args = JSON.parse(process.argv[2]!) as WorkerArgs;
	writeFileSync(args.providerLog, '', {flag: 'a'});
	writeFileSync(args.reviewLog, '', {flag: 'a'});
	activateProcessPhase(args.phase);
	const harness = new NullHarness();
	const agentSeams =
		args.phase === 'agent'
			? {
					dorfl: ({cwd}: {cwd: string}) => {
						for (const [slug, content] of Object.entries(
							args.candidates ?? {},
						)) {
							const abs = join(cwd, 'work', 'tasks', 'backlog', `${slug}.md`);
							mkdirSync(dirname(abs), {recursive: true});
							writeFileSync(abs, content);
						}
						if (args.trimmedSpec !== undefined && args.specRel !== undefined) {
							writeFileSync(join(cwd, args.specRel), args.trimmedSpec);
						}
						return {ok: true};
					},
					reviewLoop: async () => ({verdict: 'approve' as const, findings: []}),
					taskReviewGate: async (input: {cwd: string}) => {
						appendFileSync(args.reviewLog, `${process.pid} ${input.cwd}\n`);
						return {
							verdict: 'approve' as const,
							findings: [],
							review: 'The task set covers the spec.',
						};
					},
				}
			: {
					// The PRODUCTION seams on the null harness: a launch here throws the
					// phase guard (the apply job may launch no agent).
					reviewLoop: harnessTaskReviewGate({harness, agentCmd: 'true'}),
					taskReviewGate: harnessTaskAcceptanceGate({
						harness,
						agentCmd: 'true',
					}),
				};
	const notes: string[] = [];
	const result = await performTaskingPhase({
		phase: args.phase,
		verb: 'do',
		arg: args.arg,
		cwd: args.cwd,
		arbiter: 'origin',
		integration: args.integration,
		handoffDir: args.handoffDir,
		runnerTemp: args.runnerTemp,
		githubOutput: args.githubOutput,
		mergeJitterMs: 0,
		review: true,
		harness,
		agentCmd: 'true',
		...agentSeams,
		agentResult:
			args.phase === 'apply' ? (args.agentJobResult ?? 'success') : undefined,
		providerInstance: stubProvider(args.providerLog),
		note: (m) => notes.push(m),
	});
	process.stdout.write(JSON.stringify({...result, notes}) + '\n');
}

main().catch((err: unknown) => {
	const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
	process.stderr.write(msg + '\n');
	process.exit(1);
});
