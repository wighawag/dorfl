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
import {parseWorkBranchRef} from './slug-namespace.js';
import {workItemRel, type WorkFolderKey} from './work-layout.js';
import type {LockEntry} from './item-lock.js';

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
 * `NoneProvider`. The CEILING (`gh pr list`) runs when a GitHub host is
 * configured, and there it FILTERS (task
 * `wire-merge-questions-into-the-advance-tick`, decision 1): an open PR already
 * IS the human's land decision (merge or close it), so a branch with an open PR
 * gets no merge question. Merge questions are for branches with no PR: the
 * git-alone floor, or a branch whose PR was closed unmerged.
 *
 * Which branches it asks about (decisions 1, 4 and 6 of that task), in order:
 *
 *   - the task body rests in `tasks/ready/` or `tasks/backlog/` (a body in
 *     `done/` or `cancelled/` is terminal, which also covers a squash-merged PR
 *     whose branch was not deleted);
 *   - the sidecar carries no merge question yet (pending or answered);
 *   - no open PR (GitHub only; an unreadable PR list asks nothing);
 *   - the item's lock is not held, or is held WITH the `propose-pr` marker (a
 *     finished propose build keeps it until its work lands); a lock held without
 *     it is a live build, including the rebuild of a bounced task's kept branch;
 *   - the branch tip carries the done-move (`work/tasks/done/<slug>.md`), the
 *     state the answered-merge land (the committed-recovery tail) lands. A
 *     bounced build's kept work stops before its done-move, so it is not asked
 *     about.
 *
 * WIRED by `merge-question-tick.ts` (the laptop bare `advance` and the CI
 * `surface-merge-questions` job), behind the `mergeQuestions: off | ask` gate.
 *
 * Tests inject the two seams ({@link listUnmergedWorkBranches},
 * {@link listOpenPullRequests}) so they NEVER hit real GitHub — the floor uses
 * `git for-each-ref` against a throwaway repo, the ceiling is the injected
 * `gh pr list` stub.
 */

/** A task build branch (`work/task-<slug>`) whose tip is not reachable from `<base>`. */
export interface UnmergedWorkBranch {
	/** The branch name as it is on the arbiter, e.g. `work/task-foo`. */
	ref: string;
	/** The bare task slug, parsed by `parseWorkBranchRef`, e.g. `foo`. */
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
	/**
	 * The arbiter's remote NAME in `cwd` (default `origin`). In a clone the
	 * arbiter's branches are read from `refs/remotes/<arbiter>/`; ignored in the
	 * hub mirror, whose local heads ARE the arbiter's branches.
	 */
	arbiter?: string;
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
	/**
	 * The arbiter's remote NAME in `cwd` (default `origin`), whose
	 * remote-tracking refs the FLOOR reads in a clone. See
	 * {@link listUnmergedWorkBranchesViaGit}.
	 */
	arbiter?: string;
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
	/**
	 * The per-item locks held on the arbiter (`listItemLockEntries`), read by the
	 * caller. A task whose lock is held WITHOUT the `propose-pr` marker is a live
	 * build and is skipped (`lock-held`). Omitted ⇒ no lock is held.
	 */
	locks?: readonly LockEntry[];
}

/** One surfaced merge-question (a row in the result). */
export interface MergeQuestionSurfaced {
	/** The namespaced item identity (`task:<slug>`). */
	item: string;
	/** The bare slug. */
	slug: string;
	/** The `work/task-<slug>` branch the question is about. */
	ref: string;
	/** The sidecar path the persist touched (repo-relative). */
	sidecarPath: string;
	/** The persist commit (`undefined` if the persist was a no-op). */
	commit?: string;
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
	reason:
		| 'no-item-body'
		/** The body rests in `tasks/done/` or `tasks/cancelled/`. */
		| 'terminal'
		| 'already-pending-merge-question'
		/** An answered merge question awaits its apply. */
		| 'merge-question-answered'
		/** The branch has an open PR (GitHub): the PR is the land decision. */
		| 'open-pr'
		/** GitHub, but the open PRs could not be listed: nothing is asked. */
		| 'pr-state-unknown'
		/** The item's lock is held without the `propose-pr` marker (a live build). */
		| 'lock-held'
		/** The branch tip does not carry the task's done-move. */
		| 'no-done-move'
		| 'persist-nothing';
}

/** Aggregate result of one surfacer pass. */
export interface SurfaceMergeQuestionsResult {
	/** How many `work/*` branches were unreachable from `<base>` (the floor). */
	considered: number;
	/** The branches a merge-question was emitted for. */
	surfaced: MergeQuestionSurfaced[];
	/** The branches that were considered but skipped, with the reason. */
	skipped: MergeQuestionSkipped[];
	/**
	 * Set when the arbiter is GitHub-shaped but its open PRs could not be listed
	 * (`gh pr list` failed: no credential, no `gh`, an outage). The pass then
	 * asks about no branch (`pr-state-unknown`); a caller reports it as a FAILED
	 * pass rather than a quiet one (the `surface-merge-questions` command exits
	 * non-zero). Absent when the listing succeeded or was not needed.
	 */
	prListingError?: string;
}

/** Raised for fatal usage errors (a missing repo, etc.). */
export class MergeQuestionSurfacerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MergeQuestionSurfacerError';
	}
}

/**
 * The lifecycle folders {@link findTaskItemPath} asks about (task
 * `wire-merge-questions-into-the-advance-tick`, decision 6): the pool and
 * staging. `in-progress` / `needs-attention` no longer exist as folders (a
 * build in flight is a held lock, filtered separately).
 */
const TASK_FOLDERS: readonly WorkFolderKey[] = [
	'tasks-ready',
	'tasks-backlog',
] as const;

/** A body in one of these is TERMINAL: its branch is never asked about. */
const TERMINAL_TASK_FOLDERS: readonly WorkFolderKey[] = [
	'done',
	'cancelled',
] as const;

/**
 * Surface merge-questions for every unmerged `work/*` branch in `cwd`.
 *
 * The FLOOR (git reachability) is authoritative; the CEILING (`gh pr list`)
 * runs only when {@link isGitHubArbiterUrl} accepts the arbiter URL. On GitHub
 * it is load-bearing (an open PR is the land decision), so a failed listing
 * asks about NO branch and is reported on
 * {@link SurfaceMergeQuestionsResult.prListingError}.
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
	const branches = listBranches({cwd, base, arbiter: options.arbiter, env});

	// CEILING: only consult `gh pr list` when the arbiter is GitHub-shaped. A
	// bare / non-GitHub arbiter never spawns `gh` (the floor is sufficient).
	// On GitHub an open PR is the land decision, so a branch with one is not
	// asked about; a failed listing asks about NOTHING this pass (a question on
	// a branch with an open PR would land it behind the PR's back).
	let prs: Map<string, MergeQuestionPullRequest> | undefined = new Map();
	let prListingError: string | undefined;
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
			const detail = err instanceof Error ? err.message : String(err);
			note(
				`merge-question surfacer: gh pr list failed (${detail}); asking about no branch this pass.`,
			);
			prs = undefined;
			prListingError = detail;
		}
	}

	// The item locks by task slug (`task-<slug>` entries only).
	const locks = new Map<string, LockEntry>();
	for (const lock of options.locks ?? []) {
		if (lock.entry.startsWith('task-')) {
			locks.set(lock.entry.slice('task-'.length), lock);
		}
	}

	const surfaced: MergeQuestionSurfaced[] = [];
	const skipped: MergeQuestionSkipped[] = [];
	const skip = (
		branch: UnmergedWorkBranch,
		reason: MergeQuestionSkipped['reason'],
	): void => {
		skipped.push({ref: branch.ref, slug: branch.slug, reason});
	};

	// The `main` every question of this pass is asked against: recorded on the
	// entry so a `strictMergeApproval` apply can tell whether `main` moved since
	// (task `strict-merge-approval-restale-check-runs-before-the-continue-rebase`).
	// Unresolvable (a test seam over a non-repo) ⇒ no base recorded.
	const askedAtMain =
		branches.length > 0 ? resolveCommit(cwd, base, env) : undefined;

	for (const branch of branches) {
		const item = `task:${branch.slug}`;

		const itemPath = findTaskItemPath(cwd, branch.slug);
		if (itemPath === undefined) {
			// A terminal body (done / cancelled): its branch is finished business
			// (a squash-merged PR whose branch was not deleted rests here too).
			if (isTerminalTask(cwd, branch.slug)) {
				skip(branch, 'terminal');
				continue;
			}
			// The `branch:`/`ref:`-keyed sidecar identity (SPEC sidecar Q5-i, the
			// cross-cutting open question SHARED with the stuck-lock surfacer) is
			// OUT OF SCOPE: without a body to flip `needsAnswers` on, persist would
			// tear the invariant. Skip with the reason so the case is visible.
			skip(branch, 'no-item-body');
			continue;
		}

		// Idempotency: never append a second merge question. A PENDING one is
		// awaiting its answer; an ANSWERED one awaits its apply (appending would
		// re-pause the sidecar and strand the answer).
		const existing = existingMergeQuestion(cwd, item);
		if (existing === 'pending') {
			skip(branch, 'already-pending-merge-question');
			continue;
		}
		if (existing === 'answered') {
			skip(branch, 'merge-question-answered');
			continue;
		}

		if (prs === undefined) {
			skip(branch, 'pr-state-unknown');
			continue;
		}
		if (prs.has(branch.ref)) {
			skip(branch, 'open-pr');
			continue;
		}

		const lock = locks.get(branch.slug);
		if (lock !== undefined && lock.keptFor !== 'propose-pr') {
			skip(branch, 'lock-held');
			continue;
		}

		if (!tipHasDoneMove(cwd, branch, env)) {
			skip(branch, 'no-done-move');
			continue;
		}

		const question = buildMergeQuestion(branch, ghEnabled, askedAtMain);

		const result = persist({
			cwd,
			item,
			itemPath,
			questions: [question],
			env,
			note,
		});
		if (result.outcome === 'nothing') {
			skip(branch, 'persist-nothing');
			continue;
		}

		surfaced.push({
			item,
			slug: branch.slug,
			ref: branch.ref,
			sidecarPath: result.sidecarPath,
			commit: result.commit,
		});
	}

	return {
		considered: branches.length,
		surfaced,
		skipped,
		...(prListingError === undefined ? {} : {prListingError}),
	};
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
	ghEnabled: boolean,
	askedAtMain: string | undefined,
): NewQuestion {
	const contextLines: string[] = [
		`The branch \`${branch.ref}\` is not reachable from \`main\` — it carries pushed work that has not yet landed.`,
		ghEnabled
			? 'It has no open PR (none was opened, or its PR was closed without merging).'
			: 'No host PR metadata available (git-alone floor: the branch is the source of truth).',
	];
	return {
		question: `Land \`${branch.ref}\`? An unmerged \`work/*\` branch is awaiting an integration decision.`,
		context: contextLines.join('\n'),
		// HUMAN HINT only — the apply layer MUST NOT string-sniff this.
		default: 'merge | hold | drop',
		// MACHINE dispatch signal — the apply layer routes on this, not on `default`.
		kind: 'merge',
		...(askedAtMain === undefined ? {} : {askedAtMain}),
	};
}

/** The full sha `rev` names in `cwd`, or `undefined` when it does not resolve. */
function resolveCommit(
	cwd: string,
	rev: string,
	env: NodeJS.ProcessEnv | undefined,
): string | undefined {
	let res: RunResult;
	try {
		res = gitSoft(
			['rev-parse', '--verify', '--quiet', `${rev}^{commit}`],
			cwd,
			env,
		);
	} catch {
		return undefined;
	}
	if (res.status !== 0) return undefined;
	const sha = res.stdout.trim();
	return sha === '' ? undefined : sha;
}

/**
 * Probe the sidecar for an existing `kind: merge` entry: `pending` when one is
 * unanswered, `answered` when every one is answered, `undefined` when there is
 * none.
 */
function existingMergeQuestion(
	cwd: string,
	item: string,
): 'pending' | 'answered' | undefined {
	const rel = sidecarPathFor(item);
	const abs = join(cwd, rel);
	if (!existsSync(abs)) {
		return undefined;
	}
	try {
		const merge = parseSidecar(readFileSync(abs, 'utf8')).entries.filter(
			(e) => e.kind === 'merge',
		);
		if (merge.length === 0) return undefined;
		return merge.some((e) => !isEntryAnswered(e)) ? 'pending' : 'answered';
	} catch {
		// A malformed sidecar is not THIS surfacer's problem — pretend there is
		// no merge-question and let the persist write surface the issue.
		return undefined;
	}
}

/** Does the body of `slug` rest in a terminal task folder? */
function isTerminalTask(cwd: string, slug: string): boolean {
	return TERMINAL_TASK_FOLDERS.some((folder) =>
		existsSync(join(cwd, workItemRel(folder, `${slug}.md`))),
	);
}

/**
 * Does the branch tip carry the task's done-move (its body at
 * `work/tasks/done/<slug>.md`)? The answered-merge land is the
 * committed-recovery tail, which presupposes it. Read at the tip sha the
 * listing gave; a branch listed without one is not asked about.
 */
function tipHasDoneMove(
	cwd: string,
	branch: UnmergedWorkBranch,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	if (branch.sha === undefined) return false;
	const done = workItemRel('done', `${branch.slug}.md`);
	return (
		gitSoft(['cat-file', '-e', `${branch.sha}:${done}`], cwd, env).status === 0
	);
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
 * Production FLOOR: enumerate the ARBITER's task build branches
 * (`work/task-<slug>`, the {@link workBranchRef} form) whose tip is NOT
 * reachable from the arbiter's `<base>`.
 *
 * WHERE the arbiter's refs live depends on the repo `cwd` is:
 *
 *   - A **clone** (non-bare, with an `<arbiter>` remote): the arbiter's branches
 *     are the remote-tracking refs `refs/remotes/<arbiter>/work/*`, checked
 *     against `refs/remotes/<arbiter>/<base>`. Local `refs/heads/work/*` in a
 *     clone are this machine's own (possibly unpushed or stale) heads, not the
 *     arbiter's, so they are NOT listed.
 *   - The **hub mirror** (a `--bare` clone, or a worktree added from one, where
 *     `core.bare` reads `true`) or a repo with no `<arbiter>` remote (the repo IS
 *     the arbiter's ref store): the local heads `refs/heads/work/*`, checked
 *     against the local `<base>`.
 *
 * The item slug comes from {@link parseWorkBranchRef}, never from slicing the
 * ref. Only the plain BUILD branch of a task (`namespace: 'task'`, no producer)
 * is listed: an intake branch (`work/intake-*`) creates an item rather than
 * building one, a spec branch (`work/spec-*`) carries tasking, and an
 * un-namespaced `work/<slug>` is a pre-cutover ref `parseWorkBranchRef` refuses
 * (the clean-break stance). None of those is what a `kind: merge` answer lands.
 *
 * Purely local: it reads refs already in `cwd` (no fetch, no `ls-remote`); the
 * caller refreshes them. A repo whose `<base>` does not resolve (e.g. a fresh
 * init before the first commit, or a clone that never fetched `<base>`) yields
 * the empty list: without a base, "unmerged" is meaningless and every branch
 * would over-surface.
 */
export function listUnmergedWorkBranchesViaGit(
	input: ListUnmergedInput,
): UnmergedWorkBranch[] {
	const {cwd, base, env} = input;
	const arbiter = input.arbiter ?? 'origin';
	const source = arbiterRefSource(cwd, arbiter, env);
	const baseRef =
		source === 'remote-tracking'
			? `refs/remotes/${arbiter}/${base}`
			: `refs/heads/${base}`;
	const branchPrefix =
		source === 'remote-tracking' ? `refs/remotes/${arbiter}/` : 'refs/heads/';

	const haveBase = gitSoft(
		['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`],
		cwd,
		env,
	);
	if (haveBase.status !== 0) {
		return [];
	}
	const refs = gitSoft(
		[
			'for-each-ref',
			'--format=%(refname) %(objectname)',
			`${branchPrefix}work/`,
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
		const fullRef = line.slice(0, space);
		const sha = line.slice(space + 1).trim();
		if (!fullRef.startsWith(branchPrefix)) {
			continue;
		}
		// The branch name AS IT IS ON THE ARBITER (`work/task-<slug>`), whichever
		// local namespace it was read from.
		const ref = fullRef.slice(branchPrefix.length);
		const parsed = parseWorkBranchRef(ref);
		if (
			parsed === undefined ||
			parsed.namespace !== 'task' ||
			parsed.producer !== undefined
		) {
			continue;
		}
		// `git merge-base --is-ancestor <sha> <base>`: exit 0 ⇒ reachable
		// (merged), exit 1 ⇒ unmerged.
		const reach = gitSoft(
			['merge-base', '--is-ancestor', sha, baseRef],
			cwd,
			env,
		);
		if (reach.status !== 0) {
			unmerged.push({ref, slug: parsed.slug, sha});
		}
	}
	return unmerged;
}

/**
 * Which local ref namespace holds the arbiter's branches in `cwd`: the local
 * heads for the bare hub mirror (and its worktrees, which share its
 * `core.bare = true` config) or for a repo with no `<arbiter>` remote; the
 * remote-tracking refs for an ordinary clone.
 */
function arbiterRefSource(
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): 'local-heads' | 'remote-tracking' {
	const bare = gitSoft(['config', '--bool', 'core.bare'], cwd, env);
	if (bare.status === 0 && bare.stdout.trim() === 'true') {
		return 'local-heads';
	}
	const remote = gitSoft(['remote', 'get-url', arbiter], cwd, env);
	return remote.status === 0 ? 'remote-tracking' : 'local-heads';
}

/**
 * Production CEILING: shell `gh pr list --state open --json …` and index the
 * results by their `headRefName`, so the surfacer can skip a branch with an
 * open PR. A non-zero `gh` (or output that is not a JSON array) THROWS: the
 * surfacer then asks about no branch this pass, rather than asking about
 * branches whose PR it cannot see.
 *
 * The `--state open`, `--base <base>`, and `--limit 200` arguments are
 * DELIBERATE ceilings: a PR targeting a non-`main` base (e.g. a stacked PR) or
 * the case of >200 open PRs is not seen, so its branch may still be asked about.
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
		throw new Error(
			`${ghBin} pr list exited ${result.status}: ${result.stderr.trim().slice(0, 300)}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		throw new Error(`${ghBin} pr list printed no JSON`);
	}
	if (!Array.isArray(parsed)) {
		throw new Error(`${ghBin} pr list printed no JSON array`);
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
