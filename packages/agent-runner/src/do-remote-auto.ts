import {performDoRemote, type DoRemoteOptions, type DoResult} from './do.js';
import {ensureMirror} from './repo-mirror.js';
import {scanMirrorPool} from './mirror-pool-scan.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {selectPrioritised, type SelectedItem} from './select-priority.js';
import type {Config} from './config.js';

/**
 * The MIRROR-SIDE auto-pick / `-n` caller for `do --remote` (PRD `advance-loop`,
 * slice `advance-drivers-and-gates`, US #25) — the THIN caller the mirror-side
 * eligible-pool scan (`mirror-side-eligible-pool-scan`) makes possible, the
 * isolated counterpart of `do-autopick`'s in-place {@link performDoAuto}.
 *
 * It is the piece that lets the inline `-n`×`--remote` REFUSAL be removed: the
 * refusal was a placeholder for "a remote/isolated auto-pick would need a
 * mirror-side pool scan." That scan now EXISTS ({@link scanMirrorPool}), so this
 * caller SELECTS + ORDERS items from the bare hub mirror's committed `main` (the
 * SAME two pools, the SAME `selectPrioritised`, the SAME per-action gates) and
 * runs the EXISTING {@link performDoRemote} pipeline per selected item,
 * SEQUENTIALLY — it reimplements NOTHING.
 *
 * **`-n` is ALWAYS SEQUENTIAL (US #25).** Selecting N items from the mirror and
 * running them one at a time is a dumb "run the remote tick N times" loop;
 * parallelism over a remote pool is `run`'s concurrent loop or the CI matrix,
 * NEVER `-n`. The per-action gate family is honoured by the SELECTION layer: the
 * mirror scan only enumerates eligible slices (gated on `autoBuild`) + sliceable
 * PRDs (gated on `autoSlice`), so with a gate off that pool is empty.
 *
 * Each `performDoRemote` call idempotently `ensureMirror`s + re-fetches the SAME
 * bare mirror (no re-clone), so looping it per item is cheap; the mirror scan
 * `ensureMirror`s ONCE up front to read the freshest pool.
 */

/** The single-`do --remote` runner this caller drives per selected item. */
export type DoRemoteRunner = (options: DoRemoteOptions) => Promise<DoResult>;

/** Options shared with {@link performDoRemote}, threaded verbatim to each item. */
type SharedRemoteOptions = Omit<DoRemoteOptions, 'arg'>;

export interface PerformDoRemoteAutoOptions extends SharedRemoteOptions {
	/**
	 * The resolved (remote) repo config — provides `autoBuild`/`autoSlice` (the
	 * mirror scan applies them) and `selectionOrder` (the cross-pool order). The
	 * per-action gates are applied at the SELECTION layer, exactly as in-place.
	 */
	config: Config;
	/**
	 * `do --remote -n <x>`: how many eligible items to do, IN SEQUENCE. Auto-pick
	 * (no arg, no count) ⇒ 1. SEQUENTIAL — never a parallelism knob (US #25).
	 */
	count?: number;
	/** Override the single-`do --remote` runner (tests inject a stub). Defaults to {@link performDoRemote}. */
	run?: DoRemoteRunner;
	/** Override the read seam (mirror pool); defaults to the active {@link ledgerRead}. */
	read?: LedgerReadStrategy;
	/** Sink for a non-fatal mirror-config-read warning, forwarded to the scan. */
	warn?: (message: string) => void;
}

/** The aggregate result of a multi-item `do --remote` invocation (mirrors `DoMultiResult`). */
export interface DoRemoteMultiResult {
	results: DoResult[];
	/** 0 iff every item that ran succeeded (an empty auto-pick is not a failure); else the first non-zero. */
	exitCode: number;
	message: string;
}

/**
 * Run the `do --remote` AUTO-PICK / `-n <x>` form: ensure the hub mirror, scan its
 * committed `main` for the two eligible pools (gated per-action), order + bound
 * them by `count`, and run {@link performDoRemote} per selected item,
 * SEQUENTIALLY.
 */
export async function performDoRemoteAuto(
	options: PerformDoRemoteAutoOptions,
): Promise<DoRemoteMultiResult> {
	const run = options.run ?? performDoRemote;
	const read = options.read ?? ledgerRead;
	const note = options.note ?? (() => {});
	const count = options.count ?? 1;

	// Ensure (create/fetch) the bare hub mirror ONCE up front so the pool scan reads
	// the freshest committed `main`. Each per-item `performDoRemote` re-ensures the
	// SAME mirror idempotently (a fetch, never a re-clone).
	let mirror;
	try {
		mirror = ensureMirror({
			url: options.remote,
			workspacesDir: options.workspacesDir,
			env: options.env,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		note(message);
		return {results: [], exitCode: 1, message};
	}

	// Scan the mirror's committed `main` for the SAME two pools the in-place scan
	// enumerates (eligible slices gated on `autoBuild`, sliceable PRDs gated on
	// `autoSlice`), through the EXACT in-place predicates.
	const scan = await scanMirrorPool({
		mirrorPath: mirror.path,
		config: options.config,
		read,
		warn: options.warn,
		env: options.env,
	});

	// Order across both pools per the resolved `selectionOrder` + bound by count — the
	// SAME shared, pure `selectPrioritised` the in-place + `run` drivers use.
	const selected = selectPrioritised({
		report: scan.report,
		caps: {
			maxParallel: Number.MAX_SAFE_INTEGER,
			perRepoMax: Number.MAX_SAFE_INTEGER,
		},
		prds: scan.prds,
		selectionOrder: options.config.selectionOrder,
		count,
	});

	if (selected.length === 0) {
		const message =
			'Nothing eligible to do on the remote (no eligible slices and no ' +
			'sliceable PRDs under the per-action gates).';
		note(message);
		return {results: [], exitCode: 0, message};
	}

	const shared = sharedRemoteOptions(options);
	const results: DoResult[] = [];
	for (const item of selected) {
		const arg = remoteArgFor(item);
		const result = await run({...shared, arg});
		results.push(result);
	}

	const firstFailure = results.find((r) => r.exitCode !== 0);
	const exitCode = firstFailure ? firstFailure.exitCode : 0;
	const ok = results.filter((r) => r.exitCode === 0).length;
	const message =
		`did ${results.length} remote item${results.length === 1 ? '' : 's'} ` +
		`(${ok} ok, ${results.length - ok} not).`;
	return {results, exitCode, message};
}

/** The `do --remote` arg for a selected item: `prd:<slug>` for a PRD, bare slug for a slice. */
function remoteArgFor(item: SelectedItem): string {
	return item.namespace === 'brief' ? `brief:${item.slug}` : item.slug;
}

/**
 * Run the EXPLICIT multi-arg form (`do --remote <a> <b> …`): the NAMED items in
 * the GIVEN order (no pool/priority — the operator chose them), each through the
 * EXISTING {@link performDoRemote} pipeline, SEQUENTIALLY. No mirror scan is
 * needed (the args are explicit); the per-item pipeline resolves each
 * bare/`slice:`/`prd:` arg itself.
 */
export async function performDoRemoteArgs(
	args: string[],
	options: PerformDoRemoteAutoOptions,
): Promise<DoRemoteMultiResult> {
	const run = options.run ?? performDoRemote;
	const shared = sharedRemoteOptions(options);
	const results: DoResult[] = [];
	for (const arg of args) {
		const result = await run({...shared, arg});
		results.push(result);
	}
	const firstFailure = results.find((r) => r.exitCode !== 0);
	const exitCode = firstFailure ? firstFailure.exitCode : 0;
	const ok = results.filter((r) => r.exitCode === 0).length;
	const message =
		`did ${results.length} remote item${results.length === 1 ? '' : 's'} ` +
		`(${ok} ok, ${results.length - ok} not).`;
	return {results, exitCode, message};
}

/** Strip the multi-only fields, leaving exactly the per-item {@link DoRemoteOptions} base. */
function sharedRemoteOptions(
	options: PerformDoRemoteAutoOptions,
): SharedRemoteOptions {
	const {
		config: _config,
		count: _count,
		run: _run,
		read: _read,
		warn: _warn,
		...rest
	} = options;
	void _config;
	void _count;
	void _run;
	void _read;
	void _warn;
	return rest;
}
