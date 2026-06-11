import {performAdvance, type AdvanceResult} from './advance.js';
import type {AdvanceTickRunner, AdvanceTickOptions} from './advance-drivers.js';
import {scanMirrorPool} from './mirror-pool-scan.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {selectPrioritised, type SelectedItem} from './select-priority.js';
import {runConcurrent} from './concurrency.js';
import type {Config} from './config.js';

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
 *     (build→`allowAgents`, slice→`autoSlice`) by the SELECTION layer;
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
	 * The resolved (remote) repo config — `allowAgents`/`autoSlice` gate the pool
	 * scan, `prdsFirst` the priority. The per-action gate family is applied at the
	 * SELECTION layer, exactly as the one-shot driver applies it.
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
	// SHARED `mirror-side-eligible-pool-scan` (gated on `allowAgents`/`autoSlice`).
	const scan = await scanMirrorPool({
		mirrorPath: options.mirrorPath,
		config: options.config,
		ref: options.ref,
		read,
		warn: options.warn,
		env: options.env,
	});

	// Order across both pools (slices-first / flipped) — ALL eligible items (the
	// loop drains the whole pool each batch; `count` is the one-shot/`-n` concern).
	const selected = selectPrioritised({
		report: scan.report,
		caps: {
			maxParallel: Number.MAX_SAFE_INTEGER,
			perRepoMax: Number.MAX_SAFE_INTEGER,
		},
		prds: scan.prds,
		prdsFirst: options.config.prdsFirst,
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

/** The advance arg for a selected item: `prd:<slug>` for a PRD, bare slug for a slice. */
function argForSelected(item: SelectedItem): string {
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
