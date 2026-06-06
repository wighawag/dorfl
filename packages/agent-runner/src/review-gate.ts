import {NullHarness, substituteModel, type Harness} from './harness.js';

/**
 * **Gate 2 — the PR/code review gate** (GATES PRD `work/prd/review.md`), the
 * JUDGEMENT layer that rides ON TOP of the deterministic `verify` floor (ADR §8).
 *
 * After the green `verify` and BEFORE the done-move, `complete`/`do` invoke the
 * `review` SKILL (`skills/review/SKILL.md`) as a **fresh-context** agent — its
 * OWN harness launch, never the builder's session — to read the diff against the
 * slice it claims and EMIT a verdict. The verdict is then ROUTED by the caller
 * (`complete.ts`): `approve` → done-move/commit/integrate; `block` → the SAME
 * `needs-attention` machinery the red gate uses (never a merge).
 *
 * This module is the SEAM (the {@link ReviewGate} function type) + its
 * production harness-backed implementation ({@link harnessReviewGate}). The seam
 * is injectable exactly like `do`'s `agentRunner`: tests stub a canned
 * `approve`/`block` verdict (no real model); production launches the review agent
 * through the EXISTING harness seam ({@link Harness}/`LaunchInput`), routing the
 * `reviewModel` override through `LaunchInput.model` / {@link substituteModel} —
 * NOT a new model/launch mechanism (the §13 model-routing intent).
 *
 * Determinism boundary (ADR §8), explicit: review is a JUDGEMENT gate, never a
 * replacement for `verify`. `verify` stays the non-skippable model-free floor;
 * review runs ON TOP, only when `reviewPr` resolves on.
 */

/** A single review finding, mirroring the `review` SKILL's verdict shape. */
export interface ReviewFinding {
	/** Whether this finding blocks (keeps the work out of "ready") or is a nit. */
	severity: 'blocking' | 'non-blocking';
	/** The question / defect, with enough context to act. */
	question: string;
	/** The relevant excerpt, `file:line`, or reasoning. */
	context?: string;
}

/**
 * The verdict the `review` SKILL emits (and this gate parses): `approve` lets the
 * work proceed to integrate; `block` routes it to needs-attention. The skill
 * EMITS the verdict; the caller (the gate) routes it — see `skills/review/SKILL.md`
 * → "Your output".
 */
export interface ReviewVerdict {
	verdict: 'approve' | 'block';
	findings: ReviewFinding[];
}

/** What the review gate needs to launch a fresh-context review of one slice. */
export interface ReviewGateInput {
	/** The slug under review (the slice the diff claims to deliver). */
	slug: string;
	/** The working clone/checkout the gate runs in (the prepared work branch). */
	cwd: string;
	/**
	 * The model the REVIEW agent runs on (`reviewModel`, de-correlated from the
	 * builder). `undefined` ⇒ no forced model (the harness's own default). Flows
	 * to the launch through `LaunchInput.model` / {@link substituteModel}.
	 */
	reviewModel?: string;
	/** Which review ROUND this is (1-based), for the revise↔review loop bound. */
	round: number;
	/** Environment for the review-agent launch. */
	env?: NodeJS.ProcessEnv;
}

/**
 * The review-gate SEAM: run a fresh-context review of the slug's diff and return
 * a parsed verdict. Injected by tests (a canned verdict, no real model);
 * production uses {@link harnessReviewGate}. Mirrors `do`'s `DoAgentRunner`
 * injectable-seam shape so the gate wiring is testable as pure logic.
 */
export type ReviewGate = (input: ReviewGateInput) => Promise<ReviewVerdict>;

/** Raised when the review agent ran but produced no parseable verdict. */
export class ReviewParseError extends Error {}

/**
 * Parse the `review` SKILL's emitted verdict out of the review agent's textual
 * output. The skill emits `{verdict, findings[…]}` (see its "Your output"); the
 * agent may wrap it in prose / a fenced block, so we extract the first JSON
 * object carrying a `verdict` field and validate its shape. Throws
 * {@link ReviewParseError} when no valid verdict is present (the caller treats an
 * unparseable verdict as an error → needs-attention, never a silent approve).
 */
export function parseReviewVerdict(output: string): ReviewVerdict {
	const candidate = extractVerdictJson(output);
	if (candidate === undefined) {
		throw new ReviewParseError(
			'review agent produced no parseable {verdict, findings} result',
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch (err) {
		throw new ReviewParseError(
			`review verdict was not valid JSON: ${(err as Error).message}`,
		);
	}
	return validateVerdict(parsed);
}

/** Validate a parsed object is a `{verdict, findings}` shape; normalise it. */
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
	return {verdict, findings};
}

/**
 * Extract the first JSON object that carries a `"verdict"` key from arbitrary
 * agent output (it may be fenced, prefixed with prose, or bare). Brace-matched
 * from the `"verdict"` occurrence outward so a surrounding fence/prose does not
 * defeat parsing. Returns `undefined` when none is found.
 */
function extractVerdictJson(output: string): string | undefined {
	const key = output.indexOf('"verdict"');
	if (key === -1) {
		return undefined;
	}
	// Walk back to the opening brace of the object containing the key.
	let start = key;
	while (start >= 0 && output[start] !== '{') {
		start--;
	}
	if (start < 0) {
		return undefined;
	}
	// Brace-match forward from that opening brace, respecting strings.
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
				return output.slice(start, i + 1);
			}
		}
	}
	return undefined;
}

/**
 * Render the review-agent PROMPT: instruct a fresh-context agent to run the
 * `review` SKILL on the diff for `slug` against the slice that specified it, and
 * to EMIT ONLY the `{verdict, findings[…]}` result (so {@link parseReviewVerdict}
 * can read it). The skill itself carries the lenses + the destination check; this
 * prompt only frames the artifact (code-vs-its-slice) and the required output.
 */
export function buildReviewPrompt(slug: string): string {
	return [
		`You are a FRESH-CONTEXT reviewer (Gate 2 — PR/code review). Run the`,
		`\`review\` skill on the work for slice "${slug}": review the code changes`,
		`on this work branch AGAINST the slice that specified it`,
		`(work/in-progress/${slug}.md or work/done/${slug}.md) and its source PRD.`,
		``,
		`Apply the review skill's lenses IN ORDER, ending in the destination check`,
		`("if merged exactly as written, do we reach the slice/PRD goal?"). You are`,
		`ADVERSARIAL and verify against what ACTUALLY LANDED (the diff), not intent.`,
		`Do NOT edit any files, run no git — you EMIT a verdict only.`,
		``,
		`Output ONLY a single JSON object of this exact shape (no other prose):`,
		`{"verdict": "approve" | "block", "findings": [`,
		`  {"severity": "blocking" | "non-blocking", "question": "…", "context": "…"}`,
		`]}`,
		`Use "block" with at least one blocking finding if the diff does not deliver`,
		`the slice, drifts from its premise, or hides a defect a human reviewer would`,
		`flag; otherwise "approve".`,
	].join('\n');
}

/** What a harness-backed review gate needs to launch the review agent. */
export interface HarnessReviewGateOptions {
	/** The harness seam used to launch the fresh-context review agent. */
	harness?: Harness;
	/** The agent command the null/shell adapter shells out to (`{model}`-aware). */
	agentCmd?: string;
	/**
	 * Capture the review agent's textual output for parsing. The harness `launch`
	 * returns only `{ok, record, detail}`, so the production wiring reads the
	 * agent's emitted verdict from `detail` (or a harness-specific capture). For
	 * the seam's contract we accept an optional reader injected by the caller; when
	 * absent we fall back to the launch `detail`.
	 */
	readOutput?: (detail: string | undefined) => string;
}

/**
 * The PRODUCTION review gate: launch the `review` SKILL as a fresh-context agent
 * through the EXISTING harness seam, routing the `reviewModel` override via
 * `LaunchInput.model` (the §13 model-routing intent — NOT a new mechanism), then
 * parse the emitted `{verdict, findings}`.
 *
 * It is a SEPARATE harness launch (fresh context = not the builder's session) in
 * the same checkout `cwd` (the prepared, gated work branch). The launch is fed
 * {@link buildReviewPrompt}; the model flows through `LaunchInput.model`, which
 * each adapter injects natively (pi: `--model`; null/shell: the `{model}`
 * placeholder via {@link substituteModel}). auth/keys stay the harness's job.
 */
export function harnessReviewGate(
	options: HarnessReviewGateOptions = {},
): ReviewGate {
	const harness = options.harness ?? new NullHarness();
	const readOutput = options.readOutput ?? ((detail) => detail ?? '');
	return async (input: ReviewGateInput): Promise<ReviewVerdict> => {
		const launched = harness.launch({
			dir: input.cwd,
			slug: input.slug,
			command: options.agentCmd ?? '',
			prompt: buildReviewPrompt(input.slug),
			// The reviewModel override rides the EXISTING model-routing seam.
			model: input.reviewModel,
			env: input.env,
		});
		if (!launched.ok) {
			throw new ReviewParseError(
				`review agent launch failed${launched.detail ? `: ${launched.detail}` : ''}`,
			);
		}
		return parseReviewVerdict(readOutput(launched.detail));
	};
}

/**
 * Format a review's BLOCKING findings into a needs-attention reason string —
 * recorded in the item body when the gate routes a `block` (the SAME body-prose
 * mechanism the red gate's reason uses; WORK-CONTRACT rule 3). Non-blocking
 * findings are omitted from the reason (they do not block). On exhaustion of
 * `reviewMaxRounds`, {@link reviewRoundsExhaustedReason} is used instead.
 */
export function formatBlockReason(verdict: ReviewVerdict): string {
	const blocking = verdict.findings.filter((f) => f.severity === 'blocking');
	const lines = (blocking.length > 0 ? blocking : verdict.findings).map((f) => {
		const ctx = f.context ? ` (${f.context})` : '';
		return `- ${f.question}${ctx}`;
	});
	const head = 'PR/code review (Gate 2) blocked this work:';
	return lines.length > 0 ? `${head}\n${lines.join('\n')}` : head;
}

/** The needs-attention reason when the revise↔review loop hits `reviewMaxRounds`. */
export function reviewRoundsExhaustedReason(maxRounds: number): string {
	return (
		`PR/code review (Gate 2) did not reach an approve verdict within ` +
		`reviewMaxRounds=${maxRounds} round(s); forcing needs-attention (never ` +
		`silently merged or looped).`
	);
}
