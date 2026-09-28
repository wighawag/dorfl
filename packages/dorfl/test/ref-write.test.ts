import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	currentRefWrite,
	refWrite,
	type RefWriteStrategy,
} from '../src/ref-write.js';
import {acquireItemLock, releaseItemLock} from '../src/item-lock.js';
import {performStart} from '../src/start.js';
import {createJob} from '../src/workspace.js';
import {performClaim} from '../src/claim-cas.js';
import {performStuckAction} from '../src/apply-stuck-action.js';
import {runAdvanceTickWithTreelessPublish} from '../src/advance-drivers.js';
import type {AdvanceResult} from '../src/advance.js';
import {performDo, type DoDorfl} from '../src/do.js';
import {performTask, type TaskDorfl} from '../src/tasking.js';
import type {TaskReviewGate} from '../src/tasker-review-loop.js';
import {ReviewOutputCappedError} from '../src/review-verdict.js';
import type {SidecarEntry} from '../src/sidecar.js';
import {run, type RunResult} from '../src/git.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * The ref-write seam (task `ci-split-route-direct-writes-through-seams`): every
 * direct network write a CI path reached before now goes through `refWrite`.
 * Each test replaces ONE seam method with a stub (`vi.spyOn(refWrite, ...)`, the
 * pattern the `ledgerWrite` / `ledgerRead` seams use) and drives the REAL caller,
 * so the stub observing the call proves the site is routed through the seam.
 * Where the stub does not call through, the arbiter is checked to be untouched:
 * the stub, not a direct push, owned the write.
 */

const ARBITER = 'arbiter';
const OK: RunResult = {status: 0, stdout: '', stderr: ''};

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-ref-write-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	vi.restoreAllMocks();
	restorePiAgentDir();
	scratch.cleanup();
});

/** The sha of `ref` on the bare arbiter, or `''` when absent. */
function arbiterRef(seeded: SeededRepo, ref: string): string {
	return run('git', ['rev-parse', '--verify', '--quiet', ref], seeded.arbiter, {
		env: gitEnv(),
	}).stdout.trim();
}

describe('ref-write seam: shape', () => {
	it('the active seam starts as the current-behaviour strategy, method for method', () => {
		const methods: (keyof RefWriteStrategy)[] = [
			'createLockRef',
			'amendLockRef',
			'deleteLockRef',
			'pushContinuedBranch',
			'pushLeasedWorkBranch',
			'saveWorkBranch',
			'deleteRemoteWorkBranch',
			'pushTaskingCandidatesBranch',
			'publishTreelessResult',
			'pushLfsObjects',
		];
		expect(Object.keys(currentRefWrite).sort()).toEqual([...methods].sort());
		for (const m of methods) {
			expect(refWrite[m]).toBe(currentRefWrite[m]);
		}
	});

	it('the default amendLockRef is a push leased on the expected sha (accepts a match, rejects a mismatch)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['amend']);
		const acquired = await acquireItemLock({
			item: 'task:amend',
			action: 'implement',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(acquired.outcome).toBe('acquired');
		const ref = acquired.ref;
		const before = arbiterRef(seeded, ref);
		const commit = gitIn(
			['commit-tree', `${before}^{tree}`, '-m', 'amended'],
			seeded.repo,
		).trim();
		const wrongLease = await currentRefWrite.amendLockRef({
			arbiter: ARBITER,
			ref,
			commit,
			expectedSha: commit,
			cwd: seeded.repo,
			env: gitEnv(),
		});
		expect(wrongLease.status).not.toBe(0);
		expect(arbiterRef(seeded, ref)).toBe(before);
		const amended = await currentRefWrite.amendLockRef({
			arbiter: ARBITER,
			ref,
			commit,
			expectedSha: before,
			cwd: seeded.repo,
			env: gitEnv(),
		});
		expect(amended.status).toBe(0);
		expect(arbiterRef(seeded, ref)).toBe(commit);
	});
});

describe('ref-write seam: the leased work-branch push', () => {
	it('pushLeasedWorkBranch publishes only while the branch still points at the expected tip', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['lease']);
		const branch = 'work/task-lease';
		const ref = `refs/heads/${branch}`;
		const main = gitIn(['rev-parse', 'HEAD'], seeded.repo).trim();
		const kept = gitIn(
			['commit-tree', `${main}^{tree}`, '-p', main, '-m', 'kept'],
			seeded.repo,
		).trim();
		gitIn(['push', '-q', ARBITER, `${kept}:${ref}`], seeded.repo);
		const rebased = gitIn(
			['commit-tree', `${main}^{tree}`, '-p', main, '-m', 'rebased'],
			seeded.repo,
		).trim();
		const push = (expectedTip: string) =>
			currentRefWrite.pushLeasedWorkBranch({
				arbiter: ARBITER,
				branch,
				commit: rebased,
				expectedTip,
				cwd: seeded.repo,
				env: gitEnv(),
			});
		expect((await push(main)).status).not.toBe(0);
		expect(arbiterRef(seeded, ref)).toBe(kept);
		expect((await push(kept)).status).toBe(0);
		expect(arbiterRef(seeded, ref)).toBe(rebased);
	});
});

describe('ref-write seam: lock refs', () => {
	it('acquireItemLock creates the lock ref through refWrite.createLockRef', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const stub = vi
			.spyOn(refWrite, 'createLockRef')
			.mockImplementation(async () => OK);
		const acquired = await acquireItemLock({
			item: 'task:alpha',
			action: 'implement',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(stub).toHaveBeenCalledTimes(1);
		expect(stub.mock.calls[0][0]).toMatchObject({
			arbiter: ARBITER,
			ref: 'refs/dorfl/lock/task-alpha',
		});
		expect(acquired.outcome).toBe('acquired');
		// The stub owned the write: nothing reached the arbiter.
		expect(arbiterRef(seeded, 'refs/dorfl/lock/task-alpha')).toBe('');
	});

	it('releaseItemLock deletes the lock ref through refWrite.deleteLockRef, leased on the held sha', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const acquired = await acquireItemLock({
			item: 'task:beta',
			action: 'implement',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(acquired.outcome).toBe('acquired');
		const held = arbiterRef(seeded, acquired.ref);
		const stub = vi
			.spyOn(refWrite, 'deleteLockRef')
			.mockImplementation(async () => OK);
		const released = await releaseItemLock({
			item: 'task:beta',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(stub).toHaveBeenCalledTimes(1);
		expect(stub.mock.calls[0][0]).toMatchObject({
			ref: acquired.ref,
			expectedSha: held,
		});
		expect(released.outcome).toBe('released');
		expect(arbiterRef(seeded, acquired.ref)).toBe(held);
	});
});

/** A kept `work/task-<slug>` on the arbiter, the item re-claimed (the continue state). */
async function keptBranchReclaimed(slug: string): Promise<SeededRepo> {
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
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	gitIn(['push', '-q', ARBITER, `work/task-${slug}:work/task-${slug}`], repo);
	gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
	return seeded;
}

describe('ref-write seam: the continued work-branch push', () => {
	it('start (in-place continue) pushes the rebased kept branch through refWrite.pushContinuedBranch', async () => {
		const seeded = await keptBranchReclaimed('delta');
		const tipBefore = arbiterRef(seeded, 'refs/heads/work/task-delta');
		const stub = vi
			.spyOn(refWrite, 'pushContinuedBranch')
			.mockImplementation(() => ({kind: 'pushed'}));
		const fresh = seeded.clone('continuer-delta');
		const started = await performStart({
			slug: 'delta',
			cwd: fresh,
			arbiter: ARBITER,
			resume: true,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(stub).toHaveBeenCalledTimes(1);
		expect(stub.mock.calls[0][0]).toMatchObject({
			branch: 'work/task-delta',
			arbiter: ARBITER,
			expectedRemoteTip: tipBefore,
		});
		expect(arbiterRef(seeded, 'refs/heads/work/task-delta')).toBe(tipBefore);
	});

	it('createJob (job worktree continue) pushes through refWrite.pushContinuedBranch', async () => {
		const seeded = await keptBranchReclaimed('eta');
		const stub = vi
			.spyOn(refWrite, 'pushContinuedBranch')
			.mockImplementation(() => ({kind: 'pushed'}));
		const job = createJob({
			fromRepo: seeded.repo,
			arbiter: ARBITER,
			slug: 'eta',
			workspacesDir: join(scratch.root, '.dorfl'),
			env: gitEnv(),
		});
		try {
			expect(job.continued).toBe(true);
			expect(stub).toHaveBeenCalledTimes(1);
			expect(stub.mock.calls[0][0]).toMatchObject({branch: 'work/task-eta'});
		} finally {
			job.dispose();
		}
	});
});

describe('ref-write seam: the remote work-branch delete', () => {
	it('the answered stuck `reset` deletes work/task-<slug> through refWrite.deleteRemoteWorkBranch', async () => {
		const seeded = await keptBranchReclaimed('zeta');
		const tip = arbiterRef(seeded, 'refs/heads/work/task-zeta');
		const stub = vi
			.spyOn(refWrite, 'deleteRemoteWorkBranch')
			.mockImplementation(async () => ({
				branch: 'work/task-zeta',
				status: 'deleted',
				stderr: '',
			}));
		const result = await performStuckAction({
			action: {verb: 'reset', entry: {} as SidecarEntry},
			item: 'task:zeta',
			slug: 'zeta',
			cwd: seeded.repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('reset');
		expect(stub).toHaveBeenCalledWith({
			cwd: seeded.repo,
			arbiter: ARBITER,
			slug: 'zeta',
			env: gitEnv(),
		});
		expect(arbiterRef(seeded, 'refs/heads/work/task-zeta')).toBe(tip);
	});
});

describe('ref-write seam: the tree-less publish', () => {
	it('a successful tree-less rung publishes through refWrite.publishTreelessResult', async () => {
		const stub = vi
			.spyOn(refWrite, 'publishTreelessResult')
			.mockImplementation(async () => {});
		const tick = {
			exitCode: 0,
			outcome: 'surfaced',
			rung: 'surface',
			message: 'surfaced',
		} as unknown as AdvanceResult;
		const result = await runAdvanceTickWithTreelessPublish(
			{cwd: '/nowhere', arbiter: ARBITER, arg: 'task:x'},
			async () => tick,
		);
		expect(result).toBe(tick);
		expect(stub).toHaveBeenCalledTimes(1);
		expect(stub.mock.calls[0][0]).toMatchObject({
			cwd: '/nowhere',
			arbiter: ARBITER,
		});
	});
});

describe('ref-write seam: the deadline checkpoint save', () => {
	it('a deadline auto-continue saves the work branch through refWrite.saveWorkBranch', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const spy = vi.spyOn(refWrite, 'saveWorkBranch');
		const timeoutAgent: DoDorfl = ({cwd}) => {
			writeFileSync(join(cwd, 'checkpoint-work.txt'), 'partial work\n');
			return {ok: false, timedOut: true};
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			dorfl: timeoutAgent,
			env: gitEnv(),
			maxAutoCheckpoints: 5,
		});
		expect(result.outcome).toBe('deadline-auto-continued');
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0][0]).toMatchObject({
			slug: 'alpha',
			branch: 'work/task-alpha',
			arbiter: ARBITER,
		});
	});
});

describe('ref-write seam: the tasking candidates branch push', () => {
	it('a failed review leg pushes the saved candidates through refWrite.pushTaskingCandidatesBranch', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const specDir = join(repo, 'work', 'specs', 'ready');
		mkdirSync(specDir, {recursive: true});
		writeFileSync(
			join(specDir, 'it.md'),
			['---', 'title: it', 'slug: it', '---', '', 'Spec body.', ''].join('\n'),
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'spec: it'], repo);
		gitIn(['push', '-q', ARBITER, 'main'], repo);
		const tasker: TaskDorfl = ({cwd}) => {
			const dir = join(cwd, 'work', 'tasks', 'backlog');
			mkdirSync(dir, {recursive: true});
			writeFileSync(
				join(dir, 'child.md'),
				['---', 'title: child', 'slug: child', 'spec: it', '---', ''].join(
					'\n',
				),
			);
			return {ok: true};
		};
		const gate: TaskReviewGate = async () => {
			throw new ReviewOutputCappedError(16384);
		};
		const stub = vi
			.spyOn(refWrite, 'pushTaskingCandidatesBranch')
			.mockImplementation(async () => OK);
		const result = await performTask({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoTask: true,
			integration: 'merge',
			dorfl: tasker,
			reviewLoop: gate,
			taskerLoopMax: 3,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('needs-attention');
		expect(stub).toHaveBeenCalledTimes(1);
		expect(stub.mock.calls[0][0]).toMatchObject({
			arbiter: ARBITER,
			branch: 'work/spec-it',
		});
	});
});
