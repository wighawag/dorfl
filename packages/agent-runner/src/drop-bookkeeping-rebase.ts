import {run, type RunResult} from './git.js';

/**
 * The SHARED drop-mechanism for runner-authored `chore(<slug>): route to
 * needs-attention` MOVE-ONLY bookkeeping commits. ONE home, called at both
 * rebase sites:
 *
 *   - the INTEGRATION rebase (`integration-core.ts`
 *     `rebaseDroppingNeedsAttentionSurface`, the `recovering` path) — drops the
 *     historical `in-progress → needs-attention` move so the replay does not
 *     conflict with the surfaced main; and
 *   - the ONBOARD continue-rebase (`continue-branch.ts`
 *     `rebaseContinuedBranchOntoMain`, every CONTINUE path) — drops the kept
 *     branch's stale `route to needs-attention` moves so a single agent
 *     re-`do`'ing its own kept branch never self-conflicts with the runner's
 *     own tree-less moves of the same `.md` on main.
 *
 * THE HARD INVARIANT (do not violate): the drop targets ONLY runner-authored
 * `route to needs-attention` move-only commits, anchored to the slug. It NEVER
 * drops a COMPLETED-STATE move (the slice `→done` move, or the PRD
 * `slicing → prd-sliced` move) — those stay on the branch and land atomically
 * with their artifacts (code, emitted backlog slices). `arbiter/main` must
 * never show `done/`/`prd-sliced/` without the artifacts they assert. A genuine
 * code conflict (still present after the drop) still aborts → needs-attention.
 *
 * The sed matcher is anchored on the exact subject `routeToNeedsAttention`
 * authors (`chore(<slug>): route to needs-attention; <reason>`) — the slug is
 * embedded so unrelated commits (other slugs, agent wip/feat commits, `→done`
 * commits) are NEVER matched. A done-move's subject is `feat(<slug>): … done`
 * (or similar) — it does NOT match the `route to needs-attention` anchor.
 */

/**
 * Build a one-shot `GIT_SEQUENCE_EDITOR` command (a `sed` invocation) that
 * deletes, from the rebase todo file (passed as `$1`), every `pick` line whose
 * subject is the route-to-needs-attention move-only commit for `slug`
 * (`chore(<slug>): route to needs-attention`). Deleting a `pick` line drops
 * that commit from the rebase — the mechanism for skipping the move that would
 * otherwise conflict with the (surfaced) main. Anchored to the slug so no
 * unrelated commit is ever dropped. A done-move's subject does NOT match.
 */
export function dropMoveOnlySequenceEditor(slug: string): string {
	// The todo line emitted by `git rebase -i` looks like EITHER:
	//   `pick <sha> chore(<slug>): route to needs-attention; …`        (older git)
	//   `pick <sha> # chore(<slug>): route to needs-attention; …`      (git ≳ 2.31 default)
	// The leading `# ` between sha and subject is the modern default — git emits
	// it on the todo line even though the actual commit subject has no `# `. The
	// pattern below tolerates BOTH (`\(# \)\{0,1\}` is portable BRE — "optional `# `
	// between sha and subject") so the one shared matcher works across git
	// versions. Without the optional `# ` the modern todo lines slip past the
	// matcher and the bookkeeping commits replay (the live self-conflict).
	// Escape any sed-special characters in the slug before embedding it.
	const escaped = slug.replace(/[\\/&.[\]*^$]/g, '\\$&');
	return `sed -i -e '/^pick [0-9a-f][0-9a-f]* \\(# \\)\\{0,1\\}chore(${escaped}): route to needs-attention/d'`;
}

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	return run('git', args, cwd, {env});
}

/**
 * Rebase the CURRENTLY-CHECKED-OUT branch onto `ontoRef` while DROPPING every
 * `chore(<slug>): route to needs-attention` move-only bookkeeping commit on
 * the branch (matched by subject; see {@link dropMoveOnlySequenceEditor}).
 * Returns the rebase {@link RunResult} (status 0 = clean replay; non-zero =
 * the rebase conflicted on something OTHER than a dropped bookkeeping commit —
 * the caller's existing abort path governs).
 *
 * When the branch carries NO matching bookkeeping commits, the sed deletes
 * nothing and this degrades to a normal rebase onto `ontoRef`. When there is
 * no common ancestor with `ontoRef` (shouldn't happen for a branch cut from
 * main), the helper falls back to a plain `rebase <ontoRef>` so the caller's
 * conflict path still governs.
 *
 * The helper does NOT abort on conflict and does NOT advance the branch on
 * success — both are the caller's responsibility, EXACTLY as the underlying
 * `git rebase` works, so this is a drop-in replacement for a bare
 * `git rebase <ontoRef>` at either site.
 */
export function rebaseDroppingBookkeepingMoves(params: {
	cwd: string;
	ontoRef: string;
	slug: string;
	env: NodeJS.ProcessEnv | undefined;
}): RunResult {
	const {cwd, ontoRef, slug, env} = params;
	// The branch we are ON. Rebasing must UPDATE this ref — so we pass the
	// branch NAME to `git rebase` (passing the literal `HEAD` would rebase in
	// DETACHED mode and leave the branch ref behind).
	const onBranch = gitSoft(
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		cwd,
		env,
	).stdout.trim();
	const base = gitSoft(['merge-base', 'HEAD', ontoRef], cwd, env).stdout.trim();
	if (base === '') {
		// No common ancestor: fall back to a plain rebase so the caller's
		// conflict path still governs.
		return gitSoft(['rebase', ontoRef], cwd, env);
	}
	const rebaseEnv: NodeJS.ProcessEnv = {
		...(env ?? process.env),
		GIT_SEQUENCE_EDITOR: dropMoveOnlySequenceEditor(slug),
		// Keep the rebase non-interactive for the commit-message editor too.
		GIT_EDITOR: 'true',
	};
	return gitSoft(
		onBranch === ''
			? ['rebase', '-i', '--onto', ontoRef, base]
			: ['rebase', '-i', '--onto', ontoRef, base, onBranch],
		cwd,
		rebaseEnv,
	);
}
