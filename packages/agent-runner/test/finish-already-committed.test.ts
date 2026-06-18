import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
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
 * The `finish-already-committed-branch` slice (PRD
 * `work/prd-sliced/ledger-integrity.md` story 6, defect 4): a first-class way to
 * FINISH an already-committed, already-done-moved stranded work branch.
 *
 * When a terminal push fails AFTER the done-move + commit (steps 2–3 of
 * `performIntegration`), the work is stranded in this state:
 *   - `work/done/<slug>.md` PRESENT on the branch; in-progress/needs-attention
 *     ABSENT (the done-move already ran);
 *   - the green work ALREADY committed on `work/slice-<slug>` (`…; done`), tip
 *     NOT on the arbiter.
 * Running plain `complete` against it REFUSES (`IntegrationNothingStaged` — the
 * done-move + commit already happened, so nothing is left to stage). This slice
 * adds the recover-already-committed path to the SHARED integration core: skip
 * steps 2–3, run ONLY the rebase→integrate tail (steps 4–5) from the kept commit.
 *
 * SAFETY: the detection is UNSPOOFABLE — before acting it verifies the tip is
 * genuinely AHEAD of `<arbiter>/main` (`isAncestor`); an already-integrated slice
 * is a clean no-op, NEVER a re-push/double-integrate.
 *
 * House style (mirrors `atomic-done-move.test.ts` / `complete-from-needs-attention`):
 * a throwaway checkout + a local `--bare` arbiter, `gitEnv()` isolation, temp
 * shared dirs untouched.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-finish-already-committed-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

/**
 * Stand a repo up EXACTLY as a terminal push failure AFTER the done-move + commit
 * leaves it: claimed, branched onto `work/slice-<slug>`, the agent's work
 * committed, the slice `git mv`'d `backlog/ → done/` and committed (`…; done`),
 * but the tip NOT pushed (the strand). The arbiter still holds the slug in
 * `backlog/` (claim published nothing to main; the body rests there); the tip is
 * genuinely AHEAD of `<arbiter>/main`.
 */
async function seedStrandedCommittedDone(
	slug: string,
): Promise<{repo: string; seeded: SeededRepo; tip: string}> {
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

	// The agent's work, committed (it was swept into the would-be done commit).
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	// The done-move + commit already happened (steps 2–3), as the integration
	// core does just before the push that then failed terminally.
	mkdirSync(join(repo, 'work', 'done'), {recursive: true});
	gitIn(['mv', `work/backlog/${slug}.md`, `work/done/${slug}.md`], repo);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `feat(${slug}): build the thing; done`], repo);

	// Pre-conditions: done/ present on the branch, backlog/ gone locally; the
	// tip is NOT on the arbiter (the push failed), so the arbiter still has
	// the body in backlog/.
	expect(existsSync(join(repo, 'work', 'done', `${slug}.md`))).toBe(true);
	expect(existsSync(join(repo, 'work', 'backlog', `${slug}.md`))).toBe(false);
	expect(existsOnArbiterMain(repo, 'backlog', slug)).toBe(true);
	expect(existsOnArbiterMain(repo, 'done', slug)).toBe(false);
	const tip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	return {repo, seeded, tip};
}

describe('finish-already-committed — recover a stranded committed-but-unpushed done branch', () => {
	it('integrates from the kept commit (merge): work lands on the arbiter, done/ ONLY, no in-progress ghost', async () => {
		const {repo, tip} = await seedStrandedCommittedDone('alpha');

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			source: 'backlog',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		// The work landed on the arbiter's main.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		// The agent's work landed too (carried by the kept commit — NO rebuild).
		expect(gitIn(['show', `${ARBITER}/main:feature.txt`], repo).trim()).toBe(
			'the work',
		);
		// It integrated from the EXACT kept commit (no rebuild, no orphan branch):
		// the tip is reachable on the arbiter's main now.
		const base = gitIn(['merge-base', tip, `${ARBITER}/main`], repo).trim();
		expect(base).toBe(tip);
	});

	it('does NOT re-do the done-move or re-commit: the kept commit is the integrated one', async () => {
		const {repo, tip} = await seedStrandedCommittedDone('beta');

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'backlog',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		// The branch tip is unchanged (a clean fast-forwardable rebase added no new
		// commit — the work was already committed). The arbiter main == the tip.
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).toBe(tip);
	});

	it('propose mode: pushes the kept branch with the done-move (no rebuild)', async () => {
		const {repo} = await seedStrandedCommittedDone('gamma');

		const result = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'backlog',
			recovering: false,
			committedRecovery: true,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		// propose pushes the branch carrying the done-move.
		const onBranch = gitIn(
			['show', `${ARBITER}/work/slice-gamma:work/done/gamma.md`],
			repo,
		);
		expect(onBranch).toMatch(/thing/i);
	});
});

describe('finish-already-committed — unspoofable detection (already-integrated no-op)', () => {
	it('a slice whose tip is ALREADY on the arbiter is a clean no-op, NOT a re-integration', async () => {
		// First strand + recover (lands on the arbiter).
		const {repo, tip} = await seedStrandedCommittedDone('delta');
		const first = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'backlog',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			// Stay on the branch so a re-run sees the same tip (no switch tail here —
			// the core does no switch; that is the caller's tail).
			env: gitEnv(),
		});
		expect(first.outcome).toBe('completed');
		const arbiterMainAfterFirst = gitIn(
			['rev-parse', `${ARBITER}/main`],
			repo,
		).trim();
		expect(arbiterMainAfterFirst).toBe(tip);

		// Re-run the recovery: the tip is now reachable on <arbiter>/main, so it is
		// already integrated → a clean no-op, never a double-integrate.
		const second = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'backlog',
			recovering: false,
			committedRecovery: true,
			mode: 'merge',
			env: gitEnv(),
		});
		expect(second.outcome).toBe('already-integrated');
		// The arbiter main did NOT move (no re-push / double-integrate).
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).toBe(
			arbiterMainAfterFirst,
		);
	});
});
