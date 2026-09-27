/**
 * **The CI handoff record: `handoff.json` schema v1 and its intent table**
 * (spec `ci-agent-job-without-write-token`, ADR
 * `ci-agent-job-holds-no-write-token`).
 *
 * In CI every item runs as three jobs: **lock** (write token, no agent),
 * **agent** (read-only token) and **apply** (write token, no agent). The agent
 * job hands its results to the apply job through ONE artifact per item run (the
 * file I/O is `ci-handoff.ts`). Named "CI handoff" to keep it apart from the
 * requeue "handoff note" (`prompt.ts`), an unrelated human-written body section.
 *
 * `handoff.json` is `{schema: 1, item, intent: {kind}, products}`. `intent` is
 * the closed union of the 15 kinds, one per boundary; `products` holds the
 * bounded fields the agent phase produced (texts, verdict enums, booleans).
 *
 * **The security contract is {@link HANDOFF_INTENT_TABLE}.** For every intent
 * it lists what the apply job recomputes from trusted inputs, the ONLY fields
 * it takes from the record, whether a bundle comes with it, and the tail
 * function the apply job resumes at. A field outside a row's `record` column is
 * REJECTED, never ignored, so a record cannot smuggle a target, a mode or a path
 * the apply job must derive itself. Which intents a run may hand over is bounded
 * by its TRUSTED rung (a lock-job output): a surface run cannot hand over
 * `integrate`. Every limit is a constant here, never read from the artifact.
 */

import {PR_TITLE_MAX} from './integration-core.js';
import {isSafeSlug} from './slug-safety.js';
import {parseSlugArg} from './slug-namespace.js';

/** The only `schema` value this dorfl reads or writes. */
export const HANDOFF_SCHEMA = 1;

const MB = 1024 * 1024;

/**
 * The size limits (spec, "Size limits"), set in code and never read from the
 * artifact. Byte limits are on file sizes; character limits are on JavaScript
 * string length (UTF-16 code units, never fewer than the characters GitHub
 * counts).
 */
export const HANDOFF_LIMITS = {
	/** Every file of the extracted artifact together. */
	artifactBytes: 200 * MB,
	/** `work.bundle`. */
	bundleBytes: 100 * MB,
	/** One blob inside the bundle (enforced by the bundle content validation). */
	blobBytes: 20 * MB,
	/** Every file under `lfs/` together. */
	lfsBytes: 500 * MB,
	/** `handoff.json`. */
	handoffJsonBytes: 2 * MB,
	/** A PR title (the existing {@link PR_TITLE_MAX}). */
	prTitleChars: PR_TITLE_MAX,
	/** A PR body, and every text posted as one comment (under GitHub's 65,536). */
	commentChars: 60_000,
	/** Each reason or question. */
	reasonChars: 10_000,
	/**
	 * A drafted document title (task, spec or ADR `title:`). Not in the spec's
	 * list: a single line that becomes frontmatter, so it gets a tight bound.
	 */
	documentTitleChars: 200,
	/**
	 * A whole document (a candidate task file, a drafted task/spec/ADR body, the
	 * trimmed spec body). Not in the spec's list: the largest spec in this repo
	 * is about 52,000 characters, so the comment limit would be too tight. All
	 * documents together are still bounded by `handoffJsonBytes`.
	 */
	documentChars: 200_000,
} as const;

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

/** Which rule a rejected handoff broke (machine-stable, for tests and reports). */
export type HandoffRule =
	| 'location'
	| 'layout'
	| 'symlink'
	| 'size'
	| 'json'
	| 'schema'
	| 'shape'
	| 'item'
	| 'kind'
	| 'kind-for-rung'
	| 'field'
	| 'limit'
	| 'bundle-presence'
	| 'bundle-format'
	| 'bundle-refs'
	| 'name';

/** A handoff (or one being written) that breaks one of the rules. */
export class HandoffRejected extends Error {
	constructor(
		readonly rule: HandoffRule,
		message: string,
	) {
		super(`handoff rejected (${rule}): ${message}`);
		this.name = 'HandoffRejected';
	}
}

/** Throw a {@link HandoffRejected}. */
export function rejectHandoff(rule: HandoffRule, message: string): never {
	throw new HandoffRejected(rule, message);
}
const reject: (rule: HandoffRule, message: string) => never = rejectHandoff;

// ---------------------------------------------------------------------------
// Rungs and intent kinds
// ---------------------------------------------------------------------------

/**
 * The trusted rung the lock job classified (its `rung` output): the agent
 * rungs of `advance-classify.ts` (`TickRungKind`) plus `intake`. It bounds
 * which intents the run may hand over.
 */
export const HANDOFF_RUNGS = [
	'build-task',
	'task-spec',
	'surface',
	'triage-observation',
	'apply',
	'intake',
] as const;
export type HandoffRung = (typeof HANDOFF_RUNGS)[number];

/** The 15 intent kinds (spec, "The intent kinds"). */
export const HANDOFF_INTENT_KINDS = [
	'integrate',
	'merge-restale',
	'needs-attention',
	'deadline-checkpoint',
	'stop',
	'agent-failed',
	'tasking-land',
	'tasking-surface',
	'surface',
	'triage',
	'apply-decision',
	'intake-ask',
	'intake-bounce',
	'intake-task',
	'intake-spec',
] as const;
export type HandoffIntentKind = (typeof HANDOFF_INTENT_KINDS)[number];

/** The agent-stop kinds a `stop` carries (`agent-stop.ts` `AgentStopKind`). */
export const STOP_KINDS = ['sentinel', 'empty-diff'] as const;
/** The triage gate's dispositions (`keep` is the fall-through to surface). */
export const TRIAGE_DISPOSITIONS = ['keep', 'duplicate', 'map'] as const;
/** The agentic apply decision's outcomes (`APPLY_ALLOWED_OUTCOMES`). */
export const APPLY_DECISION_OUTCOMES = [
	'task',
	'spec',
	'adr',
	'dispose',
	'resolve',
	'ask',
] as const;
/** The task-set review verdict of `tasking-land`. */
export const REVIEW_VERDICTS = ['approve', 'block'] as const;

// ---------------------------------------------------------------------------
// Record types (what `products` holds per intent)
// ---------------------------------------------------------------------------

/** `integrate` on the build rung. */
export interface IntegrateBuildProducts {
	prTitle: string;
	prBody: string;
	reviewProse?: string;
}
/** Answered-merge `integrate`, `merge-restale`, `deadline-checkpoint`: nothing. */
export type NoProducts = Record<string, never>;
export interface NeedsAttentionProducts {
	reason: string;
	questions?: string[];
}
export interface StopProducts {
	reason: string;
	stopKind: (typeof STOP_KINDS)[number];
}
export interface AgentFailedProducts {
	failureDetail: string;
}
export interface TaskingLandProducts {
	/** Candidate task file contents keyed by safe slug. */
	candidates: Record<string, string>;
	prBody: string;
	reviewVerdict?: (typeof REVIEW_VERDICTS)[number];
	reviewProse?: string;
	/** The trimmed spec body (task `ci-split-tasking`). */
	specBody: string;
}
export interface TaskingSurfaceProducts {
	candidates: Record<string, string>;
	reason: string;
	questions?: string[];
}
export interface SurfaceProducts {
	questions: string[];
}
export interface TriageProducts {
	disposition: (typeof TRIAGE_DISPOSITIONS)[number];
	/** The existing item (`<task|spec|observation>:<slug>`) for `duplicate` / `map`. */
	target?: string;
	reason?: string;
	/** The surface agent's questions when the rung fell through (`keep`). */
	questions?: string[];
}
export interface ApplyDecisionProducts {
	outcome: (typeof APPLY_DECISION_OUTCOMES)[number];
	/** For `task` / `spec` / `adr`: the minted title, body and slug. */
	title?: string;
	body?: string;
	slug?: string;
	reason?: string;
	/** For `ask`: the follow-up questions. */
	questions?: string[];
}
export interface IntakeAskProducts {
	question: string;
}
export interface IntakeBounceProducts {
	bounceText: string;
}
export interface IntakeTaskProducts {
	title: string;
	body: string;
}
export interface IntakeSpecProducts {
	title: string;
	body: string;
	humanOnly?: boolean;
	needsAnswers?: boolean;
}

/** One `{intent, products}` pair; `products` narrows with `intent.kind`. */
export type HandoffPayload =
	| {
			intent: {kind: 'integrate'};
			products: IntegrateBuildProducts | NoProducts;
	  }
	| {intent: {kind: 'merge-restale'}; products: NoProducts}
	| {intent: {kind: 'needs-attention'}; products: NeedsAttentionProducts}
	| {intent: {kind: 'deadline-checkpoint'}; products: NoProducts}
	| {intent: {kind: 'stop'}; products: StopProducts}
	| {intent: {kind: 'agent-failed'}; products: AgentFailedProducts}
	| {intent: {kind: 'tasking-land'}; products: TaskingLandProducts}
	| {intent: {kind: 'tasking-surface'}; products: TaskingSurfaceProducts}
	| {intent: {kind: 'surface'}; products: SurfaceProducts}
	| {intent: {kind: 'triage'}; products: TriageProducts}
	| {intent: {kind: 'apply-decision'}; products: ApplyDecisionProducts}
	| {intent: {kind: 'intake-ask'}; products: IntakeAskProducts}
	| {intent: {kind: 'intake-bounce'}; products: IntakeBounceProducts}
	| {intent: {kind: 'intake-task'}; products: IntakeTaskProducts}
	| {intent: {kind: 'intake-spec'}; products: IntakeSpecProducts};

/** The whole `handoff.json`. */
export type HandoffRecord = {
	schema: typeof HANDOFF_SCHEMA;
	/** The canonical item id ({@link canonicalHandoffItem}). */
	item: string;
} & HandoffPayload;

// ---------------------------------------------------------------------------
// Field specs
// ---------------------------------------------------------------------------

/** How one field of a row's `record` column is validated. */
export type FieldSpec = {required: boolean} & (
	| {type: 'line'; maxChars: number}
	| {type: 'text'; maxChars: number}
	| {type: 'text-list'; maxChars: number}
	| {type: 'documents'; maxChars: number}
	| {type: 'enum'; values: readonly string[]}
	| {type: 'boolean'}
	| {type: 'slug'}
	| {type: 'item-ref'}
);

const L = HANDOFF_LIMITS;
const line = (maxChars: number, required = true): FieldSpec => ({
	type: 'line',
	maxChars,
	required,
});
const text = (maxChars: number, required = true): FieldSpec => ({
	type: 'text',
	maxChars,
	required,
});
const textList = (maxChars: number, required = true): FieldSpec => ({
	type: 'text-list',
	maxChars,
	required,
});
const oneOf = (values: readonly string[], required = true): FieldSpec => ({
	type: 'enum',
	values,
	required,
});
const docs = (): FieldSpec => ({
	type: 'documents',
	maxChars: L.documentChars,
	required: true,
});

// ---------------------------------------------------------------------------
// The intent table (the security contract)
// ---------------------------------------------------------------------------

/** Whether a bundle must, may or must not come with an intent. */
export type BundleRule = 'required' | 'optional' | 'none';

/** One row of the intent table: its four columns plus the rungs that produce it. */
export interface IntentRow {
	/** A stable row name (`integrate` has two rows). */
	row: string;
	kind: HandoffIntentKind;
	/** The trusted rungs that may hand this intent over. */
	rungs: readonly HandoffRung[];
	/** Column 1: what the apply job recomputes from trusted inputs. */
	recomputed: readonly string[];
	/** Column 2: the ONLY fields taken from the record (`products`); `{}` = none. */
	record: Readonly<Record<string, FieldSpec>>;
	/** Cross-field rules of the record, run after every field passed. */
	check?: (products: Record<string, unknown>) => void;
	/** Column 3: what comes from the bundle, and whether one must come. */
	bundle: {rule: BundleRule; carries: string};
	/** Column 4: the tail function the apply job resumes at. */
	resumesAt: string;
}

const NO_BUNDLE = {rule: 'none', carries: 'none'} as const;

const INTAKE_DOCUMENT_RECOMPUTED = [
	'issue number',
	'placement',
	'origin-trust stamp',
	'document mode',
	'seen comment ids',
	'the slug (derived from the verdict, then checked by slug-safety.ts)',
];
const INTAKE_DOCUMENT_RESUME =
	'render the document, switchToWorkBranch, performIntegration, completion comment, label removal';

/**
 * The intent table, carried from the spec row by row. `integrate` has two rows
 * (build on the `build-task` rung, answered merge on the `apply` rung); the
 * spec's shared `intake-task` / `intake-spec` row is split in two here because
 * only the spec variant carries the two gate booleans.
 */
export const HANDOFF_INTENT_TABLE: readonly IntentRow[] = [
	{
		row: 'integrate-build',
		kind: 'integrate',
		rungs: ['build-task'],
		recomputed: [
			'item',
			'work branch name',
			'arbiter',
			'integration mode (workflow flag, then the untrusted-origin rule on the task at baseSha)',
			'deleteMergedHead',
		],
		record: {
			prTitle: line(L.prTitleChars),
			prBody: text(L.commentChars),
			reviewProse: text(L.commentChars, false),
		},
		bundle: {rule: 'required', carries: 'work branch tip (done-move included)'},
		resumesAt:
			'the land half of runRebaseToIntegrateTail (the applyCompleteTransition loop), then the review comment, then the lock release',
	},
	{
		row: 'integrate-answered-merge',
		kind: 'integrate',
		rungs: ['apply'],
		recomputed: [
			'item',
			'branch',
			'mode merge',
			'the answered kind: merge entry read from main',
		],
		record: {},
		bundle: {rule: 'required', carries: 'rebased tip of work/task-<slug>'},
		resumesAt:
			'the same land loop, then applyAnsweredQuestions, the tree-less publish and the release',
	},
	{
		row: 'merge-restale',
		kind: 'merge-restale',
		rungs: ['apply'],
		recomputed: ['item', 'the answered entry'],
		record: {},
		bundle: NO_BUNDLE,
		resumesAt:
			'the strictMergeApproval follow-up question and re-pause, publish, release',
	},
	{
		row: 'needs-attention',
		kind: 'needs-attention',
		rungs: ['build-task', 'apply'],
		recomputed: ['item', 'branch', 'sidecar path'],
		record: {
			reason: text(L.reasonChars),
			questions: textList(L.reasonChars, false),
		},
		bundle: {rule: 'optional', carries: 'WIP tip, if any'},
		resumesAt:
			'the write half of routeToNeedsAttention (branch push) and the surface (sidecar, needsAnswers: true), then the release',
	},
	{
		row: 'deadline-checkpoint',
		kind: 'deadline-checkpoint',
		rungs: ['build-task'],
		recomputed: ['item', 'branch', 'maxAutoCheckpoints from config at baseSha'],
		record: {},
		bundle: {
			rule: 'required',
			carries:
				'WIP tip; the checkpoint count is recounted from the new commits',
		},
		resumesAt:
			'the write half of routeDeadlineCheckpoint: branch push, then auto-continue release or surface',
	},
	{
		row: 'stop',
		kind: 'stop',
		rungs: ['build-task'],
		recomputed: ['item', 'branch'],
		record: {reason: text(L.reasonChars), stopKind: oneOf(STOP_KINDS)},
		bundle: {rule: 'optional', carries: 'WIP tip, if any'},
		resumesAt: 'the write half of saveAgentStop',
	},
	{
		row: 'agent-failed',
		kind: 'agent-failed',
		rungs: ['build-task'],
		recomputed: ['item', 'branch'],
		record: {failureDetail: text(L.reasonChars)},
		bundle: {rule: 'optional', carries: 'WIP tip, if any'},
		resumesAt: 'the write half of saveAgentFailure',
	},
	{
		row: 'tasking-land',
		kind: 'tasking-land',
		rungs: ['task-spec'],
		recomputed: [
			'spec slug',
			'the spec move to specs/tasked/',
			'candidate folder (work/tasks/backlog/)',
			'mode',
			'the origin stamp and gate keys of the spec at baseSha',
		],
		record: {
			candidates: docs(),
			prBody: text(L.commentChars),
			reviewVerdict: oneOf(REVIEW_VERDICTS, false),
			reviewProse: text(L.commentChars, false),
			specBody: text(L.documentChars),
		},
		bundle: NO_BUNDLE,
		resumesAt:
			'the tasking integrate with the review OFF (it ran in the agent phase), then the release',
	},
	{
		row: 'tasking-surface',
		kind: 'tasking-surface',
		rungs: ['task-spec'],
		recomputed: ['spec slug', 'branch work/spec-<slug>', 'mode'],
		record: {
			candidates: docs(),
			reason: text(L.reasonChars),
			questions: textList(L.reasonChars, false),
		},
		bundle: NO_BUNDLE,
		resumesAt:
			'persistTaskingCandidates (commit rebuilt in the apply job), closeRequestOnBranch in propose mode, surfaceTaskingBlock',
	},
	{
		row: 'surface',
		kind: 'surface',
		rungs: ['surface'],
		recomputed: [
			'item',
			'item path at baseSha',
			'sidecar path',
			'engine-built base questions',
		],
		record: {questions: textList(L.reasonChars)},
		bundle: NO_BUNDLE,
		resumesAt: 'persistSurfacedQuestions, publish, release',
	},
	{
		row: 'triage',
		kind: 'triage',
		rungs: ['triage-observation'],
		recomputed: [
			'item',
			'the resolved observationTriage gate',
			'the engine-built triage question',
			'the note at baseSha',
		],
		record: {
			disposition: oneOf(TRIAGE_DISPOSITIONS),
			target: {type: 'item-ref', required: false},
			reason: text(L.reasonChars, false),
			questions: textList(L.reasonChars, false),
		},
		check: (p) => {
			const auto = p.disposition !== 'keep';
			if (auto && p.target === undefined) {
				reject('field', `products.target is required for ${p.disposition}`);
			}
			if (!auto && p.target !== undefined) {
				reject('field', 'products.target is only for duplicate or map');
			}
			if (auto && p.questions !== undefined) {
				reject('field', 'products.questions are only for keep (fall-through)');
			}
		},
		bundle: NO_BUNDLE,
		resumesAt:
			'autoDisposition or persistSurfacedQuestions, publish, release (the marker back-fill needs no agent and runs in apply directly)',
	},
	{
		row: 'apply-decision',
		kind: 'apply-decision',
		rungs: ['apply'],
		recomputed: ['item', 'the answered sidecar read from main'],
		record: {
			outcome: oneOf(APPLY_DECISION_OUTCOMES),
			title: line(L.documentTitleChars, false),
			body: text(L.documentChars, false),
			slug: {type: 'slug', required: false},
			reason: text(L.reasonChars, false),
			questions: textList(L.reasonChars, false),
		},
		check: (p) => {
			const mints = ['task', 'spec', 'adr'].includes(p.outcome as string);
			for (const f of ['title', 'body', 'slug']) {
				if (mints && p[f] === undefined) {
					reject('field', `products.${f} is required for ${p.outcome}`);
				}
				if (!mints && p[f] !== undefined) {
					reject('field', `products.${f} is only for task, spec or adr`);
				}
			}
			const ask = p.outcome === 'ask';
			if (ask && p.questions === undefined) {
				reject('field', 'products.questions is required for ask');
			}
			if (!ask && p.questions !== undefined) {
				reject('field', 'products.questions is only for ask');
			}
		},
		bundle: NO_BUNDLE,
		resumesAt:
			'the verdict router (promoteObservation via createItemThroughCas, mintAdr, delete, settle and keep, or append and re-pause), publish, release',
	},
	{
		row: 'intake-ask',
		kind: 'intake-ask',
		rungs: ['intake'],
		recomputed: ['issue number', 'marker', 'seen comment ids (lock output)'],
		record: {question: text(L.reasonChars)},
		bundle: NO_BUNDLE,
		resumesAt: 'dispatchComment, label removal',
	},
	{
		row: 'intake-bounce',
		kind: 'intake-bounce',
		rungs: ['intake'],
		recomputed: ['issue number', 'marker', 'seen comment ids'],
		record: {bounceText: text(L.commentChars)},
		bundle: NO_BUNDLE,
		resumesAt: 'closeIssue with the comment, label removal',
	},
	{
		row: 'intake-task',
		kind: 'intake-task',
		rungs: ['intake'],
		recomputed: INTAKE_DOCUMENT_RECOMPUTED,
		record: {
			title: line(L.documentTitleChars),
			body: text(L.documentChars),
		},
		bundle: NO_BUNDLE,
		resumesAt: INTAKE_DOCUMENT_RESUME,
	},
	{
		row: 'intake-spec',
		kind: 'intake-spec',
		rungs: ['intake'],
		recomputed: INTAKE_DOCUMENT_RECOMPUTED,
		record: {
			title: line(L.documentTitleChars),
			body: text(L.documentChars),
			humanOnly: {type: 'boolean', required: false},
			needsAnswers: {type: 'boolean', required: false},
		},
		bundle: NO_BUNDLE,
		resumesAt: INTAKE_DOCUMENT_RESUME,
	},
];

/** The row for an intent handed over by a run on `rung`, or `undefined`. */
export function intentRowFor(
	rung: HandoffRung,
	kind: HandoffIntentKind,
): IntentRow | undefined {
	return HANDOFF_INTENT_TABLE.find(
		(r) => r.kind === kind && r.rungs.includes(rung),
	);
}

// ---------------------------------------------------------------------------
// Item ids and the artifact name
// ---------------------------------------------------------------------------

/**
 * The canonical form of a legal item id: `issue:<N>`, or `task:` / `spec:` /
 * `observation:` plus a safe slug. A bare slug is a task and `obs:` an
 * observation, as everywhere else in dorfl (`resolveSidecarIdentity`). Anything
 * else (an issue title, say) throws {@link HandoffRejected} (`item`).
 */
export function canonicalHandoffItem(item: string): string {
	if (typeof item !== 'string') reject('item', 'the item is not a string');
	const issue = /^issue:([1-9][0-9]{0,11})$/.exec(item);
	if (issue) return `issue:${issue[1]}`;
	if (item.startsWith('issue:')) reject('item', 'not a legal issue item id');
	const parsed = parseSlugArg(item);
	if (!isSafeSlug(parsed.slug)) reject('item', 'not a legal item id');
	return `${parsed.explicit ?? 'task'}:${parsed.slug}`;
}

/** The artifact-name shape {@link handoffName} produces (and only that). */
export const HANDOFF_NAME_RE =
	/^dorfl-handoff-(?:task|spec|observation|issue)-[A-Za-z0-9._-]{1,120}-attempt-[1-9][0-9]{0,5}$/;

/**
 * The artifact name of an item run: `dorfl-handoff-<type>-<slug>-attempt-<N>`,
 * derived by the lock job from the item and `github.run_attempt`. The item id's
 * `:` becomes `-` (artifact names refuse `:`), so the name holds only
 * `[A-Za-z0-9._-]`, which every artifact-name rule accepts. The canonical item
 * type is a fixed word without `-`, so two different items never share a name;
 * the attempt keeps "Re-run all jobs" from colliding with attempt 1's artifact
 * (artifacts belong to the run, not the attempt).
 */
export function handoffName(item: string, runAttempt: number | string): string {
	const canonical = canonicalHandoffItem(item);
	const attempt =
		typeof runAttempt === 'number' ? String(runAttempt) : runAttempt;
	if (!/^[1-9][0-9]{0,5}$/.test(attempt)) {
		reject('name', 'the run attempt is not a positive integer');
	}
	const name = `dorfl-handoff-${canonical.replace(':', '-')}-attempt-${attempt}`;
	if (!HANDOFF_NAME_RE.test(name)) reject('name', 'not a legal artifact name');
	return name;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Control characters other than tab, line feed and carriage return. */
// eslint-disable-next-line no-control-regex
const TEXT_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** Any control character or line separator (a single-line field). */
// eslint-disable-next-line no-control-regex
const LINE_CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function checkText(
	path: string,
	value: unknown,
	maxChars: number,
	singleLine: boolean,
): void {
	if (typeof value !== 'string') reject('field', `${path} is not a string`);
	if (value.length > maxChars) {
		reject(
			'limit',
			`${path} is ${value.length} characters, over the limit of ${maxChars}`,
		);
	}
	if (singleLine && LINE_CONTROL_RE.test(value)) {
		reject('field', `${path} must be one line without control characters`);
	}
	if (!singleLine && TEXT_CONTROL_RE.test(value)) {
		reject('field', `${path} holds a control character`);
	}
	if (singleLine && value.trim() === '') reject('field', `${path} is blank`);
}

function checkField(path: string, spec: FieldSpec, value: unknown): void {
	switch (spec.type) {
		case 'line':
		case 'text':
			return checkText(path, value, spec.maxChars, spec.type === 'line');
		case 'text-list':
			if (!Array.isArray(value)) reject('field', `${path} is not a list`);
			value.forEach((v, i) =>
				checkText(`${path}[${i}]`, v, spec.maxChars, false),
			);
			return;
		case 'documents':
			if (!isPlainObject(value)) reject('field', `${path} is not an object`);
			for (const [slug, doc] of Object.entries(value)) {
				if (!isSafeSlug(slug))
					reject('field', `a ${path} key is not a safe slug`);
				checkText(`${path}.${slug}`, doc, spec.maxChars, false);
			}
			return;
		case 'enum':
			if (typeof value !== 'string' || !spec.values.includes(value)) {
				reject('field', `${path} is not one of ${spec.values.join(', ')}`);
			}
			return;
		case 'boolean':
			if (typeof value !== 'boolean') {
				reject('field', `${path} is not a boolean`);
			}
			return;
		case 'slug':
			if (typeof value !== 'string' || !isSafeSlug(value)) {
				reject('field', `${path} is not a safe slug`);
			}
			return;
		case 'item-ref': {
			const m =
				typeof value === 'string'
					? /^(?:task|spec|observation):(.*)$/.exec(value)
					: null;
			if (m === null || !isSafeSlug(m[1])) {
				reject('field', `${path} is not a <task|spec|observation>:<slug> item`);
			}
			return;
		}
	}
}

function checkKeys(
	path: string,
	obj: Record<string, unknown>,
	allowed: readonly string[],
): void {
	for (const key of Object.keys(obj)) {
		if (!allowed.includes(key)) {
			reject(
				'field',
				`unknown field ${path}${JSON.stringify(key).slice(0, 80)}`,
			);
		}
	}
}

/** The trusted facts a handoff is judged against (lock-job outputs). */
export interface HandoffTrust {
	/** The item this run carries. */
	item: string;
	/** The rung the lock job classified. */
	rung: HandoffRung;
}

/**
 * Validate a parsed `handoff.json` against the trusted item and rung, and return
 * it typed together with its table row. Rejects an unknown schema, a record for
 * another item, an unknown kind, a kind the rung cannot produce, any field
 * outside the row's `record` column (at every level), a missing required field,
 * a malformed value and any over-limit text.
 */
export function validateHandoffRecord(
	value: unknown,
	trust: HandoffTrust,
): {record: HandoffRecord; row: IntentRow} {
	if (!isPlainObject(value)) reject('shape', 'handoff.json is not an object');
	if (value.schema !== HANDOFF_SCHEMA) {
		reject('schema', `unknown schema ${JSON.stringify(value.schema)}`);
	}
	checkKeys('', value, ['schema', 'item', 'intent', 'products']);
	const trustedItem = canonicalHandoffItem(trust.item);
	if (value.item !== trustedItem) {
		reject('item', `the record does not name this run's item ${trustedItem}`);
	}
	if (!isPlainObject(value.intent)) reject('shape', 'intent is not an object');
	checkKeys('intent.', value.intent, ['kind']);
	const kind = value.intent.kind;
	if (
		typeof kind !== 'string' ||
		!(HANDOFF_INTENT_KINDS as readonly string[]).includes(kind)
	) {
		reject('kind', `unknown intent kind ${JSON.stringify(kind).slice(0, 80)}`);
	}
	if (!(HANDOFF_RUNGS as readonly string[]).includes(trust.rung)) {
		reject('kind-for-rung', `unknown trusted rung ${String(trust.rung)}`);
	}
	const row = intentRowFor(trust.rung, kind as HandoffIntentKind);
	if (row === undefined) {
		reject('kind-for-rung', `a ${trust.rung} run cannot hand over ${kind}`);
	}
	if (!isPlainObject(value.products)) {
		reject('shape', 'products is not an object');
	}
	const products = value.products;
	checkKeys('products.', products, Object.keys(row.record));
	for (const [name, spec] of Object.entries(row.record)) {
		const v = products[name];
		if (v === undefined) {
			if (spec.required) reject('field', `products.${name} is required`);
			continue;
		}
		checkField(`products.${name}`, spec, v);
	}
	row.check?.(products);
	return {record: value as unknown as HandoffRecord, row};
}
