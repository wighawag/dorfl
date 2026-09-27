import {runAsync, type RunResult} from './git.js';
import {
	pushContinuedBranchWithStaleLeaseRetry,
	type ContinuedPushResult,
} from './continue-branch.js';
import {
	routeToNeedsAttention,
	deleteRemoteWorkBranchIfPresent,
	type RouteToNeedsAttentionOptions,
	type RouteToNeedsAttentionResult,
	type DeleteRemoteWorkBranchOptions,
	type DeleteRemoteWorkBranchResult,
} from './needs-attention.js';
import {
	pushTreelessResult,
	type PushTreelessResultParams,
} from './advance-treeless-publish.js';

/**
 * The **ref-write seam**: the sibling of the ledger-transition write seam
 * ({@link import('./ledger-write.js').LedgerWriteStrategy}) for every network
 * write a CI code path reaches that is NOT a `work/` ledger transition, the
 * review provider, the issue provider or the integrator: the per-item lock ref
 * create / amend / leased delete, the continued work-branch rebase push, the
 * work-branch save (commit WIP + push, without a surface), the remote work-branch
 * delete, the tasking candidates branch push and the tree-less `HEAD:main`
 * publish.
 *
 * Why it exists (spec `ci-agent-job-without-write-token`, ADR
 * `ci-agent-job-holds-no-write-token`, task
 * `ci-split-route-direct-writes-through-seams`): the CI phase mode records every
 * write in the agent phase and performs it in the apply phase, so every write
 * must be VISIBLE at a seam. Before this seam these sites pushed directly.
 *
 * It is a PURE REFACTOR, the same shape as the ledger seam: exactly ONE strategy
 * ({@link currentRefWrite}) that does exactly what each call site did before (the
 * same git argument lists, the same helpers), no mode, no config. Each method is
 * named for the write's INTENT, not the git plumbing, so a recording strategy can
 * capture "what was about to be written" rather than a raw argument list.
 *
 * A test swaps a method with `vi.spyOn(refWrite, '<method>')` (the same pattern
 * the `ledgerWrite` / `ledgerRead` seams use). The guard test
 * `write-sites-through-seams.test.ts` fails on any new direct `git push` or `gh`
 * write outside the seam implementations and the documented exempt sites.
 */
export interface RefWriteStrategy {
	/**
	 * CREATE a per-item lock ref on the arbiter: push `<commit>:<ref>` with the
	 * create-only lease `--force-with-lease=<ref>:` (succeeds iff the ref is
	 * absent). Returns the raw push result; the caller interprets it (`acquired`
	 * vs contended). CI phase: lock.
	 */
	createLockRef(input: LockRefCreateInput): Promise<RunResult>;
	/**
	 * AMEND a held per-item lock ref in place: push `<commit>:<ref>` leased on
	 * the sha the caller just read (`--force-with-lease=<ref>:<expectedSha>`).
	 * CI phase: apply.
	 */
	amendLockRef(input: LockRefAmendInput): Promise<RunResult>;
	/**
	 * DELETE a held per-item lock ref on the arbiter, leased on the sha the caller
	 * read (`push --delete <ref> --force-with-lease=<ref>:<expectedSha>`). CI
	 * phase: apply (the lease is on the lock job's `lockSha`).
	 */
	deleteLockRef(input: LockRefDeleteInput): Promise<RunResult>;
	/**
	 * Push the CONTINUED (rebased) kept `work/<slug>` branch with a lease on the
	 * tip observed before the rebase, surviving a stale lease by re-fetching and
	 * re-rebasing (see {@link pushContinuedBranchWithStaleLeaseRetry}). Throws
	 * exactly as that helper does. CI phase: apply (ADR decision 7).
	 */
	pushContinuedBranch(input: ContinuedBranchPushInput): ContinuedPushResult;
	/**
	 * Push an already-rebased work branch ONCE with a lease on the tip observed
	 * earlier (`<commit>:refs/heads/<branch>
	 * --force-with-lease=refs/heads/<branch>:<expectedTip>`), with NO retry and NO
	 * re-rebase: a stale lease is returned for the caller to report. The CI apply
	 * phase's continue push (ADR `ci-agent-job-holds-no-write-token` decision 7:
	 * the agent job rebased the kept branch locally, and the lease is the lock
	 * job's `continueTip`). CI phase: apply.
	 */
	pushLeasedWorkBranch(input: LeasedWorkBranchPushInput): Promise<RunResult>;
	/**
	 * SAVE the work branch: commit any uncommitted work as a wip commit and push
	 * the work branch to the arbiter, WITHOUT surfacing the item (the recoverable
	 * half of a needs-attention route, see {@link routeToNeedsAttention}). Used by
	 * the deadline checkpoint save. CI phase: apply.
	 */
	saveWorkBranch(
		input: RouteToNeedsAttentionOptions,
	): Promise<RouteToNeedsAttentionResult>;
	/**
	 * DELETE the remote `work/task-<slug>` branch on the arbiter (write-through:
	 * local refs first, then the arbiter delete; already-gone is tolerated, see
	 * {@link deleteRemoteWorkBranchIfPresent}). CI phase: apply.
	 */
	deleteRemoteWorkBranch(
		input: DeleteRemoteWorkBranchOptions,
	): Promise<DeleteRemoteWorkBranchResult>;
	/**
	 * Push the tasking candidates branch (`work/spec-<slug>`) to the arbiter, a
	 * plain `git push <arbiter> <branch>` (best-effort at the caller). CI phase:
	 * apply.
	 */
	pushTaskingCandidatesBranch(
		input: TaskingCandidatesPushInput,
	): Promise<RunResult>;
	/**
	 * Publish a tree-less rung's local commit to the arbiter's `main` (`git push
	 * HEAD:main` with the bounded re-fetch + rebase retry, never `--force`, see
	 * {@link pushTreelessResult}). CI phase: apply.
	 */
	publishTreelessResult(input: PushTreelessResultParams): Promise<void>;
}

/** Input of {@link RefWriteStrategy.createLockRef}. */
export interface LockRefCreateInput {
	/** The arbiter remote name. */
	arbiter: string;
	/** The full lock ref (`refs/dorfl/lock/<entry>`). */
	ref: string;
	/** The prepared (parentless) lock commit to publish at {@link ref}. */
	commit: string;
	/** Working clone the push runs in. */
	cwd: string;
	/** Environment for the child git process. */
	env: NodeJS.ProcessEnv | undefined;
}

/** Input of {@link RefWriteStrategy.amendLockRef}. */
export interface LockRefAmendInput extends LockRefCreateInput {
	/** The ref's sha the caller read; the push is leased on it. */
	expectedSha: string;
}

/** Input of {@link RefWriteStrategy.deleteLockRef}. */
export interface LockRefDeleteInput {
	/** The arbiter remote name. */
	arbiter: string;
	/** The full lock ref (`refs/dorfl/lock/<entry>`). */
	ref: string;
	/** The ref's sha the caller read; the delete is leased on it. */
	expectedSha: string;
	/** Working clone the push runs in. */
	cwd: string;
	/** Environment for the child git process. */
	env: NodeJS.ProcessEnv | undefined;
}

/** Input of {@link RefWriteStrategy.pushContinuedBranch}. */
export type ContinuedBranchPushInput = Parameters<
	typeof pushContinuedBranchWithStaleLeaseRetry
>[0];

/** Input of {@link RefWriteStrategy.pushLeasedWorkBranch}. */
export interface LeasedWorkBranchPushInput {
	/** The arbiter remote name. */
	arbiter: string;
	/** The work branch (`work/task-<slug>`), unqualified. */
	branch: string;
	/** The commit to publish as the branch's tip. */
	commit: string;
	/** The branch tip the caller observed on the arbiter; the push is leased on it. */
	expectedTip: string;
	/** Working clone the push runs in. */
	cwd: string;
	/** Environment for the child git process. */
	env: NodeJS.ProcessEnv | undefined;
}

/** Input of {@link RefWriteStrategy.pushTaskingCandidatesBranch}. */
export interface TaskingCandidatesPushInput {
	/** The arbiter remote name. */
	arbiter: string;
	/** The candidates branch (`work/spec-<slug>`). */
	branch: string;
	/** Working clone the push runs in. */
	cwd: string;
	/** Environment for the child git process. */
	env: NodeJS.ProcessEnv | undefined;
}

/**
 * The ONLY ref-write strategy: current behaviour, the exact git argument lists
 * and helpers the call sites used before they were routed through the seam.
 */
export const currentRefWrite: RefWriteStrategy = {
	createLockRef({arbiter, ref, commit, cwd, env}) {
		return runAsync(
			'git',
			['push', arbiter, `${commit}:${ref}`, `--force-with-lease=${ref}:`],
			cwd,
			{env},
		);
	},

	amendLockRef({arbiter, ref, commit, expectedSha, cwd, env}) {
		return runAsync(
			'git',
			[
				'push',
				arbiter,
				`${commit}:${ref}`,
				`--force-with-lease=${ref}:${expectedSha}`,
			],
			cwd,
			{env},
		);
	},

	deleteLockRef({arbiter, ref, expectedSha, cwd, env}) {
		return runAsync(
			'git',
			[
				'push',
				arbiter,
				'--delete',
				ref,
				`--force-with-lease=${ref}:${expectedSha}`,
			],
			cwd,
			{env},
		);
	},

	pushContinuedBranch(input) {
		return pushContinuedBranchWithStaleLeaseRetry(input);
	},

	pushLeasedWorkBranch({arbiter, branch, commit, expectedTip, cwd, env}) {
		const ref = `refs/heads/${branch}`;
		return runAsync(
			'git',
			[
				'push',
				arbiter,
				`${commit}:${ref}`,
				`--force-with-lease=${ref}:${expectedTip}`,
			],
			cwd,
			{env},
		);
	},

	saveWorkBranch(input) {
		return routeToNeedsAttention(input);
	},

	deleteRemoteWorkBranch(input) {
		return deleteRemoteWorkBranchIfPresent(input);
	},

	pushTaskingCandidatesBranch({arbiter, branch, cwd, env}) {
		return runAsync('git', ['push', arbiter, branch], cwd, {env});
	},

	publishTreelessResult(input) {
		return pushTreelessResult(input);
	},
};

/**
 * The active ref-write strategy. There is exactly one (current behaviour); this
 * indirection is the seam's single insertion point, NOT a selectable mode. Call
 * sites go through `refWrite.<method>(...)` so a test (and later the CI phase
 * mode) can replace a method on this object.
 */
export const refWrite: RefWriteStrategy = {...currentRefWrite};
