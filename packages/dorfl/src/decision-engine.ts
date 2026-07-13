import {extractJsonObjectSpan} from './verdict-json.js';

/**
 * **The SHARED decision engine** (spec
 * `agentic-question-resolution-retire-disposition-vocabulary` US #9, decision 3 +
 * 13/14; task `decision-engine-shared-decide-seam`): the GENERALISED
 * `decide(input, allowedOutcomes) → verdict` core every question-resolution
 * decision is built on. It is the same `prompt → VERDICT → dispatch` shape
 * `intake` already has, lifted into ONE outcome-AGNOSTIC engine so intake and the
 * advance-apply rung share the machinery WITHOUT being forced to identical
 * verdicts or inputs.
 *
 * Two things are parameters, NOT hard-coded into the engine:
 *
 * - **the INPUT-ADAPTER** ({@link DecisionDecider}'s `TInput`): each caller's
 *   front door reads a DIFFERENT thing (intake reads an issue + its comment
 *   thread; advance-apply reads an answered sidecar + its source item). The engine
 *   never knows that shape — it threads the caller's `input` opaquely to the
 *   injected decider, so the adapter boundary sits OUTSIDE the engine (decision 3:
 *   "the INPUT adapter differs per front door and is NOT forced to be shared").
 * - **the ALLOWED-OUTCOME SET** ({@link decide}'s `allowedOutcomes`): each caller
 *   passes the SUBSET of {@link DecisionOutcome} it permits — advance-apply allows
 *   `{task | spec | adr | dispose | ask}`, intake keeps its own `{task | spec | ask |
 *   bounce}` (intake is NOT refactored onto this engine here — decision 13). The
 *   engine never hard-codes which outcomes a caller permits; it only VALIDATES the
 *   returned verdict against the set and rejects (loudly) one outside it
 *   (decision 14: "the engine stays outcome-AGNOSTIC", so `adr` can be added to a
 *   caller later WITHOUT re-architecting).
 *
 * This module is the PURE engine + its types ONLY — no fs, no git, no seam ops, no
 * wiring into `sidecar.ts` / `apply-persist.ts` / `intake.ts`. The keystone apply
 * task (`agentic-apply-retire-disposition-vocabulary`) consumes it next; intake
 * adopting `adr` is a separate decision (the engine being agnostic means it CAN
 * be added later).
 */

/**
 * The SUPERSET of outcomes the engine knows — a "verdict" is what an agent
 * decides to DO with an input (the analogue of intake's {@link IntakeOutcome}):
 *
 * - **task** — mint a self-contained task from the input.
 * - **spec** — mint a spec from the input.
 * - **adr** — mint an adr from the input (NO caller wires this yet; the keystone's
 *   allowed set will, and `agentic-apply-mint-adr-route` adds the route — decision
 *   14 keeps the engine agnostic so this is added without re-architecting).
 * - **dispose** — DISPOSE the SOURCE the input is about, POLYMORPHIC on the
 *   source's regime (spec `surface-stuck-as-questions-and-retire-stuck-lock-state`
 *   resolved decision #5; task
 *   `apply-disposition-delete-to-dispose-regime-polymorphic`): an OBSERVATION is
 *   `git rm`-ed (notes leave by deletion, decision 12); a TASK is `git mv`-ed to
 *   its regime's won't-proceed terminal `tasks/cancelled/` (RETAINED — a task
 *   cannot be hard-deleted by the apply rung, only disposed to its terminal); a
 *   SPEC is `git mv`-ed to `specs/dropped/` (RETAINED). Making the token
 *   polymorphic (rather than adding a second `cancel` beside a literal `delete`)
 *   makes "a task cannot be deleted, only disposed to its terminal" true BY
 *   CONSTRUCTION.
 * - **resolve** — the answer SETTLES the item with NO artifact to mint and the
 *   note RETAINED: route to the apply persist's resolve-fully path (harvest the
 *   answers into the body, clear `needsAnswers`, delete the sidecar) so the
 *   already-answered question stops re-surfacing. The SIBLING of `dispose` (both
 *   end the question-loop minting nothing), but `resolve` KEEPS the note whereas
 *   `dispose` drops-or-terminals it (task `apply-decide-resolve-verdict-mint-nothing`).
 * - **ask** — ask the operator a follow-up (re-pause; the conversation
 *   accumulates — decision 5).
 *
 * No caller is forced to allow ALL of these: each passes its own SUBSET to
 * {@link decide}. The engine is agnostic to which subset a caller permits.
 */
// MIGRATE step (spec `prd-to-spec-vocabulary-cutover-and-migration-command`): the
// parent-spec verdict outcome is `'spec'` (renamed from ''prd''); the decider
// prompt emits it and the parser accepts it. This is a fresh per-call LLM verdict
// (nothing ''prd''-valued is persisted), so the rename needs no on-disk alias.
export type DecisionOutcome =
	| 'task'
	| 'spec'
	| 'adr'
	| 'dispose'
	| 'resolve'
	| 'ask';

/**
 * The VERDICT the decider returns — the chosen {@link DecisionOutcome} plus the
 * DRAFTED content for that outcome (the analogue of {@link IntakeVerdict}). Every
 * content field is OPTIONAL on the shape: a given verdict only fills the channels
 * its outcome consumes (a `task` fills the task channels, an `ask` fills
 * `question`, a `dispose` may carry only a `reason`). The dispatching CALLER
 * decides which channels it requires for each outcome it allows — the engine only
 * guards the `outcome` discriminator against the allowed set, never the content
 * (it stays outcome-agnostic).
 */
export interface DecisionVerdict {
	/** Which outcome the decider chose for the input. */
	outcome: DecisionOutcome;
	/** The drafted task's content-derived slug (`task` outcome). */
	taskSlug?: string;
	/** The drafted task's `title:` (`task` outcome). */
	taskTitle?: string;
	/**
	 * The drafted task BODY (`task` outcome) — the markdown AFTER the frontmatter.
	 * The dispatching caller writes the frontmatter; the agent never writes
	 * git-visible files (the in-band boundary intake already follows).
	 */
	taskBody?: string;
	/** The drafted spec's content-derived slug (`spec` outcome). */
	specSlug?: string;
	/** The drafted spec's `title:` (`spec` outcome). */
	specTitle?: string;
	/** The drafted spec BODY (`spec` outcome) — the markdown AFTER the frontmatter. */
	specBody?: string;
	/** The drafted adr's content-derived slug (`adr` outcome). */
	adrSlug?: string;
	/** The drafted adr's `title:` (`adr` outcome). */
	adrTitle?: string;
	/** The drafted adr BODY (`adr` outcome) — the markdown AFTER the frontmatter. */
	adrBody?: string;
	/**
	 * The reason the source should be DISPOSED (`dispose` outcome) — carried by
	 * the caller into the regime-polymorphic disposal: an OBSERVATION's reason
	 * rides the revertible git-rm commit message (decision 12: notes leave by
	 * deletion, git history = archive); a TASK/SPEC's reason is written into the
	 * moved item's `reason:` frontmatter so the durable body records why the
	 * item won't proceed (the file is RETAINED at the regime's terminal —
	 * `tasks/cancelled/` or `specs/dropped/`).
	 */
	disposeReason?: string;
	/**
	 * Why the item is settled with NOTHING to mint (`resolve` outcome) — the
	 * SIBLING of {@link disposeReason}, but the note is RETAINED (the apply rung
	 * routes this to the resolve-fully path, which harvests the answers into the
	 * body rather than deleting the note). The reason is advisory context for the
	 * human/reviewer; the durable disposition record is the `## Applied answers`
	 * block the resolve-fully path writes.
	 */
	resolveReason?: string;
	/**
	 * The drafted follow-up question(s) (`ask` outcome) — the caller appends them
	 * to the conversation and re-pauses (decision 5: reuse the existing
	 * append/re-pause loop).
	 */
	question?: string;
}

/**
 * The DECISION step: given the caller's `input` (whatever its input-adapter
 * shaped), return a {@link DecisionVerdict}. This is the INJECTED, STUBBABLE seam
 * — exactly like intake's `IntakeDecider`: production wires a harness/agent; tests
 * inject a CANNED verdict (no model, no network). The engine is generic over
 * `TInput` so the adapter boundary sits in the CALLER, never in the engine.
 */
export type DecisionDecider<TInput> = (
	input: TInput,
) => Promise<DecisionVerdict>;

/**
 * Thrown when a returned verdict's `outcome` is OUTSIDE the caller's
 * `allowedOutcomes`. The engine NEVER silently coerces an out-of-set verdict — a
 * caller that does not allow `adr` can never receive an `adr` verdict; it gets
 * this loud rejection instead (the allowed-outcome guard).
 */
export class DisallowedOutcomeError extends Error {
	/** The outcome the decider returned that was not permitted. */
	readonly outcome: DecisionOutcome;
	/** The set the caller allowed (the SUBSET it passed to {@link decide}). */
	readonly allowed: readonly DecisionOutcome[];
	constructor(outcome: DecisionOutcome, allowed: readonly DecisionOutcome[]) {
		super(
			`decision verdict 'outcome' ${JSON.stringify(outcome)} is not in the ` +
				`caller's allowed set {${allowed.join(' | ')}}; the engine rejects an ` +
				`out-of-set verdict rather than coercing it.`,
		);
		this.name = 'DisallowedOutcomeError';
		this.outcome = outcome;
		this.allowed = allowed;
	}
}

/**
 * Thrown when `allowedOutcomes` itself is EMPTY — a caller that allows no outcome
 * can never receive a valid verdict, so this is a programming error caught up
 * front rather than surfaced as a confusing per-verdict rejection.
 */
export class EmptyAllowedOutcomesError extends Error {
	constructor() {
		super(
			'decide() was called with an EMPTY allowedOutcomes set; a caller must ' +
				'allow at least one outcome.',
		);
		this.name = 'EmptyAllowedOutcomesError';
	}
}

/**
 * **The engine core.** Run the injected `decide`r over the caller's `input`, then
 * VALIDATE the returned verdict's `outcome` against `allowedOutcomes` — the
 * caller's permitted SUBSET of {@link DecisionOutcome}. Returns the verdict
 * verbatim when it is in the set; throws {@link DisallowedOutcomeError} (loudly)
 * when it is not. Throws {@link EmptyAllowedOutcomesError} when the set is empty.
 *
 * The engine is outcome-AGNOSTIC: it hard-codes NO caller's outcomes and inspects
 * ONLY the `outcome` discriminator (never the per-outcome content channels — those
 * are the dispatching caller's concern). The INPUT-ADAPTER boundary sits in the
 * caller: `input` is threaded opaquely to the decider, so the engine never knows
 * its shape.
 *
 * @param input the caller's adapter-shaped input (issue thread, answered sidecar
 *   + source item, …) — opaque to the engine.
 * @param decide the INJECTED decision seam (tests pass a canned verdict; prod a
 *   harness-backed one).
 * @param allowedOutcomes the caller's permitted subset (an array or any
 *   iterable). Order is preserved in the rejection message.
 */
export async function decide<TInput>(
	input: TInput,
	decide: DecisionDecider<TInput>,
	allowedOutcomes: Iterable<DecisionOutcome>,
): Promise<DecisionVerdict> {
	const allowed = [...allowedOutcomes];
	if (allowed.length === 0) {
		throw new EmptyAllowedOutcomesError();
	}
	const allowedSet = new Set(allowed);
	const verdict = await decide(input);
	if (!allowedSet.has(verdict.outcome)) {
		throw new DisallowedOutcomeError(verdict.outcome, allowed);
	}
	return verdict;
}

/**
 * Parse a decider's emitted VERDICT out of its (possibly prose-wrapped / fenced)
 * textual output into a {@link DecisionVerdict} — the PRODUCTION-WIRE helper a
 * harness-backed {@link DecisionDecider} uses to recover the verdict an agent
 * emitted, modeled 1:1 on intake's `parseIntakeVerdict`. It pulls the first JSON
 * object carrying an `"outcome"` field via the SHARED {@link extractJsonObjectSpan}
 * (the same extractor every prompt→verdict→dispatch seam in this package uses —
 * NOT a forked copy), `JSON.parse`s it, and validates the shape:
 * `outcome ∈ {task,spec,adr,dispose,resolve,ask}`.
 *
 * This validates the verdict is a WELL-FORMED member of the SUPERSET; the
 * caller-specific allowed-outcome guard ({@link decide}) then rejects one outside
 * the caller's SUBSET. The two checks are distinct: shape here, policy there.
 *
 * THROWS a clear error on: no JSON object present, invalid JSON, or an `outcome`
 * not in the superset. A harness-backed decider lets the throw propagate so the
 * caller maps it onto its own agent-failed path (a malformed verdict degrades
 * honestly, never a crash and never a silent dispatch).
 */
export function parseDecisionVerdict(output: string): DecisionVerdict {
	const span = extractJsonObjectSpan(output, 'outcome');
	if (span === undefined) {
		throw new Error(
			'decision agent produced no parseable {outcome, …} verdict.',
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(output.slice(span.start, span.end));
	} catch (err) {
		throw new Error(
			`decision verdict was not valid JSON: ${(err as Error).message}`,
		);
	}
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('decision verdict was not an object.');
	}
	const obj = parsed as Record<string, unknown>;
	const outcome = obj.outcome;
	if (
		outcome !== 'task' &&
		outcome !== 'spec' &&
		outcome !== 'adr' &&
		outcome !== 'dispose' &&
		outcome !== 'resolve' &&
		outcome !== 'ask'
	) {
		throw new Error(
			`decision verdict 'outcome' was not one of task|spec|adr|dispose|resolve|ask ` +
				`(got ${JSON.stringify(outcome)}).`,
		);
	}
	// Map the per-outcome fields onto the verdict shape, keeping ONLY the strings
	// the dispatcher consumes (a missing optional stays absent). Every field is
	// optional on the type, so each outcome's content is carried verbatim when
	// present — the engine never demands a channel (it stays outcome-agnostic).
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' ? v : undefined;
	return {
		outcome,
		...(str(obj.taskSlug) !== undefined ? {taskSlug: str(obj.taskSlug)} : {}),
		...(str(obj.taskTitle) !== undefined
			? {taskTitle: str(obj.taskTitle)}
			: {}),
		...(str(obj.taskBody) !== undefined ? {taskBody: str(obj.taskBody)} : {}),
		...(str(obj.specSlug) !== undefined ? {specSlug: str(obj.specSlug)} : {}),
		...(str(obj.specTitle) !== undefined
			? {specTitle: str(obj.specTitle)}
			: {}),
		...(str(obj.specBody) !== undefined ? {specBody: str(obj.specBody)} : {}),
		...(str(obj.adrSlug) !== undefined ? {adrSlug: str(obj.adrSlug)} : {}),
		...(str(obj.adrTitle) !== undefined ? {adrTitle: str(obj.adrTitle)} : {}),
		...(str(obj.adrBody) !== undefined ? {adrBody: str(obj.adrBody)} : {}),
		...(str(obj.disposeReason) !== undefined
			? {disposeReason: str(obj.disposeReason)}
			: {}),
		...(str(obj.resolveReason) !== undefined
			? {resolveReason: str(obj.resolveReason)}
			: {}),
		...(str(obj.question) !== undefined ? {question: str(obj.question)} : {}),
	};
}
