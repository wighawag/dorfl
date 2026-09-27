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
	/** The arbiter's refs right before the apply phase ran. */
	refsBeforeApply: string;
}

/**
 * Run lock, agent and apply as three processes in three clones. `between` runs
 * after the agent phase and before the apply phase (a sibling landing on main).
 */
async function threePhases(opts: {
	integration: 'propose' | 'merge';
	agentFiles: Record<string, string>;
	between?: () => void;
	/** How the stub build agent ends (see the worker's `agentResult`). */
	agentResult?: Record<string, unknown>;
	/** The acceptance gate (`verify`); default green. */
	verify?: string;
	/** The apply phase's expected result exit code; default 0. */
	applyExit?: number;
}): Promise<ThreePhaseRun> {
	const common = {
		arg: SLUG,
		integration: opts.integration,
		agentSummary: 'Implemented the thing.',
		reviewProse: 'Looks right: the thing is implemented as asked.',
		...(opts.verify === undefined ? {} : {verify: opts.verify}),
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
			agentResult: opts.agentResult,
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
	const refsBeforeApply = arbiterRefs();
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
	expect(applyRun.out?.exitCode, applyRun.out?.message).toBe(
		opts.applyExit ?? 0,
	);
	return {
		lock,
		agent: agentRun.out!,
		apply: applyRun.out!,
		agentProviderLog,
		applyProviderLog,
		agentClone,
		refsBeforeApply,
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

// ---------------------------------------------------------------------------
// The non-integrate outcomes (task `ci-split-build-path-non-integrate-intents`)
// ---------------------------------------------------------------------------

const WORK_BRANCH = `refs/heads/work/task-${SLUG}`;

/** Land `files` on the arbiter's main from a sibling clone; return the new tip. */
function commitToMain(files: Record<string, string>, message: string): string {
	const sibling = seeded.clone(`main-${Math.random().toString(36).slice(2)}`);
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(sibling, rel)), {recursive: true});
		writeFileSync(join(sibling, rel), content);
	}
	g(sibling, 'add', '-A');
	g(sibling, 'commit', '-q', '-m', message);
	g(sibling, 'push', '-q', 'origin', 'HEAD:main');
	return g(sibling, 'rev-parse', 'HEAD');
}

/**
 * Push a KEPT `work/task-<slug>` (a requeued item's branch) cut from the
 * arbiter's current main, then move main on, so the continue must rebase it.
 */
function seedKeptBranch(
	files: Record<string, string>,
	subject = 'kept work',
): string {
	const kept = seeded.clone(`kept-${Math.random().toString(36).slice(2)}`);
	g(kept, 'checkout', '-q', '-b', `work/task-${SLUG}`);
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(kept, rel)), {recursive: true});
		writeFileSync(join(kept, rel), content);
	}
	g(kept, 'add', '-A');
	g(kept, 'commit', '-q', '-m', subject);
	g(kept, 'push', '-q', 'origin', `work/task-${SLUG}`);
	const tip = g(kept, 'rev-parse', 'HEAD');
	commitToMain({'MAINLINE.md': 'main moved on\n'}, 'mainline moves');
	return tip;
}

/** The item body on the arbiter's main. */
function bodyOnMain(): string {
	return showOnArbiter(`main:work/tasks/ready/${SLUG}.md`) ?? '';
}

/** Subjects of the work branch's commits that main lacks, newest first. */
function branchSubjects(): string[] {
	return g(seeded.arbiter, 'log', '--format=%s', WORK_BRANCH, '^main')
		.split('\n')
		.filter((l) => l !== '');
}

describe('the build path non-integrate outcomes in three processes', () => {
	it('continue: the agent rebases the kept branch locally and the apply pushes it leased on continueTip', async () => {
		const keptTip = seedKeptBranch({'src/kept.ts': 'export const kept = 1;\n'});
		const run = await threePhases({
			integration: 'propose',
			agentFiles: {'src/thing.ts': 'export const thing = 1;\n'},
		});
		expect(run.lock.continueTip).toBe(keptTip);
		expect(run.agent.intent).toBe('integrate');
		expect(run.apply.outcome).toBe('proposed');

		// The rebased branch replaced the kept tip: it now sits on main, carries
		// the kept work, the agent's work and the done-move.
		const tip = onArbiter(WORK_BRANCH)!;
		expect(tip).not.toBe(keptTip);
		const main = onArbiter('refs/heads/main')!;
		expect(g(seeded.arbiter, 'merge-base', main, tip)).toBe(main);
		expect(showOnArbiter(`${WORK_BRANCH}:src/kept.ts`)).toContain('kept = 1');
		expect(showOnArbiter(`${WORK_BRANCH}:src/thing.ts`)).toContain('thing = 1');
		expect(
			showOnArbiter(`${WORK_BRANCH}:work/tasks/done/${SLUG}.md`),
		).toBeDefined();
		expect(readProviderLog(run.applyProviderLog).map((c) => c.method)).toEqual([
			'openRequest',
			'postPRComment',
		]);
	}, 120_000);

	it('continue: a stale lease (the kept branch moved) fails the apply cleanly without writing', async () => {
		seedKeptBranch({'src/kept.ts': 'export const kept = 1;\n'});
		const run = await threePhases({
			integration: 'propose',
			agentFiles: {'src/thing.ts': 'export const thing = 1;\n'},
			// Someone pushes to the kept branch after the lock job observed it.
			between: () => {
				const other = seeded.clone('mover');
				g(other, 'fetch', '-q', 'origin');
				g(other, 'checkout', '-q', '-b', 'moved', `origin/work/task-${SLUG}`);
				writeFileSync(join(other, 'MOVED.md'), 'moved\n');
				g(other, 'add', '-A');
				g(other, 'commit', '-q', '-m', 'moved');
				g(other, 'push', '-q', 'origin', `HEAD:work/task-${SLUG}`);
			},
			applyExit: 1,
		});
		expect(run.apply.outcome).toBe('stale-lease');
		expect(arbiterRefs()).toBe(run.refsBeforeApply);
		expect(onArbiter(lockRef())).toBe(run.lock.lockSha);
		expect(readProviderLog(run.applyProviderLog)).toEqual([]);
	}, 120_000);

	it('a red gate: needs-attention, the WIP branch pushed, the item surfaced and the lock released', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: {'src/thing.ts': 'export const thing = 1;\n'},
			verify: 'false',
		});
		expect(run.agent.intent).toBe('needs-attention');
		expect(run.apply.outcome).toBe('surfaced');
		expect(run.apply.message).toMatch(/acceptance gate failed/);
		expect(showOnArbiter(`${WORK_BRANCH}:src/thing.ts`)).toContain('thing = 1');
		expect(bodyOnMain()).toMatch(/needsAnswers: true/);
		expect(showOnArbiter('main:src/thing.ts')).toBeUndefined();
		expect(onArbiter(lockRef())).toBeUndefined();
	}, 120_000);

	it('a deadline checkpoint under the ceiling: WIP pushed, lock released, nothing surfaced', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: {'src/half.ts': 'export const half = 1;\n'},
			agentResult: {ok: false, timedOut: true},
		});
		expect(run.agent.intent).toBe('deadline-checkpoint');
		expect(run.apply.outcome).toBe('auto-continued');
		expect(branchSubjects()).toEqual([
			`chore(deadline-checkpoint): save wip for '${SLUG}'`,
		]);
		expect(showOnArbiter(`${WORK_BRANCH}:src/half.ts`)).toContain('half = 1');
		expect(bodyOnMain()).not.toMatch(/needsAnswers: true/);
		expect(onArbiter(lockRef())).toBeUndefined();
	}, 120_000);

	it('a deadline checkpoint at the ceiling (maxAutoCheckpoints from the config at baseSha) surfaces', async () => {
		commitToMain({'dorfl.json': '{"maxAutoCheckpoints": 1}\n'}, 'ceiling 1');
		const keptTip = seedKeptBranch(
			{'src/half.ts': 'export const half = 1;\n'},
			`chore(deadline-checkpoint): save wip for '${SLUG}'`,
		);
		const run = await threePhases({
			integration: 'merge',
			agentFiles: {'src/more.ts': 'export const more = 1;\n'},
			agentResult: {ok: false, timedOut: true},
			applyExit: 1,
		});
		expect(run.lock.continueTip).toBe(keptTip);
		expect(run.agent.intent).toBe('deadline-checkpoint');
		expect(run.apply.outcome).toBe('surfaced');
		expect(run.apply.message).toMatch(/ceiling 2\/1/);
		expect(branchSubjects()).toHaveLength(2);
		expect(showOnArbiter(`${WORK_BRANCH}:src/more.ts`)).toContain('more = 1');
		expect(bodyOnMain()).toMatch(/needsAnswers: true/);
		expect(onArbiter(lockRef())).toBeUndefined();
	}, 120_000);

	it('a clean STOP: surfaced with the agent reason, the gate never ran, the lock released', async () => {
		const reason = 'The task names a module that no longer exists.';
		const run = await threePhases({
			integration: 'merge',
			agentFiles: {},
			agentResult: {
				ok: true,
				output: `I stopped.\n\n=== TASK-STOP ===\n${reason}\n=== END TASK-STOP ===\n`,
			},
			// A red gate would be reported instead if the gate ran.
			verify: 'false',
		});
		expect(run.agent.intent).toBe('stop');
		expect(run.apply.outcome).toBe('surfaced');
		expect(run.apply.message).toContain('STOPPED');
		expect(run.apply.message).toContain(reason);
		expect(bodyOnMain()).toMatch(/needsAnswers: true/);
		expect(onArbiter(WORK_BRANCH)).toBeUndefined();
		expect(onArbiter(lockRef())).toBeUndefined();
	}, 120_000);

	it('an agent failure with WIP: the partial work pushed, the item surfaced, the lock released', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: {'src/partial.ts': 'export const partial = 1;\n'},
			agentResult: {ok: false, detail: 'the model crashed mid-run'},
		});
		expect(run.agent.intent).toBe('agent-failed');
		expect(run.apply.outcome).toBe('surfaced');
		expect(run.apply.message).toContain('the model crashed mid-run');
		expect(branchSubjects()).toEqual([
			`chore(${SLUG}): save aborted work (wip)`,
		]);
		expect(showOnArbiter(`${WORK_BRANCH}:src/partial.ts`)).toContain(
			'partial = 1',
		);
		expect(bodyOnMain()).toMatch(/needsAnswers: true/);
		expect(onArbiter(lockRef())).toBeUndefined();
	}, 120_000);
});
