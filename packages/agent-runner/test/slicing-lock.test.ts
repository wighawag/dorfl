import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {acquireSlicingLock, releaseSlicingLock} from '../src/slicing-lock.js';
import {performClaim} from '../src/claim-cas.js';
import {itemLockRef, listItemLocks, readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	raceClone,
	racerEnv,
	type Scratch,
	fixtureFolderRel,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-slicing-lock-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Does `<arbiter>/main` track `work/<folder>/<slug>.md`? (soft check). */
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
const slicingFolderOnArbiter = (cwd: string, slug: string): boolean =>
	trackedOnArbiter(cwd, 'slicing', slug);
/** Does the arbiter HOLD the per-item lock ref for the PRD `slug`? */
function lockRefOnArbiter(arbiter: string, slug: string): boolean {
	const r = run(
		'git',
		['ls-remote', `file://${arbiter}`, itemLockRef(`prd-${slug}`)],
		scratch.root,
		{env: gitEnv()},
	);
	return r.status === 0 && r.stdout.trim() !== '';
}

/**
 * The slicing lock is the UNIFIED per-item lock now (slice
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`): the
 * `git mv work/prd/ → work/slicing/` marker is RETIRED, so the PRD body STAYS in
 * `work/prd/` while it is being sliced (the lock is the `prd:<slug>` ref,
 * `action: slice`). The durable `prd → prd-sliced` success move + the read-stability
 * stale check live at the integrate seam (`slicing.ts`), not in the lock.
 */

describe('acquireSlicingLock — happy path', () => {
	it('takes the prd:<slug> unified lock; the PRD body STAYS in prd/ (no slicing/ marker)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		// The unified lock (action: slice) is held; the retired slicing/ marker is
		// never written; the body stays in prd/.
		expect(lockRefOnArbiter(arbiter, 'alpha')).toBe(true);
		expect(slicingFolderOnArbiter(repo, 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		const entry = await readItemLock({
			item: 'prd:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(entry?.action).toBe('slice');
		expect(entry?.state).toBe('active');
	});

	it('returns the acquire-time lockedBlob (the prd/ body snapshot)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		// The lockedBlob is the blob of work/prd/alpha.md on the arbiter.
		const blob = run(
			'git',
			['rev-parse', 'arbiter/main:work/prd/alpha.md'],
			repo,
			{env: gitEnv()},
		).stdout.trim();
		expect(result.lockedBlob).toBe(blob);
	});

	it('dry-run reports the lockable snapshot and does NOT take the lock', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const notes: string[] = [];
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			dryRun: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(notes.some((n) => n.includes('[dry-run]'))).toBe(true);
		expect(result.lockedBlob).toBeDefined();
		expect(lockRefOnArbiter(arbiter, 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
	});
});

describe('acquireSlicingLock — not lockable (exit 2)', () => {
	it('returns "lost" when there is no such PRD', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const result = await acquireSlicingLock({
			slug: 'nope',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
	});

	it('returns "lost" when the PRD is already held (unified lock taken)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const other = seeded.clone('other');
		const first = await acquireSlicingLock({
			slug: 'alpha',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.exitCode).toBe(0);
		const second = await acquireSlicingLock({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
	});
});

describe('acquireSlicingLock — usage / env errors (exit 1)', () => {
	it('errors when the arbiter remote does not exist', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const result = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'nope',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/no git remote named 'nope'/);
	});
});

describe('slicing-lock race — exactly one winner', () => {
	it('two simultaneous slicers ⇒ one acquires, the loser gets exit-2', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['solo']});
		// Distinct committer identity per racer so the two lock commits get DISTINCT
		// shas (as two real slicers would) and the loser loses through the genuine
		// create-only ref CAS, not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		const [ra, rb] = await Promise.all([
			acquireSlicingLock({
				slug: 'solo',
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('a'),
			}),
			acquireSlicingLock({
				slug: 'solo',
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('b'),
			}),
		]);

		const acquired = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(acquired).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// The arbiter agrees: the lock is held exactly once; the PRD never moved.
		expect(await listItemLocks(a, 'arbiter', gitEnv())).toEqual(['prd-solo']);
		expect(prdOnArbiter(a, 'solo')).toBe(true);
		expect(slicingFolderOnArbiter(a, 'solo')).toBe(false);
	});
});

describe('slicing∥claim exclusion on the SAME slug-namespace ref', () => {
	it('a held slicing lock and a build claim share the SAME prd: vs slice: ref namespaces (no collision)', async () => {
		// A PRD `dual` and a SLICE `dual` are DISTINCT entries (`prd-dual` vs
		// `slice-dual`), so a slicing lock on the PRD and a build claim on the slice
		// do NOT collide — they are different items.
		const seeded = seedRepoWithArbiter(scratch.root, ['dual'], {
			prds: ['dual'],
		});
		const slicing = await acquireSlicingLock({
			slug: 'dual',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(slicing.exitCode).toBe(0);
		const claim = await performClaim({
			slug: 'dual',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		// Both locks are held on DISTINCT refs.
		expect(lockRefOnArbiter(seeded.arbiter, 'dual')).toBe(true); // prd-dual
		const slugs = await listItemLocks(seeded.repo, 'arbiter', gitEnv());
		expect(slugs.sort()).toEqual(['prd-dual', 'slice-dual']);
	});
});

describe('releaseSlicingLock — deletes the unified lock', () => {
	it('deletes the prd: lock ref on a clean release (exit 0); the PRD stays in prd/', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const acquired = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		const result = await releaseSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			lockedBlob: acquired.lockedBlob,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('released');
		expect(lockRefOnArbiter(arbiter, 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
	});

	it('an already-absent lock is an idempotent "released"', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const result = await releaseSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('released');
	});
});

describe('releaseSlicingLock — routeToNeedsAttention marks the lock stuck', () => {
	it('amends the prd: lock active → stuck with the reason (no folder write)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['alpha'],
		});
		const acquired = await acquireSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		const result = await releaseSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			lockedBlob: acquired.lockedBlob,
			routeToNeedsAttention: {reason: 'decomposition unclear: what is X?'},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('released');
		// The lock is STILL held — but stuck, carrying the reason. NO folder write.
		expect(lockRefOnArbiter(arbiter, 'alpha')).toBe(true);
		expect(trackedOnArbiter(repo, 'needs-attention', 'alpha')).toBe(false);
		expect(prdOnArbiter(repo, 'alpha')).toBe(true);
		const entry = await readItemLock({
			item: 'prd:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(entry?.state).toBe('stuck');
		expect(entry?.reason).toMatch(/decomposition unclear/);
	});

	it('returns "lost" when there is no held lock to mark stuck', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, [], {prds: ['alpha']});
		const result = await releaseSlicingLock({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			routeToNeedsAttention: {reason: 'x'},
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
	});
});
