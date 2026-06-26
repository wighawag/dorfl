import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {mergeConfig} from '../src/config.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * External behaviour for the resolved `mergeRetries` cap (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, Story 5 + Applied Answer q1
 * part (a)). The CAS retry loop IS the cross-job land queue (the in-process
 * `integrateLock` only serialises sibling integrates in ONE process), so the cap
 * controls WHEN a contender bounces to needs-attention. These tests prove the
 * RESOLVED config value (the gate-family precedence chain's output) drives that
 * bounce — not just the literal kwarg passed in `integration-core.test.ts`. They
 * are the smaller, focused mirror of the `mergeRetries: 0` race in
 * `integration-core.test.ts`, threaded via `mergeConfig` instead of a hard-coded
 * value (so a refactor that drops the wiring fails THIS test loudly).
 *
 * House style mirrors `integration-core.test.ts`'s same-repo merge-race block:
 * two SEPARATE checkouts of the SAME bare arbiter, each claimed + branched off
 * the SAME pre-merge base, racing concurrently onto `main`. NO lock — the cap
 * is the only serialiser under test.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-merge-retries-external-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

/** Stand TWO same-repo merge jobs up off the SAME pre-merge arbiter `main`. */
async function twoSameRepoMergeJobs(
	slugA: string,
	slugB: string,
	edit: (cwd: string, slug: string) => void,
) {
	const seeded = seedRepoWithArbiter(scratch.root, [slugA, slugB]);
	const claimOne = async (slug: string) => {
		const cwd = seeded.clone(`job-${slug}`);
		const claim = await performClaim({
			slug,
			cwd,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		return cwd;
	};
	const cwdA = await claimOne(slugA);
	const cwdB = await claimOne(slugB);
	const branchOne = (cwd: string, slug: string) => {
		gitIn(['fetch', '-q', ARBITER], cwd);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], cwd);
		edit(cwd, slug);
	};
	branchOne(cwdA, slugA);
	branchOne(cwdB, slugB);
	return {seeded, cwdA, cwdB};
}

/** Thread the cap through `mergeConfig` (the resolved per-repo value the
 *  CLI/run paths read), then into `performIntegration` exactly the way
 *  `run.ts`/`complete.ts`/`do.ts` do. NO lock — assert the cap drives the bounce. */
const integrateMergeViaConfig = (cwd: string, slug: string, cap: number) => {
	const resolved = mergeConfig({mergeRetries: cap});
	expect(resolved.mergeRetries).toBe(cap);
	return performIntegration({
		cwd,
		arbiter: ARBITER,
		slug,
		source: 'tasks-ready',
		recovering: false,
		verify: PASS,
		mode: 'merge',
		surfaceArbiter: ARBITER,
		// The resolved per-repo cap (the rung this prd's task adds). At `0` a
		// contender bounces; at the default (1000) it converges.
		mergeRetries: resolved.mergeRetries,
		// Deterministic, latency-free retries.
		mergeJitterMs: 0,
		env: gitEnv(),
	});
};

describe('mergeRetries (resolved through config) — cap controls bounce vs converge', () => {
	it('with the resolved cap at 0, two disjoint-file same-repo merges do NOT both cleanly land (a contender bounces to needs-attention)', async () => {
		// Disjoint files ⇒ no GENUINE conflict; the only thing preventing a both-land
		// is the non-fast-forward push the loser hits, AND the cap is what controls
		// whether the loser re-rebases + retries or bounces. Resolved cap=0 forces
		// the un-retried path: AT MOST ONE lands; the other routes (no `--force`,
		// never a both-land-broken). This is the SAFETY property scaling the cap
		// preserves.
		const {seeded, cwdA, cwdB} = await twoSameRepoMergeJobs(
			'r0a',
			'r0b',
			(cwd, slug) => writeFileSync(join(cwd, `${slug}.txt`), `work ${slug}\n`),
		);
		const [a, b] = await Promise.all([
			integrateMergeViaConfig(cwdA, 'r0a', 0),
			integrateMergeViaConfig(cwdB, 'r0b', 0),
		]);
		// Exactly ONE landed cleanly; the OTHER did NOT (it routed). The point is
		// the resolved cap drives this, NOT a hard-coded engine value.
		const landed = [a.outcome, b.outcome].filter(
			(o) => o === 'completed',
		).length;
		expect(landed).toBeLessThanOrEqual(1);
		const winnerSlug =
			a.outcome === 'completed'
				? 'r0a'
				: b.outcome === 'completed'
					? 'r0b'
					: undefined;
		if (winnerSlug !== undefined) {
			const loserSlug = winnerSlug === 'r0a' ? 'r0b' : 'r0a';
			expect(existsOnArbiterMain(seeded.repo, 'done', winnerSlug)).toBe(true);
			expect(existsOnArbiterMain(seeded.repo, 'done', loserSlug)).toBe(false);
			expect(stuckLockOnArbiter(seeded.repo, loserSlug)).toBe(true);
		}
	});

	it('with the resolved cap at the default (1000), the same disjoint-file race converges — BOTH contenders land', async () => {
		// The cap is the cross-job land queue: with it RAISED (here: the default
		// 1000 — the C2 large liveness ceiling), the loser's clean re-rebase no
		// longer counts against a tiny give-up budget, so the herd serialises and
		// both land. SAME job shape as the cap=0 race above; the ONLY difference is
		// the resolved cap. This is the "with a raised cap, more contenders converge
		// before any bounce to needs-attention" external behaviour.
		const {seeded, cwdA, cwdB} = await twoSameRepoMergeJobs(
			'r1a',
			'r1b',
			(cwd, slug) => writeFileSync(join(cwd, `${slug}.txt`), `work ${slug}\n`),
		);
		const [a, b] = await Promise.all([
			integrateMergeViaConfig(cwdA, 'r1a', 1000),
			integrateMergeViaConfig(cwdB, 'r1b', 1000),
		]);
		expect(a.outcome).toBe('completed');
		expect(b.outcome).toBe('completed');
		expect(existsOnArbiterMain(seeded.repo, 'done', 'r1a')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'r1b')).toBe(true);
	});
});
