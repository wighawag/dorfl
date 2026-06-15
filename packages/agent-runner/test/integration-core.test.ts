import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, readFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {createKeyedLock} from '../src/concurrency.js';
import type {ReviewGate, ReviewVerdict} from '../src/review-gate.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Unit tests for the SHARED gate→integrate back-half (`integration-core.ts`,
 * `performIntegration`) extracted out of `performComplete` (Slice 1 of the run/do
 * convergence). They drive the CORE DIRECTLY — proving it owns the band (verify
 * gate → review gate → effective-mode decision → done-move → commit → rebase →
 * integrate → needs-attention routing) and returns the right DATA for each
 * terminal outcome, independently of either caller's HEAD/TAIL.
 *
 * House style (mirrors `review-gate-pr.test.ts`): a throwaway checkout + a local
 * `--bare` arbiter + a STUBBED review gate (canned verdict — NO real model). The
 * `surfaceArbiter` here is left UNSET (the human-`complete` local-only routing),
 * so these failure paths route locally without writing `main`.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-integration-core-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';
const FAIL = 'exit 1';

/** A stubbed review gate returning a fixed verdict (no real model). */
function stubGate(verdict: ReviewVerdict): ReviewGate {
	return async () => verdict;
}
const APPROVE: ReviewVerdict = {verdict: 'approve', findings: []};
const BLOCK: ReviewVerdict = {
	verdict: 'block',
	findings: [
		{
			severity: 'blocking',
			question: 'the diff does not reach the slice goal',
			context: 'feature.txt',
		},
	],
};

/**
 * Stand a repo up exactly as the caller's HEAD leaves it just before the core:
 * a slice claimed (in-progress on the arbiter) and onboarded onto `work/<slug>`
 * off the freshly-pushed main, with UNCOMMITTED agent work in the tree.
 */
async function claimAndBranch(slug: string) {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	// Simulate the build agent: leave UNCOMMITTED work (it does no git).
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return {seeded, repo};
}

describe('integration-core — approve ⇒ completed', () => {
	it('green gate + (no review) ⇒ done-move + commit + integrate, returns completed + the integration result', async () => {
		const {repo} = await claimAndBranch('alpha');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(core.routedToNeedsAttention).toBe(false);
		expect(core.branch).toBe('work/slice-alpha');
		expect(core.commitMessage).toMatch(/^feat\(alpha\):.*; done$/);
		// The integration result carries the EFFECTIVE mode (the tail reads it here).
		expect(core.integration?.mode).toBe('propose');
		// The done-move happened in the tree (the band did the move + commit).
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			false,
		);
		expect(existsSync(join(repo, 'work', 'done', 'alpha.md'))).toBe(true);
		// propose pushed the work branch (the safety-bearing step), NOT main.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});

	it('green gate + review APPROVE + merge ⇒ lands on main (merge IS the auto-land mode, no downgrade)', async () => {
		const {repo} = await claimAndBranch('beta');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(APPROVE),
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		// approve + merge ⇒ merge proceeds (there is no downgrade to propose).
		expect(core.integration?.mode).toBe('merge');
		expect(core.integration?.mergedToMain).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(true);
	});

	it('green gate + review BLOCK + merge ⇒ does NOT land on main', async () => {
		const {repo} = await claimAndBranch('gamma');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(BLOCK),
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('review-blocked');
		expect(core.integration?.mergedToMain).not.toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'gamma')).toBe(false);
	});
});

describe('integration-core — UNTRUSTED-ORIGIN build clamp (untrusted-origin-forces-build-propose)', () => {
	// Stamp `originTrust` onto the in-progress slice the build is about to integrate
	// (the slicer would have propagated it; here we set it directly to drive the
	// clamp). The clamp reads it from `work/in-progress/<slug>.md`.
	const stampOriginTrust = (
		repo: string,
		slug: string,
		value: 'trusted' | 'untrusted',
	): void => {
		const path = join(repo, 'work', 'in-progress', `${slug}.md`);
		const content = readFileSync(path, 'utf8');
		writeFileSync(
			path,
			content.replace(/^---\n/, `---\norigin: issue\noriginTrust: ${value}\n`),
		);
	};

	it('an UNTRUSTED slice + mode merge + NO explicit flag ⇒ resolves to propose (a PR, NOT a merge to main)', async () => {
		const {repo} = await claimAndBranch('untrusted-merge');
		stampOriginTrust(repo, 'untrusted-merge', 'untrusted');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'untrusted-merge',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			// The build-transition config mode is `merge`, but no operator flag is present
			// (the autonomous/CI path). Untrusted-origin clamps it to propose.
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		// Clamped to propose: the work branch is pushed (PR source), main is NOT touched.
		expect(core.integration?.mode).toBe('propose');
		expect(core.integration?.mergedToMain).not.toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'untrusted-merge')).toBe(false);
	});

	it('an UNTRUSTED slice + explicit --merge (explicitMerge: true) ⇒ lands on main (the operator is present; CLI wins)', async () => {
		const {repo} = await claimAndBranch('untrusted-explicit');
		stampOriginTrust(repo, 'untrusted-explicit', 'untrusted');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'untrusted-explicit',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			// The operator EXPLICITLY typed --merge: it overrides the untrusted clamp.
			explicitMerge: true,
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(core.integration?.mode).toBe('merge');
		expect(core.integration?.mergedToMain).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'untrusted-explicit')).toBe(true);
	});

	it('a TRUSTED slice + mode merge ⇒ config as-is (lands on main; the clamp does not fire)', async () => {
		const {repo} = await claimAndBranch('trusted-merge');
		stampOriginTrust(repo, 'trusted-merge', 'trusted');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'trusted-merge',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(core.integration?.mode).toBe('merge');
		expect(existsOnArbiterMain(repo, 'done', 'trusted-merge')).toBe(true);
	});

	it('an UNSTAMPED slice + mode merge ⇒ config as-is (ZERO behaviour change for the normal human path)', async () => {
		const {repo} = await claimAndBranch('unstamped-merge');
		// No stamp (the normal local/human path).

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'unstamped-merge',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(core.integration?.mode).toBe('merge');
		expect(existsOnArbiterMain(repo, 'done', 'unstamped-merge')).toBe(true);
	});

	it('an UNTRUSTED slice + mode propose ⇒ propose (unchanged; the clamp only matters when config says merge)', async () => {
		const {repo} = await claimAndBranch('untrusted-propose');
		stampOriginTrust(repo, 'untrusted-propose', 'untrusted');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'untrusted-propose',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(core.integration?.mode).toBe('propose');
		expect(existsOnArbiterMain(repo, 'done', 'untrusted-propose')).toBe(false);
	});
});

describe('integration-core — prepare runs BEFORE verify (env-prep sequencing)', () => {
	it('a fresh worktree runs prepare THEN verify on the green path', async () => {
		const {repo} = await claimAndBranch('prep-alpha');
		const order = join(repo, 'order.log');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'prep-alpha',
			source: 'in-progress',
			recovering: false,
			// prepare appends `prepare`, verify appends `verify` — the file proves order.
			prepare: `echo prepare >> ${JSON.stringify(order)}`,
			verify: `echo verify >> ${JSON.stringify(order)}`,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(readFileSync(order, 'utf8').trim().split('\n')).toEqual([
			'prepare',
			'verify',
		]);
	});

	it('a FAILING prepare ⇒ prepare-failed, NEVER runs verify, routes to needs-attention', async () => {
		const {repo} = await claimAndBranch('prep-beta');
		const ranVerify = join(repo, 'verify-ran.txt');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'prep-beta',
			source: 'in-progress',
			recovering: false,
			prepare: 'exit 4',
			// If verify ever ran it would create this file — it must NOT.
			verify: `touch ${JSON.stringify(ranVerify)}`,
			mode: 'propose',
			env: gitEnv(),
		});

		// Distinct from gate-failed: a `prepare-failed` outcome + a message that names
		// env-prep, NOT the acceptance gate.
		expect(core.outcome).toBe('prepare-failed');
		expect(core.routedToNeedsAttention).toBe(true);
		expect(core.reason).toMatch(/prepare/i);
		expect(core.reason).not.toMatch(/acceptance gate failed/i);
		// verify NEVER ran (the env could not be made ready).
		expect(existsSync(ranVerify)).toBe(false);
		// Bounced from in-progress/ straight to needs-attention/, never done/.
		expect(existsSync(join(repo, 'work', 'in-progress', 'prep-beta.md'))).toBe(
			false,
		);
		expect(existsSync(join(repo, 'work', 'done', 'prep-beta.md'))).toBe(false);
		expect(
			existsSync(join(repo, 'work', 'needs-attention', 'prep-beta.md')),
		).toBe(true);
	});

	it('UNSET prepare ⇒ no-op: the green gate path is byte-for-byte unchanged', async () => {
		const {repo} = await claimAndBranch('prep-gamma');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'prep-gamma',
			source: 'in-progress',
			recovering: false,
			// prepare UNSET — a repo with no deps step is unaffected.
			verify: PASS,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(existsSync(join(repo, 'work', 'done', 'prep-gamma.md'))).toBe(true);
	});
});

describe('integration-core — red gate ⇒ gate-failed + routed', () => {
	it('routes to needs-attention (local-only, no surfaceArbiter) with the gate reason', async () => {
		const {repo} = await claimAndBranch('delta');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'in-progress',
			recovering: false,
			verify: FAIL,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('gate-failed');
		expect(core.routedToNeedsAttention).toBe(true);
		expect(core.branch).toBe('work/slice-delta');
		expect(core.reason).toMatch(/acceptance gate failed/i);
		// Bounced from in-progress/ straight to needs-attention/, never done/.
		expect(existsSync(join(repo, 'work', 'in-progress', 'delta.md'))).toBe(
			false,
		);
		expect(existsSync(join(repo, 'work', 'done', 'delta.md'))).toBe(false);
		expect(existsSync(join(repo, 'work', 'needs-attention', 'delta.md'))).toBe(
			true,
		);
		// Local-only (no surfaceArbiter): nothing surfaced on main.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'delta')).toBe(false);
	});
});

describe('integration-core — review block ⇒ review-blocked + routed', () => {
	it('a green gate then a BLOCK verdict routes to needs-attention, never integrates', async () => {
		const {repo} = await claimAndBranch('epsilon');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'epsilon',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			reviewGate: stubGate(BLOCK),
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('review-blocked');
		expect(core.routedToNeedsAttention).toBe(true);
		expect(core.branch).toBe('work/slice-epsilon');
		expect(core.reason).toMatch(/review.*blocked/i);
		expect(core.integration).toBeUndefined();
		// Routed to needs-attention/, never reached done/.
		expect(existsSync(join(repo, 'work', 'done', 'epsilon.md'))).toBe(false);
		const dest = join(repo, 'work', 'needs-attention', 'epsilon.md');
		expect(existsSync(dest)).toBe(true);
		// The blocking findings are recorded in the item body (WORK-CONTRACT rule 3).
		expect(readFileSync(dest, 'utf8')).toMatch(/does not reach the slice goal/);
	});
});

describe('integration-core — rebase conflict ⇒ rebase-conflict + routed', () => {
	it('aborts the rebase, routes the done-moved item to needs-attention with the conflict reason', async () => {
		const {seeded, repo} = await claimAndBranch('theta');
		// Our work edits README.md.
		writeFileSync(join(repo, 'README.md'), '# project\nour change\n');

		// Concurrently, another clone advances arbiter/main with a CONFLICTING edit.
		const other = seeded.clone('conflict');
		writeFileSync(join(other, 'README.md'), '# project\ntheir change\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'conflicting advance'], other);
		gitIn(['push', '-q', ARBITER, 'main:main'], other);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'theta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('rebase-conflict');
		expect(core.routedToNeedsAttention).toBe(true);
		expect(core.branch).toBe('work/slice-theta');
		expect(core.reason).toMatch(/conflict/i);
		// The commit was authored (done-move happened) before the rebase conflicted.
		expect(core.commitMessage).toMatch(/^feat\(theta\):.*; done$/);
		// The rebase was aborted (not mid-rebase).
		expect(existsSync(join(repo, '.git', 'rebase-merge'))).toBe(false);
		expect(existsSync(join(repo, '.git', 'rebase-apply'))).toBe(false);
		// The item moved on to needs-attention/ (it was in done/ after the move).
		expect(existsSync(join(repo, 'work', 'done', 'theta.md'))).toBe(false);
		const dest = join(repo, 'work', 'needs-attention', 'theta.md');
		expect(existsSync(dest)).toBe(true);
		expect(readFileSync(dest, 'utf8')).toMatch(/conflict/i);
		// Nothing landed on arbiter main.
		expect(existsOnArbiterMain(repo, 'done', 'theta')).toBe(false);
	});
});

describe('integration-core — per-repo INTEGRATE lock serialises the merge tail', () => {
	// The `run` concurrency-safety seam (slice
	// `run-merge-integration-concurrency-safe`). Two SAME-repo merge jobs branch off
	// the SAME pre-merge base and integrate CONCURRENTLY. The injected `integrateLock`
	// (the sibling of the claim lock, keyed per repo) wraps ONLY the rebase-to-
	// integrate TAIL, so the loser re-fetches + rebases onto the winner's now-advanced
	// `<arbiter>/main` INSIDE the lock before its own `${branch}:main` push. These
	// tests drive `performIntegration` DIRECTLY (the level where the base is
	// controllable and the race is deterministic), each job in its OWN checkout of the
	// SAME arbiter so the two genuinely contend on `main` (a single shared checkout
	// could not run two integrations at once).

	/**
	 * Seed ONE repo with two slugs and one bare arbiter, then stand BOTH jobs up in
	 * SEPARATE checkouts of that arbiter, each claimed + branched off the SAME
	 * `${ARBITER}/main` (the identical pre-merge base) with the supplied agent edit
	 * UNCOMMITTED. Returns the per-job cwds + the shared arbiter URL (the lock key).
	 */
	async function twoSameRepoMergeJobs(
		slugA: string,
		slugB: string,
		edit: (cwd: string, slug: string) => void,
	) {
		const seeded = seedRepoWithArbiter(scratch.root, [slugA, slugB]);
		const arbiterUrl = `file://${seeded.arbiter}`;
		// Claim BOTH slugs FIRST (each in its own checkout) so the arbiter main has
		// BOTH in-progress moves, THEN branch each job off that SAME final main — the
		// IDENTICAL pre-merge base. (The `run` tick cuts every worktree off a
		// freshly-fetched main that already carries all sibling in-progress moves; we
		// reproduce that here so the only divergence between the two jobs is their own
		// agent edit, not a stale ledger base.)
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
			gitIn(
				['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`],
				cwd,
			);
			edit(cwd, slug);
		};
		branchOne(cwdA, slugA);
		branchOne(cwdB, slugB);
		return {seeded, arbiterUrl, cwdA, cwdB};
	}

	const integrateMerge = (
		cwd: string,
		slug: string,
		lockKey: string,
		lock?: ReturnType<typeof createKeyedLock>,
		mergeRetries?: number,
	) =>
		performIntegration({
			cwd,
			arbiter: ARBITER,
			slug,
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			// `run` always surfaces failures on the arbiter (the autonomous variant);
			// the rebase-conflict loser routes to needs-attention ON main here.
			surfaceArbiter: ARBITER,
			integrateLock: lock,
			integrateLockKey: lockKey,
			// Race-1 bounded re-rebase-and-retry cap (default applies when undefined).
			// The control test passes `0` to disable BOTH the lock AND the retry.
			mergeRetries,
			env: gitEnv(),
		});

	it('two NON-CONFLICTING jobs (disjoint files) BOTH land deterministically under one shared lock', async () => {
		const {seeded, arbiterUrl, cwdA, cwdB} = await twoSameRepoMergeJobs(
			'pa',
			'pb',
			(cwd, slug) => writeFileSync(join(cwd, `${slug}.txt`), `work ${slug}\n`),
		);
		const lock = createKeyedLock();
		// Concurrent integration of both same-repo merge jobs under ONE shared lock,
		// keyed on the arbiter URL (the repo key). The loser rebases onto the winner's
		// advanced main; disjoint files ⇒ a clean fast-forward, so BOTH complete.
		const [a, b] = await Promise.all([
			integrateMerge(cwdA, 'pa', arbiterUrl, lock),
			integrateMerge(cwdB, 'pb', arbiterUrl, lock),
		]);
		expect(a.outcome).toBe('completed');
		expect(b.outcome).toBe('completed');
		// BOTH landed on the arbiter's main (deterministic, not timing-dependent).
		expect(existsOnArbiterMain(seeded.repo, 'done', 'pa')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'pb')).toBe(true);
	});

	it('two GENUINELY-CONFLICTING jobs (same file, different content) route EXACTLY ONE to needs-attention', async () => {
		const {seeded, arbiterUrl, cwdA, cwdB} = await twoSameRepoMergeJobs(
			'ca',
			'cb',
			(cwd, slug) => writeFileSync(join(cwd, 'shared.txt'), `work ${slug}\n`),
		);
		const lock = createKeyedLock();
		const [a, b] = await Promise.all([
			integrateMerge(cwdA, 'ca', arbiterUrl, lock),
			integrateMerge(cwdB, 'cb', arbiterUrl, lock),
		]);
		// Exactly ONE wins (lands on main); the loser rebases onto the winner's
		// advanced main, hits a real conflict on shared.txt, aborts, and routes to
		// needs-attention (rebase-conflict). They CANNOT both land.
		const outcomes = [a.outcome, b.outcome].sort();
		expect(outcomes).toEqual(['completed', 'rebase-conflict']);
		const winner = a.outcome === 'completed' ? 'ca' : 'cb';
		const loser = a.outcome === 'completed' ? 'cb' : 'ca';
		expect(existsOnArbiterMain(seeded.repo, 'done', winner)).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', loser)).toBe(false);
		expect(existsOnArbiterMain(seeded.repo, 'needs-attention', loser)).toBe(
			true,
		);
	});

	it('WITHOUT the lock AND WITHOUT the retry, two same-base concurrent merges do NOT both cleanly land (serialisation is load-bearing)', async () => {
		// The control: same disjoint-file jobs, but NO shared lock AND `mergeRetries:
		// 0` (the Race-1 re-rebase-and-retry DISABLED). Both rebase onto the SAME
		// stale pre-merge base (neither sees the other's merge), so both push
		// `${branch}:main`; the second push is non-fast-forward AND there is no retry
		// to recover it. The point is that the un-serialised, un-retried path is NOT a
		// clean both-land — at most one lands cleanly, proving SOME serialisation
		// mechanism (the lock OR the bounded retry, both exercised above/below) is
		// what makes the both-land deterministic.
		//
		// UPDATED (slice `run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe`):
		// before that slice the integrator did a single plain push, so dropping just the
		// lock sufficed to break both-land. The merge push now DEFAULTS to a bounded
		// re-rebase-and-retry (Race-1 fix), so to keep this control meaningful we ALSO
		// disable the retry (`mergeRetries: 0`) — otherwise the retry alone both-lands
		// (the `retry alone (no lock)` test below asserts exactly that new contract).
		const {seeded, arbiterUrl, cwdA, cwdB} = await twoSameRepoMergeJobs(
			'na',
			'nb',
			(cwd, slug) => writeFileSync(join(cwd, `${slug}.txt`), `work ${slug}\n`),
		);
		void arbiterUrl;
		// No lock passed (undefined) AND retry disabled (0) ⇒ the tail runs
		// un-serialised + un-retried, exactly like the pre-slice single-job caller.
		const settled = await Promise.allSettled([
			integrateMerge(cwdA, 'na', 'unused', undefined, 0),
			integrateMerge(cwdB, 'nb', 'unused', undefined, 0),
		]);
		const landed = ['na', 'nb'].filter((slug) =>
			existsOnArbiterMain(seeded.repo, 'done', slug),
		);
		// The un-serialised, un-retried path cannot deterministically land BOTH on
		// `main`: the loser's `${branch}:main` push is non-fast-forward against the
		// winner's advance and is NOT re-rebased.
		expect(landed.length).toBeLessThan(2);
		expect(settled).toHaveLength(2);
	});

	it('WITHOUT the lock but WITH the default retry, two same-base concurrent merges BOTH land (Race-1 bounded re-rebase-and-retry)', async () => {
		// Race 1 (claim-vs-integrate) fix proven WITHOUT the integrate lock: two
		// disjoint-file same-repo merge jobs both rebase onto the SAME stale base and
		// both push `${branch}:main`. The loser's push is non-fast-forward, but the
		// integrator's DEFAULT bounded re-rebase-and-retry re-fetches the winner's
		// advanced main, rebases onto it (disjoint files ⇒ clean), and retries — so
		// BOTH land deterministically WITHOUT serialising the tail. This is the
		// mechanism that closes the claim-vs-integrate race (a sibling CLAIM advances
		// main under the SEPARATE claim lock, which the integrate lock cannot cover).
		const {seeded, cwdA, cwdB} = await twoSameRepoMergeJobs(
			'ra',
			'rb',
			(cwd, slug) => writeFileSync(join(cwd, `${slug}.txt`), `work ${slug}\n`),
		);
		// NO lock (undefined); the DEFAULT retry (mergeRetries undefined ⇒ default cap).
		const [a, b] = await Promise.all([
			integrateMerge(cwdA, 'ra', 'unused', undefined),
			integrateMerge(cwdB, 'rb', 'unused', undefined),
		]);
		expect(a.outcome).toBe('completed');
		expect(b.outcome).toBe('completed');
		expect(existsOnArbiterMain(seeded.repo, 'done', 'ra')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', 'rb')).toBe(true);
	});

	it('the Race-1 retry still routes EXACTLY ONE conflicting job to needs-attention (never auto-resolves code)', async () => {
		// The retry only recovers a CLEAN re-rebase (a benign main-advance). Two jobs
		// editing the SAME file with DIFFERENT content: the loser's re-rebase onto the
		// winner's advanced main hits a GENUINE code conflict, aborts, and routes to
		// needs-attention — it CANNOT both-land. No lock; default retry.
		const {seeded, cwdA, cwdB} = await twoSameRepoMergeJobs(
			'xa',
			'xb',
			(cwd, slug) => writeFileSync(join(cwd, 'shared.txt'), `work ${slug}\n`),
		);
		const [a, b] = await Promise.all([
			integrateMerge(cwdA, 'xa', 'unused', undefined),
			integrateMerge(cwdB, 'xb', 'unused', undefined),
		]);
		const outcomes = [a.outcome, b.outcome].sort();
		expect(outcomes).toEqual(['completed', 'rebase-conflict']);
		const winner = a.outcome === 'completed' ? 'xa' : 'xb';
		const loser = a.outcome === 'completed' ? 'xb' : 'xa';
		expect(existsOnArbiterMain(seeded.repo, 'done', winner)).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'done', loser)).toBe(false);
		expect(existsOnArbiterMain(seeded.repo, 'needs-attention', loser)).toBe(
			true,
		);
	});
});

describe('integration-core — Race 2: sibling-slug ledger rebase reconciliation', () => {
	// Race 2 (slice `run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe`):
	// the step-4 `git rebase <arbiter>/main` can conflict on ANOTHER slug's
	// `work/<status>/<otherslug>.md` ledger file — a sibling same-repo job landed its
	// own status-folder move on main between our base and this rebase. A conflict
	// confined PURELY to other slugs' ledger files is benign (take the arbiter's
	// version, continue the rebase, the job lands), NOT a needs-attention route. A
	// conflict touching any CODE file or THIS slug's own ledger still routes.

	/**
	 * Build ONE repo (slugs `sa` + `sb`), claim `sa` so it is in-progress, and
	 * branch a `work/slice-sa` whose committed work BOTH does its own agent edit AND
	 * TOUCHES the named `touch` path with `branchContent` (the conflict surface).
	 * Then, on the arbiter's main, apply `landOnArbiter` (the divergent change to the
	 * SAME path). Returns the job cwd + repo so the caller drives `performIntegration`
	 * for `sa` and asserts the reconcile/route outcome.
	 */
	async function siblingLedgerConflictJob(opts: {
		touch: string;
		branchContent: string;
		landOnArbiter: (mainCwd: string) => void;
	}) {
		const seeded = seedRepoWithArbiter(scratch.root, ['sa', 'sb']);
		const repo = seeded.repo;
		// Claim BOTH so main carries both in-progress moves (the shared pre-merge base).
		for (const slug of ['sa', 'sb']) {
			const claim = await performClaim({
				slug,
				cwd: repo,
				arbiter: ARBITER,
				env: gitEnv(),
			});
			expect(claim.exitCode).toBe(0);
		}
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-sa', `${ARBITER}/main`], repo);
		// The build agent's work: its own code edit AND a touch of the conflict path,
		// committed on the work branch (the agent does no git, but to MANUFACTURE a
		// rebase conflict on the `touch` path we commit it here — `performIntegration`
		// adds the done-move on top).
		writeFileSync(join(repo, 'sa.txt'), 'work sa\n');
		const touchAbs = join(repo, opts.touch);
		writeFileSync(touchAbs, opts.branchContent);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'feat(sa): work + touch'], repo);

		// Concurrently, a sibling advances the arbiter's main with the DIVERGENT change
		// to the SAME path, via a throwaway clone (the checkout under test is untouched).
		const sib = seeded.clone('sibling');
		gitIn(['switch', '-q', '-c', 'sibling/main', `${ARBITER}/main`], sib);
		opts.landOnArbiter(sib);
		gitIn(['add', '-A'], sib);
		gitIn(['commit', '-q', '-m', 'sibling advance'], sib);
		gitIn(['push', '-q', ARBITER, 'sibling/main:main'], sib);

		return {seeded, repo};
	}

	it('a conflict confined to a SIBLING slug ledger file (work/done/sb.md) is reconciled and the job LANDS', async () => {
		const {seeded, repo} = await siblingLedgerConflictJob({
			// Our branch modifies the SIBLING's in-progress ledger (a benign touch).
			touch: 'work/in-progress/sb.md',
			branchContent: 'sb ledger — our branch view\n',
			// The arbiter MOVES sb from in-progress to done with different content (the
			// sibling job's done-move): replaying our touch onto it conflicts on sb's
			// ledger ONLY — a benign sibling-ledger divergence.
			landOnArbiter: (mainCwd) => {
				mkdirSync(join(mainCwd, 'work', 'done'), {recursive: true});
				gitIn(['mv', 'work/in-progress/sb.md', 'work/done/sb.md'], mainCwd);
				writeFileSync(
					join(mainCwd, 'work', 'done', 'sb.md'),
					'sb ledger — arbiter (sibling done-move)\n',
				);
			},
		});

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'sa',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		// The sibling-ledger conflict was reconciled (arbiter's sb ledger taken, rebase
		// continued): sa LANDS, NOT routed to needs-attention.
		expect(core.outcome).toBe('completed');
		expect(core.routedToNeedsAttention).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'sa')).toBe(true);
		// The sibling's ledger ended at the ARBITER's version (sb in done/, not our
		// in-progress touch): sb's own done-move was honoured, not clobbered.
		expect(existsOnArbiterMain(repo, 'done', 'sb')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'sb')).toBe(false);
		void seeded;
	});

	it('a conflict touching a CODE file still routes to needs-attention (the reconcile NEVER widens to code)', async () => {
		const {repo} = await siblingLedgerConflictJob({
			// Our branch and the arbiter both edit a CODE file with different content.
			touch: 'shared-code.txt',
			branchContent: 'code — our branch\n',
			landOnArbiter: (mainCwd) => {
				writeFileSync(join(mainCwd, 'shared-code.txt'), 'code — arbiter\n');
			},
		});

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'sa',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		// A code conflict is NEVER auto-resolved: sa routes to needs-attention.
		expect(core.outcome).toBe('rebase-conflict');
		expect(existsOnArbiterMain(repo, 'done', 'sa')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'sa')).toBe(true);
	});

	it('a conflict on THIS slug OWN ledger still routes to needs-attention (sibling arm excludes own ledger)', async () => {
		// Our branch touches our OWN in-progress ledger; the arbiter independently
		// edits the same own-ledger file. The sibling arm explicitly EXCLUDES our own
		// ledger, so this falls through to the divergent-done-move / needs-attention
		// route (it is NOT the divergent-base case the #86 recovery handles, since the
		// arbiter still holds sa in in-progress — the same folder we move from).
		const {repo} = await siblingLedgerConflictJob({
			touch: 'work/in-progress/sa.md',
			branchContent: 'sa ledger — our branch view\n',
			landOnArbiter: (mainCwd) => {
				writeFileSync(
					join(mainCwd, 'work', 'in-progress', 'sa.md'),
					'sa ledger — arbiter view\n',
				);
			},
		});

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'sa',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		// Own-ledger conflict is NOT a sibling-ledger reconcile: it routes.
		expect(core.outcome).toBe('rebase-conflict');
		expect(existsOnArbiterMain(repo, 'done', 'sa')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'sa')).toBe(true);
	});
});
