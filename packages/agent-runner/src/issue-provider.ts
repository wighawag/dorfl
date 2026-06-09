import {run, type RunResult} from './git.js';
import {DEFAULT_GH_BIN} from './github.js';
import {brand} from './brand.js';

/**
 * The single provider-native PROCESSING LOCK label (slice `intake-processing-lock`,
 * PRD `issue-intake` US #10): a TRANSIENT concurrency mutex — added on start (the
 * winner only), removed on finish — that serialises two concurrent `intake` runs on
 * the SAME issue. It is namespaced under the brand (`agent-runner:processing`) so it
 * cannot collide with a user's own labels. It carries NO `work/` state — it is NOT a
 * label STATE-MACHINE (ADR §12) and NOT a `work/`-file CAS; it is ONE transient lock
 * label and nothing more.
 */
export const PROCESSING_LOCK_LABEL = `${brand.base}:processing`;

/**
 * The **issue seam** (PRD `issue-intake`, slice `intake-tracer-slice-outcome`):
 * the provider-pluggable surface `intake <N>` reads an issue + its comment thread
 * through, and posts a clarifying comment back onto. It is the SIBLING of the
 * review-request `ReviewProvider` (`integrator.ts` / `github.ts`): both name a
 * GitHub-backed surface behind a seam, and both keep the CORE free of any `gh`
 * import — ONLY the adapter shells out (the same discipline `github.ts` documents).
 *
 * The READ methods (`getIssue`, `listComments`) + the issue comment
 * (`postIssueComment`) landed with the keystone slice; the LABEL ops
 * (`addLabel`/`removeLabel`/`getLabels` — the transient `processing` LOCK, slice
 * `intake-processing-lock`) extend it here. `closeIssue` (CI's close-job) is a
 * LATER slice (`runner-in-ci`) and is deliberately NOT on this interface yet.
 *
 * The label ops are a TRANSIENT CONCURRENCY MUTEX carrying NO `work/` state — ONE
 * lock label, added-on-start / removed-on-finish. They are NOT a label
 * STATE-MACHINE (ADR §12 forbids modelling `work/` lifecycle in labels) and NOT a
 * `work/`-file CAS (the contended thing is the ISSUE; the output slug is unknown
 * pre-run). A provider with no label concept DEGRADES to best-effort (it reports
 * `supported: false` / `applied: false` and the run proceeds WITHOUT the lock).
 *
 * Why `postIssueComment` is a DISTINCT method from `ReviewProvider.postPRComment`
 * (renamed from `postComment` in this same slice): the PR-comment surface is keyed
 * by the PR **url**; the issue-comment surface is keyed by the issue **number**. In
 * GitHub the two comment id spaces happen to coincide, but another provider may not
 * share them — so they are nominally distinct seams with distinct input types
 * ({@link PostIssueCommentInput} carries `issueNumber`, NOT a `url`).
 *
 * Tests STUB `gh` via the injectable `ghBin` (the SAME mechanism the PR-provider
 * tests use) — no network, no real GitHub.
 */

/** A GitHub issue's durable fields the decision prompt reads. */
export interface Issue {
	/** The issue number (`#N`). */
	number: number;
	/** The issue title. */
	title: string;
	/** The issue body (markdown), possibly empty. */
	body: string;
	/** The issue author's login (e.g. `octocat`), when the provider reports one. */
	author?: string;
	/** `open` / `closed` — the provider's state string, lower-cased. */
	state?: string;
}

/** One comment on the issue thread (oldest-first, as `listComments` returns them). */
export interface IssueComment {
	/** The comment author's login, when reported. */
	author?: string;
	/** The comment body (markdown). */
	body: string;
}

export interface GetIssueInput {
	cwd: string;
	/** The issue number to read (`intake <N>`). */
	issueNumber: number;
	env?: NodeJS.ProcessEnv;
}

export interface ListCommentsInput {
	cwd: string;
	issueNumber: number;
	env?: NodeJS.ProcessEnv;
}

export interface PostIssueCommentInput {
	cwd: string;
	/**
	 * The issue number to comment ON — the issue-comment surface's KEY. This is the
	 * whole reason {@link IssueProvider.postIssueComment} is a sibling of (not a
	 * reuse of) `ReviewProvider.postPRComment`, which is keyed by the PR `url`.
	 */
	issueNumber: number;
	/** The comment body (markdown). */
	body: string;
	env?: NodeJS.ProcessEnv;
}

export interface PostIssueCommentResult {
	/** True iff a comment was actually posted (a real, authenticated provider). */
	posted: boolean;
	/** Human-readable confirmation / fallback (the text on degrade). */
	instruction: string;
}

export interface LabelInput {
	cwd: string;
	/** The issue number to label / read labels FROM. */
	issueNumber: number;
	env?: NodeJS.ProcessEnv;
}

export interface AddLabelInput extends LabelInput {
	/** The single label to add (e.g. the `processing` lock). */
	label: string;
}

export interface RemoveLabelInput extends LabelInput {
	/** The single label to remove (e.g. the `processing` lock). */
	label: string;
}

/**
 * The result of a label MUTATION (`addLabel` / `removeLabel`). The lock ops are
 * a CONCURRENCY mutex, so the caller needs to know whether the provider actually
 * applied the change:
 *
 * - `applied: true` — the provider made the change on the real surface (the
 *   winner acquired / released the lock label).
 * - `applied: false` — the provider DEGRADED (no label support, or a
 *   missing/unauthenticated `gh`): the mutation was a no-op and the caller falls
 *   back to best-effort (proceed WITHOUT the lock; CI's per-issue concurrency
 *   group is then the only serialiser). NEVER throws — degrade is honest, not a
 *   crash (the same discipline the comment poster / PR provider keep, ADR §6).
 */
export interface LabelResult {
	/** True iff the label change was actually applied on the provider surface. */
	applied: boolean;
	/** Human-readable confirmation / degrade reason. */
	instruction: string;
}

/**
 * The result of READING an issue's labels. `supported: false` marks a provider
 * with NO label concept (the lock then degrades to best-effort) — distinct from a
 * supported provider that simply read an empty set.
 */
export interface GetLabelsResult {
	/** False iff the provider has no label surface at all (degrade to best-effort). */
	supported: boolean;
	/** The labels currently on the issue (empty when none / unsupported). */
	labels: string[];
	/** Human-readable confirmation / degrade reason. */
	instruction: string;
}

/**
 * The issue seam (provider-pluggable; GitHub via `gh` first). The CORE depends on
 * THIS interface only; the concrete `gh` shelling-out lives entirely in
 * {@link GitHubIssueProvider}. A non-GitHub provider can follow the same shape.
 */
export interface IssueProvider {
	/** Stable provider name stamped into diagnostics (`github`, …). */
	readonly name: string;
	/** Read the issue (number/title/body/author/state). */
	getIssue(input: GetIssueInput): Promise<Issue>;
	/** Read the issue's comment thread, oldest-first. */
	listComments(input: ListCommentsInput): Promise<IssueComment[]>;
	/** Post a clarifying comment on the issue (keyed by the issue NUMBER). */
	postIssueComment(
		input: PostIssueCommentInput,
	): Promise<PostIssueCommentResult>;
	/**
	 * Read the issue's current labels — the lock READ that decides acquire vs
	 * back-off. A provider with no label concept returns `{supported: false}` so
	 * the lock degrades to best-effort. NEVER throws.
	 */
	getLabels(input: LabelInput): Promise<GetLabelsResult>;
	/**
	 * ADD a single label (acquire the `processing` lock — the winner only). The
	 * RUNNER calls this; the agent stays label-free. Degrades (no throw) on a
	 * provider without label support or a missing/unauthenticated `gh`.
	 */
	addLabel(input: AddLabelInput): Promise<LabelResult>;
	/**
	 * REMOVE a single label (release the `processing` lock on finish — success OR
	 * handled failure). The RUNNER calls this; the agent stays label-free.
	 * Degrades (no throw) like {@link addLabel}.
	 */
	removeLabel(input: RemoveLabelInput): Promise<LabelResult>;
}

export interface GitHubIssueProviderOptions {
	/**
	 * The `gh` CLI binary (default `gh` on `PATH`). Tests inject a stub script so
	 * the seam is exercised without a real model / network / GitHub — the SAME test
	 * seam the {@link GitHubProvider} (review-request) uses.
	 */
	ghBin?: string;
}

/**
 * The GitHub issue provider: reads an issue + thread and posts a comment by
 * shelling out to the `gh` CLI (`gh issue view` / `gh api` / `gh issue comment`).
 * It is the ONLY place in the issue-seam stack that invokes `gh` — the core never
 * imports it (the same boundary `github.ts` keeps for the review-request seam).
 *
 * The READ methods THROW on a `gh` failure (a missing/unauthenticated `gh`, or an
 * unknown issue): `intake` cannot decide without the issue, so a read failure is a
 * hard, surfaced error (unlike the review-request `openRequest`, whose work is
 * already safely pushed and so degrades). `postIssueComment` is advisory and
 * DEGRADES (never throws), like the PR-comment poster.
 */
export class GitHubIssueProvider implements IssueProvider {
	readonly name = 'github';
	private readonly ghBin: string;

	constructor(options: GitHubIssueProviderOptions = {}) {
		this.ghBin = options.ghBin ?? DEFAULT_GH_BIN;
	}

	async getIssue(input: GetIssueInput): Promise<Issue> {
		const result = this.runGh(
			[
				'issue',
				'view',
				String(input.issueNumber),
				'--json',
				'number,title,body,author,state',
			],
			input.cwd,
			input.env,
		);
		const parsed = this.parseJson(result, `read issue #${input.issueNumber}`);
		return normaliseIssue(input.issueNumber, parsed);
	}

	async listComments(input: ListCommentsInput): Promise<IssueComment[]> {
		const result = this.runGh(
			['issue', 'view', String(input.issueNumber), '--json', 'comments'],
			input.cwd,
			input.env,
		);
		const parsed = this.parseJson(
			result,
			`read comments on issue #${input.issueNumber}`,
		);
		return normaliseComments(parsed);
	}

	async postIssueComment(
		input: PostIssueCommentInput,
	): Promise<PostIssueCommentResult> {
		const result = this.runGh(
			['issue', 'comment', String(input.issueNumber), '--body', input.body],
			input.cwd,
			input.env,
		);
		// Advisory: a missing/unauthenticated `gh` DEGRADES (surface the text), never
		// throws — mirroring the PR-comment poster (ADR §6).
		if (result === undefined || result.status !== 0) {
			return {
				posted: false,
				instruction:
					`\`gh\` is unavailable or unauthenticated, so the comment was not ` +
					`posted on issue #${input.issueNumber}. The comment:\n${input.body}`,
			};
		}
		return {
			posted: true,
			instruction: `Posted a comment on issue #${input.issueNumber}.`,
		};
	}

	async getLabels(input: LabelInput): Promise<GetLabelsResult> {
		const result = this.runGh(
			['issue', 'view', String(input.issueNumber), '--json', 'labels'],
			input.cwd,
			input.env,
		);
		// A missing/unauthenticated `gh` DEGRADES (the lock then falls back to
		// best-effort) — never throws (unlike the issue READ, which is load-bearing
		// for the DECISION; the lock is best-effort by design).
		if (result === undefined || result.status !== 0) {
			return {
				supported: false,
				labels: [],
				instruction:
					`\`gh\` is unavailable or unauthenticated, so the labels on issue ` +
					`#${input.issueNumber} could not be read; the processing lock degrades ` +
					`to best-effort.`,
			};
		}
		let labels: string[];
		try {
			labels = normaliseLabels(JSON.parse(result.stdout) as unknown);
		} catch {
			return {
				supported: false,
				labels: [],
				instruction: `could not parse the labels JSON for issue #${input.issueNumber}.`,
			};
		}
		return {
			supported: true,
			labels,
			instruction: `Read ${labels.length} label(s) on issue #${input.issueNumber}.`,
		};
	}

	async addLabel(input: AddLabelInput): Promise<LabelResult> {
		return this.mutateLabel('--add-label', input);
	}

	async removeLabel(input: RemoveLabelInput): Promise<LabelResult> {
		return this.mutateLabel('--remove-label', input);
	}

	/**
	 * Shared `gh issue edit <N> --add-label|--remove-label <label>` runner for the
	 * label MUTATIONS (the lock acquire/release). Both DEGRADE (no throw) on a
	 * missing/unauthenticated `gh` — the lock is a best-effort concurrency mutex, so
	 * a failure to apply it must not crash the run.
	 */
	private mutateLabel(
		flag: '--add-label' | '--remove-label',
		input: AddLabelInput | RemoveLabelInput,
	): LabelResult {
		const result = this.runGh(
			['issue', 'edit', String(input.issueNumber), flag, input.label],
			input.cwd,
			input.env,
		);
		const verb = flag === '--add-label' ? 'add' : 'remove';
		if (result === undefined || result.status !== 0) {
			return {
				applied: false,
				instruction:
					`\`gh\` is unavailable or unauthenticated, so the \`${input.label}\` ` +
					`label could not be ${verb}d on issue #${input.issueNumber}; the ` +
					`processing lock degrades to best-effort.`,
			};
		}
		return {
			applied: true,
			instruction: `${verb === 'add' ? 'Added' : 'Removed'} the \`${input.label}\` label on issue #${input.issueNumber}.`,
		};
	}

	/**
	 * Run `gh <args>` in `cwd`, returning the result, or `undefined` when `gh`
	 * cannot even be spawned (binary missing). Mirrors {@link GitHubProvider}'s
	 * `runGh` (the spawn-error catch keeps a missing `gh` a clean failure).
	 */
	private runGh(
		args: string[],
		cwd: string,
		env: NodeJS.ProcessEnv | undefined,
	): RunResult | undefined {
		try {
			return run(this.ghBin, args, cwd, {env});
		} catch {
			return undefined; // gh binary not found / not executable
		}
	}

	/** Parse a `gh --json` read, THROWING a clear error on any failure. */
	private parseJson(result: RunResult | undefined, action: string): unknown {
		if (result === undefined) {
			throw new Error(
				`failed to ${action}: \`gh\` is not available (binary missing).`,
			);
		}
		if (result.status !== 0) {
			throw new Error(
				`failed to ${action}: \`gh\` exited ${result.status}` +
					(result.stderr.trim() ? ` — ${result.stderr.trim()}` : '') +
					' (is `gh` authenticated?).',
			);
		}
		try {
			return JSON.parse(result.stdout) as unknown;
		} catch {
			throw new Error(
				`failed to ${action}: could not parse \`gh\` JSON output.`,
			);
		}
	}
}

/** Map a `gh issue view --json …` object onto the {@link Issue} shape. */
function normaliseIssue(issueNumber: number, parsed: unknown): Issue {
	const obj = (parsed ?? {}) as Record<string, unknown>;
	const author = obj.author as {login?: string} | undefined;
	return {
		number:
			typeof obj.number === 'number' ? (obj.number as number) : issueNumber,
		title: typeof obj.title === 'string' ? obj.title : '',
		body: typeof obj.body === 'string' ? obj.body : '',
		author: author?.login,
		state:
			typeof obj.state === 'string'
				? (obj.state as string).toLowerCase()
				: undefined,
	};
}

/** Map a `gh issue view --json labels` object onto the bare label-name list. */
function normaliseLabels(parsed: unknown): string[] {
	const obj = (parsed ?? {}) as Record<string, unknown>;
	const labels = Array.isArray(obj.labels) ? obj.labels : [];
	return labels
		.map((raw) => {
			const l = (raw ?? {}) as Record<string, unknown>;
			return typeof l.name === 'string' ? l.name : '';
		})
		.filter((name) => name !== '');
}

/** Map a `gh issue view --json comments` object onto the comment list. */
function normaliseComments(parsed: unknown): IssueComment[] {
	const obj = (parsed ?? {}) as Record<string, unknown>;
	const comments = Array.isArray(obj.comments) ? obj.comments : [];
	return comments.map((raw) => {
		const c = (raw ?? {}) as Record<string, unknown>;
		const author = c.author as {login?: string} | undefined;
		return {
			author: author?.login,
			body: typeof c.body === 'string' ? c.body : '',
		};
	});
}
