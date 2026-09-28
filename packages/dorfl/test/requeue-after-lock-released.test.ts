import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {
	returnToBacklog,
	surfaceStuckToNeedsAttention,
} from '../src/needs-attention.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	heldLockOnArbiter,
	sidecarSurfacedOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * Task: `requeue-reset-and-reconcile-work-after-the-lock-was-released`. A
 * SURFACE (`surfaceStuckToNeedsAttention`) releases the per-item lock after it
 * lands the question sidecar, so a surfaced item with a kept work branch has NO
 * held lock. `requeue --reset` and `requeue --reconcile` must still act on it
 * (taking a short lock of their own), while plain `requeue` stays a no-op and
 * the refusal for a truly unknown slug is unchanged. Tested against a local
 * `--bare` arbiter.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-requeue-released-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** The arbiter's sha for a full ref, or '' when absent. */
function arbiterRef(seeded: SeededRepo, ref: string): string {
	const out = gitIn(
		['ls-remote', `file://${seeded.arbiter}`, ref],
		seeded.repo,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

/**
 * Claim `slug`, push a prior attempt's `work/task-<slug>` to the arbiter, then
 * SURFACE it through the real surface primitive (sidecar + `needsAnswers`, lock
 * RELEASED). Optionally move `main` afterwards (non-conflicting, or conflicting
 * on the same file the branch edited).
 */
async function surfacedWithKeptBranch(
	slug: string,
	opts: {mainMoves?: boolean; mainConflicts?: boolean} = {},
): Promise<{seeded: SeededRepo; repo: string; priorTip: string}> {
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
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(
		join(repo, opts.mainConflicts ? 'shared.txt' : 'prior.txt'),
		'prior attempt work\n',
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	const priorTip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	gitIn(['push', '-q', ARBITER, `work/task-${slug}:work/task-${slug}`], repo);
	gitIn(['switch', '-q', '--detach', `${ARBITER}/main`], repo);

	const surfaced = await surfaceStuckToNeedsAttention({
		cwd: repo,
		slug,
		reason: 'continue rebase conflicted',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(surfaced.surfaced).toBe(true);
	expect(surfaced.released).toBe(true);
	// The motivating state: surfaced, lock RELEASED, kept branch on the arbiter.
	expect(heldLockOnArbiter(repo, slug)).toBe(false);
	expect(sidecarSurfacedOnArbiterMain(repo, slug)).toBe(true);
	expect(arbiterRef(seeded, `refs/heads/work/task-${slug}`)).toBe(priorTip);

	if (opts.mainMoves) {
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		if (opts.mainConflicts) {
			writeFileSync(join(mover, 'shared.txt'), 'main version\n');
		} else {
			writeFileSync(join(mover, 'mainmoved.txt'), 'main moved\n');
		}
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved after the surface'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);
	}
	return {seeded, repo, priorTip};
}

describe('requeue --reset on a surfaced item whose lock the surface already released', () => {
	it('deletes the kept remote branch and leaves the item claimable from scratch', async () => {
		const {seeded, repo} = await surfacedWithKeptBranch('alpha');

		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.moved).toBe(true);
		expect(result.deletedRemoteBranch).toBe(true);
		expect(notes.join('\n')).toMatch(/short lock/);
		// The kept branch is GONE on the arbiter.
		expect(arbiterRef(seeded, 'refs/heads/work/task-alpha')).toBe('');
		// The short lock the recovery took is released; the body rests in the pool.
		expect(heldLockOnArbiter(repo, 'alpha')).toBe(false);
		expect(
			await readItemLock({
				item: 'task:alpha',
				cwd: repo,
				arbiter: ARBITER,
				env: gitEnv(),
			}),
		).toBeUndefined();
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);

		// The next claim starts FRESH: nothing of the prior attempt is carried over.
		const fresh = seeded.clone('fresh');
		const started = await performStart({
			slug: 'alpha',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(false);
	});
});

describe('requeue --reconcile on a surfaced item whose lock the surface already released', () => {
	it('re-syncs and retries the rebase, pushing the reconciled tip back without discarding work', async () => {
		const {seeded, repo, priorTip} = await surfacedWithKeptBranch('bravo', {
			mainMoves: true,
		});

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'bravo',
			arbiter: ARBITER,
			reconcile: true,
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		expect(result.reconciled).toBe(true);
		expect(result.deletedRemoteBranch).toBeFalsy();
		// The kept branch is PRESERVED, rebased onto the moved main.
		const afterWork = arbiterRef(seeded, 'refs/heads/work/task-bravo');
		expect(afterWork).not.toBe('');
		expect(afterWork).not.toBe(priorTip);
		const mainTip = arbiterRef(seeded, 'refs/heads/main');
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['merge-base', '--is-ancestor', mainTip, afterWork], repo);
		const files = gitIn(['ls-tree', '--name-only', afterWork], repo);
		expect(files).toMatch(/prior\.txt/);
		expect(files).toMatch(/mainmoved\.txt/);
		// The short lock is released again; the surfaced question is untouched.
		expect(heldLockOnArbiter(repo, 'bravo')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'bravo')).toBe(true);
	});

	it('on a genuine conflict leaves the branch UNTOUCHED and gives the short lock back', async () => {
		const {seeded, repo, priorTip} = await surfacedWithKeptBranch('charlie', {
			mainMoves: true,
			mainConflicts: true,
		});

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'charlie',
			arbiter: ARBITER,
			reconcile: true,
			env: gitEnv(),
		});

		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/RETRIED the rebase/);
		expect(result.reasonNotMoved).toMatch(/short recovery lock .* released/);
		expect(arbiterRef(seeded, 'refs/heads/work/task-charlie')).toBe(priorTip);
		// Back to exactly the released, surfaced state.
		expect(heldLockOnArbiter(repo, 'charlie')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'charlie')).toBe(true);
	});
});

describe('plain requeue and unknown slugs with no held lock', () => {
	it('plain requeue on a surfaced item stays a no-op, keeps the branch, and names --reconcile/--reset', async () => {
		const {seeded, repo, priorTip} = await surfacedWithKeptBranch('delta');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'delta',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/no held per-item lock/);
		expect(result.reasonNotMoved).toMatch(/next claim continues from it/);
		expect(result.reasonNotMoved).toMatch(/requeue --reconcile/);
		expect(result.reasonNotMoved).toMatch(/requeue --reset/);
		expect(arbiterRef(seeded, 'refs/heads/work/task-delta')).toBe(priorTip);
		expect(heldLockOnArbiter(repo, 'delta')).toBe(false);
	});

	it('the refusal for a truly unknown slug is unchanged (for --reset and --reconcile too)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['echo']);
		const expected =
			"'ghost' has no held per-item lock on arbiter \u2014 nothing to requeue " +
			'(wrong slug, or already at rest in backlog/done?). requeue recovers a ' +
			'task whose lock is held stuck (needs-attention) or active (a killed ' +
			'in-progress run).';
		for (const flags of [{}, {reset: true}, {reconcile: true}]) {
			const result = await returnToBacklog({
				cwd: seeded.repo,
				slug: 'ghost',
				arbiter: ARBITER,
				env: gitEnv(),
				...flags,
			});
			expect(result.moved).toBe(false);
			expect(result.reasonNotMoved).toBe(expected);
		}
		expect(heldLockOnArbiter(seeded.repo, 'ghost')).toBe(false);
	});
});
