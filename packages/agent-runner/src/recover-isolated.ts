import {existsSync} from 'node:fs';
import {performIntegration} from './integration-core.js';
import {resolveArbiterUrlFromCheckout} from './do.js';
import {jobWorktreePath} from './workspace.js';
import {mirrorPath} from './repo-mirror.js';
import {reapJob} from './gc.js';
import {workBranchRef} from './slug-namespace.js';
import {run, type RunResult} from './git.js';
import type {IntegrationMode} from './config.js';
import type {ReviewProvider} from './integrator.js';

/**
 * **`complete --isolated <slug>` — FINISH an already-committed, already-done-moved
 * STRANDED isolated worktree** (brief `ledger-integrity` story 6, the
 * `finish-already-committed-branch` task). The LOCATE-EXISTING inverse of
 * `do --isolated` (which CREATES a worktree): it resolves the slug's RETAINED job
 * worktree via the existing arbiter-URL-keyed naming
 * (`jobWorktreePath`/`encodeWorkId` — NOT a slug glob, since two repos can share a
 * slug), then runs the recover-already-committed integration path
 * (`performIntegration({committedRecovery: true})`) from it: rebase the kept
 * commit onto `<arbiter>/main` → integrate, SKIPPING the (already-done) gate /
 * done-move / commit.
 *
 * IDEMPOTENT / HONEST: when NO worktree is retained for the slug, this is a clean
 * "nothing to recover / already integrated" no-op (exit 0, no crash, no fresh
 * worktree) — after a successful recovery the worktree is reaped, so a re-run
 * correctly finds nothing. The integration core's own UNSPOOFABLE detection
 * (`already-integrated`) covers the case where the worktree still exists but its
 * tip is already on the arbiter (never a double-integrate).
 *
 * `resume --isolated <slug>` shares the SAME locate-existing resolver (see
 * {@link locateIsolatedRecovery}) to re-engage the retained worktree WITHOUT
 * claiming — it just reports the worktree path for the operator to cd into.
 */

const DEFAULT_ARBITER = 'origin';
/** The arbiter remote name valid INSIDE a job worktree (cut from the bare hub mirror). */
const WORKTREE_ARBITER_REMOTE = 'origin';

export type RecoverIsolatedOutcome =
	| 'completed' // integrated the kept commit from the retained worktree
	| 'already-integrated' // the kept tip was already on the arbiter (clean no-op)
	| 'nothing-to-recover' // no retained worktree for the slug (clean no-op)
	| 'rebase-conflict' // the kept commit did not replay onto the latest main
	| 'usage-error'; // not a git repo / no such arbiter remote / etc.

export interface RecoverIsolatedOptions {
	/** The slug to recover (its retained worktree is located by arbiter-URL + slug). */
	slug: string;
	/** The operator's checkout — its arbiter remote names the repo the worktree is off. */
	cwd: string;
	/** Name of the arbiter remote in {@link cwd}. Defaults to `origin`. */
	arbiter?: string;
	/** The execution working area (config `workspacesDir`); where job worktrees live. */
	workspacesDir: string;
	/** Integration mode: `propose` (default) or `merge`. */
	integration?: IntegrationMode;
	/** Suppress the PR on the propose path (push the branch, open no review request). */
	noPR?: boolean;
	/** Optional fully-formed provider used verbatim (test/embedding seam). */
	providerInstance?: ReviewProvider;
	/** Optional injectable PR opener (legacy bridge); used in `propose` mode. */
	openPr?: (opts: {
		cwd: string;
		branch: string;
		env?: NodeJS.ProcessEnv;
	}) => void;
	/** Environment for child git/provider processes (the identity-scoped env). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface RecoverIsolatedResult {
	exitCode: 0 | 1;
	outcome: RecoverIsolatedOutcome;
	/** The work branch that was recovered, when a worktree was located. */
	branch?: string;
	/** The retained worktree dir that was recovered from, when located. */
	worktree?: string;
	/** The review-request URL opened in propose mode, when a provider opened one. */
	prUrl?: string;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/**
 * The LOCATE-EXISTING resolver shared by `complete --isolated` and
 * `resume --isolated`: resolve the arbiter URL from the operator's checkout, then
 * the slug's retained job-worktree dir via `jobWorktreePath` (arbiter-URL-keyed —
 * NOT a slug glob). Returns the resolved dir + arbiter URL when the worktree is
 * PRESENT; an `error` (usage) when the arbiter is unresolvable; or
 * `{present: false}` when no worktree is retained (the clean nothing-to-recover
 * case). Pure resolution — no side effects.
 */
export function locateIsolatedRecovery(params: {
	slug: string;
	cwd: string;
	arbiter: string;
	workspacesDir: string;
	env?: NodeJS.ProcessEnv;
}):
	| {dir: string; arbiterUrl: string; present: true}
	| {present: false}
	| {
			error: string;
	  } {
	const arbiterUrl = resolveArbiterUrlFromCheckout(
		params.cwd,
		params.arbiter,
		params.env,
	);
	if (arbiterUrl === undefined) {
		return {
			error:
				`--isolated finishes a worktree off this repo's arbiter (inferred from ` +
				`cwd), but no '${params.arbiter}' remote was found here (is this a git ` +
				`repo? does the '${params.arbiter}' remote exist?).`,
		};
	}
	const dir = jobWorktreePath(params.workspacesDir, arbiterUrl, params.slug);
	if (!existsSync(dir)) {
		return {present: false};
	}
	return {dir, arbiterUrl, present: true};
}

/**
 * Run the isolated recovery for a stranded, already-committed, already-done-moved
 * worktree (the `complete --isolated <slug>` surface). Never throws for the
 * expected cases — they are returned with a specific outcome + exit code.
 */
export async function performRecoverIsolated(
	options: RecoverIsolatedOptions,
): Promise<RecoverIsolatedResult> {
	const note = options.note ?? (() => {});
	const env = options.env;
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;

	const located = locateIsolatedRecovery({
		slug: options.slug,
		cwd: options.cwd,
		arbiter,
		workspacesDir: options.workspacesDir,
		env,
	});
	if ('error' in located) {
		return {exitCode: 1, outcome: 'usage-error', message: located.error};
	}
	if (!located.present) {
		// No retained worktree — honest no-op: nothing to recover (already
		// integrated + reaped, or never stranded). No crash, NO fresh worktree.
		const message =
			`Nothing to recover for '${options.slug}': no retained isolated worktree ` +
			'found (already integrated and reaped, or never stranded).';
		note(message);
		return {exitCode: 0, outcome: 'nothing-to-recover', message};
	}

	const dir = located.dir;
	const branch = workBranchRef('task', options.slug);
	// The strand left the worktree ON its `work/<slug>` branch; make sure we are on
	// it (it carries the kept committed work + the done-move). Best-effort: if HEAD
	// is already there this is a no-op; a missing branch surfaces as a usage error
	// from the integration core's HEAD-resolution.
	gitSoft(['switch', '--quiet', branch], dir, env);

	note(`Recovering '${options.slug}' from the retained worktree ${dir}…`);
	const core = await performIntegration({
		cwd: dir,
		// Inside a job worktree the arbiter remote is `origin` (the mirror's clone
		// remote), NOT the operator's checkout arbiter name.
		arbiter: WORKTREE_ARBITER_REMOTE,
		slug: options.slug,
		branch,
		source: 'in-progress',
		recovering: false,
		committedRecovery: true,
		mode: options.integration ?? 'propose',
		noPR: options.noPR,
		providerInstance: options.providerInstance,
		openPr: options.openPr,
		env,
		note,
	});

	if (core.outcome === 'already-integrated') {
		// The kept tip is already on the arbiter — a clean no-op. Reap the now-redundant
		// worktree (its branch is provably on the arbiter), so a re-run finds nothing.
		reapIfSafe(options.workspacesDir, located.arbiterUrl, branch, dir, env);
		return {
			exitCode: 0,
			outcome: 'already-integrated',
			branch,
			worktree: dir,
			message: core.reason ?? `'${options.slug}' is already integrated.`,
		};
	}
	if (core.outcome === 'rebase-conflict') {
		// A genuine code conflict — the kept commit stays intact on the branch
		// (recoverable); the operator resolves it and re-runs. Worktree RETAINED.
		return {
			exitCode: 1,
			outcome: 'rebase-conflict',
			branch,
			worktree: dir,
			message:
				core.reason ?? `recovering '${options.slug}' hit a rebase conflict.`,
		};
	}
	if (core.outcome === 'completed') {
		// Integrated from the kept commit. The work is now on the arbiter, so the
		// worktree is provably redundant — reap it (the same §4 predicate the build
		// teardown uses; never lose work — reachability still gates).
		reapIfSafe(options.workspacesDir, located.arbiterUrl, branch, dir, env);
		const prUrl = core.integration?.url;
		const message = prUrl
			? `Recovered '${options.slug}': integrated the kept commit (${prUrl}).`
			: `Recovered '${options.slug}': integrated the kept commit from ${branch}.`;
		note(message);
		return {
			exitCode: 0,
			outcome: 'completed',
			branch,
			worktree: dir,
			prUrl,
			message,
		};
	}
	// Any other core outcome (defensive — committed-recovery only returns the three
	// above): surface it as a usage error rather than mis-reporting success.
	return {
		exitCode: 1,
		outcome: 'usage-error',
		branch,
		worktree: dir,
		message:
			core.reason ??
			`recovering '${options.slug}' returned an unexpected outcome ` +
				`'${core.outcome}'.`,
	};
}

/**
 * Reap the recovered worktree iff its branch is provably on the arbiter (the §4
 * predicate, reachable-only so incidental churn does not retain a worktree whose
 * branch is already safe). Best-effort: never throws on this success path.
 */
function reapIfSafe(
	workspacesDir: string,
	arbiterUrl: string,
	branch: string,
	dir: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	try {
		reapJob({
			dir,
			branch,
			mirrorPath: mirrorPath(workspacesDir, arbiterUrl),
			reachableOnly: true,
			env,
		});
	} catch {
		// best-effort — the work is already on the arbiter; a reap failure is cosmetic.
	}
}

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	return run('git', args, cwd, {env});
}
