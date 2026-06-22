/**
 * The CI CLOSE-JOB driver (PRD `runner-in-ci`, capability E; slice
 * `install-ci-close-job-workflow`). When work lands on `main`, this resolves which
 * source issue(s) the landed work closes and closes them — but it OWNS none of the
 * machinery it relies on. It is the thin JOB that WIRES three UNCHANGED engine
 * pieces together (the Out-of-Scope fence: do NOT re-build them):
 *
 *   - the RESOLUTION — {@link resolveClosingIssue} (`frontmatter.ts`): an artifact
 *     uses `issue:` XOR `prd:`; a lone slice closes its own `issue:` directly, a
 *     fanned slice/PRD reaches the number via `slice.prd: → work/prd/<prd>.md PRD
 *     issue:`, and `prd:` WINS on a (hand-edited) conflict;
 *   - the QUERY — {@link isPrdComplete} (`prd-complete.ts`, slice
 *     `prd-complete-query`, done): a PRD is COMPLETE iff ≥1 `prd:<slug>` slice AND
 *     all such slices are in `work/done/`;
 *   - the CLOSE — {@link IssueProvider.closeIssue} (`issue-provider.ts`, the atomic
 *     comment+close seam intake already uses): NO direct `gh` in this core; any
 *     informational comment rides the SAME close call (never the PR seam
 *     `postPRComment`).
 *
 * The closure conditions, per artifact kind:
 *
 *   - a **lone slice** (`issue:`, no `prd:`) that resides in `work/done/` — its PR
 *     merged, so its own issue closes (reason `completed`);
 *   - a **PRD** (`issue:`) — closes ONLY when {@link isPrdComplete} says ALL its
 *     `prd:<slug>` slices are in `work/done/` (reason `completed`).
 *
 * A PRD whose query is NOT yet complete is left OPEN (the final fanned slice's
 * merge tick closes it). A lone slice still outside `work/done/` is skipped. The
 * close DEGRADES (never throws) on a missing/unauthenticated provider, exactly
 * like intake's bounce close — the run reports the real cause and stays exit-0.
 *
 * This is the JOB the close-job WORKFLOW (capability E) invokes via
 * `agent-runner close-merged-issues`; the workflow is triggered on a merge to
 * `main` (`push: {branches: [main]}`). The driver itself is provider-pluggable
 * (it takes an {@link IssueProvider}) and reads only the `work/` tree.
 */

import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {
	TASK_LIFECYCLE_FOLDERS,
	BRIEF_FOLDERS as WORK_LAYOUT_BRIEF_FOLDERS,
	type WorkFolderKey,
	workFolderPath,
	workItemRel,
	isWorkItemFile,
} from './work-layout.js';
import {parseFrontmatter, resolveClosingIssue} from './frontmatter.js';
import {isBriefComplete} from './brief-complete.js';
import {
	type IssueProvider,
	type IssueCloseReason,
	GitHubIssueProvider,
} from './issue-provider.js';

/** The task lifecycle folders a lone-task `issue:` can reside in. */
const TASK_FOLDERS = TASK_LIFECYCLE_FOLDERS;

/** The brief folders an `issue:`-bearing brief can reside in. */
const BRIEF_FOLDERS = WORK_LAYOUT_BRIEF_FOLDERS;

/** Why the close-job acted (or did not act) on a candidate issue. */
export type CloseDecision =
	| 'closed' // the issue was closed via the provider seam
	| 'not-complete' // a PRD whose query says it is not yet complete → left open
	| 'not-landed' // a lone slice not yet in work/done/ → left open
	| 'close-failed'; // closure condition held but the provider close degraded

/** One candidate the close-job considered, with the decision it reached. */
export interface CloseCandidate {
	/** The resolved issue number. */
	issueNumber: number;
	/** Whether the closing link was a lone slice's `issue:` or a PRD's `issue:`. */
	via: 'issue' | 'prd';
	/** The slug of the artifact carrying the closing link (PRD slug / slice slug). */
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
 * Read a PRD's `issue:` number by slug, scanning the PRD folders. Returns
 * `undefined` when no PRD with that slug carries an `issue:` (a PRD with no source
 * issue, or a typo'd `prd:` hop — degrades to "no issue to close", never crashes).
 */
function briefIssueNumber(
	repoPath: string,
	briefSlug: string,
): number | undefined {
	for (const folder of BRIEF_FOLDERS) {
		for (const file of listMarkdown(repoPath, folder)) {
			const fm = parseFrontmatter(
				readFileSync(join(repoPath, workItemRel(folder, file)), 'utf8'),
			);
			const slug = fm.slug ?? basename(file, '.md');
			if (slug === briefSlug && fm.issue !== undefined) {
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
 *   - every PRD carrying `issue:` (in `work/prd/` or `work/prd-sliced/`) is a
 *     PRD-kind candidate keyed on its own `prd:` query;
 *   - every LONE slice (`issue:` and NO `prd:`) is an `issue`-kind candidate.
 *
 * A fanned slice carries `prd:` (NOT its own `issue:`), so it reaches the number
 * through its PRD's candidate, never as its own — the issue number lives ONLY on
 * the PRD. Deduplicated by issue number: a PRD enumerated once even though many
 * slices point at it. PRD candidates are listed before lone-slice candidates, each
 * group slug-sorted, for a deterministic log.
 */
function resolveCandidates(repoPath: string): {
	issueNumber: number;
	via: 'issue' | 'prd';
	slug: string;
}[] {
	const seen = new Set<number>();
	const briefCandidates: {issueNumber: number; via: 'prd'; slug: string}[] = [];
	const taskCandidates: {issueNumber: number; via: 'issue'; slug: string}[] =
		[];

	// PRD candidates: a PRD's `issue:` closes when ITS query is complete.
	for (const folder of BRIEF_FOLDERS) {
		for (const file of listMarkdown(repoPath, folder)) {
			const fm = parseFrontmatter(
				readFileSync(join(repoPath, workItemRel(folder, file)), 'utf8'),
			);
			const slug = fm.slug ?? basename(file, '.md');
			const closing = resolveClosingIssue(fm);
			// A PRD's own closing link is its `issue:` (a PRD has no `prd:`); on the
			// hand-edit conflict `prd:` wins via resolveClosingIssue, so only a true
			// `issue:`-bearing PRD becomes a candidate here.
			if (closing?.via === 'issue' && !seen.has(closing.issue)) {
				seen.add(closing.issue);
				briefCandidates.push({issueNumber: closing.issue, via: 'prd', slug});
			}
		}
	}

	// Lone-slice candidates: a slice with `issue:` and NO `prd:` closes its OWN
	// issue directly when it lands in work/done/.
	for (const folder of TASK_FOLDERS) {
		for (const file of listMarkdown(repoPath, folder)) {
			const fm = parseFrontmatter(
				readFileSync(join(repoPath, workItemRel(folder, file)), 'utf8'),
			);
			const slug = fm.slug ?? basename(file, '.md');
			const closing = resolveClosingIssue(fm);
			// `resolveClosingIssue` returns `via: 'issue'` ONLY when there is no `prd:`
			// (prd wins on conflict), so a fanned slice never lands here — it reaches
			// its issue through the PRD candidate above.
			if (closing?.via === 'issue' && !seen.has(closing.issue)) {
				seen.add(closing.issue);
				taskCandidates.push({issueNumber: closing.issue, via: 'issue', slug});
			}
		}
	}

	briefCandidates.sort((a, b) => a.slug.localeCompare(b.slug));
	taskCandidates.sort((a, b) => a.slug.localeCompare(b.slug));
	return [...briefCandidates, ...taskCandidates];
}

/** True iff the lone slice with this slug resides in `work/done/`. */
function loneTaskLanded(repoPath: string, taskSlug: string): boolean {
	for (const file of listMarkdown(repoPath, 'done')) {
		const fm = parseFrontmatter(
			readFileSync(join(repoPath, workItemRel('done', file)), 'utf8'),
		);
		const slug = fm.slug ?? basename(file, '.md');
		if (slug === taskSlug) {
			return true;
		}
	}
	return false;
}

/** The closing comment posted (atomically, on the close call) for each kind. */
function closeComment(via: 'issue' | 'prd', slug: string): string {
	return via === 'prd'
		? `Closed by agent-runner: every slice of PRD \`${slug}\` has landed in \`work/done/\`.`
		: `Closed by agent-runner: the slice \`${slug}\` has landed in \`work/done/\`.`;
}

/**
 * Run the close-job over a repo's `work/` tree: resolve the closure candidates,
 * apply the per-kind closure condition (a landed lone slice; a PRD whose
 * {@link isPrdComplete} query holds), and close the qualifying issues through the
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
		if (cand.via === 'prd') {
			shouldClose = isBriefComplete({repoPath, slug: cand.slug}).complete;
			notReady = 'not-complete';
		} else {
			shouldClose = loneTaskLanded(repoPath, cand.slug);
			notReady = 'not-landed';
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
 * The CLI entry the close-job WORKFLOW invokes (`agent-runner
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
