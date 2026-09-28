import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performClaim} from '../src/claim-cas.js';
import {releaseItemLock} from '../src/item-lock.js';
import {
	createJob,
	RetainedWorktreeUnsavedWorkError,
	type Job,
} from '../src/workspace.js';
import {returnToBacklog} from '../src/needs-attention.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * Task `a-fresh-claim-does-not-discard-a-retained-worktrees-unsaved-work`: a
 * crashed `do --isolated` run leaves its job worktree RETAINED; when its lock is
 * released some way other than `requeue` (here `release-lock task:<slug>`), the
 * next claim's FRESH-cut `createJob` used to clear that worktree (and drop its
 * local branch) unguarded. It now applies the shared gc deletion-safety
 * predicate first and REFUSES, leaving the worktree untouched, when the
 * worktree holds work the arbiter lacks.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-fresh-claim-retained-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

interface Crashed {
	seeded: SeededRepo;
	repo: string;
	job: Job;
	workspacesDir: string;
}

/** Claim + cut the job worktree exactly as `do --isolated` does; the run then "dies". */
async function crashedRun(slug: string): Promise<Crashed> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	const workspacesDir = join(scratch.root, '.dorfl');
	const job = createJob({
		fromRepo: repo,
		arbiter: ARBITER,
		slug,
		workspacesDir,
		env: gitEnv(),
	});
	expect(job.continued).toBe(false);
	return {seeded, repo, job, workspacesDir};
}

/** `release-lock task:<slug>` (NOT requeue, so nothing is saved), then re-claim. */
async function releaseAndReclaim(repo: string, slug: string): Promise<void> {
	const rel = await releaseItemLock({
		item: `task:${slug}`,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(rel.outcome).toBe('released');
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
}

function recreate(c: Crashed, slug: string): Job {
	return createJob({
		fromRepo: c.repo,
		arbiter: ARBITER,
		slug,
		workspacesDir: c.workspacesDir,
		env: gitEnv(),
	});
}

function refusal(fn: () => unknown): RetainedWorktreeUnsavedWorkError {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(RetainedWorktreeUnsavedWorkError);
		return err as RetainedWorktreeUnsavedWorkError;
	}
	throw new Error('expected createJob to refuse, but it returned');
}

describe('a fresh claim over a retained worktree never discards its local-only work', () => {
	it('uncommitted changes: refuses loudly and leaves the worktree (and its changes) untouched', async () => {
		const c = await crashedRun('alpha');
		writeFileSync(join(c.job.dir, 'residue.txt'), 'uncommitted work\n');
		await releaseAndReclaim(c.repo, 'alpha');

		const err = refusal(() => recreate(c, 'alpha'));
		expect(err.reason).toBe('dirty-tree');
		expect(err.dir).toBe(c.job.dir);
		expect(err.message).toContain(c.job.dir);
		expect(err.message).toMatch(/dorfl requeue alpha/);
		expect(err.message).toMatch(/worktree remove --force/);
		// The changes survive in the untouched worktree.
		expect(readFileSync(join(c.job.dir, 'residue.txt'), 'utf8')).toBe(
			'uncommitted work\n',
		);
		expect(gitIn(['branch', '--show-current'], c.job.dir).trim()).toBe(
			'work/task-alpha',
		);
	});

	it('unpushed local commits: refuses and keeps the commit on the retained branch', async () => {
		const c = await crashedRun('beta');
		writeFileSync(join(c.job.dir, 'agent.txt'), 'agent work\n');
		gitIn(['add', '-A'], c.job.dir);
		gitIn(
			['commit', '-q', '-m', 'chore(beta): save aborted work (wip)'],
			c.job.dir,
		);
		const localTip = gitIn(['rev-parse', 'HEAD'], c.job.dir).trim();
		await releaseAndReclaim(c.repo, 'beta');

		const err = refusal(() => recreate(c, 'beta'));
		expect(err.reason).toBe('unmerged-commits');
		expect(gitIn(['rev-parse', 'HEAD'], c.job.dir).trim()).toBe(localTip);
		// The local branch in the hub mirror was not dropped either.
		expect(
			gitIn(
				['rev-parse', 'refs/heads/work/task-beta'],
				c.job.mirror.path,
			).trim(),
		).toBe(localTip);
	});

	it('the recovery the refusal names works: requeue saves it, and the next claim continues from it', async () => {
		const c = await crashedRun('delta');
		writeFileSync(join(c.job.dir, 'agent.txt'), 'agent work\n');
		gitIn(['add', '-A'], c.job.dir);
		gitIn(['commit', '-q', '-m', 'local-only'], c.job.dir);
		await releaseAndReclaim(c.repo, 'delta');
		refusal(() => recreate(c, 'delta'));

		// The refused claim still holds the lock, so `requeue` saves + releases.
		const requeued = await returnToBacklog({
			cwd: c.repo,
			slug: 'delta',
			arbiter: ARBITER,
			workspacesDir: c.workspacesDir,
			sleep: async () => {},
			env: gitEnv(),
		});
		expect(requeued.moved).toBe(true);
		expect(requeued.crashedRunSave?.kind).toBe('saved');

		const claim = await performClaim({
			slug: 'delta',
			cwd: c.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		const next = recreate(c, 'delta');
		expect(next.continued).toBe(true);
		expect(existsSync(join(next.dir, 'agent.txt'))).toBe(true);
	});

	it('a retained worktree with nothing local-only is still cleared as today', async () => {
		const c = await crashedRun('gamma');
		await releaseAndReclaim(c.repo, 'gamma');

		const next = recreate(c, 'gamma');
		expect(next.continued).toBe(false);
		expect(next.dir).toBe(c.job.dir);
		expect(gitIn(['branch', '--show-current'], next.dir).trim()).toBe(
			'work/task-gamma',
		);
	});
});
