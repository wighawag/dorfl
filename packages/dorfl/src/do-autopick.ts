import {performDo, type DoOptions, type DoResult} from './do.js';
import {scanRepoPaths} from './scan.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {
	selectPrioritised,
	taskableSpecs,
	type SpecCandidate,
	type SelectedItem,
} from './select-priority.js';
import type {Config} from './config.js';
import type {ConfigOverrideMap} from './config-override.js';

/**
 * The MULTI-ITEM selection forms of `do` (ADR `command-surface-and-journeys`
 * §3), layered ON TOP of the single-item in-place pipeline from `do-in-place`
 * ({@link performDo}) — it does NOT reimplement that pipeline; it SELECTS +
 * ORDERS items and runs the existing pipeline per item, SEQUENTIALLY (`do` is
 * sequential; parallelism is `run`'s job).
 *
 *   - **`do` (no arg)** — auto-pick ONE eligible thing and do it.
 *   - **`do -n <x>`** — do x eligible things, in sequence.
 *   - **`do <a> <b> …`** — do those NAMED items, in sequence.
 *
 * Auto-pick / `-n` draw from TWO POOLS ordered by the configurable
 * `selectionOrder` (the shared, pure {@link selectPrioritised} helper): eligible
 * TASKS (the `build` pool — the existing `scan`/`selectCandidates`/eligibility
 * path) and TASKABLE prds (the `task` pool — built from the spec reader +
 * `autoslice-gate`'s predicate), in the per-repo `selectionOrder` (default `drain`
 * = tasks-first). A selected spec dispatches to the `do spec:<slug>` path (tasking
 * itself is `autoslice-command`, not built here).
 *
 * Explicit multi-arg (`do <a> <b>`) bypasses the pools/priority entirely — the
 * named items are resolved + run in the given order (the operator chose them).
 */

/** The single-`do` runner the multi-item layer drives per selected item. */
export type DoRunner = (options: DoOptions) => Promise<DoResult>;

/** Options shared with {@link performDo}, threaded verbatim to each per-item run. */
type SharedDoOptions = Omit<DoOptions, 'arg'>;

export interface PerformDoMultiOptions extends SharedDoOptions {
	/**
	 * The resolved repo config (provides `autoTask` for the spec gate,
	 * `selectionOrder` for the pool order, and the task-pool selection caps). The
	 * per-item runs still receive `autoTask`/`integration`/etc. via the spread
	 * `SharedDoOptions`.
	 */
	config: Config;
	/**
	 * The per-machine {@link ConfigOverrideMap}. Threaded into the in-place pool
	 * scan (`scanRepoPaths`) so the override applies to autopick eligibility just
	 * as it does to the single-`do` resolution — WITHOUT it the committed
	 * `.dorfl.json` silently beats the per-machine override on this path.
	 */
	override?: ConfigOverrideMap;
	/**
	 * `do -n <x>`: how many eligible items to do, in sequence. Auto-pick (no arg,
	 * no count) ⇒ 1. SEQUENTIAL — never a parallelism knob (advance-loop locks
	 * this: `-n` is always sequential for `do`/`advance`).
	 */
	count?: number;
	/** Override the single-`do` runner (tests inject a stub). Defaults to {@link performDo}. */
	run?: DoRunner;
	/** Override the read seam (spec pool); defaults to the active {@link ledgerRead}. */
	read?: LedgerReadStrategy;
}

/** The aggregate result of a multi-item `do` invocation. */
export interface DoMultiResult {
	/** Each per-item {@link DoResult}, in the order they ran. */
	results: DoResult[];
	/**
	 * The process exit code for the whole invocation: 0 iff EVERY item that ran
	 * succeeded (or there was nothing eligible to do — an empty auto-pick is not a
	 * failure); otherwise the first non-zero per-item exit code (the worst
	 * outcome surfaces). Mirrors the single-`do` exit contract per item.
	 */
	exitCode: number;
	/** Human-readable summary (printed by the CLI). */
	message: string;
}

/**
 * The task-pool caps for an in-place `do` selection. `do` is per-repo +
 * sequential, so the REAL bound is the requested `count` (handled by the
 * priority helper); the task-pool selection should not truncate BEFORE the
 * count + the spec pool are combined. We therefore cap the task pool at "all
 * eligible" (a large bound) and let {@link selectPrioritised}'s `count` do the
 * trimming across both pools.
 */
const ALL_ELIGIBLE = Number.MAX_SAFE_INTEGER;

/**
 * Run the AUTO-PICK / `-n <x>` form: build the two pools for `cwd`, order them
 * per the resolved `selectionOrder` (default `drain` = tasks-first), take `count`
 * (default 1), and run the existing `do` pipeline per selected item, SEQUENTIALLY.
 */
export async function performDoAuto(
	options: PerformDoMultiOptions,
): Promise<DoMultiResult> {
	const run = options.run ?? performDo;
	const read = options.read ?? ledgerRead;
	const note = options.note ?? (() => {});
	const cwd = options.cwd;
	const count = options.count ?? 1;

	// Pool 1 — eligible TASKS via the EXISTING scan/select path (task-only).
	// Thread `override` so the per-machine override is applied per repo (the
	// inner `resolveRepoConfig` re-applies it AFTER the committed file, restoring
	// the override value even though `config` is already resolved).
	const report = scanRepoPaths(
		[cwd],
		options.config,
		new Set(),
		options.override,
	);

	// Pool 2 — TASKABLE prds: the NEW pool from the shared spec read path
	// (`resolveSpecPool`) filtered by `autoslice-gate`'s predicate (not reinvented).
	const pool = read.resolveSpecPool({repoPath: cwd});
	const specCandidates: SpecCandidate[] = pool.specs.map((spec) => ({
		repoPath: cwd,
		slug: spec.slug,
		humanOnly: spec.humanOnly,
		needsAnswers: spec.needsAnswers,
		taskedAfter: spec.taskedAfter,
	}));
	const eligibleSpecs = taskableSpecs({
		candidates: specCandidates,
		taskedSlugs: pool.taskedSlugs,
		autoTask: options.config.autoTask,
	});

	// Order across both pools per the resolved `selectionOrder` + bound by count. The
	// task pool is selected via the SHARED `selectCandidates` primitive `run` uses.
	const selected = selectPrioritised({
		report,
		caps: {maxParallel: ALL_ELIGIBLE, perRepoMax: ALL_ELIGIBLE},
		specs: eligibleSpecs,
		selectionOrder: options.config.selectionOrder,
		count,
	});

	if (selected.length === 0) {
		const message =
			'Nothing eligible to do (no eligible tasks and no taskable prds).';
		note(message);
		return {results: [], exitCode: 0, message};
	}

	return runSelectedInSequence(selected, options, run);
}

/**
 * Run the EXPLICIT multi-arg form (`do <a> <b> …`): the named items in the GIVEN
 * order (no pool/priority — the operator chose them). Each arg is run through the
 * existing `do` pipeline, which itself resolves bare/`task:`/`spec:` (so a named
 * spec dispatches to the tasking path and a collision errors), SEQUENTIALLY.
 */
export async function performDoArgs(
	args: string[],
	options: PerformDoMultiOptions,
): Promise<DoMultiResult> {
	const run = options.run ?? performDo;
	const selected: SelectedItem[] = args.map((arg) => ({
		repoPath: options.cwd,
		slug: arg,
		// The arg is passed VERBATIM to `performDo` (it does its own slug
		// resolution); the namespace is irrelevant for explicit args.
		namespace: 'task' as const,
	}));
	return runSelectedInSequence(selected, options, run, {verbatimArg: true});
}

/**
 * Run a list of selected items through the existing `do` pipeline, SEQUENTIALLY,
 * threading the shared options to each. For the pool path the `do` arg encodes
 * the namespace (`spec:<slug>` for a selected spec, bare slug for a task); for the
 * explicit-arg path the caller's raw arg is passed verbatim.
 */
async function runSelectedInSequence(
	selected: SelectedItem[],
	options: PerformDoMultiOptions,
	run: DoRunner,
	mode: {verbatimArg?: boolean} = {},
): Promise<DoMultiResult> {
	const shared = sharedDoOptions(options);
	const results: DoResult[] = [];
	for (const item of selected) {
		const arg = mode.verbatimArg
			? item.slug
			: item.namespace === 'spec'
				? `spec:${item.slug}`
				: item.slug;
		const result = await run({...shared, arg});
		results.push(result);
	}

	const firstFailure = results.find((r) => r.exitCode !== 0);
	const exitCode = firstFailure ? firstFailure.exitCode : 0;
	const ok = results.filter((r) => r.exitCode === 0).length;
	const message =
		`did ${results.length} item${results.length === 1 ? '' : 's'} ` +
		`(${ok} ok, ${results.length - ok} not).`;
	return {results, exitCode, message};
}

/** Strip the multi-only fields, leaving exactly the per-item {@link DoOptions} base. */
function sharedDoOptions(options: PerformDoMultiOptions): SharedDoOptions {
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
