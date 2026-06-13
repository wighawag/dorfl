import {run, type RunResult} from './git.js';
import {DEFAULT_GH_BIN} from './github.js';
import {
	GH_BINARY_MISSING,
	ghFailureDetail,
	ghFailureReason,
} from './gh-failure.js';
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
 * `intake-processing-lock`) extend it. `closeIssue` (slice
 * `intake-closes-issue-on-bounce`) is the ATOMIC close used on a BOUNCE — a
 * terminal outcome, so intake closes the issue directly (comment + `not planned`
 * + close in ONE call). It is ALSO the method CI's future close-job uses for the
 * slice/PRD path; only the BOUNCE close is intake's.
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
	/**
	 * The provider's comment id (`gh issue view --json comments` reports it). Surfaced
	 * for the intake TRIAGE GATE (slice `intake-self-awareness-resumption-tracking`):
	 * the triage is id-set membership + list position only — it records which comment
	 * ids intake READ (the marker's `seen=<id>,…`) and detects raced-in / deleted
	 * comments by id arithmetic. ADDITIVE (no existing reader breaks); NO `createdAt`
	 * is added — nothing reads a timestamp (ordering is `listComments`' oldest-first).
	 */
	id?: string;
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

/**
 * The close-reason GitHub renders distinct from a "completed" close. `gh issue
 * close --reason` accepts `completed | not planned | duplicate`; a BOUNCE is
 * precisely `not planned` (the asks are unrelated and must be re-filed). The
 * INTERFACE carries it provider-neutrally — a non-GitHub adapter maps or ignores
 * it (the seam stays provider-pluggable; `reason` is a GitHub-ism on the wire).
 */
export type IssueCloseReason = 'completed' | 'not planned' | 'duplicate';

export interface CloseIssueInput {
	cwd: string;
	/** The issue number to close (`gh issue close <N>`). */
	issueNumber: number;
	/**
	 * An OPTIONAL closing comment posted IN THE SAME atomic operation as the close
	 * (`gh issue close --comment <body>`). Carrying it on the close call (not a
	 * separate `postIssueComment` then close) removes the comment-posted-but-close-
	 * failed window — the whole point of the atomic close.
	 */
	comment?: string;
	/** An OPTIONAL close reason (`gh issue close --reason "not planned"`). */
	reason?: IssueCloseReason;
	env?: NodeJS.ProcessEnv;
}

export interface CloseIssueResult {
	/** True iff the issue was actually closed (a real, authenticated provider). */
	closed: boolean;
	/**
	 * The REAL underlying failure detail when `closed` is false — the actual `gh`
	 * stderr via {@link ghFailureReason}, NOT a hard-coded "unavailable or
	 * unauthenticated" guess (that misattribution bug was fixed in `mutateLabel`;
	 * do not propagate it). Absent on success.
	 */
	reason?: string;
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
 * The OUTCOME of a label MUTATION (`addLabel` / `removeLabel`). The lock ops are a
 * CONCURRENCY mutex, so the caller must distinguish THREE genuinely-different
 * results — collapsing them (the original bug) sent a maintainer hunting an auth
 * problem that did not exist, and made a real lock-failure proceed lock-less:
 *
 * - **`applied`** — the provider made the change on the real surface (the winner
 *   acquired / released the lock label).
 * - **`unsupported`** — the provider has NO label concept at all (a non-GitHub
 *   provider without labels). The lock LEGITIMATELY degrades to best-effort here
 *   (the spec's provider-pluggability): there is simply nothing to lock on.
 * - **`failed`** — the provider DOES support labels but the op failed for a REAL
 *   reason (a missing/unauthenticated `gh`, a permissions error, an unexpected
 *   `gh` failure). This is NOT a legitimate degrade: the lock is meaningful but
 *   could not be taken, so the caller must FAIL / back off rather than silently
 *   proceed lock-less (maintainer decision — see {@link LabelResult.reason}).
 *
 * NEVER throws — the seam reports the outcome (the caller decides fail-vs-degrade),
 * the same never-crash discipline the comment poster / PR provider keep (ADR §6).
 */
export type LabelOutcome = 'applied' | 'unsupported' | 'failed';

export interface LabelResult {
	/** Which of the three outcomes occurred (the caller routes fail-vs-degrade on this). */
	outcome: LabelOutcome;
	/**
	 * True iff the label change was actually applied on the provider surface
	 * (`outcome === 'applied'`). Retained as a convenience for the acquire/release
	 * sites; the THREE-way `outcome` is the load-bearing discriminator.
	 */
	applied: boolean;
	/**
	 * The REAL underlying failure detail when `outcome === 'failed'` — the actual
	 * `gh` stderr (e.g. `'agent-runner:processing' not found`), NOT a hard-coded
	 * "unavailable or unauthenticated" guess. Surfaced so the cause is diagnosable.
	 * Absent for `applied` / `unsupported`.
	 */
	reason?: string;
	/** Human-readable confirmation / degrade-or-failure reason. */
	instruction: string;
}

/**
 * The result of READING an issue's labels — the lock READ that decides acquire vs
 * back-off. Like {@link LabelResult} it distinguishes the SAME three outcomes so
 * the caller never confuses a genuinely-unsupported provider (legitimate degrade)
 * with a real read FAILURE on a label-supporting provider (must NOT silently
 * proceed lock-less):
 *
 * - **`ok`** — the labels were read (`labels` carries them; possibly empty).
 * - **`unsupported`** — the provider has NO label concept (legitimate degrade).
 * - **`failed`** — a label-supporting provider could not be read (e.g. `gh`
 *   missing/unauthenticated): the lock STATE is unknown, so the caller must FAIL
 *   rather than guess "no lock held".
 */
export type GetLabelsOutcome = 'ok' | 'unsupported' | 'failed';

export interface GetLabelsResult {
	/** Which of the three outcomes occurred (the caller routes fail-vs-degrade on this). */
	outcome: GetLabelsOutcome;
	/**
	 * False iff the provider has no label surface at all (`outcome === 'unsupported'`)
	 * — retained for back-compat; the three-way `outcome` is load-bearing. A `failed`
	 * read is ALSO `supported: false` historically, but `outcome` separates them.
	 */
	supported: boolean;
	/** The labels currently on the issue (empty when none / unsupported / failed). */
	labels: string[];
	/**
	 * The REAL underlying failure detail when `outcome === 'failed'` — the actual
	 * `gh` stderr, NOT a hard-coded "unavailable or unauthenticated" guess.
	 */
	reason?: string;
	/** Human-readable confirmation / degrade-or-failure reason. */
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
	 * back-off. NEVER throws; returns a three-way {@link GetLabelsResult}: `ok`
	 * (labels read), `unsupported` (no label concept → legitimate degrade), or
	 * `failed` (a label-supporting provider could not be read → the caller FAILS
	 * rather than guessing the lock is free).
	 */
	getLabels(input: LabelInput): Promise<GetLabelsResult>;
	/**
	 * ADD a single label (acquire the `processing` lock — the winner only). The
	 * RUNNER calls this; the agent stays label-free. NEVER throws — it returns a
	 * three-way {@link LabelResult} (`applied` / `unsupported` / `failed`) so the
	 * caller can FAIL on a real lock-acquire failure (e.g. `gh` unauthenticated)
	 * rather than silently proceed lock-less. On a label-supporting provider where
	 * the lock label does not exist yet (a fresh repo), it CREATES the label first
	 * so the lock works from the first run, then adds it.
	 */
	addLabel(input: AddLabelInput): Promise<LabelResult>;
	/**
	 * REMOVE a single label (release the `processing` lock on finish — success OR
	 * handled failure). The RUNNER calls this; the agent stays label-free. NEVER
	 * throws; returns the three-way {@link LabelResult} like {@link addLabel}.
	 */
	removeLabel(input: RemoveLabelInput): Promise<LabelResult>;
	/**
	 * CLOSE an issue, OPTIONALLY posting a closing comment and setting a close
	 * reason IN THE SAME atomic operation (`gh issue close <N> [--comment <body>]
	 * [--reason "not planned"]`). Used on a BOUNCE (terminal: comment + `not
	 * planned` + close in ONE call — no post-then-close partial-failure window) and,
	 * later, by CI's slice/PRD close-job. The RUNNER calls this; the agent stays
	 * seam-free. NEVER throws — a missing/unauthenticated `gh` DEGRADES, surfacing
	 * the REAL `gh` stderr via {@link CloseIssueResult.reason} (NOT a hard-coded
	 * guess), so the terminal outcome is unchanged and the cause stays diagnosable.
	 */
	closeIssue(input: CloseIssueInput): Promise<CloseIssueResult>;
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
 * The GitHub issue provider: reads an issue + thread, posts a comment, and (on a
 * BOUNCE) atomically closes the issue by shelling out to the `gh` CLI (`gh issue
 * view` / `gh issue comment` / `gh issue close --comment --reason` / `gh issue
 * edit` for labels). It is the ONLY place in the issue-seam stack that invokes
 * `gh` — the core never
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
		// Advisory: a failed `gh` DEGRADES (surface the text), never throws — mirroring
		// the PR-comment poster (ADR §6). Surface the REAL `gh` cause via
		// `ghFailureReason` (or the missing-binary detail) — NOT a hard-coded
		// "unavailable or unauthenticated" guess (the misattribution already removed
		// from `mutateLabel`/`closeIssue`; this was the last contagion source).
		if (result === undefined || result.status !== 0) {
			const reason = ghFailureDetail(result);
			return {
				posted: false,
				instruction:
					`could not post the comment on issue #${input.issueNumber}: ` +
					`${reason}. The comment:\n${input.body}`,
			};
		}
		return {
			posted: true,
			instruction: `Posted a comment on issue #${input.issueNumber}.`,
		};
	}

	async closeIssue(input: CloseIssueInput): Promise<CloseIssueResult> {
		// ATOMIC: post the closing comment AND set the reason AND close in ONE
		// `gh issue close` call — NOT a separate post-then-close (which has a
		// comment-posted-but-close-failed window: the dishonest open-with-bounce-comment
		// state this slice closes TO AVOID).
		const args = ['issue', 'close', String(input.issueNumber)];
		if (input.comment !== undefined && input.comment !== '') {
			args.push('--comment', input.comment);
		}
		if (input.reason !== undefined) {
			args.push('--reason', input.reason);
		}
		const result = this.runGh(args, input.cwd, input.env);
		// DEGRADE (never throw) on a missing/unauthenticated `gh`. Surface the REAL
		// `gh` stderr via `ghFailureReason` — NOT a hard-coded "unavailable or
		// unauthenticated" guess (the misattribution bug already fixed in `mutateLabel`).
		if (result === undefined) {
			const reason = GH_BINARY_MISSING;
			return {
				closed: false,
				reason,
				instruction:
					`could not close issue #${input.issueNumber}: ${reason}` +
					(input.comment ? `\nThe comment:\n${input.comment}` : ''),
			};
		}
		if (result.status !== 0) {
			const reason = ghFailureReason(result);
			return {
				closed: false,
				reason,
				instruction:
					`could not close issue #${input.issueNumber}: ${reason}` +
					(input.comment ? `\nThe comment:\n${input.comment}` : ''),
			};
		}
		return {
			closed: true,
			instruction: `Closed issue #${input.issueNumber}.`,
		};
	}

	async getLabels(input: LabelInput): Promise<GetLabelsResult> {
		const result = this.runGh(
			['issue', 'view', String(input.issueNumber), '--json', 'labels'],
			input.cwd,
			input.env,
		);
		// GitHub HAS labels: a failed read is `failed`, NOT `unsupported`. Surfacing
		// the REAL `gh` stderr (not a hard-coded "unauthenticated" guess) keeps the
		// cause diagnosable; the caller FAILS rather than guessing the lock is free.
		if (result === undefined) {
			return {
				outcome: 'failed',
				supported: false,
				labels: [],
				reason: GH_BINARY_MISSING,
				instruction:
					`could not read the labels on issue #${input.issueNumber}: ` +
					GH_BINARY_MISSING,
			};
		}
		if (result.status !== 0) {
			const reason = ghFailureReason(result);
			return {
				outcome: 'failed',
				supported: false,
				labels: [],
				reason,
				instruction: `could not read the labels on issue #${input.issueNumber}: ${reason}`,
			};
		}
		let labels: string[];
		try {
			labels = normaliseLabels(JSON.parse(result.stdout) as unknown);
		} catch {
			return {
				outcome: 'failed',
				supported: false,
				labels: [],
				reason: 'could not parse the `gh` labels JSON.',
				instruction: `could not parse the labels JSON for issue #${input.issueNumber}.`,
			};
		}
		return {
			outcome: 'ok',
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
	 * label MUTATIONS (the lock acquire/release). NEVER throws — it reports a
	 * three-way {@link LabelResult} so the CALLER decides fail-vs-degrade (the lock
	 * acquire-site FAILS on `failed`; only a genuinely-unsupported provider degrades).
	 *
	 * On `--add-label` against a fresh repo where the lock label does NOT exist yet,
	 * `gh` exits non-zero with `'<label>' not found`. We CREATE the label (`gh label
	 * create`) and RETRY the add, so the lock works from the very first `intake` run
	 * (a fresh repo is lockable without a manual `gh label create`). Label creation
	 * is idempotent-enough for our purpose: a concurrent create loses harmlessly
	 * (the retry add then succeeds against the now-existing label).
	 */
	private mutateLabel(
		flag: '--add-label' | '--remove-label',
		input: AddLabelInput | RemoveLabelInput,
	): LabelResult {
		const verb = flag === '--add-label' ? 'add' : 'remove';
		let result = this.runGh(
			['issue', 'edit', String(input.issueNumber), flag, input.label],
			input.cwd,
			input.env,
		);

		// Fresh-repo case: the label has never been created, so the add fails with
		// `'<label>' not found`. Create it (settled decision: create-on-first-use), then
		// retry — so the lock is usable from the first run rather than a hard failure.
		if (
			flag === '--add-label' &&
			result !== undefined &&
			result.status !== 0 &&
			isLabelNotFound(result, input.label)
		) {
			const created = this.createLabel(input.label, input.cwd, input.env);
			if (created.ok) {
				result = this.runGh(
					['issue', 'edit', String(input.issueNumber), flag, input.label],
					input.cwd,
					input.env,
				);
			} else if (created.reason !== undefined) {
				// The CREATE failed for a real reason (e.g. a token without label-create
				// permission). Surface the CREATE's REAL cause — NOT the original
				// `'<label>' not found` add failure, which is merely the fresh-repo SYMPTOM
				// (the misattribution this fix removes). A missing-`gh` create degrades to
				// the original `result` (handled below) like the rest of the seam.
				return {
					outcome: 'failed',
					applied: false,
					reason: created.reason,
					instruction:
						`could not ${verb} the \`${input.label}\` label on issue ` +
						`#${input.issueNumber}: ${created.reason}`,
				};
			}
		}

		if (result === undefined) {
			return {
				outcome: 'failed',
				applied: false,
				reason: GH_BINARY_MISSING,
				instruction:
					`could not ${verb} the \`${input.label}\` label on issue ` +
					`#${input.issueNumber}: ${GH_BINARY_MISSING}`,
			};
		}
		if (result.status !== 0) {
			const reason = ghFailureReason(result);
			return {
				outcome: 'failed',
				applied: false,
				reason,
				// Surface the REAL `gh` stderr (e.g. `'agent-runner:processing' not found`),
				// never a hard-coded "unavailable or unauthenticated" guess — the cause must
				// be diagnosable.
				instruction:
					`could not ${verb} the \`${input.label}\` label on issue ` +
					`#${input.issueNumber}: ${reason}`,
			};
		}
		return {
			outcome: 'applied',
			applied: true,
			instruction: `${verb === 'add' ? 'Added' : 'Removed'} the \`${input.label}\` label on issue #${input.issueNumber}.`,
		};
	}

	/**
	 * Create the lock label (`gh label create <label>`) so a fresh repo is lockable
	 * from the first run. Returns a three-way result rather than a bare boolean so the
	 * caller can surface the CREATE's REAL cause (the original bug threw the stderr
	 * away, leaving `mutateLabel` to report the fresh-repo SYMPTOM `'<label>' not
	 * found` even on a permission-denied create):
	 *
	 * - **`{ok: true}`** — the label now exists (created here, or it already existed —
	 *   `gh` reports `already exists`, which we treat as success).
	 * - **`{ok: false}`** (no `reason`) — `gh` is MISSING (binary absent): degrade to
	 *   the caller's existing missing-`gh` handling (the never-hard-fail posture).
	 * - **`{ok: false, reason}`** — the create FAILED for a real reason (e.g. no
	 *   permission): the caller surfaces `reason` (the create's REAL `gh` stderr).
	 *
	 * NEVER throws.
	 */
	private createLabel(
		label: string,
		cwd: string,
		env: NodeJS.ProcessEnv | undefined,
	): {ok: boolean; reason?: string} {
		const result = this.runGh(
			[
				'label',
				'create',
				label,
				'--description',
				'agent-runner intake processing lock (transient concurrency mutex)',
			],
			cwd,
			env,
		);
		// Missing `gh`: no reason to surface — degrade to the caller's missing-`gh`
		// handling (keeps the never-hard-fail posture unchanged).
		if (result === undefined) {
			return {ok: false};
		}
		if (result.status === 0) {
			return {ok: true};
		}
		// A concurrent run created it first — `gh` reports "already exists"; that is a
		// success for our purpose (the label is present for the retry).
		if (/already exists/i.test(result.stderr)) {
			return {ok: true};
		}
		// A genuine create failure (e.g. no permission): surface its REAL `gh` stderr so
		// `mutateLabel` reports the create's TRUE cause, not the fresh-repo `not found`.
		return {ok: false, reason: ghFailureReason(result)};
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
			throw new Error(`failed to ${action}: ${GH_BINARY_MISSING}`);
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

/**
 * True iff a failed `gh issue edit --add-label` failed because the label does not
 * exist in the repo yet (`gh` prints `'<label>' not found`). On a fresh repo the
 * lock label has never been created, so this is the create-on-first-use trigger —
 * distinct from a real auth/permission failure (which must NOT be papered over).
 */
function isLabelNotFound(result: RunResult, label: string): boolean {
	const stderr = result.stderr.toLowerCase();
	return stderr.includes('not found') && stderr.includes(label.toLowerCase());
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
		// `gh` reports the comment id as a number or a string depending on the field;
		// normalise to a string (the triage compares ids as opaque tokens, never as
		// numbers). ADDITIVE — absent on a provider that does not report one.
		const id =
			typeof c.id === 'string'
				? c.id
				: typeof c.id === 'number'
					? String(c.id)
					: undefined;
		return {
			...(id !== undefined ? {id} : {}),
			author: author?.login,
			body: typeof c.body === 'string' ? c.body : '',
		};
	});
}
