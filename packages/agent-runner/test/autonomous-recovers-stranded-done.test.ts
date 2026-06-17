import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * The `autonomous-path-auto-recovers-already-committed-stranded-branch` slice
 * (PRD `ledger-integrity` story 6/7): when the AUTONOMOUS integration path
 * (`do` / `advance` / plain `complete`) hits a re-claimed slug whose work branch
 * was already built + done-moved by a prior run but never landed on the arbiter,
 * it must NOT crash with `nothing to complete`. Instead it routes into the
 * SHARED `recoverAlreadyCommitted` tail (the same one `complete --isolated` uses),
 * reusing the existing capability.
 *
 * SAFETY (the test surface):
 *   (a) pre-built + done-moved branch, tip AHEAD of `<arbiter>/main` ⇒ integrates
 *       the kept commit (no rebuild / orphan branch / `--force`);
 *   (b) kept tip ALREADY on `<arbiter>/main` ⇒ clean `already-integrated` no-op,
 *       NEVER a second push or re-integration;
 *   (c) genuinely nothing present on the branch ⇒ existing honest `CompleteRefusal`
 *       (exit 1, `refused`) preserved;
 *   (d) a LOUD recovery note fires (so the CI/job log records that the autonomous
 *       path took the recovery branch).
 *
 * House style mirrors `finish-already-committed.test.ts`: throwaway checkout +
 * local `--bare` arbiter, `gitEnv()` isolation, no shared/global locations touched.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-auto-recover-stranded-done-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Stand the repo up EXACTLY as the CI incident left it: the slug was claimed
 * (so `work/in-progress/<slug>.md` was published on the arbiter), the work was
 * built + committed + done-moved on the work branch (so the BRANCH tree holds
 * `work/done/<slug>.md` and NOT `work/in-progress/<slug>.md`), but the tip was
 * NEVER pushed / merged — it is genuinely AHEAD of `<arbiter>/main`. HEAD is on
 * the work branch (where the autonomous integrate path runs).
 */
async function seedStrandedDoneBranch(
	slug: string,
): Promise<{repo: string; seeded: SeededRepo; tip: string; branch: string}> {
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
	const branch = `work/slice-${slug}`;
	gitIn(['switch', '-q', '-c', branch, `${ARBITER}/main`], repo);

	// The agent's work + the done-move + commit (steps 2–3 of the build path).
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	mkdirSync(join(repo, 'work', 'done'), {recursive: true});
	gitIn(['mv', `work/in-progress/${slug}.md`, `work/done/${slug}.md`], repo);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${slug}): build the thing; done`], repo);

	// Sanity: the branch tree has done/ and lacks in-progress/needs-attention;
	// the arbiter still holds in-progress/ (the claim landed) and not done/.
	expect(existsSync(join(repo, 'work', 'done', `${slug}.md`))).toBe(true);
	expect(existsSync(join(repo, 'work', 'in-progress', `${slug}.md`))).toBe(
		false,
	);
	expect(existsSync(join(repo, 'work', 'needs-attention', `${slug}.md`))).toBe(
		false,
	);
	expect(existsOnArbiterMain(repo, 'in-progress', slug)).toBe(true);
	expect(existsOnArbiterMain(repo, 'done', slug)).toBe(false);
	const tip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	return {repo, seeded, tip, branch};
}

describe('autonomous integrate path — auto-recovers a stranded already-complete branch', () => {
	it('CI repro: re-claimed already-built+done-moved branch integrates the kept commit (no rebuild/orphan/force, no `nothing to complete` crash)', async () => {
		const {repo, tip, branch} = await seedStrandedDoneBranch('alpha');
		const notes: string[] = [];

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// The work landed on the arbiter's main from the KEPT commit (no rebuild).
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		expect(gitIn(['show', `${ARBITER}/main:feature.txt`], repo).trim()).toBe(
			'the work',
		);
		// The EXACT kept commit is what integrated (the rebase fast-forwards on a
		// clean base, so the tip is unchanged and now reachable on the arbiter).
		const base = gitIn(['merge-base', tip, `${ARBITER}/main`], repo).trim();
		expect(base).toBe(tip);
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).toBe(tip);
		// Branch was provably-on-arbiter so the tail deleted it locally.
		expect(result.branch).toBe(branch);
		expect(result.deletedLocalBranch).toBe(true);
		// LOUD recovery announcement fired (front-gate detection), distinct from a
		// normal completion message.
		expect(
			notes.some((n) =>
				/recovered a stranded already-complete branch for 'alpha'/.test(n),
			),
		).toBe(true);
	});

	it('already-integrated ⇒ clean no-op: kept tip already on <arbiter>/main, NO re-push, NO double-integrate', async () => {
		const {repo, tip} = await seedStrandedDoneBranch('beta');

		// First run: recover + integrate.
		const first = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			// Keep the operator ON the work branch so the re-run sees the SAME tip
			// (the tail otherwise switches to main + deletes the branch).
			noSwitch: true,
			env: gitEnv(),
			note: () => {},
		});
		expect(first.exitCode).toBe(0);
		expect(first.outcome).toBe('completed');
		const arbiterMainAfterFirst = gitIn(
			['rev-parse', `${ARBITER}/main`],
			repo,
		).trim();
		expect(arbiterMainAfterFirst).toBe(tip);

		// Re-run the autonomous path on the same stranded-shaped branch: the tip is
		// now reachable on `<arbiter>/main`, so the unspoofable `isAncestor` check
		// in `recoverAlreadyCommitted` returns `already-integrated`. The autonomous
		// caller maps that to a successful, non-crashing no-op.
		const notes: string[] = [];
		const second = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			noSwitch: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(second.exitCode).toBe(0);
		expect(second.outcome).toBe('already-integrated');
		// Arbiter main did NOT move (no second integrate).
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).toBe(
			arbiterMainAfterFirst,
		);
		// The core's honest already-integrated note fired.
		expect(notes.some((n) => /already integrated/i.test(n))).toBe(true);
	});

	it('honest refusal preserved: genuinely-nothing-on-the-branch ⇒ existing CompleteRefusal (exit 1, `refused`)', async () => {
		// Seed + claim — but DO NOT done-move; instead delete in-progress/ from the
		// branch tree (so neither in-progress/ NOR needs-attention/ NOR done/ holds
		// the slug on the branch). The autonomous path must STILL refuse honestly:
		// the auto-recover must never mask a real wrong-slug / nothing-staged error.
		const seeded = seedRepoWithArbiter(scratch.root, ['gamma']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-gamma', `${ARBITER}/main`], repo);
		// Remove the in-progress slice from the branch tree WITHOUT moving it to
		// done/ — the "genuinely nothing here" state.
		gitIn(['rm', '-q', 'work/in-progress/gamma.md'], repo);
		gitIn(['commit', '-q', '-m', 'drop the slice (genuinely nothing)'], repo);
		expect(existsSync(join(repo, 'work', 'in-progress', 'gamma.md'))).toBe(
			false,
		);
		expect(existsSync(join(repo, 'work', 'done', 'gamma.md'))).toBe(false);

		const result = await performComplete({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			env: gitEnv(),
			note: () => {},
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/nothing to complete/i);
	});
});
