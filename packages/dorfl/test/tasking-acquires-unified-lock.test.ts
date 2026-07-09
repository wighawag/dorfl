import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {acquireTaskingLock, releaseTaskingLock} from '../src/tasking-lock.js';
import {
	acquireItemLock,
	releaseItemLock,
	listItemLocks,
	readItemLock,
	itemLockRef,
	lockEntryFor,
} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	prdFile,
	raceClone,
	racerEnv,
	type Scratch,
	fixtureFolderRel,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-tasking-unified-lock-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Does the arbiter currently HOLD the per-item lock ref for `entry`? */
function lockRefOnArbiter(arbiter: string, entry: string): boolean {
	const r = run(
		'git',
		['ls-remote', `file://${arbiter}`, itemLockRef(entry)],
		scratch.root,
		{env: gitEnv()},
	);
	return r.status === 0 && r.stdout.trim() !== '';
}

/** Does `<arbiter>/main` track `work/<folder>/<slug>.md`? */
function trackedOnArbiter(cwd: string, folder: string, slug: string): boolean {
	run('git', ['fetch', '-q', 'arbiter'], cwd, {env: gitEnv()});
	return (
		run(
			'git',
			[
				'cat-file',
				'-e',
				`arbiter/main:work/${fixtureFolderRel(folder)}/${slug}.md`,
			],
			cwd,
			{env: gitEnv()},
		).status === 0
	);
}
const prdOnArbiter = (cwd: string, slug: string): boolean =>
	trackedOnArbiter(cwd, 'prd', slug);
const taskingOnArbiter = (cwd: string, slug: string): boolean =>
	trackedOnArbiter(cwd, 'tasking', slug);

describe('acquireTaskingLock acquires the unified per-item lock (the marker is RETIRED)', () => {
	it('a successful acquire holds the lock (prd:<slug>, action task); the body stays in prd/ (NO tasking/ marker)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const result = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		// The tasking/ marker is RETIRED — the body stays in prd/ (task
		// `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`).
		expect(taskingOnArbiter(repo, 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		// AND the per-item lock (entry spec-alpha, action task) is held on the arbiter.
		// MIGRATE step: the tasking path EMITs the `spec-<slug>` entry now.
		expect(lockRefOnArbiter(arbiter, lockEntryFor('spec:alpha'))).toBe(true);
		const entry = await readItemLock({
			item: 'spec:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('task');
		expect(entry?.state).toBe('active');
		// The blob snapshot the lock TOOK is still returned (the stale-edit check needs it).
		expect(result.lockedBlob).toMatch(/^[0-9a-f]{40}$/);
	});

	it('a dry-run takes NO lock and mutates nothing', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const result = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			dryRun: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(lockRefOnArbiter(arbiter, lockEntryFor('spec:alpha'))).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		expect(taskingOnArbiter(repo, 'alpha')).toBe(false);
	});
});

describe('a lock LOST makes the tasking acquire lose definitively with NO marker', () => {
	it('a DIFFERENT principal already holding the SAME item lock makes the acquire lose, with NO tasking/ marker', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		// Principal a holds ONLY the unified lock (no marker move): the prd stays in
		// prd/, so the marker CAS alone would admit a tasker; only the held lock gates.
		const a = raceClone(seeded, 'a');
		// MIGRATE step: the tasking path EMITs `spec:<slug>` now, so a rival holder
		// must take the SAME `spec:` item identity to collide on the one ref.
		const held = await acquireItemLock({
			item: 'spec:alpha',
			action: 'task',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(held.outcome).toBe('acquired');
		expect(prdOnArbiter(a, 'alpha')).toBe(true);

		// A second, distinct principal tries to task the same prd. It loses the
		// create-only lock race definitively (no retry), and writes NO marker.
		const b = raceClone(seeded, 'b');
		const second = await acquireTaskingLock({
			slug: 'alpha',
			cwd: b,
			arbiter: ARBITER,
			env: racerEnv('b'),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
		// NO marker written by b: prd still in prd/, never in tasking/.
		expect(prdOnArbiter(b, 'alpha')).toBe(true);
		expect(taskingOnArbiter(b, 'alpha')).toBe(false);
		// The lock is still held by principal a exactly once (b did not steal it).
		expect(await listItemLocks(b, ARBITER, gitEnv())).toEqual(['spec-alpha']);
	});
});

describe('task ∥ claim and task ∥ advance are mutually exclusive on the SAME item lock', () => {
	it('a task action on an item already held for IMPLEMENT loses the SAME lock CAS', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['shared']});
		// Principal a holds the item for IMPLEMENT (the claim action) — the SAME ref
		// `spec-shared` (the lock is keyed by item identity, shared across actions).
		// MIGRATE step: the tasking path keys `spec:<slug>` now, so the rival takes
		// the SAME `spec:` identity.
		const a = raceClone(seeded, 'a');
		const claimHold = await acquireItemLock({
			item: 'spec:shared',
			action: 'implement',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(claimHold.outcome).toBe('acquired');

		// A tasker for the SAME item loses the SAME create-only ref CAS — atomic
		// cross-action exclusion, no marker written.
		const b = raceClone(seeded, 'b');
		const task = await acquireTaskingLock({
			slug: 'shared',
			cwd: b,
			arbiter: ARBITER,
			env: racerEnv('b'),
		});
		expect(task.exitCode).toBe(2);
		expect(task.outcome).toBe('lost');
		expect(taskingOnArbiter(b, 'shared')).toBe(false);
		// The implement hold survives, untouched.
		const entry = await readItemLock({
			item: 'spec:shared',
			cwd: b,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('implement');
	});

	it('a task action on an item already held for ADVANCE loses the SAME lock CAS', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['shared']});
		// Principal a holds the item for ADVANCE on the SAME ref `spec-shared`.
		const a = raceClone(seeded, 'a');
		const advanceHold = await acquireItemLock({
			item: 'spec:shared',
			action: 'advance',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(advanceHold.outcome).toBe('acquired');

		const b = raceClone(seeded, 'b');
		const task = await acquireTaskingLock({
			slug: 'shared',
			cwd: b,
			arbiter: ARBITER,
			env: racerEnv('b'),
		});
		expect(task.exitCode).toBe(2);
		expect(task.outcome).toBe('lost');
		expect(taskingOnArbiter(b, 'shared')).toBe(false);
		// The advance hold survives.
		const entry = await readItemLock({
			item: 'spec:shared',
			cwd: b,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('advance');
	});

	it('conversely, a held tasking lock blocks a claim of the SAME item', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['shared']});
		const a = raceClone(seeded, 'a');
		const tasked = await acquireTaskingLock({
			slug: 'shared',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(tasked.exitCode).toBe(0);

		// A claim/advance of the SAME item now loses the SAME ref CAS.
		const b = raceClone(seeded, 'b');
		const claim = await acquireItemLock({
			item: 'spec:shared',
			action: 'implement',
			cwd: b,
			arbiter: ARBITER,
			env: racerEnv('b'),
		});
		expect(claim.outcome).toBe('lost');
		// The task hold survives exactly once.
		expect(await listItemLocks(b, ARBITER, gitEnv())).toEqual(['spec-shared']);
	});
});

describe('race on a --bare file:// arbiter: two taskers of the SAME PRD', () => {
	it('exactly one wins; the lock + the marker agree on the single winner', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['solo']});
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		const [ra, rb] = await Promise.all([
			acquireTaskingLock({
				slug: 'solo',
				cwd: a,
				arbiter: ARBITER,
				env: racerEnv('a'),
			}),
			acquireTaskingLock({
				slug: 'solo',
				cwd: b,
				arbiter: ARBITER,
				env: racerEnv('b'),
			}),
		]);

		const acquired = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(acquired).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// The unified lock is the sole gate: held exactly once; the body never moved
		// (no tasking/ marker).
		expect(taskingOnArbiter(a, 'solo')).toBe(false);
		expect(prdOnArbiter(a, 'solo')).toBe(true);
		expect(await listItemLocks(a, ARBITER, gitEnv())).toEqual(['spec-solo']);
	});
});

describe('releaseTaskingLock releases the unified per-item lock', () => {
	it('a clean release drops the lock; the PRD body stays in prd/', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const acquired = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		expect(lockRefOnArbiter(arbiter, 'spec-alpha')).toBe(true);

		const released = await releaseTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			lockedBlob: acquired.lockedBlob,
			env: gitEnv(),
		});
		expect(released.exitCode).toBe(0);
		expect(released.outcome).toBe('released');
		// The body stays in prd/ (the release moves no file) ...
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		expect(taskingOnArbiter(repo, 'alpha')).toBe(false);
		// ... AND the unified lock is released (self-cleaning: no ref left).
		expect(lockRefOnArbiter(arbiter, 'spec-alpha')).toBe(false);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
	});

	it('after a clean release the PRD is re-acquirable (the lock did not orphan)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const first = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		await releaseTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			lockedBlob: first.lockedBlob,
			env: gitEnv(),
		});
		const second = await acquireTaskingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(0);
		expect(second.outcome).toBe('acquired');
	});
});

describe('a lockable-check loss takes NO lock (no orphan)', () => {
	it('acquiring a non-existent PRD loses with NO orphaned lock', async () => {
		// `nope` has no prd on main → the lockable check returns `lost` BEFORE taking
		// the lock, so nothing is orphaned.
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const result = await acquireTaskingLock({
			slug: 'nope',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
		expect(lockRefOnArbiter(arbiter, 'spec-nope')).toBe(false);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
	});
});
