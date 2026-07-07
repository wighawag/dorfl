import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {run, type RunResult} from './git.js';
import {isGitHubArbiterUrl, DEFAULT_GH_BIN} from './github.js';
import {
	parseSidecar,
	sidecarPathFor,
	isEntryAnswered,
	type NewQuestion,
} from './sidecar.js';
import {
	persistSurfacedQuestions,
	type SurfacePersistOptions,
	type SurfacePersistResult,
} from './surface-persist.js';
import {workItemRel, type WorkFolderKey} from './work-layout.js';

/**
 * The **MERGE-QUESTION SURFACER** (spec `land-time-reverify-and-parallel-merge-ceiling`,
 * task `merge-question-surfacer`, US #14) — the SECOND, STATE-sourced surfacer
 * in the advance loop. It is a clean SIBLING to the existing
 * `surface-questions` JUDGEMENT surfacer (`surface-gate.ts` +
 * `surface-persist.ts`) — that one spawns a fresh-context agent to JUDGE an
 * item's open content questions; this one enumerates RUNNER STATE (unmerged
 * `work/*` branches) and surfaces one MERGE-QUESTION per branch into the SAME
 * binary sidecar shape. The judgement skill is UNTOUCHED.
 *
 * The shape is `surface → answer → apply` over the BINARY sidecar (the keystone
 * `agentic-question-resolution-retire-disposition-vocabulary`): a sidecar entry
 * is `no-answer | answered`; there is no `disposition=` token. The dispatch
 * signal the (separate) apply rung reads is the typed `kind` field
 * (`sidecar-kind-field`) — this surfacer STAMPS `kind: merge` on every entry it
 * emits. The `merge | hold | drop` menu rides the entry's `default` as a
 * human-readable HINT only; the apply layer must NEVER recognise a
 * merge-question by the shape of `default` (that string-sniff workaround is
 * exactly what a first build of this task was BLOCKED at review for).
 *
 * Layered like the spec asks: the FLOOR (git-alone reachability) is the
 * authoritative enumerator — it works against a bare `--bare` arbiter with
 * `NoneProvider`. The CEILING (`gh pr list` PR metadata) is pure ENRICHMENT
 * layered on top when a GitHub host is configured; the surfacer functions
 * identically without it.
 *
 * OUT OF SCOPE for this task (covered by sibling tasks of the same spec):
 *
 *   - The APPLY rung dispatch that lands an answered `kind: merge` through the
 *     land primitive (rebase → re-verify → advance). Task
 *     `apply-rung-merge-disposition`.
 *   - The GATE axis that decides whether this surfacer runs at all on a given
 *     advance tick. Task `merge-questions-gate-axis`.
 *
 * Tests inject the two seams ({@link listUnmergedWorkBranches},
 * {@link listOpenPullRequests}) so they NEVER hit real GitHub — the floor uses
 * `git for-each-ref` against a throwaway repo, the ceiling is the injected
 * `gh pr list` stub.
 */

/** A `work/<slug>` branch whose tip is not reachable from `<base>`. */
export interface UnmergedWorkBranch {
	/** The full short ref, e.g. `work/foo`. */
	ref: string;
	/** The bare slug (`work/` prefix stripped), e.g. `foo`. */
	slug: string;
	/** Branch tip SHA (advisory). */
	sha?: string;
}

/** Minimal PR metadata the ceiling renders into the question context. */
export interface MergeQuestionPullRequest {
	number: number;
	url?: string;
	title?: string;
	state?: string;
}

/** Inputs to the listings seams (and the surfacer). */
export interface ListUnmergedInput {
	cwd: string;
	base: string;
	env?: NodeJS.ProcessEnv;
}

export interface ListPullRequestsInput {
	cwd: string;
	ghBin: string;
	base: string;
	env?: NodeJS.ProcessEnv;
}

/** Options the surfacer takes (almost all seams are injectable for tests). */
export interface SurfaceMergeQuestionsOptions {
	/** Working clone the surfacer reads git refs + writes sidecars from. */
	cwd: string;
	/**
	 * The arbiter remote URL — when GitHub-shaped (per
	 * {@link isGitHubArbiterUrl}) the CEILING (`gh pr list`) runs. Absent /
	 * non-GitHub ⇒ the floor only (a bare arbiter with `NoneProvider`).
	 */
	arbiterUrl?: string;
	/** The base branch reachability is checked against. Default `main`. */
	base?: string;
	/** The `gh` CLI binary to invoke for the ceiling. Default `gh` on PATH. */
	ghBin?: string;
	/** Environment for spawned git/gh processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
	/**
	 * Seam: enumerate unmerged `work/*` branches (the FLOOR). Production uses
	 * `git for-each-ref` + `git merge-base --is-ancestor`. Tests inject a canned
	 * list so the surfacer is exercised over deterministic inputs.
	 */
	listUnmergedWorkBranches?: (input: ListUnmergedInput) => UnmergedWorkBranch[];
	/**
	 * Seam: list open PRs by branch (the CEILING). Production shells
	 * `gh pr list --json …`. Tests inject a stub map so they NEVER touch real
	 * GitHub. Skipped entirely when the arbiter is not GitHub-shaped.
	 */
	listOpenPullRequests?: (
		input: ListPullRequestsInput,
	) => Map<string, MergeQuestionPullRequest>;
	/** Seam: persist a single merge-question. Defaults to {@link persistSurfacedQuestions}. */
	persist?: (options: SurfacePersistOptions) => SurfacePersistResult;
}

/** One surfaced merge-question (a row in the result). */
export interface MergeQuestionSurfaced {
	/** The namespaced item identity (`task:<slug>`). */
	item: string;
	/** The bare slug. */
	slug: string;
	/** The `work/<slug>` ref the question is about. */
	ref: string;
	/** The sidecar path the persist touched (repo-relative). */
	sidecarPath: string;
	/** The persist commit (`undefined` if the persist was a no-op). */
	commit?: string;
	/** PR url when a GitHub ceiling matched the branch (advisory). */
	prUrl?: string;
}

/**
 * One branch the surfacer considered but did not surface (with the reason).
 *
 * PROVISIONAL vocabulary. The `reason` union is scoped to this surfacer — no
 * sibling surfacer exists yet, so it is deliberately NOT lifted to a shared
 * skip-reason type. When a second STATE-sourced surfacer lands (e.g. a
 * stuck-lock surfacer), promote this to a shared skip-reason vocabulary via a
 * dedicated decision; until then it may change without notice.
 */
export interface MergeQuestionSkipped {
	ref: string;
	slug: string;
	/** PROVISIONAL vocabulary — see {@link MergeQuestionSkipped}. */
	reason: 'no-item-body' | 'already-pending-merge-question' | 'persist-nothing';
}

/** Aggregate result of one surfacer pass. */
export interface SurfaceMergeQuestionsResult {
	/** How many `work/*` branches were unreachable from `<base>` (the floor). */
	considered: number;
	/** The branches a merge-question was emitted for. */
	surfaced: MergeQuestionSurfaced[];
	/** The branches that were considered but skipped, with the reason. */
	skipped: MergeQuestionSkipped[];
}

/** Raised for fatal usage errors (a missing repo, etc.). */
export class MergeQuestionSurfacerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MergeQuestionSurfacerError';
	}
}

/**
 * The lifecycle folders {@link findTaskItemPath} scans for a task body to flip
 * `needsAnswers:true` on. This set DELIBERATELY DIVERGES from `advance.ts`'s
 * `FOLDERS_FOR_TYPE.task` (`['tasks-backlog','tasks-ready','in-progress','done']`):
 *
 *   - OMITS `in-progress` (and `needs-attention`): an unmerged `work/<slug>`
 *     branch whose body is mid-build should NOT trigger a merge-question — the
 *     build is still active, and surfacing a land-decision now would race the
 *     builder. Such tasks fall through to the `no-item-body` skip.
 *   - ADDS `cancelled`: a cancelled task with a lingering unmerged `work/*`
 *     branch SHOULD surface a merge-question so the operator explicitly decides
 *     whether to merge the branch or drop it.
 */
const TASK_FOLDERS: readonly WorkFolderKey[] = [
	'tasks-ready',
	'tasks-backlog',
	'done',
	'cancelled',
] as const;

/**
 * Surface merge-questions for every unmerged `work/*` branch in `cwd`.
 *
 * The FLOOR (git reachability) is authoritative; the CEILING (`gh pr list`)
 * runs only when {@link isGitHubArbiterUrl} accepts the arbiter URL, and is
 * pure enrichment (a missing/failed `gh` degrades silently — the floor still
 * surfaces the question).
 *
 * Idempotency: a branch whose sidecar ALREADY carries a PENDING `kind: merge`
 * entry is SKIPPED (with `already-pending-merge-question`). A branch with no
 * item body on `main` is SKIPPED (with `no-item-body`) — the cross-cutting
 * branch-keyed sidecar identity (SPEC sidecar Q5-i) is OOS for this task; an
 * unmerged-branch-with-no-body lands on the same skip path until that
 * generalisation arrives.
 */
export function surfaceMergeQuestions(
	options: SurfaceMergeQuestionsOptions,
): SurfaceMergeQuestionsResult {
	const {cwd} = options;
	const base = options.base ?? 'main';
	const env = options.env;
	const note = options.note ?? (() => {});
	const persist = options.persist ?? persistSurfacedQuestions;

	const listBranches =
		options.listUnmergedWorkBranches ?? listUnmergedWorkBranchesViaGit;
	const branches = listBranches({cwd, base, env});

	// CEILING: only consult `gh pr list` when the arbiter is GitHub-shaped. A
	// bare / non-GitHub arbiter never spawns `gh` (the floor is sufficient).
	let prs: Map<string, MergeQuestionPullRequest> = new Map();
	const ghEnabled =
		options.arbiterUrl !== undefined && isGitHubArbiterUrl(options.arbiterUrl);
	if (ghEnabled && branches.length > 0) {
		const listPRs = options.listOpenPullRequests ?? listOpenPullRequestsViaGh;
		try {
			prs = listPRs({
				cwd,
				ghBin: options.ghBin ?? DEFAULT_GH_BIN,
				base,
				env,
			});
		} catch (err) {
			// `gh` is the ENRICHMENT layer — a failure must NEVER suppress the
			// floor's surfacing. Note it and proceed with an empty PR map.
			const detail = err instanceof Error ? err.message : String(err);
			note(
				`merge-question surfacer: gh pr list failed (${detail}) — continuing with the git-only floor.`,
			);
			prs = new Map();
		}
	}

	const surfaced: MergeQuestionSurfaced[] = [];
	const skipped: MergeQuestionSkipped[] = [];

	for (const branch of branches) {
		const item = `task:${branch.slug}`;

		// Idempotency: if the sidecar already carries a PENDING `kind: merge`
		// entry, this surfacer must not append a duplicate. (An ANSWERED merge
		// entry is fine — apply will dispatch it; appending a new entry would
		// re-pause the sidecar unnecessarily.)
		if (alreadyHasPendingMergeQuestion(cwd, item)) {
			skipped.push({
				ref: branch.ref,
				slug: branch.slug,
				reason: 'already-pending-merge-question',
			});
			continue;
		}

		const itemPath = findTaskItemPath(cwd, branch.slug);
		if (itemPath === undefined) {
			// The `branch:`/`ref:`-keyed sidecar identity (SPEC sidecar Q5-i, the
			// cross-cutting open question SHARED with the stuck-lock surfacer) is
			// OUT OF SCOPE for this task — without a body to flip `needsAnswers`
			// on, persist would tear the invariant. Skip with the reason so the
			// case is visible to the caller.
			skipped.push({
				ref: branch.ref,
				slug: branch.slug,
				reason: 'no-item-body',
			});
			continue;
		}

		const pr = prs.get(branch.ref);
		const question = buildMergeQuestion(branch, pr);

		const result = persist({
			cwd,
			item,
			itemPath,
			questions: [question],
			env,
			note,
		});
		if (result.outcome === 'nothing') {
			skipped.push({
				ref: branch.ref,
				slug: branch.slug,
				reason: 'persist-nothing',
			});
			continue;
		}

		surfaced.push({
			item,
			slug: branch.slug,
			ref: branch.ref,
			sidecarPath: result.sidecarPath,
			commit: result.commit,
			prUrl: pr?.url,
		});
	}

	return {considered: branches.length, surfaced, skipped};
}

/**
 * Build the merge-question for ONE unmerged branch.
 *
 *   - The QUESTION is a plain English "should this branch land?" prompt.
 *   - The CONTEXT carries the floor evidence (the unmerged branch ref) and, if
 *     a host PR matched, the ceiling enrichment (PR number, url, title).
 *   - The DEFAULT carries `merge | hold | drop` as a HUMAN-READABLE HINT only.
 *     The MACHINE dispatch signal is `kind: merge`, NEVER the shape of
 *     `default` (the workaround the first build was blocked for).
 *   - The KIND is the typed dispatch axis from `sidecar-kind-field` —
 *     `kind: merge` is what the apply rung reads to route the answer to the
 *     deterministic land primitive.
 */
function buildMergeQuestion(
	branch: UnmergedWorkBranch,
	pr: MergeQuestionPullRequest | undefined,
): NewQuestion {
	const contextLines: string[] = [
		`The branch \`${branch.ref}\` is not reachable from \`main\` — it carries pushed work that has not yet landed.`,
	];
	if (pr !== undefined) {
		const titleSuffix = pr.title ? `: ${pr.title}` : '';
		const urlSuffix = pr.url ? ` (${pr.url})` : '';
		const stateSuffix = pr.state ? ` [${pr.state}]` : '';
		contextLines.push(
			`Open PR #${pr.number}${stateSuffix}${titleSuffix}${urlSuffix}.`,
		);
	} else {
		contextLines.push(
			`No host PR metadata available (git-alone floor — the branch is the source of truth).`,
		);
	}
	return {
		question: `Land \`${branch.ref}\`? An unmerged \`work/*\` branch is awaiting an integration decision.`,
		context: contextLines.join('\n'),
		// HUMAN HINT only — the apply layer MUST NOT string-sniff this.
		default: 'merge | hold | drop',
		// MACHINE dispatch signal — the apply layer routes on this, not on `default`.
		kind: 'merge',
	};
}

/** Probe the sidecar for an existing pending `kind: merge` entry. */
function alreadyHasPendingMergeQuestion(cwd: string, item: string): boolean {
	const rel = sidecarPathFor(item);
	const abs = join(cwd, rel);
	if (!existsSync(abs)) {
		return false;
	}
	try {
		const model = parseSidecar(readFileSync(abs, 'utf8'));
		return model.entries.some((e) => e.kind === 'merge' && !isEntryAnswered(e));
	} catch {
		// A malformed sidecar is not THIS surfacer's problem — pretend there is
		// no pending merge-question and let the persist write surface the issue.
		return false;
	}
}

/** Locate the task body `work/<folder>/<slug>.md` across lifecycle folders. */
function findTaskItemPath(cwd: string, slug: string): string | undefined {
	for (const folder of TASK_FOLDERS) {
		const rel = workItemRel(folder, `${slug}.md`);
		if (existsSync(join(cwd, rel))) {
			return rel;
		}
	}
	return undefined;
}

// --- Production seams ----------------------------------------------------

function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	return run('git', args, cwd, {env});
}

/**
 * Production FLOOR: enumerate every `refs/heads/work/*` whose tip is NOT
 * reachable from `<base>`. A repo with no `<base>` (e.g. a fresh init before
 * the first commit) yields the empty list — the surfacer is a no-op until
 * `main` exists.
 */
export function listUnmergedWorkBranchesViaGit(
	input: ListUnmergedInput,
): UnmergedWorkBranch[] {
	const {cwd, base, env} = input;
	// Bail if `<base>` does not resolve — without a base, "unmerged" is
	// meaningless and we'd over-surface every branch as unmerged.
	const haveBase = gitSoft(
		['rev-parse', '--verify', '--quiet', base],
		cwd,
		env,
	);
	if (haveBase.status !== 0) {
		return [];
	}
	const refs = gitSoft(
		[
			'for-each-ref',
			'--format=%(refname:short) %(objectname)',
			'refs/heads/work/',
		],
		cwd,
		env,
	);
	if (refs.status !== 0) {
		return [];
	}
	const lines = refs.stdout
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l !== '');
	const unmerged: UnmergedWorkBranch[] = [];
	for (const line of lines) {
		const space = line.indexOf(' ');
		if (space === -1) {
			continue;
		}
		const ref = line.slice(0, space);
		const sha = line.slice(space + 1).trim();
		if (!ref.startsWith('work/')) {
			continue;
		}
		const slug = ref.slice('work/'.length);
		if (slug === '') {
			continue;
		}
		// `git merge-base --is-ancestor <sha> <base>` — exit 0 ⇒ reachable
		// (merged), exit 1 ⇒ unmerged.
		const reach = gitSoft(['merge-base', '--is-ancestor', sha, base], cwd, env);
		if (reach.status !== 0) {
			unmerged.push({ref, slug, sha});
		}
	}
	return unmerged;
}

/**
 * Production CEILING: shell `gh pr list --state open --json …` and index the
 * results by their `headRefName` so the surfacer can enrich the matching
 * branch's question. A non-zero / missing `gh` is treated as "no host
 * metadata available" — the floor still surfaces every unmerged branch.
 *
 * Best-effort enrichment. The git-reachability FLOOR is authoritative; the
 * `--state open`, `--base <base>`, and `--limit 200` arguments are DELIBERATE
 * ceilings — a PR targeting a non-`main` base (e.g. a stacked PR) or the case
 * of >200 open PRs degrades to floor-only output, never corrupts it.
 */
export function listOpenPullRequestsViaGh(
	input: ListPullRequestsInput,
): Map<string, MergeQuestionPullRequest> {
	const {cwd, ghBin, base, env} = input;
	const result = run(
		ghBin,
		[
			'pr',
			'list',
			'--state',
			'open',
			'--base',
			base,
			'--limit',
			'200',
			'--json',
			'number,url,title,headRefName,state',
		],
		cwd,
		{env},
	);
	if (result.status !== 0) {
		return new Map();
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		return new Map();
	}
	if (!Array.isArray(parsed)) {
		return new Map();
	}
	const out = new Map<string, MergeQuestionPullRequest>();
	for (const raw of parsed) {
		if (typeof raw !== 'object' || raw === null) {
			continue;
		}
		const r = raw as Record<string, unknown>;
		const headRefName = typeof r.headRefName === 'string' ? r.headRefName : '';
		const number = typeof r.number === 'number' ? r.number : undefined;
		if (headRefName === '' || number === undefined) {
			continue;
		}
		out.set(headRefName, {
			number,
			url: typeof r.url === 'string' ? r.url : undefined,
			title: typeof r.title === 'string' ? r.title : undefined,
			state: typeof r.state === 'string' ? r.state : undefined,
		});
	}
	return out;
}
