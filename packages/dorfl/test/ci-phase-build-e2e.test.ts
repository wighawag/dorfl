import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
	existsSync,
} from 'node:fs';
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
): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
	out?: WorkerOutput;
}> {
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
			resolve({exitCode: code ?? -1, stdout, stderr, out});
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
	/** The handoff directory the agent phase wrote. */
	handoffDir: string;
	/** Everything the apply process printed (stdout and stderr). */
	applyPrinted: string;
	/** The worker arguments the apply phase ran with (a re-run replays them). */
	applyArgs: Record<string, unknown>;
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
	/** Extra apply-phase worker arguments (the agent job result, the stub API). */
	apply?: Record<string, unknown>;
	/** The agent job's setup, run in its clone before the agent phase (e.g. `git lfs install --local`). */
	agentSetup?: (clone: string) => void;
	/** Runs right after the agent phase, before `between` (e.g. an assertion on the arbiter). */
	afterAgent?: () => void;
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
	opts.agentSetup?.(agentClone);
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
	opts.afterAgent?.();

	opts.between?.();

	// apply
	const applyClone = jobClone('apply', lock.baseSha);
	const applyProviderLog = join(scratch.root, 'provider-apply.jsonl');
	const refsBeforeApply = arbiterRefs();
	const applyArgs = {
		...common,
		phase: 'apply',
		cwd: applyClone,
		handoffDir,
		runnerTemp,
		providerLog: applyProviderLog,
		...opts.apply,
	};
	const applyRun = await runWorker(applyArgs, lock);
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
		handoffDir,
		applyPrinted: applyRun.stdout + applyRun.stderr,
		applyArgs,
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
		// The landed tree is a re-rebase the gate never saw (decision 2): the
		// landed commit's trailer and the run output say so, with the count.
		expect(
			g(
				seeded.arbiter,
				'log',
				'-1',
				'--format=%(trailers:key=Landed-Without-Regate,valueonly)',
				'main',
			),
		).toBe('landed without re-gate after 1 lost race');
		expect(run.apply.notes).toContain(
			`work/task-${SLUG} landed without re-gate after 1 lost race.`,
		);
	}, 120_000);

	it('merge: a land that wins its first push carries no landed-vs-gated report', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: {'src/thing.ts': 'export const thing = 1;\n'},
		});
		expect(run.apply.outcome).toBe('landed');
		expect(showOnArbiter('main:src/thing.ts')).toContain('thing = 1');
		expect(
			g(
				seeded.arbiter,
				'log',
				'-1',
				'--format=%(trailers:key=Landed-Without-Regate)',
				'main',
			),
		).toBe('');
		expect(run.apply.notes.join('\n')).not.toContain('landed without re-gate');
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

// ---------------------------------------------------------------------------
// The agent job's result and GitHub re-runs (task
// `ci-split-agent-result-and-reruns`, decision 5)
// ---------------------------------------------------------------------------

const TIMEOUT_ANNOTATION =
	'The job has exceeded the maximum execution time of 1h30m0s';
const CANCEL_ANNOTATION = 'The run was canceled by @user.';

describe('the agent job result in three processes', () => {
	/**
	 * Each case runs a real agent phase that writes a VALID integrate handoff in
	 * merge mode: from the apply job's point of view it is a forged artifact next
	 * to a non-success result. Reading it would land the work on main.
	 */
	function expectArtifactIgnored(run: ThreePhaseRun): void {
		expect(run.agent.intent).toBe('integrate');
		expect(showOnArbiter('main:src/thing.ts')).toBeUndefined();
		expect(showOnArbiter(`main:work/tasks/done/${SLUG}.md`)).toBeUndefined();
		expect(onArbiter(WORK_BRANCH)).toBeUndefined();
		expect(readProviderLog(run.applyProviderLog)).toEqual([]);
	}

	function apiLog(): string {
		return join(scratch.root, 'actions-api.log');
	}

	function apiUrls(): string[] {
		if (!existsSync(apiLog())) return [];
		return readFileSync(apiLog(), 'utf8')
			.split('\n')
			.filter((l) => l !== '');
	}

	const FILES = {'src/thing.ts': 'export const thing = 1;\n'};

	it('failure: surfaced, lock released, the artifact never read, the API never read', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: FILES,
			apply: {agentJobResult: 'failure'},
		});
		expect(run.apply.outcome).toBe('surfaced');
		expect(run.apply.message).toMatch(/the agent job failed/);
		expectArtifactIgnored(run);
		expect(bodyOnMain()).toMatch(/needsAnswers: true/);
		expect(onArbiter(lockRef())).toBeUndefined();
		expect(apiUrls()).toEqual([]);
	}, 120_000);

	it('timeout (cancelled with the timeout annotation on page 2): surfaced, lock released, annotation text never printed', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: FILES,
			apply: {
				agentJobResult: 'cancelled',
				actionsApi: {
					agentMinutes: 12,
					annotationPages: [
						['::error::the agent was here', 'The operation was canceled.'],
						[`::error::${TIMEOUT_ANNOTATION}`],
					],
					log: apiLog(),
				},
			},
		});
		expect(run.apply.outcome).toBe('surfaced');
		expect(run.apply.message).toMatch(/timed out/);
		expectArtifactIgnored(run);
		expect(bodyOnMain()).toMatch(/needsAnswers: true/);
		expect(onArbiter(lockRef())).toBeUndefined();
		// This run attempt's jobs, then every annotation page of the agent job.
		expect(apiUrls()).toHaveLength(3);
		expect(apiUrls()[0]).toContain('/actions/runs/77/attempts/1/jobs');
		expect(run.applyPrinted).not.toContain('::error::');
		expect(run.applyPrinted).not.toContain('the agent was here');
	}, 120_000);

	it('timeout by duration (within a minute of the lock job agentTimeoutMinutes): surfaced', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: FILES,
			apply: {
				agentJobResult: 'cancelled',
				actionsApi: {
					agentMinutes: 89.5,
					annotationPages: [[CANCEL_ANNOTATION]],
					log: apiLog(),
				},
			},
		});
		expect(run.lock.agentTimeoutMinutes).toBe(90);
		expect(run.apply.outcome).toBe('surfaced');
		expectArtifactIgnored(run);
		expect(onArbiter(lockRef())).toBeUndefined();
	}, 120_000);

	it('cancelled by a user: the lock only released, nothing surfaced, the artifact never read', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: FILES,
			apply: {
				agentJobResult: 'cancelled',
				agentTimeoutMinutes: 90,
				actionsApi: {
					agentMinutes: 4,
					annotationPages: [[CANCEL_ANNOTATION]],
					log: apiLog(),
				},
			},
		});
		expect(run.apply.outcome).toBe('released');
		expectArtifactIgnored(run);
		expect(bodyOnMain()).not.toMatch(/needsAnswers: true/);
		expect(onArbiter(lockRef())).toBeUndefined();
		// Only the lock ref moved.
		const withoutLock = (refs: string) =>
			refs
				.split('\n')
				.filter((l) => !l.startsWith(lockRef()))
				.join('\n');
		expect(withoutLock(arbiterRefs())).toBe(withoutLock(run.refsBeforeApply));
	}, 120_000);

	it('skipped although the lock said needsAgent: true: treated as a failure', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: FILES,
			apply: {agentJobResult: 'skipped'},
		});
		expect(run.lock.needsAgent).toBe(true);
		expect(run.apply.outcome).toBe('surfaced');
		expect(run.apply.message).toMatch(/skipped/);
		expectArtifactIgnored(run);
		expect(bodyOnMain()).toMatch(/needsAnswers: true/);
		expect(onArbiter(lockRef())).toBeUndefined();
	}, 120_000);
});

describe('GitHub re-runs in three processes', () => {
	it('"Re-run failed jobs": the apply job replayed after the lock was released writes nothing', async () => {
		const run = await threePhases({
			integration: 'merge',
			agentFiles: {'src/thing.ts': 'export const thing = 1;\n'},
		});
		expect(run.apply.outcome).toBe('landed');
		expect(onArbiter(lockRef())).toBeUndefined();

		// The re-run replays the same lock outputs and the same artifact.
		const before = arbiterRefs();
		const rerun = await runWorker(
			{
				...run.applyArgs,
				cwd: jobClone('apply-rerun', run.lock.baseSha),
				providerLog: join(scratch.root, 'provider-rerun.jsonl'),
			},
			run.lock,
		);
		expect(rerun.exitCode, rerun.stderr).toBe(0);
		expect(rerun.out?.outcome).toBe('stale-lock');
		expect(rerun.out?.exitCode).toBe(1);
		expect(rerun.out?.message).toMatch(/start a NEW run/);
		expect(arbiterRefs()).toBe(before);
		expect(readProviderLog(join(scratch.root, 'provider-rerun.jsonl'))).toEqual(
			[],
		);
	}, 120_000);

	it('"Re-run all jobs": a fresh lock at the current tip and a new artifact name', async () => {
		// Attempt 1: the agent job was cancelled, so the lock was only released.
		const first = await threePhases({
			integration: 'merge',
			agentFiles: {'src/thing.ts': 'export const thing = 1;\n'},
			apply: {
				agentJobResult: 'cancelled',
				agentTimeoutMinutes: 90,
				actionsApi: {
					agentMinutes: 2,
					annotationPages: [[CANCEL_ANNOTATION]],
					log: join(scratch.root, 'actions-api.log'),
				},
			},
		});
		expect(first.apply.outcome).toBe('released');
		expect(first.lock.handoffName).toBe(`dorfl-handoff-task-${SLUG}-attempt-1`);

		// A sibling lands meanwhile: attempt 2 classifies at the NEW tip.
		const tip = commitToMain({'SIBLING.md': 'sibling\n'}, 'sibling lands');
		const githubOutput = join(scratch.root, 'github-output-attempt-2');
		writeFileSync(githubOutput, '');
		const relock = await runWorker({
			phase: 'lock',
			arg: SLUG,
			integration: 'merge',
			cwd: jobClone('lock-attempt-2'),
			githubOutput,
			runAttempt: '2',
			providerLog: join(scratch.root, 'provider-lock-2.jsonl'),
		});
		expect(relock.exitCode, relock.stderr).toBe(0);
		expect(relock.out?.outcome).toBe('locked');
		const lock2 = parseLockOutputLines(readFileSync(githubOutput, 'utf8'));
		expect(lock2.baseSha).toBe(tip);
		expect(lock2.handoffName).toBe(`dorfl-handoff-task-${SLUG}-attempt-2`);
		expect(lock2.handoffName).not.toBe(first.lock.handoffName);
		expect(lock2.lockSha).toBe(onArbiter(lockRef()));
		expect(lock2.lockSha).not.toBe(first.lock.lockSha);
	}, 120_000);
});

// ---------------------------------------------------------------------------
// Git LFS objects (task `ci-split-handoff-lfs-objects`, decision 6)
// ---------------------------------------------------------------------------

/**
 * The LFS cases need `git-lfs`. They must not silently skip in CI (GitHub-hosted
 * runners have it): there they run, and fail loudly without it. Locally they
 * skip with a message naming the missing binary.
 */
const HAS_GIT_LFS =
	spawnSync('git-lfs', ['version'], {stdio: 'ignore'}).status === 0;
const IN_CI =
	process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
if (!HAS_GIT_LFS && !IN_CI) {
	console.warn(
		'skipping the LFS three-process cases: the `git-lfs` binary is not on PATH',
	);
}

describe.skipIf(!HAS_GIT_LFS && !IN_CI)(
	'LFS objects in three processes',
	() => {
		const PAYLOAD = 'binary-ish asset stored in Git LFS\n'.repeat(64);
		const OID = createHash('sha256').update(PAYLOAD).digest('hex');
		const LFS_PATH = 'assets/logo.bin';

		/** Where the arbiter's standalone file transfer stores the object. */
		function arbiterObject(): string {
			return join(
				seeded.arbiter,
				'lfs',
				'objects',
				OID.slice(0, 2),
				OID.slice(2, 4),
				OID,
			);
		}

		/**
		 * A pre-receive hook on the arbiter that records, for every branch the
		 * apply phase pushes, whether the LFS object was already in the store
		 * when the ref arrived.
		 */
		function recordObjectPresenceAtEachRefPush(): string {
			const log = join(scratch.root, 'pre-receive.log');
			const hook = join(seeded.arbiter, 'hooks', 'pre-receive');
			writeFileSync(
				hook,
				'#!/bin/sh\n' +
					'while read old new ref; do\n' +
					`  if [ -f '${arbiterObject()}' ]; then s=present; else s=absent; fi\n` +
					`  echo "$ref $s" >> '${log}'\n` +
					'done\n' +
					'exit 0\n',
			);
			chmodSync(hook, 0o755);
			return log;
		}

		function branchPushes(log: string): string[] {
			if (!existsSync(log)) return [];
			return readFileSync(log, 'utf8')
				.split('\n')
				.filter((l) => l.startsWith('refs/heads/'));
		}

		function lfsSetup(clone: string): void {
			// The agent job's setup step: pointers on commit, objects in .git/lfs.
			g(clone, 'lfs', 'install', '--local');
		}

		/** Nothing reached the arbiter's LFS store while the agent phase ran. */
		function expectAgentUploadedNothing(): void {
			expect(existsSync(join(seeded.arbiter, 'lfs'))).toBe(false);
		}

		beforeEach(() => {
			commitToMain(
				{'.gitattributes': '*.bin filter=lfs diff=lfs merge=lfs -text\n'},
				'track *.bin with LFS',
			);
		});

		it('merge: the object reaches the arbiter LFS store before the ref, and the agent clone uploaded nothing', async () => {
			let log = '';
			const run = await threePhases({
				integration: 'merge',
				agentFiles: {[LFS_PATH]: PAYLOAD},
				agentSetup: lfsSetup,
				afterAgent: expectAgentUploadedNothing,
				between: () => {
					log = recordObjectPresenceAtEachRefPush();
				},
			});
			expect(run.agent.intent).toBe('integrate');
			// The agent committed a pointer, and handed its object over.
			expect(readdirSync(join(run.handoffDir, 'lfs'))).toEqual([OID]);
			expect(run.apply.outcome).toBe('landed');

			// main carries the pointer; the store carries the object.
			expect(showOnArbiter(`main:${LFS_PATH}`)).toContain(`oid sha256:${OID}`);
			expect(readFileSync(arbiterObject(), 'utf8')).toBe(PAYLOAD);
			// Every branch push (main here) found the object already stored.
			const pushes = branchPushes(log);
			expect(pushes).toContain('refs/heads/main present');
			expect(pushes.filter((l) => l.endsWith(' absent'))).toEqual([]);
		}, 120_000);

		it('needs-attention: the object reaches the LFS store before the WIP branch', async () => {
			let log = '';
			const run = await threePhases({
				integration: 'merge',
				agentFiles: {[LFS_PATH]: PAYLOAD},
				verify: 'false',
				agentSetup: lfsSetup,
				afterAgent: expectAgentUploadedNothing,
				between: () => {
					log = recordObjectPresenceAtEachRefPush();
				},
			});
			expect(run.agent.intent).toBe('needs-attention');
			expect(run.apply.outcome).toBe('surfaced');
			expect(showOnArbiter(`${WORK_BRANCH}:${LFS_PATH}`)).toContain(
				`oid sha256:${OID}`,
			);
			expect(readFileSync(arbiterObject(), 'utf8')).toBe(PAYLOAD);
			const pushes = branchPushes(log);
			expect(pushes).toContain(`${WORK_BRANCH} present`);
			expect(pushes.filter((l) => l.endsWith(' absent'))).toEqual([]);
			expect(onArbiter(lockRef())).toBeUndefined();
		}, 120_000);
	},
);
