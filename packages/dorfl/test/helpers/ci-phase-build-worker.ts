/**
 * Worker for the three-process build-path split test
 * (`test/ci-phase-build-e2e.test.ts`, tasks `ci-split-build-path` and
 * `ci-split-build-path-non-integrate-intents`). Spawned as
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
import type {AgentJobResult, GithubApiGet} from '../../src/ci-agent-result.js';

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
	/**
	 * How the stub build agent ends, over the default `{ok: true, output:
	 * agentSummary}`: `{ok: false, detail}` for an agent failure, `{timedOut:
	 * true}` for the dorfl-internal deadline, an `output` carrying the STOP
	 * sentinel for a deliberate STOP.
	 */
	agentResult?: {
		ok?: boolean;
		detail?: string;
		output?: string;
		timedOut?: boolean;
		/** The harness's cut-off-final-turn signal (`length` / `error` stop). */
		cutOffTurn?: {cause: 'length' | 'error'; errorMessage?: string};
	};
	/** The resolved `maxAutoCheckpoints` option (the config at baseSha wins). */
	maxAutoCheckpoints?: number;
	/** apply: `needs.agent.result` (`--agent-result`); default `success`. */
	agentJobResult?: AgentJobResult;
	/** apply: `--agent-timeout-minutes`. */
	agentTimeoutMinutes?: number;
	/** lock: `github.run_attempt`. */
	runAttempt?: string;
	/**
	 * apply: a stub Actions API for this run attempt: the agent job ran
	 * `agentMinutes` minutes and carries these annotation pages. Every URL it is
	 * asked for is appended to `log`.
	 */
	actionsApi?: {agentMinutes: number; annotationPages: string[][]; log: string};
	/**
	 * apply: the stub provider's `openRequest` DEGRADES with this `gh` error
	 * (`opened: false`), as a repository that refuses PR creation by Actions does.
	 */
	prCreationFails?: string;
}

/** The stub Actions API of {@link WorkerArgs.actionsApi}. */
function stubActionsApi(
	stub: NonNullable<WorkerArgs['actionsApi']>,
): GithubApiGet {
	const start = Date.parse('2026-09-27T10:00:00Z');
	return async (url) => {
		appendFileSync(stub.log, url + '\n');
		if (url.includes('/actions/runs/') && url.includes('/jobs')) {
			return {
				status: 200,
				body: {
					jobs: [
						{id: 1, name: 'item / lock'},
						{
							id: 2,
							name: 'item / agent',
							started_at: new Date(start).toISOString(),
							completed_at: new Date(
								start + stub.agentMinutes * 60_000,
							).toISOString(),
						},
					],
				},
			};
		}
		if (url.includes('/check-runs/2/annotations')) {
			const page = Number(/[?&]page=([0-9]+)/.exec(url)?.[1] ?? '1');
			const messages = stub.annotationPages[page - 1] ?? [];
			const base = url.replace(/&page=[0-9]+$/, '');
			return {
				status: 200,
				body: messages.map((message) => ({message})),
				next:
					page < stub.annotationPages.length
						? `${base}&page=${page + 1}`
						: undefined,
			};
		}
		return {status: 404, body: {}};
	};
}

function stubProvider(log: string, prCreationFails?: string): ReviewProvider {
	const record = (method: string, input: object): void => {
		const {env: _env, ...rest} = input as {env?: unknown};
		appendFileSync(log, JSON.stringify({method, ...rest}) + '\n');
	};
	return {
		name: 'github',
		async openRequest(input) {
			record('openRequest', input);
			if (prCreationFails !== undefined) {
				return {
					opened: false,
					instruction:
						`Pushed ${input.branch} to ${input.arbiter}. ${prCreationFails} ` +
						'No PR was opened, open one manually.',
				};
			}
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
			return {ok: true, output: args.agentSummary, ...args.agentResult};
		},
		maxAutoCheckpoints: args.maxAutoCheckpoints,
		agentResult:
			args.phase === 'apply' ? (args.agentJobResult ?? 'success') : undefined,
		agentTimeoutMinutes: args.agentTimeoutMinutes,
		runAttempt: args.runAttempt,
		actionsApi:
			args.actionsApi === undefined
				? undefined
				: stubActionsApi(args.actionsApi),
		providerInstance: stubProvider(args.providerLog, args.prCreationFails),
		env: {
			...process.env,
			GITHUB_REPOSITORY: 'o/r',
			GITHUB_RUN_ID: '77',
			GITHUB_RUN_ATTEMPT: args.runAttempt ?? '1',
		},
		note: (m) => notes.push(m),
	});
	process.stdout.write(JSON.stringify({...result, notes}) + '\n');
}

main().catch((err: unknown) => {
	const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
	process.stderr.write(msg + '\n');
	process.exit(1);
});
