import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	acquireAdvancingLock,
	releaseAdvancingLock,
} from '../src/advancing-lock.js';
import {acquireTaskingLock} from '../src/tasking-lock.js';
import {performClaim} from '../src/claim-cas.js';
import {performAdvance} from '../src/advance.js';
import type {SurfaceGate} from '../src/surface-gate.js';
import {
	acquireItemLock,
	releaseItemLock,
	markStuckItemLock,
	listItemLocks,
	readItemLock,
	itemLockRef,
} from '../src/item-lock.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-advancing-unified-');
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * Does `<arbiter>/main` track `work/advancing/<entry>.md`? (the RETIRED marker —
 * after the capstone cut-over it must NEVER exist; kept here only to assert its
 * absence.)
 */
function advancingMarkerOnArbiter(cwd: string, entry: string): boolean {
	run('git', ['fetch', '-q', ARBITER], cwd, {env: gitEnv()});
	return (
		run(
			'git',
			['cat-file', '-e', `${ARBITER}/main:work/advancing/${entry}.md`],
			cwd,
			{
				env: gitEnv(),
			},
		).status === 0
	);
}

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

describe('advancing acquire — TREE-LESS rung (acquireUnified) takes the unified lock (NO marker)', () => {
	it('takes ONLY the unified lock (action: advance); the retired marker is never written', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		// The legacy `work/advancing/<entry>.md` marker is RETIRED — never written.
		expect(advancingMarkerOnArbiter(repo, 'task-alpha')).toBe(false);
		// The unified per-item lock (action: advance) is the SOLE hold.
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(true);
		const entry = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('advance');
		expect(entry?.state).toBe('active');
		// The borrow is a LOCK, not a lifecycle move: the item is untouched.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
	});

	it('releaseAdvancingLock (releaseUnified) clears the unified lock', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			acquireUnified: true,
			env: gitEnv(),
		});
		const released = await releaseAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			releaseUnified: true,
			env: gitEnv(),
		});
		expect(released.exitCode).toBe(0);
		expect(released.outcome).toBe('released');
		expect(advancingMarkerOnArbiter(repo, 'task-alpha')).toBe(false);
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
	});

	it('a dry-run takes NO unified lock and writes nothing', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			acquireUnified: true,
			dryRun: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
		expect(advancingMarkerOnArbiter(repo, 'task-alpha')).toBe(false);
	});
});

describe('advancing acquire — BUILD/TASK rung (no acquireUnified) is a NO-OP hold', () => {
	it('takes NO unified lock and writes NO marker (the inner do is the exclusion point)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Default (acquireUnified omitted) is the build/task-rung behaviour: a NO-OP
		// `acquired` (the inner `do`'s claim/task lock is the sole exclusion point).
		const result = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('acquired');
		// No marker (retired) and NO unified lock at the advance layer for a build rung.
		expect(advancingMarkerOnArbiter(repo, 'task-alpha')).toBe(false);
		expect(lockRefOnArbiter(arbiter, 'task-alpha')).toBe(false);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
	});
});

describe('a unified lock LOST makes the tree-less advancing acquire lose definitively', () => {
	it('a DIFFERENT principal holding the lock makes the tree-less acquire lose', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		// Principal a holds ONLY the unified lock (implement) — no marker; the marker
		// CAS alone would admit an advancer, only the held lock gates it.
		const a = raceClone(seeded, 'a');
		const held = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
		expect(held.outcome).toBe('acquired');

		// A second principal advances the same item (tree-less rung): loses the
		// create-only lock race definitively, no retry, and NO marker written.
		const b = raceClone(seeded, 'b');
		const second = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: b,
			arbiter: ARBITER,
			acquireUnified: true,
			env: racerEnv('b'),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
		// No marker is written by b (retired) — the held lock is the sole gate.
		expect(advancingMarkerOnArbiter(b, 'task-alpha')).toBe(false);
		// The lock is still held by principal a exactly once (b did not steal it).
		expect(await listItemLocks(b, ARBITER, gitEnv())).toEqual(['task-alpha']);

		await releaseItemLock({
			item: 'task:alpha',
			cwd: a,
			arbiter: ARBITER,
			env: racerEnv('a'),
		});
	});
});

describe('advance∥claim and advance∥task exclusion on the SAME item (tree-less rung)', () => {
	it('advance∥claim: a tree-less advance holding the lock makes a concurrent claim lose the SAME ref', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const adv = raceClone(seeded, 'adv');
		const advance = await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: adv,
			arbiter: ARBITER,
			acquireUnified: true,
			env: racerEnv('adv'),
		});
		expect(advance.outcome).toBe('acquired');
		expect(lockRefOnArbiter(seeded.arbiter, 'task-alpha')).toBe(true);

		// A claim of the SAME item now loses the create-only lock CAS (no advisory
		// check, no TOCTOU) — the advance hold IS the gate.
		const clm = raceClone(seeded, 'clm');
		const claim = await performClaim({
			slug: 'alpha',
			cwd: clm,
			arbiter: ARBITER,
			env: racerEnv('clm'),
		});
		expect(claim.exitCode).toBe(2);
		expect(claim.outcome).toBe('lost');
		expect(existsOnArbiterMain(clm, 'in-progress', 'alpha')).toBe(false);
		// The advance hold is unmoved (advance action, exactly once).
		const entry = await readItemLock({
			item: 'task:alpha',
			cwd: clm,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('advance');
	});

	it('advance∥task: a tree-less advance on a PRD makes a concurrent tasking lose the SAME ref', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {prds: ['beta']});
		const adv = raceClone(seeded, 'adv');
		const advance = await acquireAdvancingLock({
			item: 'prd:beta',
			cwd: adv,
			arbiter: ARBITER,
			acquireUnified: true,
			env: racerEnv('adv'),
		});
		expect(advance.outcome).toBe('acquired');
		expect(lockRefOnArbiter(seeded.arbiter, 'prd-beta')).toBe(true);

		// A tasking of the SAME PRD now loses the create-only lock CAS.
		const slc = raceClone(seeded, 'slc');
		const tasking = await acquireTaskingLock({
			slug: 'beta',
			cwd: slc,
			arbiter: ARBITER,
			env: racerEnv('slc'),
		});
		expect(tasking.exitCode).toBe(2);
		expect(tasking.outcome).toBe('lost');
		// The PRD never moved to tasking/; the advance hold is the single winner.
		expect(existsOnArbiterMain(slc, 'backlog', 'beta')).toBe(false);
		const entry = await readItemLock({
			item: 'prd:beta',
			cwd: slc,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('advance');
	});

	it('two simultaneous tree-less advances of the SAME item: exactly one wins; marker + lock agree', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');
		const [ra, rb] = await Promise.all([
			acquireAdvancingLock({
				item: 'task:solo',
				cwd: a,
				arbiter: ARBITER,
				acquireUnified: true,
				env: racerEnv('a'),
			}),
			acquireAdvancingLock({
				item: 'task:solo',
				cwd: b,
				arbiter: ARBITER,
				acquireUnified: true,
				env: racerEnv('b'),
			}),
		]);
		const won = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// The unified lock is the sole gate: held exactly once, no marker.
		expect(advancingMarkerOnArbiter(a, 'task-solo')).toBe(false);
		expect(await listItemLocks(a, ARBITER, gitEnv())).toEqual(['task-solo']);
	});
});

describe('performAdvance wires the unified lock PER RUNG (the isTreeLessRung policy)', () => {
	it('a SURFACE rung (tree-less) takes the unified lock during execution and releases it after', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['foo'], {
			needsAnswers: true,
		});
		const {repo, arbiter} = seeded;
		// The gate runs WHILE the lock is held (post-lock, winner-only) — capture the
		// lock state from inside it to prove the production acquire took the unified ref.
		let heldDuringExec = false;
		let actionDuringExec: string | undefined;
		const gate: SurfaceGate = async (input) => {
			heldDuringExec = lockRefOnArbiter(arbiter, 'task-foo');
			const entry = await readItemLock({
				item: 'task:foo',
				cwd: repo,
				arbiter: ARBITER,
				env: gitEnv(),
			});
			actionDuringExec = entry?.action;
			return {item: input.item, questions: [{question: 'open?'}]};
		};

		const result = await performAdvance({
			arg: 'foo',
			cwd: repo,
			arbiter: ARBITER,
			surfaceGate: gate,
			// NO acquireLock/releaseLock injected: the PRODUCTION acquire/release path
			// runs, so `advance.ts`'s per-rung `acquireUnified` policy is exercised.
		});
		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('surface');
		// The unified lock (action: advance) WAS held while the rung executed…
		expect(heldDuringExec).toBe(true);
		expect(actionDuringExec).toBe('advance');
		// …and is RELEASED after the tick (the item returns to rest, no orphaned lock).
		expect(lockRefOnArbiter(arbiter, 'task-foo')).toBe(false);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
	});

	it('a BUILD-TASK rung does NOT take the unified lock and does NOT deadlock the tick', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['bar']);
		const {repo, arbiter} = seeded;
		// Stub the build/task orchestration (the inner `do`) so the rung runs without a
		// real build — and capture the lock state during it. A build-task rung that
		// (wrongly) took the unified lock at the advance layer would DEADLOCK against the
		// inner do's SAME ref; here we prove the advance layer takes NO unified lock.
		let heldDuringExec = true;
		const result = await performAdvance({
			arg: 'bar',
			cwd: repo,
			arbiter: ARBITER,
			executor: {
				buildTask: async (input) => {
					heldDuringExec = lockRefOnArbiter(arbiter, 'task-bar');
					return {
						exitCode: 0,
						outcome: 'advanced',
						message: `built ${input.item}`,
					};
				},
				taskPrd: async () => ({
					exitCode: 0,
					outcome: 'advanced',
					message: '',
				}),
				triageObservation: async () => ({
					exitCode: 0,
					outcome: 'advanced',
					message: '',
				}),
				surface: async () => ({exitCode: 0, outcome: 'advanced', message: ''}),
				apply: async () => ({exitCode: 0, outcome: 'advanced', message: ''}),
			},
			// PRODUCTION acquire/release path (no injected lock).
		});
		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('build-task');
		// NO unified lock taken at the advance layer for the build/task rung.
		expect(heldDuringExec).toBe(false);
		expect(await listItemLocks(repo, ARBITER, gitEnv())).toEqual([]);
		// No marker at all (retired); the build rung takes no advance-layer hold.
		expect(advancingMarkerOnArbiter(repo, 'task-bar')).toBe(false);
	});
});

describe('a tree-less advance hold can reach the stuck state', () => {
	it('mark-stuck moves the advance hold to advance/stuck carrying its reason', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await acquireAdvancingLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			acquireUnified: true,
			env: gitEnv(),
		});
		const stuck = await markStuckItemLock({
			item: 'task:alpha',
			reason: 'surface rung needs a human decision',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(stuck.outcome).toBe('transitioned');
		const entry = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('advance');
		expect(entry?.state).toBe('stuck');
		expect(entry?.reason).toBe('surface rung needs a human decision');
	});
});
