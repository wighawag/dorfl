import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {git} from '../src/git.js';
import {
	parseLockOutputLines,
	type LockOutputs,
} from '../src/ci-lock-outputs.js';
import {
	performTreelessPhase,
	type TreelessPhaseOptions,
} from '../src/ci-phase-treeless.js';
import {activateProcessPhase} from '../src/phase-recorder.js';
import type {GithubApiGet} from '../src/ci-agent-result.js';
import type {Phase} from '../src/phase.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {
	parseSidecar,
	serialiseSidecar,
	sidecarPathFor,
} from '../src/sidecar.js';
import {
	gitEnv,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';
import {answeredSidecar} from './helpers/treeless-scenarios.js';

/**
 * END TO END: the answered merge action split into three CI phases (task
 * `ci-split-answered-merge-action`, spec `ci-agent-job-without-write-token` §3,
 * the `apply, kind: merge` row). Each phase runs as its OWN process
 * (`helpers/ci-phase-treeless-worker.ts`) in its OWN clone of one bare arbiter;
 * the phases share only the handoff directory and the lock outputs. The agent
 * phase checks the kept `work/task-<slug>` out through `createJob`, rebases it
 * LOCALLY, gates the rebased tip, and writes nothing to the arbiter (its refs
 * are byte-identical across it). The apply phase pushes the rebased branch
 * leased on the lock job's `continueTip`, lands it through the compare-and-swap
 * loop and records the answer.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX_BIN = join(HERE, '..', 'node_modules', '.bin', 'tsx');
const WORKER = join(HERE, 'helpers', 'ci-phase-treeless-worker.ts');
const SLUG = 'land-me';
const ITEM = `task:${SLUG}`;
const BRANCH = `work/task-${SLUG}`;
const LOCK_REF = `refs/dorfl/lock/task-${SLUG}`;
const WORK_SUBJECT = `feat(${SLUG}): build the thing; done`;

interface WorkerOutput {
	exitCode: number;
	outcome: string;
	message: string;
	intent?: string;
	rungOutcome?: string;
	notes: string[];
}

let scratch: Scratch;
let seeded: SeededRepo;
let runnerTemp: string;

function g(cwd: string, ...args: string[]): string {
	return git(args, cwd, {env: gitEnv()}).trim();
}

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
		return git(['show', spec], seeded.arbiter, {env: gitEnv()});
	} catch {
		return undefined;
	}
}

function runWorker(
	args: Record<string, unknown>,
	lockOutputs?: LockOutputs,
): Promise<{exitCode: number; stderr: string; out?: WorkerOutput}> {
	return new Promise((resolve, reject) => {
		const env: NodeJS.ProcessEnv = {...gitEnv(), GITHUB_ACTIONS: 'true'};
		if (lockOutputs !== undefined) {
			const asStrings: Record<string, string> = {};
			for (const [k, v] of Object.entries(lockOutputs)) {
				asStrings[k] = String(v);
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
 * The answered-merge state: a kept `work/task-<slug>` on the arbiter carrying a
 * build and its done-move (`files`, cut from main), then on main the task with
 * `needsAnswers: true` and a `kind: merge` sidecar answered `answer`. Returns
 * the kept tip.
 */
function seedAnsweredMerge(
	opts: {
		answer?: string;
		/** Record the arbiter `main` the question is asked against (as the surfacer does). */
		askedAtMain?: boolean;
		files?: Record<string, string>;
		keptSetup?: (clone: string) => void;
	} = {},
): string {
	const kept = seeded.clone('kept');
	opts.keptSetup?.(kept);
	g(kept, 'checkout', '-q', '-b', BRANCH);
	const files = opts.files ?? {'feature.txt': 'the work\n'};
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(kept, rel)), {recursive: true});
		writeFileSync(join(kept, rel), content);
	}
	mkdirSync(join(kept, 'work', 'tasks', 'done'), {recursive: true});
	g(kept, 'mv', `work/tasks/ready/${SLUG}.md`, `work/tasks/done/${SLUG}.md`);
	g(kept, 'add', '-A');
	g(kept, 'commit', '-q', '-m', WORK_SUBJECT);
	g(kept, 'push', '-q', 'origin', BRANCH);
	const keptTip = g(kept, 'rev-parse', 'HEAD');

	const body = readFileSync(
		join(seeded.repo, 'work', 'tasks', 'ready', `${SLUG}.md`),
		'utf8',
	).replace('blockedBy: []', 'needsAnswers: true\nblockedBy: []');
	const askedAtMain =
		opts.askedAtMain === true ? onArbiter('refs/heads/main') : undefined;
	commitToMain(
		{
			[`work/tasks/ready/${SLUG}.md`]: body,
			[sidecarPathFor(ITEM)]: answeredSidecar(ITEM, [
				{
					question: `Land \`${BRANCH}\`?`,
					context: 'An unmerged work/* branch is awaiting a decision.',
					default: 'merge | hold | drop',
					kind: 'merge',
					...(askedAtMain === undefined ? {} : {askedAtMain}),
					answer: opts.answer ?? 'merge',
				},
			]),
		},
		`surface ${ITEM}: answered merge-question`,
	);
	return keptTip;
}

interface ThreePhaseRun {
	lock: LockOutputs;
	agent?: WorkerOutput;
	apply: WorkerOutput;
	refsBeforeApply: string;
	handoffDir: string;
}

/**
 * Run lock, agent and apply as three processes in three clones. The agent
 * clone cannot push, and the arbiter's refs must not move while it runs.
 * `between` runs after the agent phase and before the apply phase.
 */
async function threePhases(
	opts: {
		verify?: string;
		strictMergeApproval?: boolean;
		between?: () => void;
		applyExit?: number;
		agentSetup?: (clone: string) => void;
	} = {},
): Promise<ThreePhaseRun> {
	const common = {
		arg: ITEM,
		emits: {},
		workspacesDir: join(scratch.root, 'ws'),
		...(opts.verify === undefined ? {} : {verify: opts.verify}),
		...(opts.strictMergeApproval === undefined
			? {}
			: {strictMergeApproval: opts.strictMergeApproval}),
	};

	const githubOutput = join(scratch.root, 'github-output');
	writeFileSync(githubOutput, '');
	const lockRun = await runWorker({
		...common,
		phase: 'lock',
		cwd: seeded.clone('lock'),
		githubOutput,
	});
	expect(lockRun.exitCode, lockRun.stderr).toBe(0);
	expect(lockRun.out?.outcome, lockRun.out?.message).toBe('locked');
	const lock = parseLockOutputLines(readFileSync(githubOutput, 'utf8'));

	const handoffDir = join(runnerTemp, 'handoff');
	let agent: WorkerOutput | undefined;
	if (lock.needsAgent === true) {
		const agentClone = seeded.clone('agent');
		g(agentClone, 'remote', 'set-url', '--push', 'origin', '/nonexistent.git');
		opts.agentSetup?.(agentClone);
		const before = arbiterRefs();
		const agentRun = await runWorker(
			{...common, phase: 'agent', cwd: agentClone, handoffDir},
			lock,
		);
		expect(agentRun.exitCode, agentRun.stderr).toBe(0);
		expect(agentRun.out?.outcome, agentRun.out?.message).toBe('handed-over');
		// The agent phase wrote nothing to the arbiter.
		expect(arbiterRefs()).toBe(before);
		agent = agentRun.out;
	}

	opts.between?.();

	const refsBeforeApply = arbiterRefs();
	const applyRun = await runWorker(
		{
			...common,
			phase: 'apply',
			cwd: seeded.clone('apply'),
			handoffDir,
			runnerTemp,
			agentJobResult: lock.needsAgent === true ? 'success' : 'skipped',
		},
		lock,
	);
	expect(applyRun.exitCode, applyRun.stderr).toBe(0);
	expect(applyRun.out?.exitCode, applyRun.out?.message).toBe(
		opts.applyExit ?? 0,
	);
	expect(applyRun.stderr).not.toContain('PhaseGuardError');
	return {lock, agent, apply: applyRun.out!, refsBeforeApply, handoffDir};
}

/** The answer was recorded on main: no sidecar, no `needsAnswers` on the (done) task. */
function expectAnswerRecorded(folder: 'done' | 'ready'): void {
	expect(showOnArbiter(`main:${sidecarPathFor(ITEM)}`)).toBeUndefined();
	const body = showOnArbiter(`main:work/tasks/${folder}/${SLUG}.md`);
	expect(body).toBeDefined();
	expect(parseFrontmatter(body as string).needsAnswers).not.toBe(true);
}

beforeEach(() => {
	scratch = makeScratch('dorfl-ci-phase-answered-merge-');
	seeded = seedRepoWithArbiter(scratch.root, [SLUG]);
	runnerTemp = join(scratch.root, 'runner-temp');
	mkdirSync(runnerTemp);
});

afterEach(() => {
	scratch.cleanup();
});

describe('the answered merge action in three processes', () => {
	it('lands: the rebased tip is gated by the agent, landed by the apply, then the answer is recorded', async () => {
		const keptTip = seedAnsweredMerge();
		// main moves after the answer, so the agent job must rebase.
		commitToMain({'sibling.txt': 'benign sibling\n'}, 'a sibling lands');
		const run = await threePhases({
			verify: 'test "$(cat feature.txt)" = "the work" && test -f sibling.txt',
		});
		expect(run.lock).toMatchObject({
			acquired: true,
			needsAgent: true,
			rung: 'apply',
			continueTip: keptTip,
		});
		expect(run.agent?.intent).toBe('integrate');
		expect(run.apply.outcome, run.apply.message).toBe('applied');
		expect(run.apply.rungOutcome).toBe('advanced');

		// The work landed (rebased onto the sibling), BEFORE the answer record.
		expect(showOnArbiter('main:feature.txt')).toBe('the work\n');
		expect(showOnArbiter('main:sibling.txt')).toBe('benign sibling\n');
		const subjects = g(seeded.arbiter, 'log', '--format=%s', 'main').split(
			'\n',
		);
		expect(subjects.indexOf(WORK_SUBJECT)).toBe(1);
		expectAnswerRecorded('done');
		// The merged head is reaped and the lock released.
		expect(onArbiter(`refs/heads/${BRANCH}`)).toBeUndefined();
		expect(onArbiter(LOCK_REF)).toBeUndefined();
		// Won its first push: no landed-vs-gated report.
		expect(
			g(
				seeded.arbiter,
				'log',
				'--format=%(trailers:key=Landed-Without-Regate)',
				'-2',
				'main',
			),
		).toBe('');
	}, 180_000);

	it('lands through a forced non-fast-forward, reporting the land it did not gate', async () => {
		seedAnsweredMerge();
		let siblingSha = '';
		const run = await threePhases({
			verify: 'test "$(cat feature.txt)" = "the work"',
			// A sibling lands after the agent gated, so the first land push is
			// non-fast-forward and the CAS loop re-rebases.
			between: () => {
				siblingSha = commitToMain({'late.txt': 'late\n'}, 'a late sibling');
			},
		});
		expect(run.apply.outcome, run.apply.message).toBe('applied');
		const landed = g(
			seeded.arbiter,
			'log',
			'--format=%H',
			'--grep',
			`^feat(${SLUG})`,
			'main',
		);
		expect(g(seeded.arbiter, 'rev-parse', `${landed}^`)).toBe(siblingSha);
		expect(
			g(
				seeded.arbiter,
				'log',
				'-1',
				'--format=%(trailers:key=Landed-Without-Regate,valueonly)',
				landed,
			),
		).toBe('landed without re-gate after 1 lost race');
		expect(run.apply.notes).toContain(
			`${BRANCH} landed without re-gate after 1 lost race.`,
		);
		expectAnswerRecorded('done');
		expect(onArbiter(LOCK_REF)).toBeUndefined();
	}, 180_000);

	it('a stale continueTip lease (the kept branch moved) fails the apply without writing', async () => {
		seedAnsweredMerge();
		commitToMain({'sibling.txt': 'x\n'}, 'a sibling lands');
		const run = await threePhases({
			verify: 'true',
			between: () => {
				const other = seeded.clone('mover');
				g(other, 'fetch', '-q', 'origin');
				g(other, 'checkout', '-q', '-b', 'moved', `origin/${BRANCH}`);
				writeFileSync(join(other, 'MOVED.md'), 'moved\n');
				g(other, 'add', '-A');
				g(other, 'commit', '-q', '-m', 'moved');
				g(other, 'push', '-q', 'origin', `HEAD:${BRANCH}`);
			},
			applyExit: 1,
		});
		expect(run.agent?.intent, JSON.stringify(run.agent)).toBe('integrate');
		expect(run.apply.outcome).toBe('stale-lease');
		expect(arbiterRefs()).toBe(run.refsBeforeApply);
		expect(onArbiter(LOCK_REF)).toBe(run.lock.lockSha);
	}, 180_000);

	it('a red gate on the rebased tip routes to needs-attention; main never gets the failing tree', async () => {
		const keptTip = seedAnsweredMerge();
		// main moves with a file that breaks the gate on the rebased tip only.
		commitToMain({'must-not-exist.txt': 'oops\n'}, 'a breaking sibling');
		const run = await threePhases({verify: '! test -f must-not-exist.txt'});
		expect(run.agent?.intent).toBe('needs-attention');
		expect(run.apply.outcome, run.apply.message).toBe('surfaced');
		expect(showOnArbiter('main:feature.txt')).toBeUndefined();
		// The rebased (red) tip was published leased, the item surfaced.
		const branchTip = onArbiter(`refs/heads/${BRANCH}`)!;
		expect(branchTip).not.toBe(keptTip);
		expect(showOnArbiter(`${branchTip}:must-not-exist.txt`)).toBe('oops\n');
		const sidecar = parseSidecar(
			showOnArbiter(`main:${sidecarPathFor(ITEM)}`) as string,
		);
		expect(sidecar.entries.some((e) => e.kind === 'stuck')).toBe(true);
		expect(onArbiter(LOCK_REF)).toBeUndefined();
	}, 180_000);

	it('merge-restale re-pauses when main moved since the question; a re-answer while main stays put lands', async () => {
		const keptTip = seedAnsweredMerge({askedAtMain: true});
		// main's code moves after the question was asked.
		const movedMain = commitToMain(
			{'sibling.txt': 'benign sibling\n'},
			'a sibling lands',
		);
		const verify = 'test "$(cat feature.txt)" = "the work"';
		// The agent job decides the re-stale itself (strictMergeApproval on).
		const run = await threePhases({verify, strictMergeApproval: true});
		expect(run.agent?.intent).toBe('merge-restale');
		expect(run.apply.outcome, run.apply.message).toBe('applied');
		expect(run.apply.rungOutcome).toBe('no-op');
		expect(showOnArbiter('main:feature.txt')).toBeUndefined();
		expect(onArbiter(`refs/heads/${BRANCH}`)).toBe(keptTip);
		const sidecar = parseSidecar(
			showOnArbiter(`main:${sidecarPathFor(ITEM)}`) as string,
		);
		const merges = sidecar.entries.filter((e) => e.kind === 'merge');
		expect(merges).toHaveLength(2);
		expect(merges[1].answer.trim()).toBe('');
		expect(merges[1].question).toContain('Re-confirm');
		// The follow-up is asked against the main the apply job re-paused on.
		expect(merges[1].askedAtMain).toBe(movedMain);
		expect(
			parseFrontmatter(
				showOnArbiter(`main:work/tasks/ready/${SLUG}.md`) as string,
			).needsAnswers,
		).toBe(true);
		expect(onArbiter(LOCK_REF)).toBeUndefined();

		// The human re-answers; main moves only by that answer (under `work/`).
		// No livelock: the next run lands.
		commitToMain(
			{
				[sidecarPathFor(ITEM)]: serialiseSidecar({
					...sidecar,
					entries: sidecar.entries.map((e, i) =>
						i === sidecar.entries.length - 1 ? {...e, answer: 'merge'} : e,
					),
				}),
			},
			`answer ${ITEM}: merge`,
		);
		rmSync(run.handoffDir, {recursive: true, force: true});
		const again = await threePhases({verify, strictMergeApproval: true});
		expect(again.agent?.intent).toBe('integrate');
		expect(again.apply.outcome, again.apply.message).toBe('applied');
		expect(again.apply.rungOutcome).toBe('advanced');
		expect(showOnArbiter('main:feature.txt')).toBe('the work\n');
		expectAnswerRecorded('done');
		expect(onArbiter(LOCK_REF)).toBeUndefined();
	}, 300_000);

	it('strictMergeApproval with main unmoved since the question lands', async () => {
		seedAnsweredMerge({askedAtMain: true});
		const run = await threePhases({
			verify: 'test "$(cat feature.txt)" = "the work"',
			strictMergeApproval: true,
		});
		expect(run.agent?.intent).toBe('integrate');
		expect(run.apply.outcome, run.apply.message).toBe('applied');
		expect(showOnArbiter('main:feature.txt')).toBe('the work\n');
		expectAnswerRecorded('done');
	}, 180_000);

	it('hold needs no agent job: the answer is recorded and the branch stays unmerged', async () => {
		const keptTip = seedAnsweredMerge({answer: 'hold'});
		const run = await threePhases();
		expect(run.lock.needsAgent).toBe(false);
		expect(run.lock.continueTip).toBeUndefined();
		expect(run.apply.outcome, run.apply.message).toBe('applied');
		expect(onArbiter(`refs/heads/${BRANCH}`)).toBe(keptTip);
		expect(showOnArbiter('main:feature.txt')).toBeUndefined();
		expectAnswerRecorded('ready');
	}, 180_000);
});

// ---------------------------------------------------------------------------
// The agent job did not succeed (decision 5), in-process
// ---------------------------------------------------------------------------

async function inPhase<T>(phase: Phase, fn: () => Promise<T>): Promise<T> {
	const restore = activateProcessPhase(phase);
	try {
		return await fn();
	} finally {
		restore();
	}
}

function phaseOptions(
	phase: Phase,
	extra: Partial<TreelessPhaseOptions> = {},
): TreelessPhaseOptions {
	return {
		phase,
		arg: ITEM,
		cwd: seeded.clone(phase),
		arbiter: 'origin',
		publishJitterMs: 0,
		mergeJitterMs: 0,
		workspacesDir: join(scratch.root, 'ws'),
		env: gitEnv(),
		...extra,
	};
}

describe('the answered merge when the agent job does not succeed', () => {
	/** A stub Actions API: the agent job ran `minutes`, with no annotations. */
	function actionsApi(minutes: number): GithubApiGet {
		const start = Date.parse('2026-09-27T10:00:00Z');
		return async (url) => {
			if (url.includes('/jobs')) {
				return {
					status: 200,
					body: {
						jobs: [
							{
								id: 2,
								name: 'item / agent',
								started_at: new Date(start).toISOString(),
								completed_at: new Date(start + minutes * 60_000).toISOString(),
							},
						],
					},
				};
			}
			if (url.includes('/annotations')) return {status: 200, body: []};
			return {status: 404, body: {}};
		};
	}
	const actionsEnv = {
		...gitEnv(),
		GITHUB_REPOSITORY: 'o/r',
		GITHUB_RUN_ID: '77',
		GITHUB_RUN_ATTEMPT: '1',
	};

	async function lock(): Promise<LockOutputs> {
		const r = await inPhase('lock', () =>
			performTreelessPhase(phaseOptions('lock')),
		);
		expect(r.outcome, r.message).toBe('locked');
		expect(r.lockOutputs?.needsAgent).toBe(true);
		return r.lockOutputs!;
	}

	function expectSurfacedUnmerged(keptTip: string): void {
		expect(showOnArbiter('main:feature.txt')).toBeUndefined();
		expect(onArbiter(`refs/heads/${BRANCH}`)).toBe(keptTip);
		const sidecar = parseSidecar(
			showOnArbiter(`main:${sidecarPathFor(ITEM)}`) as string,
		);
		expect(sidecar.entries.some((e) => e.kind === 'stuck')).toBe(true);
		expect(onArbiter(LOCK_REF)).toBeUndefined();
	}

	it('failure surfaces the item without reading the handoff', async () => {
		const keptTip = seedAnsweredMerge();
		const held = await lock();
		const r = await inPhase('apply', () =>
			performTreelessPhase(
				phaseOptions('apply', {
					lockOutputs: held,
					handoffDir: join(runnerTemp, 'none'),
					runnerTemp,
					agentResult: 'failure',
				}),
			),
		);
		expect(r.outcome, r.message).toBe('surfaced');
		expectSurfacedUnmerged(keptTip);
	}, 60_000);

	it('a timeout (cancelled at the time limit) surfaces the item', async () => {
		const keptTip = seedAnsweredMerge();
		const held = await lock();
		const r = await inPhase('apply', () =>
			performTreelessPhase(
				phaseOptions('apply', {
					lockOutputs: held,
					handoffDir: join(runnerTemp, 'none'),
					runnerTemp,
					agentResult: 'cancelled',
					agentTimeoutMinutes: 90,
					actionsApi: actionsApi(90),
					env: actionsEnv,
				}),
			),
		);
		expect(r.outcome, r.message).toBe('surfaced');
		expectSurfacedUnmerged(keptTip);
	}, 60_000);

	it('a real cancel only releases the advancing lock', async () => {
		const keptTip = seedAnsweredMerge();
		const mainBefore = onArbiter('refs/heads/main');
		const held = await lock();
		const r = await inPhase('apply', () =>
			performTreelessPhase(
				phaseOptions('apply', {
					lockOutputs: held,
					handoffDir: join(runnerTemp, 'none'),
					runnerTemp,
					agentResult: 'cancelled',
					agentTimeoutMinutes: 90,
					actionsApi: actionsApi(3),
					env: actionsEnv,
				}),
			),
		);
		expect(r.outcome, r.message).toBe('released');
		expect(onArbiter(LOCK_REF)).toBeUndefined();
		expect(onArbiter('refs/heads/main')).toBe(mainBefore);
		expect(onArbiter(`refs/heads/${BRANCH}`)).toBe(keptTip);
	}, 60_000);

	it('an apply-decision handed over for an answered merge is rejected, and nothing lands', async () => {
		const keptTip = seedAnsweredMerge();
		const held = await lock();
		const dir = join(runnerTemp, 'hostile');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, 'handoff.json'),
			JSON.stringify({
				schema: 1,
				item: ITEM,
				intent: {kind: 'apply-decision'},
				products: {outcome: 'dispose', reason: 'gone'},
			}),
		);
		const r = await inPhase('apply', () =>
			performTreelessPhase(
				phaseOptions('apply', {
					lockOutputs: held,
					handoffDir: dir,
					runnerTemp,
					agentResult: 'success',
				}),
			),
		);
		expect(r.outcome, r.message).toBe('rejected');
		expect(showOnArbiter(`main:work/tasks/ready/${SLUG}.md`)).toBeDefined();
		expectSurfacedUnmerged(keptTip);
	}, 60_000);
});

// ---------------------------------------------------------------------------
// Git LFS objects on the kept branch (decision 6)
// ---------------------------------------------------------------------------

const HAS_GIT_LFS =
	spawnSync('git-lfs', ['version'], {stdio: 'ignore'}).status === 0;
const IN_CI =
	process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

describe.skipIf(!HAS_GIT_LFS && !IN_CI)(
	'the answered merge with Git LFS objects in three processes',
	() => {
		const PAYLOAD = 'binary-ish asset stored in Git LFS\n'.repeat(64);
		const OID = createHash('sha256').update(PAYLOAD).digest('hex');
		const LFS_PATH = 'assets/logo.bin';

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

		it('the rebased branch LFS object reaches the arbiter store before any ref', async () => {
			commitToMain(
				{'.gitattributes': '*.bin filter=lfs diff=lfs merge=lfs -text\n'},
				'track *.bin with LFS',
			);
			seedAnsweredMerge({
				files: {'feature.txt': 'the work\n', [LFS_PATH]: PAYLOAD},
				keptSetup: (clone) => g(clone, 'lfs', 'install', '--local'),
			});
			expect(readFileSync(arbiterObject(), 'utf8')).toBe(PAYLOAD);
			const log = join(scratch.root, 'pre-receive.log');
			const run = await threePhases({
				verify: 'true',
				between: () => {
					// The arbiter's store loses the object, and a hook records, per
					// ref push, whether it is back by the time the ref arrives.
					rmSync(join(seeded.arbiter, 'lfs'), {recursive: true, force: true});
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
				},
			});
			expect(run.agent?.intent).toBe('integrate');
			expect(existsSync(join(run.handoffDir, 'lfs', OID))).toBe(true);
			expect(run.apply.outcome, run.apply.message).toBe('applied');
			expect(readFileSync(arbiterObject(), 'utf8')).toBe(PAYLOAD);
			const pushes = readFileSync(log, 'utf8')
				.split('\n')
				.filter((l) => l.startsWith('refs/heads/'));
			expect(pushes).toContain(`refs/heads/${BRANCH} present`);
			expect(pushes).toContain('refs/heads/main present');
			expect(pushes.filter((l) => l.endsWith(' absent'))).toEqual([]);
		}, 180_000);
	},
);
