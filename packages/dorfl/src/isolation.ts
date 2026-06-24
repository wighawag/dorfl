import {git} from './git.js';
import {createJob, type Job} from './workspace.js';
import {reapJob} from './gc.js';
import {
	branchAheadOfArbiter,
	rebaseContinuedBranchOntoMain,
	pushContinuedBranchWithStaleLeaseRetry,
} from './continue-branch.js';
import {workBranchRef, type SlugNamespace} from './slug-namespace.js';

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
 * Wiring a COMMAND to the in-place strategy is the `do-in-place` task — this
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
	/** The work branch checked out there (`work/<type>-<slug>`). */
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
	 * True iff this tree CONTINUED a kept arbiter `work/<slug>` branch (a requeue)
	 * rather than cutting fresh off main — the SAME continue-detection both
	 * onboarding paths use. The prompt assembly injects a CONTINUE block when set
	 * (the `agent-prompt-continue-context` task). Absent / false on a fresh cut.
	 */
	continued?: boolean;
	/**
	 * True iff a CONTINUE rebase onto fresh main CONFLICTED at onboard-time
	 * (a requeue kept a `work/<slug>` whose commits did not replay onto the
	 * current main; aborted, never auto-resolved). The pipeline routes the item
	 * to needs-attention (the §10 path) instead of running the agent. Absent /
	 * false on a fresh cut and on a clean continue.
	 */
	continueRebaseConflict?: boolean;
	/**
	 * Set iff the CONTINUE reconcile push to the arbiter FAILED TERMINALLY at
	 * onboard-time (the stale-lease retry cap exhausted, or a non-stale-lease
	 * rejection / unreachable arbiter) — the push helper THROWS, caught so the run
	 * does NOT crash leaving the task silently in-progress on the arbiter (the
	 * stale-lease-strand bug). The pipeline routes the item to needs-attention,
	 * the kept work left committed + recoverable on the branch. Absent on a fresh
	 * cut, a clean continue that pushed, and a rebase conflict (which sets
	 * {@link continueRebaseConflict} instead).
	 */
	continuePushFailure?: string;
	/**
	 * Tear the isolated tree down per the strategy. Job-worktree: re-apply the §4
	 * deletion-safety predicate and `git worktree remove`/prune the worktree ONLY
	 * if provably safe (`reapJob`). In-place: a NO-OP — the human's checkout is
	 * left in a defined state, NEVER reaped. Always safe to call (e.g. in a
	 * `finally`).
	 *
	 * `opts.reachableOnly` (job-worktree only) drops the clean-tree half of the
	 * predicate, keeping the reachable-on-arbiter half: a worktree whose durable
	 * branch is provably on the arbiter is reaped EVEN WHEN its tree has incidental
	 * churn. This is the FAILURE-path opt-in (`performDoRemote`'s needs-attention
	 * return, where the seam has already surfaced + pushed the branch), so a
	 * churn-dirty-but-arbiter-safe worktree does not linger to poison the next
	 * build. It NEVER reaps work not yet on the arbiter (reachability stands).
	 * The in-place teardown ignores it (still a no-op).
	 */
	teardown(opts?: {reachableOnly?: boolean}): void;
}

/** What a strategy needs to prepare an isolated tree for one work item. */
export interface PrepareInput {
	/** The work slug being processed (→ branch `work/<type>-<slug>`). */
	slug: string;
	/**
	 * The item TYPE — `'task'` for a build (intake/`do task:`), `'prd'` for a
	 * prd-tasking run (`do prd:`). It NAMESPACES the work branch via
	 * {@link workBranchRef} so a same-slug task and prd never collide on the
	 * arbiter branch. Defaults to `'task'` (the overwhelmingly-common build
	 * path); the prd-tasking path passes `'prd'` explicitly.
	 */
	type?: SlugNamespace;
	/**
	 * The sha of the claim commit (`claim: <slug>`) just landed on the arbiter,
	 * surfaced out of `performClaim`. The in-place FRESH path branches the work
	 * branch from THIS exact commit (and HARD-FAILS if it is unreachable from
	 * `<arbiter>/main`) — never a stale same-named branch or a not-yet-advanced
	 * local main. Absent on a resume/continue or when the caller has no claim
	 * commit (the job-worktree strategy ignores it).
	 */
	claimCommit?: string;
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
		prepare({slug, type, env}): IsolatedTree {
			const job: Job = createJob({
				fromRepo: options.fromRepo,
				arbiter: options.arbiter,
				slug,
				type: type ?? 'task',
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
		continued: job.continued,
		continueRebaseConflict: job.continueRebaseConflict,
		continuePushFailure: job.continuePushFailure,
		teardown(opts?: {reachableOnly?: boolean}): void {
			// Auto-reap at end-of-job (ADR §4): re-apply the provably-safe deletion
			// predicate and remove the worktree ONLY if it holds (clean tree AND the
			// branch tip reachable on the arbiter). NEVER `--force` here.
			//
			// `reachableOnly` (the FAILURE-path opt-in) drops the clean-tree half but
			// KEEPS reachability: a churn-dirty worktree whose durable branch is on
			// the arbiter is reaped (it would otherwise linger and poison the next
			// build's fetch); a worktree whose work is NOT yet on the arbiter is still
			// retained (never lose work).
			reapJob({
				dir: job.dir,
				branch: job.branch,
				mirrorPath: job.mirror.path,
				arbiter: job.arbiterRemote,
				reachableOnly: opts?.reachableOnly === true,
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
 * step the shared pipeline needs; it is unwired in this task.
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
		prepare({slug, type, claimCommit, env}): IsolatedTree {
			const branch = workBranchRef(type ?? 'task', slug);
			const arbiterUrl = git(['remote', 'get-url', arbiter], checkout, {
				env,
			}).trim();

			git(['fetch', '--quiet', arbiter], checkout, {env});

			// CONTINUE-detection (shared with the job-worktree path, ADR §14 keystone):
			// does the arbiter have a `work/<slug>` ref AHEAD of main (a requeue kept
			// it)? In a normal clone the refs are the remote-tracking
			// `<arbiter>/work/<slug>` and `<arbiter>/main`.
			let continued = false;
			let continueRebaseConflict = false;
			let continuePushFailure: string | undefined;
			// ARBITER-AUTHORITATIVE continue-detection: `ls-remote` the arbiter so a
			// STALE local remote-tracking ref (a plain `git fetch` does NOT prune
			// unless `fetch.prune` is set) pointing at a branch the arbiter no longer
			// has cannot resurrect a deleted branch as a "continue".
			if (
				branchAheadOfArbiter({
					cwd: checkout,
					arbiterRemote: arbiter,
					branch,
					branchRef: `${arbiter}/${branch}`,
					mainRef: `${arbiter}/main`,
					env,
				})
			) {
				continued = true;
				// The arbiter `work/<slug>` tip the fetch above brought down, READ BEFORE
				// the onboard rebase rewrites the local branch — the value the
				// --force-with-lease push expects the arbiter to still hold. In a normal
				// clone this lives in the remote-tracking ref `<arbiter>/<branch>` (the
				// rebase below rewrites only the LOCAL `<branch>`, so the tracking ref keeps
				// the pre-rebase arbiter sha). Captured here, threaded into the stale-lease
				// retry below so a requeue-continue that churns the ref after our fetch is
				// re-leased against the freshly-fetched tip rather than stranding the work.
				const expectedRemoteTip = git(
					['rev-parse', `${arbiter}/${branch}`],
					checkout,
					{env},
				).trim();
				// CONTINUE: land on the kept arbiter tip (force-reset a stale local copy
				// so we continue the SAME single branch), then REBASE onto fresh main at
				// onboard-time (ADR §10: rebase, not merge). A CLEAN rebase updates the
				// already-pushed tip with --force-with-lease on the WORK branch ONLY
				// (a requeued item is unshared) — NEVER --force, NEVER to main (§11),
				// SURVIVING a stale-lease ("stale info") rejection by re-fetching +
				// re-rebasing + retrying (the SAME helper `workspace.ts` uses). A
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
					// The helper THROWS on a terminal failure (the stale-lease retry cap, or
					// a non-stale-lease rejection / unreachable arbiter). CATCH it and flag
					// `continuePushFailure` so the caller routes the item to needs-attention
					// — the kept work stays committed + recoverable — rather than crashing
					// the run and stranding it silently in-progress (the stale-lease bug).
					try {
						const pushed = pushContinuedBranchWithStaleLeaseRetry({
							cwd: checkout,
							branch,
							arbiter,
							mainRef: `${arbiter}/main`,
							expectedRemoteTip,
							env,
						});
						if (pushed.kind === 'conflict') {
							continueRebaseConflict = true;
						}
					} catch (err) {
						continuePushFailure =
							err instanceof Error ? err.message : String(err);
					}
				}
			} else {
				// FRESH: put the checkout on the namespaced work branch cut from the
				// EXACT claim commit (the defensive onboarding guard). When a
				// `claimCommit` is threaded in (the normal `do` build path), assert it is
				// reachable from the freshly-fetched `<arbiter>/main` and force-RESET the
				// branch onto it with `-C` — so a stale same-named local branch (e.g. one
				// `intake` left behind, or a prior re-run) is RE-POINTED at the claim
				// commit, NEVER silently reused on a pre-claim base (the "nothing to
				// complete" defect). Mirrors the CONTINUE path's `-C`. A missing /
				// unreachable claim commit FAILS LOUDLY — never a silent stale-base build.
				if (claimCommit !== undefined) {
					assertClaimCommitReachable(
						checkout,
						claimCommit,
						`${arbiter}/main`,
						env,
					);
					git(['switch', '--quiet', '-C', branch, claimCommit], checkout, {
						env,
					});
				} else {
					// No claim commit (a bare resume / re-run with no claim in hand): cut
					// off the freshly-fetched `<arbiter>/main`; plain-switch a pre-existing
					// local branch.
					const created = gitSoftSwitch(
						['switch', '--quiet', '-c', branch, `${arbiter}/main`],
						checkout,
						env,
					);
					if (!created) {
						git(['switch', '--quiet', branch], checkout, {env});
					}
				}
			}

			return {
				dir: checkout,
				branch,
				arbiterRemote: arbiter,
				arbiterUrl,
				continued,
				continueRebaseConflict,
				continuePushFailure,
				// NO-OP teardown: the checkout is the human's / CI's tree — left on
				// `work/<slug>` in a defined state, NEVER reaped (ADR §2/§4). The
				// human's `complete` (or the runner) owns the branch lifecycle.
				// `reachableOnly` is irrelevant here (nothing is ever reaped in-place).
				teardown(): void {},
			};
		},
	};
}

/**
 * Assert the claim commit is reachable from `<arbiter>/main` (an ancestor),
 * throwing a CLEAR error if not — the LOUD-failure guard the FRESH onboarding
 * path uses before force-resetting the work branch onto the claim commit. A
 * not-yet-fetched or rolled-back arbiter main that does NOT reach the claim must
 * fail fast here, never silently build on a stale base.
 */
function assertClaimCommitReachable(
	checkout: string,
	claimCommit: string,
	mainRef: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	const reachable = gitSoftSwitch(
		['merge-base', '--is-ancestor', claimCommit, mainRef],
		checkout,
		env,
	);
	if (!reachable) {
		throw new Error(
			`onboarding '${claimCommit}' failed: the claim commit is not reachable ` +
				`from ${mainRef} (the claim push did not land, or local ${mainRef} is ` +
				'stale). Refusing to build on a stale base — re-fetch the arbiter and ' +
				'retry, or `requeue` the item.',
		);
	}
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
