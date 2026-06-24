import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	acquireAdvancingLock,
	releaseAdvancingLock,
	createItemThroughCas,
} from '../src/advancing-lock.js';
import {itemLockRef, listItemLocks} from '../src/item-lock.js';
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
	scratch = makeScratch('dorfl-advancing-lock-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Does `<arbiter>/main` track `work/<folder>/<entry>.md`? (soft check). */
function trackedOnArbiter(cwd: string, folder: string, entry: string): boolean {
	run('git', ['fetch', '-q', 'arbiter'], cwd, {env: gitEnv()});
	return (
		run(
			'git',
			[
				'cat-file',
				'-e',
				`arbiter/main:work/${fixtureFolderRel(folder)}/${entry}.md`,
			],
			cwd,
			{env: gitEnv()},
		).status === 0
	);
}
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

/**
 * The advancing borrow is the UNIFIED per-item lock now (task
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`): the
 * `work/advancing/<entry>.md` presence-marker is RETIRED. A TREE-LESS rung
 * (`acquireUnified: true`) takes the `action: advance` lock ref; a build/task rung
 * (the default) is a NO-OP hold (the inner `do`'s claim/task lock is the
 * exclusion). The cross-action exclusion / `performAdvance` wiring lives in
 * `advancing-acquires-unified-lock.test.ts`; this file covers the lock PRIMITIVE +
 * the `createItemThroughCas` helper.
 */

describe('acquireAdvancingLock — tree-less rung (the unified lock)', () => {
	it('takes the unified action:advance lock ref; the item is untouched, NO marker', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		expect(result.entry).toBe('task-alpha');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
		// The retired marker is never written; the borrow is a LOCK, not a move.
		expect(trackedOnArbiter(repo, 'advancing', 'task-alpha')).toBe(false);
		expect(trackedOnArbiter(repo, 'backlog', 'alpha')).toBe(true);
	});

	it('keys a bare slug to the task type (task-<slug>)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.entry).toBe('task-alpha');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
	});

	it('keys a PRD to prd-<slug> and an observation to observation-<slug>', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			prds: ['beta'],
		});
		const prd = await acquireAdvancingLock({
			item: 'prd:beta',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(prd.exitCode).toBe(0);
		expect(prd.entry).toBe('prd-beta');
		expect(lockRefOnArbiter(arbiter, 'prd-beta')).toBe(true);

		const obs = await acquireAdvancingLock({
			item: 'obs:gamma',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(obs.exitCode).toBe(0);
		expect(obs.entry).toBe('observation-gamma');
		expect(lockRefOnArbiter(arbiter, 'observation-gamma')).toBe(true);
	});

	it('dry-run takes NO lock and does NOT mutate the arbiter', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			dryRun: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
	});

	it('returns "lost" when the unified lock is already held', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const other = seeded.clone('other');
		const first = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: other,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(first.exitCode).toBe(0);
		const second = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
	});
});

describe('acquireAdvancingLock — build/task rung is a NO-OP hold', () => {
	it('takes NO lock (default acquireUnified) — the inner do is the exclusion point', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
	});

	it('releases as a NO-OP too (nothing to drop at the advance layer)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const released = await releaseAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(released.exitCode).toBe(0);
		expect(released.outcome).toBe('released');
	});
});

describe('acquireAdvancingLock — usage / env errors (exit 1)', () => {
	it('errors when the arbiter remote does not exist', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'nope',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/no git remote named 'nope'/);
	});

	it('errors on an empty item identity', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: '',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
	});
});

describe('advancing-lock tree-less race — exactly one winner', () => {
	it('two simultaneous ticks ⇒ one acquires, the loser gets exit-2', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// Distinct committer identity per racer so the two lock commits get DISTINCT
		// shas (as two real ticks would) and the loser loses through the genuine
		// create-only ref CAS, not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		const [ra, rb] = await Promise.all([
			acquireAdvancingLock({
				item: 'task:solo',
				cwd: a,
				arbiter: 'arbiter',
				acquireUnified: true,
				env: racerEnv('a'),
			}),
			acquireAdvancingLock({
				item: 'task:solo',
				cwd: b,
				arbiter: 'arbiter',
				acquireUnified: true,
				env: racerEnv('b'),
			}),
		]);

		const acquired = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(acquired).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(lockRefOnArbiter(seeded.arbiter, 'task-solo')).toBe(true);
	});
});

describe('releaseAdvancingLock — tree-less rung deletes the unified lock', () => {
	it('deletes the unified lock ref WITHOUT moving the item (exit 0)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const acquired = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(acquired.exitCode).toBe(0);
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);

		const released = await releaseAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			releaseUnified: true,
			env: gitEnv(),
		});
		expect(released.exitCode).toBe(0);
		expect(released.outcome).toBe('released');
		// The lock ref is gone; the item NEVER moved status folder (lock, not move).
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
		expect(trackedOnArbiter(repo, 'backlog', 'alpha')).toBe(true);
	});

	it('a short acquire→release cycle leaves the lock re-acquirable', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		await releaseAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			releaseUnified: true,
			env: gitEnv(),
		});
		const reacquired = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(reacquired.exitCode).toBe(0);
	});

	it('a tree-less release of an already-absent lock is an idempotent "released"', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await releaseAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			releaseUnified: true,
			env: gitEnv(),
		});
		// Idempotent: a returned item never keeps an orphaned advance hold.
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('released');
	});
});

describe('createItemThroughCas — new-item creation keyed on the new identity', () => {
	it('creates a new backlog item via the CAS (exit 0)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const result = await createItemThroughCas({
			path: 'work/tasks/ready/promoted.md',
			content: '---\ntitle: promoted\nslug: promoted\nblockedBy: []\n---\n',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('created');
		expect(trackedOnArbiter(repo, 'backlog', 'promoted')).toBe(true);
	});

	it('a same-path new-item race ⇒ exactly one creates, the loser loses (no special case)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		// Distinct committer identity per racer so the two create commits get
		// DISTINCT shas (as two real machines would) and the loser loses through the
		// genuine path-exists/lease CAS, not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');
		const content = '---\ntitle: dup\nslug: dup\nblockedBy: []\n---\n';

		const [ra, rb] = await Promise.all([
			createItemThroughCas({
				path: 'work/tasks/ready/dup.md',
				content,
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('a'),
			}),
			createItemThroughCas({
				path: 'work/tasks/ready/dup.md',
				content,
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('b'),
			}),
		]);

		const created = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(created).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(trackedOnArbiter(a, 'backlog', 'dup')).toBe(true);
	});

	it('returns "lost" when the target path already exists on the arbiter', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['exists']);
		const result = await createItemThroughCas({
			path: 'work/tasks/ready/exists.md',
			content: '---\ntitle: exists\nslug: exists\n---\n',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
	});
});
