import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {acquireSlicingLock, releaseSlicingLock} from '../src/slicing-lock.js';
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
	scratch = makeScratch('agent-runner-slicing-unified-lock-');
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
const slicingOnArbiter = (cwd: string, slug: string): boolean =>
	trackedOnArbiter(cwd, 'slicing', slug);

describe('acquireSlicingLock acquires the unified per-item lock (the marker is RETIRED)', () => {
	it('a successful acquire holds the lock (prd:<slug>, action slice); the body stays in prd/ (NO slicing/ marker)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		// The slicing/ marker is RETIRED — the body stays in prd/ (slice
		// `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`).
		expect(slicingOnArbiter(repo, 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		// AND the per-item lock (entry prd-alpha, action slice) is held on the arbiter.
		expect(lockRefOnArbiter(arbiter, lockEntryFor('prd:alpha'))).toBe(true);
		const entry = await readItemLock({
			item: 'prd:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('slice');
		expect(entry?.state).toBe('active');
		// The blob snapshot the lock TOOK is still returned (the stale-edit check needs it).
		expect(result.lockedBlob).toMatch(/^[0-9a-f]{40}$/);
	});

	it('a dry-run takes NO lock and mutates nothing', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			dryRun: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(lockRefOnArbiter(arbiter, lockEntryFor('prd:alpha'))).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		expect(slicingOnArbiter(repo, 'alpha')).toBe(false);
	});
});

describe('a lock LOST makes the slicing acquire lose definitively with NO marker', () => {
	it('a DIFFERENT principal already holding the SAME item lock makes the acquire lose, with NO slicing/ marker', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		// Principal a holds ONLY the unified lock (no marker move): the PRD stays in
		// prd/, so the marker CAS alone would admit a slicer; only the held lock gates.
		const a = raceClone(seeded, 'a');
		const held = await acquireItemLock({
			item: 'prd:alpha',
			action: 'slice',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(held.outcome).toBe('acquired');
		expect(prdOnArbiter(a, 'alpha')).toBe(true);

		// A second, distinct principal tries to slice the same PRD. It loses the
		// create-only lock race definitively (no retry), and writes NO marker.
		const b = raceClone(seeded, 'b');
		const second = await acquireSlicingLock({
			slug: 'alpha',
			cwd: b,
			arbiter: ARBITER,
			env: racerEnv('b'),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
		// NO marker written by b: PRD still in prd/, never in slicing/.
		expect(prdOnArbiter(b, 'alpha')).toBe(true);
		expect(slicingOnArbiter(b, 'alpha')).toBe(false);
		// The lock is still held by principal a exactly once (b did not steal it).
		expect(await listItemLocks(b, ARBITER, gitEnv())).toEqual(['prd-alpha']);
	});
});

describe('slice ∥ claim and slice ∥ advance are mutually exclusive on the SAME item lock', () => {
	it('a slice action on an item already held for IMPLEMENT loses the SAME lock CAS', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['shared']});
		// Principal a holds the item for IMPLEMENT (the claim action) — the SAME ref
		// `prd-shared` (the lock is keyed by item identity, shared across actions).
		const a = raceClone(seeded, 'a');
		const claimHold = await acquireItemLock({
			item: 'prd:shared',
			action: 'implement',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(claimHold.outcome).toBe('acquired');

		// A slicer for the SAME item loses the SAME create-only ref CAS — atomic
		// cross-action exclusion, no marker written.
		const b = raceClone(seeded, 'b');
		const slice = await acquireSlicingLock({
			slug: 'shared',
			cwd: b,
			arbiter: ARBITER,
			env: racerEnv('b'),
		});
		expect(slice.exitCode).toBe(2);
		expect(slice.outcome).toBe('lost');
		expect(slicingOnArbiter(b, 'shared')).toBe(false);
		// The implement hold survives, untouched.
		const entry = await readItemLock({
			item: 'prd:shared',
			cwd: b,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('implement');
	});

	it('a slice action on an item already held for ADVANCE loses the SAME lock CAS', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['shared']});
		// Principal a holds the item for ADVANCE on the SAME ref `prd-shared`.
		const a = raceClone(seeded, 'a');
		const advanceHold = await acquireItemLock({
			item: 'prd:shared',
			action: 'advance',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(advanceHold.outcome).toBe('acquired');

		const b = raceClone(seeded, 'b');
		const slice = await acquireSlicingLock({
			slug: 'shared',
			cwd: b,
			arbiter: ARBITER,
			env: racerEnv('b'),
		});
		expect(slice.exitCode).toBe(2);
		expect(slice.outcome).toBe('lost');
		expect(slicingOnArbiter(b, 'shared')).toBe(false);
		// The advance hold survives.
		const entry = await readItemLock({
			item: 'prd:shared',
			cwd: b,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('advance');
	});

	it('conversely, a held slicing lock blocks a claim of the SAME item', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['shared']});
		const a = raceClone(seeded, 'a');
		const sliced = await acquireSlicingLock({
			slug: 'shared',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(sliced.exitCode).toBe(0);

		// A claim/advance of the SAME item now loses the SAME ref CAS.
		const b = raceClone(seeded, 'b');
		const claim = await acquireItemLock({
			item: 'prd:shared',
			action: 'implement',
			cwd: b,
			arbiter: ARBITER,
			env: racerEnv('b'),
		});
		expect(claim.outcome).toBe('lost');
		// The slice hold survives exactly once.
		expect(await listItemLocks(b, ARBITER, gitEnv())).toEqual(['prd-shared']);
	});
});

describe('race on a --bare file:// arbiter: two slicers of the SAME PRD', () => {
	it('exactly one wins; the lock + the marker agree on the single winner', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['solo']});
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		const [ra, rb] = await Promise.all([
			acquireSlicingLock({
				slug: 'solo',
				cwd: a,
				arbiter: ARBITER,
				env: racerEnv('a'),
			}),
			acquireSlicingLock({
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
		// (no slicing/ marker).
		expect(slicingOnArbiter(a, 'solo')).toBe(false);
		expect(prdOnArbiter(a, 'solo')).toBe(true);
		expect(await listItemLocks(a, ARBITER, gitEnv())).toEqual(['prd-solo']);
	});
});

describe('releaseSlicingLock releases the unified per-item lock', () => {
	it('a clean release drops the lock; the PRD body stays in prd/', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const acquired = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		expect(lockRefOnArbiter(arbiter, 'prd-alpha')).toBe(true);

		const released = await releaseSlicingLock({
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
		expect(slicingOnArbiter(repo, 'alpha')).toBe(false);
		// ... AND the unified lock is released (self-cleaning: no ref left).
		expect(lockRefOnArbiter(arbiter, 'prd-alpha')).toBe(false);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
	});

	it('after a clean release the PRD is re-acquirable (the lock did not orphan)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const first = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		await releaseSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			lockedBlob: first.lockedBlob,
			env: gitEnv(),
		});
		const second = await acquireSlicingLock({
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
		// `nope` has no PRD on main → the lockable check returns `lost` BEFORE taking
		// the lock, so nothing is orphaned.
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const result = await acquireSlicingLock({
			slug: 'nope',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
		expect(lockRefOnArbiter(arbiter, 'prd-nope')).toBe(false);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
	});
});
