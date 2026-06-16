import {
	performAdvance,
	type AdvanceContext,
	type AdvanceResult,
	type AdvanceExitCode,
	type AdvanceOutcome,
} from './advance.js';
import {
	pushTreelessResult,
	TREELESS_RUNGS,
} from './advance-treeless-publish.js';
import {scanRepoPaths} from './scan.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {
	selectPrioritised,
	sliceablePrds,
	type PrdCandidate,
	type SelectedItem,
} from './select-priority.js';
import {gatherLifecycleInPlace} from './lifecycle-gather.js';
import type {LifecyclePoolGates} from './lifecycle-pools.js';
import type {Config} from './config.js';

/**
 * The **`advance` one-shot DRIVER** (PRD `advance-loop`, slice
 * `advance-drivers-and-gates`, US #2/7/23/25/26) — the SEQUENTIAL driver that
 * WRAPS the substrate-agnostic advance TICK ({@link performAdvance}) over named
 * item(s) or the bare eligible-SET form. It is the in-place counterpart of
 * `do-autopick`'s {@link performDoAuto}/{@link performDoArgs}: it SELECTS +
 * ORDERS items and runs the EXISTING tick per item, SEQUENTIALLY.
 *
 * **One substrate-agnostic TICK, two drivers (US #7).** The tick (classify →
 * lock → execute, already built in {@link performAdvance}) is the shared
 * contract. The TWO drivers wrap it:
 *
 *   - the **one-shot driver** (this module) — human `advance`-style or a CI
 *     invocation: runs the tick over named item(s) / the eligible set
 *     SEQUENTIALLY (`advance` is sequential, exactly like `do`);
 *   - the **loop driver** (`run`, `run.ts`) — loops the tick over the eligible
 *     set with genuine parallelism, each item lock-guarded by the `advancing`
 *     borrow (already in {@link performAdvance}). `run` ≡ CI (same tick, different
 *     substrate); NO new execution model is introduced.
 *
 * **`-n x` is ALWAYS SEQUENTIAL (US #25)** — a dumb "run the tick N times" loop,
 * for BOTH `do -n` ({@link performDoAuto}) and `advance -n` (here). Parallelism is
 * NEVER a property of `-n`; it comes only from `run` (the concurrent loop) or the
 * CI matrix.
 *
 * **The FLAT per-action gate family (US #23)** falls out of the SELECTION layer,
 * exactly as it does for `do`: the eligible-pool scan only SURFACES a build item
 * when `autoBuild` is on and a slice-a-PRD item when `autoSlice` is on (the gate
 * is a policy on the autonomous-SELECTION step, NOT on the explicit verb a human
 * typed — an explicitly-NAMED `advance <slug>` builds regardless, mirroring
 * `do <slice>` vs `autoBuild`). SURFACE + APPLY are ALWAYS allowed — they run
 * through the tick on any named item and are never pool-gated, so a repo with
 * EVERY flag off still gets the QUESTION LOOP (surface + apply) but no autonomous
 * build/slice in the bare/`-n` selection ("question loop with zero autonomy").
 * The triage rung's ask-vs-auto distinction (`observationTriage`) is read inside
 * the tick; its SELECTION-layer `off` gate drops the observation pool here.
 *
 * **Isolation + chaining FALL OUT (US #26):** this driver builds NO new isolation
 * or chaining machinery — it threads the SAME `AdvanceContext` the tick already
 * consumes (which orchestrates `do`/`do prd:` through the isolation-strategy seam
 * and rebase-before-integrate); a chain conflict routes to needs-attention as
 * today, inside the orchestrated `do`.
 */

/** The single-`advance` tick runner this driver drives per selected item. */
export type AdvanceTickRunner = (
	options: AdvanceTickOptions,
) => Promise<AdvanceResult>;

/** The per-item tick options: the run context + the one resolved arg. */
export interface AdvanceTickOptions extends AdvanceContext {
	arg: string;
	read?: LedgerReadStrategy;
}

/** Options shared with every per-item tick run, threaded verbatim. */
type SharedAdvanceContext = AdvanceContext;

export interface PerformAdvanceMultiOptions extends SharedAdvanceContext {
	/**
	 * The resolved repo config — provides `autoBuild` (the build gate for the
	 * slice pool), `autoSlice` (the slice-a-PRD gate for the PRD pool), and
	 * `selectionOrder` (the configurable cross-pool order). The per-action gate
	 * family is APPLIED HERE, at the selection layer (the policy-on-autonomous-
	 * selection point).
	 */
	config: Config;
	/**
	 * `advance -n <x>`: how many eligible items to advance, IN SEQUENCE. Bare
	 * `advance` (no arg, no count) ⇒ 1. SEQUENTIAL — never a parallelism knob
	 * (US #25; parallelism is `run` or the CI matrix).
	 */
	count?: number;
	/** Override the single-tick runner (tests inject a stub). Defaults to {@link performAdvance}. */
	run?: AdvanceTickRunner;
	/** Override the read seam (PRD pool); defaults to the active {@link ledgerRead}. */
	read?: LedgerReadStrategy;
	/**
	 * The LIFECYCLE-POOL create-gates (slice `advance-autopick-lifecycle-pools`),
	 * the internal hook the gate slices (`observation-triage-tri-state-gate` /
	 * `surface-blockers-gate`) will wire to the `observationTriage` /
	 * `surfaceBlockers` config read. INTERIM, born OFF: omitted ⇒ BOTH create-gates
	 * OFF, so the triage + surface sub-pools contribute NOTHING and a bare/`-n`
	 * `advance` auto-triages / auto-surfaces nothing (it changes no repo's
	 * behaviour). The apply sub-pool is NOT gated (consume is always-on), so an
	 * answered sidecar applies regardless. Tests FORCE the create-gates on through
	 * this same hook to exercise the triage/surface paths.
	 */
	lifecycleGates?: LifecyclePoolGates;
}

/** The aggregate result of a multi-item `advance` invocation. */
export interface AdvanceMultiResult {
	/** Each per-item {@link AdvanceResult}, in the order they ran. */
	results: AdvanceResult[];
	/**
	 * The process exit code for the whole invocation: 0 iff EVERY item that ran
	 * succeeded (or there was nothing eligible — an empty bare `advance` is not a
	 * failure); otherwise the first non-zero per-item exit code (the worst outcome
	 * surfaces). Mirrors `do`'s multi-item exit contract.
	 */
	exitCode: AdvanceExitCode;
	/** Human-readable summary (printed by the CLI). */
	message: string;
}

/**
 * The slice-pool caps for an in-place `advance` selection. `advance` (one-shot) is
 * per-repo + SEQUENTIAL, so the REAL bound is the requested `count`. We cap the
 * slice pool at "all eligible" and let {@link selectPrioritised}'s `count` trim
 * across both pools — identical to `do-autopick`'s {@link performDoAuto}.
 */
const ALL_ELIGIBLE = Number.MAX_SAFE_INTEGER;

/**
 * Run the BARE / `-n <x>` form: build the two ELIGIBLE pools for `cwd` (eligible
 * SLICES gated by `autoBuild`, sliceable PRDs gated by `autoSlice`), order them
 * (plus the lifecycle pools) per the resolved `selectionOrder` with `apply`
 * pinned first, take `count` (default 1), and run the EXISTING advance tick per
 * selected item, SEQUENTIALLY. The pools are the EXACT
 * `do-autopick` pools (the SAME `scoreItems`/`sliceablePrds` predicates), so the
 * per-action gate family is honoured by construction.
 *
 * The bare/`-n` selection draws ONLY from the autonomous pools (eligible slices +
 * sliceable PRDs); SURFACE + APPLY of a gated item are reached by NAMING the item
 * ({@link performAdvanceArgs}) — they are always-allowed and not pool-gated, so the
 * bare form with every flag off correctly selects NOTHING (zero autonomy) while a
 * named `advance <slug>` still surfaces/applies.
 */
export async function performAdvanceAuto(
	options: PerformAdvanceMultiOptions,
): Promise<AdvanceMultiResult> {
	const run = options.run ?? performAdvance;
	const read = options.read ?? ledgerRead;
	const note = options.note ?? (() => {});
	const cwd = options.cwd;
	const count = options.count ?? 1;

	// Pool 1 — eligible SLICES via the EXISTING scan/select path. `scoreItems`
	// inside `scanRepoPaths` gates eligibility on `autoBuild` (the build gate), so
	// with `autoBuild` off NO slice is selected — the build rung is never reached
	// by the bare/`-n` selection.
	const report = scanRepoPaths([cwd], options.config);

	// Pool 2 — SLICEABLE PRDs filtered by `autoslice-gate`'s predicate (gated on
	// `autoSlice`). With `autoSlice` off NO PRD is selected — the slice rung is
	// never reached by the bare/`-n` selection.
	const pool = read.resolvePrdPool({repoPath: cwd});
	const prdCandidates: PrdCandidate[] = pool.prds.map((prd) => ({
		repoPath: cwd,
		slug: prd.slug,
		humanOnly: prd.humanOnly,
		needsAnswers: prd.needsAnswers,
		sliceAfter: prd.sliceAfter,
	}));
	const eligiblePrds = sliceablePrds({
		candidates: prdCandidates,
		slicedSlugs: pool.slicedSlugs,
		autoSlice: options.config.autoSlice,
	});

	// Pools 3 + 4 — the LIFECYCLE pools (untriaged observations + `needsAnswers`-
	// blocked slices/PRDs + answered-sidecar items), built CALLER-SIDE (here, the
	// `advance` caller) through the SHARED enumeration unit and passed in — NOT baked
	// into `selectPrioritised` (so `do` is provably unchanged). The create-gates
	// default OFF (interim hardcoded-off): triage + surface contribute nothing; the
	// apply sub-pool is always-on (consume), so an answered sidecar still applies.
	const lifecycle = gatherLifecycleInPlace({
		repoPath: cwd,
		read,
		gates: options.lifecycleGates,
	});

	// Order across the (up to) FIVE pools per the resolved `selectionOrder` (apply
	// pinned first) + bound by count — the SAME shared, pure `selectPrioritised` the
	// `do` auto-pick driver uses (which passes NO lifecycle pools, so it is unchanged).
	const selected = selectPrioritised({
		report,
		caps: {maxParallel: ALL_ELIGIBLE, perRepoMax: ALL_ELIGIBLE},
		prds: eligiblePrds,
		selectionOrder: options.config.selectionOrder,
		lifecycle,
		count,
	});

	if (selected.length === 0) {
		// With every gate off this is the "zero autonomy" case: nothing autonomous to
		// select. The question loop (surface/apply) is reached by NAMING an item, not
		// the bare form — so this is calm-at-rest, NOT a failure.
		const message =
			'Nothing eligible to advance (no eligible slices and no sliceable PRDs ' +
			'under the per-action gates; name an item to surface/apply its questions).';
		note(message);
		return {results: [], exitCode: 0, message};
	}

	return runSelectedInSequence(selected, options, run);
}

/**
 * Run the EXPLICIT multi-arg form (`advance <a> <b> …`): the named items in the
 * GIVEN order (no pool/priority — the operator chose them). Each arg is run
 * through the existing advance tick, which itself resolves bare/`slice:`/`prd:`/
 * `obs:` (so a named PRD drives the slice rung, an `obs:` the triage rung, a
 * collision errors), SEQUENTIALLY. A NAMED item is the always-allowed path — its
 * surface/apply rung runs regardless of the per-action gates.
 */
export async function performAdvanceArgs(
	args: string[],
	options: PerformAdvanceMultiOptions,
): Promise<AdvanceMultiResult> {
	const run = options.run ?? performAdvance;
	const selected: SelectedItem[] = args.map((arg) => ({
		repoPath: options.cwd,
		slug: arg,
		// The arg is passed VERBATIM to the tick (it does its own slug resolution
		// across slice/prd/observation); the namespace is irrelevant for explicit args.
		namespace: 'slice' as const,
	}));
	return runSelectedInSequence(selected, options, run, {verbatimArg: true});
}

/**
 * Run a list of selected items through the existing advance tick, SEQUENTIALLY
 * (US #25 — `-n` is always sequential), threading the shared context to each. For
 * the pool path the arg encodes the namespace (`prd:<slug>` for a selected PRD,
 * bare slug for a slice); for the explicit-arg path the caller's raw arg is passed
 * verbatim. Each tick is INDEPENDENTLY `advancing`-lock-guarded inside
 * {@link performAdvance} — sequential here means one item at a time, never a
 * parallelism knob.
 */
async function runSelectedInSequence(
	selected: SelectedItem[],
	options: PerformAdvanceMultiOptions,
	run: AdvanceTickRunner,
	mode: {verbatimArg?: boolean} = {},
): Promise<AdvanceMultiResult> {
	const shared = sharedAdvanceContext(options);
	const results: AdvanceResult[] = [];
	for (const item of selected) {
		const arg = mode.verbatimArg ? item.slug : argForSelectedItem(item);
		const result = await runAdvanceTickWithTreelessPublish(
			{...shared, arg, read: options.read},
			run,
		);
		results.push(result);
	}

	const firstFailure = results.find((r) => r.exitCode !== 0);
	const exitCode: AdvanceExitCode = firstFailure ? firstFailure.exitCode : 0;
	const ok = results.filter((r) => r.exitCode === 0).length;
	const message =
		`advanced ${results.length} item${results.length === 1 ? '' : 's'} ` +
		`(${ok} ok, ${results.length - ok} not).`;
	return {results, exitCode, message};
}

/**
 * Run ONE in-place advance tick + ff-push a tree-less rung's result to the
 * arbiter — slice `advance-in-place-publishes-treeless-results`. Wraps the
 * substrate-agnostic tick ({@link AdvanceTickRunner}) with the shared
 * {@link pushTreelessResult} so a surfaced sidecar / `triaged:` marker /
 * applied-answer commit committed LOCALLY in the in-place cwd LANDS on the
 * arbiter's `main` (today the in-place tick commits locally and the work is lost
 * on an ephemeral CI runner). Mirrors the `--isolated` one-shot + `run` loop
 * driver call sites byte-for-byte:
 *
 *   - gates PURELY on `result.exitCode === 0 && TREELESS_RUNGS.has(result.rung)
 *     && context.arbiter !== undefined` — the SAME gate the existing drivers
 *     use, no cleverer guard (a build/slice rung integrates through the
 *     `doDriver` band; a no-arbiter laptop checkout already sits on the real
 *     `main`);
 *   - reuses `pushTreelessResult` VERBATIM (its bounded re-fetch+rebase retry is
 *     LOAD-BEARING for a sequential `-n` batch that integrates a build/slice rung
 *     mid-batch and then runs a later tree-less rung whose `HEAD:main` push is
 *     non-fast-forward by construction);
 *   - NEVER `--force`. A push that keeps failing (or a genuine rebase conflict)
 *     is REPORTED via the `note` sink and does NOT crash the tick — the work
 *     stays committed in the cwd for the next pass / a human.
 *
 * Used by BOTH in-place entry points: {@link runSelectedInSequence} (the
 * multi-item `-n` / auto-pick / multi-arg path) AND the CLI single-named-item
 * path (which calls {@link performAdvance} directly, bypassing the sequence
 * runner — the easy-to-miss site).
 *
 * The promote-apply edge mirrors the existing drivers without a special case: an
 * `apply` rung whose answer is `promote-slice`/`promote-adr` runs
 * `promoteObservation`'s OWN arbiter CAS and commits NOTHING tree-less, so the
 * ff-push here is a harmless no-op (a `HEAD` with nothing new) — it does NOT
 * double-publish nor clobber the promote CAS.
 */
export async function runAdvanceTickWithTreelessPublish(
	options: AdvanceTickOptions,
	run: AdvanceTickRunner,
): Promise<AdvanceResult> {
	const result = await run(options);
	if (
		result.exitCode === 0 &&
		result.rung !== undefined &&
		TREELESS_RUNGS.has(result.rung) &&
		options.arbiter !== undefined
	) {
		await pushTreelessResult({
			cwd: options.cwd,
			arbiter: options.arbiter,
			retries: 3,
			env: undefined,
			note: options.note ?? (() => {}),
		});
	}
	return result;
}

/**
 * The advance TICK arg for a pool-selected item — the SELECTION->ARG dispatch
 * (slice `advance-autopick-lifecycle-pools`, F-NAMESPACE). The `namespace`
 * discriminator the selection carried maps to the tick arg the tick then
 * classifies into the right rung:
 *   - `observation` → `obs:<slug>` (the triage rung; bare would resolve to a
 *     slice, so the `obs:` prefix is required);
 *   - `prd` → `prd:<slug>` (a sliceable PRD's slice rung, OR a `needsAnswers` PRD
 *     the tick surfaces/applies);
 *   - `slice` → bare `<slug>` (an eligible slice's build rung, OR a `needsAnswers`
 *     slice the tick surfaces/applies).
 * The tick re-classifies each arg, so a `needsAnswers`-blocked slice/PRD reaches
 * surface/apply and an untriaged observation reaches triage — the classifier +
 * rung bodies are unchanged; only this selection->arg mapping is new.
 */
function argForSelectedItem(item: SelectedItem): string {
	if (item.namespace === 'observation') {
		return `obs:${item.slug}`;
	}
	if (item.namespace === 'prd') {
		return `prd:${item.slug}`;
	}
	return item.slug;
}

/** Strip the multi-only fields, leaving exactly the per-item {@link AdvanceContext}. */
function sharedAdvanceContext(
	options: PerformAdvanceMultiOptions,
): SharedAdvanceContext {
	const {
		config: _config,
		count: _count,
		run: _run,
		read: _read,
		lifecycleGates: _lifecycleGates,
		...rest
	} = options;
	void _config;
	void _count;
	void _run;
	void _read;
	void _lifecycleGates;
	return rest;
}

/**
 * Is this aggregate result a CALM-AT-REST (US #31 convergence) one — every item
 * that ran was a NO-OP (a pending sidecar idling) AND nothing failed? The
 * convergence/drain tests use this to assert the loop IDLES when there are no
 * answers (no thrash) and DRAINS monotonically as answers arrive. A pool of
 * pending-sidecar items advances NOTHING (every tick a clean no-op); as the human
 * answers, the answered items flip to `apply` and the no-op count shrinks.
 */
export function isCalmAtRest(result: AdvanceMultiResult): boolean {
	return (
		result.exitCode === 0 && result.results.every((r) => r.outcome === 'no-op')
	);
}

export type {AdvanceOutcome};
