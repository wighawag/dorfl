import {run} from './git.js';
import {isAncestor} from './gc.js';
import {parseWorkBranchRef} from './slug-namespace.js';

/**
 * The **remote merged-work-branch reaper** — the cross-machine COUNTERPART of the
 * job-worktree reaper in `gc.ts`. Where `gc.ts` reaps LOCAL job WORKTREES under
 * `workspacesDir/work/*`, this reaps REMOTE `work/<slug>` BRANCHES that linger on
 * the arbiter after their propose-mode PR has MERGED.
 *
 * The safety lynchpin is the SAME provably-merged predicate the worktree reaper
 * uses (`gc.ts` `isAncestor`, REUSED here, never a second one): a remote
 * `work/<slug>` branch is reapable **iff** its tip is
 * `git merge-base --is-ancestor <tip> <arbiter>/main` — provably on `main`. A
 * merely-pushed-but-unmerged branch (an in-flight, kept-for-continue recovery
 * point) is NOT an ancestor of `main`, so the predicate AUTOMATICALLY excludes it
 * — the never-delete-the-in-flight-branch invariant (ADR §4 deletion-safety)
 * stays absolute. Deletion of a fully-merged ref needs NO force, so this NEVER
 * `--force`s.
 *
 * It is provider-AGNOSTIC plain git (`git ls-remote` to enumerate, `git push
 * --delete` to reap), so it works against a local `--bare` arbiter and any
 * provider — NOT relying on GitHub's repo-level auto-delete setting (which is an
 * additive convenience for GitHub arbiters only). The arbiter is addressed
 * THROUGH a local repo (`cwd`) whose `<arbiter>` remote points at it: the same
 * way `requeue --reset` addresses the arbiter for its sanctioned UN-merged
 * deletion (the complement of this merged-only sweep).
 */

/** Why a remote `work/<slug>` branch was RETAINED (not provably merged). */
export type RemoteRetainReason =
	| 'not-merged' // the tip is NOT an ancestor of <arbiter>/main (still in-flight)
	| 'main-unresolved'; // <arbiter>/main could not be resolved (cannot prove safety)

/** Human-readable text for each remote-branch retain reason (`sweep` reports). */
export const REMOTE_RETAIN_REASON_TEXT: Record<RemoteRetainReason, string> = {
	'not-merged':
		'not merged (branch tip is not an ancestor of the arbiter main — still in-flight)',
	'main-unresolved':
		'arbiter main could not be resolved, so merge could not be proven (kept — safe direction)',
};

/** A remote `work/<slug>` branch the sweep reaped (provably merged). */
export interface ReapedBranch {
	/** The full branch ref (`work/<slug>`). */
	branch: string;
	/** The 40-hex tip the branch pointed at when it was deleted. */
	tip: string;
}

/** A remote `work/<slug>` branch the sweep RETAINED, with the reason it kept it. */
export interface RetainedBranch {
	branch: string;
	tip: string;
	reason: RemoteRetainReason;
	/** Human-readable reason text (`REMOTE_RETAIN_REASON_TEXT[reason]`). */
	reasonText: string;
}

export interface SweepRemoteBranchesInput {
	/**
	 * A local repo (a checkout or a hub mirror) whose `<arbiter>` remote points at
	 * the arbiter to sweep. All git runs in here; nothing in the working tree is
	 * touched (only remote refs are read + deleted).
	 */
	cwd: string;
	/** The arbiter remote name (default `origin`, as `requeue --arbiter` defaults). */
	arbiter: string;
	/** Sink for human-readable progress notes (per reaped / retained branch). */
	note?: (message: string) => void;
	/**
	 * Do NOT actually delete — only REPORT what WOULD be reaped vs retained. A
	 * read-only preview (`--dry-run`); the predicate still runs so the report is
	 * exact.
	 */
	dryRun?: boolean;
	env?: NodeJS.ProcessEnv;
}

export interface SweepRemoteBranchesResult {
	/** The remote branches reaped this sweep (provably merged). Empty on dry-run. */
	reaped: ReapedBranch[];
	/** The remote branches retained, each with a clear reason. */
	retained: RetainedBranch[];
	/** On `dryRun`, the branches that WOULD be reaped (not actually deleted). */
	wouldReap: ReapedBranch[];
}

/**
 * Sweep the arbiter's remote `work/*` branches and DELETE exactly those that are
 * provably merged into `<arbiter>/main` (`git merge-base --is-ancestor`, REUSING
 * `gc.ts`'s `isAncestor`), reporting each as deleted-merged / retained-with-
 * reason. NEVER `--force` (a merged ref needs none); NEVER touches a branch that
 * is not an ancestor of `main` (the in-flight recovery point the never-delete
 * invariant protects). Provider-agnostic plain git, so it works on a `--bare`
 * arbiter.
 *
 * The flow:
 *   1. `git ls-remote --heads <arbiter> 'work/*'` — enumerate remote work
 *      branches + their tips (one network round-trip; no full fetch).
 *   2. Fetch `<arbiter>/main` into a local tracking ref so the ancestor check
 *      resolves the descendant LOCALLY; fetch each candidate tip object too (so
 *      `merge-base` can read it) — best-effort, into a scratch ref.
 *   3. For each branch whose tip `--is-ancestor` of the fetched main ⇒ delete via
 *      `git push <arbiter> --delete <branch>`; else retain with a reason.
 */
export function sweepRemoteMergedBranches(
	input: SweepRemoteBranchesInput,
): SweepRemoteBranchesResult {
	const note = input.note ?? (() => {});
	const env = input.env;
	const dryRun = input.dryRun === true;
	const reaped: ReapedBranch[] = [];
	const retained: RetainedBranch[] = [];
	const wouldReap: ReapedBranch[] = [];

	const branches = listRemoteWorkBranches(input.cwd, input.arbiter, env);

	// Resolve the arbiter's main tip LOCALLY (fetch it into a scratch tracking
	// ref). If it cannot be resolved (unreachable arbiter / no main), we cannot
	// PROVE any branch merged — retain everything (the safe direction).
	const mainRef = fetchScratch(input.cwd, input.arbiter, 'main', env);

	for (const {branch, tip} of branches) {
		if (mainRef === undefined) {
			retain(retained, note, branch, tip, 'main-unresolved');
			continue;
		}
		// Make the candidate tip OBJECT readable locally so `merge-base` can use it
		// (ls-remote gave us the sha, but the object may not be in the local repo).
		fetchScratch(input.cwd, input.arbiter, branch, env);

		if (!isAncestor(input.cwd, tip, mainRef, env)) {
			// NOT an ancestor of main ⇒ still in-flight ⇒ NEVER delete (the invariant).
			retain(retained, note, branch, tip, 'not-merged');
			continue;
		}

		// Provably merged. Report (dry-run) or delete (the real sweep). Deletion of
		// a fully-merged ref needs NO force — and we NEVER force here.
		if (dryRun) {
			wouldReap.push({branch, tip});
			note(`Would reap ${branch} (merged) on ${input.arbiter}.`);
			continue;
		}
		const del = run(
			'git',
			['push', input.arbiter, '--delete', branch],
			input.cwd,
			{env},
		);
		if (del.status !== 0) {
			// A failed delete is NOT a reap; surface it but keep sweeping the rest.
			// Tolerate "already gone" (a concurrent reap) as a clean delete.
			const stderr = del.stderr.trim();
			const alreadyGone = /remote ref does not exist|unable to delete/i.test(
				stderr,
			);
			if (alreadyGone) {
				reaped.push({branch, tip});
				note(`Reaped ${branch} (merged; remote ref was already gone).`);
				continue;
			}
			retain(retained, note, branch, tip, 'not-merged');
			note(
				`Failed to delete ${branch} on ${input.arbiter} (${stderr || 'unknown error'}); kept.`,
			);
			continue;
		}
		reaped.push({branch, tip});
		note(`Reaped ${branch} (merged) on ${input.arbiter}.`);
	}

	return {reaped, retained, wouldReap};
}

/** Push a retained branch into the result + emit its note. */
function retain(
	retained: RetainedBranch[],
	note: (message: string) => void,
	branch: string,
	tip: string,
	reason: RemoteRetainReason,
): void {
	const reasonText = REMOTE_RETAIN_REASON_TEXT[reason];
	retained.push({branch, tip, reason, reasonText});
	note(`Retained ${branch}: ${reasonText}.`);
}

/**
 * Enumerate the arbiter's remote `work/*` heads + their tips via
 * `git ls-remote --heads <arbiter> 'work/*'` (one round-trip, no full fetch).
 * Only `work/<type>-<slug>` branches that {@link parseWorkBranchRef} recognises
 * are returned (a stray `work/foo` that is not a namespaced work branch is
 * ignored — the sweep only reaps the branches the protocol creates). Returns []
 * when the arbiter is unreachable (the safe direction — nothing to reap).
 */
export function listRemoteWorkBranches(
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): Array<{branch: string; tip: string}> {
	const res = run('git', ['ls-remote', '--heads', arbiter, 'work/*'], cwd, {
		env,
	});
	if (res.status !== 0) {
		return [];
	}
	const out: Array<{branch: string; tip: string}> = [];
	for (const line of res.stdout.split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '') {
			continue;
		}
		// Each line is `<sha>\trefs/heads/<branch>`.
		const m = /^([0-9a-f]{40})\s+refs\/heads\/(.+)$/.exec(trimmed);
		if (!m) {
			continue;
		}
		const tip = m[1];
		const branch = m[2];
		// Only namespaced work branches (`work/<type>-<slug>`) — the protocol's own
		// branches. A non-conforming `work/...` head is left untouched.
		if (parseWorkBranchRef(branch) === undefined) {
			continue;
		}
		out.push({branch, tip});
	}
	return out;
}

/**
 * Fetch a single arbiter head into a SCRATCH remote-tracking ref
 * (`refs/remotes/<arbiter>/<head>`) EXPLICITLY (a bare arbiter has no fetch
 * refspec), so the object + ref resolve LOCALLY for the ancestor check. Returns
 * the local ref name on success, or `undefined` when the head could not be
 * fetched (unreachable arbiter / missing head) — the caller reads that as
 * not-provable ⇒ retain (the safe direction). Best-effort; never throws.
 */
function fetchScratch(
	cwd: string,
	arbiter: string,
	head: string,
	env: NodeJS.ProcessEnv | undefined,
): string | undefined {
	const localRef = `refs/remotes/${arbiter}/${head}`;
	const res = run(
		'git',
		['fetch', '--quiet', arbiter, `+refs/heads/${head}:${localRef}`],
		cwd,
		{env},
	);
	if (res.status !== 0) {
		return undefined;
	}
	// Confirm the ref now resolves locally (an empty/odd fetch should read as
	// unresolved → retain).
	const verify = run(
		'git',
		['rev-parse', '--verify', '--quiet', localRef],
		cwd,
		{
			env,
		},
	);
	return verify.status === 0 ? localRef : undefined;
}
