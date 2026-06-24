import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {performAdvance} from '../src/advance.js';
import {performClaim} from '../src/claim-cas.js';
import type {DoOptions, DoResult} from '../src/do.js';
import {
	acquireItemLock,
	releaseItemLock,
	readItemLock,
	listItemLocks,
} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-advance-exclusion-');
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * POST-#9 EXCLUSION PROOF (task
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`, carried from the
 * original capstone #9 because this is where the advancing MARKER is removed).
 *
 * With the `work/advancing/<entry>.md` marker GONE and the advance layer taking NO
 * unified hold for the BUILD-TASK / TASK-PRD rungs (`advancing-acquires-unified-lock`
 * option a — proved by `advancing-acquires-unified-lock.test.ts`), those rungs are
 * guarded SOLELY by the inner `do`'s claim/task unified lock
 * (`refs/dorfl/lock/<entry>`, the create-only ref CAS that `performClaim` /
 * `acquireTaskingLock` take). These tests PROVE:
 *
 *   1. advance∥claim on a build-task item stays mutually exclusive through the
 *      inner `do`'s claim lock ALONE — a held `task:<slug>` lock makes the advance
 *      build-task rung's inner claim LOSE; the advance layer takes no hold of its
 *      own.
 *   2. the prd advance-layer TOCTOU (two advancers both classifying the item as
 *      build BEFORE the inner `do`) resolves to EXACTLY ONE winner at the inner
 *      claim lock.
 *
 * To isolate the proof to the LOCK (not the full build machinery), the build-task
 * rung is orchestrated with an injected `doDriver` that runs the REAL `performClaim`
 * (the inner `do`'s lock point) — faithful, because the inner `do`'s exclusion IS
 * that claim. They drive REAL git against a `--bare file://` arbiter with in-process
 * races, so the file is registered in `vitest.config.ts` `RACE_SENSITIVE`.
 */

/**
 * A `doDriver` whose body IS the inner `do`'s lock point: it runs the REAL
 * `performClaim` for the resolved task (the create-only `task-<slug>` ref CAS),
 * then maps the claim outcome onto a {@link DoResult}. This is the faithful inner
 * exclusion — `performDo` itself begins with this very claim — without the rest of
 * the build pipeline (gate/agent/integrate), so the test is deterministic.
 */
function claimOnlyDoDriver(
	cwd: string,
	label: string,
): (options: DoOptions) => Promise<DoResult> {
	return async (options: DoOptions): Promise<DoResult> => {
		const slug = options.arg.replace(/^task:/, '');
		const claim = await performClaim({
			slug,
			cwd,
			arbiter: ARBITER,
			env: racerEnv(label),
		});
		return {
			exitCode: claim.exitCode,
			outcome:
				claim.exitCode === 0
					? 'completed'
					: claim.outcome === 'lost'
						? 'lost'
						: claim.outcome === 'contended'
							? 'contended'
							: 'usage-error',
			slug,
			message: claim.message,
		} as DoResult;
	};
}

/** Drive a real build-task advance whose inner `do` is the claim-only driver. */
function advanceBuildTask(cwd: string, slug: string, label: string) {
	return performAdvance({
		arg: `task:${slug}`,
		cwd,
		arbiter: ARBITER,
		// `doOptions` present so the build-task rung ORCHESTRATES a `do`; the inner
		// `do` is the claim-only driver (the real `performClaim` lock point). NO
		// executor stub and NO injected acquire/release: the PRODUCTION advance-layer
		// lock policy runs (which for a build-task rung takes NO advance hold).
		doOptions: {integration: 'merge', env: racerEnv(label)},
		doDriver: claimOnlyDoDriver(cwd, label),
		env: racerEnv(label),
	});
}

describe('advance∥claim on a build-task item: exclusion via the inner do claim lock ALONE', () => {
	it('a held task: implement lock makes the advance build-task rung lose at the inner claim', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// A DIFFERENT principal holds the task's implement lock (a concurrent claim).
		const holder = raceClone(seeded, 'holder');
		const held = await acquireItemLock({
			item: 'task:solo',
			action: 'implement',
			cwd: holder,
			arbiter: ARBITER,
			env: racerEnv('holder'),
		});
		expect(held.outcome).toBe('acquired');

		// The advance build-task rung orchestrates its inner `do` → performClaim,
		// which loses the SAME `task-solo` create-only ref CAS. The advance layer took
		// NO hold of its own; the inner claim lock is the sole gate.
		const adv = await advanceBuildTask(raceClone(seeded, 'adv'), 'solo', 'adv');
		expect(adv.exitCode).not.toBe(0);
		expect(adv.outcome).toBe('lost');

		// The held lock is UNMOVED: still the holder's `implement` claim, exactly once.
		// No `advance` hold was ever taken at the advance layer.
		const entry = await readItemLock({
			item: 'task:solo',
			cwd: holder,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('implement');
		expect(await listItemLocks(holder, ARBITER, gitEnv())).toEqual([
			'task-solo',
		]);

		await releaseItemLock({
			item: 'task:solo',
			cwd: holder,
			arbiter: ARBITER,
			env: racerEnv('holder'),
		});
	});

	it('advance∥claim race: exactly one wins the inner claim lock (never both)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const a = raceClone(seeded, 'adv');
		const b = raceClone(seeded, 'clm');

		// The advance build-task rung's inner claim competes with a direct claim for
		// the SAME `task-solo` ref. Exactly one wins (the inner claim lock arbitrates;
		// the advance layer takes no hold).
		const [adv, clm] = await Promise.all([
			advanceBuildTask(a, 'solo', 'adv'),
			performClaim({
				slug: 'solo',
				cwd: b,
				arbiter: ARBITER,
				env: racerEnv('clm'),
			}),
		]);

		const advWon = adv.exitCode === 0;
		const clmWon = clm.exitCode === 0;
		// Exactly one side won the inner-lock claim.
		expect([advWon, clmWon].filter(Boolean)).toHaveLength(1);
		// The single held lock is an `implement` claim (the inner `do`'s claim OR the
		// direct claim) — never an `advance` hold from the advance layer.
		const locks = await listItemLocks(a, ARBITER, gitEnv());
		expect(locks).toEqual(['task-solo']);
		const entry = await readItemLock({
			item: 'task:solo',
			cwd: a,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(entry?.action).toBe('implement');
	});
});

describe('advance-layer TOCTOU resolves to one winner at the inner claim lock', () => {
	it('two simultaneous build-task advances of the SAME item ⇒ exactly one inner claim wins', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		// Both ticks classify the item as build-task (pre-lock, the prd TOCTOU
		// window) and both orchestrate an inner `do` → performClaim. The inner claim
		// lock resolves it: exactly one wins the `task-solo` ref CAS.
		const [ra, rb] = await Promise.all([
			advanceBuildTask(a, 'solo', 'a'),
			advanceBuildTask(b, 'solo', 'b'),
		]);

		const won = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.outcome === 'lost');
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// Exactly one `implement` claim is held (the inner-lock winner); no `advance`
		// hold, no second claim.
		expect(await listItemLocks(a, ARBITER, gitEnv())).toEqual(['task-solo']);
	});
});
