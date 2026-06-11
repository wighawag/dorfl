import {
	performAdvance,
	type AdvanceContext,
	type AdvanceResult,
	type AdvanceExitCode,
	type AdvanceOutcome,
} from './advance.js';
import {scanRepoPaths} from './scan.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {
	selectPrioritised,
	sliceablePrds,
	type PrdCandidate,
	type SelectedItem,
} from './select-priority.js';
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
 * when `allowAgents` is on and a slice-a-PRD item when `autoSlice` is on (the gate
 * is a policy on the autonomous-SELECTION step, NOT on the explicit verb a human
 * typed — an explicitly-NAMED `advance <slug>` builds regardless, mirroring
 * `do <slice>` vs `allowAgents`). SURFACE + APPLY are ALWAYS allowed — they run
 * through the tick on any named item and are never pool-gated, so a repo with
 * EVERY flag off still gets the QUESTION LOOP (surface + apply) but no autonomous
 * build/slice in the bare/`-n` selection ("question loop with zero autonomy").
 * The triage rung's `autoTriage` gate is wired inside the tick already.
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
	 * The resolved repo config — provides `allowAgents` (the build gate for the
	 * slice pool), `autoSlice` (the slice-a-PRD gate for the PRD pool), and
	 * `prdsFirst` (the priority toggle). The per-action gate family is APPLIED
	 * HERE, at the selection layer (the policy-on-autonomous-selection point).
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
 * SLICES gated by `allowAgents`, sliceable PRDs gated by `autoSlice`), order them
 * (slices-first, or flipped by `prdsFirst`), take `count` (default 1), and run the
 * EXISTING advance tick per selected item, SEQUENTIALLY. The pools are the EXACT
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
	// inside `scanRepoPaths` gates eligibility on `allowAgents` (the build gate), so
	// with `allowAgents` off NO slice is selected — the build rung is never reached
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

	// Order across both pools (slices-first / flipped) + bound by count — the SAME
	// shared, pure `selectPrioritised` the `do` auto-pick driver uses.
	const selected = selectPrioritised({
		report,
		caps: {maxParallel: ALL_ELIGIBLE, perRepoMax: ALL_ELIGIBLE},
		prds: eligiblePrds,
		prdsFirst: options.config.prdsFirst,
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
		const arg = mode.verbatimArg
			? item.slug
			: item.namespace === 'prd'
				? `prd:${item.slug}`
				: item.slug;
		const result = await run({...shared, arg, read: options.read});
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

/** Strip the multi-only fields, leaving exactly the per-item {@link AdvanceContext}. */
function sharedAdvanceContext(
	options: PerformAdvanceMultiOptions,
): SharedAdvanceContext {
	const {
		config: _config,
		count: _count,
		run: _run,
		read: _read,
		...rest
	} = options;
	void _config;
	void _count;
	void _run;
	void _read;
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
