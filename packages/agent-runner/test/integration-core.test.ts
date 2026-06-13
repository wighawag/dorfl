import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
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

	it('green gate + review APPROVE + autoMerge on + merge ⇒ effective mode stays merge (no downgrade)', async () => {
		const {repo} = await claimAndBranch('beta');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			autoMerge: true,
			reviewGate: stubGate(APPROVE),
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		// approve + autoMerge ON + merge ⇒ merge proceeds (no downgrade).
		expect(core.integration?.mode).toBe('merge');
		expect(core.integration?.mergedToMain).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(true);
	});

	it('green gate + review APPROVE + autoMerge OFF + merge ⇒ effective mode DOWNGRADES to propose (verbatim)', async () => {
		const {repo} = await claimAndBranch('gamma');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			review: true,
			autoMerge: false,
			reviewGate: stubGate(APPROVE),
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		// The core owns the autoMerge-off `merge`→`propose` downgrade: a human merges.
		expect(core.integration?.mode).toBe('propose');
		expect(core.integration?.mergedToMain).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'gamma')).toBe(false);
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
