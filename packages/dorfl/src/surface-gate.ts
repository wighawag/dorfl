import {NullHarness, type Harness} from './harness.js';
import {launchWithOptionalWatch} from './agent-launch.js';
import {boundaryLine} from './watch-session.js';
import {extractJsonObjectSpan} from './verdict-json.js';
import type {NewQuestion, SidecarDisposition} from './sidecar.js';

/**
 * The **SURFACE gate** (prd `advance-loop`, task `advance-rung-surface`,
 * US #32/33) — the surface-question rung's fresh-context spawn, the DIRECT mirror
 * of the PR/code review gate ({@link import('./review-gate.js')}). On
 * `classify=surface`, the advance engine spawns a FRESH-CONTEXT agent with the
 * `surface-questions` SKILL loaded (`skills/surface-questions/SKILL.md`); the
 * skill GATHERS the item's open-judgement residue and EMITS questions and writes
 * NOTHING (doc-shaped, like `review`). The ENGINE then ITSELF persists them to
 * the sidecar CAS-atomically + sets `needsAnswers:true` (task
 * `advance-rung-surface`'s persist half) — **the skill JUDGES, the engine
 * PERSISTS.**
 *
 * This module is the SEAM (the {@link SurfaceGate} function type) + its
 * production harness-backed implementation ({@link harnessSurfaceGate}), exactly
 * as `review-gate.ts` is the seam + `harnessReviewGate`. The seam is injectable:
 * tests stub a canned emitted-questions list (no real model); production launches
 * the `surface-questions` agent through the EXISTING harness seam
 * ({@link Harness}/`LaunchInput`), routing an optional `surfaceModel` override
 * through `LaunchInput.model` — NOT a new model/launch mechanism (the §13
 * model-routing intent). It mirrors `harnessReviewGate` byte-for-byte in shape;
 * only the PROMPT ({@link buildSurfacePrompt}) and the parsed payload
 * ({@link parseSurfaceEmit}, a `{questions}` list rather than a `{verdict}`)
 * differ.
 *
 * ALWAYS-allowed: there is NO gate check before surfacing — surfacing a question
 * is never gated, even with every autonomy flag off (the "question loop with zero
 * autonomy" case, US #23). The expensive (agent/model) work is POST-lock,
 * winner-only — but that sequencing is the ENGINE's job (`advance.ts`); this
 * module is only the spawn→emit→parse.
 */

/**
 * One question the `surface-questions` skill EMITS — the FOUR authoring fields of
 * the sidecar entry shape (`skills/surface-questions/SKILL.md` → "The emitted
 * question shape"). It maps 1:1 onto {@link NewQuestion} (what the engine appends
 * to the sidecar), so the engine persists with ZERO translation. The skill does
 * NOT assign `id`/`answered`/`answer`/`allAnswered` — those are the sidecar's
 * machine-owned fields the engine owns.
 */
export interface SurfaceQuestion {
	/** The question, verbatim. */
	question: string;
	/** Inline context so the human need not open the item. */
	context?: string;
	/** Optional suggested default (the humility aid; NEVER a decision). */
	default?: string;
	/** Optional triage/terminal routing — ONLY on a triage question. */
	disposition?: SidecarDisposition;
}

/**
 * What the `surface-questions` SKILL emits (and this gate parses): the item's
 * identity (orientation only) + an ORDERED list of questions. An EMPTY list is a
 * valid, honest result ("no open judgement") — the engine writes no sidecar.
 */
export interface SurfaceEmit {
	/** The namespaced identity the skill surfaced for (orientation; advisory). */
	item?: string;
	/** The ordered emitted questions (possibly empty). */
	questions: SurfaceQuestion[];
}

/** What the surface gate needs to launch a fresh-context surface of one item. */
export interface SurfaceGateInput {
	/** The namespaced identity the surface is for (`task:foo` / `prd:bar` / `observation:baz`). */
	item: string;
	/** The working clone/checkout the gate runs in. */
	cwd: string;
	/**
	 * The model the SURFACE agent runs on. `undefined` ⇒ no forced model (the
	 * harness's own default). Flows to the launch through `LaunchInput.model`.
	 */
	surfaceModel?: string;
	/** Environment for the surface-agent launch. */
	env?: NodeJS.ProcessEnv;
	/** `--watch`: tail the surface agent's pi session live (pure observer). */
	watch?: boolean;
	/** Where the tailed surface lines are written (defaults to stderr). */
	watchSink?: (line: string) => void;
	/** Emit ANSI colour in the tailed surface lines (the caller's TTY decision). */
	color?: boolean;
	/** The HOST-ONLY sessions root the surface session FILE is generated under. */
	sessionsDir?: string;
}

/**
 * The surface-gate SEAM: run a fresh-context surface of the item and return the
 * parsed emitted questions. Injected by tests (a canned list, no real model);
 * production uses {@link harnessSurfaceGate}. Mirrors `review-gate.ts`'s
 * `ReviewGate` seam shape so the engine wiring is testable as pure logic.
 */
export type SurfaceGate = (input: SurfaceGateInput) => Promise<SurfaceEmit>;

/** Raised when the surface agent ran but produced no parseable emit. */
export class SurfaceParseError extends Error {}

/**
 * Parse the `surface-questions` SKILL's emitted questions out of the surface
 * agent's textual output. The skill emits a `{item, questions:[…]}` JSON object
 * (the agent may wrap it in prose / a fenced block), so we extract the first JSON
 * object carrying a `questions` field and validate its shape. An EMPTY
 * `questions` list is VALID (the honest "no open judgement" result). Throws
 * {@link SurfaceParseError} when no valid emit is present (the caller treats an
 * unparseable emit as an error — never a silent "surfaced nothing").
 */
export function parseSurfaceEmit(output: string): SurfaceEmit {
	const span = extractJsonObjectSpan(output, 'questions');
	if (span === undefined) {
		throw new SurfaceParseError(
			'surface agent produced no parseable {questions} result',
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(output.slice(span.start, span.end));
	} catch (err) {
		throw new SurfaceParseError(
			`surface emit was not valid JSON: ${(err as Error).message}`,
		);
	}
	return validateEmit(parsed);
}

const DISPOSITIONS: ReadonlySet<string> = new Set<SidecarDisposition>([
	'promote-task',
	'promote-adr',
	'keep',
	'delete',
	'dropped',
	'needs-attention',
]);

/** Validate a parsed object is a `{item?, questions:[…]}` shape; normalise it. */
function validateEmit(parsed: unknown): SurfaceEmit {
	if (typeof parsed !== 'object' || parsed === null) {
		throw new SurfaceParseError('surface emit was not an object');
	}
	const obj = parsed as Record<string, unknown>;
	if (!Array.isArray(obj.questions)) {
		throw new SurfaceParseError(
			'surface emit had no `questions` array (an empty array is valid; absence is not)',
		);
	}
	const questions: SurfaceQuestion[] = obj.questions.map((q) => {
		const item = (typeof q === 'object' && q !== null ? q : {}) as Record<
			string,
			unknown
		>;
		const question: SurfaceQuestion = {
			question: typeof item.question === 'string' ? item.question : '',
		};
		if (typeof item.context === 'string' && item.context !== '') {
			question.context = item.context;
		}
		if (typeof item.default === 'string' && item.default !== '') {
			question.default = item.default;
		}
		if (
			typeof item.disposition === 'string' &&
			DISPOSITIONS.has(item.disposition)
		) {
			question.disposition = item.disposition as SidecarDisposition;
		}
		return question;
	});
	return {
		...(typeof obj.item === 'string' ? {item: obj.item} : {}),
		// A question with an EMPTY `question` string carries no judgement — drop it
		// (the agent may have emitted a placeholder), so an all-empty list is the
		// same honest "no open judgement" as an empty array.
		questions: questions.filter((q) => q.question.trim() !== ''),
	};
}

/**
 * Convert the emitted questions to the {@link NewQuestion} shape the engine
 * appends to the sidecar — a 1:1 field map (the emit shape IS the sidecar
 * authoring shape, by design), so the engine persists with ZERO translation.
 */
export function toNewQuestions(emit: SurfaceEmit): NewQuestion[] {
	return emit.questions.map((q) => {
		const nq: NewQuestion = {question: q.question};
		if (q.context !== undefined) {
			nq.context = q.context;
		}
		if (q.default !== undefined) {
			nq.default = q.default;
		}
		if (q.disposition !== undefined) {
			nq.disposition = q.disposition;
		}
		return nq;
	});
}

/**
 * Render the surface-agent PROMPT: instruct a fresh-context agent to apply the
 * **surface-questions discipline** (`work/protocol/SURFACE-PROTOCOL.md`) to ONE
 * `work/` item and to EMIT a single `{item, questions}` JSON object (so
 * {@link parseSurfaceEmit} can read it). The discipline body (the two laws —
 * GATHER-only / PERSIST-NEVER — the humility rule, the composed sources, the
 * emitted-question shape) lives in `SURFACE-PROTOCOL.md` — NOT inlined here
 * (task `surface-protocol-doc-and-prompt`). The shape's source of truth is
 * {@link parseSurfaceEmit}; the doc DESCRIBES it (D2).
 *
 * This builder owns ONLY the PER-BUILDER framing: who you are (a fresh-context
 * question-surfacer, the engine's surface-question rung), what you are
 * surfacing (ONE namespaced item), and the required JSON output shape. It
 * MIRRORS {@link buildReviewPrompt}: a fresh-context agent that EDITS nothing
 * and EMITS a single structured object the ENGINE routes/persists.
 */
export function buildSurfacePrompt(item: string): string {
	return [
		`You are a FRESH-CONTEXT question-surfacer for the work/ item "${item}".`,
		`Apply the surface-questions discipline defined in`,
		`\`work/protocol/SURFACE-PROTOCOL.md\` (the in-band, protocol-native`,
		`surface-questions protocol every set-up repo carries; the human-facing`,
		`pointer is \`skills/surface-questions/SKILL.md\`) to this ONE item:`,
		`formulate its open questions and EMIT them. Its two laws, its humility`,
		`aid, the composed sources you draw from, and the emitted-question shape`,
		`ALL live in that doc — read them there.`,
		`The skill JUDGES; the engine PERSISTS.`,
		``,
		`Do NOT edit any files, run no git — you EMIT questions only.`,
		``,
		`Output ONLY a single JSON object of this exact shape (no prose OUTSIDE it;`,
		`see \`SURFACE-PROTOCOL.md\` → "The emitted question shape" for the`,
		`prose-described contract this mirrors):`,
		`{"item": "${item}",`,
		` "questions": [`,
		`   {"question": "…",`,
		`    "context": "…",`,
		`    "default": "… (optional; omit if none)",`,
		`    "disposition": "promote-task|promote-adr|keep|delete|dropped|needs-attention (ONLY on a triage question; omit otherwise)"}`,
		` ]}`,
		`An EMPTY \`questions\` array is a VALID, honest result (no open judgement);`,
		`absence of the field is NOT. It is plain text inside the JSON string`,
		`(escape newlines as \\n).`,
	].join('\n');
}

/** What a harness-backed surface gate needs to launch the surface agent. */
export interface HarnessSurfaceGateOptions {
	/** The harness seam used to launch the fresh-context surface agent. */
	harness?: Harness;
	/** The agent command the null/shell adapter shells out to (`{model}`-aware). */
	agentCmd?: string;
	/**
	 * Read the surface agent's textual output for parsing. Production reads
	 * `launched.output` (the ANSWER channel, distinct from `detail`); tests inject
	 * `readOutput` to stub a canned emit string.
	 */
	readOutput?: (output: string | undefined) => string;
}

/**
 * The PRODUCTION surface gate: launch the `surface-questions` SKILL as a
 * fresh-context agent through the EXISTING harness seam, routing the
 * `surfaceModel` override via `LaunchInput.model` (the §13 model-routing intent —
 * NOT a new mechanism), then parse the emitted `{item, questions}`. It is the
 * DIRECT mirror of `harnessReviewGate`: a SEPARATE harness launch (fresh context
 * = not the engine's session) in the same checkout `cwd`, fed
 * {@link buildSurfacePrompt}; the model flows through `LaunchInput.model`, which
 * each adapter injects natively. The surface uses a DISTINCT session id
 * (`<item>-surface`) so its session never collides with a build/review session.
 */
export function harnessSurfaceGate(
	options: HarnessSurfaceGateOptions = {},
): SurfaceGate {
	const harness = options.harness ?? new NullHarness();
	const readOutput = options.readOutput ?? ((output) => output ?? '');
	return async (input: SurfaceGateInput): Promise<SurfaceEmit> => {
		if (input.watch === true) {
			const sink =
				input.watchSink ??
				((line: string) => process.stderr.write(`${line}\n`));
			sink(
				boundaryLine(
					`surface — gathering questions for ${input.item}…`,
					input.color ?? false,
				),
			);
		}
		// A safe session-id stem (the namespaced identity has a `:` that is not a
		// valid path stem). The same `:`→`-` convention the sidecar/lock identity uses.
		const sessionId = `${input.item.replace(/:/g, '-')}-surface`;
		const launched = await launchWithOptionalWatch({
			harness,
			dir: input.cwd,
			slug: input.item,
			command: options.agentCmd ?? '',
			prompt: buildSurfacePrompt(input.item),
			model: input.surfaceModel,
			sessionId,
			sessionsDir: input.sessionsDir,
			watch: input.watch,
			watchSink: input.watchSink,
			color: input.color,
			env: input.env,
		});
		if (!launched.ok) {
			throw new SurfaceParseError(
				`surface agent launch failed${launched.detail ? `: ${launched.detail}` : ''}`,
			);
		}
		// Read the emit from the agent's ANSWER channel (`output`), NOT `detail`
		// (empty on success). An empty/absent output → parseSurfaceEmit throws → the
		// engine surfaces nothing and reports it (never a silent success).
		return parseSurfaceEmit(readOutput(launched.output));
	};
}
