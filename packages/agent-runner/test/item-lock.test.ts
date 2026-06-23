import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	acquireItemLock,
	releaseItemLock,
	readItemLock,
	listItemLocks,
	itemLockRef,
	lockEntryFor,
	serialiseLockEntry,
	parseLockEntry,
	LOCK_REF_PREFIX,
	type LockEntry,
} from '../src/item-lock.js';
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
	scratch = makeScratch('agent-runner-item-lock-');
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

describe('item-lock — identity seam (reuses resolveSidecarIdentity)', () => {
	it('derives the type-encoded <entry> from the namespaced identity', () => {
		// The SAME single-source-of-truth resolver the sidecar / advancing marker use.
		expect(lockEntryFor('task:alpha')).toBe('task-alpha');
		expect(lockEntryFor('brief:autoslice')).toBe('brief-autoslice');
		expect(lockEntryFor('observation:beta')).toBe('observation-beta');
		expect(lockEntryFor('obs:beta')).toBe('observation-beta'); // alias → canonical
		expect(lockEntryFor('bare-slug')).toBe('task-bare-slug'); // bare = slice
	});

	it('a slice, a PRD, and an observation sharing a slug get DISTINCT refs', () => {
		const slug = 'shared';
		const refs = new Set([
			itemLockRef(lockEntryFor(`task:${slug}`)),
			itemLockRef(lockEntryFor(`brief:${slug}`)),
			itemLockRef(lockEntryFor(`observation:${slug}`)),
		]);
		expect(refs.size).toBe(3);
	});
});

describe('item-lock — entry serialise/parse round-trip', () => {
	it('an active entry round-trips and carries no reason', () => {
		const e: LockEntry = {
			entry: 'task-alpha',
			action: 'implement',
			state: 'active',
			holder: 'tester',
			since: '2026-06-18T00:00:00.000Z',
		};
		const back = parseLockEntry(serialiseLockEntry(e));
		expect(back).toEqual(e);
		expect(back?.reason).toBeUndefined();
	});

	it('a stuck entry round-trips WITH its reason (the two-axis state)', () => {
		const e: LockEntry = {
			entry: 'brief-autoslice',
			action: 'task',
			state: 'stuck',
			holder: 'tester',
			since: '2026-06-18T00:00:00.000Z',
			reason: 'rebase conflict',
		};
		const back = parseLockEntry(serialiseLockEntry(e));
		expect(back).toEqual(e);
		expect(back?.state).toBe('stuck');
		expect(back?.reason).toBe('rebase conflict');
	});

	it('a stuck entry round-trips RICH multi-line reason prose + surfaced questions', () => {
		// Slice `cutover-needs-attention-becomes-lock-stuck-recovery-surface`
		// (decision i+): the lock entry is the SOLE stuck record, so it must carry the
		// FULL reason prose (not a one-line field) AND any agent-surfaced questions, in
		// a shape a future advance-surface rung can render.
		const e: LockEntry = {
			entry: 'task-alpha',
			action: 'implement',
			state: 'stuck',
			holder: 'tester',
			since: '2026-06-18T00:00:00.000Z',
			reason:
				'acceptance gate failed (exit 1).\nThe lint step rejected two files.\nA human must look.',
			questions: [
				'Should the lint rule be relaxed, or the code fixed?',
				'Is the `foo` API stable enough to depend on?',
			],
		};
		const back = parseLockEntry(serialiseLockEntry(e));
		expect(back).toEqual(e);
		expect(back?.reason).toContain('A human must look.');
		expect(back?.questions).toHaveLength(2);
	});
});

describe('item-lock — happy path', () => {
	it('acquires by creating the per-item ref, then releases by DELETING it', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);

		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);

		const acq = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acq.outcome).toBe('acquired');
		// The result surfaces the resolved type-encoded entry (the identity seam).
		expect(acq.entry).toBe('task-alpha');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);

		// The lock commit is PARENTLESS (not chained onto main).
		expect(lockCommitParentless(repo, 'task-alpha')).toBe(true);

		// The two-axis entry round-trips.
		const entry = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(entry?.entry).toBe('task-alpha');
		expect(entry?.action).toBe('implement');
		expect(entry?.state).toBe('active');
		expect(entry?.reason).toBeUndefined();

		const rel = await releaseItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('released');
		expect(rel.entry).toBe('task-alpha');
		// SELF-CLEANING: release DELETED the ref (not emptied it).
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
	});

	it('does NOT touch main (the item file stays in backlog/, no main move)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		run('git', ['fetch', '-q', 'arbiter'], repo, {env: gitEnv()});
		const stillBacklog = run(
			'git',
			['cat-file', '-e', 'arbiter/main:work/tasks/todo/alpha.md'],
			repo,
			{env: gitEnv()},
		);
		expect(stillBacklog.status).toBe(0);
	});

	it('a bare <slug> identity locks the slice ref (bare = slice)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const acq = await acquireItemLock({
			item: 'alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acq.outcome).toBe('acquired');
		expect(acq.entry).toBe('task-alpha');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
	});
});

describe('item-lock — mutual exclusion (the dangerous core)', () => {
	it('two racers for the SAME item: exactly ONE acquires, the other is lost (no retry)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const a = raceClone(seeded, 'A');
		const b = raceClone(seeded, 'B');

		const [ra, rb] = await Promise.all([
			acquireItemLock({
				item: 'task:alpha',
				action: 'implement',
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('A'),
			}),
			acquireItemLock({
				item: 'task:alpha',
				action: 'advance',
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('B'),
			}),
		]);

		const outcomes = [ra.outcome, rb.outcome].sort();
		expect(outcomes).toEqual(['acquired', 'lost']);
		// The ref exists exactly once on the arbiter.
		expect(lockRefOnArbiter(seeded.arbiter, 'task-alpha')).toBe(true);
	});

	it('one lock per item is shared across ACTIONS: advance loses to a held implement (atomic exclusion)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const first = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.outcome).toBe('acquired');

		// A different ACTION on the SAME item must lose the SAME lock.
		const second = await acquireItemLock({
			item: 'task:alpha',
			action: 'advance',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.outcome).toBe('lost');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
	});

	it('two racers for DIFFERENT items: BOTH acquire (no false contention)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		const a = raceClone(seeded, 'A');
		const b = raceClone(seeded, 'B');

		const [ra, rb] = await Promise.all([
			acquireItemLock({
				item: 'task:alpha',
				action: 'implement',
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('A'),
			}),
			acquireItemLock({
				item: 'task:beta',
				action: 'implement',
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('B'),
			}),
		]);
		expect(ra.outcome).toBe('acquired');
		expect(rb.outcome).toBe('acquired');
		expect(lockRefOnArbiter(seeded.arbiter, 'task-alpha')).toBe(true);
		expect(lockRefOnArbiter(seeded.arbiter, 'task-beta')).toBe(true);
	});

	it('HIGH FAN-OUT: N racers for N DIFFERENT items ALL acquire with ZERO contention', async () => {
		const N = 12;
		const slugs = Array.from({length: N}, (_, i) => `item${i}`);
		const seeded = seedRepoWithArbiter(scratch.root, slugs);
		const clones = slugs.map((_, i) => raceClone(seeded, `R${i}`));

		const results = await Promise.all(
			slugs.map((slug, i) =>
				acquireItemLock({
					item: `task:${slug}`,
					action: 'implement',
					cwd: clones[i],
					arbiter: 'arbiter',
					env: racerEnv(`R${i}`),
				}),
			),
		);

		// Every distinct-item writer acquired — NO false contention, NO retry budget.
		expect(results.every((r) => r.outcome === 'acquired')).toBe(true);
		expect(results.some((r) => r.outcome === 'error')).toBe(false);

		// All N locks are live on the arbiter, exactly once each.
		for (const slug of slugs) {
			expect(lockRefOnArbiter(seeded.arbiter, `task-${slug}`)).toBe(true);
		}
		const live = await listItemLocks(seeded.repo, 'arbiter', gitEnv());
		expect(live.sort()).toEqual(slugs.map((s) => `task-${s}`).sort());
	});

	it('after release, the item is re-acquirable (lock lifecycle round-trips)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await releaseItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const reacq = await acquireItemLock({
			item: 'task:alpha',
			action: 'task',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(reacq.outcome).toBe('acquired');
	});
});

describe('item-lock — release/read edge cases', () => {
	it('releasing an unheld item is not-held (idempotent)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const rel = await releaseItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('not-held');
	});

	it('an absent ref reads as "no locks" (read undefined; list empty)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		expect(
			await readItemLock({
				item: 'task:alpha',
				cwd: repo,
				arbiter: 'arbiter',
				env: gitEnv(),
			}),
		).toBeUndefined();
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);

		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await acquireItemLock({
			item: 'task:beta',
			action: 'task',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([
			'task-alpha',
			'task-beta',
		]);
	});
});
