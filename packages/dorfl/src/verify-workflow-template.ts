/**
 * The `install-ci` VERIFY-WORKFLOW capability (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, task
 * `install-ci-tier1-branch-protection`; Story 11 — the Tier-1 GitHub ceiling).
 * Emits a small `verify.yml` workflow whose ONLY job is `verify` and runs on
 * `pull_request` (and `merge_group`, the Tier-2 forward seam). It produces the
 * GitHub check named exactly {@link VERIFY_CHECK_CONTEXT}, which the
 * branch-protection step ({@link installCIBranchProtectionStep}) names as the
 * required-status check `context`. Co-locating the two strings — the EMITTED
 * job/check name AND the REQUIRED context — in one constant pins the
 * acceptance-criterion "context matches the workflow's job name" by construction
 * (a single test diffs the two).
 *
 * The workflow is deliberately thin: it wires the same composite setup action
 * the other capabilities use, then runs `dorfl verify` — the deterministic shell
 * gate the repo declares in `.dorfl.json`. No agent, no provider secrets, no
 * `gh` mutation; it is read-only with respect to `work/`.
 *
 * `merge_group` is present (with no extra wiring) so a follow-on Tier-2 task
 * (GitHub Merge Queue) can flip the ruleset on without changing this workflow's
 * trigger surface — the forward seam the brief's Applied Answers q3 names.
 */

import type {ResolvedCIConfig} from './install-ci-core.js';

/**
 * The required-status-check CONTEXT install-ci sets via branch protection AND the
 * job/check name the emitted verify workflow produces. ONE source of truth so
 * the two strings can never drift (the "context matches the workflow's job name"
 * acceptance criterion is enforced by both reading this constant).
 */
export const VERIFY_CHECK_CONTEXT = 'verify';

/** The capability id (the registry key + the emitted workflow file stem). */
export const VERIFY_CAPABILITY_ID = 'verify';

/** The wizard-facing label for the verify capability. */
export const VERIFY_CAPABILITY_LABEL =
	'Run the repo `verify` gate on every PR (the Tier-1 GitHub ceiling: produces the required-status check `verify` that branch protection requires)';

/** The repo-relative path (under the output base) of the emitted workflow. */
export const VERIFY_WORKFLOW_PATH = 'workflows/verify.yml';

/**
 * Generate the verify workflow YAML. Deterministic: the same config produces
 * byte-identical output. The job is named exactly {@link VERIFY_CHECK_CONTEXT}
 * so the GitHub check it produces matches the required-status `context` install-ci
 * configures on `main` — by construction, not by hand-typed agreement.
 */
export function generateVerifyWorkflow(_config: ResolvedCIConfig): string {
	return `\
# dorfl — the VERIFY workflow (Tier-1 GitHub ceiling; prd
# land-time-reverify-and-parallel-merge-ceiling, task
# install-ci-tier1-branch-protection). EMITTED by \`dorfl install-ci\`; the
# human commits it. DO NOT hand-edit a copy — re-run install-ci to upgrade.
#
# This workflow exists SOLELY to produce a GitHub check named \`${VERIFY_CHECK_CONTEXT}\`
# on every pull request, which install-ci's branch-protection step requires
# (\`required_status_checks.strict: true\` + a required \`${VERIFY_CHECK_CONTEXT}\` context)
# so a PR cannot be merged stale. The merge button is disabled until \`${VERIFY_CHECK_CONTEXT}\`
# reports success on the rebased PR head — closing the PR-merge-time drift window
# story 7 names.
#
# \`merge_group\` is listed so a follow-on Tier-2 task (GitHub Merge Queue) can
# enable speculative-rebase merging by flipping the ruleset, WITHOUT changing
# this workflow's trigger surface (the Applied Answer q3 forward seam).
#
# CONTEXT NAMING — the job is named EXACTLY \`${VERIFY_CHECK_CONTEXT}\`. install-ci
# names the same string as the required-context, so they cannot drift. If you
# rename the job here you MUST re-run install-ci (or the protection's required
# context will not match this workflow and every PR will block forever).
#
# SAFETY (US #9): the running job requests NO \`workflows\` permission and runs
# only \`dorfl verify\` (a deterministic shell gate; \`pnpm format:check && pnpm
# build && pnpm test\` for the dorfl repo). It cannot edit \`.github/workflows/**\`
# or mutate \`work/\`.

name: ${VERIFY_CHECK_CONTEXT}

on:
  pull_request:
  # Tier-2 forward seam: a follow-on task enables GitHub Merge Queue and the
  # same job re-runs on the speculative-rebase merge-group head, no template edit.
  merge_group:

# Serialise overlapping verify runs on the same ref (the latest commit wins —
# stale runs are cancelled, since \`verify\` is a pure pass/fail gate).
concurrency:
  group: ${VERIFY_CHECK_CONTEXT}-\${{ github.ref }}
  cancel-in-progress: true

# NO \`workflows\` permission (US #9). \`contents: read\` is all the gate needs.
permissions:
  contents: read

jobs:
  # The job name IS the GitHub check context — it must equal VERIFY_CHECK_CONTEXT
  # (\`${VERIFY_CHECK_CONTEXT}\`) or install-ci's branch protection will require a
  # context this workflow does not produce.
  ${VERIFY_CHECK_CONTEXT}:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/dorfl-setup
      - name: run the repo verify gate
        run: dorfl verify
`;
}

/** A single structural problem found in the generated verify workflow. */
export interface VerifyWorkflowProblem {
	id: string;
	message: string;
}

/** Result of {@link validateVerifyWorkflow}. */
export interface VerifyWorkflowValidation {
	ok: boolean;
	problems: VerifyWorkflowProblem[];
}

/**
 * Structurally validate the verify workflow against the task's acceptance
 * criteria (job name = required context, runs on `pull_request`, ships the
 * `merge_group` seam, no `workflows:` permission).
 */
export function validateVerifyWorkflow(text: string): VerifyWorkflowValidation {
	const problems: VerifyWorkflowProblem[] = [];
	const require = (id: string, present: boolean, message: string): void => {
		if (!present) problems.push({id, message});
	};
	const operative = text
		.split('\n')
		.filter((line) => !/^\s*#/.test(line))
		.join('\n');

	require('job-named-verify-context', new RegExp(
		`^\\s{2}${VERIFY_CHECK_CONTEXT}:\\s*$`,
		'm',
	).test(
		operative,
	), `the workflow must declare a job named exactly \`${VERIFY_CHECK_CONTEXT}\` ` +
		'(its name IS the GitHub check context install-ci requires).');
	require('trigger-pull-request', /\bon:\s*[\s\S]*?\bpull_request\s*:/.test(
		operative,
	), 'must trigger on `pull_request` (the check must run on every PR).');
	require('trigger-merge-group-seam', /\bmerge_group\s*:/.test(
		operative,
	), 'must list `merge_group` as a trigger (the Tier-2 GitHub Merge Queue forward seam).');
	require('no-workflows-permission', !/\bworkflows\s*:\s*write\b/.test(
		operative,
	), 'must request NO `workflows` permission (US #9).');
	require('runs-dorfl-verify', /dorfl verify\b/.test(
		operative,
	), 'the job must run `dorfl verify` (the deterministic shell gate the repo declares).');
	return {ok: problems.length === 0, problems};
}
