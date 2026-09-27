/**
 * Worker for the three-process build-path split test
 * (`test/ci-phase-build-e2e.test.ts`, task `ci-split-build-path`). Spawned as
 * its OWN node process via `tsx`, once per phase, so the lock, agent and apply
 * phases share nothing but the handoff directory and the lock outputs (the
 * `DORFL_LOCK_OUTPUTS` env the parent passes, exactly as a workflow would).
 *
 * It does what the CLI does for `do <slug> --phase <p>` (enter the process
 * phase, then `performBuildPhase`), with test seams in place of the model and
 * GitHub: a stub build agent that writes the given files, a stub Gate-2 review
 * that approves with prose, and a stub review provider that appends every call
 * it receives to a JSON-lines log (so the parent can assert the agent phase
 * made none). It prints the phase result as one JSON line on stdout.
 */

import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {performBuildPhase} from '../../src/ci-phase-build.js';
import {activateProcessPhase} from '../../src/phase-recorder.js';
import type {ReviewProvider} from '../../src/integrator.js';
import type {Phase} from '../../src/phase.js';

interface WorkerArgs {
	phase: Phase;
	cwd: string;
	arg: string;
	integration: 'propose' | 'merge';
	handoffDir?: string;
	runnerTemp?: string;
	githubOutput?: string;
	/** Where the stub provider logs its calls (one JSON object per line). */
	providerLog: string;
	/** The files the stub build agent writes (repository-relative path -> content). */
	agentFiles?: Record<string, string>;
	/** The stub build agent's final summary (the PR body). */
	agentSummary?: string;
	/** The approved Gate-2 review prose. */
	reviewProse?: string;
	verify?: string;
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
	activateProcessPhase(args.phase);
	const notes: string[] = [];
	const result = await performBuildPhase({
		phase: args.phase,
		verb: 'do',
		arg: args.arg,
		cwd: args.cwd,
		arbiter: 'origin',
		integration: args.integration,
		handoffDir: args.handoffDir,
		runnerTemp: args.runnerTemp,
		githubOutput: args.githubOutput,
		verify: args.verify ?? 'true',
		freshWorktreeGate: true,
		mergeJitterMs: 0,
		review: true,
		reviewGate: async () => ({
			verdict: 'approve',
			findings: [],
			review: args.reviewProse,
		}),
		dorfl: ({cwd}) => {
			for (const [rel, content] of Object.entries(args.agentFiles ?? {})) {
				mkdirSync(dirname(join(cwd, rel)), {recursive: true});
				writeFileSync(join(cwd, rel), content);
			}
			return {ok: true, output: args.agentSummary};
		},
		providerInstance: stubProvider(args.providerLog),
		env: process.env,
		note: (m) => notes.push(m),
	});
	process.stdout.write(JSON.stringify({...result, notes}) + '\n');
}

main().catch((err: unknown) => {
	const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
	process.stderr.write(msg + '\n');
	process.exit(1);
});
