/**
 * Tier-1 GitHub branch-protection STEP for `install-ci` (spec
 * `land-time-reverify-and-parallel-merge-ceiling`, task
 * `install-ci-tier1-branch-protection`; Story 11). Closes the propose-mode
 * PR-merge-time drift window on a GitHub arbiter: a required `verify` check + a
 * `strict: true` ("require branches up to date before merging") rule together
 * force a rebase + re-verify against current `main` before the merge button works.
 *
 * BEHAVIOUR (Applied Answer / Implementation Decision, spec §"Implementation
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
 *     fallback (the documented behaviour the spec fixes at launch).
 *
 * SCOPE DETECTION — cheapest of the two options the spec offers. The seam
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
 * change can flip it knowingly; the spec calls this "pick the cheaper of the
 * two and record the choice."
 *
 * DEFAULT BRANCH — NOT hardcoded to `main`. The GitHub adapter resolves the
 * repo's real default branch ({@link CIProviderContext.getDefaultBranch}, via
 * `gh repo view --json defaultBranchRef`); the orchestrator threads it into
 * BOTH the classic PUT and the printed `gh api` fallback so a `master`-defaulted
 * (or otherwise-renamed) repo is protected on the correct branch instead of
 * 404-ing a hardcoded `main`. The lookup falls back to {@link
 * DEFAULT_PROTECTED_BRANCH} (`main`) only when it fails/empties, and that
 * fallback is LOGGED so it is visible. An explicit `branch` option still wins
 * over auto-detection (a repo whose protected branch is not its default).
 *
 * DEADLOCK GUARD — a required check that has NEVER reported blocks every merge
 * (GitHub treats an unreported required check as pending), so a PR opened before
 * `verify.yml` first ran would deadlock. The guard is a RUNTIME MECHANISM, not a
 * log line: the required-`verify` check is enforced through a branch RULESET
 * ({@link buildBranchProtectionRuleset}, `POST /repos/{owner}/{repo}/rulesets`)
 * whose `required_status_checks` rule carries `do_not_enforce_on_create: true` —
 * GitHub's native "require this check, but do not fail refs created before the
 * rule / before the check first ran" toggle. The ruleset targets the resolved
 * default branch via `conditions.ref_name`.
 *
 * WHY RULESET FOR THE GUARD BUT CLASSIC PUT FOR THE BASE (nit-a preserved).
 * The base protection stays a single classic PUT
 * ({@link buildBranchProtectionSpec}: `strict: true` = "require branches up to
 * date before merging") because that endpoint is the simplest way to express
 * up-to-date-ness and nit-a ratified the classic-PUT choice. ONLY the deadlock-
 * prone piece — the required-status-check gate — moves to a ruleset, because the
 * `do_not_enforce_on_create` create-exemption exists ONLY on rulesets, not on
 * the classic `required_status_checks` object. Keeping the required check in the
 * classic PUT AND adding the ruleset would double-enforce it and NULLIFY the
 * exemption (the classic copy has no exemption), so the required check lives in
 * the ruleset ALONE; the classic PUT keeps `strict` with an EMPTY `checks`
 * array (valid: "require up to date", no named required check at the classic
 * layer). This is exactly "only the deadlock-guard aspect needs the ruleset" —
 * not a full base-protection migration. Chosen over the pre-run mechanism
 * (`gh workflow run` + wait) because `writeArtifacts` writes `verify.yml`
 * LOCALLY and does NOT push, so at install time the workflow is not yet on the
 * default branch and a pre-run has nothing to dispatch. The ruleset toggle needs
 * no pushed workflow and no wait, so it is the only viable runtime guard here.
 */

import {VERIFY_CHECK_CONTEXT} from './verify-workflow-template.js';
import type {CIProviderContext} from './install-ci-core.js';

export {VERIFY_CHECK_CONTEXT};

/**
 * The BASE branch-protection request body the GitHub adapter PUTs at
 * `/repos/{owner}/{repo}/branches/{branch}/protection`. Shape mirrors the REST
 * docs (the GitHub PUT REQUIRES `enforce_admins`, `required_pull_request_reviews`,
 * and `restrictions` to be present; `null` for "not configured"). We set only
 * `strict: true` (= "require branches up to date before merging") with an EMPTY
 * `checks` array — the required `${VERIFY_CHECK_CONTEXT}` check is NOT here; it
 * lives in the deadlock-guard RULESET ({@link buildBranchProtectionRuleset}) so
 * its `do_not_enforce_on_create` create-exemption is meaningful (see module
 * header). The other required fields stay `null` so install-ci does not silently
 * impose unrelated gates (reviews, admin enforcement, push restrictions) the
 * user did not opt into.
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
 * Build the Tier-1 BASE branch-protection spec the GitHub adapter PUTs
 * (`strict: true`, no named required check — the required check is the ruleset's
 * job, see {@link buildBranchProtectionRuleset} and the module header).
 */
export function buildBranchProtectionSpec(): BranchProtectionSpec {
	return {
		required_status_checks: {
			strict: true,
			checks: [],
		},
		enforce_admins: null,
		required_pull_request_reviews: null,
		restrictions: null,
	};
}

/** The name the deadlock-guard ruleset is created under (stable/idempotent-ish). */
export const BRANCH_PROTECTION_RULESET_NAME = 'dorfl-verify-required';

/**
 * The deadlock-guard RULESET body the GitHub adapter POSTs at
 * `/repos/{owner}/{repo}/rulesets`. It carries the required-`${VERIFY_CHECK_CONTEXT}`
 * status-check rule with `do_not_enforce_on_create: true` — GitHub's native
 * "require this check, but do not fail refs that predate the rule / the check's
 * first run" toggle (the runtime deadlock guard). `enforcement: 'active'` +
 * `conditions.ref_name` scope it to the resolved default branch. The required
 * `context` is the SAME {@link VERIFY_CHECK_CONTEXT} constant the emitted verify
 * workflow names its job after — by construction, so the two cannot drift.
 */
export interface BranchProtectionRuleset {
	name: string;
	target: 'branch';
	enforcement: 'active';
	conditions: {
		ref_name: {
			include: string[];
			exclude: string[];
		};
	};
	rules: {
		type: 'required_status_checks';
		parameters: {
			strict_required_status_checks_policy: boolean;
			do_not_enforce_on_create: true;
			required_status_checks: {context: string}[];
		};
	}[];
}

/**
 * Build the deadlock-guard ruleset for `branch` (the resolved default branch).
 * The `ref_name` include uses the exact-ref form (`refs/heads/<branch>`) so the
 * rule targets only that branch. `do_not_enforce_on_create: true` is the guard.
 */
export function buildBranchProtectionRuleset(
	branch: string = DEFAULT_PROTECTED_BRANCH,
): BranchProtectionRuleset {
	return {
		name: BRANCH_PROTECTION_RULESET_NAME,
		target: 'branch',
		enforcement: 'active',
		conditions: {
			ref_name: {
				include: [`refs/heads/${branch}`],
				exclude: [],
			},
		},
		rules: [
			{
				type: 'required_status_checks',
				parameters: {
					strict_required_status_checks_policy: true,
					do_not_enforce_on_create: true,
					required_status_checks: [{context: VERIFY_CHECK_CONTEXT}],
				},
			},
		],
	};
}

/**
 * The repo's default branch the protection rule targets (the rule the spec
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

/**
 * The exact `gh api` command the user runs themselves to create the deadlock-
 * guard RULESET when install-ci cannot auto-configure (no admin scope). Quoted
 * body is the same {@link BranchProtectionRuleset} the auto path POSTs, so
 * reproducing the call by copy-paste is byte-equivalent to a successful auto
 * run. Pure string, no I/O.
 */
export function formatManualBranchRulesetCommand(
	repo: string,
	branch: string = DEFAULT_PROTECTED_BRANCH,
): string {
	const body = JSON.stringify(buildBranchProtectionRuleset(branch));
	return (
		`echo '${body}' | gh api -X POST ` +
		`-H "Accept: application/vnd.github+json" ` +
		`repos/${repo}/rulesets ` +
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
	/**
	 * Explicitly override the branch the rule targets. When OMITTED, the step
	 * auto-detects the repo's default branch via
	 * {@link CIProviderContext.getDefaultBranch}, falling back to
	 * {@link DEFAULT_PROTECTED_BRANCH} (`main`) and logging the fallback. An
	 * explicit value always wins over auto-detection.
	 */
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
	/**
	 * Whether the branch was AUTO-DETECTED (`true`) or came from an explicit
	 * `branch` option / the `main` fallback (`false`). Echoed for tests / logs.
	 */
	branchAutoDetected?: boolean;
	/**
	 * The deadlock-guard RULESET outcome (only on the admin auto path):
	 * - `set` — the ruleset POST succeeded;
	 * - `failed` — the ruleset POST was rejected (detail in `rulesetError`);
	 * - `skipped-no-seam` — the provider does not implement the ruleset seam.
	 * Absent on the non-admin / skipped paths.
	 */
	rulesetStatus?: 'set' | 'failed' | 'skipped-no-seam';
	/** The ruleset failure detail when `rulesetStatus === 'failed'`. */
	rulesetError?: string;
}

/**
 * Resolve the branch the protection targets. An EXPLICIT `branch` option always
 * wins; otherwise auto-detect the repo's default branch via
 * {@link CIProviderContext.getDefaultBranch}, falling back to `main` (LOGGED)
 * when the lookup fails/empties. Returns the branch + whether it was
 * auto-detected (for the result / log lines).
 */
async function resolveTargetBranch(
	ctx: CIProviderContext,
	explicit: string | undefined,
	log: (line: string) => void,
): Promise<{branch: string; autoDetected: boolean}> {
	if (explicit !== undefined) {
		return {branch: explicit, autoDetected: false};
	}
	const detected = ctx.getDefaultBranch
		? await ctx.getDefaultBranch().catch(() => undefined)
		: undefined;
	if (detected) {
		return {branch: detected, autoDetected: true};
	}
	log(
		`branch protection: could not detect the default branch; ` +
			`falling back to \`${DEFAULT_PROTECTED_BRANCH}\`.`,
	);
	return {branch: DEFAULT_PROTECTED_BRANCH, autoDetected: false};
}

/**
 * The orchestrator install-ci calls AFTER artifacts are written + secrets are
 * orchestrated:
 *
 *   1. RESOLVE the target branch (explicit option > auto-detected default
 *      branch > `main` fallback), so the PUT + printed fallback target the real
 *      default branch (see module header, "DEFAULT BRANCH");
 *   2. detect admin scope (cheapest path: {@link
 *      CIProviderContext.getRepoAdminScope});
 *   3. ADMIN: PUT the base protection ({@link
 *      CIProviderContext.setBranchProtection}) AND create the deadlock-guard
 *      ruleset ({@link CIProviderContext.setBranchRuleset}); NON-ADMIN: print
 *      the exact ready-to-run `gh api` commands (PUT + ruleset POST) + the
 *      manual UI fallback.
 *
 * Never throws — a `setBranchProtection` rejection is reported as `failed`, a
 * `setBranchRuleset` rejection as `rulesetStatus: 'failed'`, so install-ci's
 * later steps still run and the user sees the failure detail AND the manual
 * command to retry by hand.
 */
export async function installCIBranchProtectionStep(
	options: BranchProtectionStepOptions,
): Promise<BranchProtectionStepResult> {
	const {ctx, log, fake} = options;

	if (fake) {
		const target = options.branch ?? DEFAULT_PROTECTED_BRANCH;
		log(`branch protection: skipped (--fake; would have targeted ${target})`);
		return {status: 'skipped-fake', branch: target};
	}
	if (!ctx.setBranchProtection) {
		log(
			'branch protection: skipped (provider does not implement the seam — non-GitHub host).',
		);
		return {
			status: 'skipped-no-seam',
			branch: options.branch ?? DEFAULT_PROTECTED_BRANCH,
		};
	}
	if (!ctx.repo) {
		log('branch protection: skipped (repo unknown — pass --repo to enable).');
		return {
			status: 'skipped-no-repo',
			branch: options.branch ?? DEFAULT_PROTECTED_BRANCH,
		};
	}

	const repo = ctx.repo;
	const {branch, autoDetected} = await resolveTargetBranch(
		ctx,
		options.branch,
		log,
	);

	// Cheapest scope-detection: one repo-permissions read (see module header).
	// `undefined` ⇒ unknown ⇒ treat as non-admin (instruct, never silently
	// attempt a call that would fail with 403 anyway).
	const adminScope = ctx.getRepoAdminScope
		? await ctx.getRepoAdminScope().catch(() => undefined)
		: undefined;

	if (adminScope !== true) {
		log('branch protection: no admin-scoped credential detected.');
		log(
			`  install-ci will NOT call the GitHub API. Run these yourself (admin token required):`,
		);
		log(`    ${formatManualBranchProtectionCommand(repo, branch)}`);
		log(
			`  Then create the deadlock-guard ruleset (required check \`${VERIFY_CHECK_CONTEXT}\`, ` +
				`do_not_enforce_on_create):`,
		);
		log(`    ${formatManualBranchRulesetCommand(repo, branch)}`);
		log(
			`  Manual UI fallback: https://github.com/${repo}/settings/branches ` +
				`→ "Add branch protection rule" → branch name pattern \`${branch}\` ` +
				`→ enable "Require branches to be up to date", then add a RULESET ` +
				`requiring \`${VERIFY_CHECK_CONTEXT}\` with "Do not require ... on creation".`,
		);
		log(
			`  (The ambient CI \`GITHUB_TOKEN\` is NEVER admin; a human admin's \`gh\` ` +
				`or a configured PAT/App token with "Administration: write" is required.)`,
		);
		return {
			status: 'instructed',
			adminScope,
			branch,
			branchAutoDetected: autoDetected,
		};
	}

	const spec = buildBranchProtectionSpec();
	try {
		await ctx.setBranchProtection(branch, spec);
		log(
			`branch protection: set on ${repo}@${branch} ` +
				`(strict: true = require branches up to date).`,
		);
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		log(`branch protection: FAILED (${error})`);
		log(
			`  Retry by hand (admin token required):\n` +
				`    ${formatManualBranchProtectionCommand(repo, branch)}`,
		);
		return {
			status: 'failed',
			adminScope,
			error,
			branch,
			branchAutoDetected: autoDetected,
		};
	}

	// The deadlock guard: the required `verify` check lives in a RULESET with
	// `do_not_enforce_on_create: true` (see module header), NOT in the classic
	// PUT above — so a ref that predates the rule / the check's first run is not
	// deadlocked by a never-reported required check.
	let rulesetStatus: 'set' | 'failed' | 'skipped-no-seam';
	let rulesetError: string | undefined;
	if (!ctx.setBranchRuleset) {
		rulesetStatus = 'skipped-no-seam';
		log(
			`  deadlock guard: provider does not implement the ruleset seam; ` +
				`required check \`${VERIFY_CHECK_CONTEXT}\` NOT enforced.`,
		);
	} else {
		try {
			await ctx.setBranchRuleset(buildBranchProtectionRuleset(branch));
			rulesetStatus = 'set';
			log(
				`deadlock-guard ruleset: created on ${repo}@${branch} ` +
					`(required check \`${VERIFY_CHECK_CONTEXT}\`, do_not_enforce_on_create: true).`,
			);
			log(
				`  NOTE: still push/merge \`verify.yml\` to \`${branch}\` so the check ` +
					`can report on new PRs; the ruleset's create-exemption keeps existing ` +
					`in-flight refs from deadlocking on the not-yet-run check.`,
			);
		} catch (err) {
			rulesetError = err instanceof Error ? err.message : String(err);
			rulesetStatus = 'failed';
			log(`deadlock-guard ruleset: FAILED (${rulesetError})`);
			log(
				`  Retry by hand (admin token required):\n` +
					`    ${formatManualBranchRulesetCommand(repo, branch)}`,
			);
		}
	}

	return {
		status: 'set',
		adminScope,
		branch,
		branchAutoDetected: autoDetected,
		rulesetStatus,
		rulesetError,
	};
}
