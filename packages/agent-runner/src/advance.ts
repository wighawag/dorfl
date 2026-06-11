import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
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
 * What this slice does NOT do (LATER slices):
 *   - The **rung BODIES** for `surface` / `apply` / `triage-observation` — they
 *     dispatch to a clearly-named executor SEAM ({@link RungExecutor}) those
 *     slices fill. The default executor returns a clean `not-implemented` result
 *     (never a crash) so the skeleton is observable end-to-end today.
 *   - The two **DRIVERS** (one-shot sequential / loop) + `-n` + the per-action
 *     gates (`allowAgents`/`autoSlice`/`autoTriage`) — slice
 *     `advance-drivers-and-gates`.
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

/** The terminal condition of one `advance` tick (mirrors `DoOutcome`'s shape). */
export type AdvanceOutcome =
	| 'advanced'
	| 'no-op'
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
	buildSlice(input: RungExecInput): Promise<RungExecResult>;
	/** A ready PRD → slice it by ORCHESTRATING `do prd:<slug>` (NOT a re-implementation). */
	slicePrd(input: RungExecInput): Promise<RungExecResult>;
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
		: namespace === 'prd'
			? 'prd'
			: 'slice';
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

/** The lifecycle folders each item type may rest in (frontmatter source). */
const FOLDERS_FOR_TYPE: Record<SidecarType, readonly string[]> = {
	slice: ['backlog', 'in-progress', 'done'],
	prd: ['prd', 'slicing', 'prd-sliced'],
	observation: ['observations'],
};

/** Read `needsAnswers` off the FIRST `work/<folder>/<slug>.md` that exists. */
function readNeedsAnswers(
	repoPath: string,
	type: SidecarType,
	slug: string,
): boolean | undefined {
	for (const folder of FOLDERS_FOR_TYPE[type]) {
		const abs = join(repoPath, 'work', folder, `${slug}.md`);
		if (existsSync(abs)) {
			return parseFrontmatter(readFileSync(abs, 'utf8')).needsAnswers;
		}
	}
	return undefined;
}

/**
 * The PRODUCTION rung executor: build/slice rungs ORCHESTRATE the existing
 * `do`/`do prd:` machinery ({@link performDo}); surface/apply/triage rungs return
 * a clean `not-implemented` result (their bodies are LATER slices). It NEVER
 * re-implements the build/slice path — it hands the resolved arg to `performDo`,
 * which spans both namespaces (the slice path is the `do prd:` rung the PRD's
 * 2026-06-09 UPDATE confirms routes through `performIntegration`).
 */
export const defaultRungExecutor: RungExecutor = {
	async buildSlice(input) {
		return orchestrateDo(input);
	},
	async slicePrd(input) {
		return orchestrateDo(input);
	},
	async triageObservation(input) {
		return notImplemented('triage-observation', input);
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
	const result: DoResult = await performDo({...base, arg: item});
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
		return {
			exitCode: 1,
			outcome: 'usage-error',
			message:
				`advance classified the 'surface' rung for ${item} but could not find ` +
				`its item file under work/ — a human must reconcile the item's location.`,
		};
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
 * The APPLY rung BODY (slice `advance-rung-apply`, US #11/14/15/29/30): when the
 * classifier says `apply` (ALL sidecar entries answered), apply the HUMAN's
 * answers to the item ATOMICALLY (item body + sidecar in ONE commit, via the
 * sidecar contract's {@link applyAtomic}) — then EITHER append newly-discovered
 * questions (stay `needsAnswers:true`, re-pause) OR resolve fully (clear
 * `needsAnswers` + DELETE the sidecar in the SAME commit) OR disposition the item
 * to a terminal (advance / out-of-scope / needs-attention / keep / delete).
 *
 * Under the `advancing` CAS lock (held by {@link performAdvance} BEFORE this runs
 * — so the work is POST-lock, winner-only), it delegates to the engine-owned
 * {@link applyAnsweredQuestions} persist (sibling of the surface rung's persist).
 * ALWAYS allowed (no gate). NEVER invents an answer — it applies ONLY the
 * human-authored `answer:` text + `disposition:` field; a subset-answered sidecar
 * is not even classified `apply` (the classifier NO-OPs), asserted in the persist.
 */
function applyRung(input: RungExecInput): RungExecResult {
	const {item, context} = input;
	const note = context.note ?? (() => {});
	const cwd = context.cwd;

	const itemPath = findItemPath(cwd, input.namespace, input.slug);
	if (itemPath === undefined) {
		return {
			exitCode: 1,
			outcome: 'usage-error',
			message:
				`advance classified the 'apply' rung for ${item} but could not find ` +
				`its item file under work/ — a human must reconcile the item's location.`,
		};
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
		return {
			exitCode: 0,
			outcome: result.outcome === 'repaused' ? 'no-op' : 'advanced',
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
		const rel = `work/${folder}/${slug}.md`;
		if (existsSync(join(cwd, rel))) {
			return rel;
		}
	}
	return undefined;
}

/** A clean "this rung's body is a LATER slice" result (never a crash). */
function notImplemented(rung: string, input: RungExecInput): RungExecResult {
	return {
		exitCode: 1,
		outcome: 'not-implemented',
		message:
			`advance classified the '${rung}' rung for ${input.item} and HELD the ` +
			`advancing lock, but this rung's body is a later slice ` +
			`(advance-rungs). Skeleton wired; executor seam not yet filled.`,
	};
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

	// The bare `advance` (eligible-SET) form needs the pool scan / driver — a LATER
	// slice. Error CLEARLY here rather than silently no-op (recorded in `## Decisions`).
	if (options.arg === undefined || options.arg.trim() === '') {
		const message =
			'`advance` with no item is the eligible-SET form, which needs the ' +
			'driver slice (advance-drivers-and-gates). Name a single item: ' +
			'`advance <slug>` / `advance prd:<slug>` / `advance obs:<slug>`.';
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
	const acquire =
		options.acquireLock ??
		((lockItem: string) =>
			acquireAdvancingLock({item: lockItem, cwd, arbiter, note}));
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
			releaseAdvancingLock({item: lockItem, cwd, arbiter, note}));
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
				surfaceGate: options.surfaceGate,
				surfaceModel: options.surfaceModel,
				surfacePersist: options.surfacePersist,
				applyPersist: options.applyPersist,
				applyFollowups: options.applyFollowups,
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

/** Dispatch the classified rung to the executor seam (winner-only). */
function dispatchRung(
	executor: RungExecutor,
	input: RungExecInput,
): Promise<RungExecResult> {
	switch (input.classification.kind) {
		case 'build-slice':
			return executor.buildSlice(input);
		case 'slice-prd':
			return executor.slicePrd(input);
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
