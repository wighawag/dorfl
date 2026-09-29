import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {git} from '../src/git.js';
import {
	performBuildPhase,
	type BuildPhaseOptions,
	type BuildPhaseResult,
} from '../src/ci-phase-build.js';
import {
	LockOutputRefused,
	parseLockOutputLines,
	parseLockOutputs,
	serializeLockOutputs,
	type LockOutputs,
} from '../src/ci-lock-outputs.js';
import {acquireItemLock} from '../src/item-lock.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {activateProcessPhase} from '../src/phase-recorder.js';
import type {Phase} from '../src/phase.js';
import {
	ciPhaseEnv,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * The build path's phase driver in one process (task `ci-split-build-path`):
 * the refusals that must write nothing (a lock phase on a stale checkout, an
 * apply or agent phase whose lock ref moved), the needs-attention hand-over
 * with its leased release (task `ci-split-build-path-non-integrate-intents`),
 * and the lock-output transport. The three-process success paths
 * are `ci-phase-build-e2e.test.ts`.
 */

const SLUG = 'add-thing';

let scratch: Scratch;
let seeded: SeededRepo;
let runnerTemp: string;

function g(cwd: string, ...args: string[]): string {
	return git(args, cwd, {env: ciPhaseEnv()}).trim();
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

const LOCK_REF = `refs/dorfl/lock/task-${SLUG}`;

/** Run one phase in this process, with the process phase entered like the CLI does. */
async function phase(
	p: Phase,
	options: Partial<BuildPhaseOptions> & {cwd: string},
): Promise<BuildPhaseResult> {
	const restore = activateProcessPhase(p);
	try {
		return await performBuildPhase({
			phase: p,
			verb: 'do',
			arg: SLUG,
			arbiter: 'origin',
			integration: 'propose',
			verify: 'true',
			freshWorktreeGate: true,
			mergeJitterMs: 0,
			env: ciPhaseEnv(),
			...(p === 'apply' ? {agentResult: 'success' as const} : {}),
			...options,
		});
	} finally {
		restore();
	}
}

function jobClone(label: string, rev?: string): string {
	const dir = seeded.clone(label);
	if (rev !== undefined) {
		g(dir, 'fetch', '-q', 'origin');
		g(dir, 'checkout', '-q', '--detach', rev);
	}
	return dir;
}

async function lockPhase(): Promise<LockOutputs> {
	const out = join(scratch.root, `github-output-${Math.random()}`);
	writeFileSync(out, '');
	const r = await phase('lock', {cwd: jobClone('lock'), githubOutput: out});
	expect(r.outcome, r.message).toBe('locked');
	return parseLockOutputLines(readFileSync(out, 'utf8'));
}

beforeEach(() => {
	scratch = makeScratch('dorfl-ci-phase-build-unit-');
	seeded = seedRepoWithArbiter(scratch.root, [SLUG]);
	runnerTemp = join(scratch.root, 'runner-temp');
	mkdirSync(runnerTemp);
});

afterEach(() => {
	scratch.cleanup();
});

describe('the lock phase', () => {
	it('from a stale checkout, an item that already advanced is a no-op that writes nothing', async () => {
		const stale = jobClone('stale-lock-checkout');
		// The item advances on the arbiter after the run's commit.
		const other = seeded.clone('other');
		mkdirSync(join(other, 'work/tasks/done'), {recursive: true});
		g(other, 'mv', `work/tasks/ready/${SLUG}.md`, `work/tasks/done/${SLUG}.md`);
		g(other, 'commit', '-q', '-m', 'done elsewhere');
		g(other, 'push', '-q', 'origin', 'HEAD:main');
		// The stale checkout still sees the task in the pool.
		expect(
			readFileSync(join(stale, `work/tasks/ready/${SLUG}.md`), 'utf8'),
		).toContain(SLUG);

		const before = arbiterRefs();
		const out = join(scratch.root, 'github-output');
		writeFileSync(out, '');
		const r = await phase('lock', {cwd: stale, githubOutput: out});
		expect(r.outcome).toBe('no-op');
		expect(r.exitCode).toBe(0);
		expect(arbiterRefs()).toBe(before);
		const facts = parseLockOutputLines(readFileSync(out, 'utf8'));
		expect(facts.acquired).toBe(false);
		expect(facts.baseSha).toBe(onArbiter('refs/heads/main'));
	});

	it('an item another run holds is refused before any write', async () => {
		await acquireItemLock({
			item: `task:${SLUG}`,
			action: 'implement',
			cwd: seeded.clone('holder'),
			arbiter: 'origin',
			env: ciPhaseEnv(),
		});
		const before = arbiterRefs();
		const r = await phase('lock', {
			cwd: jobClone('lock'),
			githubOutput: join(scratch.root, 'out'),
		});
		expect(r.outcome).toBe('lost');
		// Backing off is handled: the lock job is green.
		expect(r.exitCode).toBe(0);
		expect(arbiterRefs()).toBe(before);
	});

	it('publishes the trusted facts of a claim', async () => {
		const facts = await lockPhase();
		expect(facts).toMatchObject({
			acquired: true,
			needsAgent: true,
			rung: 'build-task',
			baseSha: onArbiter('refs/heads/main'),
			lockSha: onArbiter(LOCK_REF),
			handoffName: `dorfl-handoff-task-${SLUG}-attempt-1`,
			// The default agentDeadlineMinutes + checkpointHeadroomMinutes.
			agentTimeoutMinutes: 90,
		});
		expect(facts.continueTip).toBeUndefined();
	});

	it('does not read the run attempt of the runner the suite runs on', async () => {
		// A "re-run failed jobs" of `verify` runs this suite on attempt 2: the
		// phase must see only what the test wrote (observation
		// `ci-phase-build-test-reads-the-real-github-run-attempt-2026-09-28`).
		vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');
		vi.stubEnv('GITHUB_RUN_ID', '987654');
		vi.stubEnv('GITHUB_REPOSITORY', 'someone/else');
		try {
			const facts = await lockPhase();
			expect(facts.handoffName).toBe(`dorfl-handoff-task-${SLUG}-attempt-1`);
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it('computes agentTimeoutMinutes from dorfl.json at baseSha, not the checkout', async () => {
		const stale = jobClone('stale-lock-checkout');
		// The checkout's own config says something else (it is not trusted).
		writeFileSync(
			join(stale, 'dorfl.json'),
			'{"agentDeadlineMinutes": 5, "checkpointHeadroomMinutes": 10}\n',
		);
		const other = seeded.clone('config-lands');
		writeFileSync(
			join(other, 'dorfl.json'),
			'{"agentDeadlineMinutes": 120, "checkpointHeadroomMinutes": 45}\n',
		);
		g(other, 'add', '-A');
		g(other, 'commit', '-q', '-m', 'config');
		g(other, 'push', '-q', 'origin', 'HEAD:main');
		const out = join(scratch.root, 'github-output');
		writeFileSync(out, '');
		const r = await phase('lock', {cwd: stale, githubOutput: out});
		expect(r.outcome, r.message).toBe('locked');
		expect(
			parseLockOutputLines(readFileSync(out, 'utf8')).agentTimeoutMinutes,
		).toBe(165);
	});

	it('a re-run-all attempt names its artifact with the new run attempt', async () => {
		const out = join(scratch.root, 'github-output');
		writeFileSync(out, '');
		const r = await phase('lock', {
			cwd: jobClone('lock'),
			githubOutput: out,
			runAttempt: '2',
		});
		expect(r.outcome, r.message).toBe('locked');
		expect(parseLockOutputLines(readFileSync(out, 'utf8')).handoffName).toBe(
			`dorfl-handoff-task-${SLUG}-attempt-2`,
		);
	});
});

describe('the apply phase inputs', () => {
	it('refuses to run without the agent job result, before any write', async () => {
		const lock = await lockPhase();
		const before = arbiterRefs();
		const apply = await phase('apply', {
			cwd: jobClone('apply', lock.baseSha),
			lockOutputs: lock,
			handoffDir: join(runnerTemp, 'none'),
			runnerTemp,
			agentResult: undefined,
		});
		expect(apply.outcome).toBe('usage-error');
		expect(apply.message).toMatch(/--agent-result/);
		expect(arbiterRefs()).toBe(before);
	});
});

describe('lock ownership', () => {
	it('the apply phase writes nothing when the lock ref no longer equals lockSha', async () => {
		const lock = await lockPhase();
		const handoffDir = join(runnerTemp, 'handoff');
		const agent = await phase('agent', {
			cwd: jobClone('agent', lock.baseSha),
			lockOutputs: lock,
			handoffDir,
			dorfl: ({cwd}) => {
				writeFileSync(join(cwd, 'thing.txt'), 'thing\n');
				return {ok: true, output: 'done'};
			},
		});
		expect(agent.intent).toBe('integrate');

		// The lock is released and re-taken by another run (a new sha).
		const other = seeded.clone('other-run');
		g(other, 'push', '-q', 'origin', `:${LOCK_REF}`);
		await acquireItemLock({
			item: `task:${SLUG}`,
			action: 'implement',
			cwd: other,
			arbiter: 'origin',
			env: ciPhaseEnv(),
		});
		expect(onArbiter(LOCK_REF)).not.toBe(lock.lockSha);

		const before = arbiterRefs();
		const apply = await phase('apply', {
			cwd: jobClone('apply', lock.baseSha),
			lockOutputs: lock,
			handoffDir,
			runnerTemp,
		});
		expect(apply.outcome).toBe('stale-lock');
		expect(apply.exitCode).toBe(0);
		expect(apply.message).toMatch(/start a NEW run/);
		expect(arbiterRefs()).toBe(before);
	});

	it('the apply phase writes nothing when the lock was released', async () => {
		const lock = await lockPhase();
		g(seeded.clone('releaser'), 'push', '-q', 'origin', `:${LOCK_REF}`);
		const before = arbiterRefs();
		const apply = await phase('apply', {
			cwd: jobClone('apply', lock.baseSha),
			lockOutputs: lock,
			handoffDir: join(runnerTemp, 'none'),
			runnerTemp,
		});
		expect(apply.outcome).toBe('stale-lock');
		expect(arbiterRefs()).toBe(before);
	});

	it('the agent phase launches nothing when the lock ref moved', async () => {
		const lock = await lockPhase();
		g(seeded.clone('releaser'), 'push', '-q', 'origin', `:${LOCK_REF}`);
		let launched = false;
		const agent = await phase('agent', {
			cwd: jobClone('agent', lock.baseSha),
			lockOutputs: lock,
			handoffDir: join(runnerTemp, 'handoff'),
			dorfl: () => {
				launched = true;
				return {ok: true};
			},
		});
		expect(agent.outcome).toBe('stale-lock');
		expect(launched).toBe(false);
	});
});

describe('outcomes other than integrate', () => {
	/** Lock, then an agent phase whose gate is red: a needs-attention handoff. */
	async function redGateHandoff(): Promise<{
		lock: LockOutputs;
		handoffDir: string;
	}> {
		const lock = await lockPhase();
		const handoffDir = join(runnerTemp, 'handoff');
		const agentClone = jobClone('agent', lock.baseSha);
		g(agentClone, 'remote', 'set-url', '--push', 'origin', '/nonexistent.git');
		const before = arbiterRefs();
		const agent = await phase('agent', {
			cwd: agentClone,
			lockOutputs: lock,
			handoffDir,
			verify: 'false',
			dorfl: ({cwd}) => {
				writeFileSync(join(cwd, 'thing.txt'), 'thing\n');
				return {ok: true, output: 'done'};
			},
		});
		expect(agent.intent).toBe('needs-attention');
		expect(arbiterRefs()).toBe(before);
		return {lock, handoffDir};
	}

	it('a red gate is handed over as needs-attention and the apply phase surfaces the item', async () => {
		const {lock, handoffDir} = await redGateHandoff();
		const apply = await phase('apply', {
			cwd: jobClone('apply', lock.baseSha),
			lockOutputs: lock,
			handoffDir,
			runnerTemp,
		});
		expect(apply.outcome).toBe('surfaced');
		expect(apply.exitCode).toBe(0);
		expect(apply.message).toMatch(/acceptance gate failed/);
		// Surfaced on main (sidecar + needsAnswers), the WIP pushed, the lock released.
		const body = g(seeded.arbiter, 'show', `main:work/tasks/ready/${SLUG}.md`);
		expect(body).toMatch(/needsAnswers: true/);
		expect(
			g(seeded.arbiter, 'show', `refs/heads/work/task-${SLUG}:thing.txt`),
		).toBe('thing');
		expect(onArbiter(LOCK_REF)).toBeUndefined();
	});

	it('the surface releases the lock leased on lockSha: a lock re-taken after the ownership check stays', async () => {
		const {lock, handoffDir} = await redGateHandoff();
		// Between the apply phase's ownership check and its release, another run
		// takes the item's lock (released, then re-acquired: a new sha).
		const other = seeded.clone('other-run');
		let retaken: string | undefined;
		const original = ledgerWrite.applyTransition.bind(ledgerWrite);
		const spy = vi
			.spyOn(ledgerWrite, 'applyTransition')
			.mockImplementation(async (input) => {
				const r = await original(input);
				g(other, 'push', '-q', 'origin', `:${LOCK_REF}`);
				await acquireItemLock({
					item: `task:${SLUG}`,
					action: 'implement',
					cwd: other,
					arbiter: 'origin',
					env: ciPhaseEnv(),
				});
				retaken = onArbiter(LOCK_REF);
				return r;
			});
		try {
			await phase('apply', {
				cwd: jobClone('apply', lock.baseSha),
				lockOutputs: lock,
				handoffDir,
				runnerTemp,
			});
		} finally {
			spy.mockRestore();
		}
		expect(retaken).toBeDefined();
		expect(retaken).not.toBe(lock.lockSha);
		// The other run's lock is untouched.
		expect(onArbiter(LOCK_REF)).toBe(retaken);
	});
});

describe('a handled outcome is green (task a-handled-surface-exits-green-in-ci)', () => {
	/** Lock, then an agent phase whose green build adds a root `.gitattributes`. */
	async function protectedPathHandoff(): Promise<{
		lock: LockOutputs;
		handoffDir: string;
	}> {
		const lock = await lockPhase();
		const handoffDir = join(runnerTemp, 'handoff');
		const agent = await phase('agent', {
			cwd: jobClone('agent', lock.baseSha),
			lockOutputs: lock,
			handoffDir,
			dorfl: ({cwd}) => {
				writeFileSync(
					join(cwd, '.gitattributes'),
					'docs/** linguist-documentation\n',
				);
				return {ok: true, output: 'done'};
			},
		});
		expect(agent.intent, agent.message).toBe('integrate');
		return {lock, handoffDir};
	}

	it('a protected-path rejection that surfaced the item exits 0', async () => {
		const {lock, handoffDir} = await protectedPathHandoff();
		const apply = await phase('apply', {
			cwd: jobClone('apply', lock.baseSha),
			lockOutputs: lock,
			handoffDir,
			runnerTemp,
		});
		expect(apply.outcome, apply.message).toBe('rejected');
		expect(apply.exitCode).toBe(0);
		expect(apply.message).toMatch(/protected path/);
		expect(apply.message).toMatch(/surfaced it to needs-attention/);
		// Surfaced on main, nothing from the handoff landed, the lock released.
		const body = g(seeded.arbiter, 'show', `main:work/tasks/ready/${SLUG}.md`);
		expect(body).toMatch(/needsAnswers: true/);
		expect(onArbiter('main:.gitattributes')).toBeUndefined();
		expect(onArbiter(`refs/heads/work/task-${SLUG}`)).toBeUndefined();
		expect(onArbiter(LOCK_REF)).toBeUndefined();
	});

	it('a rejection whose surface could not be written still exits non-zero', async () => {
		const {lock, handoffDir} = await protectedPathHandoff();
		const spy = vi
			.spyOn(ledgerWrite, 'applyTreelessNeedsAttentionTransition')
			.mockResolvedValue({
				moved: false,
				reasonNotMoved: 'contention exhausted',
			});
		let apply: BuildPhaseResult;
		try {
			apply = await phase('apply', {
				cwd: jobClone('apply', lock.baseSha),
				lockOutputs: lock,
				handoffDir,
				runnerTemp,
			});
			expect(spy).toHaveBeenCalledOnce();
		} finally {
			spy.mockRestore();
		}
		expect(apply.outcome, apply.message).toBe('surface-unmoved');
		expect(apply.exitCode).toBe(1);
		expect(apply.message).toMatch(
			/could not surface it \(contention exhausted\)/,
		);
	});

	it('an agent phase whose lock is gone exits 0 and writes nothing', async () => {
		const lock = await lockPhase();
		g(seeded.clone('releaser'), 'push', '-q', 'origin', `:${LOCK_REF}`);
		const before = arbiterRefs();
		const agent = await phase('agent', {
			cwd: jobClone('agent', lock.baseSha),
			lockOutputs: lock,
			handoffDir: join(runnerTemp, 'handoff'),
			dorfl: () => ({ok: true}),
		});
		expect(agent.outcome).toBe('stale-lock');
		expect(agent.exitCode).toBe(0);
		expect(arbiterRefs()).toBe(before);
	});
});

describe('the lock outputs transport', () => {
	const facts: LockOutputs = {
		acquired: true,
		needsAgent: true,
		rung: 'build-task',
		baseSha: 'a'.repeat(40),
		lockSha: 'b'.repeat(40),
		handoffName: 'dorfl-handoff-task-x-attempt-2',
		agentTimeoutMinutes: 60,
		seenCommentIds: [1, 22],
	};

	it('round-trips through $GITHUB_OUTPUT lines and toJSON(needs.lock.outputs)', () => {
		expect(parseLockOutputLines(serializeLockOutputs(facts))).toEqual(facts);
		const asJson = Object.fromEntries(
			Object.entries(facts).map(([k, v]) => [
				k,
				Array.isArray(v) ? v.join(',') : String(v),
			]),
		);
		expect(parseLockOutputs({...asJson, continueTip: ''})).toEqual(facts);
	});

	it('refuses an unknown key or a malformed value', () => {
		expect(() => parseLockOutputs({title: 'x'})).toThrow(LockOutputRefused);
		expect(() => parseLockOutputs({baseSha: 'main'})).toThrow(
			LockOutputRefused,
		);
		expect(() => parseLockOutputs({acquired: 'yes'})).toThrow(
			LockOutputRefused,
		);
		expect(() => parseLockOutputs({rung: 'deploy'})).toThrow(LockOutputRefused);
	});
});
