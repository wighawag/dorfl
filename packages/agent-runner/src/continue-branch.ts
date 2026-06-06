import {run, type RunResult} from './git.js';

/**
 * The **continue-detection** shared by BOTH onboarding paths (the keystone of
 * the `requeue-continue-and-reset` slice). `requeue` keeps the `work/<slug>`
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
 * branch is ABSENT (the common case: a fresh slice, or a `requeue --reset` that
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
 * based on an OLD main that moved while the item sat in needs-attention/backlog).
 * A CLEAN rebase returns `{kind: 'clean'}`; a CONFLICTING rebase is `--abort`ed
 * (NEVER auto-resolved) and returns `{kind: 'conflict'}` so the caller can route
 * the item to needs-attention via the §10 path. Must be called while HEAD is the
 * continued branch.
 */
export function rebaseContinuedBranchOntoMain(
	cwd: string,
	mainRef: string,
	env: NodeJS.ProcessEnv | undefined,
): ContinueRebaseResult {
	const rebase = gitSoft(['rebase', mainRef], cwd, env);
	if (rebase.status === 0) {
		return {kind: 'clean'};
	}
	// NEVER auto-resolve: abort back to a clean continued-branch tip.
	gitSoft(['rebase', '--abort'], cwd, env);
	return {kind: 'conflict'};
}
