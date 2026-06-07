import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {NullHarness, type Harness} from './harness.js';
import {launchWithOptionalWatch} from './agent-launch.js';

/**
 * **The slicer review→edit→re-review→converge LOOP** (`slicer-review-edit-loop`,
 * GATES PRD `work/prd/review.md` RESOLVED DESIGN — Shape 2 / insertion point A).
 *
 * On the `do prd:<slug>` slicing path (`slicing.ts`/`performSlice`), AFTER the
 * agent produces a candidate set of `work/backlog/<slug>.md` slices and BEFORE the
 * runner finalises/lands them, this loop RUNS the `review` SKILL
 * (`skills/review/SKILL.md`), APPLIES its findings as EDITS to the candidate slice
 * files, then re-reviews — until a pass finds NO NEW blocking issue (the natural
 * terminator) or the `maxReview` hard cap is hit. It is an IMPROVER, NOT a one-shot
 * gate: slices measurably keep getting better when reviewed, so the findings feed
 * back into edits, repeatedly. The destination/goal check is part of the SAME
 * review pass (it can itself trigger edits — which is why it is a loop).
 *
 * Two axes (the M×N grid from the idea file):
 *   - **N** — the in-context multipass: ONE agent reviews AND edits in a single
 *     context, accumulating findings across angle-switched passes. `maxReview` caps
 *     N so the loop can never run forever.
 *   - **M** — fresh-context re-executions: a fresh context is simply a NEW EXECUTION
 *     of that same loop in a fresh harness launch (like the Gate-2 reviewer). The
 *     loop is implemented ONCE; M is invoking it again. `M=1` is the cheap default;
 *     `M=k` runs k independent fresh loops.
 *
 * This module wires the loop + edit-application + verdict routing AROUND the
 * `review` SKILL — it does NOT re-author the protocol (the lenses + the destination
 * check live in the skill). The agent makes the review/edit JUDGEMENTS through the
 * {@link SliceReviewGate} seam; this module applies the edits to disk and routes
 * the final verdict to the THREE outcomes (folded in from the deleted
 * `autoslice-confidence`, decision B):
 *
 *   - **converge** (a pass found no NEW blocking issue) → the improved slices land
 *     claimable.
 *   - **a specific uncertain slice** → emit it `needsAnswers: true` with the
 *     questions in its body (created, not agent-buildable until a human answers).
 *   - **the whole decomposition unclear / `maxReview` exhausted with blockers** →
 *     route the PRD to `work/needs-attention/<slug>.md` with the questions as the
 *     reason, emitting NO guessed slices.
 *
 * The verdict sink itself (the git transitions for those three outcomes) is the
 * caller's (`slicing.ts`): this module decides WHICH outcome and prepares the
 * edits/questions; the runner owns every git-state transition (the agent does no
 * git, here as everywhere).
 */

/** A single review finding, mirroring the `review` SKILL's verdict shape. */
export interface SliceReviewFinding {
	/** Whether this finding blocks (keeps the slice out of "ready") or is a nit. */
	severity: 'blocking' | 'non-blocking';
	/** The question / defect, with enough context to act. */
	question: string;
	/** The relevant excerpt, `file:line`, or reasoning. */
	context?: string;
}

/**
 * An EDIT the review agent wants applied to a candidate slice file between passes
 * — the "feed findings back into edits" mechanism (the loop's improver step). The
 * agent emits the FULL replacement content for a `work/backlog/<slug>.md` file (or
 * a new file it adds); the runner writes it (the agent does no git / no direct
 * disk writes that escape the runner's capture).
 */
export interface SliceEdit {
	/** Repo-relative path of the candidate slice file to write (`work/backlog/…`). */
	path: string;
	/** The full replacement content for that file. */
	content: string;
}

/**
 * A specific slice the review judged UNCERTAIN — emit it `needsAnswers: true` with
 * the questions in its body (the first of the three verdict outcomes that is not
 * "converge"). The path points at the candidate slice file; the questions are
 * recorded in its body by the caller.
 */
export interface UncertainSlice {
	/** Repo-relative path of the uncertain candidate slice (`work/backlog/…`). */
	path: string;
	/** The open questions to record in the slice body (a human answers them). */
	questions: string[];
}

/**
 * The verdict the review agent emits PER PASS (and this loop interprets). It
 * mirrors the `review` SKILL's `{verdict, findings}` and EXTENDS it with the loop's
 * three improver/routing channels:
 *   - `edits` — full-content edits to APPLY to the candidate slices before the next
 *     pass (the improver step). Empty ⇒ no edits this pass.
 *   - `uncertainSlices` — specific slices to emit `needsAnswers: true` + questions
 *     (routing outcome 2). Used when the loop hits `maxReview` with blockers.
 *   - `decompositionUnclear` — the whole decomposition is still unclear (routing
 *     outcome 3: route the PRD to needs-attention, emit no guessed slices).
 *
 * Routing decisions use `verdict`/`findings`/`uncertainSlices`/
 * `decompositionUnclear`; `edits` drive the in-context improvement.
 */
export interface SliceReviewVerdict {
	/** `approve` = no new blocking issue (the natural terminator); `block` = keep iterating. */
	verdict: 'approve' | 'block';
	/** The findings this pass surfaced. */
	findings: SliceReviewFinding[];
	/** Full-content edits to apply to the candidate slices before the next pass. */
	edits?: SliceEdit[];
	/** Specific slices to emit `needsAnswers: true` + questions (cap-hit routing). */
	uncertainSlices?: UncertainSlice[];
	/** The whole decomposition is unclear → route the PRD to needs-attention. */
	decompositionUnclear?: {questions: string[]};
}

/** What the review gate needs to launch a fresh-context review+edit pass. */
export interface SliceReviewGateInput {
	/** The PRD slug whose candidate slices are under review. */
	slug: string;
	/** The working clone/checkout the loop runs in (candidate slices live here). */
	cwd: string;
	/** Repo-relative paths of the candidate slices currently on disk. */
	candidateSlices: string[];
	/** Which review PASS this is (1-based) within the current fresh context (the N). */
	pass: number;
	/** Which fresh-context EXECUTION this is (1-based) — the M. */
	execution: number;
	/**
	 * The model the REVIEW agent runs on (de-correlated from the slicer). `undefined`
	 * ⇒ no forced model. Flows through `LaunchInput.model` / `substituteModel`.
	 */
	reviewModel?: string;
	/** The HOST-ONLY sessions root the review session FILE is generated under. */
	sessionsDir?: string;
	/** Environment for the review-agent launch. */
	env?: NodeJS.ProcessEnv;
}

/**
 * The slicer-review-loop SEAM: run ONE fresh-context review+edit pass of the
 * candidate slices and return a parsed verdict (incl. the edits to apply). Injected
 * by tests (a canned verdict+edits, no real model); production uses
 * {@link harnessSliceReviewGate}. Mirrors `do`'s `DoAgentRunner` / Gate-2's
 * `ReviewGate` injectable-seam shape so the loop wiring is testable as pure logic.
 */
export type SliceReviewGate = (
	input: SliceReviewGateInput,
) => Promise<SliceReviewVerdict>;

/** The terminal disposition of the loop — the three RESOLVED-DESIGN outcomes. */
export type LoopOutcome =
	/** A pass found no NEW blocking issue: the improved slices land claimable. */
	| 'converged'
	/** `maxReview` hit with blockers → specific uncertain slice(s) → needsAnswers. */
	| 'uncertain-slices'
	/** `maxReview` hit / decomposition unclear → route the PRD to needs-attention. */
	| 'decomposition-unclear';

/** The result of running the loop — the disposition the caller's sink routes. */
export interface RunSliceReviewLoopResult {
	/** Which of the three outcomes the loop reached. */
	outcome: LoopOutcome;
	/**
	 * The candidate slices as they stand AFTER all applied edits, keyed by
	 * repo-relative path → final content. The caller commits these (on
	 * `converged`/`uncertain-slices`) — on `decomposition-unclear` it emits NO
	 * slices, so this is informational only.
	 */
	slices: Record<string, string>;
	/**
	 * On `uncertain-slices`: the specific slices to emit `needsAnswers: true` with
	 * the questions recorded in their bodies. Empty otherwise.
	 */
	uncertainSlices: UncertainSlice[];
	/**
	 * On `decomposition-unclear`: the questions to record as the PRD's
	 * needs-attention reason (no guessed slices emitted). Empty otherwise.
	 */
	prdQuestions: string[];
	/** How many review passes ran in total across all M executions. */
	passes: number;
	/** How many fresh-context executions (M) ran. */
	executions: number;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

export interface RunSliceReviewLoopOptions {
	/** The PRD slug whose candidate slices are being improved. */
	slug: string;
	/** The working clone/checkout the loop runs in. */
	cwd: string;
	/** The review+edit gate seam (tests inject a canned verdict; production: harness). */
	gate: SliceReviewGate;
	/**
	 * The HARD CAP on in-context review passes (N) per fresh context. Reaching it
	 * with unresolved blockers REJECTS via the sink (never an infinite loop). The
	 * natural terminator (no new blocking issue) usually fires first.
	 */
	maxReview: number;
	/**
	 * How many fresh-context EXECUTIONS (M) to run — each a NEW launch of the same
	 * loop in a fresh context. Default 1 (the cheap degenerate case). `M>1` runs M
	 * independent fresh loops; the first that converges wins, else the last
	 * execution's blocking verdict is routed.
	 */
	executions?: number;
	/** The model the review agent runs on (de-correlation). */
	reviewModel?: string;
	/** The HOST-ONLY sessions root for the review session file. */
	sessionsDir?: string;
	/** Environment for child processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/**
 * Run the slicer review→edit→converge loop over the candidate slices currently on
 * disk under `work/backlog/`. Implements the loop ONCE; M (fresh-context
 * re-executions) is just invoking the inner loop again with a fresh launch.
 *
 * Within ONE execution (the N): run the gate (a review+edit pass), APPLY its edits
 * to the candidate slice files, then re-review — until `verdict === 'approve'` (no
 * NEW blocking issue → converged) or the pass count reaches `maxReview`. On the cap
 * with a still-`block` verdict, ROUTE per the verdict's channels:
 *   - `decompositionUnclear` set ⇒ `decomposition-unclear` (PRD → needs-attention,
 *     no guessed slices);
 *   - else `uncertainSlices` (or, as a floor, every candidate slice) ⇒
 *     `uncertain-slices` (those slices emitted `needsAnswers: true` + questions).
 *
 * With `executions > 1`, the WHOLE loop is re-run in a fresh context; the first
 * execution that converges short-circuits and lands, otherwise the LAST
 * execution's blocking routing is taken (a persistent block across M fresh
 * contexts is a strong signal).
 */
export async function runSliceReviewLoop(
	options: RunSliceReviewLoopOptions,
): Promise<RunSliceReviewLoopResult> {
	const note = options.note ?? (() => {});
	const executions = Math.max(1, options.executions ?? 1);
	const maxReview = Math.max(1, options.maxReview);

	let totalPasses = 0;
	let last: SingleExecutionResult | undefined;
	for (let m = 1; m <= executions; m++) {
		if (executions > 1) {
			note(`Slicer review loop — fresh context ${m}/${executions}.`);
		}
		const exec = await runOneExecution({
			slug: options.slug,
			cwd: options.cwd,
			gate: options.gate,
			maxReview,
			execution: m,
			reviewModel: options.reviewModel,
			sessionsDir: options.sessionsDir,
			env: options.env,
			note,
		});
		totalPasses += exec.passes;
		last = exec;
		if (exec.converged) {
			note(
				`Slicer review loop converged after ${exec.passes} pass(es)` +
					(executions > 1 ? ` in fresh context ${m}/${executions}` : '') +
					'; the improved slices land.',
			);
			return {
				outcome: 'converged',
				slices: readCandidates(options.cwd),
				uncertainSlices: [],
				prdQuestions: [],
				passes: totalPasses,
				executions: m,
				message:
					`Sliced '${options.slug}' — the review→edit loop converged ` +
					`(${totalPasses} pass(es), ${m} fresh context(s)); no new blocking ` +
					'issue. The improved slices land claimable.',
			};
		}
	}

	// Every execution hit `maxReview` with unresolved blockers — REJECT via the
	// sink. The LAST execution's verdict carries the routing channels.
	const verdict = last!.lastVerdict;
	if (verdict.decompositionUnclear) {
		const questions = verdict.decompositionUnclear.questions;
		note(
			`Slicer review loop did not converge within maxReview=${maxReview} ` +
				`across ${executions} fresh context(s); the whole decomposition is ` +
				'unclear — routing the PRD to needs-attention (no guessed slices).',
		);
		return {
			outcome: 'decomposition-unclear',
			slices: readCandidates(options.cwd),
			uncertainSlices: [],
			prdQuestions: questions,
			passes: totalPasses,
			executions,
			message:
				`The decomposition of '${options.slug}' is still unclear after ` +
				`maxReview=${maxReview} review pass(es) across ${executions} fresh ` +
				'context(s); routing the PRD to needs-attention with the open ' +
				'questions, emitting no guessed slices.',
		};
	}

	// A specific-slice rejection: emit the uncertain slice(s) `needsAnswers: true`.
	// Floor: if the agent named none but still blocks, treat ALL candidates as
	// uncertain (never land a slice the loop could not approve, never silently
	// drop the rejection).
	const uncertain =
		verdict.uncertainSlices && verdict.uncertainSlices.length > 0
			? verdict.uncertainSlices
			: readCandidatePaths(options.cwd).map((path) => ({
					path,
					questions: blockingQuestions(verdict),
				}));
	note(
		`Slicer review loop did not converge within maxReview=${maxReview} across ` +
			`${executions} fresh context(s); emitting ${uncertain.length} uncertain ` +
			'slice(s) with needsAnswers + questions.',
	);
	return {
		outcome: 'uncertain-slices',
		slices: readCandidates(options.cwd),
		uncertainSlices: uncertain,
		prdQuestions: [],
		passes: totalPasses,
		executions,
		message:
			`Slicing '${options.slug}' did not converge after maxReview=${maxReview} ` +
			`review pass(es) across ${executions} fresh context(s); ` +
			`${uncertain.length} slice(s) emitted needsAnswers: true with the open ` +
			'questions in their bodies (a human must answer before they are buildable).',
	};
}

/** The outcome of ONE fresh-context execution of the inner (N) loop. */
interface SingleExecutionResult {
	/** True iff a pass found no NEW blocking issue (the natural terminator). */
	converged: boolean;
	/** The last verdict seen (carries the routing channels on a non-converge). */
	lastVerdict: SliceReviewVerdict;
	/** How many review passes ran in this execution. */
	passes: number;
}

/** Run ONE fresh-context execution of the in-context (N) review→edit loop. */
async function runOneExecution(params: {
	slug: string;
	cwd: string;
	gate: SliceReviewGate;
	maxReview: number;
	execution: number;
	reviewModel?: string;
	sessionsDir?: string;
	env?: NodeJS.ProcessEnv;
	note: (message: string) => void;
}): Promise<SingleExecutionResult> {
	const {slug, cwd, gate, maxReview, execution, note} = params;
	let lastVerdict: SliceReviewVerdict = {verdict: 'block', findings: []};
	let passes = 0;
	for (let pass = 1; pass <= maxReview; pass++) {
		const candidateSlices = readCandidatePaths(cwd);
		const verdict = await gate({
			slug,
			cwd,
			candidateSlices,
			pass,
			execution,
			reviewModel: params.reviewModel,
			sessionsDir: params.sessionsDir,
			env: params.env,
		});
		passes = pass;
		lastVerdict = verdict;

		// APPLY the edits to the candidate slice files (the improver step) — the
		// runner writes the agent's full-content edits; the agent does no disk/git.
		if (verdict.edits && verdict.edits.length > 0) {
			applyEdits(cwd, verdict.edits, note);
		}

		if (verdict.verdict === 'approve') {
			return {converged: true, lastVerdict: verdict, passes};
		}
		note(
			`Slicer review pass ${pass}/${maxReview} (context ${execution}) found ` +
				`${blockingCount(verdict)} blocking issue(s); ` +
				`${verdict.edits?.length ?? 0} edit(s) applied — re-reviewing.`,
		);
	}
	return {converged: false, lastVerdict, passes};
}

/**
 * Apply the review agent's full-content edits to the candidate slice files. ONLY
 * paths under `work/backlog/` are written — the loop improves the CANDIDATE SLICES,
 * never escapes to other parts of the tree (a defensive scope fence; the runner,
 * not the agent, performs the write). An edit may CREATE a new candidate slice file
 * (e.g. the review split one slice into two) — that is in-scope.
 */
function applyEdits(
	cwd: string,
	edits: SliceEdit[],
	note: (message: string) => void,
): void {
	for (const edit of edits) {
		const normalized = edit.path.replace(/\\/g, '/');
		if (!normalized.startsWith('work/backlog/') || normalized.includes('..')) {
			note(
				`Skipped a review edit outside work/backlog/ (${edit.path}) — the ` +
					'loop only improves candidate slices.',
			);
			continue;
		}
		const abs = join(cwd, normalized);
		writeFileSync(abs, edit.content);
	}
}

/** Repo-relative paths of the candidate slices currently in `work/backlog/`. */
function readCandidatePaths(cwd: string): string[] {
	const dir = join(cwd, 'work', 'backlog');
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries
		.filter((name) => name.toLowerCase().endsWith('.md'))
		.sort()
		.map((name) => `work/backlog/${name}`);
}

/** The candidate slices keyed by repo-relative path → current content. */
function readCandidates(cwd: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rel of readCandidatePaths(cwd)) {
		out[rel] = readFileSync(join(cwd, rel), 'utf8');
	}
	return out;
}

/** Count blocking findings in a verdict. */
function blockingCount(verdict: SliceReviewVerdict): number {
	return verdict.findings.filter((f) => f.severity === 'blocking').length;
}

/** The blocking findings' questions (the floor questions for an unnamed rejection). */
function blockingQuestions(verdict: SliceReviewVerdict): string[] {
	const blocking = verdict.findings.filter((f) => f.severity === 'blocking');
	const source = blocking.length > 0 ? blocking : verdict.findings;
	return source.map((f) =>
		f.context ? `${f.question} (${f.context})` : f.question,
	);
}

// --- The production harness-backed gate ------------------------------------

/** What a harness-backed slice-review gate needs to launch the review agent. */
export interface HarnessSliceReviewGateOptions {
	/** The harness seam used to launch the fresh-context review+edit agent. */
	harness?: Harness;
	/** The agent command the null/shell adapter shells out to (`{model}`-aware). */
	agentCmd?: string;
	/**
	 * Read the review agent's textual output for parsing. Production reads
	 * `launched.output` (the harness seam's ANSWER channel, slice
	 * `harness-agent-output`); tests inject `readOutput` to stub a canned verdict
	 * string. Defaults to the launch's `output` verbatim.
	 */
	readOutput?: (output: string | undefined) => string;
}

/** Raised when the review agent ran but produced no parseable verdict. */
export class SliceReviewParseError extends Error {}

/**
 * The PRODUCTION slicer-review gate: launch the `review` SKILL as a fresh-context
 * agent through the EXISTING harness seam (a fresh context per pass = a fresh
 * launch, like the Gate-2 reviewer), routing the `reviewModel` override via
 * `LaunchInput.model` (the §13 model-routing intent — NOT a new mechanism), then
 * parse the emitted `{verdict, findings, edits, …}`.
 *
 * The agent makes the review/edit JUDGEMENTS (it runs the skill's lenses + the
 * destination check and proposes edits); this gate only launches it and parses its
 * verdict. The runner (the loop) applies the edits to disk and routes the verdict —
 * the agent does no git / no escaping disk writes.
 */
export function harnessSliceReviewGate(
	options: HarnessSliceReviewGateOptions = {},
): SliceReviewGate {
	const harness = options.harness ?? new NullHarness();
	const readOutput = options.readOutput ?? ((output) => output ?? '');
	return async (input: SliceReviewGateInput): Promise<SliceReviewVerdict> => {
		const launched = await launchWithOptionalWatch({
			harness,
			dir: input.cwd,
			slug: input.slug,
			command: options.agentCmd ?? '',
			prompt: buildSliceReviewPrompt(input),
			model: input.reviewModel,
			// A DISTINCT session id per pass + fresh context so launches never collide.
			sessionId: `slice-review-${input.slug}-m${input.execution}-n${input.pass}`,
			sessionsDir: input.sessionsDir,
			env: input.env,
		});
		if (!launched.ok) {
			throw new SliceReviewParseError(
				`slice review agent launch failed${
					launched.detail ? `: ${launched.detail}` : ''
				}`,
			);
		}
		return parseSliceReviewVerdict(readOutput(launched.output));
	};
}

/**
 * Render the slice-review-loop PROMPT: instruct a fresh-context agent to run the
 * `review` SKILL on the candidate slices for `slug` (the lenses IN ORDER, ENDING in
 * the destination/goal check — which may itself trigger edits), and to EMIT a
 * single JSON object carrying the verdict, the findings, the EDITS to apply, and
 * the routing channels (so {@link parseSliceReviewVerdict} can read it). The skill
 * carries the protocol; this prompt frames the artifact (a candidate decomposition)
 * + the required output shape (incl. the improver `edits` and the two non-converge
 * routing channels).
 */
export function buildSliceReviewPrompt(input: SliceReviewGateInput): string {
	const list = input.candidateSlices.map((p) => `  - ${p}`).join('\n');
	return [
		`You are a FRESH-CONTEXT reviewer in the SLICER review→edit→converge LOOP`,
		`(insertion point A). Run the \`review\` skill on the CANDIDATE SLICES just`,
		`produced for the PRD "${slugPrd(input.slug)}":`,
		list || '  (no candidate slices found)',
		``,
		`Read the source PRD (work/prd/${input.slug}.md) and review the candidate`,
		`decomposition ADVERSARIALLY. Apply the review skill's lenses IN ORDER,`,
		`ENDING in the DESTINATION CHECK ("if every slice is built exactly as`,
		`written, do we end up with the system the PRD describes?"). The destination`,
		`check is PART OF this pass and may ITSELF trigger edits — that is why this`,
		`is a loop, not a one-shot gate.`,
		``,
		`This is review pass ${input.pass} (fresh context ${input.execution}). You`,
		`do NOT edit files or run git yourself — you EMIT the edits to apply as FULL`,
		`replacement content and the runner applies them, then re-reviews. Slices`,
		`measurably keep improving when reviewed, so propose edits that fix the`,
		`findings; converge when a pass finds NO NEW blocking issue.`,
		``,
		`Output ONLY a single JSON object of this exact shape (no prose OUTSIDE it):`,
		`{"verdict": "approve" | "block",`,
		` "findings": [ {"severity": "blocking" | "non-blocking", "question": "…", "context": "…"} ],`,
		` "edits": [ {"path": "work/backlog/<slug>.md", "content": "<full new file content>"} ],`,
		` "uncertainSlices": [ {"path": "work/backlog/<slug>.md", "questions": ["…"]} ],`,
		` "decompositionUnclear": {"questions": ["…"]} }`,
		``,
		`Use "approve" with no blocking findings when the decomposition reaches the`,
		`PRD goal and no edit is needed (the natural terminator). Otherwise "block"`,
		`and supply "edits" that fix the findings. Only when you CANNOT fix it by`,
		`editing — a genuinely unresolved design decision — set "uncertainSlices"`,
		`(for a specific slice you cannot make buildable) and/or`,
		`"decompositionUnclear" (when the WHOLE decomposition is unsound). Flag, do`,
		`not guess: a flagged question costs one human glance; a guessed slice ships`,
		`wrong-but-compiling work. Omit "edits"/"uncertainSlices"/`,
		`"decompositionUnclear" when not applicable.`,
	].join('\n');
}

/** Helper for the prompt: the PRD reference (kept simple — the slug names the PRD). */
function slugPrd(slug: string): string {
	return slug;
}

/**
 * Parse the slice-review verdict out of the review agent's textual output. The
 * agent may wrap the JSON object in prose / a fenced block, so we extract the first
 * JSON object carrying a `verdict` field (brace-matched, string-aware) and validate
 * its shape. Throws {@link SliceReviewParseError} when no valid verdict is present
 * (the caller treats an unparseable verdict as an error → the rejection sink, never
 * a silent approve).
 */
export function parseSliceReviewVerdict(output: string): SliceReviewVerdict {
	const span = extractVerdictJsonSpan(output);
	if (span === undefined) {
		throw new SliceReviewParseError(
			'slice review agent produced no parseable {verdict, …} result',
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(output.slice(span.start, span.end));
	} catch (err) {
		throw new SliceReviewParseError(
			`slice review verdict was not valid JSON: ${(err as Error).message}`,
		);
	}
	return validateVerdict(parsed);
}

/** Validate + normalise a parsed object into a {@link SliceReviewVerdict}. */
function validateVerdict(parsed: unknown): SliceReviewVerdict {
	if (typeof parsed !== 'object' || parsed === null) {
		throw new SliceReviewParseError('slice review verdict was not an object');
	}
	const obj = parsed as Record<string, unknown>;
	const verdict = obj.verdict;
	if (verdict !== 'approve' && verdict !== 'block') {
		throw new SliceReviewParseError(
			`slice review verdict was not 'approve' or 'block' (got ${JSON.stringify(
				verdict,
			)})`,
		);
	}
	const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
	const findings: SliceReviewFinding[] = rawFindings.map((f) => {
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
	const uncertainSlices = parseUncertainSlices(obj.uncertainSlices);
	const decompositionUnclear = parseDecompositionUnclear(
		obj.decompositionUnclear,
	);
	return {
		verdict,
		findings,
		...(edits.length > 0 ? {edits} : {}),
		...(uncertainSlices.length > 0 ? {uncertainSlices} : {}),
		...(decompositionUnclear ? {decompositionUnclear} : {}),
	};
}

function parseEdits(raw: unknown): SliceEdit[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: SliceEdit[] = [];
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

function parseUncertainSlices(raw: unknown): UncertainSlice[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: UncertainSlice[] = [];
	for (const u of raw) {
		if (typeof u !== 'object' || u === null) {
			continue;
		}
		const item = u as Record<string, unknown>;
		if (typeof item.path !== 'string') {
			continue;
		}
		out.push({path: item.path, questions: stringList(item.questions)});
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
	return {questions: stringList(item.questions)};
}

function stringList(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter((q): q is string => typeof q === 'string');
}

/**
 * Locate the first JSON object that carries a `"verdict"` key in arbitrary agent
 * output (it may be fenced, prefixed with prose, or bare), returning its `[start,
 * end)` span. Brace-matched from the `"verdict"` occurrence outward, string-aware,
 * so a surrounding fence/prose does not defeat parsing. Returns `undefined` when
 * none is found. (Mirrors the Gate-2 extractor in `review-gate.ts`.)
 */
function extractVerdictJsonSpan(
	output: string,
): {start: number; end: number} | undefined {
	const key = output.indexOf('"verdict"');
	if (key === -1) {
		return undefined;
	}
	let start = key;
	while (start >= 0 && output[start] !== '{') {
		start--;
	}
	if (start < 0) {
		return undefined;
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < output.length; i++) {
		const ch = output[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === '\\') {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				return {start, end: i + 1};
			}
		}
	}
	return undefined;
}
