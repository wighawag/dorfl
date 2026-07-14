import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {returnToBacklog} from '../src/needs-attention.js';
import {performClaim} from '../src/claim-cas.js';
import {markStuckItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * Task: `default-requeue-succeeds-when-no-work-branch-exists`.
 *
 * The default (non-`--reset`) requeue used to REFUSE when
 * `<arbiter>/work/task-<slug>` did not exist on the arbiter, nudging humans to
 * pass the destructive `--reset` verb to do the harmless thing (move a
 * branch-less `.md` from needs-attention back to backlog). The safety guard's
 * job is to protect a REAL continue-branch a future worker would resume from —
 * when there is no such branch (never pushed, or a prior `--reset` already
 * deleted it), the precondition is vacuously satisfied and the guard should
 * degrade gracefully to the same effective outcome as `--reset` (nothing to
 * discard), NOT force the caller into a destructive verb.
 *
 * These tests pin the softened guard: (1) missing arbiter branch → default
 * requeue succeeds; (2) arbiter branch EXISTS but is not ahead of main → still
 * refuses (the real anomaly the guard was written for); (3) `--reset` with a
 * branch already gone → unchanged tolerance.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-requeue-nowb-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Drive a task to lock-stuck (needs-attention) WITHOUT ever pushing a work
 * branch to the arbiter — the "no arbiter continue-branch" fixture: claim,
 * route to needs-attention through the seam (the surface is the stuck lock,
 * not a folder file), sync local main to the surfaced main. There is NO
 * `work/task-<slug>` on the arbiter afterwards (the build agent never got as
 * far as pushing one — or a prior `--reset` deleted it).
 */
async function stuckWithNoArbiterBranch(
	slug: string,
): Promise<{seeded: SeededRepo; repo: string}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	// Seed a STUCK lock directly (PR-2b retired the bounce's `active → stuck`
	// amend; a bounce now surfaces + RELEASES the lock).
	await markStuckItemLock({
		item: `task:${slug}`,
		reason: 'gate red before any push',
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	return {seeded, repo};
}

/** The arbiter's sha for `refs/heads/<branch>`, or '' when absent. */
function arbiterBranchTip(seeded: SeededRepo, branch: string): string {
	const out = gitIn(
		['ls-remote', `file://${seeded.arbiter}`, `refs/heads/${branch}`],
		seeded.repo,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

describe('requeue default — no work branch on the arbiter', () => {
	it('SUCCEEDS (nothing to continue from; no --reset needed) and releases the lock', async () => {
		const {seeded, repo} = await stuckWithNoArbiterBranch('no-branch-slug');
		// Precondition: the arbiter has NO `work/task-<slug>` branch (never pushed).
		expect(arbiterBranchTip(seeded, 'work/task-no-branch-slug')).toBe('');

		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'no-branch-slug',
			arbiter: ARBITER,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		// The move happened (per the current per-item-lock state model: body is in
		// backlog, the held stuck lock is RELEASED so the item is claimable).
		expect(result.moved).toBe(true);
		expect(result.reasonNotMoved).toBeUndefined();
		expect(existsOnArbiterMain(repo, 'backlog', 'no-branch-slug')).toBe(true);
		expect(stuckLockOnArbiter(repo, 'no-branch-slug')).toBe(false);
		// A legible note explains the degraded-to-fresh transition (no scary
		// "push it first, or `requeue --reset`" refusal).
		expect(notes.some((m) => /has no work branch on/i.test(m))).toBe(true);
		expect(
			notes.some((m) => /push it first, or `requeue --reset`/.test(m)),
		).toBe(false);
		// The arbiter still has no such branch (nothing was force-deleted; there
		// was nothing to delete).
		expect(arbiterBranchTip(seeded, 'work/task-no-branch-slug')).toBe('');
	});
});

describe('requeue default — arbiter branch EXISTS but is not ahead of main (real anomaly)', () => {
	it('REFUSES with the existing guard (protects a real continue-branch)', async () => {
		const {seeded, repo} = await stuckWithNoArbiterBranch('flat-branch-slug');
		// Push a `work/task-<slug>` whose tip IS `<arbiter>/main` (no commits
		// beyond main): the branch EXISTS but is NOT ahead — the exact anomaly the
		// guard exists for (a worker resuming from a state already on main).
		const mainSha = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		gitIn(
			[
				'push',
				'-q',
				ARBITER,
				`${mainSha}:refs/heads/work/task-flat-branch-slug`,
			],
			repo,
		);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(arbiterBranchTip(seeded, 'work/task-flat-branch-slug')).not.toBe('');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'flat-branch-slug',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(
			/isn't on arbiter.*push it first, or `requeue --reset`/s,
		);
		// The lock is STILL held stuck (nothing was released — this is the guard's
		// point when there IS a branch to protect). The stuck lock is the direct seed
		// (`markStuckItemLock`), so we assert it directly.
		expect(stuckLockOnArbiter(repo, 'flat-branch-slug')).toBe(true);
	});
});

describe('requeue --reset — branch already gone', () => {
	it('tolerates "remote ref does not exist" and completes the requeue', async () => {
		const {seeded, repo} = await stuckWithNoArbiterBranch('reset-gone-slug');
		expect(arbiterBranchTip(seeded, 'work/task-reset-gone-slug')).toBe('');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'reset-gone-slug',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		expect(result.reasonNotMoved).toBeUndefined();
		expect(existsOnArbiterMain(repo, 'backlog', 'reset-gone-slug')).toBe(true);
		expect(stuckLockOnArbiter(repo, 'reset-gone-slug')).toBe(false);
		expect(arbiterBranchTip(seeded, 'work/task-reset-gone-slug')).toBe('');
	});
});
