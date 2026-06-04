import type {IntegrationMode} from './config.js';
import {git, run} from './git.js';

/**
 * The **integration seam** (ADR §6): integrating a completed work branch back to
 * the arbiter has two orthogonal axes —
 *
 *   - **mode**: `merge` (ff/rebase onto `<arbiter>/main`, push to main —
 *     provider-agnostic git) or `propose` (push the branch + request review).
 *   - **provider** (a seam): the review-request tool — `github` (its own slice)
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
	 * a provider failure never loses work.
	 */
	openRequest(input: OpenRequestInput): OpenRequestResult;
}

export interface OpenRequestInput {
	cwd: string;
	/** The pushed work branch to request review of. */
	branch: string;
	/** The arbiter remote the branch was pushed to. */
	arbiter: string;
	env?: NodeJS.ProcessEnv;
}

export interface OpenRequestResult {
	/** True iff a review request was actually opened (a real provider). */
	opened: boolean;
	/** Human-readable next step / confirmation. */
	instruction: string;
}

/**
 * The graceful-degradation provider (ADR §6): it opens NO review request (there
 * is no API — e.g. a local `--bare` arbiter) and instead tells the human to open
 * one manually. The branch is already pushed, so the work is safe regardless.
 */
export class NoneProvider implements ReviewProvider {
	readonly name = 'none';

	openRequest(input: OpenRequestInput): OpenRequestResult {
		return {
			opened: false,
			instruction:
				`Pushed ${input.branch} to ${input.arbiter}. Open a review request ` +
				'manually to land it on main (no review provider configured).',
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
	env?: NodeJS.ProcessEnv;
}

export interface IntegrateResult {
	mode: IntegrationMode;
	/** True when the work landed on the arbiter's `main` (merge mode). */
	mergedToMain: boolean;
	/** The ref the work was pushed to (`main` for merge, the branch for propose). */
	pushedRef: string;
	/** The provider name used (propose mode); `none` in merge mode. */
	provider: string;
	/** True iff a review request was opened (propose + a real provider). */
	requestOpened: boolean;
	/** Human-readable next step (propose mode). */
	instruction?: string;
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
	 * provider to request review. NEVER `--force`.
	 */
	integrate(input: IntegrateInput): IntegrateResult {
		if (input.mode === 'merge') {
			pushBranch(input, `${input.branch}:main`);
			return {
				mode: 'merge',
				mergedToMain: true,
				pushedRef: 'main',
				provider: 'none',
				requestOpened: false,
			};
		}

		// propose: push the branch under its own name (the safety-bearing step),
		// THEN ask the provider to request review.
		pushBranch(input, `${input.branch}:${input.branch}`);
		const review = this.provider.openRequest({
			cwd: input.cwd,
			branch: input.branch,
			arbiter: input.arbiter,
			env: input.env,
		});
		return {
			mode: 'propose',
			mergedToMain: false,
			pushedRef: input.branch,
			provider: this.provider.name,
			requestOpened: review.opened,
			instruction: review.instruction,
		};
	}

	/**
	 * Rebase-before-integrate (ADR §10): fetch + rebase the branch onto the latest
	 * `<arbiter>/main`. Clean → integrate. Conflict → the rebase is already
	 * aborted by `rebaseOntoArbiterMain`; we return `needs-attention` (NEVER
	 * auto-resolve, NEVER push a half-merged tree).
	 */
	integrateWithRebase(input: IntegrateInput): IntegrateWithRebaseResult {
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
		return {outcome: 'integrated', integration: this.integrate(input)};
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

/**
 * Push a branch to the arbiter without ever force-updating anything. Used by
 * both modes; `merge` targets `main`, `propose` targets the branch's own ref.
 * There is NO `--force` here (the only force in the whole system is the claim
 * micro-commit's `--force-with-lease` inside claim.sh).
 */
function pushBranch(input: IntegrateInput, refspec: string): void {
	git(['push', input.arbiter, refspec], input.cwd, {env: input.env});
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
