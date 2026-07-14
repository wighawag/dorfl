import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	acquireItemLock,
	releaseItemLock,
	markStuckItemLock,
	resumeItemLock,
	requeueItemLock,
	readItemLock,
	listItemLocks,
	itemLockRef,
	LOCK_REF_PREFIX,
	type LockState,
} from '../src/item-lock.js';
import type {SidecarKind} from '../src/sidecar.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	seedDoneOnArbiter,
	gitEnv,
	raceClone,
	racerEnv,
	existsOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * Post-`retire-stuck-lock-state` (spec
 * `surface-stuck-as-questions-and-retire-stuck-lock-state`) the lock-entry
 * two-axis state machine collapses: `LockState` admits `active` only, a bounce
 * SURFACES + RELEASES (never marks stuck), and a parked item is a
 * `needsAnswers:true` pool item on `main` \u2014 NOT a stuck lock. These tests pin
 * the CONTRACT after the collapse:
 *   - the type `LockState` admits `'active'` only (compile-time);
 *   - the SidecarKind `'stuck'` member SURVIVES (compile-time; it is the
 *     surfaced-bounce sidecar's kind, NOT a lock state);
 *   - `markStuckItemLock` is a shim no-op (does NOT actually mark stuck);
 *   - the `active` CAS mutual-exclusion still holds (same-item second acquire
 *     loses; same-item resume race resolves cleanly);
 *   - the durable `main` record + a held `active` lock may co-exist without
 *     corruption (crash-window recovery is `main`-authoritative, tested in
 *     the reconcile/reap suites).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-lock-sm-');
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

/** Is the (amended) lock commit PARENTLESS? Each transition rebuilds a parentless
 * commit, so the lock graph stays decoupled from main across the whole lifecycle. */
function lockCommitParentless(cwd: string, entry: string): boolean {
	run(
		'git',
		['fetch', '-q', 'arbiter', `+${LOCK_REF_PREFIX}/*:${LOCK_REF_PREFIX}/*`],
		cwd,
		{env: gitEnv()},
	);
	const parents = run(
		'git',
		['rev-list', '--parents', '-n', '1', itemLockRef(entry)],
		cwd,
		{env: gitEnv()},
	);
	return (
		parents.status === 0 && parents.stdout.trim().split(/\s+/).length === 1
	);
}

describe('lock state machine — degenerate `active`-only state (post retire-stuck-lock-state)', () => {
	it('LockState admits `active` only (compile-time)', () => {
		// The assignment compiles iff `LockState` is `'active'`. A `'stuck'`
		// assignment used to compile pre-retirement; if this line ever compiled
		// with a `'stuck'` literal again, the retirement would be reverted.
		const s: LockState = 'active';
		expect(s).toBe('active');
	});

	it('SidecarKind still admits `stuck` (the surfaced-bounce kind, NOT a lock state)', () => {
		// PROTECTED: `SidecarKind` `'stuck'` is a DIFFERENT concept (spec CONTRACT
		// step scope fence) — retirement of the lock state must NOT touch it.
		const k: SidecarKind = 'stuck';
		expect(k).toBe('stuck');
	});

	it('acquire → release round-trips cleanly; the lock is `active` throughout', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const acq = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acq.outcome).toBe('acquired');
		const entry = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(entry?.state).toBe('active');
		expect(lockCommitParentless(repo, 'task-alpha')).toBe(true);

		const rel = await releaseItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('released');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
	});

	it('markStuckItemLock is a shim no-op: a held lock STAYS `active`', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const shim = await markStuckItemLock({
			item: 'task:alpha',
			reason: 'ignored',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// The shim reports success (a held entry is present) but does NOT flip state.
		expect(shim.outcome).toBe('transitioned');
		const entry = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(entry?.state).toBe('active');
	});

	it('markStuckItemLock / resumeItemLock / requeueItemLock on an ABSENT entry are `not-held`', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		for (const outcome of [
			(
				await markStuckItemLock({
					item: 'task:alpha',
					reason: 'r',
					cwd: repo,
					arbiter: 'arbiter',
					env: gitEnv(),
				})
			).outcome,
			(
				await resumeItemLock({
					item: 'task:alpha',
					cwd: repo,
					arbiter: 'arbiter',
					env: gitEnv(),
				})
			).outcome,
			(
				await requeueItemLock({
					item: 'task:alpha',
					cwd: repo,
					arbiter: 'arbiter',
					env: gitEnv(),
				})
			).outcome,
		]) {
			expect(outcome).toBe('not-held');
		}
	});

	it('requeue on a held ACTIVE entry releases the lock (no `stuck` guard any more)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const r = await requeueItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(r.outcome).toBe('transitioned');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
		// The body never moved: it is still resting in backlog/ on main.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		// After requeue the item is freely re-acquirable.
		const reacq = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(reacq.outcome).toBe('acquired');
	});
});

describe('lock state machine — the `active` CAS mutual-exclusion is INTACT', () => {
	it('a SECOND action (advance) on an implement-held item loses the SAME CAS', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const first = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.outcome).toBe('acquired');
		const second = await acquireItemLock({
			item: 'task:alpha',
			action: 'advance', // a DIFFERENT action, SAME item
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.outcome).toBe('lost');
		// exactly ONE entry exists, and it is still the implement hold.
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
		const e = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(e?.action).toBe('implement');
	});

	it('two racers acquiring the SAME item: only ONE wins the leased CAS', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const a = raceClone(seeded, 'A');
		const b = raceClone(seeded, 'B');
		const [ra, rb] = await Promise.all([
			acquireItemLock({
				item: 'task:alpha',
				action: 'implement',
				cwd: a,
				arbiter: 'arbiter',
				holder: 'A',
				env: racerEnv('A'),
			}),
			acquireItemLock({
				item: 'task:alpha',
				action: 'implement',
				cwd: b,
				arbiter: 'arbiter',
				holder: 'B',
				env: racerEnv('B'),
			}),
		]);
		const winners = [ra, rb].filter((r) => r.outcome === 'acquired');
		expect(winners.length).toBe(1);
		const loser = [ra, rb].find((r) => r.outcome !== 'acquired');
		expect(loser?.outcome).toBe('lost');
	});
});

describe('lock state machine — durable `main` record + held `active` lock co-exist', () => {
	it('a just-completed (done on main) item + a held active lock is a stale orphan (not corruption)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const {repo, arbiter} = seeded;
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// The durable main move lands `done` on main (owned by the complete task).
		seedDoneOnArbiter(seeded, 'alpha');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		// The `active` lock still exists (a crash before release); recovery is
		// `main`-authoritative, tested in the reconcile/reap suites.
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
		const lock = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(lock?.state).toBe('active');
	});
});
