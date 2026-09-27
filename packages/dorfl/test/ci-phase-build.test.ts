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
	gitEnv,
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
			env: gitEnv(),
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
			env: gitEnv(),
		});
		const before = arbiterRefs();
		const r = await phase('lock', {
			cwd: jobClone('lock'),
			githubOutput: join(scratch.root, 'out'),
		});
		expect(r.outcome).toBe('lost');
		expect(r.exitCode).toBe(2);
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
		});
		expect(facts.continueTip).toBeUndefined();
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
			env: gitEnv(),
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
		expect(apply.exitCode).toBe(1);
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
					env: gitEnv(),
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
