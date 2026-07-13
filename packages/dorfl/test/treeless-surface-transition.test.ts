import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
import {readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
} from './helpers/gitRepo.js';

/**
 * The AFTER-COMMIT / ledger-only surface (continue-push-failure /
 * continue-rebase-conflict) is, after the cut-over (task
 * `cutover-needs-attention-becomes-lock-stuck-recovery-surface`, decision i+), a
 * PURE lock amend (`active → stuck`) reached through the write seam's tree-less
 * transition (`applyTreelessNeedsAttentionTransition`) \u2014 NO `git mv` to
 * `needs-attention/`, NO `main` write, NO cwd-tree mutation. The recoverable work
 * is already committed on the kept `work/<slug>` branch (untouched here). All real
 * git against a local `--bare file://` arbiter.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-treeless-surface-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Drive a task to the AFTER-COMMIT continue state on the arbiter ONLY: claim it
 * (the per-item lock is held active; the body RESTS in `backlog/`) and push its
 * kept `work/task-<slug>` branch (the already-committed, recoverable work), then
 * leave the cwd working tree on the ORIGINAL seed `main`.
 */
async function claimedOnArbiterOnly(
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
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'committed.txt'), 'already committed work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'already committed work'], repo);
	gitIn(['push', '-q', ARBITER, `work/task-${slug}:work/task-${slug}`], repo);
	// Leave the cwd on the original seed main.
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-f', 'main'], repo);
	return {seeded, repo};
}

/** The commit shas reachable from `<arbiter>/main` (newest first). */
function arbiterMainLog(repo: string): string[] {
	gitIn(['fetch', '-q', ARBITER], repo);
	return gitIn(['log', '--format=%H', `${ARBITER}/main`], repo)
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s !== '');
}

describe('the tree-less surface is a pure lock amend (no cwd tree, no main write)', () => {
	it('marks the lock stuck WITHOUT a cwd checkout of the item; body stays in backlog/', async () => {
		const {repo} = await claimedOnArbiterOnly('alpha');
		// Precondition: no needs-attention/ folder anywhere; body rests in backlog/.
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			false,
		);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);

		const result = await ledgerWrite.applyTreelessNeedsAttentionTransition({
			cwd: repo,
			slug: 'alpha',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The lock is stuck; the body still rests in backlog/ (no folder move).
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
	});

	it('records the reason on the surfaced sidecar (read from <arbiter>/main, not the cwd tree)', async () => {
		const {repo} = await claimedOnArbiterOnly('gamma');
		const reason = 'rebase onto the latest main conflicted (aborted)';
		const result = await ledgerWrite.applyTreelessNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// PR-2b: post-bounce the lock is RELEASED; the reason lives on the surfaced
		// stuck-kind sidecar's envelope (its `context`), read off `<arbiter>/main`.
		const sidecar = gitIn(
			['show', `${ARBITER}/main:work/questions/task-gamma.md`],
			repo,
		);
		expect(sidecar).toMatch(/rebase onto the latest main conflicted/);
		// The lock itself is gone: `readItemLock` returns undefined.
		const lock = await readItemLock({
			item: 'task:gamma',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock).toBeUndefined();
	});

	it('does NOT touch the cwd working tree: a pre-existing untracked file is untouched, HEAD does not move, main unchanged', async () => {
		const {repo} = await claimedOnArbiterOnly('beta');

		// Seed an UNTRACKED file in the shared checkout.
		mkdirSync(join(repo, 'work', 'notes', 'ideas'), {recursive: true});
		const strayRel = 'work/notes/ideas/assistant-wip.md';
		writeFileSync(join(repo, strayRel), '# an idea being written\n');

		const beforeHead = gitIn(['rev-parse', 'HEAD'], repo).trim();

		const result = await ledgerWrite.applyTreelessNeedsAttentionTransition({
			cwd: repo,
			slug: 'beta',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// 1. The stray file is STILL UNTRACKED in the cwd.
		const status = gitIn(['status', '--porcelain', strayRel], repo);
		expect(status.trim()).toBe(`?? ${strayRel}`);
		// 2. The cwd HEAD did not move (a tree-less bounce makes no cwd commit).
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).toBe(beforeHead);
		// 3. PR-2b: `<arbiter>/main` DID advance (one surface commit landed).
		// 4. The A1 triple (lock released, sidecar + needsAnswers on main).
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'beta')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'beta')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'beta')).toBe(true);
	});

	it('the recoverable kept work/task-<slug> branch is UNCHANGED on the arbiter', async () => {
		const {repo} = await claimedOnArbiterOnly('eta');
		gitIn(['fetch', '-q', ARBITER], repo);
		const branchBefore = gitIn(
			['rev-parse', `${ARBITER}/work/task-eta`],
			repo,
		).trim();

		const result = await ledgerWrite.applyTreelessNeedsAttentionTransition({
			cwd: repo,
			slug: 'eta',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The kept branch (the recoverable artifact) is untouched.
		gitIn(['fetch', '-q', ARBITER], repo);
		const branchAfter = gitIn(
			['rev-parse', `${ARBITER}/work/task-eta`],
			repo,
		).trim();
		expect(branchAfter).toBe(branchBefore);
	});

	it('surfaces + tolerates a not-held lock (release is idempotent — never leaves a dead-end held lock)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['iota']);
		const repo = seeded.repo;
		// Never claimed ⇒ no held lock. PR-2b: the surface still lands on
		// `<arbiter>/main` and the (already-absent) lock "release" is a tolerated
		// no-op, so the bounce is a clean moved:true.
		const result = await ledgerWrite.applyTreelessNeedsAttentionTransition({
			cwd: repo,
			slug: 'iota',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(stuckLockOnArbiter(repo, 'iota')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'iota')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'iota')).toBe(true);
	});

	it('the seam method marks the lock stuck (one mechanism, reachable through the write seam)', async () => {
		const {repo} = await claimedOnArbiterOnly('kappa');
		const result = await ledgerWrite.applyTreelessNeedsAttentionTransition({
			cwd: repo,
			slug: 'kappa',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'kappa')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'kappa')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'kappa')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'kappa')).toBe(true);
	});
});
