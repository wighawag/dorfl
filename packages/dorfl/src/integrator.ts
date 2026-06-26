import type {IntegrationMode} from './config.js';
import {git, run} from './git.js';
import {isAncestor} from './gc.js';
import type {BackoffOptions, Sleep} from './retry-backoff.js';
import {pushProposeBranchWithStaleLeaseRetry} from './continue-branch.js';

/**
 * The **integration seam** (ADR §6): integrating a completed work branch back to
 * the arbiter has two orthogonal axes —
 *
 *   - **mode**: `merge` (ff/rebase onto `<arbiter>/main`, push to main —
 *     provider-agnostic git) or `propose` (push the branch + request review).
 *   - **provider** (a seam): the review-request tool — `github` (its own task)
 *     or **`none`** (push + tell the human to open a request manually, the only
 *     option for a local `--bare` arbiter, which has no review concept).
 *
 * The **universal, safety-bearing action is `git push`** to the arbiter; the
 * review request is layered on top and provider-specific. Deletion safety
 * (ADR §4) rides on the push, never the provider step — a provider failure
 * leaves a safe, pushed branch, not lost work. We NEVER `--force` to main.
 *
 * Before integrating, `integrateWithRebase` rebases the branch onto the latest
 * `<arbiter>/main` (ADR §10): clean → proceed; conflict → `git rebase --abort` +
 * route to `needs-attention` (NEVER auto-resolve).
 */

/** The review-request provider seam. `none` and (later) `github` implement it. */
export interface ReviewProvider {
	/** Stable provider name stamped into results (`none`, `github`, …). */
	readonly name: string;
	/**
	 * Request review of an already-pushed branch. The branch is guaranteed to be
	 * on the arbiter before this is called (the push is the safety guarantee), so
	 * a provider failure never loses work. ASYNC: a real provider RETRIES the
	 * request with bounded backoff on a transient OUTAGE before degrading (a
	 * LOW-severity mode — the branch is already safe, only the review surface is
	 * missing), driven by an injectable sleep so tests need no real waits.
	 */
	openRequest(input: OpenRequestInput): Promise<OpenRequestResult>;
	/**
	 * Post a follow-up COMMENT on an already-opened review request (the PR the
	 * sibling {@link openRequest} created), threaded by its `url`. Used by the
	 * Gate-2 review-comment poster (task `review-gate-pr-comment`) to make the
	 * review's verdict VISIBLE on the PR. It is the SIBLING of `openRequest` on the
	 * "write text to the PR" surface: `openRequest` writes the creation BODY,
	 * `postPRComment` writes a follow-up comment AFTER the PR exists.
	 *
	 * Keyed by the PR `url` (the review-request surface). The issue seam's sibling
	 * `postIssueComment` (`issue-provider.ts`) is keyed by the ISSUE NUMBER instead —
	 * GitHub shares the comment id space, but other providers may not, so the two
	 * comment surfaces are nominally DISTINCT seams (distinct input types).
	 *
	 * ADVISORY — it gates nothing; like `openRequest` it must NEVER throw (a
	 * missing/unauthenticated `gh`, or the `none` provider, DEGRADES: it surfaces
	 * the text in the result `instruction`, never losing the review — ADR §6).
	 */
	postPRComment(input: PostPRCommentInput): PostPRCommentResult;
	/**
	 * Post a follow-up COMMENT on the PR opened for an already-pushed `work/<slug>`
	 * BRANCH, RESOLVING the PR from that branch instead of being handed its `url`.
	 * This is the FALLBACK for the audit-trail gap where `gh pr create` opened a PR
	 * (exit 0) but dorfl could not PARSE the PR url out of its stdout: the
	 * sibling {@link openRequest} then returns `{opened: true}` with NO `url`, so the
	 * url-keyed {@link postPRComment} has nothing to thread on. Given the branch, a
	 * real provider resolves its open PR (`gh pr comment <branch>` / `gh pr view
	 * <branch>`) and comments — closing the gap where a genuinely-opened PR's review
	 * was silently dropped.
	 *
	 * It is the BRANCH-keyed twin of {@link postPRComment} (which is URL-keyed); the
	 * core prefers the url path when it HAS a url and only falls back here when a PR
	 * was opened without a parseable url. The `posted` flag reports whether a comment
	 * was actually posted; when NO PR can be resolved from the branch at all it is a
	 * clean no-op (`posted: false`) — the honest "no PR ⇒ no comment" outcome, but
	 * only AFTER trying to resolve one.
	 *
	 * ADVISORY — it gates nothing; like the others it must NEVER throw (a
	 * missing/unauthenticated `gh`, the `none` provider, or no resolvable PR all
	 * DEGRADE: surface the text in the result `instruction`, never losing the
	 * review — ADR §6).
	 */
	postPRCommentOnBranch(input: PostPRCommentOnBranchInput): PostPRCommentResult;
}

export interface PostPRCommentInput {
	cwd: string;
	/**
	 * The URL of the opened review request (the PR) to comment on — the `url`
	 * {@link OpenRequestResult} returned. The GitHub provider passes it to
	 * `gh pr comment <url>`; absent ⇒ the caller should not call postPRComment (no
	 * PR to comment on).
	 */
	url: string;
	/** The comment body (the verbatim review prose, JSON block stripped). */
	body: string;
	env?: NodeJS.ProcessEnv;
}

export interface PostPRCommentOnBranchInput {
	cwd: string;
	/**
	 * The pushed `work/<slug>` branch whose open PR to RESOLVE and comment on — the
	 * branch {@link OpenRequestInput.branch} opened a PR for. The GitHub provider
	 * passes it to `gh pr view <branch>` / `gh pr comment <branch>`; a provider that
	 * cannot resolve a PR from it cleanly no-ops (nothing to comment on).
	 */
	branch: string;
	/** The comment body (the verbatim review prose, JSON block stripped). */
	body: string;
	env?: NodeJS.ProcessEnv;
}

export interface PostPRCommentResult {
	/** True iff a comment was actually posted (a real, authenticated provider). */
	posted: boolean;
	/** Human-readable confirmation / fallback (the verdict text on degrade). */
	instruction: string;
}

export interface OpenRequestInput {
	cwd: string;
	/** The pushed work branch to request review of. */
	branch: string;
	/** The arbiter remote the branch was pushed to. */
	arbiter: string;
	/**
	 * Optional explicit, single-line review-request TITLE. When present a provider
	 * passes it verbatim (e.g. `gh pr create --title`) instead of deriving the
	 * title from the commit subject (`--fill`), which can be a multi-line run-on.
	 * Synthesised runner-side from the task frontmatter (`<type>(<slug>): <title>`,
	 * capped to one line). Absent ⇒ today's `--fill`-derived title (no regression).
	 */
	title?: string;
	/**
	 * Optional review-request BODY/description (advisory prose — it gates nothing).
	 * When present a provider passes it verbatim (e.g. `gh pr create --body`)
	 * instead of `--fill`'s empty/commit-derived description. Typically the build
	 * agent's final summary, optionally under a runner-scaffolded header (a pointer
	 * to `work/done/<slug>.md` + the prd/ADR it serves). Absent ⇒ today's `--fill`
	 * (no regression). This is the BODY-AT-OPEN surface; a follow-up PR COMMENT is
	 * a separate provider method.
	 */
	body?: string;
	env?: NodeJS.ProcessEnv;
	/**
	 * Bounded-backoff bounds for the provider's review-request retry (the OUTAGE-
	 * retry of e.g. `gh pr create`). Defaults to the shared `DEFAULT_BACKOFF`.
	 */
	backoff?: BackoffOptions;
	/**
	 * Injectable sleep for that backoff (tests drive the retry timeline with NO
	 * real waits — the `run.ts` `sleep`/`realSleep` seam). Defaults to a real
	 * `setTimeout`.
	 */
	sleep?: Sleep;
}

export interface OpenRequestResult {
	/** True iff a review request was actually opened (a real provider). */
	opened: boolean;
	/** Human-readable next step / confirmation. */
	instruction: string;
	/**
	 * The URL of the opened review request (e.g. a GitHub PR), when a provider
	 * created one and could report it. Absent for push-only / degraded paths.
	 */
	url?: string;
}

/**
 * The graceful-degradation provider (ADR §6): it opens NO review request (there
 * is no API — e.g. a local `--bare` arbiter) and instead tells the human to open
 * one manually. The branch is already pushed, so the work is safe regardless.
 */
export class NoneProvider implements ReviewProvider {
	readonly name = 'none';

	async openRequest(input: OpenRequestInput): Promise<OpenRequestResult> {
		return {
			opened: false,
			instruction:
				`Pushed ${input.branch} to ${input.arbiter}. Open a review request ` +
				'manually to land it on main (no review provider configured).' +
				manualRequestText(input),
		};
	}

	/**
	 * No API to post a comment (a local `--bare` arbiter has no review concept), so
	 * DEGRADE: surface the review text in the result instead of throwing — the
	 * verdict stays in the run output, never lost (ADR §6). The caller treats this
	 * as a clean no-op for the PR (nothing was posted).
	 */
	postPRComment(input: PostPRCommentInput): PostPRCommentResult {
		return {
			posted: false,
			instruction:
				'No review provider configured — the review was not posted as a PR ' +
				`comment. The review:\n${input.body}`,
		};
	}

	/**
	 * No API to resolve a PR from a branch (a local `--bare` arbiter has no review
	 * concept), so DEGRADE exactly like {@link postPRComment}: surface the review
	 * text, post nothing, never throw. A clean no-op for the PR.
	 */
	postPRCommentOnBranch(
		input: PostPRCommentOnBranchInput,
	): PostPRCommentResult {
		return {
			posted: false,
			instruction:
				'No review provider configured — the review was not posted as a PR ' +
				`comment. The review:\n${input.body}`,
		};
	}
}

export interface IntegrateInput {
	cwd: string;
	/** The arbiter remote name. */
	arbiter: string;
	/** The work branch to integrate (`work/<slug>`). */
	branch: string;
	/** Integration mode (`propose` default, or `merge`). */
	mode: IntegrationMode;
	/**
	 * Optional single-line review-request TITLE threaded to the provider (propose
	 * mode). Absent ⇒ the provider's `--fill` default. Ignored in `merge` mode
	 * (no review request is opened).
	 */
	title?: string;
	/**
	 * Optional review-request BODY threaded to the provider (propose mode). Absent
	 * ⇒ the provider's `--fill` default. Ignored in `merge` mode.
	 */
	body?: string;
	/**
	 * **The PR-INTENT axis** (config `noPR`, ADR §6). When `true` on the `propose`
	 * path, push the branch (the safety-bearing step) but SKIP `openRequest` — the
	 * explicit suppress-PR intent (re-homing the old `provider: none` use). No
	 * warning: the no-PR outcome is intended. It does NOT pick a provider; the
	 * arbiter-derived provider is simply not asked to open a request. Ignored in
	 * `merge` mode (it never opens a request).
	 */
	noPR?: boolean;
	/**
	 * **Reap the remote head branch INLINE after a merge lands** (this task's part
	 * (b)). When `true` on the `merge` path, AFTER the work landed on `main` (the
	 * commits are now provably on main, so the ancestor predicate trivially holds),
	 * delete the remote `work/<slug>` head branch via `git push <arbiter> --delete`
	 * — the cross-machine counterpart of the worktree reap, done at the exact merge
	 * moment so no sweep is needed for the we-merged case. IDEMPOTENT: when no
	 * remote head exists (the plain `${branch}:main` push opened none), the delete is
	 * a clean best-effort no-op. NEVER `--force` (a just-merged ref needs none). The
	 * autonomous complete path sets this on; the direct `integrate` callers / tests
	 * leave it off, so the bare `${branch}:main` push is byte-for-byte unchanged.
	 * Ignored in `propose` mode (the branch is the review surface — it is reaped
	 * later by the `gc --remote-branches` sweep once its PR merges).
	 */
	deleteMergedHead?: boolean;
	env?: NodeJS.ProcessEnv;
	/** Bounded-backoff bounds for the provider's review-request retry. */
	backoff?: BackoffOptions;
	/** Injectable sleep for that backoff (tests; defaults to real `setTimeout`). */
	sleep?: Sleep;
}

export interface IntegrateResult {
	mode: IntegrationMode;
	/** True when the work landed on the arbiter's `main` (merge mode). */
	mergedToMain: boolean;
	/**
	 * **Race-1 non-fast-forward signal** (merge mode): set `true` when the
	 * `${branch}:main` push was REJECTED non-fast-forward because a SIBLING advanced
	 * `<arbiter>/main` during the push window (and our commit is NOT already on main
	 * — the idempotency probe ruled that out). The work did NOT land; the caller
	 * (integration-core's step-4 tail) must re-fetch + re-rebase (reconciling
	 * sibling-ledger divergence) + retry the push, up to its bounded cap. Absent on a
	 * clean (or idempotent-landed) merge.
	 */
	mergeNonFastForward?: boolean;
	/** The ref the work was pushed to (`main` for merge, the branch for propose). */
	pushedRef: string;
	/** The provider name used (propose mode); `none` in merge mode. */
	provider: string;
	/** True iff a review request was opened (propose + a real provider). */
	requestOpened: boolean;
	/**
	 * **BENIGN already-landed race tail** (propose mode — task
	 * `propose-push-survives-stale-lease-on-reaped-work-ref`): set `true` when
	 * the propose push observed a GONE `work/<slug>` ref on the arbiter AND the
	 * work was provably reachable from `<arbiter>/main` (an earlier merge had
	 * already landed it + reaped the head). The result is a CLEAN no-op: no push
	 * (or no completed push), no review request attempted against a vanished
	 * ref, distinct from a real push failure. Absent on the normal pushed-and-
	 * proposed path and in merge mode (merge has its own `mergedToMain`).
	 */
	alreadyLanded?: boolean;
	/** Human-readable next step (propose mode). */
	instruction?: string;
	/**
	 * The URL of the opened review request (e.g. a GitHub PR), when a provider
	 * created one and reported it. Recorded in the job record / surfaced by
	 * `status`. Absent in merge mode and on the push-only / degraded path.
	 */
	url?: string;
	/**
	 * The SHA that LANDED on the arbiter's `main` (the MERGE-mode twin of {@link
	 * url}). Populated only on the merge path — the work branch's tip is exactly
	 * what `${branch}:main` pushed. ADDITIVE + optional, so existing `do`/`run`/
	 * `complete` callers are unaffected; intake reads it to link the landed commit
	 * in its completion comment. Absent in propose mode (the PR `url` is the link
	 * there) and best-effort on merge (a failed tip read simply omits it).
	 */
	commit?: string;
}

/** Outcome of the full rebase-then-integrate flow. */
export interface IntegrateWithRebaseResult {
	outcome: 'integrated' | 'needs-attention';
	/** Set when `integrated`. */
	integration?: IntegrateResult;
	/** Set when `needs-attention` (e.g. a rebase conflict). */
	reason?: string;
}

export interface IntegratorOptions {
	/** The review-request provider (default: the `none` provider). */
	provider?: ReviewProvider;
}

export class Integrator {
	private readonly provider: ReviewProvider;

	constructor(options: IntegratorOptions = {}) {
		this.provider = options.provider ?? new NoneProvider();
	}

	/**
	 * Integrate WITHOUT rebasing (assumes the caller already rebased, or the
	 * branch is known up-to-date). `merge` pushes the branch to `main` (plain,
	 * non-force push); `propose` pushes the branch under its own ref + asks the
	 * provider to request review. NEVER `--force` (and NEVER force-touches main).
	 */
	async integrate(input: IntegrateInput): Promise<IntegrateResult> {
		if (input.mode === 'merge') {
			// Race-1 (claim-vs-integrate): push `${branch}:main` ONCE. On a
			// non-fast-forward rejection (a sibling same-repo claim/integrate advanced
			// `<arbiter>/main` during our push window) report it so the integration-core
			// step-4 tail re-rebases (with its sibling-ledger reconcile) + retries the
			// push. We never rebase here (that would miss the ledger reconcile arms) and
			// never `--force` main.
			const pushed = mergePushOnce(input);
			if (pushed.kind === 'non-fast-forward') {
				// Signal the caller to re-rebase via step-4 and call integrate again.
				return {
					mode: 'merge',
					mergedToMain: false,
					pushedRef: 'main',
					provider: 'none',
					requestOpened: false,
					mergeNonFastForward: true,
				};
			}
			// Capture the SHA that LANDED on `main` — the work branch's tip is exactly
			// what `${branch}:main` pushed (additive `commit?`, the merge-mode twin of
			// propose's `url`). Best-effort: a failed read leaves `commit` absent, so a
			// caller that links it (intake) simply omits the link rather than throwing.
			const commit = resolveBranchTip(input);
			// Part (b): reap the remote head INLINE now the merge has landed. The work
			// is on `main` (we just pushed it there), so the head is provably merged and
			// safe to delete — the exact merge moment, no sweep needed. Idempotent +
			// best-effort: a no-remote-head merge (the common `${branch}:main` push) is a
			// clean no-op. NEVER `--force`. Gated by `deleteMergedHead` so the bare
			// `integrate` callers / tests are unchanged.
			if (input.deleteMergedHead === true) {
				deleteMergedHeadBranch(input);
			}
			return {
				mode: 'merge',
				mergedToMain: true,
				pushedRef: 'main',
				provider: 'none',
				requestOpened: false,
				...(commit !== undefined ? {commit} : {}),
			};
		}

		// propose: push the branch under its own name (the safety-bearing step),
		// THEN ask the provider to request review. Reconcile with --force-with-lease
		// on the WORK BRANCH ONLY (§11: a work branch is unshared) so a RECOVERY
		// complete — which rebases the kept branch onto fresh `main` (a PLAIN rebase
		// after the per-item-lock cut-over: no transient status lands on a branch, so
		// there is nothing to drop) and so REWRITES the tip vs an already-pushed
		// `work/<slug>` (the bounce now pushes it via the seam) — lands cleanly
		// instead of failing non-fast-forward. The lease guards the CAS; this
		// is NEVER a plain `--force`, and NEVER touches main.
		//
		// STALE-LEASE SURVIVAL + BENIGN ALREADY-LANDED (task `propose-push-
		// survives-stale-lease-on-reaped-work-ref`): route through the propose
		// stale-lease retry helper (the sibling of
		// `pushContinuedBranchWithStaleLeaseRetry`, sharing its `stale info`
		// detection + bounded retry, with the propose-specific addition of the
		// gone-ref + ancestor-of-`<arbiter>/main` = BENIGN already-landed predicate
		// — mirroring `deleteMergedHeadBranch`'s ancestor guard + the leased-delete
		// `already-reaped` precedent). Survives a `stale info` rejection when the
		// arbiter's view of the unshared work ref moved under us (re-leases against
		// the freshly-observed tip); reports `alreadyLanded` (no PR re-open against
		// a vanished ref) when the work already landed via a sibling's merge +
		// reap; SURFACES every non-stale failure (connectivity, protected ref,
		// auth) and a non-provably-landed stale-info-after-cap as a terminal throw.
		// For a first-time propose (no remote ref yet) the helper's create-only
		// empty-expected lease shape (`<branch>:`) accepts the new ref unchanged.
		const proposePush = pushProposeBranchWithStaleLeaseRetry({
			cwd: input.cwd,
			branch: input.branch,
			arbiter: input.arbiter,
			env: input.env,
		});
		if (proposePush.kind === 'already-landed') {
			// BENIGN already-landed: the work is provably on `<arbiter>/main` and the
			// head was reaped. Do NOT call the provider — there is no ref to open a
			// review request against, and asking the provider to open a PR for
			// landed work would be a confusing no-op. Distinct from a real failure:
			// `alreadyLanded: true`, no throw, no PR.
			return {
				mode: 'propose',
				mergedToMain: false,
				pushedRef: input.branch,
				provider: 'none',
				requestOpened: false,
				alreadyLanded: true,
				instruction:
					`${input.branch}: the work is already on ${input.arbiter}/main ` +
					'and its remote head was reaped — nothing to propose (clean no-op).',
			};
		}
		// PR-INTENT (`noPR: true`): the branch is now pushed (safe) — deliberately do
		// NOT open a review request (the explicit suppress-PR intent). No warning: the
		// no-PR outcome is intended, not a degrade. The provider is reported as `none`
		// (no request opened), exactly as a push-only propose surfaces.
		if (input.noPR === true) {
			return {
				mode: 'propose',
				mergedToMain: false,
				pushedRef: input.branch,
				provider: 'none',
				requestOpened: false,
				instruction:
					`Pushed ${input.branch} to ${input.arbiter}. No PR was opened ` +
					'(noPR is set — the suppress-PR intent).',
			};
		}
		const review = await this.provider.openRequest({
			cwd: input.cwd,
			branch: input.branch,
			arbiter: input.arbiter,
			title: input.title,
			body: input.body,
			env: input.env,
			backoff: input.backoff,
			sleep: input.sleep,
		});
		return {
			mode: 'propose',
			mergedToMain: false,
			pushedRef: input.branch,
			provider: this.provider.name,
			requestOpened: review.opened,
			instruction: review.instruction,
			url: review.url,
		};
	}

	/**
	 * Rebase-before-integrate (ADR §10): fetch + rebase the branch onto the latest
	 * `<arbiter>/main`. Clean → integrate. Conflict → the rebase is already
	 * aborted by `rebaseOntoArbiterMain`; we return `needs-attention` (NEVER
	 * auto-resolve, NEVER push a half-merged tree).
	 */
	async integrateWithRebase(
		input: IntegrateInput,
	): Promise<IntegrateWithRebaseResult> {
		const rebase = rebaseOntoArbiterMain({
			cwd: input.cwd,
			arbiter: input.arbiter,
			branch: input.branch,
			env: input.env,
		});
		if (!rebase.clean) {
			return {
				outcome: 'needs-attention',
				reason:
					`Rebasing ${input.branch} onto ${input.arbiter}/main conflicted; ` +
					'the rebase was aborted (never auto-resolved). A human must resolve ' +
					'against the latest main, then re-integrate.',
			};
		}
		return {outcome: 'integrated', integration: await this.integrate(input)};
	}
}

export interface RebaseInput {
	cwd: string;
	arbiter: string;
	branch: string;
	env?: NodeJS.ProcessEnv;
}

export interface RebaseResult {
	/** True iff the branch was cleanly rebased onto the latest arbiter main. */
	clean: boolean;
	/** True iff the rebase conflicted (and was aborted). */
	conflicted: boolean;
}

/**
 * Deterministically rebase `branch` onto the freshly-fetched `<arbiter>/main`
 * (ADR §10). A clean rebase leaves the branch on top of main. A conflicting
 * rebase is `git rebase --abort`ed (restoring the pre-rebase state) and reported
 * as `conflicted` — we NEVER pick `--ours`/`--theirs` or any heuristic
 * (resolution requires semantic judgement; a wrong-but-compiling merge is the
 * worst outcome). Must be called with `branch` checked out.
 */
export function rebaseOntoArbiterMain(input: RebaseInput): RebaseResult {
	const env = input.env;
	// Fetch the arbiter's `main` into the `<arbiter>/main` remote-tracking ref
	// EXPLICITLY. A job worktree is cut from a bare hub mirror whose `origin`
	// remote has no fetch refspec (so `origin/main` would not otherwise resolve);
	// a normal clone already has it but the explicit refspec is harmless there.
	git(
		[
			'fetch',
			'--quiet',
			input.arbiter,
			`+refs/heads/main:refs/remotes/${input.arbiter}/main`,
		],
		input.cwd,
		{env},
	);
	// Ensure we are on the branch we intend to rebase.
	git(['checkout', '--quiet', input.branch], input.cwd, {env});

	const rebase = run('git', ['rebase', `${input.arbiter}/main`], input.cwd, {
		env,
	});
	if (rebase.status === 0) {
		return {clean: true, conflicted: false};
	}
	// Conflict (or any non-zero): abort to restore the pre-rebase state. NEVER
	// auto-resolve. `--abort` is best-effort; if there is nothing to abort it is
	// a no-op error we can ignore.
	run('git', ['rebase', '--abort'], input.cwd, {env});
	return {clean: false, conflicted: true};
}

/** Outcome of {@link mergePushOnce}. */
type MergePushResult = {kind: 'landed'} | {kind: 'non-fast-forward'};

/**
 * Push `${branch}:main` (merge mode) ONCE, classifying the outcome for the
 * caller's bounded re-rebase-and-retry loop (Race 1: claim-vs-integrate, task
 * `run-fleet-claim-integrate-and-sibling-rebase-concurrency-safe`). It does NOT
 * rebase itself: the rebase belongs to the integration-core step-4 tail, which
 * ALSO carries the sibling-ledger + divergent-done-move reconciliation arms a bare
 * rebase here would miss. This function's only job is to push and tell the caller
 * whether to LOOP (re-rebase via step-4) or STOP.
 *
 *   - `landed` — the push succeeded, OR (under the non-atomic `file://` transport)
 *     it reported failure but our tip is ALREADY reachable on `<arbiter>/main`
 *     (the push genuinely landed — an IDEMPOTENT no-op; never re-rebase our own
 *     already-landed commit, which would self-conflict). The `isAncestor` probe is
 *     the SAME merged-vs-unmerged predicate `gc.ts`/`finishStrandedBranch` use.
 *   - `non-fast-forward` — a SIBLING advanced `<arbiter>/main` during our push
 *     window (a claim CAS commit, or a sibling integrate); the caller must
 *     re-fetch + re-run the step-4 rebase (reconciling sibling-ledger divergence)
 *     and retry the push. We NEVER `--force` main.
 *
 * Any OTHER push failure (unreachable arbiter, refused ref) THROWS, exactly as a
 * plain `git push` would.
 */
function mergePushOnce(input: IntegrateInput): MergePushResult {
	const env = input.env;
	const refspec = `${input.branch}:main`;
	const arbiterRef = `refs/remotes/${input.arbiter}/main`;

	const push = run('git', ['push', input.arbiter, refspec], input.cwd, {env});
	if (push.status === 0) {
		return {kind: 'landed'};
	}
	// Distinguish a CONTENTION rejection (main advanced — recoverable by a step-4
	// re-rebase) from any other push failure (which surfaces as today's throw).
	const combined = `${push.stderr}\n${push.stdout}`;
	const nonFastForward =
		/non-fast-forward|fetch first|\[rejected\]|failed to push/i.test(combined);
	if (!nonFastForward) {
		throw new Error(
			`git push ${input.arbiter} ${refspec} failed (exit ${push.status}): ` +
				`${push.stderr.trim() || push.stdout.trim()}`,
		);
	}
	// Re-fetch the arbiter's main and check IDEMPOTENCY first: under `file://` a
	// reported failure can have actually landed. If our tip is already on main, it
	// landed — never re-rebase our own commit onto a main that has it.
	git(
		['fetch', '--quiet', input.arbiter, `+refs/heads/main:${arbiterRef}`],
		input.cwd,
		{env},
	);
	const tip = run(
		'git',
		['rev-parse', '--verify', '--quiet', `refs/heads/${input.branch}`],
		input.cwd,
		{env},
	).stdout.trim();
	if (tip !== '' && isAncestor(input.cwd, tip, arbiterRef, env)) {
		return {kind: 'landed'};
	}
	// A genuine sibling main-advance: the caller re-runs the step-4 rebase + retries.
	return {kind: 'non-fast-forward'};
}

/**
 * Push a branch to the arbiter. Used by both modes; `merge` targets `main`
 * (plain, never forced), `propose` targets the branch's own ref. The caller may
 * pass extra git args (e.g. `--force-with-lease=<work-branch>` on the propose
 * path, to reconcile a recovery-rewritten WORK branch — §11, unshared, lease-
 * guarded). There is NEVER a plain `--force`, and `main` is NEVER forced; the
 * only leases in the system are this work-branch one + the claim micro-commit's.
 */
function pushBranch(
	input: IntegrateInput,
	refspec: string,
	...extraArgs: string[]
): void {
	git(['push', input.arbiter, refspec, ...extraArgs], input.cwd, {
		env: input.env,
	});
}

/**
 * Reap the remote `work/<slug>` HEAD branch on the arbiter AFTER its work landed
 * on `main` (merge mode, part (b)). The merge push above already put the commits
 * on `main`, so the head is PROVABLY merged — it is the recovery point no longer
 * (its work is on main), exactly the never-delete invariant's release condition.
 * We additionally CONFIRM the head, when it exists, is an ancestor of
 * `<arbiter>/main` before deleting, so a racing un-merged amend is never reaped.
 *
 * BEST-EFFORT + idempotent (soft `run`, never throws): the deletion of a
 * fully-merged ref needs NO force (and we never pass one); a no-remote-head merge
 * (the plain `${branch}:main` push opened none) is a clean no-op; an unreachable
 * arbiter / already-gone ref is tolerated. The integrate's safety rides on the
 * merge push, never on this hygiene step.
 */
function deleteMergedHeadBranch(input: IntegrateInput): void {
	const env = input.env;
	const arbiter = input.arbiter;
	const branch = input.branch;
	// Does a remote head exist at all? (`ls-remote` exits 0 with empty stdout when
	// absent.) No head ⇒ nothing to reap (the common direct-merge case).
	const ls = run('git', ['ls-remote', '--heads', arbiter, branch], input.cwd, {
		env,
	});
	if (ls.status !== 0 || ls.stdout.trim() === '') {
		return; // unreachable arbiter, or no remote head — nothing to delete.
	}
	// The head exists. Confirm it is an ancestor of <arbiter>/main before deleting
	// (it just merged, so this holds; the guard refuses a racing un-merged amend).
	run(
		'git',
		[
			'fetch',
			'--quiet',
			arbiter,
			`+refs/heads/main:refs/remotes/${arbiter}/main`,
			`+refs/heads/${branch}:refs/remotes/${arbiter}/${branch}`,
		],
		input.cwd,
		{env},
	);
	const headSha = parseLsRemoteSha(ls.stdout);
	if (headSha !== undefined) {
		const isMerged = run(
			'git',
			['merge-base', '--is-ancestor', headSha, `refs/remotes/${arbiter}/main`],
			input.cwd,
			{env},
		);
		if (isMerged.status !== 0) {
			return; // NOT provably merged (a racing un-merged amend) — never reap.
		}
	}
	// Provably merged: WRITE-THROUGH delete — drop the LOCAL tracking ref FIRST
	// (the ref that drives continue-detection), THEN the arbiter head (NEVER
	// `--force`). The asymmetry is the point: an arbiter-delete failure leaves
	// the local store BEHIND (self-healing on next fetch), never AHEAD (a stale
	// `refs/remotes/<arbiter>/work/<slug>` that drives a wrong "continue" — the
	// permanent stale-continue bug today's arbiter-first ordering creates).
	run(
		'git',
		['update-ref', '-d', `refs/remotes/${arbiter}/${branch}`],
		input.cwd,
		{env},
	);
	run('git', ['push', arbiter, '--delete', branch], input.cwd, {env});
}

/** First sha from a `git ls-remote` output line (`<sha>\t<ref>`), or undefined. */
function parseLsRemoteSha(stdout: string): string | undefined {
	const m = /^([0-9a-f]{40})\s/m.exec(stdout.trim());
	return m ? m[1] : undefined;
}

/**
 * Resolve the SHA the merge path just pushed to `main` — the work branch's tip
 * (`${branch}:main` pushes exactly that). BEST-EFFORT (soft `run`, never throws):
 * on any failure it returns `undefined`, so the additive {@link
 * IntegrateResult.commit} stays absent rather than breaking the integrate. Used to
 * link the landed commit (intake's completion comment); the integrate's safety
 * rides on the push above, never on this read.
 */
function resolveBranchTip(input: IntegrateInput): string | undefined {
	const res = run('git', ['rev-parse', input.branch], input.cwd, {
		env: input.env,
	});
	if (res.status !== 0) {
		return undefined;
	}
	const sha = res.stdout.trim();
	return sha === '' ? undefined : sha;
}

/**
 * Render the runner-synthesised TITLE + BODY into a human's MANUAL review-request
 * instructions (the `none` provider, and the GitHub provider's degraded path),
 * so a human opening the request by hand reuses the SAME title/body the
 * autonomous path would have set. Returns '' when neither is present (today's
 * bare instruction — no regression). Surfaced as a trailing block so the
 * leading instruction line stays clean.
 */
export function manualRequestText(input: {
	title?: string;
	body?: string;
}): string {
	const parts: string[] = [];
	if (input.title) {
		parts.push(`\nSuggested title: ${input.title}`);
	}
	if (input.body) {
		parts.push(`\nSuggested body:\n${input.body}`);
	}
	return parts.join('');
}

/** True if the arbiter's `main` currently contains `commitish` (work landed). */
export function arbiterMainContains(
	cwd: string,
	arbiter: string,
	commitish: string,
	env?: NodeJS.ProcessEnv,
): boolean {
	run('git', ['fetch', '-q', arbiter], cwd, {env});
	const res = run(
		'git',
		['merge-base', '--is-ancestor', commitish, `${arbiter}/main`],
		cwd,
		{env},
	);
	return res.status === 0;
}
