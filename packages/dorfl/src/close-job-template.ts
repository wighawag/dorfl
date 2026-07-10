/**
 * The `install-ci` CLOSE-JOB capability (spec `runner-in-ci`, task
 * `install-ci-close-job-workflow`; capability E: close issues when their work
 * lands). This module GENERATES the one fixed workflow file for the close-job and
 * STRUCTURALLY VALIDATES it, mirroring the snapshot-assertion style of
 * `advance-lifecycle-template.ts` / `advance-ci-template.ts` (the package depends on
 * NO YAML lib, so the checks are presence/shape assertions over the raw text).
 *
 * The discipline (from the spec capability-E row + the Out-of-Scope fence):
 *
 *   - TRIGGER: a MERGE to `main`. There is no native "PR merged" event, so the
 *     workflow uses `push: {branches: [main]}` (NOT `pull_request: closed`): it
 *     fires for BOTH PR-merges AND direct pushes to `main`, and it ALWAYS runs with
 *     a normal (non-fork-restricted) `GITHUB_TOKEN` that can actually close issues
 *     — whereas a `pull_request` event from a FORK gets a read-only token and
 *     cannot close. (See the `## Decisions` block in the task.)
 *   - The job INVOKES the close machinery via `dorfl close-merged-issues`,
 *     which CONSUMES the UNCHANGED engine pieces: the resolution
 *     (`resolveClosingIssue`), the "spec complete?" query (`prd-complete-query`,
 *     done), and `IssueProvider.closeIssue`. CI owns ONLY the job + trigger; it
 *     re-implements NONE of those (the Out-of-Scope fence).
 *   - CI runs IN-PLACE (the CI container IS the isolation): no
 *     `--isolated`/`--remote`/registry. A CI concurrency group serialises
 *     overlapping close ticks on `main`; the claim CAS is the real cross-run
 *     serialiser elsewhere, but the close-job mutates only the ISSUE, so the group
 *     just avoids redundant concurrent close passes.
 *   - The running CI job NEVER edits `.github/workflows/**` (US #9): it requests NO
 *     `workflows` permission and cannot rewrite its own triggers. It needs only
 *     `contents: read` (to read the `work/` tree) + `issues: write` (to close).
 *
 * The structural validator is the dependency-free counterpart of "the workflow
 * parses + carries the right discipline" the task's acceptance criteria require;
 * the test generates this artifact under `--fake` and asserts every invariant.
 */

import type {ResolvedCIConfig} from './install-ci-core.js';

/** The capability id (the registry key + the emitted workflow file stem). */
export const CLOSE_JOB_CAPABILITY_ID = 'close-job';

/** The wizard-facing label for the close-job capability. */
export const CLOSE_JOB_CAPABILITY_LABEL =
	'Close issues when their work lands (the close-job: on a merge to main)';

/** The repo-relative path (under the output base) of the emitted workflow. */
export const CLOSE_JOB_WORKFLOW_PATH = 'workflows/close-job.yml';

/**
 * Generate the close-job workflow YAML. Deterministic: the same config produces
 * byte-identical output. The workflow is a FIXED shell (ADR §6: all policy is
 * env/config) — `config` is accepted for parity with the `CapabilityEmitter` seam
 * and future per-config wiring, but the close-job shape itself is
 * config-independent.
 */
export function generateCloseJobWorkflow(_config: ResolvedCIConfig): string {
	return `\
# dorfl — the ISSUE CLOSE-JOB in CI (capability E, spec runner-in-ci).
# EMITTED by \`dorfl install-ci\`; the human commits it. DO NOT hand-edit a
# copy — re-run install-ci to upgrade the shell.
#
# TRIGGER — a MERGE to main. There is NO native "PR merged" event, so this uses
# \`push: {branches: [main]}\` (NOT \`pull_request: closed\` + a merged guard):
#   * it fires for BOTH a PR-merge AND a direct push to main; and
#   * it ALWAYS runs with a normal (non-fork-restricted) GITHUB_TOKEN that can
#     actually CLOSE issues — a \`pull_request\` event from a FORK gets a read-only
#     token and could not close (a real limitation we deliberately avoid).
#
# WHAT IT DOES — \`dorfl close-merged-issues\` resolves which source issue(s)
# the landed work closes and closes them. CI owns ONLY this job + the trigger; the
# command CONSUMES the engine's UNCHANGED pieces and re-implements none of them:
#   * the RESOLUTION (resolveClosingIssue): a lone task closes its own \`issue:\`;
#     a fanned task reaches the number via \`task.spec: → spec issue:\`.
#   * the "spec complete?" QUERY (prd-complete-query, done): a spec's issue closes
#     ONLY when ALL its \`spec:<slug>\` tasks are in work/done/.
#   * the CLOSE (IssueProvider.closeIssue): the atomic comment+close seam — NO
#     direct \`gh\` in the engine core; any comment rides this close, never the PR
#     comment seam.
#
# CI runs IN-PLACE (the CI container IS the isolation): NO --isolated/--remote/
# registry (laptop-only affordances). The concurrency group below serialises
# overlapping close ticks on main.
#
# SAFETY (US #9): the running job is FORBIDDEN from editing the workflows tree
# under .github. It requests NO \`workflows\` permission, so it can never rewrite
# its own triggers. It needs only \`contents: read\` (read the work/ tree) +
# \`issues: write\` (close the issue).

name: close-job

on:
  # A merge to main: fires for a PR-merge AND a direct push, ALWAYS with a token
  # that can close issues (unlike a fork \`pull_request\` event's read-only token).
  push:
    branches:
      - main

# Serialise overlapping close ticks on main; the close-job mutates only the ISSUE
# (not the main-CAS), so this just avoids redundant concurrent passes.
concurrency:
  group: close-job-\${{ github.ref }}
  cancel-in-progress: false

# NO \`workflows\` permission: the running job can NEVER edit the workflows tree
# under .github (US #9). It needs only to READ the work/ tree and CLOSE issues.
permissions:
  contents: read
  issues: write

jobs:
  close-merged-issues:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/dorfl-setup
      - name: close issues whose work has landed on main
        # In-place in this checkout (no --isolated/--remote): the CI container IS
        # the isolation. Resolves the closing issue(s) from the work/ tree, runs
        # the "spec complete?" query for the spec case, and closes via the provider
        # seam — all UNCHANGED engine pieces, consumed not re-built.
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: dorfl close-merged-issues
`;
}

/** A single structural problem found in the generated workflow. */
export interface CloseJobProblem {
	/** A short, stable id for the violated invariant (for tests/assertions). */
	id: string;
	/** Human-readable description of what is missing or wrong. */
	message: string;
}

/** The result of {@link validateCloseJobWorkflow}. */
export interface CloseJobValidation {
	/** True iff the workflow satisfies EVERY structural invariant. */
	ok: boolean;
	/** Each violated invariant (empty when `ok`). */
	problems: CloseJobProblem[];
}

/**
 * Structurally validate the close-job workflow against the task's acceptance
 * criteria. Dependency-free (no YAML lib): presence/shape assertions over the raw
 * text, mirroring {@link validateAdvanceLifecycleWorkflow}.
 */
export function validateCloseJobWorkflow(text: string): CloseJobValidation {
	const problems: CloseJobProblem[] = [];
	const require = (id: string, present: boolean, message: string): void => {
		if (!present) {
			problems.push({id, message});
		}
	};

	// The OPERATIVE (non-comment) lines: the prohibitions below (no `--isolated`/
	// `--remote`/`pull_request` trigger/`.github/workflows` self-edit/direct `gh
	// issue close`) are about what the job DOES, not what the explanatory comments
	// MENTION. Strip full-line `#` comments before the negative checks; the positive
	// presence checks run over the full text (comments are harmless there).
	const operative = text
		.split('\n')
		.filter((line) => !/^\s*#/.test(line))
		.join('\n');

	// --- TRIGGER: a merge to main via `push: {branches: [main]}` ----------------
	require('trigger-push-main', /\bon:\s*[\s\S]*?push:\s*[\s\S]*?branches:\s*[\s\S]*?-\s*main\b/.test(
		text,
	), 'must trigger on a merge to main via `on.push.branches: [main]` (fires for ' +
		'PR-merges AND direct pushes, always with a token that can close issues).');
	// NOT the `pull_request` trigger: a fork PR gets a read-only token that cannot
	// close, and there is no native "PR merged" event — `push: [main]` is chosen.
	require('not-pull-request-trigger', !/\bpull_request:/.test(
		operative,
	), 'must NOT use the `pull_request` trigger (a fork PR gets a read-only token ' +
		'that cannot close; `push: [main]` is the chosen trigger).');
	// And it must NOT be the build/task tick's cron/dispatch shape — the close-job
	// is event-driven on a merge, not a scheduled drain.
	require('no-cron-trigger', !/\bschedule:\s*[\s\S]*?-\s*cron:/.test(
		operative,
	), 'the close-job is merge-triggered, NOT a cron drain (no `on.schedule.cron`).');
	require('no-answer-loop-push-trigger', !/work\/questions\//.test(
		text,
	), 'the close-job must NOT carry the `push work/questions/**` (answer-loop) ' +
		'trigger — that is the advance-lifecycle task.');

	// --- INVOKES the close machinery via the existing command -------------------
	// Scoped to operative (non-comment) lines: the explanatory comment NAMES the
	// command, so a real `run:` step (not the doc) must carry it.
	require('invokes-close-merged-issues', /dorfl close-merged-issues\b/.test(
		operative,
	), 'must invoke `dorfl close-merged-issues` (the close-job driver that ' +
		'CONSUMES the unchanged resolution + query + close).');
	// It must NOT re-implement the close with a direct `gh issue close` (the close
	// goes through the IssueProvider seam, not direct `gh` in CI).
	require('no-direct-gh-issue-close', !/gh issue close\b/.test(
		operative,
	), 'the close must go through `dorfl close-merged-issues` (the provider ' +
		'seam), NOT a direct `gh issue close` in the workflow.');
	// It must NOT invoke a build/task/intake verb — the close-job only closes.
	require('no-build-verbs', !/dorfl (?:do|advance|intake)\b/.test(
		operative,
	), 'the close-job must invoke ONLY `close-merged-issues`, not a build/task/' +
		'intake verb (CI owns only the close job + trigger).');

	// --- CI runs IN-PLACE: no isolation machinery ------------------------------
	require('no-isolated-flag', !/--isolated\b/.test(
		operative,
	), 'CI runs IN-PLACE (the container IS the isolation): no `--isolated` flag.');
	require('no-remote-flag', !/--remote\b/.test(
		operative,
	), 'CI runs IN-PLACE: no `--remote` flag (laptop-only affordance).');

	// --- A CI concurrency group ------------------------------------------------
	require('concurrency-group', /\bconcurrency:\s*[\s\S]*?group:/.test(
		text,
	), 'must carry a CI `concurrency.group` so overlapping close ticks never collide.');

	// --- US #9: NO `workflows` permission; cannot self-edit triggers ------------
	require('no-workflows-permission', !/\bworkflows:\s*write\b/.test(
		text,
	), 'the running job must request NO `workflows` permission (US #9: it can ' +
		'never edit `.github/workflows/**` / rewrite its own triggers).');
	require('never-edits-dot-github-workflows', !/\.github\/workflows\//.test(
		operative,
	), 'no emitted job step may touch `.github/workflows/**` (US #9).');
	// It DOES need `issues: write` (to close) — assert the permission is present so
	// the close can actually happen with the merge-to-main token. Scoped to operative
	// lines: the safety comment names the permission, so the real block must carry it.
	require('issues-write-permission', /\bissues:\s*write\b/.test(
		operative,
	), 'must request `issues: write` so the merge-to-main token can close the issue.');

	return {ok: problems.length === 0, problems};
}
