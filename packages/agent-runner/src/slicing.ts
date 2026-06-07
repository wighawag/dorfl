import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseFrontmatter} from './frontmatter.js';
import {
	resolveSlicingEligibility,
	type SlicingEligibilityResult,
} from './slicing-eligibility.js';
import {
	acquireSlicingLock,
	releaseSlicingLock,
	type AcquireSlicingLockOptions,
	type AcquireSlicingLockResult,
	type ReleaseSlicingLockOptions,
	type ReleaseSlicingLockResult,
} from './slicing-lock.js';
import {NullHarness, type Harness} from './harness.js';
import {launchWithOptionalWatch} from './agent-launch.js';
import {setNeedsAnswersMarker} from './frontmatter.js';
import {
	runSliceReviewLoop,
	type SliceReviewGate,
	type RunSliceReviewLoopResult,
} from './slicer-review-loop.js';

/**
 * The **`do prd:<slug>` slicing path** (PRD `auto-slice`, slice
 * `autoslice-command`) — the orchestration that ties the slicing GATE
 * (`slicing-eligibility.ts`) and the slicing LOCK (`slicing-lock.ts`) together to
 * slice a PRD into `work/backlog/` items, with the RUNNER owning every git-state
 * transition. This is the PRD branch of the `do` worker (ADR
 * `command-surface-and-journeys.md` §3/§3a), NOT a standalone `slice` command;
 * `do.ts` dispatches `resolved.namespace === 'prd'` here.
 *
 * The end-to-end flow (mirroring the `do`/`run` runner-owns-git discipline — the
 * agent only EDITS files, the runner does ALL git):
 *
 *   1. **Resolve the gate** (agent path): refuse to slice a PRD that is
 *      `humanOnly`/`needsAnswers`, or where `autoSlice` is off, or whose
 *      `sliceAfter` PRDs are not yet sliced. The HUMAN path is unbound by the gate.
 *   2. **Acquire the lock** (agent path) via the seam CAS — serialising concurrent
 *      slicers (`prd → work/slicing/`). The HUMAN path with no contention may slice
 *      on `main` directly WITHOUT the lock.
 *   3. **Invoke the agent harness** with the `to-slices` brief — the agent runs the
 *      slicer methodology and produces `work/backlog/<slug>.md` FILES ONLY; it does
 *      NOT commit/push/move (the same in-band boundary as the build agent).
 *   4. **The runner commits the COMPLETING transition** as ONE runner-owned move:
 *      drop the produced backlog slices IN + restore the PRD `work/slicing/ →
 *      work/prd/` (releasing the lock) + mark the PRD `sliced:`. This rides
 *      {@link releaseSlicingLock}'s `emitSlices`/`markSliced` so all three land in
 *      a single commit, passing the acquire-time `lockedBlob` back so the
 *      content-identity stale check actually runs.
 *
 * This path does NOT call `performIntegration` (the verify→review→done-move→rebase
 * →integrate band): the slicing transition is a DIFFERENT runner-owned move. It
 * also does NOT build the no-human confidence / needs-attention routing — that is
 * the review/edit loop owned by `slicer-review-edit-loop`; this path just produces
 * the candidate slices.
 */

/** The terminal status of one `do prd:<slug>` slicing run. */
export type SliceOutcome =
	| 'sliced' // gate passed (agent) / unbound (human) → lock → agent → committed
	| 'gate-refused' // the agent gate refused (humanOnly/needsAnswers/autoSlice/sliceAfter)
	| 'lock-lost' // the lock was lost/contended (another slicer holds it)
	| 'agent-failed' // the agent invocation itself errored
	| 'stale' // the held PRD was edited under the lock → the slicing is stale
	| 'needs-attention' // the slicer edit loop found the decomposition unclear → PRD routed to needs-attention (no slices)
	| 'usage-error'; // usage / environment problem (missing PRD, bad release, …)

export interface SliceResult {
	exitCode: 0 | 1 | 2 | 3 | 4;
	outcome: SliceOutcome;
	/** The PRD slug acted on. */
	slug: string;
	/** Repo-relative paths of the backlog slices the runner committed. */
	emitted?: string[];
	/**
	 * The slicer review→edit LOOP's disposition (`slicer-review-edit-loop`), when
	 * the loop ran. `converged` = the improved slices landed; `uncertain-slices` =
	 * the cap was hit and specific slices landed `needsAnswers: true`; absent when
	 * no loop ran or the PRD was routed to needs-attention (`outcome:
	 * 'needs-attention'`).
	 */
	loop?: 'converged' | 'uncertain-slices';
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/**
 * The agent invocation: runs the `to-slices` brief in `cwd`, WRITING
 * `work/backlog/<slug>.md` slice files (and trimming the PRD). It does NO git —
 * the runner captures the produced files and commits them.
 */
export type SliceAgentRunner = (input: {
	cwd: string;
	prompt: string;
	slug: string;
	env?: NodeJS.ProcessEnv;
}) => {ok: boolean; detail?: string};

/** Injectable lock seams (production: the real CAS; tests: stubs). */
export interface SlicingLockSeam {
	acquire(
		options: AcquireSlicingLockOptions,
	): Promise<AcquireSlicingLockResult>;
	release(
		options: ReleaseSlicingLockOptions,
	): Promise<ReleaseSlicingLockResult>;
}

const DEFAULT_LOCK_SEAM: SlicingLockSeam = {
	acquire: acquireSlicingLock,
	release: releaseSlicingLock,
};

export interface PerformSliceOptions {
	/** The PRD slug to slice (`work/prd/<slug>.md`). */
	slug: string;
	/** The working clone/checkout the slicing runs in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/**
	 * The DOER: `'agent'` (the default; bound by the gate, MUST take the lock) or
	 * `'human'` (unbound by the gate; with no contention slices on `main` directly
	 * WITHOUT the lock). The human-vs-agent choice the command wires.
	 */
	doer?: 'agent' | 'human';
	/** Per-repo `autoSlice` policy (resolved by `autoslice-gate`). Agent path only. */
	autoSlice?: boolean;
	/**
	 * The agent invocation. Tests inject this to write slice files directly;
	 * production wires the harness seam. When omitted, {@link harness} is used.
	 */
	agentRunner?: SliceAgentRunner;
	/** The harness seam used when `agentRunner` is omitted; defaults to the null adapter. */
	harness?: Harness;
	/** The configured agent command the harness shells out to (null adapter). */
	agentCmd?: string;
	/** The model routing intent forwarded to the harness (ADR §13). */
	model?: string;
	/** The HOST-ONLY sessions root for the pi session file. */
	sessionsDir?: string;
	/** Today's date (`YYYY-MM-DD`) stamped as the PRD `sliced:` marker. Defaults to now. */
	today?: string;
	/** Injectable lock seam (tests stub acquire/release). Defaults to the real CAS. */
	lock?: SlicingLockSeam;
	/**
	 * **The slicer review→edit→converge LOOP** (`slicer-review-edit-loop`, GATES PRD
	 * `work/prd/review.md` RESOLVED DESIGN — Shape 2 / insertion point A). When
	 * provided, AFTER the agent produces candidate slices (step 3) and BEFORE the
	 * runner finalises them (step 4), run the `review` SKILL as a review→edit→
	 * re-review loop that IMPROVES the candidate slices in place, then routes the
	 * verdict through the three outcomes (converge→land / uncertain-slice→
	 * needsAnswers / decomposition-unclear→PRD-to-needs-attention). The seam is the
	 * review+edit gate (tests inject a canned verdict+edits; production:
	 * {@link harnessSliceReviewGate}). Omitted ⇒ NO loop (the candidate slices land
	 * as-is — the pre-loop behaviour). The HUMAN path is unaffected (the loop runs
	 * on the auto-slicer's output only — see the gating in {@link performSlice}).
	 */
	reviewLoop?: SliceReviewGate;
	/**
	 * The HARD CAP on the slicer edit loop's in-context review passes (N) — resolved
	 * per-repo (flag > env > per-repo > global > cheap default). Only consulted when
	 * {@link reviewLoop} is set. Defaults to 3 (the cheap default) when omitted.
	 */
	maxReview?: number;
	/**
	 * How many fresh-context EXECUTIONS (M) of the loop to run — each a NEW launch in
	 * a fresh context. Default 1 (the cheap degenerate case). Only consulted when
	 * {@link reviewLoop} is set.
	 */
	reviewExecutions?: number;
	/** The model the review agent runs on (de-correlated from the slicer). Loop only. */
	reviewModel?: string;
	/** Environment for child git/agent processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

const DEFAULT_ARBITER = 'origin';

/**
 * Run the `do prd:<slug>` slicing path end-to-end. Never throws for the expected
 * gate-refused / lock-lost / agent-failed / stale cases — those are returned with
 * the appropriate exit code and outcome. The runner owns all git; the agent only
 * writes slice files.
 */
export async function performSlice(
	options: PerformSliceOptions,
): Promise<SliceResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env;
	const slug = options.slug;
	const doer = options.doer ?? 'agent';
	const lock = options.lock ?? DEFAULT_LOCK_SEAM;

	// 0. The PRD must exist in the checkout (`work/prd/<slug>.md`) — it is the
	//    source the agent slices + the file the lock holds.
	const prdPath = join(cwd, 'work', 'prd', `${slug}.md`);
	if (!existsSync(prdPath)) {
		const message = `no PRD '${slug}' found at work/prd/${slug}.md.`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', slug, message};
	}
	const prdContent = readFileSync(prdPath, 'utf8');
	const prdFm = parseFrontmatter(prdContent);

	// 1. RESOLVE THE GATE (agent path only). The human path is UNBOUND — a human
	//    decides for themselves whether a PRD is sliceable.
	if (doer === 'agent') {
		const eligibility = resolveAgentGate(cwd, slug, prdFm, options.autoSlice);
		if (!eligibility.sliceable) {
			const message = gateRefusalReason(slug, prdFm, eligibility, options);
			note(message);
			return {exitCode: 1, outcome: 'gate-refused', slug, message};
		}
	}

	// 2. ACQUIRE THE LOCK (agent path; concurrency serialisation). The human path
	//    with no contention may slice on `main` directly WITHOUT the lock.
	let lockedBlob: string | undefined;
	const useLock = doer === 'agent';
	if (useLock) {
		const acquired = await lock.acquire({slug, cwd, arbiter, env, note});
		if (acquired.outcome === 'lost') {
			return {
				exitCode: 2,
				outcome: 'lock-lost',
				slug,
				message: acquired.message,
			};
		}
		if (acquired.outcome === 'contended') {
			return {
				exitCode: 3,
				outcome: 'lock-lost',
				slug,
				message: acquired.message,
			};
		}
		if (acquired.exitCode !== 0) {
			return {
				exitCode: 1,
				outcome: 'usage-error',
				slug,
				message: acquired.message,
			};
		}
		lockedBlob = acquired.lockedBlob;
	}

	// 3. INVOKE THE AGENT with the to-slices brief. It WRITES work/backlog/*.md
	//    slice files; it does NO git. We snapshot the backlog folder before/after
	//    so the runner (not the agent) captures + commits exactly what was produced.
	const before = snapshotBacklog(cwd);
	const prompt = buildSlicingBrief(slug, prdFm.prd);
	let agent: {ok: boolean; detail?: string};
	try {
		agent = await runSliceAgent(options, cwd, prompt, slug);
	} catch (err) {
		agent = {
			ok: false,
			detail: err instanceof Error ? err.message : String(err),
		};
	}
	if (!agent.ok) {
		const detail = agent.detail ?? `the agent failed to slice '${slug}'.`;
		const message = `Agent failed slicing '${slug}' (${detail}).`;
		note(message);
		// The lock stays held (the runner did not release it): a stuck slicing is
		// recoverable / re-runnable. Surfacing it is the review/edit loop's job.
		return {exitCode: 1, outcome: 'agent-failed', slug, message};
	}

	// 3.5 THE SLICER REVIEW→EDIT→CONVERGE LOOP (`slicer-review-edit-loop`, Shape 2 /
	//     insertion point A): when a loop seam is wired, run the `review` SKILL as a
	//     review→edit→re-review loop that IMPROVES the candidate slices in place, then
	//     determines the disposition (the three outcomes). This plugs in AFTER the
	//     candidate slices are produced and BEFORE they are finalised. The agent makes
	//     the review/edit JUDGEMENTS; the loop applies edits to the candidate files
	//     and routes the verdict; the runner (below) owns the git transition. Only the
	//     AGENT path runs the loop — the human slicing path is unaffected.
	let loopDisposition: RunSliceReviewLoopResult | undefined;
	if (options.reviewLoop && doer === 'agent') {
		loopDisposition = await runSliceReviewLoop({
			slug,
			cwd,
			gate: options.reviewLoop,
			maxReview: options.maxReview ?? 3,
			executions: options.reviewExecutions,
			reviewModel: options.reviewModel,
			sessionsDir: options.sessionsDir,
			env,
			note,
		});
		// DECOMPOSITION UNCLEAR: emit NO guessed slices — route the held PRD to
		// needs-attention with the questions as the reason (the lock is released by
		// the SAME runner-owned transition, redirecting slicing/ → needs-attention/).
		if (loopDisposition.outcome === 'decomposition-unclear') {
			const reason = decompositionUnclearReason(
				slug,
				loopDisposition.prdQuestions,
			);
			if (useLock) {
				const routed = await lock.release({
					slug,
					cwd,
					arbiter,
					lockedBlob,
					routeToNeedsAttention: {reason},
					env,
					note,
				});
				if (routed.outcome !== 'released') {
					return releaseFailureToResult(routed, slug);
				}
			}
			note(loopDisposition.message);
			return {
				exitCode: 1,
				outcome: 'needs-attention',
				slug,
				message: loopDisposition.message,
			};
		}
		// UNCERTAIN SLICES: mark each named candidate `needsAnswers: true` + record
		// its questions in the body, so it lands but is not agent-buildable. The
		// runner writes the marker (the agent does no git/disk-escape).
		if (loopDisposition.outcome === 'uncertain-slices') {
			for (const uncertain of loopDisposition.uncertainSlices) {
				markSliceNeedsAnswers(cwd, uncertain.path, uncertain.questions, note);
			}
		}
	}

	// 4. The RUNNER commits the COMPLETING transition: drop the produced backlog
	//    slices IN + restore the PRD slicing/ -> prd/ (release the lock) + mark the
	//    PRD `sliced:` — ONE runner-owned commit. The agent never does git. (The
	//    backlog snapshot is taken AFTER any loop edits, so the runner commits the
	//    IMPROVED slices, not the pre-loop candidates.)
	const emitted = newOrChangedBacklog(cwd, before);
	const emitSlices = collectEmittedSlices(cwd, emitted);
	const today = options.today ?? new Date().toISOString().slice(0, 10);
	const loopTag: 'converged' | 'uncertain-slices' | undefined =
		loopDisposition?.outcome === 'converged'
			? 'converged'
			: loopDisposition?.outcome === 'uncertain-slices'
				? 'uncertain-slices'
				: undefined;

	if (useLock) {
		const released = await lock.release({
			slug,
			cwd,
			arbiter,
			lockedBlob,
			emitSlices,
			markSliced: today,
			env,
			note,
		});
		if (released.outcome === 'released') {
			const message =
				`Sliced '${slug}' -> ${emitted.length} backlog slice` +
				`${emitted.length === 1 ? '' : 's'}; the runner committed them, released ` +
				`the lock (work/slicing/ -> work/prd/), and marked the PRD sliced.`;
			note(message);
			return {
				exitCode: 0,
				outcome: 'sliced',
				slug,
				emitted,
				loop: loopTag,
				message,
			};
		}
		if (released.outcome === 'stale') {
			return {exitCode: 4, outcome: 'stale', slug, message: released.message};
		}
		if (released.outcome === 'lost' || released.outcome === 'contended') {
			const code = released.outcome === 'lost' ? 2 : 3;
			return {
				exitCode: code,
				outcome: 'lock-lost',
				slug,
				message: released.message,
			};
		}
		return {
			exitCode: 1,
			outcome: 'usage-error',
			slug,
			message: released.message,
		};
	}

	// HUMAN, no-lock path: the human commits on `main` directly (the runner does
	// not own the human's git). We report the produced slices; marking the PRD
	// `sliced:` and committing is the human's to do, as with the human `complete`.
	const message =
		`Sliced '${slug}' -> ${emitted.length} backlog slice` +
		`${emitted.length === 1 ? '' : 's'} (human path, no lock). Inspect + commit ` +
		`the produced files (and the PRD's sliced: marker) yourself.`;
	note(message);
	return {
		exitCode: 0,
		outcome: 'sliced',
		slug,
		emitted,
		loop: loopTag,
		message,
	};
}

/**
 * Map a non-`released` lock-release result onto the {@link SliceResult} contract
 * (the decomposition-unclear routing reuses the SAME release seam, so it can also
 * be `stale`/`lost`/`contended`/usage-error). Mirrors the step-4 release mapping.
 */
function releaseFailureToResult(
	released: ReleaseSlicingLockResult,
	slug: string,
): SliceResult {
	if (released.outcome === 'stale') {
		return {exitCode: 4, outcome: 'stale', slug, message: released.message};
	}
	if (released.outcome === 'lost' || released.outcome === 'contended') {
		const code = released.outcome === 'lost' ? 2 : 3;
		return {
			exitCode: code,
			outcome: 'lock-lost',
			slug,
			message: released.message,
		};
	}
	return {exitCode: 1, outcome: 'usage-error', slug, message: released.message};
}

/**
 * Build the needs-attention REASON for a decomposition-unclear loop verdict (the
 * PRD is routed to `work/needs-attention/` with these open questions, no guessed
 * slices). Prose only — recorded as the PRD's needs-attention body block.
 */
function decompositionUnclearReason(slug: string, questions: string[]): string {
	const head =
		`The slicer review→edit loop could not converge on a sound decomposition of ` +
		`'${slug}' (maxReview exhausted with unresolved blockers). The PRD is routed ` +
		`to needs-attention with no guessed slices; a human must resolve:`;
	const body =
		questions.length > 0
			? questions.map((q) => `- ${q}`).join('\n')
			: '- (no specific questions surfaced; the decomposition is broadly unclear)';
	return `${head}\n${body}`;
}

/**
 * Mark a candidate slice file `needsAnswers: true` and record its open questions in
 * its body (the loop's uncertain-slice routing outcome). The runner writes the
 * file; the agent does no git/disk-escape. A path outside `work/backlog/` is
 * skipped (defensive). A relative `work/backlog/<slug>.md` that does not exist is
 * skipped with a note (never crash the transition).
 */
function markSliceNeedsAnswers(
	cwd: string,
	relPath: string,
	questions: string[],
	note: (message: string) => void,
): void {
	const normalized = relPath.replace(/\\/g, '/');
	if (!normalized.startsWith('work/backlog/') || normalized.includes('..')) {
		note(`Skipped a needsAnswers mark outside work/backlog/ (${relPath}).`);
		return;
	}
	const abs = join(cwd, normalized);
	if (!existsSync(abs)) {
		note(`Skipped a needsAnswers mark for missing candidate slice ${relPath}.`);
		return;
	}
	const current = readFileSync(abs, 'utf8');
	const marked = setNeedsAnswersMarker(current, true);
	writeFileSync(abs, appendQuestionsBlock(marked, questions));
}

/** The heading that opens the open-questions block in an uncertain slice body. */
const OPEN_QUESTIONS_HEADING = '## Open questions';

/**
 * Append an `## Open questions` block (prose, never a frontmatter field —
 * WORK-CONTRACT rule 3) listing the loop's surfaced questions to an uncertain
 * slice's body. A human answers these before the slice becomes agent-buildable.
 */
function appendQuestionsBlock(content: string, questions: string[]): string {
	if (questions.length === 0) {
		return content;
	}
	const base = content.replace(/\s*$/, '');
	const items = questions.map((q) => `- ${q}`).join('\n');
	return [base, '', OPEN_QUESTIONS_HEADING, '', items, ''].join('\n');
}

/**
 * Resolve the AGENT slicing gate for `slug`: the pure predicate
 * (`needsAnswers !== true && humanOnly !== true && autoSlice`) plus the
 * cross-PRD `sliceAfter` ordering, resolved against the `sliced:` markers of the
 * PRDs present in the checkout.
 */
function resolveAgentGate(
	cwd: string,
	slug: string,
	prdFm: {humanOnly?: boolean; needsAnswers?: boolean; sliceAfter: string[]},
	autoSlice: boolean | undefined,
): SlicingEligibilityResult {
	return resolveSlicingEligibility({
		humanOnly: prdFm.humanOnly,
		needsAnswers: prdFm.needsAnswers,
		sliceAfter: prdFm.sliceAfter,
		slicedSlugs: readSlicedSlugs(cwd),
		autoSlice: autoSlice ?? false,
	});
}

/** Build an HONEST gate-refusal message naming WHY the agent skipped the PRD. */
function gateRefusalReason(
	slug: string,
	prdFm: {humanOnly?: boolean; needsAnswers?: boolean},
	eligibility: SlicingEligibilityResult,
	options: PerformSliceOptions,
): string {
	const reasons: string[] = [];
	if (prdFm.humanOnly === true) {
		reasons.push('the PRD is humanOnly (a human must drive its slicing)');
	}
	if (prdFm.needsAnswers === true) {
		reasons.push(
			'the PRD has needsAnswers (open questions block auto-slicing)',
		);
	}
	if (
		prdFm.humanOnly !== true &&
		prdFm.needsAnswers !== true &&
		(options.autoSlice ?? false) !== true
	) {
		reasons.push("the repo's autoSlice policy is off");
	}
	if (!eligibility.sliceAfter.satisfied) {
		reasons.push(
			`sliceAfter PRD(s) not yet sliced: ${eligibility.sliceAfter.missing.join(', ')}`,
		);
	}
	const why =
		reasons.length > 0 ? reasons.join('; ') : 'the slicing gate refused';
	return `Skipped slicing '${slug}': ${why}.`;
}

/**
 * Read the set of slugs whose PRDs are already SLICED in this checkout — a PRD's
 * `sliced:` frontmatter marker (NOT residence in any folder). Reads both
 * `work/prd/` and `work/slicing/` (a PRD mid-slice still occupies its slug); a
 * `sliced:` marker is what counts. Missing folders read as empty.
 */
function readSlicedSlugs(cwd: string): Set<string> {
	const slugs = new Set<string>();
	for (const folder of ['prd', 'slicing'] as const) {
		const dir = join(cwd, 'work', folder);
		for (const file of listMarkdown(dir)) {
			const content = readFileSync(join(dir, file), 'utf8');
			const fm = parseFrontmatter(content);
			if (fm.sliced !== undefined) {
				slugs.add(fm.slug ?? file.replace(/\.md$/i, ''));
			}
		}
	}
	return slugs;
}

/** Build the `to-slices` brief the agent runs against the PRD. */
function buildSlicingBrief(slug: string, _prd: string | undefined): string {
	return [
		`Use the **to-slices** skill to slice the PRD \`work/prd/${slug}.md\` into`,
		'independently-grabbable `work/backlog/<slug>.md` slices (tracer-bullet',
		'vertical slices). Read the PRD fully first.',
		'',
		'No human is present, so do the CONFIDENCE CHECK (to-slices step 4): only emit',
		'slices you would have gotten a human to approve. If granularity, dependency',
		'order, a gate, or a seam is genuinely unresolved, set `needsAnswers: true`',
		'on the specific uncertain slice (questions in its body) rather than guessing.',
		'',
		'WRITE the slice files only. Do NOT perform any git operations — do not stage,',
		'commit, push, or move any files. The RUNNER owns every git-state transition',
		'(it commits the produced slices, releases the slicing lock, and marks the PRD',
		'sliced). Set each slice\u2019s `prd:` field to the source PRD slug so the link',
		'back to the PRD survives.',
	].join('\n');
}

/** Run the slice agent. Prefers the injected runner; else the harness seam. */
async function runSliceAgent(
	options: PerformSliceOptions,
	cwd: string,
	prompt: string,
	slug: string,
): Promise<{ok: boolean; detail?: string}> {
	if (options.agentRunner) {
		return options.agentRunner({cwd, prompt, slug, env: options.env});
	}
	const harness = options.harness ?? new NullHarness();
	const launched = await launchWithOptionalWatch({
		harness,
		dir: cwd,
		slug,
		command: options.agentCmd ?? '',
		prompt,
		model: options.model,
		sessionId: `slice-${slug}`,
		sessionsDir: options.sessionsDir,
		env: options.env,
	});
	return {ok: launched.ok, detail: launched.detail};
}

/** A snapshot of `work/backlog/`: filename → file content (for change detection). */
function snapshotBacklog(cwd: string): Map<string, string> {
	const dir = join(cwd, 'work', 'backlog');
	const snap = new Map<string, string>();
	for (const file of listMarkdown(dir)) {
		snap.set(file, readFileSync(join(dir, file), 'utf8'));
	}
	return snap;
}

/**
 * Repo-relative paths of the `work/backlog/*.md` files the agent NEWLY created or
 * CHANGED vs the pre-run snapshot — exactly what the runner captures + commits.
 * (An untouched pre-existing slice is NOT re-committed.)
 */
function newOrChangedBacklog(
	cwd: string,
	before: Map<string, string>,
): string[] {
	const dir = join(cwd, 'work', 'backlog');
	const changed: string[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		if (before.get(file) !== content) {
			changed.push(`work/backlog/${file}`);
		}
	}
	return changed.sort();
}

/** Read the produced backlog slices' content keyed by repo-relative path. */
function collectEmittedSlices(
	cwd: string,
	relPaths: string[],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rel of relPaths) {
		out[rel] = readFileSync(join(cwd, rel), 'utf8');
	}
	return out;
}

/** List `*.md` files in `dir`, sorted; an absent dir reads as empty. */
function listMarkdown(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.filter((name) => name.toLowerCase().endsWith('.md')).sort();
}
