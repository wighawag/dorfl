import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {git} from '../src/git.js';
import {
	parseLockOutputLines,
	type LockOutputs,
} from '../src/ci-lock-outputs.js';
import {
	gitEnv,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * END TO END: the build path split into three CI phases (task
 * `ci-split-build-path`, user story 24). Each phase runs as its OWN process
 * (a `tsx` worker, `helpers/ci-phase-build-worker.ts`) in its OWN clone of one
 * bare arbiter; the phases share only the handoff directory and the lock
 * outputs (the `$GITHUB_OUTPUT` the lock phase wrote, passed on as
 * `DORFL_LOCK_OUTPUTS` like a workflow's `needs.lock.outputs`). The agent-phase
 * clone cannot push, and the arbiter's refs are byte-identical across the
 * agent phase.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX_BIN = join(HERE, '..', 'node_modules', '.bin', 'tsx');
const WORKER = join(HERE, 'helpers', 'ci-phase-build-worker.ts');
const SLUG = 'add-thing';
const OTHER = 'other-thing';

interface WorkerOutput {
	exitCode: number;
	outcome: string;
	message: string;
	intent?: string;
	notes: string[];
}

let scratch: Scratch;
let seeded: SeededRepo;
let runnerTemp: string;

function g(cwd: string, ...args: string[]): string {
	return git(args, cwd, {env: gitEnv()}).trim();
}

/** Every ref of the bare arbiter with its sha (`for-each-ref`), incl. lock refs. */
function arbiterRefs(): string {
	return g(seeded.arbiter, 'for-each-ref', '--format=%(refname) %(objectname)');
}

function onArbiter(rev: string): string | undefined {
	try {
		return g(seeded.arbiter, 'rev-parse', '--verify', '--quiet', rev);
	} catch {
		return undefined;
	}
}

function showOnArbiter(spec: string): string | undefined {
	try {
		return g(seeded.arbiter, 'show', spec);
	} catch {
		return undefined;
	}
}

function lockRef(slug = SLUG): string {
	return `refs/dorfl/lock/task-${slug}`;
}

function runWorker(
	args: Record<string, unknown>,
	lockOutputs?: LockOutputs,
): Promise<{exitCode: number; stderr: string; out?: WorkerOutput}> {
	return new Promise((resolve, reject) => {
		const env: NodeJS.ProcessEnv = {...gitEnv(), GITHUB_ACTIONS: 'true'};
		if (lockOutputs !== undefined) {
			// As `toJSON(needs.lock.outputs)` renders it: every value a string.
			const asStrings: Record<string, string> = {};
			for (const [k, v] of Object.entries(lockOutputs)) {
				asStrings[k] = Array.isArray(v) ? v.join(',') : String(v);
			}
			env.DORFL_LOCK_OUTPUTS = JSON.stringify(asStrings);
		}
		const child = spawn(TSX_BIN, [WORKER, JSON.stringify(args)], {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d.toString()));
		child.stderr.on('data', (d) => (stderr += d.toString()));
		child.on('error', reject);
		child.on('close', (code) => {
			let out: WorkerOutput | undefined;
			try {
				out = JSON.parse(stdout.trim().split('\n').pop() ?? '');
			} catch {
				out = undefined;
			}
			resolve({exitCode: code ?? -1, stderr, out});
		});
	});
}

/** A clone of the arbiter checked out (detached) at `rev`, like a CI job's checkout. */
function jobClone(label: string, rev?: string): string {
	const dir = seeded.clone(label);
	if (rev !== undefined) {
		g(dir, 'fetch', '-q', 'origin');
		g(dir, 'checkout', '-q', '--detach', rev);
	}
	return dir;
}

function readProviderLog(path: string): Array<Record<string, unknown>> {
	if (!existsSync(path)) return [];
	return readFileSync(path, 'utf8')
		.split('\n')
		.filter((l) => l !== '')
		.map((l) => JSON.parse(l));
}

interface ThreePhaseRun {
	lock: LockOutputs;
	agent: WorkerOutput;
	apply: WorkerOutput;
	agentProviderLog: string;
	applyProviderLog: string;
	agentClone: string;
}

/**
 * Run lock, agent and apply as three processes in three clones. `between` runs
 * after the agent phase and before the apply phase (a sibling landing on main).
 */
async function threePhases(opts: {
	integration: 'propose' | 'merge';
	agentFiles: Record<string, string>;
	between?: () => void;
}): Promise<ThreePhaseRun> {
	const common = {
		arg: SLUG,
		integration: opts.integration,
		agentSummary: 'Implemented the thing.',
		reviewProse: 'Looks right: the thing is implemented as asked.',
	};

	// lock
	const lockClone = jobClone('lock');
	const githubOutput = join(scratch.root, 'github-output');
	writeFileSync(githubOutput, '');
	const lockRun = await runWorker({
		...common,
		phase: 'lock',
		cwd: lockClone,
		githubOutput,
		providerLog: join(scratch.root, 'provider-lock.jsonl'),
	});
	expect(lockRun.exitCode, lockRun.stderr).toBe(0);
	expect(lockRun.out?.outcome).toBe('locked');
	const lock = parseLockOutputLines(readFileSync(githubOutput, 'utf8'));
	expect(lock.acquired).toBe(true);
	expect(lock.lockSha).toBe(onArbiter(lockRef()));

	// agent: its push URL cannot accept pushes; nothing on the arbiter may move.
	const agentClone = jobClone('agent', lock.baseSha);
	g(
		agentClone,
		'remote',
		'set-url',
		'--push',
		'origin',
		'/nonexistent/no-push.git',
	);
	const handoffDir = join(runnerTemp, 'handoff');
	const agentProviderLog = join(scratch.root, 'provider-agent.jsonl');
	const before = arbiterRefs();
	const agentRun = await runWorker(
		{
			...common,
			phase: 'agent',
			cwd: agentClone,
			handoffDir,
			providerLog: agentProviderLog,
			agentFiles: opts.agentFiles,
		},
		lock,
	);
	expect(agentRun.exitCode, agentRun.stderr).toBe(0);
	expect(arbiterRefs()).toBe(before);
	expect(readProviderLog(agentProviderLog)).toEqual([]);

	opts.between?.();

	// apply
	const applyClone = jobClone('apply', lock.baseSha);
	const applyProviderLog = join(scratch.root, 'provider-apply.jsonl');
	const applyRun = await runWorker(
		{
			...common,
			phase: 'apply',
			cwd: applyClone,
			handoffDir,
			runnerTemp,
			providerLog: applyProviderLog,
		},
		lock,
	);
	expect(applyRun.exitCode, applyRun.stderr).toBe(0);
	return {
		lock,
		agent: agentRun.out!,
		apply: applyRun.out!,
		agentProviderLog,
		applyProviderLog,
		agentClone,
	};
}

beforeEach(() => {
	scratch = makeScratch('dorfl-ci-phase-build-');
	seeded = seedRepoWithArbiter(scratch.root, [SLUG, OTHER]);
	runnerTemp = join(scratch.root, 'runner-temp');
	mkdirSync(runnerTemp);
});

afterEach(() => {
	scratch.cleanup();
});

describe('the build path in three processes (lock, agent, apply)', () => {
	it('propose: the apply phase pushes the branch, opens the PR and posts the review comment', async () => {
		const run = await threePhases({
			integration: 'propose',
			agentFiles: {'src/thing.ts': 'export const thing = 1;\n'},
		});
		expect(run.agent.intent).toBe('integrate');
		expect(run.apply.outcome).toBe('proposed');

		// The branch landed on the arbiter with the agent's work and the done-move.
		const branch = `refs/heads/work/task-${SLUG}`;
		expect(showOnArbiter(`${branch}:src/thing.ts`)).toContain('thing = 1');
		expect(showOnArbiter(`${branch}:work/tasks/done/${SLUG}.md`)).toBeDefined();
		// main is untouched (propose), and the lock stays held until the PR merges.
		expect(showOnArbiter(`main:work/tasks/ready/${SLUG}.md`)).toBeDefined();
		expect(onArbiter(lockRef())).toBe(run.lock.lockSha);

		const calls = readProviderLog(run.applyProviderLog);
		expect(calls.map((c) => c.method)).toEqual([
			'openRequest',
			'postPRComment',
		]);
		expect(calls[0]).toMatchObject({branch: `work/task-${SLUG}`});
		expect(String(calls[0]!.body)).toContain('Implemented the thing.');
		expect(String(calls[0]!.body)).not.toContain('Ledger changes outside');
		expect(calls[1]).toMatchObject({
			url: 'https://github.example/o/r/pull/1',
			body: 'Looks right: the thing is implemented as asked.',
		});
	}, 120_000);

	it('propose: a bundle that edits another item puts the ledger report in the PR body', async () => {
		const run = await threePhases({
			integration: 'propose',
			agentFiles: {
				'src/thing.ts': 'export const thing = 1;\n',
				[`work/tasks/ready/${OTHER}.md`]: '---\ntitle: hijacked\n---\n',
			},
		});
		expect(run.apply.outcome).toBe('proposed');
		const calls = readProviderLog(run.applyProviderLog);
		const body = String(calls.find((c) => c.method === 'openRequest')!.body);
		expect(body).toContain('Implemented the thing.');
		expect(body).toContain('### Ledger changes outside this item');
		expect(body).toContain(`"work/tasks/ready/${OTHER}.md"`);
	}, 120_000);

	it('merge: a forced non-fast-forward is absorbed by the CAS loop and the lock is released', async () => {
		let siblingSha = '';
		const run = await threePhases({
			integration: 'merge',
			agentFiles: {'src/thing.ts': 'export const thing = 1;\n'},
			// A sibling lands on main after the agent job rebased and gated, so the
			// apply phase's first push is non-fast-forward.
			between: () => {
				const sibling = seeded.clone('sibling');
				writeFileSync(join(sibling, 'SIBLING.md'), 'a sibling landed\n');
				g(sibling, 'add', '-A');
				g(sibling, 'commit', '-q', '-m', 'sibling lands');
				g(sibling, 'push', '-q', 'origin', 'HEAD:main');
				siblingSha = g(sibling, 'rev-parse', 'HEAD');
			},
		});
		expect(run.apply.outcome).toBe('landed');

		// main holds the sibling AND the item (rebased on top of it, never forced).
		const main = onArbiter('refs/heads/main')!;
		expect(g(seeded.arbiter, 'rev-parse', `${main}^`)).toBe(siblingSha);
		expect(showOnArbiter('main:src/thing.ts')).toContain('thing = 1');
		expect(showOnArbiter(`main:work/tasks/done/${SLUG}.md`)).toBeDefined();
		expect(showOnArbiter(`main:work/tasks/ready/${SLUG}.md`)).toBeUndefined();
		// The lock is released (leased on lockSha) and the merged head reaped.
		expect(onArbiter(lockRef())).toBeUndefined();
		expect(onArbiter(`refs/heads/work/task-${SLUG}`)).toBeUndefined();
		// No PR in merge mode.
		expect(readProviderLog(run.applyProviderLog)).toEqual([]);
	}, 120_000);
});
