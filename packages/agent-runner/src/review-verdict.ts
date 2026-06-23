/**
 * The UNIFIED review-verdict type + parser + the shared JSON-verdict-contract
 * prompt helper for the runner-invoked **review discipline**
 * (`work/protocol/REVIEW-PROTOCOL.md`, source-of-truth
 * `skills/setup/protocol/REVIEW-PROTOCOL.md`).
 *
 * This is the keystone of the `runner-invoked-disciplines-into-protocol` brief
 * (task 1, D4): every runner-invoked review prompt builder
 * ({@link buildReviewPrompt}, {@link buildTaskAcceptancePrompt} in
 * `review-gate.ts`; {@link buildLoneSliceReviewPrompt} in `intake.ts`;
 * {@link buildTaskReviewPrompt} in `tasker-review-loop.ts`) POINTS at
 * `REVIEW-PROTOCOL.md` for the discipline + calls {@link verdictContractPrompt}
 * for the JSON-emitted-shape prose. None of them re-inlines the lenses or the
 * verdict contract; this module is the single home.
 *
 * The PARSER is the source of truth for the EMITTED SHAPE (D2):
 * `REVIEW-PROTOCOL.md` mirrors what `parseReviewVerdict` enforces (a
 * fixture-matches-doc test pins the two together). Discipline content is owned
 * by the doc; enforced shape is owned by the parser.
 */

import {extractJsonObjectSpan} from './verdict-json.js';
import {resolveProtocolDoc} from './prompt.js';

/** A single review finding — the `severity`/`question`/`context` triple. */
export interface ReviewFinding {
	/** Whether this finding blocks (keeps the work out of "ready") or is a nit. */
	severity: 'blocking' | 'non-blocking';
	/** The question / defect, with enough context to act. */
	question: string;
	/** The relevant excerpt, `file:line`, or reasoning. */
	context?: string;
}

/**
 * A full-content edit the review agent wants applied (the improver loop's
 * between-passes step). `path` is repo-relative; `content` is the FULL
 * replacement file body. The runner writes it; the agent does no disk/git.
 */
export interface TaskEdit {
	/** Repo-relative path of the candidate task file to write. */
	path: string;
	/** The full replacement content for that file. */
	content: string;
}

/**
 * A task the review judged UNCERTAIN — emit it `needsAnswers: true` with the
 * questions in its body. Used by the tasker improver loop's non-converge sink.
 */
export interface UncertainTask {
	/** Repo-relative path of the uncertain candidate task. */
	path: string;
	/** The open questions to record in the task body. */
	questions: string[];
}

/**
 * The UNIFIED review verdict — one type across all four runner-invoked review
 * call sites. The required fields (`verdict`, `findings`) are common; the
 * optional channels are caller-specific (each builder's prompt names which
 * channels to fill). The parser tolerates any subset; routing code reads only
 * the channels its caller asked for.
 */
export interface ReviewVerdict {
	/** `approve` lets the artifact proceed; `block` routes to needs-attention. */
	verdict: 'approve' | 'block';
	/** The findings the agent surfaced (may be empty on an approve). */
	findings: ReviewFinding[];
	/**
	 * For the PR/code review gate: the deliberately-authored, human-readable
	 * REVIEW prose the in-core PR-comment poster posts. Advisory only — never
	 * gates the verdict (routing uses ONLY `verdict`/`findings`).
	 */
	review?: string;
	/** For the tasker improver loop: full-content edits to apply between passes. */
	edits?: TaskEdit[];
	/**
	 * For the lone-task review: a single in-memory full-replacement task BODY
	 * (the markdown AFTER the frontmatter), applied before the next round.
	 */
	edit?: string;
	/** For the lone-task review: open question(s) carried into the ASK comment. */
	questions?: string[];
	/** For the tasker improver loop: specific tasks to emit `needsAnswers: true`. */
	uncertainTasks?: UncertainTask[];
	/** For the tasker improver loop: route the WHOLE brief to needs-attention. */
	decompositionUnclear?: {questions: string[]};
}

/** Raised when the review agent ran but produced no parseable verdict. */
export class ReviewParseError extends Error {}

/**
 * Parse the unified review verdict out of the review agent's textual output.
 * The agent may wrap the JSON object in prose / a fenced block, so the first
 * JSON object carrying a `verdict` field is extracted via the shared
 * {@link extractJsonObjectSpan}, JSON-parsed, and validated. The verdict shape
 * is the source of truth for what `REVIEW-PROTOCOL.md` describes (D2).
 *
 * Throws {@link ReviewParseError} on: no JSON object, invalid JSON, or a
 * `verdict` not in `{approve, block}`. The caller treats any throw as
 * needs-attention — NEVER a silent approve.
 */
export function parseReviewVerdict(output: string): ReviewVerdict {
	const span = extractJsonObjectSpan(output);
	if (span === undefined) {
		throw new ReviewParseError(
			'review agent produced no parseable {verdict, findings} result',
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(output.slice(span.start, span.end));
	} catch (err) {
		throw new ReviewParseError(
			`review verdict was not valid JSON: ${(err as Error).message}`,
		);
	}
	return validateVerdict(parsed);
}

function validateVerdict(parsed: unknown): ReviewVerdict {
	if (typeof parsed !== 'object' || parsed === null) {
		throw new ReviewParseError('review verdict was not an object');
	}
	const obj = parsed as Record<string, unknown>;
	const verdict = obj.verdict;
	if (verdict !== 'approve' && verdict !== 'block') {
		throw new ReviewParseError(
			`review verdict was not 'approve' or 'block' (got ${JSON.stringify(verdict)})`,
		);
	}
	const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
	const findings: ReviewFinding[] = rawFindings.map((f) => {
		const item = (typeof f === 'object' && f !== null ? f : {}) as Record<
			string,
			unknown
		>;
		const severity = item.severity === 'blocking' ? 'blocking' : 'non-blocking';
		return {
			severity,
			question: typeof item.question === 'string' ? item.question : '',
			...(typeof item.context === 'string' ? {context: item.context} : {}),
		};
	});
	const edits = parseEdits(obj.edits);
	const uncertainTasks = parseUncertainTasks(obj.uncertainTasks);
	const decompositionUnclear = parseDecompositionUnclear(
		obj.decompositionUnclear,
	);
	const questions = Array.isArray(obj.questions)
		? obj.questions.filter((q): q is string => typeof q === 'string')
		: [];
	return {
		verdict,
		findings,
		...(typeof obj.review === 'string' ? {review: obj.review} : {}),
		...(typeof obj.edit === 'string' ? {edit: obj.edit} : {}),
		...(edits.length > 0 ? {edits} : {}),
		...(questions.length > 0 ? {questions} : {}),
		...(uncertainTasks.length > 0 ? {uncertainTasks} : {}),
		...(decompositionUnclear ? {decompositionUnclear} : {}),
	};
}

function parseEdits(raw: unknown): TaskEdit[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: TaskEdit[] = [];
	for (const e of raw) {
		if (typeof e !== 'object' || e === null) {
			continue;
		}
		const item = e as Record<string, unknown>;
		if (typeof item.path === 'string' && typeof item.content === 'string') {
			out.push({path: item.path, content: item.content});
		}
	}
	return out;
}

function parseUncertainTasks(raw: unknown): UncertainTask[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: UncertainTask[] = [];
	for (const u of raw) {
		if (typeof u !== 'object' || u === null) {
			continue;
		}
		const item = u as Record<string, unknown>;
		if (typeof item.path !== 'string') {
			continue;
		}
		const questions = Array.isArray(item.questions)
			? item.questions.filter((q): q is string => typeof q === 'string')
			: [];
		out.push({path: item.path, questions});
	}
	return out;
}

function parseDecompositionUnclear(
	raw: unknown,
): {questions: string[]} | undefined {
	if (typeof raw !== 'object' || raw === null) {
		return undefined;
	}
	const item = raw as Record<string, unknown>;
	const questions = Array.isArray(item.questions)
		? item.questions.filter((q): q is string => typeof q === 'string')
		: [];
	return {questions};
}

/**
 * The shared JSON-verdict-contract prompt block — ONE function, called by all
 * four review-prompt builders. Returns the prose describing the unified
 * {@link ReviewVerdict} emitted shape (the prose mirrors what
 * {@link parseReviewVerdict} enforces; D2). Per-builder framing (who you are,
 * what you are reviewing, which optional channels to fill) stays in each
 * builder; this block is the single source of truth for the shape.
 *
 * The block is intentionally generous about optional channels — each caller's
 * prompt names which ones it wants. Unused channels are ignored by the parser.
 */
export function verdictContractPrompt(): string {
	return [
		'## Your output \u2014 ONE single JSON object (no prose OUTSIDE it)',
		'',
		'Emit a single JSON object of this exact shape (see',
		'`work/protocol/REVIEW-PROTOCOL.md` \u2192 "Your output" for the prose-described',
		'contract this mirrors):',
		'',
		'```json',
		'{"verdict": "approve" | "block",',
		' "findings": [',
		'   {"severity": "blocking" | "non-blocking", "question": "\u2026", "context": "\u2026"}',
		' ],',
		' "review": "<the human-readable PR-comment prose, when the caller asks for it>",',
		' "edits": [ {"path": "work/tasks/backlog/<slug>.md", "content": "<full replacement>"} ],',
		' "edit": "<single in-memory replacement body, for the lone-slice review>",',
		' "questions": ["<open question for the human>"],',
		' "uncertainTasks": [ {"path": "work/tasks/backlog/<slug>.md", "questions": ["\u2026"]} ],',
		' "decompositionUnclear": {"questions": ["\u2026"]}}',
		'```',
		'',
		'- `verdict` MUST be exactly `approve` or `block`. Use `block` with at least',
		'  one blocking finding when the artifact does not deliver / drifts / hides',
		'  a defect a human reviewer would flag; otherwise `approve`.',
		"- `findings` is required (may be empty). Each finding's `severity` is",
		'  `blocking` (keeps the item out of "ready") or `non-blocking` (a nit /',
		'  future improvement). Give each `question` enough context to act WITHOUT',
		'  re-deriving it. `context` is the relevant excerpt, `file:line`, or',
		'  reasoning.',
		'- The optional channels (`review`, `edits`, `edit`, `questions`,',
		'  `uncertainTasks`, `decompositionUnclear`) are OPT-IN: only fill the ones',
		"  the caller's framing names. Unused channels are ignored.",
	].join('\n');
}

/**
 * The shared prompt block that POINTS the spawned agent at the in-band review
 * discipline doc (`work/protocol/REVIEW-PROTOCOL.md` in the set-up target repo,
 * or the vendored fallback) instead of re-inlining the lenses. The four review
 * builders call this so the discipline content lives in ONE place
 * (`REVIEW-PROTOCOL.md`), never duplicated in the prompt builders.
 */
export function reviewDisciplinePrompt(): string {
	return [
		'## The review discipline',
		'',
		'Run the review discipline defined in `work/protocol/REVIEW-PROTOCOL.md`',
		'(the in-band, protocol-native review protocol every set-up repo carries;',
		'the human-facing pointer is `skills/review/SKILL.md`). Apply its lenses',
		'IN ORDER, ENDING in the destination check ("if this is built/merged',
		'exactly as written, do we end up with the system the brief/PRD/slice',
		'goal describes?"). Be ADVERSARIAL; verify against what ACTUALLY LANDED',
		'(the bytes on disk), not intent. Weight findings by REAL impact \u2014 the',
		'lenses find candidates, impact decides severity (a technically-true nit',
		'no one would hit is not a block). Flag, do not guess.',
	].join('\n');
}

/**
 * Resolve `REVIEW-PROTOCOL.md` in the target repo / vendored fallback / dev
 * walk \u2014 a thin alias around {@link resolveProtocolDoc} for callers (and
 * tests) that want to assert the doc is reachable. The four builders themselves
 * do NOT call this (they reference the path BY NAME in the prompt prose, so the
 * spawned agent reads its repo's own `work/protocol/REVIEW-PROTOCOL.md`), but
 * keeping the helper here lets the resolver test cover the protocol-doc set in
 * one place.
 */
export function resolveReviewProtocolPath(
	cwd?: string,
	override?: string,
): string {
	return resolveProtocolDoc('REVIEW-PROTOCOL.md', cwd, override);
}
