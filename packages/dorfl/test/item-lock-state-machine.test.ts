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
} from '../src/item-lock.js';
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
 * The lock-entry two-axis STATE MACHINE (task
 * `lock-entry-state-machine-and-invariants`; design trail "The C8 lock-entry STATE
 * MACHINE"). These tests sit ON TOP of the unified lock module's primitives
 * (acquire/release) and drive the interior transitions (mark-stuck / resume /
 * requeue) + the complete transition's lock half, asserting EVERY legal move and
 * REJECTING the illegal ones, plus the three invariants:
 *   - at most ONE entry per item (issue-3 exclusion; a held item loses acquire);
 *   - `reason` PRESENT iff `state: stuck`;
 *   - `done` on `main` + a `stuck` lock may legitimately CO-EXIST.
 * Everything runs on a `--bare file://` arbiter (`seedRepoWithArbiter`), writing
 * only into its own temp fixtures.
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

describe('lock state machine — the full legal lifecycle (every transition)', () => {
	it('acquire → mark-stuck → resume → release walks active↔stuck and back to rest', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);

		// 1. acquire: (absent) → [implement, active]
		const acq = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(acq.outcome).toBe('acquired');

		// 2. mark-stuck: [implement, active] → [implement, stuck] + reason
		const stuck = await markStuckItemLock({
			item: 'task:alpha',
			reason: 'gate red on lint',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(stuck.outcome).toBe('transitioned');
		const stuckEntry = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(stuckEntry?.action).toBe('implement'); // action unchanged
		expect(stuckEntry?.state).toBe('stuck');
		expect(stuckEntry?.reason).toBe('gate red on lint');
		// the amended commit is still parentless.
		expect(lockCommitParentless(repo, 'task-alpha')).toBe(true);

		// 3. resume: [implement, stuck] → [implement, active] (reason cleared)
		const resumed = await resumeItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(resumed.outcome).toBe('transitioned');
		const activeAgain = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(activeAgain?.state).toBe('active');
		expect(activeAgain?.action).toBe('implement');
		expect(activeAgain?.reason).toBeUndefined();

		// 6. release: [implement, active] → (absent)
		const rel = await releaseItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('released');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
	});

	it('requeue (transition 4): [action, stuck] → (absent) returns the item to the pool', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await markStuckItemLock({
			item: 'task:alpha',
			reason: 'giving up for now',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const req = await requeueItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(req.outcome).toBe('transitioned');
		// The lock is gone…
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
		// …and the body NEVER moved: it is still resting in backlog/ on main.
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

	it('complete (transition 5, lock half): release AFTER the durable main move', async () => {
		// The main move (backlog → done) is owned by the complete task; here we
		// model "done landed on main" then exercise THIS task's half: release.
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const {repo, arbiter} = seeded;
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// durable main move (owned elsewhere) lands done on main.
		seedDoneOnArbiter(seeded, 'alpha');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		// the lock half: release after.
		const rel = await releaseItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(rel.outcome).toBe('released');
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
	});
});

describe('lock state machine — illegal transitions are rejected (not coerced)', () => {
	it('mark-stuck / resume / requeue on an ABSENT entry are not-held', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		expect(
			(
				await markStuckItemLock({
					item: 'task:alpha',
					reason: 'r',
					cwd: repo,
					arbiter: 'arbiter',
					env: gitEnv(),
				})
			).outcome,
		).toBe('not-held');
		expect(
			(
				await resumeItemLock({
					item: 'task:alpha',
					cwd: repo,
					arbiter: 'arbiter',
					env: gitEnv(),
				})
			).outcome,
		).toBe('not-held');
		expect(
			(
				await requeueItemLock({
					item: 'task:alpha',
					cwd: repo,
					arbiter: 'arbiter',
					env: gitEnv(),
				})
			).outcome,
		).toBe('not-held');
	});

	it('resume on an ACTIVE entry is wrong-state (active is reachable from stuck only)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const r = await resumeItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(r.outcome).toBe('wrong-state');
	});

	it('mark-stuck on an already-STUCK entry is wrong-state', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await markStuckItemLock({
			item: 'task:alpha',
			reason: 'first',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const again = await markStuckItemLock({
			item: 'task:alpha',
			reason: 'second',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(again.outcome).toBe('wrong-state');
	});

	it('requeue on an ACTIVE entry is wrong-state (abort an active hold via release)', async () => {
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
		expect(r.outcome).toBe('wrong-state');
		// the active hold is untouched.
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
	});
});

describe('lock state machine — invariant: reason iff stuck', () => {
	it('mark-stuck with an empty reason is rejected (a stuck entry MUST carry a reason)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		for (const reason of ['', '   ']) {
			const r = await markStuckItemLock({
				item: 'task:alpha',
				reason,
				cwd: repo,
				arbiter: 'arbiter',
				env: gitEnv(),
			});
			expect(r.outcome).toBe('error');
		}
		// the entry stays active (the bad mark-stuck did not mutate it).
		const e = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(e?.state).toBe('active');
		expect(e?.reason).toBeUndefined();
	});

	it('an active entry never carries a reason; resume CLEARS the stuck reason', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// active: no reason.
		expect(
			(
				await readItemLock({
					item: 'task:alpha',
					cwd: repo,
					arbiter: 'arbiter',
					env: gitEnv(),
				})
			)?.reason,
		).toBeUndefined();
		await markStuckItemLock({
			item: 'task:alpha',
			reason: 'has a reason while stuck',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await resumeItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// back to active: reason must be gone again.
		const e = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(e?.state).toBe('active');
		expect(e?.reason).toBeUndefined();
	});
});

describe('lock state machine — invariant: at most one entry per item (issue-3 exclusion)', () => {
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

	it('two racers for the SAME stuck entry: only ONE resume wins (leased CAS)', async () => {
		// mark-stuck via the seed clone, then race two resumes on distinct clones.
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await markStuckItemLock({
			item: 'task:alpha',
			reason: 'stuck for the race',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const a = raceClone(seeded, 'A');
		const b = raceClone(seeded, 'B');
		const [ra, rb] = await Promise.all([
			resumeItemLock({
				item: 'task:alpha',
				cwd: a,
				arbiter: 'arbiter',
				holder: 'A',
				env: racerEnv('A'),
			}),
			resumeItemLock({
				item: 'task:alpha',
				cwd: b,
				arbiter: 'arbiter',
				holder: 'B',
				env: racerEnv('B'),
			}),
		]);
		// EXACTLY ONE wins the leased CAS; the loser either lost the lease (`lost`)
		// or fetched after the winner already flipped state out of `stuck`
		// (`wrong-state`) — never two winners.
		const winners = [ra, rb].filter((r) => r.outcome === 'transitioned');
		expect(winners.length).toBe(1);
		const loser = [ra, rb].find((r) => r.outcome !== 'transitioned');
		expect(['lost', 'wrong-state']).toContain(loser?.outcome);
		const e = await readItemLock({
			item: 'task:alpha',
			cwd: seeded.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(e?.state).toBe('active');
	});
});

describe('lock state machine — invariant: done on main + a stuck lock CO-EXIST', () => {
	it('a just-completed (done on main) item can ALSO carry a stuck lock; the two disagree without corruption', async () => {
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

		// A rebase-conflict bounce marks the JUST-COMPLETED item stuck (Amendment 2):
		// done-on-main and a stuck lock legitimately co-exist.
		const stuck = await markStuckItemLock({
			item: 'task:alpha',
			reason: 'rebase conflict on bounce after done landed',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(stuck.outcome).toBe('transitioned');

		// Both records are observable and disagree, with NO error:
		//  - the `main` durable record wins for dependency resolution (it is `done`);
		//  - the stuck lock wins for the human's attention.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		const lock = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(lock?.state).toBe('stuck');
		expect(lock?.reason).toBe('rebase conflict on bounce after done landed');
	});
});
