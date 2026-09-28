import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
import {performClaim} from '../src/claim-cas.js';
import {createJob, updateJobRecord, type Job} from '../src/workspace.js';
import {gc} from '../src/gc.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	heldLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * Task `a-crashed-runs-local-work-is-saved-before-its-lock-is-released`: a
 * `do --isolated` run killed mid-agent leaves its lock `active` and its job
 * worktree retained with commits the arbiter's `work/task-<slug>` lacks. A
 * requeue must SAVE them (wip-commit residue + push the branch) before it
 * releases the lock, keep the lock when the save fails, and `gc` must keep such
 * a worktree and say why.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-requeue-crashed-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const noWait = async (): Promise<void> => {};

interface KilledRun {
	seeded: SeededRepo;
	repo: string;
	job: Job;
	workspacesDir: string;
}

/**
 * The killed-run fixture: claim the task (lock `active`), cut its job worktree
 * exactly as `do --isolated` does (`createJob`, harness record with no live
 * PID = the run is dead), and leave NOTHING on the arbiter's work branch.
 */
async function killedRun(slug: string): Promise<KilledRun> {
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

/** The runner's aborted-work commit, made locally and never pushed. */
function commitLocally(job: Job, file: string, subject: string): string {
	writeFileSync(join(job.dir, file), `${subject}\n`);
	gitIn(['add', '-A'], job.dir);
	gitIn(['commit', '-q', '-m', subject], job.dir);
	return gitIn(['rev-parse', 'HEAD'], job.dir).trim();
}

function arbiterBranchTip(seeded: SeededRepo, branch: string): string {
	const out = gitIn(
		['ls-remote', `file://${seeded.arbiter}`, `refs/heads/${branch}`],
		seeded.repo,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

function isAncestorOn(repo: string, sha: string, ref: string): boolean {
	gitIn(['fetch', '-q', ARBITER, `+${ref}:refs/remotes/check/tip`], repo);
	try {
		gitIn(['merge-base', '--is-ancestor', sha, 'refs/remotes/check/tip'], repo);
		return true;
	} catch {
		return false;
	}
}

describe('requeue saves a crashed run’s local-only work before releasing its lock', () => {
	it('pushes the unpushed commit (and a wip of the residue), releases, and the next claim continues from it', async () => {
		const {seeded, repo, job, workspacesDir} = await killedRun('alpha');
		const localTip = commitLocally(
			job,
			'agent.txt',
			'chore(alpha): save aborted work (wip)',
		);
		// Plus residue the handler never committed.
		writeFileSync(join(job.dir, 'residue.txt'), 'uncommitted\n');
		expect(arbiterBranchTip(seeded, job.branch)).toBe('');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			workspacesDir,
			sleep: noWait,
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		expect(result.crashedRunSave?.kind).toBe('saved');
		expect(result.continueBranch?.aheadOfMain).toBe(true);
		// The arbiter branch now carries the local commit AND a wip of the residue.
		const tip = arbiterBranchTip(seeded, job.branch);
		expect(tip).not.toBe('');
		expect(tip).not.toBe(localTip);
		expect(isAncestorOn(repo, localTip, `refs/heads/${job.branch}`)).toBe(true);
		expect(heldLockOnArbiter(repo, 'alpha')).toBe(false);

		// The NEXT claim continues from the saved branch.
		const reclaim = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(reclaim.exitCode).toBe(0);
		const next = createJob({
			fromRepo: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			workspacesDir,
			env: gitEnv(),
		});
		expect(next.continued).toBe(true);
		expect(existsSync(join(next.dir, 'agent.txt'))).toBe(true);
		expect(existsSync(join(next.dir, 'residue.txt'))).toBe(true);
	});

	it('a crashed run with nothing unsaved behaves as today (no push, lock released)', async () => {
		const {seeded, repo, job, workspacesDir} = await killedRun('beta');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'beta',
			arbiter: ARBITER,
			workspacesDir,
			sleep: noWait,
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		expect(result.crashedRunSave?.kind).toBe('nothing-unsaved');
		expect(arbiterBranchTip(seeded, job.branch)).toBe('');
		expect(result.continueBranch?.present).toBe(false);
		expect(heldLockOnArbiter(repo, 'beta')).toBe(false);
	});

	it('a failed save KEEPS the lock and the worktree, and says so', async () => {
		const {seeded, repo, job, workspacesDir} = await killedRun('gamma');
		const localTip = commitLocally(job, 'agent.txt', 'local-only work');
		// The arbiter's branch diverged (someone pushed a different commit), so the
		// plain save push is rejected as a non-fast-forward.
		const other = seeded.clone('other');
		gitIn(['fetch', '-q', ARBITER], other);
		gitIn(['switch', '-q', '-c', 'div', `${ARBITER}/main`], other);
		writeFileSync(join(other, 'other.txt'), 'divergent\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'divergent'], other);
		gitIn(['push', '-q', ARBITER, `div:${job.branch}`], other);
		const divergent = arbiterBranchTip(seeded, job.branch);

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'gamma',
			arbiter: ARBITER,
			workspacesDir,
			sleep: noWait,
			env: gitEnv(),
		});

		expect(result.moved).toBe(false);
		expect(result.crashedRunSave?.kind).toBe('not-saved');
		expect(result.reasonNotMoved).toMatch(/lock is KEPT/);
		expect(result.reasonNotMoved).toMatch(/push of work\/task-gamma failed/);
		expect(heldLockOnArbiter(repo, 'gamma')).toBe(true);
		expect(existsSync(job.dir)).toBe(true);
		expect(gitIn(['rev-parse', 'HEAD'], job.dir).trim()).toBe(localTip);
		// The arbiter branch was not clobbered.
		expect(arbiterBranchTip(seeded, job.branch)).toBe(divergent);
	});

	it('a LIVE run’s worktree is not touched', async () => {
		const {seeded, repo, job, workspacesDir} = await killedRun('delta');
		commitLocally(job, 'agent.txt', 'in-flight work');
		// The record points at a live PID (this test process): the run is alive.
		updateJobRecord(job.dir, {harness: {adapter: 'null', pid: process.pid}});

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'delta',
			arbiter: ARBITER,
			workspacesDir,
			sleep: noWait,
			env: gitEnv(),
		});

		expect(result.crashedRunSave?.kind).toBe('alive');
		expect(arbiterBranchTip(seeded, job.branch)).toBe('');
	});

	it('--reset does not save (it discards the work by design)', async () => {
		const {seeded, repo, job, workspacesDir} = await killedRun('epsilon');
		commitLocally(job, 'agent.txt', 'to be discarded');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'epsilon',
			arbiter: ARBITER,
			workspacesDir,
			reset: true,
			sleep: noWait,
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		expect(result.crashedRunSave).toBeUndefined();
		expect(arbiterBranchTip(seeded, job.branch)).toBe('');
	});
});

describe('gc keeps a crashed run’s worktree with commits the arbiter lacks', () => {
	it('retains it with the reason and a save hint (no --force)', async () => {
		const {job, workspacesDir} = await killedRun('zeta');
		commitLocally(job, 'agent.txt', 'local-only work');

		const notes: string[] = [];
		const result = gc({
			workspacesDir,
			note: (m) => notes.push(m),
			env: gitEnv(),
		});

		expect(result.reaped).toHaveLength(0);
		expect(result.retained).toHaveLength(1);
		expect(result.retained[0].reason).toBe('unmerged-commits');
		expect(result.retained[0].hint).toMatch(/dorfl requeue zeta/);
		expect(existsSync(job.dir)).toBe(true);
		expect(notes.some((n) => /Retained zeta: unmerged commits/.test(n))).toBe(
			true,
		);
	});
});
