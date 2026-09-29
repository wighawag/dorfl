/**
 * The "Allow GitHub Actions to create and approve pull requests" STEP for
 * `install-ci` (task `install-ci-enables-actions-pr-creation`). A new GitHub
 * repository has this setting OFF (`GET repos/<r>/actions/permissions/workflow`
 * answers `can_approve_pull_request_reviews: false`), and with it off GitHub
 * refuses every pull request the generated workflows try to open with the
 * ambient `GITHUB_TOKEN`, so propose mode silently opens no PR. dorfl's own
 * repository has it on, which is why this was only found in a fresh sandbox.
 *
 * BEHAVIOUR (mirrors the Tier-1 branch-protection step,
 * `install-ci-branch-protection.ts`: auto-when-admin, instruct-otherwise):
 *
 *   - READ the setting ({@link CIProviderContext.getActionsWorkflowPermissions}).
 *     Already on: leave it alone and say so.
 *   - Off (or unreadable) and the credential is repo-admin-scoped: SET it
 *     ({@link CIProviderContext.setActionsWorkflowPermissions}) with
 *     `can_approve_pull_request_reviews: true`, carrying the
 *     `default_workflow_permissions` value that was read so the GITHUB_TOKEN's
 *     default scope is preserved, never widened or narrowed.
 *   - Not admin (or unknown): never call the API; print the exact `gh api`
 *     command and the settings page instead. A rejected PUT is `failed` and
 *     prints the same command to retry by hand.
 *   - `--fake`: report what would be checked, call nothing.
 *
 * Never throws: a failure is reported in the result and the log, so install-ci's
 * later steps still run.
 */

import type {
	ActionsWorkflowPermissions,
	CIProviderContext,
} from './install-ci-core.js';

export type {ActionsWorkflowPermissions};

/**
 * The exact `gh api` command a user runs to turn the setting on by hand. When
 * the current `default_workflow_permissions` is known it is passed back
 * unchanged; when it is not, the field is omitted, which leaves it as it is on
 * GitHub (both PUT fields are optional). Pure string, no I/O.
 */
export function formatManualActionsPrCreationCommand(
	repo: string,
	defaultWorkflowPermissions?: string,
): string {
	const keep =
		defaultWorkflowPermissions !== undefined
			? ` -f default_workflow_permissions=${defaultWorkflowPermissions}`
			: '';
	return (
		`gh api -X PUT repos/${repo}/actions/permissions/workflow ` +
		`-F can_approve_pull_request_reviews=true${keep}`
	);
}

/** Options for {@link installCIActionsPrCreationStep}. */
export interface ActionsPrCreationStepOptions {
	/** The CI-provider seam (GitHub adapter in production; stub in tests). */
	ctx: CIProviderContext;
	/** Snapshot mode: never call the live API. */
	fake?: boolean;
	/** Sink for human-facing progress lines. */
	log: (line: string) => void;
}

/** The outcome of one actions-PR-creation step run. */
export interface ActionsPrCreationStepResult {
	/**
	 * - `already-enabled`: the setting was on; nothing was changed;
	 * - `set`: it was off (or unreadable), admin scope, the PUT succeeded;
	 * - `failed`: admin scope, the PUT was rejected (detail in `error`);
	 * - `instructed`: not admin (or unknown), the manual command was printed;
	 * - `skipped-no-repo`: the provider context has no `repo` known;
	 * - `skipped-no-seam`: the provider does not implement the seam;
	 * - `skipped-fake`: `--fake` snapshot mode (no real API touched).
	 */
	status:
		| 'already-enabled'
		| 'set'
		| 'failed'
		| 'instructed'
		| 'skipped-no-repo'
		| 'skipped-no-seam'
		| 'skipped-fake';
	/** The permissions read before any change (`undefined` when unreadable). */
	before?: ActionsWorkflowPermissions;
	/** The detected admin-scope verdict (`true`/`false`/`undefined`=unknown). */
	adminScope?: boolean;
	/** The failure detail when `status === 'failed'`. */
	error?: string;
}

const LABEL = 'actions PR creation';

/**
 * Check, and when off and permitted, enable the repository setting that lets
 * GitHub Actions create pull requests (see the module header).
 */
export async function installCIActionsPrCreationStep(
	options: ActionsPrCreationStepOptions,
): Promise<ActionsPrCreationStepResult> {
	const {ctx, log, fake} = options;

	if (fake) {
		log(
			`${LABEL}: skipped (--fake; would check that "Allow GitHub Actions to create and approve pull requests" is on, and enable it if not)`,
		);
		return {status: 'skipped-fake'};
	}
	if (
		!ctx.getActionsWorkflowPermissions ||
		!ctx.setActionsWorkflowPermissions
	) {
		log(
			`${LABEL}: skipped (provider does not implement the seam, non-GitHub host).`,
		);
		return {status: 'skipped-no-seam'};
	}
	if (!ctx.repo) {
		log(`${LABEL}: skipped (repo unknown, pass --repo to enable).`);
		return {status: 'skipped-no-repo'};
	}
	const repo = ctx.repo;

	const before = await ctx
		.getActionsWorkflowPermissions()
		.catch(() => undefined);
	if (before?.canApprovePullRequestReviews === true) {
		log(
			`${LABEL}: "Allow GitHub Actions to create and approve pull requests" is already on for ${repo}.`,
		);
		return {status: 'already-enabled', before};
	}

	const keep = before?.defaultWorkflowPermissions;
	const adminScope = ctx.getRepoAdminScope
		? await ctx.getRepoAdminScope().catch(() => undefined)
		: undefined;

	if (adminScope !== true) {
		log(
			before === undefined
				? `${LABEL}: could not read "Allow GitHub Actions to create and approve pull requests" for ${repo}, and no admin-scoped credential was detected.`
				: `${LABEL}: "Allow GitHub Actions to create and approve pull requests" is OFF for ${repo}, and no admin-scoped credential was detected.`,
		);
		log(
			'  With it off, propose mode opens no pull request (GitHub refuses PRs created with GITHUB_TOKEN).',
		);
		log(
			'  install-ci will NOT call the GitHub API. Run this yourself (admin token required):',
		);
		log(`    ${formatManualActionsPrCreationCommand(repo, keep)}`);
		log(
			`  Manual UI fallback: https://github.com/${repo}/settings/actions ` +
				'→ "Workflow permissions" → tick "Allow GitHub Actions to create and approve pull requests" → Save.',
		);
		return {status: 'instructed', before, adminScope};
	}

	try {
		// Carry the default scope through unchanged; when it could not be read,
		// omit it so GitHub keeps whatever it is.
		await ctx.setActionsWorkflowPermissions({
			canApprovePullRequestReviews: true,
			...(keep !== undefined ? {defaultWorkflowPermissions: keep} : {}),
		});
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		log(`${LABEL}: FAILED (${error})`);
		log(
			'  With it off, propose mode opens no pull request (GitHub refuses PRs created with GITHUB_TOKEN).',
		);
		log(
			`  Retry by hand (admin token required):\n` +
				`    ${formatManualActionsPrCreationCommand(repo, keep)}`,
		);
		return {status: 'failed', before, adminScope, error};
	}
	log(
		`${LABEL}: enabled "Allow GitHub Actions to create and approve pull requests" on ${repo}` +
			(keep !== undefined
				? ` (default_workflow_permissions kept as ${keep}).`
				: '.'),
	);
	return {status: 'set', before, adminScope};
}
