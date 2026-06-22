import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {performClaim} from '../src/claim-cas.js';
import {
	acquireItemLock,
	releaseItemLock,
	listItemLocks,
	readItemLock,
	itemLockRef,
	heldTaskSlugs,
} from '../src/item-lock.js';
import {scanRepoPaths, scoreItems} from '../src/scan.js';
import {selectPrioritised} from '../src/select-priority.js';
import {mergeConfig} from '../src/config.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-claim-lock-');
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
		{
			env: gitEnv(),
		},
	);
	return r.status === 0 && r.stdout.trim() !== '';
}

describe('claim acquires the unified per-item lock and leaves the body in backlog', () => {
	it('a successful claim acquires the lock and writes NOTHING to main (body stays in backlog)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('claimed');
		// The body STAYS in backlog/ on main — claim no longer moves it.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		// No claim commit lands on main (onboarding cuts off <arbiter>/main).
		expect(result.claimCommit).toBeUndefined();
		// AND the per-item lock (action: implement) is held on the arbiter.
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
		const entry = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('implement');
		expect(entry?.state).toBe('active');
	});

	it('a protected-main repo (claim writes nothing to main) still claims successfully', async () => {
		// Model a protected `main`: claim must touch no `main` ref. We assert it by the
		// arbiter main tip being unchanged across the claim (the only proof that needs
		// no real protection hook: a claim that writes main would advance the tip).
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', ARBITER], repo);
		const mainBefore = run('git', ['rev-parse', `${ARBITER}/main`], repo, {
			env: gitEnv(),
		}).stdout.trim();
		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('claimed');
		gitIn(['fetch', '-q', ARBITER], repo);
		const mainAfter = run('git', ['rev-parse', `${ARBITER}/main`], repo, {
			env: gitEnv(),
		}).stdout.trim();
		expect(mainAfter).toBe(mainBefore);
	});

	it('a dry-run takes NO lock and mutates nothing', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			dryRun: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
	});
});

describe('a lock LOST makes claim lose definitively with NO body move', () => {
	it('a DIFFERENT principal already holding the lock makes the claim lose, with the body STILL in backlog (the LOCK is the gate)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Principal a holds ONLY the lock (no body move) — the body stays in backlog, so
		// the folder CAS alone would admit a claimer; only the held lock gates it.
		const a = raceClone(seeded, 'a');
		const held = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(held.outcome).toBe('acquired');
		expect(existsOnArbiterMain(a, 'backlog', 'alpha')).toBe(true);

		// A SECOND, distinct principal claims the same slug. It loses the create-only
		// lock race definitively (principal a holds it), no retry, NO body move — even
		// though the body is still claimable in backlog.
		const b = raceClone(seeded, 'b');
		const second = await performClaim({
			slug: 'alpha',
			cwd: b,
			arbiter: ARBITER,
			env: racerEnv('b'),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
		// NO body move performed by b: still in backlog, never in-progress.
		expect(existsOnArbiterMain(b, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(b, 'in-progress', 'alpha')).toBe(false);
		// The lock is still held by principal a exactly once (b did not steal it).
		expect(await listItemLocks(b, ARBITER, gitEnv())).toEqual(['task-alpha']);
	});
});

describe('race on a --bare file:// arbiter', () => {
	it('HIGH FAN-OUT: N claims of DIFFERENT items contend ZERO on the LOCK (only the shared-main body CAS may, bounded by retries)', async () => {
		const N = 10;
		const slugs = Array.from({length: N}, (_, i) => `item${i}`);
		const seeded = seedRepoWithArbiter(scratch.root, slugs);
		const clones = slugs.map((_, i) => raceClone(seeded, `R${i}`));

		const results = await Promise.all(
			slugs.map((slug, i) =>
				performClaim({
					slug,
					cwd: clones[i],
					arbiter: ARBITER,
					// The PER-ITEM LOCK never falsely contends (different items → different
					// refs). The body move still races the SHARED `main` ref (defect #1,
					// fixed when #9 stops the body move), so give the body CAS ample retry
					// budget; with it, every different-item claim lands — which it could NOT
					// if the LOCK falsely contended (no retry would help a lock conflict).
					retries: 200,
					env: racerEnv(`R${i}`),
				}),
			),
		);
		// Every different-item claim wins, and NONE failed on the LOCK or main.
		for (const r of results) {
			expect(r.outcome).toBe('claimed');
			expect(r.exitCode).toBe(0);
		}
		// The lock never falsely contends: exactly N held locks, one per item.
		const held = await listItemLocks(clones[0], ARBITER, gitEnv());
		expect(held.sort()).toEqual(slugs.map((s) => `task-${s}`).sort());
	});

	it('two simultaneous claims of the SAME item: exactly one wins; lock + body agree', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		const [ra, rb] = await Promise.all([
			performClaim({
				slug: 'solo',
				cwd: a,
				arbiter: ARBITER,
				env: racerEnv('a'),
			}),
			performClaim({
				slug: 'solo',
				cwd: b,
				arbiter: ARBITER,
				env: racerEnv('b'),
			}),
		]);
		const claimed = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(claimed).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// The lock is the single exclusion now: held exactly once, body still in backlog.
		expect(existsOnArbiterMain(a, 'backlog', 'solo')).toBe(true);
		expect(existsOnArbiterMain(a, 'in-progress', 'solo')).toBe(false);
		expect(await listItemLocks(a, ARBITER, gitEnv())).toEqual(['task-solo']);
	});
});

describe('releasing the lock returns the item to the pool so a re-claim succeeds', () => {
	it('claim → release the lock → re-claim works (the body never left backlog/)', async () => {
		// The body STAYS in backlog/ throughout (claim no longer moves it), so
		// returning the item to the pool is purely "release the per-item lock". (The
		// needs-attention/requeue surface still sources from in-progress/ — its
		// retarget to a body-rests-in-backlog item is slice 9b; see
		// work/notes/observations/requeue-needs-attention-still-source-from-in-progress-not-backlog.md.)
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const first = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(first.outcome).toBe('claimed');
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([
			'task-alpha',
		]);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);

		// Release the lock (the return-to-pool the body-stays model reduces to).
		const released = await releaseItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(released.outcome).toBe('released');
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);

		// A re-claim now re-acquires the lock; the body remains in backlog.
		const second = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(second.outcome).toBe('claimed');
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([
			'task-alpha',
		]);
	});
});

describe('held-slug subtraction in the pool readers', () => {
	const state = {
		todo: [
			{
				file: 'alpha.md',
				slug: 'alpha',
				humanOnly: false,
				needsAnswers: false,
				blockedBy: [],
			},
			{
				file: 'beta.md',
				slug: 'beta',
				humanOnly: false,
				needsAnswers: false,
				blockedBy: [],
			},
		],
		doneSlugs: new Set<string>(),
	};

	it('scoreItems excludes a held slug from the enumerated backlog pool', () => {
		const all = scoreItems(state, true, {totalItems: 0, totalEligible: 0});
		expect(all.map((i) => i.slug).sort()).toEqual(['alpha', 'beta']);

		const counts = {totalItems: 0, totalEligible: 0};
		const subtracted = scoreItems(state, true, counts, new Set(['alpha']));
		expect(subtracted.map((i) => i.slug)).toEqual(['beta']);
		// The held slug is not even counted (it left the pool).
		expect(counts.totalItems).toBe(1);
	});

	it('selectPrioritised drops a held slug from the build pool', () => {
		const report = {
			repos: [
				{
					path: '/repo',
					items: scoreItems(state, true, {totalItems: 0, totalEligible: 0}),
					briefs: [],
					lifecycle: {triage: [], surface: [], apply: []},
					ledgerDuplicates: [],
				},
			],
			totalItems: 2,
			totalEligible: 2,
		};
		const picked = selectPrioritised({
			report,
			caps: {maxParallel: 10, perRepoMax: 10},
			briefs: [],
			heldSlugs: new Set(['alpha']),
		});
		expect(picked.map((p) => p.slug)).toEqual(['beta']);
	});

	it('scanRepoPaths subtracts the supplied held-slug set (offline; caller-supplied)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		const report = scanRepoPaths(
			[repo],
			mergeConfig({autoBuild: true}),
			new Set(['alpha']),
		);
		expect(report.repos[0].items.map((i) => i.slug)).toEqual(['beta']);
	});

	it('heldSliceSlugs maps slice-<slug> lock entries to bare slugs (after a claim holds one)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		const held = await heldTaskSlugs(repo, ARBITER, gitEnv());
		expect([...held]).toEqual(['alpha']);
	});
});
