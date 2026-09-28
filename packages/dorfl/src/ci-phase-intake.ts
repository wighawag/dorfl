/**
 * **The intake path split into the three CI phases** (spec
 * `ci-agent-job-without-write-token` §3 intake row, ADR
 * `ci-agent-job-holds-no-write-token`, task `ci-split-intake`).
 *
 * `intake <N> --phase` runs ONE of three halves of the one intake pipeline
 * (`intake.ts`: {@link decideIntake} is the agent half, {@link applyIntakeDecision}
 * / {@link emitIntakeDocument} the write half), never a second implementation.
 * The item is `issue:<N>`; its lock is the `processing` LABEL, not a lock ref.
 *
 *  - **lock** ({@link performIntakeLockPhase}): fetch `<arbiter>/main` (its tip
 *    is `baseSha`); read the issue, its comments and its labels; take the
 *    `processing` label (the provider creates it on a fresh repository); run
 *    the deterministic triage (a skip needs no agent: `needsAgent: false`);
 *    derive the origin trust from the event (`comment.author_association`, else
 *    `issue.author_association`, as `intake.yml` does) and the document mode
 *    (`intakeIntegration ?? integration` from the config at `baseSha`); publish
 *    them with `seenCommentIds`, every comment id it read. No agent, no
 *    repository code.
 *  - **agent** ({@link performIntakeAgentPhase}): read the issue with the read
 *    token, but give the decision agent ONLY the comments whose ids are in
 *    `seenCommentIds` (a comment posted after the lock is neither read nor
 *    marked seen); run the decision agent and the lone-task review rounds; hand
 *    over the verdict (`intake-ask`, `intake-bounce`, `intake-task`,
 *    `intake-spec`) carrying only the record fields the intent table allows. Any
 *    failure writes no handoff and fails the job.
 *  - **apply** ({@link performIntakeApplyPhase}): refuse to write when the label
 *    is gone (a re-run of a finished run); act on the agent job's result first
 *    (anything but `success` never reads the handoff: remove the label, post
 *    nothing); validate the handoff as hostile; for a document, RECOMPUTE the
 *    slug (`slug-safety.ts`), the placement, the origin-trust stamp and the mode
 *    from trusted inputs, render the document with the title YAML-quoted and
 *    re-parse it to prove the stamp survived, then integrate
 *    (`performIntegration`, PR or merge with the CAS loop) and post the
 *    completion comment. The marker's `seen=` is `seenCommentIds`. The label is
 *    ALWAYS removed.
 */

import {existsSync, readFileSync} from 'node:fs';
import {paramCase} from './brand.js';
import {
	HANDOFF_LIMITS,
	HandoffRejected,
	handoffName as deriveHandoffName,
	type HandoffIntentKind,
	type HandoffRecord,
	type IntakeAskProducts,
	type IntakeBounceProducts,
	type IntakeSpecProducts,
	type IntakeTaskProducts,
} from './ci-handoff-format.js';
import {readHandoff, writeHandoff} from './ci-handoff.js';
import {
	LockOutputRefused,
	readLockOutputsFromEnv,
	serializeLockOutputs,
	type LockOutputs,
} from './ci-lock-outputs.js';
import type {AgentJobResult} from './ci-agent-result.js';
import {
	PhaseDriverError,
	agentTimeoutMinutesAt,
	boundHandoffText,
	emitLockOutputs,
	fetchArbiterMain,
	noSmudgeEnv,
	repoConfigAt,
	runnerTempFrom,
} from './ci-phase-driver.js';
import type {IntegrationMode} from './config.js';
import {singleLineScalarProblem, type OriginTrust} from './frontmatter.js';
import {identityEnv} from './identity.js';
import {
	applyIntakeDecision,
	decideIntake,
	emitIntakeDocument,
	intakePlacementInputs,
	intakeSkipMessage,
	intakeTransportProblem,
	renderIntakeDocument,
	type IntakeDecision,
	type IntakeDocumentDecision,
	type IntakeResult,
	type IntakeWriteContext,
	type PerformIntakeOptions,
} from './intake.js';
import {isAuthorTrusted} from './intake-trigger-template.js';
import {triageIntake} from './intake-triage.js';
import {
	GitHubIssueProvider,
	PROCESSING_LOCK_LABEL,
	type Issue,
	type IssueComment,
	type IssueProvider,
} from './issue-provider.js';
import type {Phase} from './phase.js';
import {ensureSafeSlug, isSafeSlug} from './slug-safety.js';

const DEFAULT_ARBITER = 'origin';

/** Options of an intake phase run: the `intake` options plus the phase inputs. */
export interface IntakePhaseOptions extends PerformIntakeOptions {
	/** Which of the three jobs this process is. */
	phase: Phase;
	/**
	 * The handoff directory: the agent phase writes the artifact here (empty or
	 * absent); the apply phase reads it (under {@link runnerTemp}).
	 */
	handoffDir?: string;
	/** `$RUNNER_TEMP` (the apply phase); defaults to the env's. */
	runnerTemp?: string;
	/** The lock job's outputs (agent / apply); defaults to `DORFL_LOCK_OUTPUTS`. */
	lockOutputs?: LockOutputs;
	/** `github.run_attempt` (names the artifact); default the env's, else 1. */
	runAttempt?: string;
	/** The `$GITHUB_OUTPUT` file the lock phase appends to; default the env's. */
	githubOutput?: string;
	/**
	 * lock: the event payload file (`$GITHUB_EVENT_PATH`) the origin trust is
	 * read from; default the env's. A called workflow sees its caller's event.
	 */
	eventPath?: string;
	/**
	 * apply: `needs.agent.result` (`--agent-result`), REQUIRED. Only `success`
	 * reads the handoff.
	 */
	agentResult?: AgentJobResult;
	/** The merge-mode CAS-loop jitter (tests pass 0). */
	mergeJitterMs?: number;
}

/** How an intake phase run ended. */
export type IntakePhaseOutcome =
	/** lock: the label is taken and the agent runs next. */
	| 'locked'
	/** lock: the triage skipped (label taken, `needsAgent: false`). */
	| 'no-new-input'
	| 'already-terminal'
	/** lock: another run holds the label; nothing was written. */
	| 'backed-off'
	/** lock: the label could not be read or taken. */
	| 'lock-failed'
	/** agent: the handoff was written (see `intent`). */
	| 'handed-over'
	/** agent / apply: nothing to do (the lock job's triage skipped). */
	| 'no-op'
	/** apply: the label is gone (a finished run re-run); nothing was written. */
	| 'stale-lock'
	/** apply: the agent job did not succeed; the label was removed, nothing posted. */
	| 'released'
	/** apply: the handoff broke a rule; the label was removed, nothing posted. */
	| 'rejected'
	/** apply: the write half's outcomes (as the laptop `intake`). */
	| 'asked'
	| 'bounced'
	| 'tasked'
	| 'spec-written'
	| 'stale'
	/** agent: the decision or the review failed (no handoff; the job fails). */
	| 'agent-failed'
	/** A usage or environment problem. */
	| 'usage-error';

/** The result of one intake phase run. */
export interface IntakePhaseResult {
	exitCode: 0 | 1 | 4;
	outcome: IntakePhaseOutcome;
	issueNumber: number;
	message: string;
	/** lock: the facts published. */
	lockOutputs?: LockOutputs;
	/** agent: the handed-over intent kind. */
	intent?: HandoffIntentKind;
	/** apply: the emitted document (task / spec). */
	emitted?: string;
	emittedSlug?: string;
}

/**
 * Run one phase of the intake path. The CLI calls this for `intake <N> --phase`.
 */
export async function performIntakePhase(
	options: IntakePhaseOptions,
): Promise<IntakePhaseResult> {
	try {
		switch (options.phase) {
			case 'lock':
				return await performIntakeLockPhase(options);
			case 'agent':
				return await performIntakeAgentPhase(options);
			case 'apply':
				return await performIntakeApplyPhase(options);
		}
	} catch (err) {
		if (err instanceof PhaseDriverError || err instanceof LockOutputRefused) {
			return {
				exitCode: 1,
				outcome: 'usage-error',
				issueNumber: options.issueNumber,
				message: err.message,
			};
		}
		throw err;
	}
}

function itemOf(issueNumber: number): string {
	return `issue:${issueNumber}`;
}

function manualRecovery(issueNumber: number): string {
	return (
		`If the \`${PROCESSING_LOCK_LABEL}\` label is left behind, release it with: ` +
		`gh issue edit ${issueNumber} --remove-label '${PROCESSING_LOCK_LABEL}'`
	);
}

// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------

/**
 * The origin trust from the event payload at `eventPath`: the COMMENT's
 * `author_association` on an `issue_comment` event, else the ISSUE's (the rule
 * `intake.yml` applies), classified by {@link isAuthorTrusted}. A payload that
 * is missing, unreadable, or about another issue gives `untrusted` (the
 * fail-safe side of a public front door).
 */
export function originTrustFromEvent(
	eventPath: string | undefined,
	issueNumber: number,
): OriginTrust {
	if (eventPath === undefined || eventPath === '' || !existsSync(eventPath)) {
		return 'untrusted';
	}
	let event: unknown;
	try {
		event = JSON.parse(readFileSync(eventPath, 'utf8'));
	} catch {
		return 'untrusted';
	}
	const e = (event ?? {}) as {
		issue?: {number?: unknown; author_association?: unknown};
		comment?: {author_association?: unknown};
	};
	if (e.issue?.number !== issueNumber) {
		return 'untrusted';
	}
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' && v !== '' ? v : undefined;
	const association =
		str(e.comment?.author_association) ?? str(e.issue?.author_association);
	return isAuthorTrusted(association) ? 'trusted' : 'untrusted';
}

/**
 * The intake document mode from the repository config AT `baseSha`:
 * `intakeIntegration ?? integration`, else `propose` (the conservative
 * default). Never read from the agent job.
 */
export function intakeDocumentModeAt(
	cwd: string,
	baseSha: string,
	env: NodeJS.ProcessEnv | undefined,
): IntegrationMode {
	const config = repoConfigAt(cwd, baseSha, env);
	const mode = config?.intakeIntegration ?? config?.integration;
	return mode === 'merge' || mode === 'propose' ? mode : 'propose';
}

/**
 * The lock phase: read the issue, its thread and its labels, take the
 * `processing` label, run the deterministic triage and publish the trusted
 * facts. Runs no agent and no repository code. Every fact is checked BEFORE the
 * label is taken, so a refused output never leaves the label behind.
 */
export async function performIntakeLockPhase(
	options: IntakePhaseOptions,
): Promise<IntakePhaseResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const issueNumber = options.issueNumber;
	const item = itemOf(issueNumber);
	const env = identityEnv(options.identity, options.env ?? process.env);
	const githubOutput = options.githubOutput ?? env.GITHUB_OUTPUT;
	const publish = (facts: LockOutputs): LockOutputs => {
		emitLockOutputs(facts, {githubOutput, note});
		return facts;
	};
	const done = (
		exitCode: 0 | 1,
		outcome: IntakePhaseOutcome,
		message: string,
		facts: LockOutputs,
	): IntakePhaseResult => {
		note(message);
		return {
			exitCode,
			outcome,
			issueNumber,
			message,
			lockOutputs: publish(facts),
		};
	};
	const issueProvider = options.issueProvider ?? new GitHubIssueProvider();

	const baseSha = await fetchArbiterMain({cwd, arbiter, env});
	let comments: IssueComment[];
	try {
		await issueProvider.getIssue({cwd, issueNumber, env});
		comments = await issueProvider.listComments({cwd, issueNumber, env});
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return done(
			1,
			'usage-error',
			`Could not read issue #${issueNumber}: ${detail}`,
			{acquired: false, baseSha},
		);
	}

	const labels = await issueProvider.getLabels({cwd, issueNumber, env});
	if (labels.outcome === 'failed') {
		return done(
			1,
			'lock-failed',
			`Intake of issue #${issueNumber} could not acquire the ` +
				`\`${PROCESSING_LOCK_LABEL}\` lock: ${labels.instruction}`,
			{acquired: false, rung: 'intake', baseSha},
		);
	}
	if (
		labels.outcome === 'ok' &&
		labels.labels.includes(PROCESSING_LOCK_LABEL)
	) {
		return done(
			0,
			'backed-off',
			`Intake of issue #${issueNumber} backed off: the \`${PROCESSING_LOCK_LABEL}\` ` +
				`lock is already held by a concurrent run; doing nothing.`,
			{acquired: false, rung: 'intake', baseSha},
		);
	}

	const triage = triageIntake(comments);
	const ids = [
		...new Set(
			comments
				.map((c) => c.id)
				.filter((id): id is string => id !== undefined && id !== ''),
		),
	];
	const facts: LockOutputs = {
		acquired: true,
		needsAgent: triage.action === 'proceed',
		rung: 'intake',
		baseSha,
		handoffName: deriveHandoffName(
			item,
			options.runAttempt ?? env.GITHUB_RUN_ATTEMPT ?? '1',
		),
		agentTimeoutMinutes: agentTimeoutMinutesAt(cwd, baseSha, env),
		// An explicit `--origin-trust` (the workflow's own input) wins; else the
		// event payload decides.
		originTrust:
			options.originTrust ??
			originTrustFromEvent(
				options.eventPath ?? env.GITHUB_EVENT_PATH,
				issueNumber,
			),
		documentMode: intakeDocumentModeAt(cwd, baseSha, env),
		...(ids.length > 0 ? {seenCommentIds: ids} : {}),
	};
	try {
		serializeLockOutputs(facts);
	} catch (err) {
		if (!(err instanceof LockOutputRefused)) throw err;
		return done(1, 'usage-error', err.message, {
			acquired: false,
			rung: 'intake',
			baseSha,
		});
	}

	if (labels.outcome === 'ok') {
		const acquired = await issueProvider.addLabel({
			cwd,
			issueNumber,
			label: PROCESSING_LOCK_LABEL,
			env,
		});
		if (acquired.outcome === 'failed') {
			return done(
				1,
				'lock-failed',
				`Intake of issue #${issueNumber} could not acquire the ` +
					`\`${PROCESSING_LOCK_LABEL}\` lock: ${acquired.instruction}`,
				{acquired: false, rung: 'intake', baseSha},
			);
		}
	} else {
		note(`Processing lock degraded: ${labels.instruction}`);
	}

	if (triage.action === 'skip') {
		return done(
			0,
			triage.outcome,
			`${intakeSkipMessage(issueNumber, triage.outcome)} The apply job only ` +
				'removes the label.',
			facts,
		);
	}
	return done(
		0,
		'locked',
		`locked ${item} at ${baseSha} (the \`${PROCESSING_LOCK_LABEL}\` label; ` +
			`${ids.length} comment(s) read)`,
		facts,
	);
}

// ---------------------------------------------------------------------------
// The trusted lock facts (agent / apply)
// ---------------------------------------------------------------------------

/** The lock outputs an intake agent or apply phase acts on. */
interface IntakeLock {
	baseSha: string;
	needsAgent?: boolean;
	originTrust?: OriginTrust;
	documentMode?: IntegrationMode;
	/** The comment ids the lock job read, as tokens. */
	seenCommentIds: string[];
}

function requireIntakeLock(
	options: IntakePhaseOptions,
	env: NodeJS.ProcessEnv,
): IntakeLock {
	const facts = options.lockOutputs ?? readLockOutputsFromEnv(env);
	if (facts.acquired !== true) {
		throw new PhaseDriverError(
			'the lock job did not acquire the issue (acquired != true); nothing to do',
		);
	}
	if (facts.rung !== 'intake') {
		throw new PhaseDriverError(
			`the lock job classified the rung ${String(facts.rung)}, not intake`,
		);
	}
	if (facts.baseSha === undefined) {
		throw new PhaseDriverError('the lock outputs carry no baseSha');
	}
	return {
		baseSha: facts.baseSha,
		needsAgent: facts.needsAgent,
		originTrust: facts.originTrust,
		documentMode: facts.documentMode,
		seenCommentIds: (facts.seenCommentIds ?? []).map(String),
	};
}

// ---------------------------------------------------------------------------
// agent
// ---------------------------------------------------------------------------

/**
 * The handoff record of a decision: only the fields the intent table allows,
 * each bounded to its limit. A task / spec carries its title and body (and a
 * spec its two gate booleans), never a slug, a path, a stamp or a mode.
 */
export function intakeHandoffRecord(
	issueNumber: number,
	decision: IntakeDecision,
): HandoffRecord {
	const item = itemOf(issueNumber);
	const L = HANDOFF_LIMITS;
	switch (decision.kind) {
		case 'ask':
			return {
				schema: 1,
				item,
				intent: {kind: 'intake-ask'},
				products: {
					question: boundHandoffText(decision.body, L.reasonChars),
				} satisfies IntakeAskProducts,
			};
		case 'bounce':
			return {
				schema: 1,
				item,
				intent: {kind: 'intake-bounce'},
				products: {
					bounceText: boundHandoffText(decision.body, L.commentChars),
				} satisfies IntakeBounceProducts,
			};
		case 'task':
			return {
				schema: 1,
				item,
				intent: {kind: 'intake-task'},
				products: {
					title: boundTitle(decision.title),
					body: boundHandoffText(decision.body ?? '', L.documentChars),
				} satisfies IntakeTaskProducts,
			};
		case 'spec':
			return {
				schema: 1,
				item,
				intent: {kind: 'intake-spec'},
				products: {
					title: boundTitle(decision.title),
					body: boundHandoffText(decision.body ?? '', L.documentChars),
					...(decision.humanOnly === undefined
						? {}
						: {humanOnly: decision.humanOnly}),
					...(decision.needsAnswers === undefined
						? {}
						: {needsAnswers: decision.needsAnswers}),
				} satisfies IntakeSpecProducts,
			};
	}
}

/** Cut a (single-line) title to the handoff's document-title limit. */
function boundTitle(title: string): string {
	return title.slice(0, HANDOFF_LIMITS.documentTitleChars).trim();
}

/**
 * The agent phase: read the issue (read token) and ONLY the comments the lock
 * job read, run the decision agent and the lone-task review, and write the
 * handoff. Writes nothing anywhere else. Any failure writes no handoff and
 * fails the job, so the apply job removes the label and posts nothing.
 */
export async function performIntakeAgentPhase(
	options: IntakePhaseOptions,
): Promise<IntakePhaseResult> {
	const note = options.note ?? (() => {});
	const cwd = options.cwd;
	const issueNumber = options.issueNumber;
	const env = options.env ?? process.env;
	const held = requireIntakeLock(options, env);
	if (held.needsAgent === false) {
		const message =
			'the lock job said no agent is needed (needsAgent: false); nothing to do';
		note(message);
		return {exitCode: 0, outcome: 'no-op', issueNumber, message};
	}
	if (options.handoffDir === undefined) {
		throw new PhaseDriverError('the agent phase needs a handoff directory');
	}
	const issueProvider = options.issueProvider ?? new GitHubIssueProvider();

	let issue: Issue;
	let thread: IssueComment[];
	try {
		issue = await issueProvider.getIssue({cwd, issueNumber, env});
		thread = await issueProvider.listComments({cwd, issueNumber, env});
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		const message = `Could not read issue #${issueNumber}: ${detail}`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', issueNumber, message};
	}
	// ONLY the comments the lock job read: one posted since is neither shown to
	// the agent nor (the apply job marks `seenCommentIds`) marked seen.
	const seen = new Set(held.seenCommentIds);
	const comments = thread.filter((c) => c.id !== undefined && seen.has(c.id));
	if (comments.length < thread.length) {
		note(
			`${thread.length - comments.length} comment(s) the lock job did not read ` +
				'(posted since) are not shown to the decision agent',
		);
	}
	const triage = triageIntake(comments);

	const decided = await decideIntake(
		{...options, phase: 'agent'},
		cwd,
		issue,
		comments,
		triage.action === 'proceed' ? triage : undefined,
		note,
	);
	if (!decided.ok) {
		return {
			exitCode: 1,
			outcome: decided.result.outcome as IntakePhaseOutcome,
			issueNumber,
			message: decided.result.message,
		};
	}

	const record = intakeHandoffRecord(issueNumber, decided.decision);
	try {
		writeHandoff({dir: options.handoffDir, rung: 'intake', record});
	} catch (err) {
		if (!(err instanceof HandoffRejected)) throw err;
		note(err.message);
		return {
			exitCode: 1,
			outcome: 'agent-failed',
			issueNumber,
			message: err.message,
		};
	}
	const kind = record.intent.kind;
	const message = `handed over ${kind} for ${itemOf(issueNumber)}`;
	note(message);
	return {
		exitCode: 0,
		outcome: 'handed-over',
		issueNumber,
		message,
		intent: kind,
	};
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/**
 * The document a `intake-task` / `intake-spec` record describes, with the slug
 * RECOMPUTED from its title (`paramCase`, then `slug-safety.ts`). Throws
 * {@link HandoffRejected} for a title that is not one line or holds a control
 * character, or that leaves no safe slug.
 */
export function intakeDocumentFromRecord(
	record: HandoffRecord,
): IntakeDocumentDecision {
	if (
		record.intent.kind !== 'intake-task' &&
		record.intent.kind !== 'intake-spec'
	) {
		throw new Error(`${record.intent.kind} is not an intake document`);
	}
	const products = record.products as IntakeTaskProducts & IntakeSpecProducts;
	const title = products.title;
	const problem = singleLineScalarProblem(title);
	if (problem !== undefined || title.trim() === '') {
		throw new HandoffRejected(
			'field',
			`products.title ${problem ?? 'is blank'}`,
		);
	}
	const slug = ensureSafeSlug(paramCase(title));
	if (!isSafeSlug(slug)) {
		throw new HandoffRejected(
			'field',
			'products.title leaves no safe slug to derive (never a counter)',
		);
	}
	const body = products.body === '' ? undefined : products.body;
	if (record.intent.kind === 'intake-task') {
		return {kind: 'task', slug, title, body};
	}
	return {
		kind: 'spec',
		slug,
		title,
		body,
		humanOnly: products.humanOnly,
		needsAnswers: products.needsAnswers,
	};
}

/**
 * The apply phase: check the label is still held, act on the agent job's
 * result, validate the handoff as hostile, then resume at the write half with
 * every target, stamp and mode from trusted inputs. Runs no agent and no
 * repository code. The label is ALWAYS removed once the check passed.
 */
export async function performIntakeApplyPhase(
	options: IntakePhaseOptions,
): Promise<IntakePhaseResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const issueNumber = options.issueNumber;
	const item = itemOf(issueNumber);
	const env = noSmudgeEnv(
		identityEnv(options.identity, options.env ?? process.env),
	);
	const held = requireIntakeLock(options, env);
	if (options.agentResult === undefined) {
		throw new PhaseDriverError(
			'the apply phase needs the agent job result (--agent-result, ' +
				'needs.agent.result): only success reads the handoff',
		);
	}
	const agentResult = options.agentResult;
	const issueProvider = options.issueProvider ?? new GitHubIssueProvider();
	const result = (
		exitCode: 0 | 1 | 4,
		outcome: IntakePhaseOutcome,
		message: string,
	): IntakePhaseResult => {
		note(message);
		return {exitCode, outcome, issueNumber, message};
	};

	const transport = await intakeTransportProblem(
		options.identity,
		cwd,
		arbiter,
		env,
	);
	if (transport !== undefined) {
		return result(
			1,
			'usage-error',
			`${transport} ${manualRecovery(issueNumber)}`,
		);
	}

	// Label ownership BEFORE the first write: the label is the intake lock. A
	// label that is gone means the run already finished (a "Re-run failed jobs"
	// of it replays the old handoff), so nothing is written.
	const labels = await issueProvider.getLabels({cwd, issueNumber, env});
	if (labels.outcome === 'failed') {
		return result(
			1,
			'usage-error',
			`could not read the labels of issue #${issueNumber} (${labels.instruction}); ` +
				`nothing was written. ${manualRecovery(issueNumber)}`,
		);
	}
	if (
		labels.outcome === 'ok' &&
		!labels.labels.includes(PROCESSING_LOCK_LABEL)
	) {
		return result(
			1,
			'stale-lock',
			`the \`${PROCESSING_LOCK_LABEL}\` label of issue #${issueNumber} is gone ` +
				'(the run already finished, or another run released it); nothing was ' +
				'written. To retry the issue, start a NEW run.',
		);
	}

	try {
		if (agentResult !== 'success' || held.needsAgent === false) {
			if (held.needsAgent === false) {
				return result(
					0,
					'no-op',
					`the lock job's triage skipped ${item} (needsAgent: false); only the ` +
						'label is removed',
				);
			}
			return result(
				1,
				'released',
				`the agent job ended ${agentResult} (a failure, a timeout or a cancel); ` +
					'the handoff was not read and nothing was posted; the label is removed',
			);
		}

		let record: HandoffRecord;
		let doc: IntakeDocumentDecision | undefined;
		let content: string | undefined;
		const originTrust: OriginTrust = held.originTrust ?? 'untrusted';
		try {
			if (options.handoffDir === undefined) {
				throw new HandoffRejected('layout', 'no handoff directory was given');
			}
			record = readHandoff({
				dir: options.handoffDir,
				runnerTemp: runnerTempFrom(options.runnerTemp, env),
				trust: {item, rung: 'intake'},
			}).record;
			if (
				record.intent.kind === 'intake-task' ||
				record.intent.kind === 'intake-spec'
			) {
				doc = intakeDocumentFromRecord(record);
				// Re-render from the verdict and the TRUSTED issue number and stamp,
				// then re-parse: the stamp must read back as the trusted values.
				try {
					content = renderIntakeDocument(doc, {issueNumber, originTrust});
				} catch (err) {
					const detail = err instanceof Error ? err.message : String(err);
					throw new HandoffRejected(
						'field',
						`the re-rendered document does not carry the trusted stamp: ${detail}`,
					);
				}
			}
		} catch (err) {
			if (!(err instanceof HandoffRejected)) throw err;
			return result(
				1,
				'rejected',
				`${err.message}; nothing was posted and the label is removed`,
			);
		}

		const mode: IntegrationMode =
			held.documentMode ?? options.integration?.task ?? 'propose';
		const ctx: IntakeWriteContext = {
			issueNumber,
			cwd,
			arbiter,
			issueProvider,
			integration: {task: mode, spec: mode},
			mergeRetries: options.mergeRetries,
			mergeJitterMs: options.mergeJitterMs,
			originTrust,
			noPR: options.noPR,
			placement: intakePlacementInputs(options),
			providerInstance: options.providerInstance,
			seen: held.seenCommentIds,
			env,
			note,
		};
		let written: IntakeResult;
		if (doc !== undefined && content !== undefined) {
			written = await emitIntakeDocument(doc, content, ctx);
		} else if (record.intent.kind === 'intake-ask') {
			written = await applyIntakeDecision(
				{kind: 'ask', body: (record.products as IntakeAskProducts).question},
				ctx,
			);
		} else {
			written = await applyIntakeDecision(
				{
					kind: 'bounce',
					body: (record.products as IntakeBounceProducts).bounceText,
				},
				ctx,
			);
		}
		return {
			exitCode: written.exitCode,
			outcome: written.outcome as IntakePhaseOutcome,
			issueNumber,
			message: written.message,
			emitted: written.emitted,
			emittedSlug: written.emittedSlug,
		};
	} finally {
		if (labels.outcome === 'ok') {
			const removed = await issueProvider.removeLabel({
				cwd,
				issueNumber,
				label: PROCESSING_LOCK_LABEL,
				env,
			});
			if (!removed.applied) {
				note(`Processing lock release degraded: ${removed.instruction}`);
				note(manualRecovery(issueNumber));
			}
		}
	}
}
