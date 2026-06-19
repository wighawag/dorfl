import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	workFolderPrefix,
	workFolderPath,
	workItemRel,
	stripWorkFolderPrefix,
	isWorkItemFile,
} from './work-layout.js';
import {NullHarness, type Harness} from './harness.js';
import {launchWithOptionalWatch} from './agent-launch.js';
import {extractJsonObjectSpan} from './verdict-json.js';

/**
 * **The slicer review→edit→re-review→converge LOOP** (`slicer-review-edit-loop`,
 * GATES PRD `work/prd/review.md` RESOLVED DESIGN — Shape 2 / insertion point A).
 *
 * On the `do prd:<slug>` slicing path (`slicing.ts`/`performSlice`), AFTER the
 * agent produces a candidate set of `work/pre-backlog/<slug>.md` slices and BEFORE the
 * runner finalises/lands them, this loop RUNS the `review` SKILL
 * (`skills/review/SKILL.md`), APPLIES its findings as EDITS to the candidate slice
 * files, then re-reviews — until a pass finds NO NEW blocking issue (the natural
 * terminator) or the `slicerLoopMax` hard cap is hit. It is an IMPROVER, NOT a one-shot
 * gate: slices measurably keep getting better when reviewed, so the findings feed
 * back into edits, repeatedly. The destination/goal check is part of the SAME
 * review pass (it can itself trigger edits — which is why it is a loop).
 *
 * Two axes (the M×N grid from the idea file):
 *   - **N** — the in-context multipass: ONE agent reviews AND edits in a single
 *     context, accumulating findings across angle-switched passes. `slicerLoopMax` caps
 *     N so the loop can never run forever.
 *
 *     ⚠️ ASPIRATION-VS-BUILT (2026-06-10): the "single context" wording above is the
 *     PRD's ASPIRATION, NOT what this module does at runtime. The ACTUAL N loop is
 *     RUNNER-DRIVEN and PER-PASS: `runOneExecution` does `for (pass …) { gate(…);
 *     applyEdits(…to disk…) }` — ONE agent LAUNCH per pass, the runner writing the
 *     agent's edits to the candidate slice FILES (`work/pre-backlog/`) between passes, the
 *     next pass's agent re-reading the edited files. Accumulation is via DISK +
 *     re-launch, NOT one agent retaining context. `prd/review.md` §Shape 2 is internally
 *     contradictory on this (single-context headline vs "edit the files" operative spec);
 *     this code implements the operative reading. See
 *     `work/findings/review-edit-loop-single-context-is-unbuilt-aspiration-vs-per-pass-disk-impl.md`.
 *     (Relevant to intake: PR #62's lone-slice loop mirrors this per-pass STRUCTURE but
 *     accumulates IN-MEMORY, because intake must not write to `work/pre-backlog/` pre-emit.)
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
 *   - **the whole decomposition unclear / `slicerLoopMax` exhausted with blockers** →
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
 * agent emits the FULL replacement content for a `work/pre-backlog/<slug>.md` file (or
 * a new file it adds); the runner writes it (the agent does no git / no direct
 * disk writes that escape the runner's capture).
 */
export interface SliceEdit {
	/** Repo-relative path of the candidate slice file to write (`work/pre-backlog/…`). */
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
	/** Repo-relative path of the uncertain candidate slice (`work/pre-backlog/…`). */
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
 *     (routing outcome 2). Used when the loop hits `slicerLoopMax` with blockers.
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
	 * The model the IMPROVER-loop REVIEW agent runs on (de-correlated from the
	 * slicer; the `--slicer-loop-model` family). `undefined` ⇒ no forced model.
	 * Flows through `LaunchInput.model` / `substituteModel`. DISTINCT from the
	 * acceptance gate's `reviewModel`.
	 */
	slicerLoopModel?: string;
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
	/** `slicerLoopMax` hit with blockers → specific uncertain slice(s) → needsAnswers. */
	| 'uncertain-slices'
	/** `slicerLoopMax` hit / decomposition unclear → route the PRD to needs-attention. */
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
	 * **The SCOPING FENCE (the requeue fix).** A snapshot of `work/pre-backlog/` taken
	 * BEFORE this slicing run produced its candidate slices (filename → content;
	 * the `before` map `performSlice` already computes at step 3). The loop reviews,
	 * edits, and flags ONLY the slices that are NEW or CHANGED vs this snapshot —
	 * i.e. THIS run's own output — NEVER the pre-existing, already-landed slices
	 * that share the same `work/pre-backlog/` directory (the normal steady state). On a
	 * populated backlog this is what keeps the loop from editing / `needsAnswers`-
	 * flagging unrelated slices and sweeping them into the runner-owned slicing
	 * commit. Omitted ⇒ an EMPTY snapshot (every `work/pre-backlog/*.md` is treated as
	 * this run's output — the legacy whole-directory behaviour, kept only for the
	 * degenerate empty-backlog case / direct callers that pass none).
	 */
	before?: Map<string, string>;
	/**
	 * The HARD CAP on in-context review passes (N) per fresh context. Reaching it
	 * with unresolved blockers REJECTS via the sink (never an infinite loop). The
	 * natural terminator (no new blocking issue) usually fires first.
	 */
	slicerLoopMax: number;
	/**
	 * How many fresh-context EXECUTIONS (M) to run — each a NEW launch of the same
	 * loop in a fresh context. Default 1 (the cheap degenerate case). `M>1` runs M
	 * independent fresh loops; the first that converges wins, else the last
	 * execution's blocking verdict is routed.
	 */
	executions?: number;
	/** The model the improver-loop review agent runs on (de-correlation; `--slicer-loop-model`). */
	slicerLoopModel?: string;
	/** The HOST-ONLY sessions root for the review session file. */
	sessionsDir?: string;
	/** Environment for child processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/**
 * Run the slicer review→edit→converge loop over the candidate slices currently on
 * disk under `work/pre-backlog/`. Implements the loop ONCE; M (fresh-context
 * re-executions) is just invoking the inner loop again with a fresh launch.
 *
 * Within ONE execution (the N): run the gate (a review+edit pass), APPLY its edits
 * to the candidate slice files, then re-review — until `verdict === 'approve'` (no
 * NEW blocking issue → converged) or the pass count reaches `slicerLoopMax`. On the cap
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
	const slicerLoopMax = Math.max(1, options.slicerLoopMax);
	// The SCOPING FENCE: review/edit/flag ONLY this run's own new-or-changed
	// slices, never pre-existing landed ones (the requeue fix). No snapshot ⇒ an
	// empty one (the legacy whole-directory behaviour for the empty-backlog case).
	const before = options.before ?? new Map<string, string>();

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
			slicerLoopMax,
			execution: m,
			before,
			slicerLoopModel: options.slicerLoopModel,
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
				slices: readCandidates(options.cwd, before),
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

	// Every execution hit `slicerLoopMax` with unresolved blockers — REJECT via the
	// sink. The LAST execution's verdict carries the routing channels.
	const verdict = last!.lastVerdict;
	if (verdict.decompositionUnclear) {
		const questions = verdict.decompositionUnclear.questions;
		note(
			`Slicer review loop did not converge within slicerLoopMax=${slicerLoopMax} ` +
				`across ${executions} fresh context(s); the whole decomposition is ` +
				'unclear — routing the PRD to needs-attention (no guessed slices).',
		);
		return {
			outcome: 'decomposition-unclear',
			slices: readCandidates(options.cwd, before),
			uncertainSlices: [],
			prdQuestions: questions,
			passes: totalPasses,
			executions,
			message:
				`The decomposition of '${options.slug}' is still unclear after ` +
				`slicerLoopMax=${slicerLoopMax} review pass(es) across ${executions} fresh ` +
				'context(s); routing the PRD to needs-attention with the open ' +
				'questions, emitting no guessed slices.',
		};
	}

	// A specific-slice rejection: emit the uncertain slice(s) `needsAnswers: true`.
	// SCOPED to THIS run's own output (the requeue fix): an agent-named uncertain
	// slice that is NOT one of this run's new-or-changed slices is DROPPED (the
	// agent must never flag a pre-existing landed slice). Floor: if the agent named
	// none (or named only out-of-scope ones) but still blocks, treat THIS run's own
	// candidates as uncertain — never land a slice the loop could not approve, never
	// silently drop the rejection, but never escape to unrelated slices.
	const ownPaths = new Set(newOrChangedBacklog(options.cwd, before));
	const named = (verdict.uncertainSlices ?? []).filter((u) => {
		const normalized = u.path.replace(/\\/g, '/');
		if (ownPaths.has(normalized)) {
			return true;
		}
		note(
			`Dropped an uncertain-slice flag on ${u.path} — not one of THIS run’s ` +
				'own candidate slices (the loop never flags pre-existing landed slices).',
		);
		return false;
	});
	const uncertain =
		named.length > 0
			? named
			: [...ownPaths].sort().map((path) => ({
					path,
					questions: blockingQuestions(verdict),
				}));
	note(
		`Slicer review loop did not converge within slicerLoopMax=${slicerLoopMax} across ` +
			`${executions} fresh context(s); emitting ${uncertain.length} uncertain ` +
			'slice(s) with needsAnswers + questions.',
	);
	return {
		outcome: 'uncertain-slices',
		slices: readCandidates(options.cwd, before),
		uncertainSlices: uncertain,
		prdQuestions: [],
		passes: totalPasses,
		executions,
		message:
			`Slicing '${options.slug}' did not converge after slicerLoopMax=${slicerLoopMax} ` +
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
	slicerLoopMax: number;
	execution: number;
	before: Map<string, string>;
	slicerLoopModel?: string;
	sessionsDir?: string;
	env?: NodeJS.ProcessEnv;
	note: (message: string) => void;
}): Promise<SingleExecutionResult> {
	const {slug, cwd, gate, slicerLoopMax, execution, before, note} = params;
	let lastVerdict: SliceReviewVerdict = {verdict: 'block', findings: []};
	let passes = 0;
	for (let pass = 1; pass <= slicerLoopMax; pass++) {
		// SCOPED: only THIS run's own new-or-changed slices are reviewed — a slice
		// the loop CREATED in an earlier pass is new-vs-`before` so it is in scope;
		// a pre-existing landed slice is unchanged so it is NOT (the requeue fix).
		const candidateSlices = newOrChangedBacklog(cwd, before);
		const verdict = await gate({
			slug,
			cwd,
			candidateSlices,
			pass,
			execution,
			slicerLoopModel: params.slicerLoopModel,
			sessionsDir: params.sessionsDir,
			env: params.env,
		});
		passes = pass;
		lastVerdict = verdict;

		// APPLY the edits to the candidate slice files (the improver step) — the
		// runner writes the agent's full-content edits; the agent does no disk/git.
		// SCOPED to this run's own output: an edit may improve a slice THIS run
		// produced or CREATE a new candidate, but NEVER overwrite a pre-existing
		// landed slice (the requeue fix).
		if (verdict.edits && verdict.edits.length > 0) {
			applyEdits(cwd, verdict.edits, before, note);
		}

		if (verdict.verdict === 'approve') {
			return {converged: true, lastVerdict: verdict, passes};
		}
		note(
			`Slicer review pass ${pass}/${slicerLoopMax} (context ${execution}) found ` +
				`${blockingCount(verdict)} blocking issue(s); ` +
				`${verdict.edits?.length ?? 0} edit(s) applied — re-reviewing.`,
		);
	}
	return {converged: false, lastVerdict, passes};
}

/**
 * Apply the review agent's full-content edits to the candidate slice files. ONLY
 * paths under `work/pre-backlog/` are written — the loop improves the CANDIDATE SLICES,
 * never escapes to other parts of the tree (a defensive scope fence; the runner,
 * not the agent, performs the write). An edit may CREATE a new candidate slice file
 * (e.g. the review split one slice into two) — that is in-scope.
 *
 * **SCOPED to this run's own output (the requeue fix).** Beyond the
 * `work/pre-backlog/` prefix fence, an edit is only applied when its target is THIS
 * run's own slice: either a path NOT present in the `before` snapshot (a slice this
 * run created, or a new file the review is splitting out) OR one this run already
 * changed vs `before`. A pre-existing, unchanged landed slice (present in `before`
 * with identical content) is REFUSED — the loop must never edit an unrelated,
 * already-landed slice and sweep it into the runner-owned slicing commit.
 */
function applyEdits(
	cwd: string,
	edits: SliceEdit[],
	before: Map<string, string>,
	note: (message: string) => void,
): void {
	for (const edit of edits) {
		const normalized = edit.path.replace(/\\/g, '/');
		const filename = stripWorkFolderPrefix(normalized, 'pre-backlog');
		if (filename === undefined || normalized.includes('..')) {
			note(
				`Skipped a review edit outside ${workFolderPrefix('pre-backlog')} (${edit.path}) — the ` +
					'loop only improves candidate slices.',
			);
			continue;
		}
		// A pre-existing slice this run did NOT touch must not be overwritten: it is
		// in `before` and the current on-disk content still equals the snapshot.
		if (before.has(filename)) {
			const abs = join(cwd, normalized);
			let current: string | undefined;
			try {
				current = readFileSync(abs, 'utf8');
			} catch {
				current = undefined;
			}
			if (current !== undefined && current === before.get(filename)) {
				note(
					`Skipped a review edit to the pre-existing landed slice ${edit.path} ` +
						'— the loop only improves THIS run’s own candidate slices.',
				);
				continue;
			}
		}
		const abs = join(cwd, normalized);
		writeFileSync(abs, edit.content);
	}
}

/**
 * Repo-relative paths of the `work/pre-backlog/*.md` files that are NEW or CHANGED vs
 * the `before` snapshot — exactly THIS slicing run's own output (the requeue-fix
 * scoping fence). A pre-existing slice present in `before` with identical content
 * is excluded; a file the loop created (absent from `before`) or improved (content
 * differs) is included. Mirrors `slicing.ts`'s `newOrChangedBacklog`.
 */
function newOrChangedBacklog(
	cwd: string,
	before: Map<string, string>,
): string[] {
	const dir = workFolderPath(cwd, 'pre-backlog');
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const name of entries) {
		if (!isWorkItemFile(name)) {
			continue;
		}
		const content = readFileSync(join(dir, name), 'utf8');
		if (before.get(name) !== content) {
			out.push(workItemRel('pre-backlog', name));
		}
	}
	return out.sort();
}

/**
 * THIS run's candidate slices keyed by repo-relative path → current content —
 * scoped to the new-or-changed set (never the pre-existing landed slices).
 */
function readCandidates(
	cwd: string,
	before: Map<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rel of newOrChangedBacklog(cwd, before)) {
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
			model: input.slicerLoopModel,
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
		`reviewing the WHOLE SET — graph coherence / gaps / overlap / goal-composition`,
		`(dependency-graph coherence, set-level gaps, overlapping/duplicated slices,`,
		`and "does the set compose into the PRD goal") — not just per-slice`,
		`well-formedness, and ENDING in the DESTINATION CHECK ("if every slice is`,
		`built exactly as written, do we end up with the system the PRD describes?").`,
		`The destination check is PART OF this pass and may ITSELF trigger edits —`,
		`that is why this is a loop, not a one-shot gate.`,
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
		` "edits": [ {"path": "work/pre-backlog/<slug>.md", "content": "<full new file content>"} ],`,
		` "uncertainSlices": [ {"path": "work/pre-backlog/<slug>.md", "questions": ["…"]} ],`,
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
		``,
		`SLICE \`humanOnly\` IS NARROW. Only edit a slice to add \`humanOnly: true\``,
		`when building THAT slice is genuinely never-for-agents BY NATURE (secrets/`,
		`release/security/AGENTS.md prohibition) — a \`humanOnly\` slice is not agent-`,
		`claimable EVEN from the pool \`work/backlog/\`. Do NOT stamp \`humanOnly\` to`,
		`mean "a human should review this first": that is the POSITION's job — every`,
		`candidate slice is BIRTHED STAGED in \`work/pre-backlog/\` (not eligible) and a`,
		`human promotes the approved ones into the pool.`,
		`Review-first is the staging position; the overloaded "stamp \`humanOnly\` for`,
		`review" reading is retired.`,
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
	const span = extractJsonObjectSpan(output);
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
