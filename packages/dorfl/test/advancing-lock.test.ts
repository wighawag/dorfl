import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	acquireAdvancingLock,
	releaseAdvancingLock,
	createItemThroughCas,
	runCasContentionLoop,
	nextCasContentionDelayMs,
	INTERACTIVE_CAS_CONTENTION,
	LIFECYCLE_CAS_CONTENTION,
	type CasAttemptResult,
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

	it('keys a SPEC to spec-<slug> and an observation to observation-<slug>', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [], {
			specs: ['beta'],
		});
		const spec = await acquireAdvancingLock({
			item: 'spec:beta',
			cwd: repo,
			arbiter: 'arbiter',
			acquireUnified: true,
			env: gitEnv(),
		});
		expect(spec.exitCode).toBe(0);
		expect(spec.entry).toBe('spec-beta');
		expect(lockRefOnArbiter(arbiter, 'spec-beta')).toBe(true);

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

/**
 * CAS contention-retry regime (task
 * `jitter-and-widen-cas-contention-retry-for-lifecycle-fanout`). The tests drive
 * the SHARED retry primitive `runCasContentionLoop` directly with an injected
 * fake attempt + injected `sleep` + injected RNG so the retry timeline + the
 * jitter shape are fully deterministic — no real wall-clock waits, no flakes.
 * This mirrors the recovery-rebase jitter seam in `integration-core.ts` (both
 * `Sleep` and RNG injected for the same reason).
 */
describe('CAS contention retry — jittered delay + widened budget', () => {
	/** A tiny scripted "attempt" seam: N rejections then one final verdict. */
	function scriptedAttempts(
		rejections: number,
		final: CasAttemptResult,
	): () => Promise<CasAttemptResult> {
		let i = 0;
		return async () => {
			if (i < rejections) {
				i += 1;
				return {kind: 'rejected', message: `rejected #${i}`};
			}
			return final;
		};
	}

	it('the interactive default is unchanged: 3 retries, NO delay, clean `contended` on exhaustion', async () => {
		// Interactive callers (e.g. `claim` — or, here, a direct call passing no
		// contention config) MUST NOT inherit a sluggish wide budget. Exhaustion
		// after the historical 3 retries stays a prompt bounded give-up.
		const sleeps: number[] = [];
		const notes: string[] = [];
		const loop = await runCasContentionLoop({
			attempt: scriptedAttempts(100, {
				kind: 'rejected',
				message: 'never lands',
			}),
			budget: {sleep: async (ms) => void sleeps.push(ms), rng: () => 0.5},
			note: (m) => notes.push(m),
		});
		expect(loop.kind).toBe('contended');
		// 1 initial attempt + `INTERACTIVE_CAS_CONTENTION.retries` retries — the
		// (retries+1)-th rejection is the exhaustion signal (matches the pre-task
		// shape's exit-3 give-up).
		expect(loop.attempts).toBe(INTERACTIVE_CAS_CONTENTION.retries + 1);
		expect(loop.sleeps).toEqual([]); // NO delay in the interactive shape.
		expect(sleeps).toEqual([]);
		expect(loop.message).toMatch(/main is contended/);
	});

	it('a widened-budget run DRAINS: succeeds where the interactive fixed-3 would have exited contended', async () => {
		// The fan-out regression: fixed cap of 3 exits `contended` after 4 rejections
		// even though the (5th) attempt would succeed. With the widened lifecycle
		// budget it drains cleanly.
		const script = scriptedAttempts(10, {
			kind: 'created',
			message: 'landed on the 11th',
		});
		const sleeps: number[] = [];
		const loop = await runCasContentionLoop({
			attempt: script,
			budget: {
				...LIFECYCLE_CAS_CONTENTION,
				sleep: async (ms) => void sleeps.push(ms),
				rng: () => 0.5,
			},
		});
		expect(loop.kind).toBe('created');
		expect(loop.attempts).toBe(11);
		expect(loop.sleeps.length).toBe(10);
		expect(sleeps).toEqual(loop.sleeps);
		// Every retry SLEPT a positive delay (jitter active) and stayed under cap.
		for (const d of loop.sleeps) {
			expect(d).toBeGreaterThan(0);
			expect(d).toBeLessThanOrEqual(LIFECYCLE_CAS_CONTENTION.maxDelayMs);
		}
	});

	it('two parallel legs desync: distinct RNG streams ⇒ distinct jitter timelines (breaking lockstep)', async () => {
		// The FAN-OUT thundering-herd property: two legs retrying the same-shape
		// contention with DIFFERENT rngs MUST land on DIFFERENT jitter delays. The
		// prior instant-retry regime had identical (zero) delays so N legs collided
		// in lockstep; here they desync.
		const budget = {
			...LIFECYCLE_CAS_CONTENTION,
			retries: 6,
			sleep: async () => {},
		};
		const script = () => scriptedAttempts(4, {kind: 'created', message: 'ok'});
		const rngA = (() => {
			const xs = [0.1, 0.2, 0.3, 0.4];
			let i = 0;
			return () => xs[i++] ?? 0;
		})();
		const rngB = (() => {
			const xs = [0.9, 0.8, 0.7, 0.6];
			let i = 0;
			return () => xs[i++] ?? 0;
		})();
		const [a, b] = await Promise.all([
			runCasContentionLoop({attempt: script(), budget: {...budget, rng: rngA}}),
			runCasContentionLoop({attempt: script(), budget: {...budget, rng: rngB}}),
		]);
		expect(a.kind).toBe('created');
		expect(b.kind).toBe('created');
		expect(a.sleeps).not.toEqual(b.sleeps); // desynced timelines
		// And they never lockstep-collide on any specific retry index:
		for (let i = 0; i < a.sleeps.length; i++) {
			expect(a.sleeps[i]).not.toBe(b.sleeps[i]);
		}
	});

	it('the wall-clock budget still bounds a genuinely-exhausted fan-out to a clean `contended` (never a hang)', async () => {
		// A pathological forever-contended attempt terminates via the `maxTotalMs`
		// wall-clock cap. Regression guard: the widened budget MUST NOT become an
		// unbounded wait.
		const sleeps: number[] = [];
		const loop = await runCasContentionLoop({
			attempt: scriptedAttempts(1000, {kind: 'rejected', message: 'x'}),
			budget: {
				retries: 1000,
				initialDelayMs: 100,
				maxDelayMs: 500,
				maxTotalMs: 300, // small on purpose so the cap fires quickly
				sleep: async (ms) => void sleeps.push(ms),
				rng: () => 1,
			},
		});
		expect(loop.kind).toBe('contended');
		expect(loop.message).toMatch(/wall-clock budget/);
		// Cumulative sleep never exceeded the budget.
		const cumulative = sleeps.reduce((a, b) => a + b, 0);
		expect(cumulative).toBeLessThanOrEqual(300);
	});

	it('`nextCasContentionDelayMs` is bounded by [base, cap], returns 0 when the delay is disabled', () => {
		// Pure shape test: DECORRELATED JITTER stays within [base, cap]; disabling
		// either bound short-circuits to `0` (the interactive instant-retry shape).
		for (let r = 0; r <= 1; r += 0.1) {
			const d = nextCasContentionDelayMs({
				previousDelayMs: 200,
				initialDelayMs: 25,
				maxDelayMs: 500,
				rng: () => r,
			});
			expect(d).toBeGreaterThanOrEqual(25);
			expect(d).toBeLessThanOrEqual(500);
		}
		expect(
			nextCasContentionDelayMs({
				previousDelayMs: 0,
				initialDelayMs: 0,
				maxDelayMs: 500,
				rng: () => 0.5,
			}),
		).toBe(0);
		expect(
			nextCasContentionDelayMs({
				previousDelayMs: 0,
				initialDelayMs: 25,
				maxDelayMs: 0,
				rng: () => 0.5,
			}),
		).toBe(0);
	});

	it('the delay grows toward the cap under sustained contention (decorrelated growth)', () => {
		// AWS-style decorrelated jitter: successive delays trend upward (bounded by
		// `min(cap, prev*3)`) so a long tail spreads MORE across the herd. This is
		// what makes the tail DRAIN instead of collide in a shrinking window.
		let prev = 0;
		const xs: number[] = [];
		for (let i = 0; i < 8; i++) {
			prev = nextCasContentionDelayMs({
				previousDelayMs: prev,
				initialDelayMs: 25,
				maxDelayMs: 2_000,
				rng: () => 1, // upper-bound each step
			});
			xs.push(prev);
		}
		// Monotonically non-decreasing (upper-bound rng picks the max in [base, min(cap, prev*3)]).
		for (let i = 1; i < xs.length; i++) {
			expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]!);
		}
		expect(xs[xs.length - 1]).toBe(2_000); // saturates at the cap.
	});

	it('`createItemThroughCas` forwards an injected sleep+rng through to the contention loop', async () => {
		// End-to-end wiring: a real `createItemThroughCas` call in an uncontended
		// fixture creates on the FIRST attempt — so `sleep` is NEVER called and the
		// widened budget is silently absorbed (no latency for a lone leg).
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const sleeps: number[] = [];
		const result = await createItemThroughCas({
			path: 'work/tasks/ready/wired.md',
			content: '---\ntitle: wired\nslug: wired\nblockedBy: []\n---\n',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
			contention: {
				...LIFECYCLE_CAS_CONTENTION,
				sleep: async (ms) => void sleeps.push(ms),
				rng: () => 0.5,
			},
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('created');
		expect(sleeps).toEqual([]); // uncontended → no sleep
	});
});
