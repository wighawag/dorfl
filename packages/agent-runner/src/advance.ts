import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {type WorkFolderKey, workItemPath, workItemRel} from './work-layout.js';
import {
	resolveAdvanceArg,
	SlugResolutionError,
	type SlugNamespace,
} from './slug-namespace.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {parseFrontmatter} from './frontmatter.js';
import {
	parseSidecar,
	sidecarPathFor,
	type SidecarModel,
	type SidecarType,
} from './sidecar.js';
import {classifyTick, type TickClassification} from './advance-classify.js';
import {
	acquireAdvancingLock,
	releaseAdvancingLock,
	type AcquireAdvancingLockResult,
	type ReleaseAdvancingLockResult,
} from './advancing-lock.js';
import {performDo, type DoOptions, type DoResult} from './do.js';
import {
	harnessSurfaceGate,
	toNewQuestions,
	type SurfaceGate,
} from './surface-gate.js';
import {harnessTriageGate, type TriageGate} from './triage-gate.js';
import type {ObservationTriage} from './config.js';
import {
	autoDispositionObservation,
	promoteObservation,
	type AutoDispositionOptions,
	type AutoDispositionResult,
	type PromoteObservationOptions,
	type PromoteObservationResult,
} from './triage-persist.js';
import {isEntryAnswered} from './sidecar.js';
import {
	persistSurfacedQuestions,
	type SurfacePersistOptions,
	type SurfacePersistResult,
} from './surface-persist.js';
import {
	applyAnsweredQuestions,
	type ApplyAnsweredQuestionsOptions,
	type ApplyAnsweredQuestionsResult,
} from './apply-persist.js';
import type {NewQuestion} from './sidecar.js';

/**
 * The **`advance` verb SKELETON** (PRD `advance-loop`, slice
 * `advance-verb-resolver`, US #1/5/6/18). `advance` is the SIBLING top-level verb
 * (NOT a `do` subcommand — `do` subcommands are REJECTED in the PRD) that drives
 * a `work/` item ONE lifecycle rung toward "ready/built", reusing the SAME shared
 * `prefix:arg` resolver `do` uses (extended with the `obs:` namespace, see
 * {@link resolveAdvanceArg}).
 *
 * This module delivers the **classify → lock → execute SKELETON** — the contract
 * both drivers (the later one-shot/loop slices) wrap:
 *
 *   1. **classify** — read-only, NO model, NO lock: read the item's two signals
 *      (`needsAnswers` + the sidecar's answered-state) and call the pure
 *      {@link classifyTick} to get the rung kind. A CAS loser will have spent ONLY
 *      this free classification.
 *   2. **lock** — take the `advancing` CAS borrow ({@link acquireAdvancingLock})
 *      for the classified rung, keyed on the item's `<type>-<slug>` identity. The
 *      expensive (agent/model) phase is ALWAYS post-lock, so a loser backs off
 *      having done ~nothing (a TOCTOU between classify and CAS is harmless — only
 *      the free classification is wasted, and the loser never starts model work).
 *   3. **execute** — WINNER ONLY: dispatch the classified rung to the
 *      {@link RungExecutor} seam, then release the borrow.
 *
 * The **rung BODIES** are now ALL filled (their own slices): `surface`
 * (`advance-rung-surface`), `apply` (`advance-rung-apply`), and
 * `triage-observation` (`advance-rung-triage`) dispatch through the clearly-named
 * executor SEAM ({@link RungExecutor}); the build/slice rungs ORCHESTRATE
 * `do`/`do prd:`. What this verb does NOT do (LATER slices):
 *   - The two **DRIVERS** (one-shot sequential / loop) + `-n` + the gate-FAMILY
 *     WIRING that resolves `autoBuild`/`autoTask`/`observationTriage` and threads
 *     them into the build/slice gate composition — slice `advance-drivers-and-gates`.
 *     (This verb already RESPECTS `observationTriage` in the triage rung — the gate's
 *     resolution chain + the build/slice gate composition is the drivers slice.)
 *   - The bare `advance` (eligible-SET) form — it needs the pool scan / driver, so
 *     the verb here is a SINGLE named-item tick; the bare form errors clearly
 *     ("needs the driver slice"). See the `## Decisions` block in the slice.
 *
 * The build-slice / slice-prd rungs ORCHESTRATE the existing `do` / `do prd:`
 * machinery ({@link performDo}) — `advance` is a driver layered ON TOP, NEVER a
 * peer that duplicates the build/slice path (ONE build path, ONE slice path —
 * US #6).
 */

const DEFAULT_ARBITER = 'origin';

/**
 * The terminal condition of one `advance` tick (mirrors `DoOutcome`'s shape).
 *
 * `vanished` (slice `observation-identity-is-its-filename-not-a-foreign-slug`):
 * a BENIGN SKIP when the item's file was enumerated into the lifecycle pool but
 * has since been moved/triaged/deleted by a sibling leg (the cross-tick window
 * under parallel CI). It is `exitCode: 0` so the matrix tolerates it, but it is
 * DISTINGUISHABLE from `no-op` (which is a calm classify result, e.g. a pending
 * sidecar) so reviewers can grep these out. NOT used for a human-typed bare slug
 * that names nothing — that is a malformed invocation; today the two are not
 * distinguished at this seam (a human typo also skips benignly) and the matrix
 * scale of the calm condition justifies the trade.
 */
export type AdvanceOutcome =
	| 'advanced'
	| 'no-op'
	| 'vanished'
	| 'usage-error'
	| 'lost'
	| 'contended'
	| 'not-implemented'
	| 'invariant-violation';

/** Maps onto the claim-CAS exit codes (identical semantics). */
export type AdvanceExitCode = 0 | 1 | 2 | 3;

/**
 * The injectable rung-executor SEAM — WHAT happens once the tick has classified a
 * rung AND won the `advancing` lock. It is the boundary between the skeleton (this
 * slice) and the rung bodies (later slices): the surface/apply/triage rungs are
 * filled by their own slices; the build/slice rungs ORCHESTRATE `do`/`do prd:`.
 *
 * Production wires {@link defaultRungExecutor}; tests inject a spy to assert the
 * classify→lock→dispatch ORDER (and that a CAS loser never reaches the executor).
 */
export interface RungExecutor {
	/** A ready slice → build it by ORCHESTRATING `do <slug>` (NOT a re-implementation). */
	buildTask(input: RungExecInput): Promise<RungExecResult>;
	/** A ready PRD → slice it by ORCHESTRATING `do prd:<slug>` (NOT a re-implementation). */
	taskBrief(input: RungExecInput): Promise<RungExecResult>;
	/** An untriaged observation → triage it (LATER slice fills this body). */
	triageObservation(input: RungExecInput): Promise<RungExecResult>;
	/** `needsAnswers` but no sidecar → surface the questions (LATER slice fills this). */
	surface(input: RungExecInput): Promise<RungExecResult>;
	/** Every entry answered → apply the answers + advance (LATER slice fills this). */
	apply(input: RungExecInput): Promise<RungExecResult>;
}

/** What a rung executor is handed: the resolved identity + the run context. */
export interface RungExecInput {
	/** The canonical namespaced identity (`slice:<slug>` / `prd:<slug>` / `observation:<slug>`). */
	item: string;
	/** The resolved namespace (`slice` / `prd` / `observation`). */
	namespace: SlugNamespace;
	/** The bare slug. */
	slug: string;
	/** The classification that selected this rung (the two signals are visible). */
	classification: TickClassification;
	/** The tick's run context (cwd, arbiter, …) — threaded to `do`/`do prd:`. */
	context: AdvanceContext;
}

/** A rung executor's result (the outcome the tick reports). */
export interface RungExecResult {
	exitCode: AdvanceExitCode;
	outcome: AdvanceOutcome;
	message: string;
}

/** The run context threaded from the CLI into the tick + the rung executor. */
export interface AdvanceContext {
	/** The working clone/checkout to run in-place in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/** The base `do` options the build/slice rungs orchestrate `performDo` with. */
	doOptions?: Omit<DoOptions, 'arg'>;
	/**
	 * The build/slice ORCHESTRATION DRIVER seam (slice
	 * `advance-loop-driver-registry-set-job-worktrees`). The build-slice / slice-prd
	 * rungs ORCHESTRATE `do` by handing the resolved arg + the threaded
	 * {@link doOptions} to THIS driver. `undefined` ⇒ {@link performDo} (the IN-PLACE
	 * substrate — the human-local one-shot `advance` command + today's
	 * single-mirror `run --advance`, which build in the cwd checkout). The
	 * registry-set advance driver injects a PER-MIRROR JOB-WORKTREE driver
	 * ({@link jobWorktreeDoDriver}) so the daemon/CI path builds isolated off each
	 * mirror's arbiter (the SAME isolation `run`'s build tick gives `runOneItem`),
	 * NOT in `process.cwd()`. This is the parameterised isolation strategy the
	 * slice's `## Decisions` records: in-place and worktree COEXIST behind one seam,
	 * reusing the EXISTING `selectIsolationStrategy`/`jobWorktreeStrategy` (no second
	 * isolation mechanism). The DEFAULT keeps in-place behaviour byte-for-byte.
	 */
	doDriver?: (options: DoOptions) => Promise<DoResult>;
	/**
	 * The SURFACE gate seam — the fresh-context `surface-questions` spawn the
	 * surface rung uses (slice `advance-rung-surface`). The skill JUDGES (emits
	 * questions); the engine PERSISTS. Production wires {@link harnessSurfaceGate};
	 * tests inject a stub emit. `undefined` ⇒ the surface rung defaults to
	 * {@link harnessSurfaceGate} (a NullHarness, no real model) so the seam is never
	 * a crash — but the CLI threads the real harness-backed gate.
	 */
	surfaceGate?: SurfaceGate;
	/**
	 * The model the SURFACE agent runs on (de-correlated from the builder, like
	 * `reviewModel`). Flows to the gate's launch through `LaunchInput.model`.
	 */
	surfaceModel?: string;
	/**
	 * Persist the surfaced questions ATOMICALLY (append-or-create the sidecar + set
	 * `needsAnswers:true` in ONE commit). Tests inject a spy; production uses
	 * {@link persistSurfacedQuestions}. The ENGINE owns ALL persistence — the skill
	 * writes nothing.
	 */
	surfacePersist?: (options: SurfacePersistOptions) => SurfacePersistResult;
	/**
	 * Apply the HUMAN's answered sidecar ATOMICALLY (item body + sidecar in ONE
	 * commit, via the sidecar contract's atomic-apply), then resolve / re-pause /
	 * disposition to a terminal. Tests inject a spy; production uses
	 * {@link applyAnsweredQuestions}. The engine applies ONLY human-authored answers
	 * — it NEVER invents one.
	 */
	applyPersist?: (
		options: ApplyAnsweredQuestionsOptions,
	) => ApplyAnsweredQuestionsResult;
	/**
	 * Supply the NEW follow-up questions an apply discovered (so it APPENDS them and
	 * re-pauses rather than resolving). `undefined`/empty ⇒ the apply resolves (or
	 * dispositions) the item. The follow-up GENERATION is the surface skill's job;
	 * this seam lets the apply rung append already-formulated follow-ups (and lets
	 * tests drive the append-re-pause path) WITHOUT inventing an ANSWER.
	 */
	applyFollowups?: NewQuestion[];
	/**
	 * The 3-state `observationTriage` policy (ADR `ci-config-policy-and-gate-
	 * family` §2) read at the triage rung. It governs the rung-internal
	 * ask-vs-auto distinction (the SELECTION-layer `off` gate is applied EARLIER, in
	 * the driver, by dropping the observation pool — so a rung that runs was either
	 * `ask`/`auto`-selected OR explicitly named, which BYPASSES the selection gate):
	 *   - `'auto'` ⇒ the conservative auto-disposition EXCEPTION is live (ask the
	 *     {@link TriageGate}; auto-dispose ONLY the no-question cases);
	 *   - `'ask'` / `'off'` / `undefined` ⇒ surface the promote/keep/delete question
	 *     and WAIT (the question-gated path). Under `off` + an EXPLICIT `obs:<slug>`
	 *     (which bypasses the selection gate) the rung runs in `ask`-mode — the
	 *     conservative, question-surfacing default (slice `## Decisions`). SURFACE +
	 *     APPLY stay ALWAYS allowed; this gate ONLY governs the auto-disposition
	 *     exception, never the always-allowed question loop.
	 */
	observationTriage?: ObservationTriage;
	/**
	 * The TRIAGE auto-disposition gate seam — the fresh-context spawn the triage
	 * rung asks (ONLY when `observationTriage` is `'auto'`) whether an observation
	 * is a no-question case. The skill JUDGES; the engine ACTS. Production wires
	 * {@link harnessTriageGate}; tests inject a stub decision. `undefined` ⇒ the
	 * triage rung defaults to {@link harnessTriageGate} (a NullHarness, no real
	 * model) so the seam is never a crash.
	 */
	triageGate?: TriageGate;
	/** The model the TRIAGE agent runs on (de-correlated, like `surfaceModel`). */
	triageModel?: string;
	/**
	 * Execute the conservative auto-disposition ATOMICALLY (record + marker, one
	 * commit). Tests inject a spy; production uses {@link autoDispositionObservation}.
	 */
	autoDisposition?: (options: AutoDispositionOptions) => AutoDispositionResult;
	/**
	 * Promote an answered observation: CAS-create a new backlog stub keyed on the
	 * NEW item's identity, then record + resolve the observation. Tests inject a
	 * spy; production uses {@link promoteObservation}.
	 */
	promote?: (
		options: PromoteObservationOptions,
	) => Promise<PromoteObservationResult>;
	/**
	 * The NEW backlog slug an answered promote drafts. `undefined` ⇒ the promote
	 * defaults to the observation's own slug. Lets a test (or a future driver) steer
	 * the promoted item's identity WITHOUT inventing the answer.
	 */
	promoteSlug?: string;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/** The options one `advance` tick consumes. */
export interface AdvanceOptions extends AdvanceContext {
	/**
	 * The raw CLI slug argument: bare (= slice), `slice:<slug>`, `prd:<slug>`, or
	 * `obs:<slug>` / `observation:<slug>`. Omit/empty ⇒ the bare eligible-SET form,
	 * which needs the driver slice (a clear error here — see `## Decisions`).
	 */
	arg?: string;
	/** The repo working-tree root whose `work/` to read (defaults to `cwd`). */
	repoPath?: string;
	/** The read seam for the resolver's cross-namespace existence check. */
	read?: LedgerReadStrategy;
	/** The rung executor seam (defaults to {@link defaultRungExecutor}). */
	executor?: RungExecutor;
	/** Inject the classify signals (tests); production reads them from disk. */
	readSignals?: (input: ReadSignalsInput) => ItemSignals;
	/** Inject the lock acquire (tests); production uses {@link acquireAdvancingLock}. */
	acquireLock?: (item: string) => Promise<AcquireAdvancingLockResult>;
	/** Inject the lock release (tests); production uses {@link releaseAdvancingLock}. */
	releaseLock?: (item: string) => Promise<ReleaseAdvancingLockResult>;
}

/** The tick's terminal result. */
export interface AdvanceResult {
	exitCode: AdvanceExitCode;
	outcome: AdvanceOutcome;
	/** The classified rung kind, when the tick got far enough to classify. */
	rung?: TickClassification['kind'];
	/** The resolved bare slug acted on, when one was resolved. */
	slug?: string;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/** The two classify SIGNALS read off the item (the only state the classifier needs). */
export interface ItemSignals {
	/** The item-body `needsAnswers` flag. */
	needsAnswers: boolean | undefined;
	/** The parsed ACTIVE sidecar, or `undefined` when none exists. */
	sidecar: SidecarModel | undefined;
}

/** What {@link readItemSignals} needs to read an item's two signals off disk. */
export interface ReadSignalsInput {
	/** The repo working-tree root. */
	repoPath: string;
	/** The item type (slice / prd / observation). */
	type: SidecarType;
	/** The bare slug. */
	slug: string;
	/** The canonical namespaced identity (`<namespace>:<slug>`). */
	item: string;
}

/** Map the resolver's namespace onto the sidecar type. */
function sidecarTypeFor(namespace: SlugNamespace): SidecarType {
	return namespace === 'observation'
		? 'observation'
		: namespace === 'brief'
			? 'brief'
			: 'task';
}

/**
 * Read an item's two CLASSIFY signals off disk (read-only, NO model, NO lock):
 *   - `needsAnswers` from the item-body frontmatter (searching the lifecycle
 *     folders the type may rest in), and
 *   - the ACTIVE sidecar (`work/questions/<type>-<slug>.md`) parsed when present.
 *
 * Identity-keyed: the sidecar path derives PURELY from `<type>-<slug>` (it
 * survives the item's `git mv`s with no lock-step move). Returns
 * `needsAnswers:undefined` when no item file is found (the classifier treats it
 * as "not gated", an ANALYSE rung) — the verb's job here is to wire the two
 * signals, not to assert the item exists (that is the rung's concern).
 */
export function readItemSignals(input: ReadSignalsInput): ItemSignals {
	const {repoPath, type, slug, item} = input;
	const needsAnswers = readNeedsAnswers(repoPath, type, slug);
	const sidecarRel = sidecarPathFor(item);
	const sidecarAbs = join(repoPath, sidecarRel);
	let sidecar: SidecarModel | undefined;
	if (existsSync(sidecarAbs)) {
		sidecar = parseSidecar(readFileSync(sidecarAbs, 'utf8'));
	}
	return {needsAnswers, sidecar};
}

/**
 * The lifecycle folders each item type may rest in (frontmatter source). After
 * the capstone cut-over (slice
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`) the transient
 * `slicing/` folder is GONE — a brief rests in `briefs/ready` (source) or
 * `briefs/tasked` (sliced); while it is being sliced the body STAYS in
 * `briefs/ready` (the lock no longer moves it), so `slicing/` is never a
 * frontmatter source.
 */
const FOLDERS_FOR_TYPE: Record<SidecarType, readonly WorkFolderKey[]> = {
	task: ['tasks-todo', 'in-progress', 'done'],
	brief: ['briefs-ready', 'briefs-tasked'],
	observation: ['observations'],
};

/** Read `needsAnswers` off the FIRST `work/<folder>/<slug>.md` that exists. */
function readNeedsAnswers(
	repoPath: string,
	type: SidecarType,
	slug: string,
): boolean | undefined {
	for (const folder of FOLDERS_FOR_TYPE[type]) {
		const abs = workItemPath(repoPath, folder, slug);
		if (existsSync(abs)) {
			return parseFrontmatter(readFileSync(abs, 'utf8')).needsAnswers;
		}
	}
	return undefined;
}

/**
 * The PRODUCTION rung executor: build/slice rungs ORCHESTRATE the existing
 * `do`/`do prd:` machinery ({@link performDo}); the `surface`/`apply`/
 * `triage-observation` rung bodies are filled by their own slices
 * ({@link surfaceRung} / {@link applyRung} / {@link triageRung}). It NEVER
 * re-implements the build/slice path — it hands the resolved arg to `performDo`,
 * which spans both namespaces (the slice path is the `do prd:` rung the PRD's
 * 2026-06-09 UPDATE confirms routes through `performIntegration`).
 */
export const defaultRungExecutor: RungExecutor = {
	async buildTask(input) {
		return orchestrateDo(input);
	},
	async taskBrief(input) {
		return orchestrateDo(input);
	},
	async triageObservation(input) {
		return triageRung(input);
	},
	async surface(input) {
		return surfaceRung(input);
	},
	async apply(input) {
		return applyRung(input);
	},
};

/**
 * ORCHESTRATE `do`/`do prd:` for the build-slice / slice-prd rungs: hand the
 * resolved namespaced identity to {@link performDo} (the ONE build path / ONE
 * slice path). `advance` is a driver ON TOP — it does NOT duplicate `do`. The
 * `do` outcome is mapped back onto the tick's outcome surface.
 */
async function orchestrateDo(input: RungExecInput): Promise<RungExecResult> {
	const {item, context} = input;
	const base = context.doOptions;
	if (base === undefined) {
		// The skeleton can classify + lock + DISPATCH without `do` options wired
		// (the driver slice threads them). Report it honestly rather than crash —
		// the orchestration TARGET is `performDo`, named here, not re-implemented.
		return {
			exitCode: 1,
			outcome: 'usage-error',
			message:
				`advance would ORCHESTRATE \`do ${item}\` for this rung, but no \`do\` ` +
				`options were threaded into the tick (the driver slice wires them).`,
		};
	}
	// The ORCHESTRATION TARGET is `performDo` by DEFAULT (in-place, the cwd checkout
	// IS the isolation), or the injected {@link AdvanceContext.doDriver} — the
	// registry-set advance driver threads a PER-MIRROR JOB-WORKTREE driver so the
	// daemon/CI build runs isolated off the mirror's arbiter. Either way `advance`
	// ORCHESTRATES `do` (the ONE build path / ONE slice path) — it does NOT duplicate it.
	const driver = context.doDriver ?? performDo;
	const result: DoResult = await driver({...base, arg: item});
	return {
		exitCode: result.exitCode,
		outcome: result.exitCode === 0 ? 'advanced' : mapDoOutcome(result),
		message: result.message,
	};
}

/** Map a non-zero `do` result onto the tick's outcome vocabulary. */
function mapDoOutcome(result: DoResult): AdvanceOutcome {
	switch (result.outcome) {
		case 'lost':
			return 'lost';
		case 'contended':
			return 'contended';
		default:
			return 'usage-error';
	}
}

/**
 * The SURFACE rung BODY (slice `advance-rung-surface`, US #32/33): the FIRST rung
 * filling the executor seam, establishing the spawn→emit→persist pattern the
 * other rung bodies reuse. Under the `advancing` CAS lock (held by
 * {@link performAdvance} BEFORE this runs — so the expensive spawn is POST-lock,
 * winner-only), it:
 *
 *   1. spawns a FRESH-CONTEXT agent with `surface-questions` loaded (the
 *      {@link SurfaceGate} seam, mirroring the review gate's `review` spawn) and
 *      collects the EMITTED questions — the skill JUDGES, writes nothing; and
 *   2. has the ENGINE ITSELF write/append them to the sidecar CAS-atomically AND
 *      set `needsAnswers:true` in the SAME commit
 *      ({@link persistSurfacedQuestions}) — the engine PERSISTS.
 *
 * Append-never-overwrite: a re-surface ADDS `qN+1` and flips a previously-all-
 * answered sidecar back to not-all-answered (the persist owns that). An EMPTY
 * emit (the skill's honest "no open judgement") writes nothing and reports it.
 */
async function surfaceRung(input: RungExecInput): Promise<RungExecResult> {
	const {item, context} = input;
	const note = context.note ?? (() => {});
	const cwd = context.cwd;

	// Locate the item file (the only thing the persist needs beyond the questions:
	// the file to set `needsAnswers:true` on). The sidecar path is identity-derived,
	// not folder-derived, so only the ITEM file's folder must be found.
	const itemPath = findItemPath(cwd, input.namespace, input.slug);
	if (itemPath === undefined) {
		return vanishedSkip({rung: 'surface', item});
	}

	// 1. SPAWN the fresh-context `surface-questions` agent (the skill JUDGES). The
	//    expensive model work is POST-lock (the lock is held by `performAdvance`).
	const gate = context.surfaceGate ?? harnessSurfaceGate();
	let emit;
	try {
		emit = await gate({
			item,
			cwd,
			surfaceModel: context.surfaceModel,
		});
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return {
			exitCode: 1,
			outcome: 'usage-error',
			message: `surface ${item}: the surface-questions agent produced no usable emit (${detail}).`,
		};
	}

	// 2. The ENGINE persists (the skill wrote nothing): append-or-create the sidecar
	//    + set `needsAnswers:true` in ONE commit (CAS-atomic under the held lock).
	const persist = context.surfacePersist ?? persistSurfacedQuestions;
	const result = persist({
		cwd,
		item,
		itemPath,
		questions: toNewQuestions(emit),
		note,
	});
	if (result.outcome === 'nothing') {
		return {
			exitCode: 0,
			outcome: 'no-op',
			message: `surface ${item}: no open judgement — nothing surfaced.`,
		};
	}
	return {
		exitCode: 0,
		outcome: 'advanced',
		message:
			`surfaced ${result.entryCount} question(s) for ${item} → ${result.sidecarPath} ` +
			`(needsAnswers:true, CAS-atomic).`,
	};
}

/**
 * The observation TRIAGE rung BODY (slice `advance-rung-triage`, US #16/17/23):
 * the rung the classifier picks for an UNTRIAGED observation (`needsAnswers` not
 * set, no sidecar). It is QUESTION-GATED BY DEFAULT: it surfaces a promote/keep/
 * delete question and WAITS — so "is this worth building?" is NEVER decided
 * autonomously. A CONSERVATIVE `observationTriage: 'auto'`-gated EXCEPTION (US #17,
 * high bar) may auto-disposition ONLY the no-question cases:
 *
 *   - **default (question-gated):** delegate to {@link surfaceRung} — spawn the
 *     `surface-questions` agent (it emits the triage promote/keep/delete question
 *     with a `disposition`) and the ENGINE persists the sidecar + `needsAnswers`.
 *     The disposition routing is then executed by the APPLY rung when the human
 *     answers. Surface stays ALWAYS allowed (US #23) — this path runs under
 *     `ask`/`off` (and `off` + an explicit `obs:` runs in this `ask`-mode).
 *   - **`auto` exception:** ONLY under `observationTriage: 'auto'`, ask the
 *     {@link TriageGate} whether the observation is a no-question case. If it emits
 *     `auto: true` (`duplicate` → suggest delete; `map` → unambiguous map onto an
 *     existing item), the engine auto-dispositions it WITHOUT a question
 *     ({@link autoDispositionObservation}). It NEVER auto-deletes a non-duplicate
 *     (a `duplicate` only RECOMMENDS deletion — the human deletes) and NEVER
 *     auto-promotes a judgement call (`auto: false` ⇒ fall back to the surface
 *     question). Promotion is ALWAYS a human answer (the apply path).
 *
 * Under the `advancing` CAS lock (held by {@link performAdvance} BEFORE this runs),
 * so the expensive spawn is POST-lock, winner-only.
 */
async function triageRung(input: RungExecInput): Promise<RungExecResult> {
	const {item, context} = input;
	const note = context.note ?? (() => {});
	const cwd = context.cwd;

	// The CONSERVATIVE auto-disposition EXCEPTION — ONLY under `observationTriage:
	// 'auto'`. Under `'ask'`/`'off'`/unset (including `off` + an EXPLICIT obs:<slug>
	// that bypassed the selection gate), EVERY untriaged observation surfaces the
	// question (the always-allowed path), so "worth building?" is never decided
	// autonomously — `off` + explicit runs in the conservative `ask`-mode.
	if (context.observationTriage === 'auto') {
		const itemPath = findItemPath(cwd, input.namespace, input.slug);
		if (itemPath === undefined) {
			return vanishedSkip({rung: 'triage', item});
		}
		const gate = context.triageGate ?? harnessTriageGate();
		let decision;
		try {
			decision = await gate({item, cwd, triageModel: context.triageModel});
		} catch (err) {
			// A gate failure is NOT a reason to auto-dispose — fall back to the SAFE
			// question-gated path (surface the question), never the reverse.
			const detail = err instanceof Error ? err.message : String(err);
			note(
				`triage ${item}: the auto-triage gate produced no usable emit (${detail}); ` +
					'falling back to the question-gated surface path.',
			);
			decision = {auto: false as const};
		}
		if (decision.auto === true) {
			// A no-question case (duplicate / map) — auto-disposition WITHOUT a
			// question. NEVER auto-deletes a non-duplicate; NEVER auto-promotes.
			const dispose = context.autoDisposition ?? autoDispositionObservation;
			const result = dispose({
				cwd,
				item,
				itemPath,
				kind: decision.kind,
				existing: decision.existing,
				reason: decision.reason,
				note,
			});
			return {exitCode: 0, outcome: 'advanced', message: result.message};
		}
		// `auto: false` ⇒ a judgement call. Fall through to the surface question.
	}

	// DEFAULT (question-gated): surface the promote/keep/delete question + WAIT.
	// This REUSES the surface rung verbatim (the `surface-questions` skill emits the
	// triage question with a `disposition`); the apply rung executes the answer.
	return surfaceRung(input);
}

/**
 * The APPLY rung BODY (slice `advance-rung-apply`, US #11/14/15/29/30): when the
 * classifier says `apply` (ALL sidecar entries answered), apply the HUMAN's
 * answers to the item ATOMICALLY (item body + sidecar in ONE commit, via the
 * sidecar contract's {@link applyAtomic}) — then EITHER append newly-discovered
 * questions (stay `needsAnswers:true`, re-pause) OR resolve fully (clear
 * `needsAnswers` + DELETE the sidecar in the SAME commit) OR disposition the item
 * to a terminal (advance / dropped / needs-attention / keep / delete).
 *
 * Under the `advancing` CAS lock (held by {@link performAdvance} BEFORE this runs
 * — so the work is POST-lock, winner-only), it delegates to the engine-owned
 * {@link applyAnsweredQuestions} persist (sibling of the surface rung's persist).
 * ALWAYS allowed (no gate). NEVER invents an answer — it applies ONLY the
 * human-authored `answer:` text + `disposition:` field; a subset-answered sidecar
 * is not even classified `apply` (the classifier NO-OPs), asserted in the persist.
 */
async function applyRung(input: RungExecInput): Promise<RungExecResult> {
	const {item, context} = input;
	const note = context.note ?? (() => {});
	const cwd = context.cwd;

	const itemPath = findItemPath(cwd, input.namespace, input.slug);
	if (itemPath === undefined) {
		return vanishedSkip({rung: 'apply', item});
	}

	// OBSERVATION → an answered "promote" is the triage rung's new-item creation
	// (US #24): the apply-persist deliberately does NOT treat `promote-*` as a
	// terminal (it would plain-resolve THIS item) — the promotion is a NEW item's
	// creation through the CAS, keyed on the new item's identity. Route it here.
	if (
		input.namespace === 'observation' &&
		!(context.applyFollowups && context.applyFollowups.length > 0) &&
		isPromoteAnswered(cwd, item)
	) {
		const promote = context.promote ?? promoteObservation;
		try {
			const result = await promote({
				cwd,
				item,
				itemPath,
				newSlug: context.promoteSlug,
				arbiter: context.arbiter,
				note,
			});
			return {
				exitCode: result.exitCode,
				outcome:
					result.outcome === 'promoted'
						? 'advanced'
						: result.outcome === 'lost'
							? 'lost'
							: result.outcome === 'contended'
								? 'contended'
								: 'usage-error',
				message: result.message,
			};
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			return {
				exitCode: 1,
				outcome: 'usage-error',
				message: `promote ${item}: ${detail}`,
			};
		}
	}

	const apply = context.applyPersist ?? applyAnsweredQuestions;
	try {
		const result = apply({
			cwd,
			item,
			itemPath,
			appendQuestions: context.applyFollowups,
			note,
		});
		// Map the apply persist's outcome to the rung's outcome. `vanished` is the
		// F3a clean-exit case (item was gone between capture and write, e.g. a
		// concurrent promote); benign skip, exitCode 0, distinct from `no-op`.
		const mapped: AdvanceOutcome =
			result.outcome === 'repaused'
				? 'no-op'
				: result.outcome === 'vanished'
					? 'vanished'
					: 'advanced';
		return {
			exitCode: 0,
			outcome: mapped,
			message: result.message,
		};
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return {
			exitCode: 1,
			outcome: 'usage-error',
			message: `apply ${item}: ${detail}`,
		};
	}
}

/**
 * The cross-tick-window BENIGN SKIP shared by all three rungs that need to
 * resolve an item file (surface / triage / apply). The lifecycle pool enumerated
 * the item at scan-time, but by the time this leg ran a sibling parallel leg had
 * already triaged/settled/deleted it. At the ~33-way CI matrix scale this is a
 * CALM, EXPECTED condition — making it an exit-1 "a human must reconcile" turned
 * the matrix into a wall of red. It is now a `vanished` outcome (`exitCode: 0`,
 * distinguishable from `no-op`) carrying a clear message naming the rung + item.
 * (See slice `observation-identity-is-its-filename-not-a-foreign-slug`.)
 */
function vanishedSkip(input: {
	rung: 'surface' | 'triage' | 'apply';
	item: string;
}): RungExecResult {
	return {
		exitCode: 0,
		outcome: 'vanished',
		message:
			`advance classified the '${input.rung}' rung for ${input.item} but its ` +
			`item file was gone from work/ by the time the leg ran (a sibling leg ` +
			`likely triaged/settled/deleted it between enumerate and run) — benign ` +
			`skip.`,
	};
}

/**
 * Find the item file `work/<folder>/<slug>.md` for a type, across the lifecycle
 * folders it may rest in (the SAME folder set {@link readNeedsAnswers} searches).
 * Returns the path RELATIVE to `cwd`, or `undefined` when no file exists.
 */
function findItemPath(
	cwd: string,
	namespace: SlugNamespace,
	slug: string,
): string | undefined {
	const type = sidecarTypeFor(namespace);
	for (const folder of FOLDERS_FOR_TYPE[type]) {
		const rel = workItemRel(folder, `${slug}.md`);
		if (existsSync(join(cwd, rel))) {
			return rel;
		}
	}
	return undefined;
}

/**
 * Does the OBSERVATION's answered sidecar carry a `promote-task`/`promote-adr`
 * disposition on an ANSWERED entry? The signal the apply rung uses to route to the
 * triage rung's new-item-creation CAS (US #24) instead of the plain resolve. Read
 * from disk (the classifier already confirmed all-answered; this only reads the
 * disposition). Absent/unreadable sidecar ⇒ not a promote (the plain apply path).
 */
function isPromoteAnswered(cwd: string, item: string): boolean {
	const sidecarAbs = join(cwd, sidecarPathFor(item));
	if (!existsSync(sidecarAbs)) {
		return false;
	}
	let model;
	try {
		model = parseSidecar(readFileSync(sidecarAbs, 'utf8'));
	} catch {
		return false;
	}
	return model.entries.some(
		(entry) =>
			isEntryAnswered(entry) &&
			(entry.disposition === 'promote-task' ||
				entry.disposition === 'promote-adr'),
	);
}

/**
 * Run ONE `advance` tick over a SINGLE named item: classify → lock → dispatch →
 * release. The pure tick the drivers (later slices) wrap. The expensive phase is
 * ALWAYS post-lock — a CAS loser backs off having done ONLY the free
 * classification (it never reaches the executor).
 */
export async function performAdvance(
	options: AdvanceOptions,
): Promise<AdvanceResult> {
	const note = options.note ?? (() => {});
	const cwd = options.cwd;
	const repoPath = options.repoPath ?? cwd;
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;

	// {@link performAdvance} is the SINGLE-item tick. The bare `advance`
	// (eligible-SET) form is the DRIVER's job ({@link performAdvanceAuto} in
	// `advance-drivers.ts`, which selects over the pool + runs THIS tick per item) —
	// the tick itself REQUIRES a named item, so an empty arg here is a usage error
	// (the CLI dispatches the bare form to the driver before reaching here).
	if (options.arg === undefined || options.arg.trim() === '') {
		const message =
			'`advance` with no item is the eligible-SET form (the one-shot driver). ' +
			'The single-item tick needs a named item: ' +
			'`advance <slug>` / `advance brief:<slug>` / `advance obs:<slug>`.';
		note(message);
		return {exitCode: 1, outcome: 'usage-error', message};
	}

	// 1. RESOLVE the arg via the SHARED resolver (extended with `obs:`). `advance`
	//    spans slice / prd / observation; a collision / bad arg is a loud usage error.
	let resolved;
	try {
		resolved = resolveAdvanceArg({
			arg: options.arg,
			repoPath,
			read: options.read ?? ledgerRead,
		});
	} catch (err) {
		if (err instanceof SlugResolutionError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}

	const type = sidecarTypeFor(resolved.namespace);
	const item = `${resolved.namespace}:${resolved.slug}`;

	// 2. CLASSIFY — read-only, NO model, NO lock. Read the two signals + run the
	//    pure classifier. This is the ONLY work a CAS loser will have spent.
	const readSignals = options.readSignals ?? readItemSignals;
	const signals = readSignals({repoPath, type, slug: resolved.slug, item});
	const classification = classifyTick({
		type,
		needsAnswers: signals.needsAnswers,
		sidecar: signals.sidecar,
	});

	// A NO-OP (pending sidecar / nothing eligible) or an invariant violation never
	// takes the lock — there is nothing to execute, so do NOT pay the CAS.
	if (classification.kind === 'no-op') {
		const message = `no-op for ${item} (${classification.reason ?? 'nothing to advance'}).`;
		note(message);
		return {
			exitCode: 0,
			outcome: 'no-op',
			rung: 'no-op',
			slug: resolved.slug,
			message,
		};
	}
	if (classification.kind === 'invariant-violation') {
		const message =
			`refusing to advance ${item}: the \`needsAnswers\` flag and the sidecar ` +
			`disagree (${classification.reason ?? 'invariant violation'}). ` +
			`A human must reconcile them.`;
		note(message);
		return {
			exitCode: 1,
			outcome: 'invariant-violation',
			rung: 'invariant-violation',
			slug: resolved.slug,
			message,
		};
	}

	// 3. LOCK — take the `advancing` CAS borrow for the classified rung, keyed on
	//    the item's `<type>-<slug>` identity. The expensive phase is POST-lock.
	//
	//    UNIFIED PER-ITEM LOCK, TREE-LESS RUNGS ONLY (PRD
	//    `ledger-status-per-item-lock-refs` US #1/#3/#18; ADR
	//    `ledger-status-on-per-item-lock-refs`). The rung kind is KNOWN here
	//    (`classification.kind`, classified pre-lock), so the tree-less-only policy
	//    lives HERE — where the rung is known — and `advancing-lock.ts` stays
	//    rung-agnostic (it only learns "unified or not" via `acquireUnified`). For a
	//    TREE-LESS rung (`surface`/`apply`/`triage-observation`) the advancing acquire
	//    ALSO takes the item's unified lock (`action: advance`) — these rungs have NO
	//    inner `do`, so the unified hold is what realises advance∥claim / advance∥slice
	//    exclusion. For a BUILD-SLICE / SLICE-PRD rung we do NOT take the unified lock
	//    at the advance layer: `performAdvance` ORCHESTRATES an inner `performDo` that
	//    ITSELF acquires the SAME `slice-<slug>`/`prd-<slug>` ref (the create-only CAS
	//    with NO re-entrancy/auto-steal, per the ADR), so taking it here too would
	//    DEADLOCK the tick against itself. The inner `do`'s claim/slice lock IS the
	//    single exclusion point for those rungs. The `work/advancing/<entry>.md` marker
	//    CAS is KEPT for ALL rungs (its removal is the capstone slice #9).
	const unifiedForRung = isTreeLessRung(classification.kind);
	const acquire =
		options.acquireLock ??
		((lockItem: string) =>
			acquireAdvancingLock({
				item: lockItem,
				cwd,
				arbiter,
				acquireUnified: unifiedForRung,
				note,
			}));
	const lock = await acquire(item);
	if (lock.exitCode !== 0) {
		// A CAS LOSER (exit 2) or contended (exit 3) backs off having spent ONLY the
		// free classification above — it never reaches the executor.
		return {
			exitCode: lock.exitCode,
			outcome: lock.outcome === 'lost' ? 'lost' : 'contended',
			rung: classification.kind,
			slug: resolved.slug,
			message: lock.message,
		};
	}

	// 4. EXECUTE — WINNER ONLY: dispatch the classified rung to the executor seam,
	//    then ALWAYS release the borrow (the item never moved; release is clean).
	const executor = options.executor ?? defaultRungExecutor;
	const release =
		options.releaseLock ??
		((lockItem: string) =>
			releaseAdvancingLock({
				item: lockItem,
				cwd,
				arbiter,
				releaseUnified: unifiedForRung,
				note,
			}));
	try {
		const exec = await dispatchRung(executor, {
			item,
			namespace: resolved.namespace,
			slug: resolved.slug,
			classification,
			context: {
				cwd,
				arbiter,
				doOptions: options.doOptions,
				doDriver: options.doDriver,
				surfaceGate: options.surfaceGate,
				surfaceModel: options.surfaceModel,
				surfacePersist: options.surfacePersist,
				applyPersist: options.applyPersist,
				applyFollowups: options.applyFollowups,
				observationTriage: options.observationTriage,
				triageGate: options.triageGate,
				triageModel: options.triageModel,
				autoDisposition: options.autoDisposition,
				promote: options.promote,
				promoteSlug: options.promoteSlug,
				note,
			},
		});
		return {
			exitCode: exec.exitCode,
			outcome: exec.outcome,
			rung: classification.kind,
			slug: resolved.slug,
			message: exec.message,
		};
	} finally {
		await release(item);
	}
}

/**
 * Is this a TREE-LESS rung (`surface`/`apply`/`triage-observation`) — the rungs
 * that have NO inner `performDo`, so the advancing acquire must ALSO take the
 * unified per-item lock (`action: advance`) to realise advance∥claim / advance∥slice
 * exclusion? The build/slice rungs (`build-slice`/`slice-prd`) are the inverse:
 * their inner `do` holds the SAME unified ref, so the advance layer must NOT take
 * it (it would deadlock the tick against itself). `no-op`/`invariant-violation`
 * never reach the lock step. This is the single place the tree-less-only policy
 * is expressed (the rung is known here); `advancing-lock.ts` stays rung-agnostic.
 */
function isTreeLessRung(kind: TickClassification['kind']): boolean {
	return (
		kind === 'surface' || kind === 'apply' || kind === 'triage-observation'
	);
}

/** Dispatch the classified rung to the executor seam (winner-only). */
function dispatchRung(
	executor: RungExecutor,
	input: RungExecInput,
): Promise<RungExecResult> {
	switch (input.classification.kind) {
		case 'build-slice':
			return executor.buildTask(input);
		case 'slice-prd':
			return executor.taskBrief(input);
		case 'triage-observation':
			return executor.triageObservation(input);
		case 'surface':
			return executor.surface(input);
		case 'apply':
			return executor.apply(input);
		default:
			// `no-op` / `invariant-violation` never reach here (handled pre-lock).
			return Promise.resolve({
				exitCode: 1,
				outcome: 'usage-error',
				message: `unexpected rung kind '${input.classification.kind}' at dispatch.`,
			});
	}
}
