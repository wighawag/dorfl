import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	existsOnArbiterMain,
	type Scratch,
	type SeededRepo,
	rmrf,
} from './helpers/gitRepo.js';

/**
 * `recovery-rebase-retry-against-moving-arbiter-main`: the committed-recovery
 * rebase tail (`recoverAlreadyCommitted` in `integration-core.ts`) wraps its
 * fetch-then-rebase in a bounded CONTENTION loop that re-fetches `<arbiter>/main`
 * on each attempt and retries, so a purely TRANSIENT moving-base race
 * (a sibling `advance` run lands a burst of `advance: surface observation:…`
 * commits while we rebase) is ABSORBED — not surfaced as `rebase-conflict`.
 *
 * The discriminator between transient and genuine is OPERATIONAL, not heuristic:
 * a transient conflict succeeds on a later fresh-fetched attempt; a genuine
 * conflict re-occurs against every freshly-fetched main and exhausts the cap.
 *
 * The loop is the CONTENTION model (instant re-fetch+rebuild, like `claim-cas.ts`
 * / the Race-1 merge loop in this same file), NOT the OUTAGE model in
 * `retry-backoff.ts` (exponential temporal backoff for an unreachable remote).
 * The jitter is a SMALL livelock-breaking spread between concurrent runners —
 * NOT exponential outage backoff.
 *
 * House style mirrors `finish-already-committed.test.ts` /
 * `autonomous-recovers-stranded-done.test.ts`: throwaway checkout + a local
 * `--bare` arbiter, `gitEnv()` isolation, nothing global touched.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-recovery-rebase-retry-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Stand the repo up as a stranded committed+done-moved branch whose kept commit
 * MODIFIES `feature.txt`. We pre-seed `feature.txt = "seed"` on `main` so a
 * conflicting state on `<arbiter>/main` can be staged by overwriting it with a
 * different content (the SAME path), guaranteeing a content conflict on rebase.
 */
async function seedStrandedWithFeatureFile(slug: string): Promise<{
	repo: string;
	seeded: SeededRepo;
	tip: string;
}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;

	// Pre-seed `feature.txt = "seed"` on main + push.
	writeFileSync(join(repo, 'feature.txt'), 'seed\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed feature.txt'], repo);
	gitIn(['push', '-q', ARBITER, 'main:main'], repo);

	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);

	// The agent's work modifies `feature.txt` (the conflict-bearing path), and
	// the done-move + commit (steps 2–3) already happened.
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(
		['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
		repo,
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${slug}): build the thing; done`], repo);

	const tip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	return {repo, seeded, tip};
}

/**
 * Advance the arbiter's `main` via a throwaway clone, setting `feature.txt` to
 * the given content. When `content === undefined`, REMOVE `feature.txt` instead
 * (so the kept commit's add/modify rebases cleanly). The checkout under test
 * (`repo`) is left untouched (only `<arbiter>/main` moves).
 */
function advanceArbiterMain(
	seeded: SeededRepo,
	label: string,
	content: string | undefined,
): void {
	const dest = join(scratch.root, `arbiter-advance-${label}`);
	gitIn(['clone', '-q', `file://${seeded.arbiter}`, dest], scratch.root);
	gitIn(['checkout', '-q', 'main'], dest);
	if (content === undefined) {
		gitIn(['rm', '-q', '-f', 'feature.txt'], dest);
	} else {
		writeFileSync(join(dest, 'feature.txt'), content);
		gitIn(['add', '-A'], dest);
	}
	gitIn(['commit', '-q', '-m', `arbiter advance ${label}`], dest);
	gitIn(['push', '-q', 'origin', 'main:main'], dest);
	rmrf(dest);
}

describe('recoverAlreadyCommitted — moving `<arbiter>/main` (CONTENTION) retry loop', () => {
	it('ABSORBS a transient moving-base conflict: first attempt conflicts, the sleep seam advances main to a non-conflicting tip between attempts, the next attempt is clean → `completed` (no needs-attention)', async () => {
		const {repo, seeded, tip} = await seedStrandedWithFeatureFile('alpha');

		// Stage a CONFLICTING `<arbiter>/main` (different `feature.txt` content
		// against the SAME path our kept commit modifies → rebase conflict).
		advanceArbiterMain(seeded, 'conflict', 'conflicting from main\n');

		// Inject the sleep seam: capture the delay schedule, and on the FIRST
		// sleep advance `<arbiter>/main` to a non-conflicting state (remove
		// `feature.txt`) so the NEXT attempt's re-fetched main is clean. Subsequent
		// sleeps (none expected, but defensively) are no-ops.
		const sleeps: number[] = [];
		let sleepCalls = 0;
		const sleep = async (ms: number) => {
			sleeps.push(ms);
			sleepCalls++;
			if (sleepCalls === 1) {
				// Restore feature.txt to its base content (`"seed"`) so the kept
				// commit's `seed -> the work` diff replays cleanly on the now-
				// fresh-fetched main.
				advanceArbiterMain(seeded, 'resolve', 'seed\n');
			}
		};

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			env: gitEnv(),
			recoveryRebaseRetries: 4,
			recoveryRebaseJitterMs: 50,
			recoveryRebaseSleep: sleep,
			recoveryRebaseRandom: () => 0.5,
		});

		expect(result.outcome).toBe('completed');
		// Absorbed within the cap (exactly one retry was enough).
		expect(sleeps.length).toBe(1);
		// The kept commit is reachable on the arbiter's main (the rebase replayed
		// onto the now-clean main and integrated).
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		const arbiterMainAfter = gitIn(
			['rev-parse', `${ARBITER}/main`],
			repo,
		).trim();
		// The work is on it — `feature.txt` carries the kept commit's content.
		expect(gitIn(['show', `${ARBITER}/main:feature.txt`], repo).trim()).toBe(
			'the work',
		);
		// The kept ORIGINAL tip is NOT the integrated sha (the rebase moved it);
		// but the WORK from that tip landed.
		expect(arbiterMainAfter).not.toBe(tip);
	});

	it('PRESERVES a genuine persistent conflict: a same-path content conflict that re-occurs on every fresh-fetched attempt still EXHAUSTS the cap and STILL returns `rebase-conflict` — the kept commit stays intact on the branch, no unbounded loop, never auto-resolved', async () => {
		const {repo, seeded, tip} = await seedStrandedWithFeatureFile('beta');

		// Persistent conflict: `<arbiter>/main` keeps `feature.txt` at a content
		// that conflicts with our kept commit, on EVERY re-fetched attempt (we
		// never advance it in the sleep hook, so every refetch sees the same
		// conflicting main).
		advanceArbiterMain(seeded, 'persistent', 'persistent conflict\n');

		const sleeps: number[] = [];
		const sleep = async (ms: number) => {
			sleeps.push(ms);
		};

		const cap = 3; // 4 total attempts (1 + 3 retries)
		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			env: gitEnv(),
			recoveryRebaseRetries: cap,
			recoveryRebaseJitterMs: 50,
			recoveryRebaseSleep: sleep,
			recoveryRebaseRandom: () => 0.5,
		});

		expect(result.outcome).toBe('rebase-conflict');
		// Sleep count == retries (one sleep between each pair of attempts; no sleep
		// after the final failed attempt). i.e. exactly `cap` sleeps for `cap`
		// retries, proving the loop is BOUNDED and not unbounded.
		expect(sleeps.length).toBe(cap);
		// The kept commit is intact on the branch (NEVER auto-resolved, NEVER
		// `--force`d to main). The work-branch HEAD is exactly the original tip.
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).toBe(tip);
		// And `<arbiter>/main` was NOT advanced by us.
		expect(gitIn(['show', `${ARBITER}/main:feature.txt`], repo).trim()).toBe(
			'persistent conflict',
		);
	});

	it('JITTER de-correlates re-attempts: with a seeded RNG + capturing sleep the timeline is reproducible, every delay is in `[0, jitterMs]` (non-fixed/zero AND NOT an exponential `delay*2` schedule — a small contention jitter)', async () => {
		const {repo, seeded} = await seedStrandedWithFeatureFile('gamma');
		// Persistent conflict (we want the loop to run all retries so we can
		// capture the full schedule).
		advanceArbiterMain(seeded, 'persistent', 'persistent conflict\n');

		// Seeded RNG: a tiny deterministic LCG cycling through a few values, so the
		// captured timeline is reproducible across runs.
		const makeSeededRng = (): (() => number) => {
			let s = 1;
			return () => {
				// Numerical Recipes LCG (cheap, deterministic).
				s = (s * 1664525 + 1013904223) >>> 0;
				return s / 0x100000000;
			};
		};

		const cap = 5;
		const jitterMs = 200;
		const runOnce = async (): Promise<number[]> => {
			// Reset the branch tip for each run so we start from the same state.
			const sleeps: number[] = [];
			const sleep = async (ms: number) => {
				sleeps.push(ms);
			};
			await performIntegration({
				cwd: repo,
				arbiter: ARBITER,
				slug: 'gamma',
				source: 'tasks-ready',
				recovering: false,
				committedRecovery: true,
				mode: 'merge',
				env: gitEnv(),
				recoveryRebaseRetries: cap,
				recoveryRebaseJitterMs: jitterMs,
				recoveryRebaseSleep: sleep,
				recoveryRebaseRandom: makeSeededRng(),
			});
			return sleeps;
		};

		const first = await runOnce();
		const second = await runOnce();

		// We got `cap` sleeps (one between each pair of attempts).
		expect(first.length).toBe(cap);
		expect(second.length).toBe(cap);
		// Reproducibility: the seeded RNG drove an identical schedule across runs.
		expect(second).toEqual(first);
		// Every delay is within the jitter bound (NOT exponential doubling — an
		// exponential schedule starting at any non-zero value would exceed
		// jitterMs within a couple of attempts; assert the bound).
		for (const ms of first) {
			expect(ms).toBeGreaterThanOrEqual(0);
			expect(ms).toBeLessThanOrEqual(jitterMs);
		}
		// Distinct delays observed (a SPREAD, not a fixed value) — at least two
		// distinct delays prove it is randomised, not constant.
		const distinct = new Set(first);
		expect(distinct.size).toBeGreaterThan(1);
		// NOT exponential `delay * 2`: for an LCG-driven sequence the values are
		// uncorrelated; explicitly assert no pair `i+1 === 2*i`. (Belt-and-braces;
		// the bound check above already rules out doubling past `jitterMs`.)
		const doubled = first.some(
			(ms, i) => i + 1 < first.length && first[i + 1] === ms * 2 && ms > 0,
		);
		expect(doubled).toBe(false);
	});

	it('jitterMs=0 ⇒ deterministic zero-delay schedule (the test fast-path; still bounded by the retry cap)', async () => {
		const {repo, seeded} = await seedStrandedWithFeatureFile('delta');
		advanceArbiterMain(seeded, 'persistent', 'persistent conflict\n');

		const sleeps: number[] = [];
		const cap = 2;
		await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'tasks-ready',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			env: gitEnv(),
			recoveryRebaseRetries: cap,
			recoveryRebaseJitterMs: 0,
			recoveryRebaseSleep: async (ms) => {
				sleeps.push(ms);
			},
		});
		// Zero-jitter: every delay is exactly 0; still bounded by the cap.
		expect(sleeps).toEqual([0, 0]);
	});
});
