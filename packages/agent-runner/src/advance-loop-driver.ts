import {performAdvance, type AdvanceResult} from './advance.js';
import type {AdvanceTickRunner, AdvanceTickOptions} from './advance-drivers.js';
import {scanMirrorPool} from './mirror-pool-scan.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {selectPrioritised, type SelectedItem} from './select-priority.js';
import type {LifecyclePoolGates} from './lifecycle-pools.js';
import {runConcurrent} from './concurrency.js';
import type {Config} from './config.js';
import type {
	RunTick,
	RunOnceOptions,
	RunOnceResult,
	ItemResult,
	ItemStatus,
} from './run.js';

/**
 * The **`advance` LOOP DRIVER** (PRD `advance-loop`, slice
 * `advance-drivers-and-gates`, US #7/22/26/31) — the second of the two drivers
 * over the substrate-agnostic advance TICK. Where the one-shot driver
 * (`advance-drivers.ts`) runs the tick over named item(s) SEQUENTIALLY, this
 * driver loops the tick over the ELIGIBLE SET with genuine PARALLELISM, each item
 * independently lock-guarded by the `advancing` borrow.
 *
 * It WRAPS the EXISTING substrate, building NO new machinery:
 *
 *   - the eligible set comes from the SHARED `mirror-side-eligible-pool-scan`
 *     ({@link scanMirrorPool}) — the SAME enumeration the one-shot/CI `advance`
 *     driver + `do --remote -n` consume (NOT invented twice), gated per-action
 *     (build→`autoBuild`, slice→`autoSlice`) by the SELECTION layer;
 *   - parallelism is the SAME bounded scheduler `run`'s build tick uses
 *     ({@link runConcurrent}) — `maxParallel` global / `perRepoMax` per repo;
 *   - the per-item `advancing` borrow is held INSIDE {@link performAdvance}
 *     (classify → lock → execute, winner-only), so a CAS loser among the parallel
 *     ticks backs off having spent only the free classification — the lock is the
 *     ONLY shared state across the in-flight ticks.
 *
 * `run` ≡ CI (US #7): the loop is just repeated batches of THIS tick (same
 * contract, different substrate / cadence — a `run` daemon, a CI cron, the CI
 * matrix). The tick is the contract; this driver owns ONLY the
 * select-pool + run-batch-concurrently part, exactly mirroring how
 * `runOnce`/`runLoop` separate the tick from the scheduling loop (so the
 * advance-loop forward-pointer's "swap the tick without re-architecting the loop"
 * holds — the loop machinery is `run.ts`'s `runLoop`, this is its advance tick).
 *
 * **Convergence / drain (US #31).** Each batch advances every eligible item one
 * rung, surfaces+idles, or no-ops on a pending sidecar; the candidate pool shrinks
 * MONOTONICALLY as answers arrive (an answered item flips from a no-op to an
 * `apply` that resolves it) and is STABLE when there are none (a pending-sidecar
 * pool is all no-ops — calm at rest, no thrash). {@link advanceBatchSummary}
 * exposes the counts the convergence tests assert on.
 */

/** What {@link advanceOnce} needs: which bare mirror + the gate config + the tick seam. */
export interface AdvanceOnceOptions {
	/** The bare hub mirror whose committed `main` the eligible pool is scanned from. */
	mirrorPath: string;
	/**
	 * The resolved (remote) repo config — `autoBuild`/`autoSlice` gate the pool
	 * scan, `selectionOrder` the cross-pool order. The per-action gate family is
	 * applied at the SELECTION layer, exactly as the one-shot driver applies it.
	 */
	config: Config;
	/**
	 * The mirror-LOCAL ref whose `work/` to scan (default `main`). A bare hub
	 * mirror's `main` is a LOCAL branch.
	 */
	ref?: string;
	/**
	 * Global cap on advance ticks IN FLIGHT at once (the daemon's `maxParallel`).
	 * Defaults to `config.maxParallel`.
	 */
	maxParallel?: number;
	/**
	 * Per-repo cap on ticks in flight (the daemon's `perRepoMax`). The mirror is one
	 * repo, so this also bounds the whole batch. Defaults to `config.perRepoMax`.
	 */
	perRepoMax?: number;
	/**
	 * The per-item advance tick context (everything BUT `arg`): the run context the
	 * tick threads to each item (cwd, arbiter, doOptions, the surface/triage gate
	 * seams, …). Each selected item's `arg` is filled in by this driver.
	 */
	context: Omit<AdvanceTickOptions, 'arg'>;
	/** Override the single-tick runner (tests inject a stub). Defaults to {@link performAdvance}. */
	run?: AdvanceTickRunner;
	/** Override the read seam (mirror pool); defaults to the active {@link ledgerRead}. */
	read?: LedgerReadStrategy;
	/** Sink for a non-fatal mirror-config-read warning, forwarded to the scan. */
	warn?: (message: string) => void;
	/** The git env the mirror scan's read ops run under (identity/non-interactive). */
	env?: NodeJS.ProcessEnv;
	/**
	 * The LIFECYCLE-POOL create-gates (slice `advance-autopick-lifecycle-pools`),
	 * forwarded to {@link scanMirrorPool}. INTERIM, born OFF: omitted ⇒ BOTH
	 * create-gates off, so the loop/CI advance auto-triages / auto-surfaces nothing
	 * (the apply sub-pool is always-on). The gate slices wire this to
	 * `observationTriage` / `surfaceBlockers`.
	 */
	lifecycleGates?: LifecyclePoolGates;
}

/** One advanced item's result + the identity it was for (input order preserved). */
export interface AdvanceBatchItem {
	/** The namespaced arg the tick was run on (`prd:<slug>` / bare slug). */
	arg: string;
	/** The tick's result, or a captured throw mapped to a usage-error result. */
	result: AdvanceResult;
}

/** The aggregate outcome of ONE loop-driver batch (the convergence signal). */
export interface AdvanceBatchResult {
	/** Every selected item's result, in selection (priority) order. */
	items: AdvanceBatchItem[];
}

/**
 * Run ONE batch of the loop driver: scan the mirror's eligible pool, select +
 * order it (gated per-action), and run the advance TICK per item CONCURRENTLY,
 * each independently `advancing`-lock-guarded inside {@link performAdvance}.
 * Returns every item's result (input order preserved). A `run` daemon / CI cron
 * loops THIS — the loop owns cadence, the batch owns one round's work.
 */
export async function advanceOnce(
	options: AdvanceOnceOptions,
): Promise<AdvanceBatchResult> {
	const run = options.run ?? performAdvance;
	const read = options.read ?? ledgerRead;
	const maxParallel = options.maxParallel ?? options.config.maxParallel;
	const perRepoMax = options.perRepoMax ?? options.config.perRepoMax;

	// Enumerate the eligible pool from the bare mirror's committed `main` — the
	// SHARED `mirror-side-eligible-pool-scan` (gated on `autoBuild`/`autoSlice`).
	const scan = await scanMirrorPool({
		mirrorPath: options.mirrorPath,
		config: options.config,
		ref: options.ref,
		read,
		warn: options.warn,
		env: options.env,
		lifecycleGates: options.lifecycleGates,
	});

	// Order across the (up to) FIVE pools per the resolved `selectionOrder` (apply
	// pinned first) — ALL eligible items (the loop drains the whole pool each batch;
	// `count` is the one-shot/`-n` concern). The lifecycle pools come from the SHARED
	// mirror enumeration, so the loop/CI selection agrees with the in-place one-shot.
	const selected = selectPrioritised({
		report: scan.report,
		caps: {
			maxParallel: Number.MAX_SAFE_INTEGER,
			perRepoMax: Number.MAX_SAFE_INTEGER,
		},
		prds: scan.prds,
		selectionOrder: options.config.selectionOrder,
		lifecycle: scan.lifecycle,
	});

	if (selected.length === 0) {
		return {items: []};
	}

	// Run the tick per item CONCURRENTLY (the SAME bounded scheduler `run`'s build
	// tick uses), each independently `advancing`-lock-guarded inside the tick. The
	// scheduler never rejects — a thrown tick is captured, so one item can never
	// abort the batch (mirrors `runOnce`'s settled-slot contract).
	const settled = await runConcurrent({
		items: selected,
		maxInFlight: Math.max(1, maxParallel),
		// The mirror is ONE repo, so every item shares the repo key — `perRepoMax`
		// bounds the whole batch (matching `run`'s per-repo cap semantics).
		keyFor: () => options.mirrorPath,
		perKeyMax: Math.max(1, perRepoMax),
		worker: (item) =>
			run({...options.context, arg: argForSelected(item), read}),
	});

	const items: AdvanceBatchItem[] = settled.map((slot, i) => {
		const arg = argForSelected(selected[i]);
		if ('ok' in slot) {
			return {arg, result: slot.ok};
		}
		// A captured throw → a usage-error result (never crashes the batch).
		const detail =
			slot.error instanceof Error ? slot.error.message : String(slot.error);
		return {
			arg,
			result: {exitCode: 1, outcome: 'usage-error', message: detail},
		};
	});

	return {items};
}

/**
 * The advance arg for a selected item (the SELECTION->ARG dispatch): `obs:<slug>`
 * for an observation (the triage rung), `prd:<slug>` for a PRD, bare slug for a
 * slice. The tick re-classifies each arg into the right rung (surface/apply for a
 * `needsAnswers`-blocked slice/PRD; triage for an observation).
 */
function argForSelected(item: SelectedItem): string {
	if (item.namespace === 'observation') {
		return `obs:${item.slug}`;
	}
	return item.namespace === 'prd' ? `prd:${item.slug}` : item.slug;
}

/** The convergence counts of one batch (the drain/idle signal US #31 asserts on). */
export interface AdvanceBatchSummary {
	/** Items the batch ADVANCED a rung (build/slice/surface/apply/triage). */
	advanced: number;
	/** Items that NO-OPed (a pending sidecar idling — the calm-at-rest population). */
	idle: number;
	/** Items that FAILED / contended (non-zero, non-no-op). */
	stuck: number;
	/** Total selected this batch (= the candidate pool size). */
	total: number;
}

/** Summarise a batch into the convergence counts (a pure projection). */
export function advanceBatchSummary(
	result: AdvanceBatchResult,
): AdvanceBatchSummary {
	let advanced = 0;
	let idle = 0;
	let stuck = 0;
	for (const {result: r} of result.items) {
		if (r.outcome === 'no-op') {
			idle++;
		} else if (r.exitCode === 0) {
			advanced++;
		} else {
			stuck++;
		}
	}
	return {advanced, idle, stuck, total: result.items.length};
}

/**
 * Is this batch CALM-AT-REST (US #31) — every selected item idled (a pending
 * sidecar awaiting a human) and nothing failed? A pending-sidecar pool is STABLE:
 * the loop re-ticks it, finds all no-ops, and idles without thrash. As answers
 * arrive the idle count shrinks MONOTONICALLY (an answered item flips to an
 * advance), so the loop converges.
 */
export function isBatchCalmAtRest(result: AdvanceBatchResult): boolean {
	const s = advanceBatchSummary(result);
	return s.total > 0 && s.advanced === 0 && s.stuck === 0;
}

/**
 * The advance-specific dependencies the {@link RunTick} adapter closes over —
 * everything the {@link advanceOnce} batch needs that is NOT carried by the
 * generic per-tick {@link RunOnceOptions} (which describe the BUILD tick's
 * checkout-scan world). The CLI builds these ONCE (the mirror to drain, the
 * resolved remote config, the per-item advance context) and hands them to
 * {@link advanceRunTick}; the loop ({@link runLoop}) then drives the resulting
 * tick exactly as it drives the build tick.
 */
export interface AdvanceRunTickDeps extends Omit<
	AdvanceOnceOptions,
	'maxParallel' | 'perRepoMax' | 'warn' | 'env'
> {
	/* `lifecycleGates` is inherited from {@link AdvanceOnceOptions} (born OFF). */
	/**
	 * Override the per-batch caps. Defaults to `config.maxParallel` /
	 * `config.perRepoMax` (the SAME knobs the build tick's scheduler uses), so a
	 * `run` daemon caps advance ticks identically.
	 */
	maxParallel?: number;
	perRepoMax?: number;
}

/**
 * Adapt the {@link advanceOnce} LOOP DRIVER to the {@link RunTick} swap SEAM so
 * `run` (≡ CI, US #7) drives the ADVANCE tick over the mirror-side eligible pool
 * instead of the build tick. `run.ts` deliberately writes {@link runLoop} against
 * {@link RunTick} (NOT against `runOnce`) precisely so the advance-loop PRD can
 * swap the tick WITHOUT re-architecting the loop — this is that swap.
 *
 * The seam is `(RunOnceOptions) => Promise<RunOnceResult>`; one advance batch is
 * `(AdvanceOnceOptions) => Promise<AdvanceBatchResult>`. The deps the advance
 * batch needs that the generic per-tick options do NOT carry (the mirror to
 * drain, the remote config, the per-item advance context) are CLOSED OVER here;
 * the per-tick `RunOnceOptions` contribute only the cross-cutting seams that DO
 * generalise — `onWarn` (the warning sink) and `env` (the git env). The batch's
 * own item-level pool scan supersedes `RunOnceOptions.report` (the build tick's
 * checkout scan), so that field is ignored for the advance tick.
 *
 * The {@link AdvanceBatchResult} is projected onto {@link RunOnceResult} so the
 * loop's aggregation/reporting (`claimedAndDone` / `skipped` / `failed` /
 * `needsAttention`) works UNCHANGED — an `advanced` item is `claimed-done`, an
 * idling pending-sidecar `no-op` is `lost-race` (skipped, calm-at-rest), a CAS
 * loser is `claim-contended` (skipped), and any error is `needs-attention`. So
 * the loop's existing convergence signal (`claimedAndDone` falls to 0 once the
 * pool is all idle) doubles as the advance loop's drain/idle signal (US #31).
 */
export function advanceRunTick(deps: AdvanceRunTickDeps): RunTick {
	return async (options: RunOnceOptions): Promise<RunOnceResult> => {
		const batch = await advanceOnce({
			mirrorPath: deps.mirrorPath,
			config: deps.config,
			ref: deps.ref,
			context: deps.context,
			run: deps.run,
			read: deps.read,
			lifecycleGates: deps.lifecycleGates,
			maxParallel: deps.maxParallel,
			perRepoMax: deps.perRepoMax,
			// Cross-cutting seams that DO generalise come from the per-tick options
			// (the SAME ones the build tick receives) — so a `run` daemon threads its
			// warning sink + git env to the advance tick identically.
			warn: options.onWarn,
			env: options.env,
		});
		return batchToRunOnceResult(batch, deps.mirrorPath);
	};
}

/**
 * Project one advance batch onto a {@link RunOnceResult} so the existing run loop
 * aggregates + reports it with NO advance-specific code. The `repoPath` is the
 * mirror (the one repo this batch drains); the `slug` is the advanced arg.
 */
function batchToRunOnceResult(
	batch: AdvanceBatchResult,
	mirrorPath: string,
): RunOnceResult {
	const items: ItemResult[] = batch.items.map(({arg, result}) => ({
		repoPath: mirrorPath,
		slug: arg,
		status: advanceOutcomeToItemStatus(result),
		detail: result.message,
	}));
	const claimedAndDone = items.filter(
		(i) => i.status === 'claimed-done',
	).length;
	const skipped = items.filter(
		(i) => i.status === 'lost-race' || i.status === 'claim-contended',
	).length;
	const needsAttention = items.filter(
		(i) => i.status === 'needs-attention',
	).length;
	const failed = needsAttention;
	return {claimedAndDone, skipped, failed, needsAttention, items};
}

/**
 * Map one advance tick's outcome onto the run loop's {@link ItemStatus} so the
 * loop's counters carry the convergence semantics: an item that ADVANCED a rung
 * is `claimed-done`; a `no-op` (an idling pending sidecar — the calm-at-rest
 * population) is `lost-race` (skipped, NOT a failure — the loop does no work on
 * it and does not retry); a CAS `lost`/`contended` is `lost-race`/
 * `claim-contended` (a parallel sibling won; back off); anything else (a
 * usage/invariant error or a captured throw) is `needs-attention`.
 */
function advanceOutcomeToItemStatus(result: AdvanceResult): ItemStatus {
	if (result.exitCode === 0) {
		return result.outcome === 'no-op' ? 'lost-race' : 'claimed-done';
	}
	if (result.exitCode === 2 || result.outcome === 'lost') {
		return 'lost-race';
	}
	if (result.exitCode === 3 || result.outcome === 'contended') {
		return 'claim-contended';
	}
	return 'needs-attention';
}
