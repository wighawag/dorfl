import {existsSync} from 'node:fs';
import {run} from './git.js';
import {evaluateDeletionSafety, RETAIN_REASON_TEXT} from './gc.js';
import {resolveHarness} from './harness.js';
// Import for the registration side-effect: ensures the `pi` adapter is in the
// harness registry so a pi job's liveness is answered by the pi adapter (the
// same reason `status.ts` imports it).
import './pi-harness.js';
import {jobWorktreePath, readJobRecord} from './workspace.js';
import {workBranchRef} from './slug-namespace.js';
import {refWrite} from './ref-write.js';
import type {BackoffOptions, Sleep} from './retry-backoff.js';

/**
 * **Save a CRASHED run's local-only work before its lock is released** (task
 * `a-crashed-runs-local-work-is-saved-before-its-lock-is-released`).
 *
 * A `do --isolated` run that is killed mid-agent (a host restart, an OOM kill)
 * leaves its per-item lock `active` and its job worktree RETAINED under
 * `<workspacesDir>/work/<work-id>/`. The runner's own abort handler may already
 * have made the usual wip commit there, but the process died before pushing it,
 * so the work exists ONLY in that worktree. A plain `requeue` then released the
 * lock without saving it, and the next claim (or `gc --force`) cut the worktree
 * away: the work was lost.
 *
 * This is the SAVE step `requeue` runs before it releases a held lock. It
 * locates the slug's retained job worktree by the SAME arbiter-URL + slug naming
 * `do --isolated` created it with (`jobWorktreePath`, as `complete --isolated`
 * locates it), and:
 *
 *   - no retained worktree (or one that belongs to a same-slug SPEC run)
 *     ⇒ `no-worktree`: nothing to do, requeue behaves as before;
 *   - the run is still ALIVE per its harness (PID/session, never mtime, ADR §5)
 *     ⇒ `alive`: we never write into a live agent's tree;
 *   - the gc deletion-safety predicate already holds (clean tree AND tip on the
 *     arbiter) ⇒ `nothing-unsaved`: requeue behaves as before;
 *   - otherwise commit any uncommitted residue as the usual wip commit and push
 *     the work branch through `refWrite.saveWorkBranch` (the SAME save half
 *     `routeToNeedsAttention` and the deadline checkpoint use: plain push, never
 *     `--force`, bounded backoff), then RE-CHECK the predicate: holds ⇒ `saved`,
 *     else `not-saved` with why (the caller keeps the lock and the worktree).
 *
 * A worktree whose HEAD is not on its work branch (e.g. a run killed mid-rebase,
 * detached HEAD) is `not-saved` WITHOUT touching it: committing onto a detached
 * HEAD would strand the commit, so the human resolves it by hand.
 */
export type CrashedRunSaveOutcome =
	| {kind: 'no-worktree'}
	| {kind: 'alive'; dir: string; branch: string}
	| {kind: 'nothing-unsaved'; dir: string; branch: string}
	| {kind: 'saved'; dir: string; branch: string; committedResidue: boolean}
	| {kind: 'not-saved'; dir: string; branch: string; detail: string};

export interface SaveCrashedRunWorkOptions {
	/** The operator's checkout; its `arbiter` remote names the repo. */
	cwd: string;
	/** The arbiter remote NAME in {@link cwd}. */
	arbiter: string;
	/** The task slug (the branch is `work/task-<slug>`). */
	slug: string;
	/** The execution working area (config `workspacesDir`). */
	workspacesDir: string;
	env?: NodeJS.ProcessEnv;
	note?: (message: string) => void;
	/** Backoff bounds for the save push (tests pass a no-wait `sleep`). */
	backoff?: BackoffOptions;
	sleep?: Sleep;
}

/** The arbiter remote name valid INSIDE a job worktree (cut from the bare hub mirror). */
const WORKTREE_ARBITER_REMOTE = 'origin';

export async function saveCrashedRunWork(
	options: SaveCrashedRunWorkOptions,
): Promise<CrashedRunSaveOutcome> {
	const note = options.note ?? (() => {});
	const {cwd, arbiter, slug, workspacesDir, env} = options;

	const url = run('git', ['remote', 'get-url', arbiter], cwd, {env});
	if (url.status !== 0 || url.stdout.trim() === '') {
		return {kind: 'no-worktree'};
	}
	const dir = jobWorktreePath(workspacesDir, url.stdout.trim(), slug);
	if (!existsSync(dir)) {
		return {kind: 'no-worktree'};
	}
	const branch = workBranchRef('task', slug);
	const record = readJobRecord(dir);
	if (record !== undefined && record.branch !== branch) {
		// A same-slug SPEC (tasking) run shares the work-id; it is not this task's.
		return {kind: 'no-worktree'};
	}

	if (
		record !== undefined &&
		record.state === 'running' &&
		resolveHarness(record.harness).isAlive(record.harness)
	) {
		note(
			`'${slug}': its run in ${dir} is still ALIVE (per its harness), so ` +
				'requeue does not touch its worktree.',
		);
		return {kind: 'alive', dir, branch};
	}

	const before = evaluateDeletionSafety({dir, branch, env});
	if (before.safe) {
		return {kind: 'nothing-unsaved', dir, branch};
	}

	const head = run('git', ['symbolic-ref', '-q', '--short', 'HEAD'], dir, {
		env,
	});
	if (head.status !== 0 || head.stdout.trim() !== branch) {
		return {
			kind: 'not-saved',
			dir,
			branch,
			detail:
				`its worktree is not on ${branch} (HEAD: ` +
				`${head.status === 0 ? head.stdout.trim() : 'detached, e.g. killed mid-rebase'}), ` +
				'so it cannot be saved automatically',
		};
	}

	note(
		`'${slug}': its crashed run left unsaved work in ${dir} ` +
			`(${RETAIN_REASON_TEXT[before.reason ?? 'unmerged-commits']}); saving it ` +
			`to ${branch} on the arbiter before releasing the lock.`,
	);
	const saved = await refWrite.saveWorkBranch({
		cwd: dir,
		slug,
		reason: `save a crashed run's local work before requeue`,
		arbiter: WORKTREE_ARBITER_REMOTE,
		branch,
		env,
		// The save half's own notes speak of a bounce; this is a requeue, so we
		// report from the outcome instead.
		note: () => {},
		...(options.backoff !== undefined ? {backoff: options.backoff} : {}),
		...(options.sleep !== undefined ? {sleep: options.sleep} : {}),
	});
	const committedResidue = saved.moveCommit !== undefined;

	const after = evaluateDeletionSafety({dir, branch, env});
	if (after.safe) {
		note(
			`Saved the crashed run's work: pushed ${branch}` +
				(committedResidue
					? ' (with a wip commit of its uncommitted files)'
					: '') +
				'.',
		);
		return {kind: 'saved', dir, branch, committedResidue};
	}
	const detail =
		saved.branchPush === 'failed'
			? `the push of ${branch} failed (${saved.pushError ?? 'unknown error'})`
			: `it is still ${RETAIN_REASON_TEXT[after.reason ?? 'unmerged-commits']}`;
	return {kind: 'not-saved', dir, branch, detail};
}
