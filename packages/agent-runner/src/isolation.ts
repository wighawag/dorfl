import {git, run} from './git.js';
import {createJob, type Job} from './workspace.js';
import {reapJob} from './gc.js';
import {
	branchAheadOf,
	rebaseContinuedBranchOntoMain,
} from './continue-branch.js';

/**
 * The **isolation-strategy seam** (`docs/adr/command-surface-and-journeys.md`
 * §3; substrate ADR §1/§2/§4): one seam, two strategies, selected by whether
 * there is a checkout —
 *
 *   - **in-place** — the current checkout (a human's clone, or the CI container)
 *     IS the isolation: claim + build + gate + integrate operate directly in the
 *     current working tree on its `work/<slug>` branch. NO hub mirror, NO
 *     external worktree, NO reap (the human's checkout is left in a defined
 *     state, never deleted).
 *   - **job-worktree** — materialise a hub mirror + an external job worktree in
 *     the agents' area (`workspacesDir`), EXACTLY as `run`'s `createJob` path
 *     does (ADR §1/§2), with end-of-job teardown re-applying the §4
 *     provably-safe deletion predicate (`reapJob`).
 *
 * The load-bearing design constraint is the **uniform handle** ({@link
 * IsolatedTree}): both strategies expose the SAME fields the post-claim pipeline
 * reads (`dir`/`branch`/`arbiterRemote`/`arbiterUrl`) plus a strategy-appropriate
 * `teardown`, so the shared build→gate→done-move→rebase→integrate→teardown steps
 * run against EITHER strategy without knowing WHERE the tree lives. This removes
 * the `Job`-shape coupling from the pipeline (`run`'s old `runOneItem` read a
 * concrete `Job`).
 *
 * Wiring a COMMAND to the in-place strategy is the `do-in-place` slice — this
 * module only provides the seam + both implementors; `run` keeps using the
 * job-worktree strategy (its observable behaviour is byte-identical).
 */

/**
 * The uniform handle the post-claim pipeline reads from — satisfied IDENTICALLY
 * by both strategies, so the shared steps never depend on a concrete `Job` (and
 * thus never assume a hub mirror / external worktree).
 */
export interface IsolatedTree {
	/**
	 * The working tree the agent + tests run in: the job worktree (job-worktree
	 * strategy) or the current checkout (in-place strategy).
	 */
	dir: string;
	/** The work branch checked out there (`work/<slug>`). */
	branch: string;
	/**
	 * The git remote NAME, VALID INSIDE `dir`, that tracks the arbiter — the
	 * rebase/integrate push target. Job-worktree: `origin` (the bare hub mirror's
	 * clone remote). In-place: the checkout's own arbiter remote name.
	 */
	arbiterRemote: string;
	/**
	 * The arbiter remote URL used for provider auto-detection (a GitHub URL ⇒ the
	 * `gh` provider). Job-worktree: the mirror's resolved arbiter URL
	 * (`job.mirror.url` today). In-place: the checkout's arbiter remote URL.
	 */
	arbiterUrl: string;
	/**
	 * True iff a CONTINUE rebase onto fresh main CONFLICTED at onboard-time
	 * (a requeue kept a `work/<slug>` whose commits did not replay onto the
	 * current main; aborted, never auto-resolved). The pipeline routes the item
	 * to needs-attention (the §10 path) instead of running the agent. Absent /
	 * false on a fresh cut and on a clean continue.
	 */
	continueRebaseConflict?: boolean;
	/**
	 * Tear the isolated tree down per the strategy. Job-worktree: re-apply the §4
	 * deletion-safety predicate and `git worktree remove`/prune the worktree ONLY
	 * if provably safe (`reapJob`). In-place: a NO-OP — the human's checkout is
	 * left in a defined state, NEVER reaped. Always safe to call (e.g. in a
	 * `finally`).
	 */
	teardown(): void;
}

/** What a strategy needs to prepare an isolated tree for one work item. */
export interface PrepareInput {
	/** The work slug being processed (→ branch `work/<slug>`). */
	slug: string;
	/** Environment for child git/agent processes. */
	env?: NodeJS.ProcessEnv;
}

/**
 * A way to acquire (and tear down) an isolated working tree on a freshly-fetched
 * main for a slug. The signatures stay SEMANTIC — "prepare an isolated tree;
 * expose a uniform handle; tear it down" — and DO NOT assume WHERE the tree
 * lives, so `do --remote`/`run` (job-worktree) and `do-in-place` (in-place) each
 * select their strategy without the pipeline knowing.
 */
export interface IsolationStrategy {
	/** Stable strategy name (for diagnostics / records). */
	readonly name: 'in-place' | 'job-worktree';
	/**
	 * Prepare an isolated working tree for `slug` on a freshly-fetched main and
	 * return the uniform handle. The handle's `teardown` reverses it per strategy.
	 */
	prepare(input: PrepareInput): IsolatedTree;
}

/**
 * The **job-worktree** strategy — `run`'s EXISTING isolation, extracted behind
 * the seam UNCHANGED. `prepare` ensures the hub mirror + cuts a per-job worktree
 * off the freshly-fetched `<hub>/main` (`createJob`); the handle's `teardown`
 * re-applies the §4 provably-safe deletion predicate (`reapJob`) — reaping the
 * worktree iff its work is clean AND on the arbiter, retaining it otherwise (the
 * never-lose-work signal). The arbiter remote inside the worktree is `origin`
 * (the bare mirror's clone remote), and provider detection keys off the mirror's
 * resolved arbiter URL — byte-identical to today's `run`.
 */
export function jobWorktreeStrategy(options: {
	/** A working repo to resolve the arbiter URL from (with `arbiter`). */
	fromRepo: string;
	/** Remote name in `fromRepo` whose URL to mirror (default `origin`). */
	arbiter?: string;
	/** The execution working area (config `workspacesDir`). */
	workspacesDir: string;
}): IsolationStrategy {
	return {
		name: 'job-worktree',
		prepare({slug, env}): IsolatedTree {
			const job: Job = createJob({
				fromRepo: options.fromRepo,
				arbiter: options.arbiter,
				slug,
				workspacesDir: options.workspacesDir,
				env,
			});
			return jobWorktreeHandle(job, env);
		},
	};
}

/**
 * Build the uniform handle for a job-worktree `Job` — the EXACT fields `run`'s
 * pipeline read off `job` today (`dir`/`branch`/`arbiterRemote`/`mirror.url`)
 * plus the `reapJob` teardown. Exposed so a caller that already created the
 * `Job` (e.g. `run`'s pipeline, mid-extraction) can wrap it without re-creating.
 */
export function jobWorktreeHandle(
	job: Job,
	env: NodeJS.ProcessEnv | undefined,
): IsolatedTree {
	return {
		dir: job.dir,
		branch: job.branch,
		arbiterRemote: job.arbiterRemote,
		arbiterUrl: job.mirror.url,
		continueRebaseConflict: job.continueRebaseConflict,
		teardown(): void {
			// Auto-reap at end-of-job (ADR §4): re-apply the provably-safe deletion
			// predicate and remove the worktree ONLY if it holds (clean tree AND the
			// branch tip reachable on the arbiter). NEVER `--force` here.
			reapJob({
				dir: job.dir,
				branch: job.branch,
				mirrorPath: job.mirror.path,
				arbiter: job.arbiterRemote,
				env,
			});
		},
	};
}

/**
 * The **in-place** strategy — the current checkout (a human's clone, or the CI
 * container) IS the isolation. `prepare` fetches the arbiter and switches the
 * checkout to `work/<slug>` cut from the freshly-fetched `<arbiter>/main` (the
 * SAME "every worktree is cut from a fresh main" guarantee, ADR §6), WITHOUT a
 * hub mirror or external worktree. The handle's `arbiterRemote`/`arbiterUrl` come
 * from the checkout's own arbiter remote; `teardown` is a NO-OP — the checkout is
 * left in a defined state on `work/<slug>`, NEVER reaped (it is the human's tree
 * / the only copy of CI's work).
 *
 * NOTE: this strategy assumes the slug is already CLAIMED (the same contract as
 * the job-worktree strategy, whose caller claims before `prepare`). It does not
 * itself claim — `do-in-place` composes the claim (and `start`/`complete`) around
 * the seam. `prepare` here is the thin "put the checkout on a fresh work branch"
 * step the shared pipeline needs; it is unwired in this slice.
 */
export function inPlaceStrategy(options: {
	/** The current checkout to operate in. */
	checkout: string;
	/** Name of the checkout's arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
}): IsolationStrategy {
	const arbiter = options.arbiter ?? 'origin';
	const checkout = options.checkout;
	return {
		name: 'in-place',
		prepare({slug, env}): IsolatedTree {
			const branch = `work/${slug}`;
			const arbiterUrl = git(['remote', 'get-url', arbiter], checkout, {
				env,
			}).trim();

			git(['fetch', '--quiet', arbiter], checkout, {env});

			// CONTINUE-detection (shared with the job-worktree path, ADR §14 keystone):
			// does the arbiter have a `work/<slug>` ref AHEAD of main (a requeue kept
			// it)? In a normal clone the refs are the remote-tracking
			// `<arbiter>/work/<slug>` and `<arbiter>/main`.
			let continueRebaseConflict = false;
			if (
				branchAheadOf(checkout, `${arbiter}/${branch}`, `${arbiter}/main`, env)
			) {
				// CONTINUE: land on the kept arbiter tip (force-reset a stale local copy
				// so we continue the SAME single branch), then REBASE onto fresh main at
				// onboard-time (ADR §10: rebase, not merge). A CLEAN rebase updates the
				// already-pushed tip with --force-with-lease on the WORK branch ONLY
				// (a requeued item is unshared) — NEVER --force, NEVER to main (§11). A
				// CONFLICT is aborted (never auto-resolved) + flagged for the caller to
				// route to needs-attention.
				git(
					['switch', '--quiet', '-C', branch, `${arbiter}/${branch}`],
					checkout,
					{env},
				);
				const rebase = rebaseContinuedBranchOntoMain(
					checkout,
					`${arbiter}/main`,
					env,
				);
				if (rebase.kind === 'conflict') {
					continueRebaseConflict = true;
				} else {
					run(
						'git',
						[
							'push',
							arbiter,
							`${branch}:${branch}`,
							`--force-with-lease=${branch}`,
						],
						checkout,
						{env},
					);
				}
			} else {
				// FRESH: put the checkout on `work/<slug>` cut from the freshly-fetched
				// `<arbiter>/main` (the same fresh-main guarantee as the job worktree).
				// If the branch already exists locally (resume / re-run), switch to it
				// instead of re-creating.
				const created = gitSoftSwitch(
					['switch', '--quiet', '-c', branch, `${arbiter}/main`],
					checkout,
					env,
				);
				if (!created) {
					git(['switch', '--quiet', branch], checkout, {env});
				}
			}

			return {
				dir: checkout,
				branch,
				arbiterRemote: arbiter,
				arbiterUrl,
				continueRebaseConflict,
				// NO-OP teardown: the checkout is the human's / CI's tree — left on
				// `work/<slug>` in a defined state, NEVER reaped (ADR §2/§4). The
				// human's `complete` (or the runner) owns the branch lifecycle.
				teardown(): void {},
			};
		},
	};
}

/** Try a git switch; return true on success, false on non-zero (no throw). */
function gitSoftSwitch(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	try {
		git(args, cwd, {env});
		return true;
	} catch {
		return false;
	}
}

/** How {@link selectIsolationStrategy} chooses between the two strategies. */
export interface SelectIsolationInput {
	/**
	 * The current checkout, when there IS one (the human's clone / CI container).
	 * Its presence selects the **in-place** strategy. Absent ⇒ the **job-worktree**
	 * strategy (materialise a mirror + worktree in the agents' area).
	 */
	checkout?: string;
	/**
	 * A working repo to resolve the arbiter URL from for the job-worktree
	 * strategy (with `arbiter`). Required when `checkout` is absent.
	 */
	fromRepo?: string;
	/** Arbiter remote name (default `origin`), used by either strategy. */
	arbiter?: string;
	/** The execution working area for the job-worktree strategy (`workspacesDir`). */
	workspacesDir?: string;
}

/**
 * Select the isolation strategy by **"is there a checkout"** (ADR §3) — NOT a
 * hardcoded path:
 *
 *   - `checkout` present ⇒ {@link inPlaceStrategy} (the checkout IS the
 *     isolation; `do <slug>` in a checkout, the in-place human path).
 *   - `checkout` absent ⇒ {@link jobWorktreeStrategy} (mirror + worktree in the
 *     agents' area; `do --remote` / `run`).
 *
 * Both yield the same uniform handle, so the caller's pipeline is identical
 * regardless of which strategy was selected.
 */
export function selectIsolationStrategy(
	input: SelectIsolationInput,
): IsolationStrategy {
	if (input.checkout !== undefined) {
		return inPlaceStrategy({
			checkout: input.checkout,
			arbiter: input.arbiter,
		});
	}
	if (input.fromRepo === undefined || input.workspacesDir === undefined) {
		throw new Error(
			'selectIsolationStrategy: the job-worktree strategy (no checkout) ' +
				'requires both `fromRepo` and `workspacesDir`.',
		);
	}
	return jobWorktreeStrategy({
		fromRepo: input.fromRepo,
		arbiter: input.arbiter,
		workspacesDir: input.workspacesDir,
	});
}
