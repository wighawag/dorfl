import type {IntegrationMode} from './config.js';
import {run, git} from './git.js';

/**
 * Integration of a completed work branch back to the arbiter's `main`.
 *
 * `merge` (direct to main): a normal fast-forward / non-force push of the work
 * branch to `main`. NEVER `--force` (the only `--force-with-lease` in the whole
 * system is the claim micro-commit inside claim.sh).
 *
 * `propose` (default): push the work branch to the arbiter under its own ref and
 * request review (a PR when the arbiter is GitHub/PR-compatible). For a local
 * `--bare` arbiter there is no review API — we still push the branch (so the work
 * is preserved for the human) but do NOT touch `main`.
 */
export interface IntegrateOptions {
	cwd: string;
	arbiter: string;
	branch: string;
	mode: IntegrationMode;
	env?: NodeJS.ProcessEnv;
	/** Optional injectable PR opener (e.g. `gh pr create`); used in `propose` mode. */
	openPr?: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void;
}

export interface IntegrateResult {
	mode: IntegrationMode;
	/** True when the work landed on the arbiter's `main` (merge mode only). */
	mergedToMain: boolean;
	/** The ref the work branch was pushed to. */
	pushedRef: string;
	/** True when a PR was opened (propose mode, PR-capable arbiter). */
	prOpened: boolean;
}

/**
 * Push a branch to the arbiter without ever force-updating `main`. Used by both
 * modes; `merge` targets `main`, `propose` targets the branch's own ref.
 */
function pushBranch(
	opts: IntegrateOptions,
	refspec: string,
	allowForce: false,
): void {
	void allowForce; // documentation: we NEVER force-push here.
	git(['push', opts.arbiter, refspec], opts.cwd, {env: opts.env});
}

export function integrate(opts: IntegrateOptions): IntegrateResult {
	if (opts.mode === 'merge') {
		// Direct to main: a plain (non-force) push. If main moved under us this
		// is rejected — caller can refetch/rebase and retry. We MUST NOT --force.
		const refspec = `${opts.branch}:main`;
		pushBranch(opts, refspec, false);
		return {
			mode: 'merge',
			mergedToMain: true,
			pushedRef: 'main',
			prOpened: false,
		};
	}

	// propose (default): push the work branch under its own name; never touch main.
	const refspec = `${opts.branch}:${opts.branch}`;
	pushBranch(opts, refspec, false);
	let prOpened = false;
	if (opts.openPr) {
		opts.openPr({cwd: opts.cwd, branch: opts.branch, env: opts.env});
		prOpened = true;
	}
	return {
		mode: 'propose',
		mergedToMain: false,
		pushedRef: opts.branch,
		prOpened,
	};
}

/** True if the arbiter's `main` currently contains `ref` (work landed). */
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
