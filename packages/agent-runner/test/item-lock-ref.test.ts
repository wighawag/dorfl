import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	acquireItemLock,
	releaseItemLock,
	readItemLock,
	listItemLocks,
	itemLockRef,
	LOCK_REF_PREFIX,
} from '../src/item-lock-ref.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-item-lock-ref-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Does the arbiter currently HAVE the per-item lock ref? (the lock = the ref). */
function lockRefOnArbiter(arbiter: string, entry: string): boolean {
	const r = run(
		'git',
		['ls-remote', `file://${arbiter}`, itemLockRef(entry)],
		scratch.root,
		{env: gitEnv()},
	);
	return r.status === 0 && r.stdout.trim() !== '';
}

/** Is the lock commit PARENTLESS? (decoupled from main; gc-reclaimable on delete). */
function lockCommitParentless(cwd: string, entry: string): boolean {
	run(
		'git',
		['fetch', '-q', 'arbiter', `+${LOCK_REF_PREFIX}/*:${LOCK_REF_PREFIX}/*`],
		cwd,
		{
			env: gitEnv(),
		},
	);
	const parents = run(
		'git',
		['rev-list', '--parents', '-n', '1', itemLockRef(entry)],
		cwd,
		{
			env: gitEnv(),
		},
	);
	// `<sha>` only (no parent sha) ⇒ exactly one token ⇒ parentless.
	return (
		parents.status === 0 && parents.stdout.trim().split(/\s+/).length === 1
	);
}

describe('item-lock-ref tracer — happy path', () => {
	it('acquires by creating the per-item ref, then releases by DELETING it', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);

		expect(lockRefOnArbiter(arbiter, 'slice-alpha')).toBe(false);

		const acq = await acquireItemLock({
			item: 'slice-alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acq.outcome).toBe('acquired');
		expect(lockRefOnArbiter(arbiter, 'slice-alpha')).toBe(true);

		// The lock commit is PARENTLESS (not chained onto main).
		expect(lockCommitParentless(repo, 'slice-alpha')).toBe(true);

		// The two-axis entry round-trips.
		const entry = await readItemLock({
			item: 'slice-alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(entry?.action).toBe('implement');
		expect(entry?.state).toBe('active');
		expect(entry?.reason).toBeUndefined();

		const rel = await releaseItemLock({
			item: 'slice-alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('released');
		// SELF-CLEANING: release DELETED the ref (not emptied it).
		expect(lockRefOnArbiter(arbiter, 'slice-alpha')).toBe(false);
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
	});

	it('does NOT touch main (the item file stays in backlog/, no main move)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'slice-alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		run('git', ['fetch', '-q', 'arbiter'], repo, {env: gitEnv()});
		const stillBacklog = run(
			'git',
			['cat-file', '-e', 'arbiter/main:work/backlog/alpha.md'],
			repo,
			{env: gitEnv()},
		);
		expect(stillBacklog.status).toBe(0);
	});
});

describe('item-lock-ref tracer — mutual exclusion (the dangerous core)', () => {
	it('two racers for the SAME item: exactly ONE acquires, the other is lost (no retry)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const a = raceClone(seeded, 'A');
		const b = raceClone(seeded, 'B');

		const [ra, rb] = await Promise.all([
			acquireItemLock({
				item: 'slice-alpha',
				action: 'implement',
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('A'),
			}),
			acquireItemLock({
				item: 'slice-alpha',
				action: 'advance',
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('B'),
			}),
		]);

		const outcomes = [ra.outcome, rb.outcome].sort();
		expect(outcomes).toEqual(['acquired', 'lost']);
		// The ref exists exactly once on the arbiter.
		expect(lockRefOnArbiter(seeded.arbiter, 'slice-alpha')).toBe(true);
	});

	it('one lock per item is shared across ACTIONS: advance loses to a held implement (atomic exclusion)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const first = await acquireItemLock({
			item: 'slice-alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.outcome).toBe('acquired');

		// A different ACTION on the SAME item must lose the SAME lock.
		const second = await acquireItemLock({
			item: 'slice-alpha',
			action: 'advance',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.outcome).toBe('lost');
		expect(lockRefOnArbiter(arbiter, 'slice-alpha')).toBe(true);
	});

	it('two racers for DIFFERENT items: BOTH acquire (no false contention)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		const a = raceClone(seeded, 'A');
		const b = raceClone(seeded, 'B');

		const [ra, rb] = await Promise.all([
			acquireItemLock({
				item: 'slice-alpha',
				action: 'implement',
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('A'),
			}),
			acquireItemLock({
				item: 'slice-beta',
				action: 'implement',
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('B'),
			}),
		]);
		expect(ra.outcome).toBe('acquired');
		expect(rb.outcome).toBe('acquired');
		expect(lockRefOnArbiter(seeded.arbiter, 'slice-alpha')).toBe(true);
		expect(lockRefOnArbiter(seeded.arbiter, 'slice-beta')).toBe(true);
	});

	it('after release, the item is re-acquirable (lock lifecycle round-trips)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'slice-alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await releaseItemLock({
			item: 'slice-alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const reacq = await acquireItemLock({
			item: 'slice-alpha',
			action: 'slice',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(reacq.outcome).toBe('acquired');
	});
});

describe('item-lock-ref tracer — release/read edge cases', () => {
	it('releasing an unheld item is not-held (idempotent)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const rel = await releaseItemLock({
			item: 'slice-alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('not-held');
	});

	it('reading an unheld item returns undefined; listItemLocks reflects held set', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		expect(
			await readItemLock({
				item: 'slice-alpha',
				cwd: repo,
				arbiter: 'arbiter',
				env: gitEnv(),
			}),
		).toBeUndefined();
		await acquireItemLock({
			item: 'slice-alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await acquireItemLock({
			item: 'slice-beta',
			action: 'slice',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([
			'slice-alpha',
			'slice-beta',
		]);
	});
});
