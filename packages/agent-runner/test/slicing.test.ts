import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performSlice, type SliceAgentRunner} from '../src/slicing.js';
import {
	acquireSlicingLock,
	releaseSlicingLock,
	type AcquireSlicingLockOptions,
	type AcquireSlicingLockResult,
	type ReleaseSlicingLockOptions,
	type ReleaseSlicingLockResult,
} from '../src/slicing-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * `do prd:<slug>` slicing-path tests (`performSlice`, slice `autoslice-command`).
 *
 * House style: a throwaway checkout + a local `--bare` arbiter + a STUBBED agent
 * (the injected `agentRunner` writes slice files directly, never a real harness).
 * The real-git tests drive the lock CAS + write `main`, so this file is in the
 * NON-PARALLEL vitest project (see vitest.config.ts); the gate-refusal tests stub
 * the lock entirely so they stay pure.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-slicing-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Seed a `work/prd/<slug>.md` (committed onto the arbiter) with frontmatter. */
function seedPrd(
	repo: string,
	slug: string,
	fm: {
		humanOnly?: boolean;
		needsAnswers?: boolean;
		sliceAfter?: string[];
		sliced?: string;
	} = {},
): void {
	const dir = join(repo, 'work', 'prd');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `title: ${slug}`, `slug: ${slug}`];
	if (fm.humanOnly) lines.push('humanOnly: true');
	if (fm.needsAnswers) lines.push('needsAnswers: true');
	if (fm.sliceAfter && fm.sliceAfter.length > 0) {
		lines.push(`sliceAfter: [${fm.sliceAfter.join(', ')}]`);
	}
	if (fm.sliced) lines.push(`sliced: ${fm.sliced}`);
	lines.push(
		'---',
		'',
		'## Problem Statement',
		'',
		`PRD body for ${slug}.`,
		'',
	);
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `prd: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** An agent that writes one backlog slice file (no git). */
function slicingAgent(file = 'child', extra?: () => void): SliceAgentRunner {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${file}.md`),
			[
				'---',
				`title: ${file}`,
				`slug: ${file}`,
				'prd: it',
				'---',
				'',
				'## Prompt',
				'',
				'> build it',
				'',
			].join('\n'),
		);
		extra?.();
		return {ok: true};
	};
}

const onArbiter = (repo: string, path: string): boolean => {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
};
const showArbiter = (repo: string, path: string): string =>
	run('git', ['show', `${ARBITER}/main:${path}`], repo, {env: gitEnv()}).stdout;

// --- Gate refusal (agent path) — stub the lock so these stay pure ----------

describe('performSlice — agent gate refusal (honest, names why it skipped)', () => {
	/** A lock seam that must NOT be touched (the gate refuses before the lock). */
	const noLock = {
		acquire(): Promise<AcquireSlicingLockResult> {
			throw new Error('lock acquire must not be reached on a gate refusal');
		},
		release(): Promise<ReleaseSlicingLockResult> {
			throw new Error('lock release must not be reached on a gate refusal');
		},
	};

	it('refuses a humanOnly PRD (names humanOnly), no agent, no lock', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', {humanOnly: true});
		let agentRan = false;
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			lock: noLock,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/humanOnly/);
		expect(agentRan).toBe(false);
	});

	it('refuses a needsAnswers PRD (names needsAnswers)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', {needsAnswers: true});
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			lock: noLock,
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/needsAnswers/);
	});

	it('refuses when autoSlice is off (names autoSlice)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: false,
			lock: noLock,
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/autoSlice/);
	});

	it('refuses when a sliceAfter PRD is not yet sliced (names it)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// `dep` exists but is NOT sliced; `it` sliceAfter: [dep].
		seedPrd(repo, 'dep');
		seedPrd(repo, 'it', {sliceAfter: ['dep']});
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			lock: noLock,
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/dep/);
		expect(result.message).toMatch(/sliceAfter/);
	});

	it('passes the gate once the sliceAfter PRD IS sliced', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'dep', {sliced: '2026-06-01'});
		seedPrd(repo, 'it', {sliceAfter: ['dep']});
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
	});

	it('the HUMAN path is unbound by the gate (slices a humanOnly PRD, no lock)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', {humanOnly: true});
		let acquired = false;
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			doer: 'human',
			lock: {
				acquire() {
					acquired = true;
					throw new Error('human-no-contention must not take the lock');
				},
				release() {
					throw new Error('human-no-contention must not release the lock');
				},
			},
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The human path slices WITHOUT the lock.
		expect(acquired).toBe(false);
	});
});

// --- The completing transition (real git, lock taken/released) -------------

describe('performSlice — slices + commits the runner-owned transition', () => {
	it('takes the lock, runs the agent, lands slices in backlog/, marks PRD sliced', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			today: '2026-06-07',
			agentRunner: slicingAgent('it-first'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toEqual(['work/backlog/it-first.md']);

		// The produced backlog slice landed on the arbiter.
		expect(onArbiter(repo, 'work/backlog/it-first.md')).toBe(true);
		// The lock was released: the PRD is back in prd/, slicing/ is empty.
		expect(onArbiter(repo, 'work/prd/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		// The PRD is marked sliced.
		expect(showArbiter(repo, 'work/prd/it.md')).toMatch(/sliced: 2026-06-07/);
	});

	it('the RUNNER (not the agent) authored the commits/moves', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		// An agent that ASSERTS it does no git: the tree must NOT already be
		// committed by it — it only writes the file; the runner commits.
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			agentRunner: ({cwd}) => {
				// The lock already moved the PRD to slicing/ on the arbiter; the agent
				// must not have committed anything itself.
				const dir = join(cwd, 'work', 'backlog');
				mkdirSync(dir, {recursive: true});
				writeFileSync(
					join(dir, 'it-a.md'),
					'---\nslug: it-a\nprd: it\n---\n\n## Prompt\n\n> x\n',
				);
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');

		// The completing commit on the arbiter is the runner's slicing release
		// commit (it carries BOTH the backlog slice AND the prd restore + marker).
		const subject = run(
			'git',
			['log', '-1', '--format=%s', `${ARBITER}/main`],
			repo,
			{env: gitEnv()},
		).stdout.trim();
		expect(subject).toMatch(/^slicing: release it/);
		// The completing commit carries BOTH the emitted backlog slice AND the
		// slicing→prd restore (a rename), in ONE runner-owned commit (rename detection
		// shows the move as `work/prd/it.md`; slicing/ is verified empty below).
		const files = run(
			'git',
			['show', '--name-status', '--format=', `${ARBITER}/main`],
			repo,
			{env: gitEnv()},
		).stdout;
		expect(files).toMatch(/work\/backlog\/it-a\.md/);
		expect(files).toMatch(/work\/prd\/it\.md/);
		// The PRD is no longer held in slicing/ (the lock was released in this commit).
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/prd/it.md')).toBe(true);
	});

	it('passes the acquire-time lockedBlob back to release (stale check runs)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		let releasedBlob: string | undefined = 'UNSET';
		const lock = {
			acquire: (o: AcquireSlicingLockOptions) => acquireSlicingLock(o),
			release: (o: ReleaseSlicingLockOptions) => {
				releasedBlob = o.lockedBlob;
				return releaseSlicingLock(o);
			},
		};
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			lock,
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The lockedBlob captured at acquire-time was threaded into release.
		expect(releasedBlob).toBeTypeOf('string');
		expect(releasedBlob).not.toBe('UNSET');
		expect(releasedBlob).toMatch(/^[0-9a-f]{40}$/);
	});
});

// --- Lock contention + agent failure ---------------------------------------

describe('performSlice — lock lost / agent failed', () => {
	it('a lost lock is reported (lock-lost), the agent never runs', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		let agentRan = false;
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			lock: {
				acquire: async () => ({
					exitCode: 2,
					outcome: 'lost',
					message: 'someone holds the slicing lock',
				}),
				release: () => {
					throw new Error('release must not run when acquire lost');
				},
			},
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lock-lost');
		expect(agentRan).toBe(false);
	});

	it('an agent failure is reported (agent-failed); the lock is NOT released', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		let released = false;
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			lock: {
				acquire: async () => ({
					exitCode: 0,
					outcome: 'acquired',
					message: 'locked',
					lockedBlob: 'a'.repeat(40),
				}),
				release: async () => {
					released = true;
					return {exitCode: 0, outcome: 'released', message: 'released'};
				},
			},
			agentRunner: () => ({ok: false, detail: 'boom'}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toMatch(/boom/);
		// The runner did NOT release the lock on a failed slice (recoverable/re-run).
		expect(released).toBe(false);
	});
});

describe('performSlice — usage', () => {
	it('errors when the PRD does not exist', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await performSlice({
			slug: 'nope',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/no PRD/);
	});
});
