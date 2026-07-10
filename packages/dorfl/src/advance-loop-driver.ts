import {
	performAdvance,
	type AdvanceResult,
	type AdvanceContext,
} from './advance.js';
import type {AdvanceTickRunner, AdvanceTickOptions} from './advance-drivers.js';
import {scanMirrorPool} from './mirror-pool-scan.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {selectPrioritised, type SelectedItem} from './select-priority.js';
import type {LifecyclePoolGates} from './lifecycle-pools.js';
import {runConcurrent} from './concurrency.js';
import {scan, type ScanReport} from './scan.js';
import {run as runProcess} from './git.js';
import {jobWorktreeDoDriver} from './do.js';
import {
	pushTreelessResult,
	TREELESS_RUNGS,
} from './advance-treeless-publish.js';
import type {Config} from './config.js';
import type {
	RunTick,
	RunOnceOptions,
	RunOnceResult,
	ItemResult,
	ItemStatus,
} from './run.js';

/**
 * The **`advance` LOOP DRIVER** (spec `advance-loop`, task
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
 *     (build→`autoBuild`, task→`autoTask`) by the SELECTION layer;
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
	 * The resolved (remote) repo config — `autoBuild`/`autoTask` gate the pool
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
	 * The LIFECYCLE-POOL create-gates (task `advance-autopick-lifecycle-pools`),
	 * forwarded to {@link scanMirrorPool}. INTERIM, born OFF: omitted ⇒ BOTH
	 * create-gates off, so the loop/CI advance auto-triages / auto-surfaces nothing
	 * (the apply sub-pool is always-on). The gate tasks wire this to
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
	// SHARED `mirror-side-eligible-pool-scan` (gated on `autoBuild`/`autoTask`).
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
		specs: scan.specs,
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
		worker: async (item) => {
			const result = await run({
				...options.context,
				arg: argForSelected(item),
				read,
			});
			// A TREE-LESS rung (surface/apply/triage) committed its sidecar / marker
			// LOCALLY in the shared per-mirror `treelessCwd` (`context.cwd`); ff-push
			// it to the mirror's arbiter so the result LANDS on `main` (the CLI wipes +
			// re-clones that cwd EACH TICK, so an un-pushed local commit is lost). The
			// build/task rungs already pushed via the job-worktree `doDriver`.
			//
			// The bounded re-fetch+rebase retry inside `pushTreelessResult` is
			// LOAD-BEARING here: the `treelessCwd` is cloned ONCE per mirror at tick
			// start and SHARED across the mirror's SERIAL batch, so a `build`/`task`
			// rung EARLIER in the batch can integrate to the mirror's `main` mid-tick
			// and a LATER tree-less push is non-fast-forward BY CONSTRUCTION — the
			// retry rebases the slug-only commit onto the advanced `main` and lands it.
			if (
				result.exitCode === 0 &&
				result.rung !== undefined &&
				TREELESS_RUNGS.has(result.rung) &&
				options.context.cwd !== undefined
			) {
				await pushTreelessResult({
					cwd: options.context.cwd,
					arbiter: options.context.arbiter ?? 'origin',
					// Large liveness ceiling (C2, task `c2-rebase-until-real-on-durable-main-
					// promotions`): a clean re-rebase no longer counts against a small
					// budget; a genuine same-path conflict still stops definitively.
					retries: 1000,
					env: options.env,
					note: options.context.note ?? (() => {}),
				});
			}
			return result;
		},
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
 * for an observation (the triage rung), `spec:<slug>` for a spec, bare slug for a
 * task. The tick re-classifies each arg into the right rung (surface/apply for a
 * `needsAnswers`-blocked task/spec; triage for an observation).
 */
function argForSelected(item: SelectedItem): string {
	if (item.namespace === 'observation') {
		return `obs:${item.slug}`;
	}
	return item.namespace === 'spec' ? `spec:${item.slug}` : item.slug;
}

/**
 * Read a bare hub mirror's `origin` URL (`git -C <mirror> remote get-url
 * origin`) — the arbiter URL the per-mirror job-worktree `do` driver
 * ({@link jobWorktreeDoDriver}) materialises its worktree off (the SAME URL
 * `run`'s `claimAgainstRepo` resolves; `registry.ts readOriginUrl` reads it for
 * the registry view). Falls back to a `file://<path>` URL when the remote is
 * unreadable, so a malformed/origin-less mirror still resolves to SOMETHING
 * addressable rather than throwing mid-batch.
 */
function mirrorOriginUrl(
	mirrorPath: string,
	env: NodeJS.ProcessEnv | undefined,
): string {
	const result = runProcess(
		'git',
		['remote', 'get-url', 'origin'],
		mirrorPath,
		{env},
	);
	const url = result.status === 0 ? result.stdout.trim() : '';
	return url !== '' ? url : `file://${mirrorPath}`;
}

/**
 * One mirror's slot in a {@link advanceRegistrySet} batch: which mirror drained,
 * and that mirror's batch result (or a captured throw mapped to a usage-error
 * batch — one mirror can never abort the whole registry sweep).
 */
export interface AdvanceRegistryMirrorResult {
	/** The bare hub mirror that was drained this batch. */
	mirrorPath: string;
	/** That mirror's {@link advanceOnce} batch result. */
	batch: AdvanceBatchResult;
}

/** The aggregate outcome of ONE registry-set advance batch (every mirror's batch). */
export interface AdvanceRegistrySetResult {
	/** Each drained mirror's batch, in registry-discovery order. */
	mirrors: AdvanceRegistryMirrorResult[];
}

/**
 * What {@link advanceRegistrySet} needs: the global config (the registry +
 * caps), the per-mirror advance CONTEXT factory, and the execution workspace.
 */
export interface AdvanceRegistrySetOptions {
	/**
	 * The global config. Its `workspacesDir` IS the registry (the hub-mirror set
	 * {@link scan} enumerates); `maxParallel`/`perRepoMax` are the SAME caps the
	 * build tick's scheduler uses.
	 */
	config: Config;
	/**
	 * Build the per-mirror advance CONTEXT (everything BUT `arg` and the build/task
	 * `doDriver`). The driver INJECTS the per-mirror job-worktree `doDriver`
	 * ({@link jobWorktreeDoDriver}) on top of what this returns, so the build/task
	 * rungs run isolated off THAT mirror's arbiter — the caller supplies the gate
	 * seams + `doOptions` base (harness, verify, review, …), exactly as the CLI
	 * wires them for the single-mirror path. `cwd` here is irrelevant to the
	 * build/task rungs (the worktree driver replaces it); the tree-less
	 * surface/triage/apply rungs use it as their ledger-write cwd.
	 */
	contextFor: (input: {
		mirrorPath: string;
		originUrl: string;
	}) => Omit<AdvanceTickOptions, 'arg' | 'doDriver'>;
	/**
	 * The execution working area (bare hub mirrors + per-job worktrees). Defaults
	 * to `config.workspacesDir`. The per-mirror worktree `doDriver` materialises its
	 * worktree under here — the agents' area, the SAME isolation `run` uses.
	 */
	workspace?: string;
	/** Pre-computed registry scan (tests); omitted ⇒ the live `scan(config)`. */
	report?: ScanReport;
	/** Override the single-tick runner (tests). Defaults to {@link performAdvance}. */
	run?: AdvanceTickRunner;
	/** Override the read seam (mirror pool); defaults to the active {@link ledgerRead}. */
	read?: LedgerReadStrategy;
	/** Sink for non-fatal warnings (mirror-config read; forwarded to scan + pool scan). */
	warn?: (message: string) => void;
	/** The git env the registry scan + per-mirror pool scans run under. */
	env?: NodeJS.ProcessEnv;
	/**
	 * The LIFECYCLE-POOL create-gates, forwarded to each mirror's
	 * {@link advanceOnce}. INTERIM, born OFF (omitted ⇒ both off). The CLI wires
	 * this to `observationTriage`/`surfaceBlockers`, exactly as the single-mirror
	 * path does.
	 */
	lifecycleGates?: LifecyclePoolGates;
	/**
	 * The per-machine config-override map (ADR
	 * `per-machine-config-override-layer`), forwarded to the registry {@link scan}
	 * so per-mirror `autoTask`/`observationTriage`/`surfaceBlockers` resolutions
	 * honour the override. Default: empty (no override).
	 */
	override?: import('./config-override.js').ConfigOverrideMap;
}

/**
 * The **registry-set advance DRIVER** with **per-mirror job-worktree isolation**
 * (task `advance-loop-driver-registry-set-job-worktrees`) — the advance-tick TWIN
 * of `runOnce`/`runOneItem`'s build substrate, the substrate `run-uses-advance-tick`
 * needs to become a clean tick swap. Where {@link advanceOnce} drains ONE named
 * mirror's pool IN-PLACE (the single-mirror path), this driver:
 *
 *   1. **discovers the REGISTRY SET** the SAME way `runOnce` does — via
 *      {@link scan} over `config.workspacesDir`'s hub mirrors (NOT a single
 *      `--advance <mirror>` arg); and
 *   2. loops {@link advanceOnce}'s batch over that set, GENUINELY CONCURRENT
 *      ACROSS REPOS under {@link runConcurrent} (`maxParallel` global /
 *      `perRepoMax` per repo — the SAME scheduler `run`'s build tick uses), each
 *      mirror's pool itself drained concurrently by `advanceOnce` (reusing the
 *      per-item `advancing` borrow INSIDE {@link performAdvance} — no new lock,
 *      no new scheduler); and
 *   3. threads a **per-mirror job-worktree `doDriver`** ({@link jobWorktreeDoDriver})
 *      into each mirror's advance context, so the build/task rungs run isolated
 *      in their OWN worktree off THAT mirror's arbiter (the SAME isolation
 *      `runOneItem` gives the build tick) instead of in `process.cwd()`. The
 *      surface/triage/apply rungs stay on their tree-less ledger-write moves
 *      (no build worktree needed) — the worktree driver governs ONLY the
 *      build/task orchestration target.
 *
 * Under calm gates (both lifecycle create-gates off) this is the OBSERVABLE-
 * OUTCOME equivalent of plain `run`'s build tick over the same registry: build
 * ready tasks / task ready prds, each per-job-worktree-isolated off the
 * mirror's arbiter, same integration result — two callers of one
 * `performIntegration` band (the advance build rung reaches it via `performDo`
 * → `performDoRemote`; `runOneItem` reaches it directly), NOT a shared code path.
 */
export async function advanceRegistrySet(
	options: AdvanceRegistrySetOptions,
): Promise<AdvanceRegistrySetResult> {
	const config = options.config;
	const workspace = options.workspace ?? config.workspacesDir;
	// DISCOVERY = the registry (the hub-mirror set, ADR §1) — the SAME `scan(config)`
	// `runOnce` uses. Each row's `path` is a bare hub mirror to drain.
	const report =
		options.report ??
		(await scan(config, {
			warn: options.warn,
			env: options.env,
			override: options.override,
		}));
	const mirrors = report.repos.map((repo) => repo.path);

	// GENUINELY CONCURRENT ACROSS REPOS (the registry-set point) under the SAME
	// bounded scheduler `run`'s build tick uses: `maxParallel` bounds the whole
	// registry sweep, one `advanceOnce` per mirror in flight.
	//
	// WITHIN one mirror the batch is SERIALISED (`perRepoMax: 1` into `advanceOnce`).
	// WHY: the per-item `advancing` borrow + the tree-less surface/triage/apply rungs
	// commit in the per-mirror `context.cwd` working tree, and the borrow's CAS is
	// race-correct ONLY when each contender holds its OWN clone (the distinct-clone
	// model `advancing-lock.ts` is built + tested against — two contenders sharing
	// one checkout corrupt each other's HEAD/index, the SAME reason `run` serialises
	// the per-repo CLAIM via `createKeyedLock`). A bare mirror has no per-item cwd, so
	// the build/task rungs already get their OWN job worktree (via `jobWorktreeDoDriver`
	// → `performDoRemote`) but the lock + tree-less rungs share the one cwd — so within
	// ONE mirror they must run one-at-a-time. Cross-mirror concurrency (distinct
	// arbiters → distinct cwds, no contention) stays GENUINE, which is the
	// registry-set point. Per-item-cwd isolation (to also parallelise WITHIN a
	// mirror) is a follow-up; this task keeps the borrow reused unchanged + correct.
	const settled = await runConcurrent({
		items: mirrors,
		maxInFlight: Math.max(1, config.maxParallel),
		keyFor: (mirrorPath) => mirrorPath,
		perKeyMax: 1,
		worker: (mirrorPath) => {
			const originUrl = mirrorOriginUrl(mirrorPath, options.env);
			// The per-mirror context the CLI shaped (gates + doOptions base) PLUS the
			// per-mirror job-worktree `doDriver` injected here, so the build/task rungs
			// build isolated off THIS mirror's arbiter (cwd untouched).
			const baseContext = options.contextFor({mirrorPath, originUrl});
			const context: Omit<AdvanceTickOptions, 'arg'> = {
				...baseContext,
				doDriver: jobWorktreeDoDriver({
					remote: originUrl,
					workspacesDir: workspace,
				}),
			};
			return advanceOnce({
				mirrorPath,
				config,
				context,
				run: options.run,
				read: options.read,
				warn: options.warn,
				env: options.env,
				lifecycleGates: options.lifecycleGates,
				// SERIALISE within the mirror (one tick at a time over the shared cwd) —
				// the borrow + tree-less rungs commit in `context.cwd` and are race-correct
				// only per distinct clone (see the block above). Cross-mirror concurrency
				// is genuine (the outer `runConcurrent`).
				maxParallel: 1,
				perRepoMax: 1,
			});
		},
	});

	// One mirror can never abort the registry sweep: a captured throw becomes an
	// empty batch (mirrors `advanceOnce`'s per-item settled-slot contract one layer up).
	const mirrorResults: AdvanceRegistryMirrorResult[] = settled.map(
		(slot, i) => ({
			mirrorPath: mirrors[i],
			batch: 'ok' in slot ? slot.ok : {items: []},
		}),
	);
	return {mirrors: mirrorResults};
}

/** Project a whole registry-set batch onto the convergence counts (a pure sum). */
export function advanceRegistrySetSummary(
	result: AdvanceRegistrySetResult,
): AdvanceBatchSummary {
	let advanced = 0;
	let idle = 0;
	let stuck = 0;
	let total = 0;
	for (const {batch} of result.mirrors) {
		const s = advanceBatchSummary(batch);
		advanced += s.advanced;
		idle += s.idle;
		stuck += s.stuck;
		total += s.total;
	}
	return {advanced, idle, stuck, total};
}

/** The convergence counts of one batch (the drain/idle signal US #31 asserts on). */
export interface AdvanceBatchSummary {
	/** Items the batch ADVANCED a rung (build/task/surface/apply/triage). */
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
 * {@link RunTick} (NOT against `runOnce`) precisely so the advance-loop spec can
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
 * The deps the {@link advanceRegistrySetRunTick} adapter closes over — everything
 * the {@link advanceRegistrySet} batch needs that the generic per-tick
 * {@link RunOnceOptions} does NOT carry. This is the REGISTRY-SET twin of
 * {@link AdvanceRunTickDeps}: where that adapter drives ONE named mirror in-place
 * ({@link advanceRunTick}), this one discovers the WHOLE registry via
 * `scan(config)` and runs each mirror's pool in a per-mirror job worktree — the
 * substrate `run` needs so plain `run` (no flag) ≡ advance with calm-default gates.
 * The CLI builds these ONCE (the resolved config, the per-mirror advance-context
 * factory, the execution workspace) and hands them to {@link advanceRegistrySetRunTick};
 * the loop ({@link runLoop}) then drives the resulting tick exactly as it drove the
 * build tick.
 */
export interface AdvanceRegistrySetRunTickDeps extends Omit<
	AdvanceRegistrySetOptions,
	'warn' | 'env' | 'report'
> {
	/* `contextFor`/`config`/`workspace`/`run`/`read`/`lifecycleGates` are inherited
	 * from {@link AdvanceRegistrySetOptions} (lifecycle gates born OFF). */
}

/**
 * Adapt the REGISTRY-SET advance DRIVER ({@link advanceRegistrySet}) onto the
 * {@link RunTick} swap SEAM so plain `run` (no flag) drives the ADVANCE tick over
 * the WHOLE registry instead of the build tick (`runOnce`) — the task
 * `run-uses-advance-tick`. `run.ts` deliberately writes {@link runLoop} against
 * {@link RunTick} (NOT against `runOnce`) precisely so the advance-loop design can
 * swap the tick WITHOUT re-architecting the loop; this is that swap, now pointing
 * the seam at the REGISTRY-SET advance driver the precursor built (registry-set
 * discovery + per-mirror job-worktree isolation — the SAME substrate plain `run`'s
 * build tick uses).
 *
 * Under calm gates (both lifecycle create-gates off) this is the OBSERVABLE-
 * OUTCOME equivalent of plain `run`'s build tick over the same registry: build
 * ready tasks / task ready prds, each per-job-worktree-isolated off the
 * mirror's arbiter, same integration result; touch no observations, surface no
 * questions. Flip a gate and the SAME tick performs the lifecycle
 * (triage / surface / apply) for free — no separate `--advance` mode to discover.
 *
 * The seam is `(RunOnceOptions) => Promise<RunOnceResult>`; one registry-set
 * batch is `(AdvanceRegistrySetOptions) => Promise<AdvanceRegistrySetResult>`. The
 * deps the batch needs that the generic per-tick options do NOT carry (the config,
 * the per-mirror context factory, the workspace) are CLOSED OVER here; the
 * per-tick `RunOnceOptions` contribute only the cross-cutting seams that DO
 * generalise — `onWarn` (the warning sink) and `env` (the git env). The batch's
 * own registry discovery supersedes `RunOnceOptions.report` (the build tick's
 * checkout scan), so that field is ignored for the advance tick.
 */
export function advanceRegistrySetRunTick(
	deps: AdvanceRegistrySetRunTickDeps,
): RunTick {
	return async (options: RunOnceOptions): Promise<RunOnceResult> => {
		const result = await advanceRegistrySet({
			config: deps.config,
			override: deps.override,
			contextFor: deps.contextFor,
			workspace: deps.workspace,
			run: deps.run,
			read: deps.read,
			lifecycleGates: deps.lifecycleGates,
			// Cross-cutting seams that DO generalise come from the per-tick options
			// (the SAME ones the build tick receives) — so the `run` daemon threads its
			// warning sink + git env to the advance tick identically.
			warn: options.onWarn,
			env: options.env,
		});
		return registrySetToRunOnceResult(result);
	};
}

/**
 * Project a whole REGISTRY-SET advance batch onto a {@link RunOnceResult} so the
 * existing run loop aggregates + reports it with NO advance-specific code. Each
 * mirror's per-item results are flattened (the `repoPath` is that mirror; the
 * `slug` is the advanced arg), reusing the SAME per-item status mapping the
 * single-mirror {@link batchToRunOnceResult} uses — so the loop's convergence
 * signal (`claimedAndDone` falls to 0 once every pool idles) holds across the
 * registry exactly as it does for one mirror.
 */
function registrySetToRunOnceResult(
	result: AdvanceRegistrySetResult,
): RunOnceResult {
	const items: ItemResult[] = result.mirrors.flatMap(({mirrorPath, batch}) =>
		batch.items.map(({arg, result: r}) => ({
			repoPath: mirrorPath,
			slug: arg,
			status: advanceOutcomeToItemStatus(r),
			detail: r.message,
		})),
	);
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
