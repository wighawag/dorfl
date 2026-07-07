import {run, type RunResult} from './git.js';

/**
 * BROADENED SCOPE NOTE (follow-up task
 * `complete-propose-honour-already-landed-and-rename-continue-branch-module`):
 * this module's name still reads as "continue-branch" (its ORIGINAL role: the
 * continue-detection + rebase-onto-fresh-main helpers used by the onboarding
 * paths, documented below), BUT it now ALSO hosts the shared
 * **stale-lease work-branch push** helpers used by MULTIPLE callers:
 *
 *   - {@link pushContinuedBranchWithStaleLeaseRetry} — the original
 *     continue/onboard caller (the mirror hub → arbiter reconcile push).
 *   - {@link pushProposeBranchWithStaleLeaseRetry} — the propose-mode
 *     integrator's push (task `propose-push-survives-stale-lease-on-reaped-work-
 *     ref`), which adds the BENIGN already-landed predicate (gone remote ref +
 *     work reachable from `<arbiter>/main`) on top of the shared `stale info`
 *     retry.
 *
 * A rename to something like `stale-lease-work-push.ts` was considered; the
 * scope-note is preferred here because a rename would churn many imports
 * across `src/` + `test/` for no behavioural gain, and the module already reads
 * as a single conceptual bucket ("the work-branch push + continue-detection
 * helpers"). Add new stale-lease work-ref push helpers here rather than
 * spawning a sibling module.
 *
 * The **continue-detection** shared by BOTH onboarding paths (the keystone of
 * the `requeue-continue-and-reset` task). `requeue` keeps the `work/<slug>`
 * branch so the NEXT claim CONTINUES from its tip instead of force-cutting a
 * fresh branch off main. This module factors the one question both onboarding
 * paths must ask — **"does the arbiter have a `work/<slug>` ref AHEAD of
 * main?"** — into ONE helper, plus the rebase-onto-fresh-main step the continued
 * branch needs at onboard-time (ADR §10: rebase-or-abort, never auto-resolve →
 * conflict routes to needs-attention; the agent builds on a CURRENT base).
 *
 * The two onboarding paths reference the same two refs differently:
 *   - **in-place** (`src/start.ts` `switchToWorkBranch`, used by
 *     `do`/`start`/`work-on`): a normal clone. After `git fetch <arbiter>` the
 *     branch is the remote-tracking ref `<arbiter>/work/<slug>` and main is
 *     `<arbiter>/main`.
 *   - **job-worktree** (`src/workspace.ts` `createJob`, used by
 *     `do --remote`/`run`): a BARE hub mirror. `ensureMirror` fetches
 *     `+refs/heads/*:refs/heads/*`, so the arbiter's `work/<slug>` lands as a
 *     LOCAL head `work/<slug>` and main is the local head `main`.
 *
 * Both call {@link branchAheadOf} with the appropriate ref names; the predicate
 * is identical (ref exists AND is not an ancestor of main, i.e. it carries
 * commits beyond main — the prior attempt's work to continue from). When the
 * branch is ABSENT (the common case: a fresh task, or a `requeue --reset` that
 * deleted it) the predicate is false and the caller falls through to the normal
 * fresh-cut-off-main path with NO special logic.
 */

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	return run('git', args, cwd, {env});
}

/**
 * True iff the git ref `branchRef` exists in `cwd` AND its tip is NOT an
 * ancestor of `mainRef` — i.e. it carries commits beyond main (the prior
 * attempt's work a `requeue` kept, to be continued). False when the ref is
 * absent (nothing to continue → fresh cut) or already merged into main (no work
 * beyond main → nothing to continue). Read-only; never throws.
 *
 * Both onboarding paths feed this ONE predicate with their own ref names:
 *   - in-place clone:   branchRef=`<arbiter>/work/<slug>`, mainRef=`<arbiter>/main`
 *   - bare hub mirror:  branchRef=`work/<slug>`,           mainRef=`main`
 */
export function branchAheadOf(
	cwd: string,
	branchRef: string,
	mainRef: string,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	const tip = gitSoft(
		['rev-parse', '--verify', '--quiet', `${branchRef}^{commit}`],
		cwd,
		env,
	).stdout.trim();
	if (tip === '') {
		return false; // the branch is not on the arbiter → fresh cut, no continue
	}
	const mainTip = gitSoft(
		['rev-parse', '--verify', '--quiet', `${mainRef}^{commit}`],
		cwd,
		env,
	).stdout.trim();
	if (mainTip === '') {
		// No main to compare against (shouldn't happen): treat as ahead so the kept
		// branch is continued rather than silently dropped.
		return true;
	}
	// Ahead ⇔ the branch tip is NOT an ancestor of main (it has commits main lacks).
	const isAncestor =
		gitSoft(['merge-base', '--is-ancestor', tip, mainTip], cwd, env).status ===
		0;
	return !isAncestor;
}

/**
 * Arbiter-authoritative continue-detection: like {@link branchAheadOf}, but
 * first asks the arbiter (`git ls-remote <arbiterRemote> refs/heads/<branch>`)
 * whether the kept branch EXISTS — so a STALE local remote-tracking ref
 * (`refs/remotes/<arbiter>/<branch>` or a bare mirror's `refs/heads/<branch>`)
 * pointing at a branch already DELETED on the arbiter (by `requeue --reset`, by
 * the merge-reap, or cross-machine by `gc --remote-branches`) can no longer
 * fool the onboard into "continue". This is the READ-side backstop that pairs
 * with the WRITE-side write-through ordering at every delete site
 * (local-ref-first, then `git push <arbiter> --delete`): write-through keeps
 * SAME-MACHINE state in sync at the source; this catches the CROSS-MACHINE
 * residue at the read (the other machine cannot touch this machine's local
 * tracking refs). A plain `git remote prune` does NOT cover this — verified a
 * no-op on the bare hub mirror, which has no `remote.origin.fetch` refspec for
 * the orphaned `refs/remotes/origin/*` namespace.
 *
 * The decision rules, in order:
 *   - `git ls-remote <arbiterRemote> refs/heads/<branch>` exits 0 with EMPTY
 *     stdout (branch absent on the arbiter) ⇒ NOT ahead (fresh cut). This is
 *     the bug-fix case: a stale local ref CANNOT override the arbiter's truth.
 *   - `ls-remote` exits 0 with a sha ⇒ delegate to {@link branchAheadOf} on
 *     the local refs (the existing predicate: ref exists AND not an ancestor
 *     of main). The arbiter-present case is the normal continue path.
 *   - `ls-remote` exits non-zero (unreachable arbiter / offline) ⇒ fall back
 *     to {@link branchAheadOf} on the local refs — the best the read can do
 *     when the arbiter cannot answer (same direction as today).
 *
 * `branch` is the unqualified branch name on the arbiter (e.g.
 * `work/task-<slug>`); `branchRef` + `mainRef` are the local refs the
 * arbiter-present delegate uses (in-place clone: `<arbiter>/<branch>` /
 * `<arbiter>/main`; bare hub mirror: `<branch>` / `main`). `arbiterRemote` is
 * the remote NAME to ls-remote (e.g. `origin` for the mirror, `arbiter` for an
 * in-place clone with the conventional remote name).
 */
export function branchAheadOfArbiter(options: {
	cwd: string;
	/** The remote NAME to `ls-remote` (the arbiter as known to this repo). */
	arbiterRemote: string;
	/** Unqualified branch name on the arbiter (e.g. `work/task-<slug>`). */
	branch: string;
	/** The local ref to read for the ahead-of-main check (when arbiter says present). */
	branchRef: string;
	/** The local main ref to compare against. */
	mainRef: string;
	env: NodeJS.ProcessEnv | undefined;
}): boolean {
	const {cwd, arbiterRemote, branch, branchRef, mainRef, env} = options;
	const ls = gitSoft(['ls-remote', '--heads', arbiterRemote, branch], cwd, env);
	if (ls.status === 0) {
		// Reachable arbiter: its answer is AUTHORITATIVE. Empty ⇒ branch absent
		// ⇒ no continue (a stale local ref cannot resurrect a deleted branch).
		if (ls.stdout.trim() === '') {
			return false;
		}
		// Present on the arbiter ⇒ use the existing local-ref predicate to decide
		// ahead-of-main (which is how "there is work to continue" is defined).
		return branchAheadOf(cwd, branchRef, mainRef, env);
	}
	// Unreachable arbiter / offline — fall back to the local-ref answer (the
	// best the read can do when the arbiter cannot answer; same direction as
	// before this backstop existed).
	return branchAheadOf(cwd, branchRef, mainRef, env);
}

/** The result of rebasing a continued branch onto the freshly-fetched main. */
export interface ContinueRebaseResult {
	/** `clean` — the rebase replayed onto main with no conflict. */
	/** `conflict` — the rebase conflicted; it was `--abort`ed (never auto-resolved). */
	kind: 'clean' | 'conflict';
}

/**
 * Rebase the CURRENTLY-CHECKED-OUT continued `work/<slug>` branch onto
 * `mainRef` (the freshly-fetched main), so the agent builds on a CURRENT base
 * (ADR §10: rebase, NOT merge — linear history; the prior attempt's commits were
 * based on an OLD main that moved while the item sat in backlog).
 *
 * This is a PLAIN rebase. After the per-item-lock cut-over (spec
 * `ledger-status-per-item-lock-refs`, tasks 9a–9d) NO transient status lands on
 * a work branch: claim does not move the body (it rests in `backlog/`),
 * needs-attention is the lock `state: stuck` (not a `git mv`), and the
 * tasking/advancing markers are gone. So a branch cut from `main` inherits no
 * runner-authored move-only bookkeeping commit, there is nothing to drop, and
 * the old `drop-bookkeeping-rebase` machinery (which papered over the
 * rename/rename ledger conflict that inheritance caused) is deleted. The ONLY
 * commits replayed are the agent's own wip / `→done` commits.
 *
 * A CLEAN rebase returns `{kind: 'clean'}`; a CONFLICTING rebase (a GENUINE code
 * conflict) is `--abort`ed (NEVER auto-resolved) and returns `{kind: 'conflict'}`
 * so the caller can route the item to needs-attention via the §10 path. Must be
 * called while HEAD is the continued branch.
 *
 * RENAME-DETECTION-OFF (task `disable-rename-detection-on-continue-rebase`): the
 * rebase is invoked with `-c merge.directoryRenames=false` SCOPED to the
 * invocation (never a persistent `git config` write), so a single durable
 * folder-transition `git mv` out of a SPARSE source folder is NOT misread by
 * git's directory-rename heuristic as a whole-DIRECTORY rename — which would
 * spuriously flag every sibling file main added into that same folder as
 * `CONFLICT (file location)` and force a FALSE needs-attention. Content-rename
 * detection (`-Xno-renames` / `merge.renames` / `diff.renames`) is NOT what
 * controls this conflict and was empirically verified ineffective; only
 * `merge.directoryRenames=false` suppresses it. A GENUINE same-path content
 * conflict still conflicts unchanged.
 */
export function rebaseContinuedBranchOntoMain(
	cwd: string,
	mainRef: string,
	env: NodeJS.ProcessEnv | undefined,
): ContinueRebaseResult {
	const rebase = gitSoft(
		['-c', 'merge.directoryRenames=false', 'rebase', mainRef],
		cwd,
		env,
	);
	if (rebase.status === 0) {
		return {kind: 'clean'};
	}
	// NEVER auto-resolve: abort back to a clean continued-branch tip.
	gitSoft(['rebase', '--abort'], cwd, env);
	return {kind: 'conflict'};
}

/**
 * The default cap on stale-lease push retries — mirrors the claim / tasking-lock
 * INSTANT-contention loop's `retries: 3` default (`claim-cas.ts` `DEFAULT_RETRIES`).
 * After this many re-fetch + re-rebase + re-push attempts the green work is left
 * RECOVERABLE and the caller surfaces a clear terminal failure.
 */
export const DEFAULT_STALE_LEASE_RETRIES = 3;

/**
 * Lexical signal of a `--force-with-lease` STALE-LEASE rejection (git prints
 * `! [rejected] <ref> (stale info)`), as distinct from any OTHER push failure
 * (connectivity, auth, a protected ref). ONLY this case is safe to re-lease +
 * retry on the UNSHARED work branch — every other failure must surface, never
 * silently overwrite. This is the SAME family of contention markers the
 * ledger-write CAS recognises (`ledger-write.ts`), narrowed here to the lease's
 * own `stale info`.
 */
export function isStaleLeaseRejection(stderr: string): boolean {
	return /stale info/i.test(stderr);
}

/**
 * Outcome of {@link pushProposeBranchWithStaleLeaseRetry} — the sibling of
 * {@link ContinuedPushResult} on the PROPOSE-mode work-branch push.
 */
export type ProposePushResult =
	/** The work branch landed on the arbiter (first try or after a stale-lease retry). */
	| {kind: 'pushed'}
	/**
	 * BENIGN already-landed race tail: the remote `work/<slug>` ref is GONE on
	 * the arbiter AND our HEAD is provably reachable from `<arbiter>/main` — i.e.
	 * the work already landed via a sibling's merge and its head was reaped
	 * (`integrator.ts` `deleteMergedHeadBranch`'s ancestor-guarded reap, or `gc`).
	 * This is the propose-push analogue of the leased-delete `already-reaped`
	 * outcome (`item-lock.ts`): a vanished ref whose work is provably landed is
	 * the DESIRED end state, not a failure.
	 */
	| {kind: 'already-landed'};

/**
 * Push the propose-mode work branch with the SAME stale-lease retry semantics
 * as {@link pushContinuedBranchWithStaleLeaseRetry} (explicit
 * `--force-with-lease=<branch>:<expectedTip>`, `stale info` detection, bounded
 * re-observation + retry, terminal throw on cap exhaustion / non-stale
 * failure), plus the one race the continue path does not have: a `work/<slug>`
 * ref that is GONE on the arbiter because the work already LANDED on `main` is
 * a BENIGN already-landed success, not a failure. The predicate mirrors the
 * leased-delete `already-reaped` + merged-head-reap ancestor guards: gone ref
 * AND `HEAD` is an ancestor of `<arbiter>/main`.
 *
 * WHY a propose-specific helper instead of the continue helper verbatim: the
 * continue helper's stale-lease retry RE-REBASES the kept branch onto the
 * freshly-fetched main (a kept-branch onboard's job — main may have moved
 * while the prior attempt sat in backlog). In the propose path the caller has
 * ALREADY rebased the branch onto `<arbiter>/main` (`integrateWithRebase`, or
 * `integration-core.ts` `recoverAlreadyCommitted`'s recovery rebase), so the
 * only race the lease needs to survive here is the remote work ref MOVING /
 * REAPING under us — re-leasing against the freshly-observed tip is enough,
 * AND a re-rebase mid-integrate would smuggle a NEW rebase past
 * `integrateWithRebase`'s explicit conflict-aborts-to-needs-attention contract.
 * So this helper shares the stale-info detection + bounded retry shape (the
 * `--force-with-lease`-only / never-bare-force / never-`:main` guardrails are
 * identical) but does NOT layer the rebase step.
 *
 * Guardrails (ADR §11): `--force-with-lease` ONLY (re-computed each attempt),
 * NEVER bare `--force`, NEVER `:main`, the WORK branch ONLY. The lease is
 * threaded as `<branch>:<expectedTip>` — using EMPTY (`<branch>:`) when the
 * arbiter has no ref yet (the first-time propose / post-reap shape — the same
 * create-only lease form `item-lock.ts` uses for the lock CAS), so a bare-hub-
 * mirror worktree (no `refs/remotes/<arbiter>/*` upstream) leases correctly.
 *
 * Bounded by `retries` (default {@link DEFAULT_STALE_LEASE_RETRIES}, mirroring
 * the claim / continue retry cap). Must be called while HEAD is the propose
 * `<branch>`.
 */
export function pushProposeBranchWithStaleLeaseRetry(options: {
	cwd: string;
	branch: string;
	/** The arbiter remote name to push to / observe (e.g. `arbiter`, `origin`). */
	arbiter: string;
	retries?: number;
	env: NodeJS.ProcessEnv | undefined;
	/** Optional progress note sink (mirrors the continue helper's `note`). */
	note?: (message: string) => void;
}): ProposePushResult {
	const {cwd, branch, arbiter, env} = options;
	const note = options.note ?? (() => {});
	const retries = options.retries ?? DEFAULT_STALE_LEASE_RETRIES;
	const mainRef = `refs/remotes/${arbiter}/main`;

	const refreshMain = (): void => {
		gitSoft(
			['fetch', '--quiet', arbiter, `+refs/heads/main:${mainRef}`],
			cwd,
			env,
		);
	};

	/** The arbiter's CURRENT `<branch>` sha (via `ls-remote`), or `''` when absent / unreachable. */
	const observeArbiterTip = (): string => {
		const ls = gitSoft(['ls-remote', '--heads', arbiter, branch], cwd, env);
		if (ls.status !== 0) return '';
		const m = /^([0-9a-f]{40})/m.exec(ls.stdout.trim());
		return m ? m[1] : '';
	};

	/** True iff HEAD is provably reachable from `<arbiter>/main` (the work landed). */
	const headOnArbiterMain = (): boolean => {
		const head = gitSoft(
			['rev-parse', '--verify', '--quiet', 'HEAD'],
			cwd,
			env,
		).stdout.trim();
		if (head === '') return false;
		return (
			gitSoft(['merge-base', '--is-ancestor', head, mainRef], cwd, env)
				.status === 0
		);
	};

	/**
	 * The BENIGN already-landed predicate: the remote work ref is GONE on the
	 * arbiter AND our HEAD is provably reachable from `<arbiter>/main`. Mirrors
	 * `integrator.ts` `deleteMergedHeadBranch`'s ancestor-guarded reap + the
	 * `item-lock.ts` leased-delete `already-reaped` precedent: a vanished ref
	 * whose work is provably landed is the desired end state. Re-fetches main
	 * first so the answer reflects the current arbiter, not a stale local view.
	 */
	const benignAlreadyLanded = (): boolean => {
		refreshMain();
		return observeArbiterTip() === '' && headOnArbiterMain();
	};

	// Short-circuit BEFORE any push: the dominant recovery race shape (a sibling
	// already merged this work and reaped the head before we even attempted our
	// push). Avoids burning a stale-lease retry budget on a no-op.
	if (benignAlreadyLanded()) {
		note(
			`${branch}: already landed on ${arbiter}/main + remote head reaped — ` +
				'clean no-op (no push, no review request).',
		);
		return {kind: 'already-landed'};
	}

	let attempt = 0;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const observed = observeArbiterTip();
		// Explicit `<branch>:<expected>` — EMPTY when the ref is absent (first-time
		// propose, or a post-reap retry), MATCHING when present. The empty-expected
		// shape is the same create-only `--force-with-lease=<ref>:` form
		// `item-lock.ts` uses for the CAS create.
		const lease = observed === '' ? `${branch}:` : `${branch}:${observed}`;
		const push = gitSoft(
			['push', arbiter, `${branch}:${branch}`, `--force-with-lease=${lease}`],
			cwd,
			env,
		);
		if (push.status === 0) {
			return {kind: 'pushed'};
		}
		// Only `stale info` is re-leasable on this unshared work branch; every
		// other failure (connectivity, protected ref, auth) SURFACES at once.
		if (!isStaleLeaseRejection(push.stderr)) {
			throw new Error(
				`pushing ${branch} to ${arbiter} failed (not a stale lease): ` +
					(push.stderr.trim() || `exit ${push.status}`),
			);
		}
		// A stale lease: re-check the BENIGN already-landed predicate first (the
		// race tail this task carries), else retry with a freshly-observed lease.
		if (benignAlreadyLanded()) {
			note(
				`${branch}: stale lease + work already on ${arbiter}/main + remote ` +
					'head reaped — clean no-op.',
			);
			return {kind: 'already-landed'};
		}
		attempt += 1;
		if (attempt > retries) {
			throw new Error(
				`pushing ${branch} to ${arbiter} kept failing with a stale ` +
					`--force-with-lease after ${retries} retr${retries === 1 ? 'y' : 'ies'} ` +
					'(the arbiter work ref keeps moving under us, and the work is not ' +
					`provably on main). The green work is still committed on ${branch} — ` +
					'route to needs-attention and retry when the churn settles.',
			);
		}
		note(
			`${branch} propose push rejected (stale lease) — re-observe + retry ` +
				`(${attempt}/${retries})...`,
		);
	}
}

/** The outcome of {@link pushContinuedBranchWithStaleLeaseRetry}. */
export type ContinuedPushResult =
	/** The work branch landed on the arbiter (first try or after a clean re-rebase). */
	| {kind: 'pushed'}
	/**
	 * A re-rebase onto the freshly-fetched main CONFLICTED on a retry; it was
	 * `--abort`ed (NEVER auto-resolved). The caller routes the item to
	 * needs-attention via the §10 path — the green work stays intact on the branch.
	 */
	| {kind: 'conflict'};

/**
 * Push the CONTINUED `work/<slug>` branch to the arbiter with
 * `--force-with-lease`, surviving a STALE-LEASE ("stale info") rejection by
 * re-observing the arbiter's tip and replaying our green work onto it — instead
 * of stranding a committed, gate-green build in the job worktree (the observed
 * `advance-verb-resolver` incident).
 *
 * WHY a retry is SAFE here: the `work/<slug>` branch is UNSHARED — the arbiter
 * CAS serialises the claim per slug, so no rival writer legitimately advances it
 * concurrently. The lease's job is to catch a STALE LOCAL view, not a rival; so
 * on a stale-lease rejection the correct response is to re-fetch the actual
 * remote tip, rebase our work onto current main, and push again, re-leased
 * against the JUST-fetched ref. This stays within the existing guardrails:
 * `--force-with-lease` ONLY (re-computed each attempt), NEVER bare `--force`,
 * NEVER targeting `main`, the WORK branch ONLY (ADR §11).
 *
 * The flow, bounded by `retries` (default {@link DEFAULT_STALE_LEASE_RETRIES},
 * mirroring the claim/tasking-lock instant-contention cap):
 *   1. Push `<branch>:<branch> --force-with-lease=<branch>:<expectedRemoteTip>`.
 *   2. On success → `{kind: 'pushed'}`.
 *   3. On a STALE-LEASE rejection → re-fetch `main` + `<branch>` from the arbiter
 *      (into a remote-tracking ref, since the branch is CHECKED OUT here), re-run
 *      the onboard-time rebase onto the freshly-fetched main, and retry with the
 *      lease re-leased against the freshly-fetched remote tip. A rebase CONFLICT
 *      on a retry → `{kind: 'conflict'}` (the existing abort → needs-attention
 *      path; the retry covers ONLY the clean-rebase stale-lease case).
 *   4. After the cap → THROW a clear terminal error (the green work is still
 *      committed on the branch, so the caller's needs-attention route keeps it
 *      recoverable).
 *   5. Any NON-stale push failure (connectivity, protected ref) → THROW at once
 *      (never re-leased, never silently swallowed).
 *
 * `expectedRemoteTip` is the arbiter `work/<slug>` sha the caller already
 * observed (the pre-rebase mirror head). The explicit `<branch>:<sha>` lease is
 * REQUIRED in the bare-hub-mirror worktree, which has no `refs/remotes/origin/*`
 * upstream for git to imply the lease from. Must be called while HEAD is the
 * continued `<branch>`.
 */
export function pushContinuedBranchWithStaleLeaseRetry(options: {
	cwd: string;
	branch: string;
	/** The arbiter remote name to push to / re-fetch from (e.g. `origin`). */
	arbiter: string;
	/** The local main ref to rebase onto across retries (e.g. `main`). */
	mainRef: string;
	/** The arbiter `<branch>` sha the caller already observed (pre-rebase tip). */
	expectedRemoteTip: string;
	retries?: number;
	env: NodeJS.ProcessEnv | undefined;
	/** Optional progress note sink (mirrors the claim loop's `note`). */
	note?: (message: string) => void;
}): ContinuedPushResult {
	const {cwd, branch, arbiter, mainRef, env} = options;
	const note = options.note ?? (() => {});
	const retries = options.retries ?? DEFAULT_STALE_LEASE_RETRIES;
	// The remote-tracking ref we re-fetch the arbiter `<branch>` into so the lease
	// can be re-computed WITHOUT touching the checked-out local `<branch>` head
	// (git refuses to fetch into a checked-out branch).
	const trackingRef = `refs/remotes/${arbiter}/${branch}`;
	let expectedTip = options.expectedRemoteTip;

	let attempt = 0;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const push = gitSoft(
			[
				'push',
				arbiter,
				`${branch}:${branch}`,
				`--force-with-lease=${branch}:${expectedTip}`,
			],
			cwd,
			env,
		);
		if (push.status === 0) {
			return {kind: 'pushed'};
		}
		// Only a STALE-LEASE rejection is re-leasable on this unshared branch; any
		// other failure (connectivity, protected ref) surfaces immediately.
		if (!isStaleLeaseRejection(push.stderr)) {
			throw new Error(
				`pushing ${branch} to ${arbiter} failed (not a stale lease): ` +
					(push.stderr.trim() || `exit ${push.status}`),
			);
		}

		attempt += 1;
		if (attempt > retries) {
			throw new Error(
				`pushing ${branch} to ${arbiter} kept failing with a stale ` +
					`--force-with-lease after ${retries} retr${retries === 1 ? 'y' : 'ies'} ` +
					'(the arbiter work ref keeps moving under us). The green work is ' +
					`still committed on ${branch} — route to needs-attention and retry ` +
					'when the churn settles.',
			);
		}
		note(
			`${branch} push rejected (stale lease) — re-fetch + re-rebase + retry ` +
				`(${attempt}/${retries})...`,
		);

		// Re-observe the arbiter: refresh local `main` (NOT checked out → fetch into
		// its head) and the arbiter `<branch>` (CHECKED OUT → fetch into a
		// remote-tracking ref so the lease can re-compute against it).
		gitSoft(
			[
				'fetch',
				arbiter,
				`+refs/heads/main:${mainRef}`,
				`+refs/heads/${branch}:${trackingRef}`,
			],
			cwd,
			env,
		);
		const fresh = gitSoft(
			['rev-parse', '--verify', '--quiet', trackingRef],
			cwd,
			env,
		).stdout.trim();
		if (fresh !== '') {
			expectedTip = fresh;
		}

		// Replay our green work onto the freshly-fetched main (ADR §10: rebase, not
		// merge). A CONFLICT is the EXISTING abort → needs-attention path — the retry
		// handles ONLY the clean-rebase stale-lease case (never auto-resolves).
		const rebase = rebaseContinuedBranchOntoMain(cwd, mainRef, env);
		if (rebase.kind === 'conflict') {
			return {kind: 'conflict'};
		}
		// Loop: retry the push, now re-leased against the freshly-fetched remote tip.
	}
}
