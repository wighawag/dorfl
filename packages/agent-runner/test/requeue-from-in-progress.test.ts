import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
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

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-requeue-in-progress-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Reproduce a slice STUCK on its per-item lock (slice
 * `cutover-needs-attention-becomes-lock-stuck-recovery-surface`: stuck-state is
 * the lock `state: stuck`, NOT a `needs-attention/` folder file) WITH a prior
 * attempt's commit on `work/<slug>` pushed to the arbiter (the durable artifact a
 * keep+continue requeue keeps). The body RESTS in `backlog/` throughout (claim
 * never moves it).
 *
 * The cwd is left on the seed `main`, so a requeue must read the slug's state from
 * the ARBITER (the lock ref), not the cwd tree.
 */
async function stuckInProgress(
	slug: string,
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
	// A prior attempt commits work on work/<slug> and the bounce marks the lock
	// stuck + pushes the branch (the keep+continue artifact).
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	const bounced = await ledgerWrite.applyNeedsAttentionTransition({
		cwd: repo,
		slug,
		reason: 'killed mid-run',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(bounced.moved).toBe(true);
	const priorTip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	expect(stuckLockOnArbiter(repo, slug)).toBe(true);
	// Leave the cwd on a clean main (NOT the work branch): the requeue must resolve
	// the lock state from the arbiter, not the cwd tree.
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-f', 'main'], repo);
	return {seeded, repo, priorTip};
}

/** The commit shas reachable from `<arbiter>/main` (newest first). */
function arbiterMainLog(repo: string): string[] {
	gitIn(['fetch', '-q', ARBITER], repo);
	return gitIn(['log', '--format=%H', `${ARBITER}/main`], repo)
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s !== '');
}

/** The arbiter's sha for a full ref, or ''. */
function arbiterRef(seeded: SeededRepo, ref: string): string {
	const out = gitIn(
		['ls-remote', `file://${seeded.arbiter}`, ref],
		seeded.repo,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

/** Does the arbiter currently have the given branch? */
function arbiterHasBranch(seeded: SeededRepo, branch: string): boolean {
	return arbiterRef(seeded, `refs/heads/${branch}`) !== '';
}

describe('requeue recovers a slice stuck on its per-item lock (releases the lock)', () => {
	it('releases the stuck lock WITHOUT a cwd checkout of the item; body stays in backlog/', async () => {
		const {repo} = await stuckInProgress('alpha');
		// Precondition: the item is stuck (the lock), body rests in backlog/.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The lock is released; the body is back in the claimable pool (it never left).
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
	});

	it('keep+continue (default) leaves the work branch on the arbiter untouched', async () => {
		const {seeded, repo} = await stuckInProgress('beta');
		const before = arbiterRef(seeded, 'refs/heads/work/slice-beta');
		expect(before).not.toBe('');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'beta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(result.deletedRemoteBranch).toBeFalsy();

		// The kept work branch is UNTOUCHED on the arbiter (the next claim continues
		// from its tip).
		expect(arbiterHasBranch(seeded, 'work/slice-beta')).toBe(true);
		expect(arbiterRef(seeded, 'refs/heads/work/slice-beta')).toBe(before);
		// And the lock is released; the body rests in backlog/.
		expect(stuckLockOnArbiter(repo, 'beta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
	});

	it('--reset deletes the remote work branch FIRST, then releases the lock', async () => {
		const {seeded, repo} = await stuckInProgress('gamma');
		expect(arbiterHasBranch(seeded, 'work/slice-gamma')).toBe(true);

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'gamma',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(result.deletedRemoteBranch).toBe(true);
		// The remote branch is GONE (discarded).
		expect(arbiterHasBranch(seeded, 'work/slice-gamma')).toBe(false);
		// The lock is released; the body rests in backlog/.
		expect(stuckLockOnArbiter(repo, 'gamma')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'gamma')).toBe(true);
	});

	it('-m appends a dated handoff note to the backlog body (read+rewritten via the arbiter)', async () => {
		const {seeded, repo} = await stuckInProgress('delta');
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'delta',
			arbiter: ARBITER,
			message: 'killed mid-run; resume from the prior attempt',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		const fresh = seeded.clone('reader');
		const body = readFileSync(
			join(fresh, 'work', 'tasks', 'todo', 'delta.md'),
			'utf8',
		);
		expect(body).toMatch(/## Requeue \d{4}-\d{2}-\d{2}/);
		expect(body).toMatch(/killed mid-run; resume from the prior attempt/);
		// The lock was released after the handoff note landed.
		expect(stuckLockOnArbiter(repo, 'delta')).toBe(false);
	});

	it('a pre-existing untracked cwd file is neither staged nor committed (tree-less CAS)', async () => {
		const {repo} = await stuckInProgress('epsilon');

		// Seed an UNTRACKED file in the shared checkout — a concurrent writer's WIP.
		mkdirSync(join(repo, 'work', 'notes', 'ideas'), {recursive: true});
		const strayRel = 'work/notes/ideas/concurrent-wip.md';
		writeFileSync(join(repo, strayRel), '# a concurrent writer was editing\n');

		const beforeArbiter = arbiterMainLog(repo);
		const beforeHead = gitIn(['rev-parse', 'HEAD'], repo).trim();

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'epsilon',
			arbiter: ARBITER,
			// A handoff note forces a tree-less CAS move (the only main write requeue
			// can make); without `-m` the lock release alone touches no main commit.
			message: 'resume note',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// 1. The stray file is STILL UNTRACKED in the cwd.
		const status = gitIn(['status', '--porcelain', strayRel], repo);
		expect(status.trim()).toBe(`?? ${strayRel}`);
		// 2. The cwd HEAD did not move — requeue made NO commit in the cwd tree.
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).toBe(beforeHead);
		// 3. The stray file is absent from EVERY commit requeue added to the arbiter.
		const afterArbiter = arbiterMainLog(repo);
		const newCommits = afterArbiter.filter((c) => !beforeArbiter.includes(c));
		for (const commit of newCommits) {
			const files = gitIn(['show', '--name-only', '--format=', commit], repo);
			expect(files).not.toMatch(/concurrent-wip\.md/);
		}
		// 4. The lock is released and the body rests in backlog/.
		expect(stuckLockOnArbiter(repo, 'epsilon')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'epsilon')).toBe(true);
	});

	it('gives a CLEAR actionable message (never a bare "not found") for a slug with no held lock', async () => {
		// A seeded repo where the slug is only in backlog/ (never claimed): no held
		// lock. requeue must refuse with a message naming the lock-held requirement.
		const seeded = seedRepoWithArbiter(scratch.root, ['zeta']);
		const result = await returnToBacklog({
			cwd: seeded.repo,
			slug: 'zeta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/no held per-item lock/i);
		// Not a bare "not found".
		expect(result.reasonNotMoved).not.toMatch(/^not found$/i);
	});
});
