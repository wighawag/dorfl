/**
 * Tier-1 GitHub branch-protection STEP for `install-ci` (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, task
 * `install-ci-tier1-branch-protection`; Story 11). Closes the propose-mode
 * PR-merge-time drift window on a GitHub arbiter: a required `verify` check + a
 * `strict: true` ("require branches up to date before merging") rule together
 * force a rebase + re-verify against current `main` before the merge button works.
 *
 * BEHAVIOUR (Applied Answer / Implementation Decision, brief §"Implementation
 * Decisions" — Tier-1 GitHub provisioning is auto-when-admin, instruct-otherwise):
 *
 *   - When the configured credential is repo-admin-scoped, install-ci
 *     AUTO-CONFIGURES branch protection on `main` with the spec built by
 *     {@link buildBranchProtectionSpec}. The required `context` value
 *     ({@link VERIFY_CHECK_CONTEXT}) is the SAME constant the emitted verify
 *     workflow names its job after, so the two cannot drift.
 *   - When only the ambient `GITHUB_TOKEN` (or any non-admin credential) is
 *     available, install-ci NEVER attempts the call — it PRINTS the exact
 *     ready-to-run `gh api` command + a one-liner pointing to the manual UI
 *     fallback (the documented behaviour the brief fixes at launch).
 *
 * SCOPE DETECTION — cheapest of the two options the brief offers. The seam
 * provides `getRepoAdminScope?()` (implemented on the GitHub adapter by reading
 * `permissions.admin` from `GET /repos/{owner}/{repo}` — ONE low-cost read that
 * works uniformly for every token kind: classic PAT, fine-grained PAT, GitHub
 * App, or the ambient `GITHUB_TOKEN`). The ALTERNATIVE — reading the token's
 * DOCUMENTED METADATA — varies by token type (a classic PAT exposes its scopes
 * via the `X-OAuth-Scopes` response header; a fine-grained PAT exposes its
 * resource permissions via a separate endpoint; a GitHub App exposes nothing
 * inspectable from the runtime) and so would mean three code paths and the same
 * number of round-trips at best. ONE uniform repo-permissions read is therefore
 * the cheaper choice on both implementation effort AND wall-clock (a single API
 * call against an endpoint every token can hit). RECORDED IN-PLACE so a future
 * change can flip it knowingly; the brief calls this "pick the cheaper of the
 * two and record the choice."
 *
 * DEADLOCK GUARD — a NEVER-RUN required check would block every merge (GitHub
 * treats an unreported required check as pending). install-ci ORDERS the steps
 * to avoid that:
 *
 *   1. write the verify workflow artifact (the `verify.yml` whose job is named
 *      exactly {@link VERIFY_CHECK_CONTEXT}); the human commits + pushes it to
 *      `main` so the workflow file lands BEFORE the next PR;
 *   2. THEN (this step) set the branch-protection rule.
 *
 * Because the verify workflow uses `on: pull_request`, every PR opened AFTER
 * `verify.yml` is on `main` triggers the workflow and produces the required
 * `verify` check — the protection never deadlocks new PRs. The only edge case
 * is an IN-FLIGHT PR opened BEFORE `verify.yml` landed on `main`: it has no
 * `verify` check waiting; installCI prints exactly that re-trigger remediation
 * in the success log. We chose this "run-the-check-once-by-construction-of-the-
 * trigger" ordering over the ruleset `do_not_enforce_on_create` toggle because
 * (a) one PUT against the existing branch-protection endpoint is simpler than
 * minting a ruleset shape this brief otherwise does not need, AND (b) the
 * `merge_queue` Tier-2 forward seam already lives in the verify workflow's
 * `on:` trigger (so the ruleset seam is not needed here either — it is the
 * follow-on brief's lever). Trade-off RECORDED so a future merge-queue task can
 * flip to rulesets knowingly without re-deciding why we did not now.
 */

import {VERIFY_CHECK_CONTEXT} from './verify-workflow-template.js';
import type {CIProviderContext} from './install-ci-core.js';

export {VERIFY_CHECK_CONTEXT};

/**
 * The branch-protection request body the GitHub adapter PUTs at
 * `/repos/{owner}/{repo}/branches/{branch}/protection`. Shape mirrors the REST
 * docs (the GitHub PUT REQUIRES `enforce_admins`, `required_pull_request_reviews`,
 * and `restrictions` to be present; `null` for "not configured"). We set only
 * the two fields the brief names — the required `${VERIFY_CHECK_CONTEXT}` check
 * AND `strict: true` (= "require branches up to date before merging") — and
 * leave the others `null` so install-ci does not silently impose unrelated
 * gates (reviews, admin enforcement, push restrictions) the user did not opt
 * into.
 */
export interface BranchProtectionSpec {
	required_status_checks: {
		strict: true;
		checks: {context: string}[];
	};
	enforce_admins: null;
	required_pull_request_reviews: null;
	restrictions: null;
}

/**
 * Build the Tier-1 branch-protection spec the GitHub adapter PUTs. The required
 * `context` is the SAME constant the emitted verify workflow names its job
 * after ({@link VERIFY_CHECK_CONTEXT}) — by construction, not by hand-typed
 * agreement, so the two cannot drift.
 */
export function buildBranchProtectionSpec(): BranchProtectionSpec {
	return {
		required_status_checks: {
			strict: true,
			checks: [{context: VERIFY_CHECK_CONTEXT}],
		},
		enforce_admins: null,
		required_pull_request_reviews: null,
		restrictions: null,
	};
}

/**
 * The repo's default branch the protection rule targets (the rule the brief
 * names: protect `main` so a propose-mode PR cannot be merged stale). Exposed
 * as a parameter on the orchestrator so a non-default-branch repo can override.
 */
export const DEFAULT_PROTECTED_BRANCH = 'main';

/**
 * The exact `gh api` command the user runs themselves when install-ci CANNOT
 * auto-configure (no admin scope). Quoted body is the same {@link
 * BranchProtectionSpec} the auto path PUTs, so reproducing the call by copy-paste
 * is byte-equivalent to a successful auto run. Pure string, no I/O.
 */
export function formatManualBranchProtectionCommand(
	repo: string,
	branch: string = DEFAULT_PROTECTED_BRANCH,
): string {
	const spec = buildBranchProtectionSpec();
	const body = JSON.stringify(spec);
	// Single-quote the body so the user's shell does not expand `$`/`!`; embed
	// it via `--input -` so the JSON is read from stdin (avoids `gh api -f`'s
	// scalar-only field syntax limitation).
	return (
		`echo '${body}' | gh api -X PUT ` +
		`-H "Accept: application/vnd.github+json" ` +
		`repos/${repo}/branches/${branch}/protection ` +
		`--input -`
	);
}

/** Options for {@link installCIBranchProtectionStep}. */
export interface BranchProtectionStepOptions {
	/** The CI-provider seam (GitHub adapter in production; stub in tests). */
	ctx: CIProviderContext;
	/** Snapshot mode: never call the live API, never print a "set" success. */
	fake?: boolean;
	/** Sink for human-facing progress lines. */
	log: (line: string) => void;
	/** The branch the rule targets (default `main`). */
	branch?: string;
}

/** The outcome of one branch-protection step run. */
export interface BranchProtectionStepResult {
	/**
	 * - `set` — admin scope, API call succeeded;
	 * - `failed` — admin scope, API call rejected (detail in `error`);
	 * - `instructed` — non-admin scope, the manual `gh api` command was printed;
	 * - `skipped-no-repo` — the provider context has no `repo` known;
	 * - `skipped-no-seam` — the provider context does not implement the
	 *   branch-protection seam (a non-GitHub provider);
	 * - `skipped-fake` — `--fake` snapshot mode (no real API, no real toggle).
	 */
	status:
		| 'set'
		| 'failed'
		| 'instructed'
		| 'skipped-no-repo'
		| 'skipped-no-seam'
		| 'skipped-fake';
	/** The detected admin-scope verdict (`true`/`false`/`undefined`=unknown). */
	adminScope?: boolean;
	/** The failure detail when `status === 'failed'`. */
	error?: string;
	/** The branch the step targeted (echoed for tests / logs). */
	branch: string;
}

/**
 * The orchestrator install-ci calls AFTER artifacts are written + secrets are
 * orchestrated: detect admin scope (cheapest path: {@link
 * CIProviderContext.getRepoAdminScope}), then EITHER call
 * {@link CIProviderContext.setBranchProtection} (admin) OR print the exact
 * ready-to-run `gh api` command + the one-liner manual fallback (non-admin).
 *
 * Never throws — a `setBranchProtection` rejection is reported as `failed` so
 * install-ci's later steps still run, and the user sees both the failure detail
 * AND the manual command to retry by hand.
 */
export async function installCIBranchProtectionStep(
	options: BranchProtectionStepOptions,
): Promise<BranchProtectionStepResult> {
	const branch = options.branch ?? DEFAULT_PROTECTED_BRANCH;
	const {ctx, log, fake} = options;

	if (fake) {
		log(`branch protection: skipped (--fake; would have targeted ${branch})`);
		return {status: 'skipped-fake', branch};
	}
	if (!ctx.setBranchProtection) {
		log(
			'branch protection: skipped (provider does not implement the seam — non-GitHub host).',
		);
		return {status: 'skipped-no-seam', branch};
	}
	if (!ctx.repo) {
		log('branch protection: skipped (repo unknown — pass --repo to enable).');
		return {status: 'skipped-no-repo', branch};
	}

	const repo = ctx.repo;
	// Cheapest scope-detection: one repo-permissions read (see module header).
	// `undefined` ⇒ unknown ⇒ treat as non-admin (instruct, never silently
	// attempt a call that would fail with 403 anyway).
	const adminScope = ctx.getRepoAdminScope
		? await ctx.getRepoAdminScope().catch(() => undefined)
		: undefined;

	if (adminScope !== true) {
		log('branch protection: no admin-scoped credential detected.');
		log(
			`  install-ci will NOT call the GitHub API. Run this yourself (admin token required):`,
		);
		log(`    ${formatManualBranchProtectionCommand(repo, branch)}`);
		log(
			`  Manual UI fallback: https://github.com/${repo}/settings/branches ` +
				`→ "Add branch protection rule" → branch name pattern \`${branch}\` ` +
				`→ enable "Require status checks to pass" + "Require branches to be up to date" ` +
				`→ add required check \`${VERIFY_CHECK_CONTEXT}\`.`,
		);
		log(
			`  (The ambient CI \`GITHUB_TOKEN\` is NEVER admin; a human admin's \`gh\` ` +
				`or a configured PAT/App token with "Administration: write" is required.)`,
		);
		return {status: 'instructed', adminScope, branch};
	}

	const spec = buildBranchProtectionSpec();
	try {
		await ctx.setBranchProtection(branch, spec);
		log(
			`branch protection: set on ${repo}@${branch} ` +
				`(required check \`${VERIFY_CHECK_CONTEXT}\`, strict: true).`,
		);
		log(
			`  NOTE: PRs opened BEFORE \`verify.yml\` lands on \`${branch}\` have ` +
				`no \`${VERIFY_CHECK_CONTEXT}\` check waiting. Push/merge \`verify.yml\` ` +
				`to \`${branch}\` first; existing in-flight PRs may need a no-op push ` +
				`(or close/reopen) to re-trigger the check.`,
		);
		return {status: 'set', adminScope, branch};
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		log(`branch protection: FAILED (${error})`);
		log(
			`  Retry by hand (admin token required):\n` +
				`    ${formatManualBranchProtectionCommand(repo, branch)}`,
		);
		return {status: 'failed', adminScope, error, branch};
	}
}
