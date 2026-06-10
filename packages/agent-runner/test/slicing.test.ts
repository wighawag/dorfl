import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {performSlice, type SliceAgentRunner} from '../src/slicing.js';
import {
	type AcquireSlicingLockResult,
	type ReleaseSlicingLockResult,
} from '../src/slicing-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';
import type {
	SliceReviewGate,
	SliceReviewVerdict,
} from '../src/slicer-review-loop.js';

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
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-slicing-');
	// Test-isolation (shared-write rule): point pi's session storage at scratch so
	// no slice-file/session write touches the real ~/.pi/agent/sessions/.
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
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
		/**
		 * Emit an INERT `sliced:` line (the marker was removed in
		 * remove-sliced-marker-step-b — the parser ignores it). Only used to PROVE a
		 * leftover marker does NOT count toward sliced-ness (residence does).
		 */
		sliced?: string;
		/** Seed into `work/prd-sliced/` (the sliced resting state) instead of `prd/`. */
		inPrdSliced?: boolean;
	} = {},
): void {
	const dir = join(repo, 'work', fm.inPrdSliced ? 'prd-sliced' : 'prd');
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

	it('refuses when autoSlice is off on the AUTO-PICK pool path (names autoSlice)', async () => {
		// The NON-explicit (pool) dispatch: `explicit` unset ⇒ the `autoSlice` POLICY
		// still gates. (The pool itself never selects such a PRD; this asserts the
		// per-invocation gate's policy term survives for the pool path.)
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

	it('an EXPLICITLY-named PRD slices with autoSlice OFF (no config, no env) — naming IS the authorization', async () => {
		// The slice-path mirror of `do <slice>` building regardless of `allowAgents`:
		// `explicit: true` (the `do prd:<slug>` dispatch) drops the `autoSlice` POLICY
		// term, so an explicit slice-now proceeds to the lock/agent with the policy
		// unset. (A real lock is taken here — the gate does NOT refuse, so the noLock
		// stub would throw; we let the real CAS run and assert it sliced.)
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		let agentRan = false;
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			// autoSlice deliberately OMITTED (defaults off) — explicit alone authorizes.
			explicit: true,
			integration: 'merge',
			agentRunner: slicingAgent('it-explicit', () => {
				agentRan = true;
			}),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(agentRan).toBe(true);
		expect(onArbiter(repo, 'work/backlog/it-explicit.md')).toBe(true);
	});

	it('EXPLICIT still refuses a humanOnly PRD (the readiness axis binds regardless of explicit)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', {humanOnly: true});
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			explicit: true,
			lock: noLock,
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/humanOnly/);
	});

	it('EXPLICIT still refuses a needsAnswers PRD (the readiness axis binds regardless of explicit)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', {needsAnswers: true});
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			explicit: true,
			lock: noLock,
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/needsAnswers/);
	});

	it('EXPLICIT still refuses an unsatisfied sliceAfter (ordering binds regardless of explicit)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'dep');
		seedPrd(repo, 'it', {sliceAfter: ['dep']});
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			explicit: true,
			lock: noLock,
			agentRunner: slicingAgent(),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-refused');
		expect(result.message).toMatch(/dep/);
		expect(result.message).toMatch(/sliceAfter/);
		// The autoSlice policy is NEVER the named reason on the explicit path.
		expect(result.message).not.toMatch(/autoSlice/);
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
		// `dep` is SLICED — it RESIDES in work/prd-sliced/ (the source of truth), not
		// a `sliced:` marker in work/prd/. `it`'s sliceAfter resolves against that
		// folder residence (mirroring blockedBy -> done/).
		seedPrd(repo, 'dep', {inPrdSliced: true});
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

	it('STILL refuses when the sliceAfter PRD only carries an INERT `sliced:` line in prd/ (folder, not marker)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// `dep` sits in work/prd/ with a leftover (INERT) `sliced:` line but is NOT in
		// prd-sliced/. Folder residence is the SOLE source of truth — the marker was
		// removed in remove-sliced-marker-step-b, so the line is ignored and does NOT
		// satisfy sliceAfter.
		seedPrd(repo, 'dep', {sliced: '2026-06-01'});
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
	it('takes the lock, runs the agent, lands slices in backlog/, rests PRD in prd-sliced/', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			// `--merge`: land the produced slices on the arbiter main (the output now
			// integrates through the shared core; propose would open a PR instead).
			integration: 'merge',
			agentRunner: slicingAgent('it-first'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toEqual(['work/backlog/it-first.md']);

		// The produced backlog slice landed on the arbiter.
		expect(onArbiter(repo, 'work/backlog/it-first.md')).toBe(true);
		// The lock was released into the SLICED resting state: the PRD now resides in
		// work/prd-sliced/ (the source of truth, like done/), NOT back in prd/; slicing/
		// is empty.
		expect(onArbiter(repo, 'work/prd-sliced/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/prd/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		// Sliced-ness is RESIDENCE in prd-sliced/ (asserted above). The `sliced:` marker
		// was removed in remove-sliced-marker-step-b, so the resting PRD carries NO
		// sliced: line.
		expect(showArbiter(repo, 'work/prd-sliced/it.md')).not.toMatch(/^sliced:/m);
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
			integration: 'merge',
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

		// The completing commit on the arbiter is the runner's slicing INTEGRATE
		// commit (it carries BOTH the backlog slice AND the slicing→prd-sliced move),
		// now landed through the shared core (`slicing(<slug>): …; sliced`).
		const subject = run(
			'git',
			['log', '-1', '--format=%s', `${ARBITER}/main`],
			repo,
			{env: gitEnv()},
		).stdout.trim();
		expect(subject).toMatch(/^slicing\(it\):/);
		expect(subject).toMatch(/; sliced$/);
		// The completing commit carries BOTH the emitted backlog slice AND the
		// slicing→prd-sliced move (a rename), in ONE runner-owned commit (rename
		// detection shows the move as `work/prd-sliced/it.md`; slicing/ verified empty).
		const files = run(
			'git',
			['show', '--name-status', '--format=', `${ARBITER}/main`],
			repo,
			{env: gitEnv()},
		).stdout;
		expect(files).toMatch(/work\/backlog\/it-a\.md/);
		expect(files).toMatch(/work\/prd-sliced\/it\.md/);
		// The PRD is no longer held in slicing/ (the lock was released in this commit)
		// and now rests in prd-sliced/ (the source of truth), NOT back in prd/.
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/prd-sliced/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/prd/it.md')).toBe(false);
	});

	it('the content-identity stale check fires on a concurrent edit of the held PRD', async () => {
		// The OUTPUT now integrates through the shared core (not the lock release), so
		// the read-stability backstop is owned at the integrate seam. An agent that
		// EDITS the held work/slicing/<slug>.md body on the arbiter (a concurrent
		// writer, under the lock) must make the slicing STALE — fail loud, touch
		// NOTHING (the lock stays held; no slices land).
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: ({cwd}) => {
				// Write a slice (as normal)…
				slicingAgent('child')({cwd, prompt: '', slug: 'it'});
				// …then, from a throwaway clone, EDIT the held PRD body on the arbiter
				// while the lock is held (the concurrent-edit the backstop must catch).
				editHeldPrdOnArbiter(scratch.root, 'it');
				return {ok: true};
			},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(4);
		expect(result.outcome).toBe('stale');
		// The arbiter was NOT modified: the lock is still held (PRD in slicing/), and
		// no backlog slice landed on main.
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/backlog/child.md')).toBe(false);
	});

	it('RE-SLICE round-trip: prd-sliced/ -> prd/ reopens a sliced PRD into the slice pool', async () => {
		// Slice `it` ONCE: it lands in work/prd-sliced/ (the sliced resting state).
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const first = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: slicingAgent('it-first'),
			env: gitEnv(),
		});
		expect(first.outcome).toBe('sliced');
		expect(onArbiter(repo, 'work/prd-sliced/it.md')).toBe(true);

		// REOPEN-TO-READY: git mv work/prd-sliced/it.md -> work/prd/it.md (mirroring
		// done/ -> backlog/), so the reshaped PRD re-enters the slice pool with no
		// special case. Do it on a throwaway clone + push (the runner owns git; this is
		// a test's own throwaway repo).
		reopenSlicedPrd(scratch.root, 'it');
		expect(onArbiter(repo, 'work/prd/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/prd-sliced/it.md')).toBe(false);
		// Sync the local checkout to the reopened arbiter main so its working tree has
		// work/prd/it.md (the to-slice source `performSlice` reads at step 0).
		run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
		run('git', ['reset', '-q', '--hard', `${ARBITER}/main`], repo, {
			env: gitEnv(),
		});

		// Slice it AGAIN: it is back in the pool (the gate sees it in prd/), so the
		// agent path slices it once more, landing it back in prd-sliced/.
		const second = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: slicingAgent('it-second'),
			env: gitEnv(),
		});
		expect(second.outcome).toBe('sliced');
		expect(onArbiter(repo, 'work/backlog/it-second.md')).toBe(true);
		expect(onArbiter(repo, 'work/prd-sliced/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/prd/it.md')).toBe(false);
	});
});

/**
 * REOPEN a sliced PRD to ready: from a throwaway clone of the arbiter,
 * `git mv work/prd-sliced/<slug>.md -> work/prd/<slug>.md` and push it to `main`
 * (the re-slice / reopen-to-ready move, mirroring done/ -> backlog/).
 */
function reopenSlicedPrd(root: string, slug: string): void {
	const dest = join(root, `reopen-${slug}`);
	run(
		'git',
		['clone', '-q', `file://${join(root, 'project-work.git')}`, dest],
		root,
		{env: gitEnv()},
	);
	run('git', ['fetch', '-q', 'origin'], dest, {env: gitEnv()});
	run('git', ['checkout', '-q', '-B', 'reopen', 'origin/main'], dest, {
		env: gitEnv(),
	});
	mkdirSync(join(dest, 'work', 'prd'), {recursive: true});
	run(
		'git',
		['mv', `work/prd-sliced/${slug}.md`, `work/prd/${slug}.md`],
		dest,
		{env: gitEnv()},
	);
	run('git', ['commit', '-q', '-m', `reopen ${slug} to ready`], dest, {
		env: gitEnv(),
	});
	run('git', ['push', '-q', 'origin', 'reopen:main'], dest, {env: gitEnv()});
}

/**
 * From a throwaway clone of the arbiter, EDIT the held `work/slicing/<slug>.md`
 * body and push it to `main` — simulating a concurrent writer editing the PRD
 * under the slicing lock (the read-stability backstop must detect the changed
 * blob and fail the release as `stale`).
 */
function editHeldPrdOnArbiter(root: string, slug: string): void {
	const dest = join(root, `concurrent-edit-${slug}`);
	run(
		'git',
		['clone', '-q', `file://${join(root, 'project-work.git')}`, dest],
		root,
		{env: gitEnv()},
	);
	run('git', ['fetch', '-q', 'origin'], dest, {env: gitEnv()});
	run('git', ['checkout', '-q', '-B', 'edit', 'origin/main'], dest, {
		env: gitEnv(),
	});
	const held = join(dest, 'work', 'slicing', `${slug}.md`);
	writeFileSync(
		held,
		readFileSync(held, 'utf8') + '\nCONCURRENT EDIT under the lock.\n',
	);
	run('git', ['add', '-A'], dest, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', 'concurrent edit'], dest, {env: gitEnv()});
	run('git', ['push', '-q', 'origin', 'edit:main'], dest, {env: gitEnv()});
}

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

// --- The slicer review→edit→converge LOOP (slicer-review-edit-loop) -----------

describe('performSlice — the slicer review→edit→converge loop', () => {
	/** A loop gate returning a scripted sequence of verdicts (one per pass). */
	function loopGate(verdicts: SliceReviewVerdict[]): SliceReviewGate {
		let i = 0;
		return async () => {
			const v = verdicts[Math.min(i, verdicts.length - 1)];
			i++;
			return v;
		};
	}

	it('a converging loop (findings → edits → clean) LANDS the IMPROVED slices', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: slicingAgent('child'),
			reviewLoop: loopGate([
				// Pass 1: block + improve the candidate slice in place.
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'thin prompt'}],
					edits: [
						{
							path: 'work/backlog/child.md',
							content:
								'---\nslug: child\nprd: it\n---\n\n## Prompt\n\n> IMPROVED by the loop\n',
						},
					],
				},
				// Pass 2: converged.
				{verdict: 'approve', findings: []},
			]),
			slicerLoopMax: 3,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBe('converged');
		// The IMPROVED slice landed on the arbiter (not the pre-loop draft).
		expect(onArbiter(repo, 'work/backlog/child.md')).toBe(true);
		expect(showArbiter(repo, 'work/backlog/child.md')).toMatch(
			/IMPROVED by the loop/,
		);
		// The lock was released + the PRD now rests in prd-sliced/ (residence = the SOLE
		// sliced-ness signal; the `sliced:` marker was removed in
		// remove-sliced-marker-step-b).
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/prd-sliced/it.md')).toBe(true);
	});

	it('a persistent block hits slicerLoopMax → emits the uncertain slice needsAnswers + questions', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: slicingAgent('child'),
			reviewLoop: loopGate([
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'unresolved seam'}],
					uncertainSlices: [
						{
							path: 'work/backlog/child.md',
							questions: ['which seam does this reuse?'],
						},
					],
				},
			]),
			slicerLoopMax: 2,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBe('uncertain-slices');
		// The slice landed BUT is flagged needsAnswers with the questions in its body.
		const body = showArbiter(repo, 'work/backlog/child.md');
		expect(body).toMatch(/needsAnswers: true/);
		expect(body).toMatch(/which seam does this reuse\?/);
		expect(body).toMatch(/## Open questions/);
	});

	it('decomposition-unclear → routes the PRD to needs-attention, emits NO slices', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			agentRunner: slicingAgent('child'),
			reviewLoop: loopGate([
				{
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'wrong shape'}],
					decompositionUnclear: {
						questions: ['should this be split across two PRDs?'],
					},
				},
			]),
			slicerLoopMax: 2,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('needs-attention');
		expect(result.exitCode).toBe(1);
		// The PRD is in needs-attention (NOT in prd/, NOT in prd-sliced/, NOT sliced).
		expect(onArbiter(repo, 'work/needs-attention/it.md')).toBe(true);
		expect(onArbiter(repo, 'work/prd/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/prd-sliced/it.md')).toBe(false);
		expect(onArbiter(repo, 'work/slicing/it.md')).toBe(false);
		// No guessed slices emitted.
		expect(onArbiter(repo, 'work/backlog/child.md')).toBe(false);
		// The questions are recorded as the needs-attention reason.
		expect(showArbiter(repo, 'work/needs-attention/it.md')).toMatch(
			/should this be split across two PRDs\?/,
		);
	});

	it('M>1 runs the loop in fresh contexts (the loop seam is invoked per execution)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const executions: number[] = [];
		const gate: SliceReviewGate = async (input) => {
			executions.push(input.execution);
			// Execution 1 never converges; execution 2 converges on pass 1.
			if (input.execution === 1) {
				return {
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'try again fresh'}],
				};
			}
			return {verdict: 'approve', findings: []};
		};
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			agentRunner: slicingAgent('child'),
			reviewLoop: gate,
			slicerLoopMax: 2,
			reviewExecutions: 3,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBe('converged');
		// Execution 1 ran twice (slicerLoopMax), execution 2 once (converged), 3 never.
		expect(executions).toEqual([1, 1, 2]);
	});

	it('the HUMAN path is UNAFFECTED by the loop (no loop runs even when a gate is wired)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it', {humanOnly: true});
		let loopRan = false;
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			doer: 'human',
			agentRunner: slicingAgent('child'),
			reviewLoop: async () => {
				loopRan = true;
				return {verdict: 'approve', findings: []};
			},
			slicerLoopMax: 3,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBeUndefined();
		// The loop seam was never invoked on the human path.
		expect(loopRan).toBe(false);
	});

	it('no loop seam wired ⇒ the candidate slices land as-is (pre-loop behaviour)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBeUndefined();
		expect(onArbiter(repo, 'work/backlog/child.md')).toBe(true);
	});

	it('on a POPULATED backlog, the loop touches ONLY this run’s own slice (pre-existing landed slices untouched)', async () => {
		// The requeue fix (regression): seed a POPULATED backlog — a pre-existing,
		// already-LANDED slice committed on the arbiter — then slice. The loop must
		// review/edit/flag ONLY the slice THIS run produced; the pre-existing slice
		// must be left completely alone (not edited, not needsAnswers-flagged, not
		// re-committed into the runner-owned slicing release).
		const {repo} = seedRepoWithArbiter(scratch.root, ['landed']);
		const landedBefore = showArbiter(repo, 'work/backlog/landed.md');
		seedPrd(repo, 'it');
		const seenByGate: string[][] = [];
		// A loop gate that, given the chance, would HIJACK + flag EVERY backlog file
		// — only the scoping fence stops it from touching the pre-existing slice.
		const gate: SliceReviewGate = async (input) => {
			seenByGate.push(input.candidateSlices);
			return {
				verdict: 'block',
				findings: [{severity: 'blocking', question: 'rewrite everything'}],
				edits: [
					// Try to overwrite the pre-existing landed slice (must be REFUSED)…
					{path: 'work/backlog/landed.md', content: 'HIJACKED landed'},
					// …and improve the run's own slice (allowed), keeping valid frontmatter.
					...input.candidateSlices.map((path) => ({
						path,
						content:
							'---\nslug: child\nprd: it\n---\n\n## Prompt\n\n> IMPROVED by the loop\n',
					})),
				],
				// Also try to flag the pre-existing slice directly by name.
				uncertainSlices: [
					{path: 'work/backlog/landed.md', questions: ['hijack flag']},
					...input.candidateSlices.map((path) => ({
						path,
						questions: ['own flag'],
					})),
				],
			};
		};
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			agentRunner: slicingAgent('child'),
			reviewLoop: gate,
			slicerLoopMax: 1,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(result.loop).toBe('uncertain-slices');
		// The gate was only ever shown THIS run's own produced slice.
		for (const seen of seenByGate) {
			expect(seen).toEqual(['work/backlog/child.md']);
		}
		// The pre-existing landed slice on the arbiter is BYTE-FOR-BYTE unchanged:
		// not hijacked, not needsAnswers-flagged, not re-committed.
		expect(showArbiter(repo, 'work/backlog/landed.md')).toBe(landedBefore);
		expect(showArbiter(repo, 'work/backlog/landed.md')).not.toMatch(/HIJACKED/);
		expect(showArbiter(repo, 'work/backlog/landed.md')).not.toMatch(
			/needsAnswers/,
		);
		// THIS run's own slice WAS the one flagged needsAnswers (cap hit).
		const child = showArbiter(repo, 'work/backlog/child.md');
		expect(child).toMatch(/needsAnswers: true/);
		expect(child).toMatch(/own flag/);
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
