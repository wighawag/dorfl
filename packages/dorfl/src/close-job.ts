/**
 * The CI CLOSE-JOB driver (spec `runner-in-ci`, capability E; task
 * `install-ci-close-job-workflow`). When work lands on `main`, this resolves which
 * source issue(s) the landed work closes and closes them — but it OWNS none of the
 * machinery it relies on. It is the thin JOB that WIRES three UNCHANGED engine
 * pieces together (the Out-of-Scope fence: do NOT re-build them):
 *
 *   - the RESOLUTION — {@link resolveClosingIssue} (`frontmatter.ts`): an artifact
 *     uses `issue:` XOR `spec:`; a lone task closes its own `issue:` directly, a
 *     fanned task reaches the number via `task.spec: → work/specs/<spec>.md spec
 *     issue:`, and `spec:` WINS on a (hand-edited) conflict;
 *   - the QUERY — {@link isSpecComplete} (`spec-complete.ts`, task
 *     `prd-complete-query`, done): a spec is COMPLETE iff ≥1 `spec:<slug>` task is
 *     in `work/tasks/done/` AND every other one is in `work/tasks/cancelled/` (a
 *     task staged in backlog, ready or in progress keeps it open);
 *   - the CLOSE — {@link IssueProvider.closeIssue} (`issue-provider.ts`, the atomic
 *     comment+close seam intake already uses): NO direct `gh` in this core; any
 *     informational comment rides the SAME close call (never the PR seam
 *     `postPRComment`).
 *
 * The closure conditions, per artifact kind:
 *
 *   - a **lone task** (`issue:`, no `spec:`) that resides in `work/done/` — its PR
 *     merged, so its own issue closes (reason `completed`);
 *   - a **spec** (`issue:`) — closes ONLY when {@link isSpecComplete} says ALL its
 *     `spec:<slug>` tasks are in `work/done/` (reason `completed`).
 *
 * A spec whose query is NOT yet complete is left OPEN (the final fanned task's
 * merge tick closes it). A lone task still outside `work/done/` is skipped.
 *
 * CANCELLED work never closes an issue (task
 * `spec-complete-counts-staged-and-cancelled-tasks`): a spec whose tasks are ALL
 * cancelled, and a lone task that was cancelled, are left OPEN with decision
 * `cancelled`, not closed as `completed` (nothing was delivered) and not closed
 * as `not planned` either: abandoning an issue is a human's call (drop the spec,
 * close the issue by hand), not something a merge-to-main job infers. The
 * close DEGRADES (never throws) on a missing/unauthenticated provider, exactly
 * like intake's bounce close — the run reports the real cause and stays exit-0.
 *
 * An issue the provider already reports CLOSED is skipped with decision
 * `already-closed` (no close call, no comment, not counted in `closed`): the
 * workflow also runs HOURLY, so without this every pass would re-close and
 * re-report issues closed long ago.
 *
 * This is the JOB the close-job WORKFLOW (capability E) invokes via
 * `dorfl close-merged-issues`; the workflow is triggered on a merge to
 * `main` (`push: {branches: [main]}`) AND on an hourly `schedule:`, because a
 * land the CI pushes with its `GITHUB_TOKEN` starts no workflow. Every pass
 * re-derives everything from the `work/` tree (no state), so repeating is safe. The driver itself is provider-pluggable
 * (it takes an {@link IssueProvider}) and reads only the `work/` tree.
 */

import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {
	TASK_LIFECYCLE_FOLDERS,
	SPEC_FOLDERS,
	type WorkFolderKey,
	workFolderPath,
	workItemRel,
	isWorkItemFile,
} from './work-layout.js';
import {parseFrontmatter, resolveClosingIssue} from './frontmatter.js';
import {isSpecComplete} from './spec-complete.js';
import {
	type IssueProvider,
	type IssueCloseReason,
	GitHubIssueProvider,
} from './issue-provider.js';

/** The task lifecycle folders a lone-task `issue:` can reside in. */
const TASK_FOLDERS = TASK_LIFECYCLE_FOLDERS;

/** The spec folders an `issue:`-bearing spec can reside in. */
const SPEC_LIFECYCLE_FOLDERS = SPEC_FOLDERS;

/** Why the close-job acted (or did not act) on a candidate issue. */
export type CloseDecision =
	| 'closed' // the issue was closed via the provider seam
	| 'not-complete' // a spec whose query says it is not yet complete → left open
	| 'not-landed' // a lone task not yet in work/done/ → left open
	| 'cancelled' // a spec whose tasks are ALL cancelled, or a cancelled lone task → left open
	| 'already-closed' // closure condition held but the issue is already closed → no close call
	| 'close-failed'; // closure condition held but the provider close degraded

/** One candidate the close-job considered, with the decision it reached. */
export interface CloseCandidate {
	/** The resolved issue number. */
	issueNumber: number;
	/** Whether the closing link was a lone task's `issue:` or a spec's `issue:`. */
	via: 'issue' | 'spec';
	/** The slug of the artifact carrying the closing link (spec slug / task slug). */
	slug: string;
	/** What the close-job decided for this candidate. */
	decision: CloseDecision;
	/** The provider's failure detail when `decision === 'close-failed'`. */
	reason?: string;
}

/** The result of one {@link runCloseJob} pass over a repo's `work/` tree. */
export interface CloseJobResult {
	/** Every candidate considered, with its decision (for the human-facing log). */
	candidates: CloseCandidate[];
	/** Issue numbers actually closed this pass. */
	closed: number[];
}

/** Options for {@link runCloseJob}. */
export interface CloseJobOptions {
	/** The repo working-tree root whose `work/` tree to scan. */
	repoPath: string;
	/** The issue seam to close through (GitHub adapter in production; a stub in tests). */
	issueProvider: IssueProvider;
	/** Environment passed through to the provider (for the `gh` adapter). */
	env?: NodeJS.ProcessEnv;
}

/** List the `.md` filenames in `<repoPath>/work/<folder>/`, sorted; `[]` if absent. */
function listMarkdown(repoPath: string, folder: WorkFolderKey): string[] {
	const dir = workFolderPath(repoPath, folder);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.filter((name) => isWorkItemFile(name)).sort();
}

/**
 * Read a spec's `issue:` number by slug, scanning the spec folders. Returns
 * `undefined` when no spec with that slug carries an `issue:` (a spec with no source
 * issue, or a typo'd `spec:` hop — degrades to "no issue to close", never crashes).
 */
function specIssueNumber(
	repoPath: string,
	specSlug: string,
): number | undefined {
	for (const folder of SPEC_LIFECYCLE_FOLDERS) {
		for (const file of listMarkdown(repoPath, folder)) {
			const fm = parseFrontmatter(
				readFileSync(join(repoPath, workItemRel(folder, file)), 'utf8'),
			);
			const slug = fm.slug ?? basename(file, '.md');
			if (slug === specSlug && fm.issue !== undefined) {
				return fm.issue;
			}
		}
	}
	return undefined;
}

/**
 * Resolve the DEDUPLICATED set of closure candidates from the `work/` tree, each
 * via the UNCHANGED {@link resolveClosingIssue}:
 *
 *   - every spec carrying `issue:` (in `work/specs/ready/` or `work/specs/tasked/`) is a
 *     spec-kind candidate keyed on its own `spec:` query;
 *   - every LONE task (`issue:` and NO `spec:`) is an `issue`-kind candidate.
 *
 * A fanned task carries `spec:` (NOT its own `issue:`), so it reaches the number
 * through its spec's candidate, never as its own — the issue number lives ONLY on
 * the spec. Deduplicated by issue number: a spec enumerated once even though many
 * tasks point at it. Spec candidates are listed before lone-task candidates, each
 * group slug-sorted, for a deterministic log.
 */
function resolveCandidates(repoPath: string): {
	issueNumber: number;
	via: 'issue' | 'spec';
	slug: string;
}[] {
	const seen = new Set<number>();
	const specCandidates: {issueNumber: number; via: 'spec'; slug: string}[] = [];
	const taskCandidates: {issueNumber: number; via: 'issue'; slug: string}[] =
		[];

	// Spec candidates: a spec's `issue:` closes when ITS query is complete.
	for (const folder of SPEC_LIFECYCLE_FOLDERS) {
		for (const file of listMarkdown(repoPath, folder)) {
			const fm = parseFrontmatter(
				readFileSync(join(repoPath, workItemRel(folder, file)), 'utf8'),
			);
			const slug = fm.slug ?? basename(file, '.md');
			const closing = resolveClosingIssue(fm);
			// A spec's own closing link is its `issue:` (a spec has no `spec:`); on the
			// hand-edit conflict `spec:` wins via resolveClosingIssue, so only a true
			// `issue:`-bearing spec becomes a candidate here.
			if (closing?.via === 'issue' && !seen.has(closing.issue)) {
				seen.add(closing.issue);
				specCandidates.push({issueNumber: closing.issue, via: 'spec', slug});
			}
		}
	}

	// Lone-task candidates: a task with `issue:` and NO `spec:` closes its OWN
	// issue directly when it lands in work/done/.
	for (const folder of TASK_FOLDERS) {
		for (const file of listMarkdown(repoPath, folder)) {
			const fm = parseFrontmatter(
				readFileSync(join(repoPath, workItemRel(folder, file)), 'utf8'),
			);
			const slug = fm.slug ?? basename(file, '.md');
			const closing = resolveClosingIssue(fm);
			// `resolveClosingIssue` returns `via: 'issue'` ONLY when there is no `spec:`
			// (spec wins on conflict), so a fanned task never lands here — it reaches
			// its issue through the spec candidate above.
			if (closing?.via === 'issue' && !seen.has(closing.issue)) {
				seen.add(closing.issue);
				taskCandidates.push({issueNumber: closing.issue, via: 'issue', slug});
			}
		}
	}

	specCandidates.sort((a, b) => a.slug.localeCompare(b.slug));
	taskCandidates.sort((a, b) => a.slug.localeCompare(b.slug));
	return [...specCandidates, ...taskCandidates];
}

/** True iff the lone task with this slug resides in `work/<folder>/`. */
function loneTaskIn(
	repoPath: string,
	taskSlug: string,
	folder: 'done' | 'cancelled',
): boolean {
	for (const file of listMarkdown(repoPath, folder)) {
		const fm = parseFrontmatter(
			readFileSync(join(repoPath, workItemRel(folder, file)), 'utf8'),
		);
		const slug = fm.slug ?? basename(file, '.md');
		if (slug === taskSlug) {
			return true;
		}
	}
	return false;
}

/** The closing comment posted (atomically, on the close call) for each kind. */
function closeComment(via: 'issue' | 'spec', slug: string): string {
	return via === 'spec'
		? `Closed by dorfl: every task of spec \`${slug}\` has landed in \`work/done/\`.`
		: `Closed by dorfl: the task \`${slug}\` has landed in \`work/done/\`.`;
}

/**
 * True iff the provider reports the issue as already `closed` (via the existing
 * {@link IssueProvider.getIssue} read, whose `state` is lower-cased). A read that
 * FAILS (the GitHub adapter throws on a `gh` failure) or reports no state answers
 * `false`, so the pass falls through to the close attempt exactly as before: the
 * close then either succeeds or reports `close-failed` with the real cause. A
 * state read must never be the reason an issue stays open.
 */
async function isAlreadyClosed(
	issueProvider: IssueProvider,
	repoPath: string,
	issueNumber: number,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	try {
		const issue = await issueProvider.getIssue({
			cwd: repoPath,
			issueNumber,
			env,
		});
		return issue.state === 'closed';
	} catch {
		return false;
	}
}

/**
 * Run the close-job over a repo's `work/` tree: resolve the closure candidates,
 * apply the per-kind closure condition (a landed lone task; a spec whose
 * {@link isSpecComplete} query holds), and close the qualifying issues through the
 * {@link IssueProvider.closeIssue} seam (reason `completed`, an informational
 * comment riding the SAME atomic close). REUSES the unchanged resolution + query +
 * close — it re-implements NONE of them. NEVER throws: a degraded provider close
 * is reported as `close-failed`, not a crash (the terminal CI tick stays exit-0).
 */
export async function runCloseJob(
	options: CloseJobOptions,
): Promise<CloseJobResult> {
	const {repoPath, issueProvider, env} = options;
	const candidates: CloseCandidate[] = [];
	const closed: number[] = [];
	const completedReason: IssueCloseReason = 'completed';

	for (const cand of resolveCandidates(repoPath)) {
		// The closure CONDITION per kind — the only place this job decides; the
		// computation of "complete" / "landed" is the UNCHANGED engine query.
		let shouldClose: boolean;
		let notReady: CloseDecision;
		if (cand.via === 'spec') {
			const query = isSpecComplete({repoPath, slug: cand.slug});
			shouldClose = query.complete;
			notReady = query.allCancelled ? 'cancelled' : 'not-complete';
		} else {
			shouldClose = loneTaskIn(repoPath, cand.slug, 'done');
			notReady = loneTaskIn(repoPath, cand.slug, 'cancelled')
				? 'cancelled'
				: 'not-landed';
		}

		if (!shouldClose) {
			candidates.push({
				issueNumber: cand.issueNumber,
				via: cand.via,
				slug: cand.slug,
				decision: notReady,
			});
			continue;
		}

		// ALREADY CLOSED? The close-job also runs hourly (task
		// `close-job-also-runs-on-a-schedule`), so most passes meet issues an
		// earlier pass (or a human) already closed. Read the state through the
		// provider seam (NO direct `gh`) and skip those: no second close, no second
		// comment, not counted in `closed`.
		if (await isAlreadyClosed(issueProvider, repoPath, cand.issueNumber, env)) {
			candidates.push({
				issueNumber: cand.issueNumber,
				via: cand.via,
				slug: cand.slug,
				decision: 'already-closed',
			});
			continue;
		}

		// CLOSE via the provider seam (NO direct `gh`): comment + reason + close in
		// ONE atomic call, exactly the seam intake's bounce uses.
		const result = await issueProvider.closeIssue({
			cwd: repoPath,
			issueNumber: cand.issueNumber,
			comment: closeComment(cand.via, cand.slug),
			reason: completedReason,
			env,
		});
		if (result.closed) {
			closed.push(cand.issueNumber);
			candidates.push({
				issueNumber: cand.issueNumber,
				via: cand.via,
				slug: cand.slug,
				decision: 'closed',
			});
		} else {
			candidates.push({
				issueNumber: cand.issueNumber,
				via: cand.via,
				slug: cand.slug,
				decision: 'close-failed',
				reason: result.reason ?? result.instruction,
			});
		}
	}

	return {candidates, closed};
}

/** Options for {@link performCloseMergedIssues} (the CLI entry). */
export interface PerformCloseMergedIssuesOptions {
	/** The repo working-tree root (default: the CLI's cwd). */
	repoPath: string;
	/** Override the `gh` binary (tests inject a stub); production uses `gh` on PATH. */
	ghBin?: string;
	/** Environment passed through to the provider. */
	env?: NodeJS.ProcessEnv;
}

/**
 * The CLI entry the close-job WORKFLOW invokes (`dorfl
 * close-merged-issues`): construct the GitHub issue provider and run the
 * close-job over the checkout's `work/` tree. Provider-pluggable via
 * {@link runCloseJob}; this wrapper only picks the default (GitHub) adapter.
 */
export async function performCloseMergedIssues(
	options: PerformCloseMergedIssuesOptions,
): Promise<CloseJobResult> {
	const issueProvider = new GitHubIssueProvider({ghBin: options.ghBin});
	return runCloseJob({
		repoPath: options.repoPath,
		issueProvider,
		env: options.env,
	});
}
