import {mkdirSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {git, runAsync} from './git.js';
import {ensureMirror, encodeRepoKey} from './repo-mirror.js';
import {jobWorktreeDoDriver} from './do.js';
import {
	performAdvance,
	type AdvanceContext,
	type AdvanceResult,
	type AdvanceExitCode,
} from './advance.js';
import {scanMirrorPool} from './mirror-pool-scan.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {selectPrioritised, type SelectedItem} from './select-priority.js';
import type {LifecyclePoolGates} from './lifecycle-pools.js';
import type {Config} from './config.js';
import type {AdvanceTickRunner, AdvanceMultiResult} from './advance-drivers.js';

/**
 * The **ISOLATED advance-tick RUNNER** + its sequential drivers (PRD
 * `advance-loop`, slice `advance-isolated-one-shot`, US #25/26) — the "isolated
 * one-shot" cell `advance` was missing. It gives `advance` the SAME isolation
 * ergonomic `do --isolated` has: run the advance TICK ({@link performAdvance}) in
 * an ISOLATED worktree off THIS repo's arbiter (resolved from cwd), then integrate
 * + reap — instead of taking over the current checkout in-place.
 *
 * **HONEST SCOPE — what is REUSED vs what is NEW here.** The isolation SUBSTRATE is
 * reused verbatim; the per-item EXECUTION is genuinely new:
 *
 *   - REUSED: `resolveArbiterUrlFromCheckout` (`do.ts`, the CLI resolves the
 *     arbiter URL from cwd and threads it in here); the hub-mirror + isolation
 *     seam (`ensureMirror` + {@link jobWorktreeDoDriver}, which materialises its
 *     own job worktree off the arbiter for the build/slice rungs + reaps it); and
 *     the SCAN→SELECT→REFETCH SKELETON of `performDoRemoteAuto` (`do-remote-auto.ts`).
 *   - NEW: the **isolated advance-tick runner** ({@link performAdvanceIsolated}) —
 *     the per-item unit that runs `performAdvance` (classify → `advancing` lock →
 *     surface/apply/triage/build-orchestrate) inside a working clone off the
 *     cwd-resolved arbiter, then reaps it. `do --isolated`'s per-item runner is
 *     `performDoRemote` (the DO BUILD/SLICE pipeline), which does NOT run the
 *     advance tick — so it is NOT reusable as the per-item step; only the loop
 *     SKELETON is. This module builds the advance analogue + its driver wiring; it
 *     introduces NO new isolation MECHANISM (US #26 stays true).
 *
 * **Why an isolated cwd composes with all five rungs (only the runner is new).**
 * The advance tick threads a `cwd` + `arbiter` + a build/slice `doDriver`:
 *
 *   - the **build-slice / slice-prd** rungs ORCHESTRATE `do`/`do prd:` via the
 *     `doDriver` seam — we inject {@link jobWorktreeDoDriver} (off the cwd-resolved
 *     arbiter), so they build/slice ISOLATED in their OWN job worktree (the SAME
 *     isolation `do --isolated` gives the build tick) instead of in `process.cwd()`;
 *   - the **surface / apply / triage** rungs do tree-less, identity-keyed,
 *     ARBITER-resolved CAS writes (the sidecar + `needsAnswers`, the `advancing`
 *     borrow, observation→promote new-item creation) — they target the arbiter
 *     regardless of which checkout the tick runs in, so they compose with an
 *     isolated cwd unchanged. The isolated cwd is a working CLONE of the arbiter
 *     (origin = the arbiter), so those rungs commit/CAS against the arbiter exactly
 *     as the in-place tick does in the human's participating checkout.
 *
 * That composition is WHY only the per-item runner is new — the rungs need no
 * change, just an isolated cwd to run in.
 */

/** The per-item context an isolated advance tick consumes (everything BUT `arg`). */
export interface IsolatedAdvanceContext extends Omit<AdvanceContext, 'cwd'> {
	/**
	 * The arbiter URL the isolated worktree is off — resolved from the CWD's
	 * arbiter remote by the CLI (`resolveArbiterUrlFromCheckout`), exactly as
	 * `do --isolated` resolves its `remote`. `--remote <url>` supplies a foreign
	 * arbiter URL here instead (mirroring `do`: `--remote` wins over `--isolated`).
	 */
	remote: string;
	/**
	 * The agents' execution area (config `workspacesDir`) — where the hub mirror +
	 * the per-item working clone + the build/slice job worktrees live. NEVER the
	 * human area.
	 */
	workspacesDir: string;
}

/** Options for {@link performAdvanceIsolated} — the per-item isolated tick. */
export interface PerformAdvanceIsolatedOptions extends IsolatedAdvanceContext {
	/** The raw advance arg: bare (= slice), `prd:<slug>`, or `obs:<slug>`. */
	arg: string;
	/** The read seam (slug resolution / pool); defaults to {@link ledgerRead}. */
	read?: LedgerReadStrategy;
	/** Environment for child git/agent processes. */
	env?: NodeJS.ProcessEnv;
	/**
	 * Override the per-item tick runner (tests inject a stub to assert the cwd is
	 * the isolated clone, never the checkout). Defaults to {@link performAdvance}.
	 */
	run?: AdvanceTickRunner;
}

const DEFAULT_ARBITER = 'origin';

/**
 * Run ONE advance tick ISOLATED off the resolved arbiter — the per-item runner.
 *
 * It materialises a per-item working CLONE of the arbiter under the agents' area
 * (via the shared hub mirror — `ensureMirror` once + a cheap local clone of the
 * bare mirror, refetched so its `main` is current), points the advance tick's cwd
 * at it, threads a {@link jobWorktreeDoDriver} so the build/slice rungs isolate in
 * their OWN worktree off the SAME arbiter, runs the tick, then REAPS the clone.
 * The current checkout is NEVER touched (the isolation point), and a failed tick
 * reaps its clone like a failed `do --isolated`.
 */
export async function performAdvanceIsolated(
	options: PerformAdvanceIsolatedOptions,
): Promise<AdvanceResult> {
	const note = options.note ?? (() => {});
	const env = options.env;
	const run = options.run ?? performAdvance;
	const arbiterRemoteName = options.arbiter ?? DEFAULT_ARBITER;

	// 1. Ensure (create/fetch) the hub mirror for the resolved arbiter URL ONCE — the
	//    SAME isolation substrate `do --isolated` / `run` use. The per-item clone is
	//    cut from this freshly-fetched bare mirror (a cheap LOCAL clone, never a
	//    re-clone of the arbiter), so the tick reads the latest committed `main`.
	let mirror;
	try {
		mirror = ensureMirror({
			url: options.remote,
			workspacesDir: options.workspacesDir,
			env,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		note(message);
		return {exitCode: 1, outcome: 'usage-error', message};
	}

	// 2. A per-item working CLONE of the mirror (the tree-less surface/apply/triage
	//    rungs' ledger-write cwd — a bare mirror cannot `git mv`/`git commit`). Keyed
	//    per ARG so two sequential items get DISTINCT clones (the SAME per-job keying
	//    the remote claim clone uses). Its arbiter remote is wired to the REAL
	//    arbiter URL so the `advancing` borrow + the observation→promote new-item CAS
	//    target the arbiter, exactly as the in-place tick does from the human checkout.
	const argKey = options.arg.replace(/[^a-zA-Z0-9._-]/g, '_');
	const cloneDir = join(
		options.workspacesDir,
		'advance-cwd',
		`${encodeRepoKey(mirror.url).split('/').join('__')}__${argKey}`,
	);
	rmSync(cloneDir, {recursive: true, force: true});
	mkdirSync(dirname(cloneDir), {recursive: true});
	try {
		git(['clone', '--quiet', mirror.path, cloneDir], dirname(cloneDir), {env});
		// Re-point the clone's arbiter remote at the REAL arbiter URL (a `git clone` of
		// the bare MIRROR leaves `origin` pointing at the mirror). The tree-less rungs'
		// ARBITER-resolved CAS writes (`advancing` borrow, observation->promote) + the
		// ff-push of the result then target the arbiter — so they land there REGARDLESS
		// of which checkout the tick ran in (the property that lets an isolated cwd
		// compose with the surface/apply/triage rungs unchanged). When the configured
		// arbiter remote is NOT `origin`, ADD it alongside the clone's `origin`.
		if (arbiterRemoteName === 'origin') {
			git(['remote', 'set-url', 'origin', mirror.url], cloneDir, {env});
		} else {
			git(['remote', 'add', arbiterRemoteName, mirror.url], cloneDir, {env});
		}
		git(['fetch', '--quiet', arbiterRemoteName], cloneDir, {env});

		// 3. Run the advance TICK against the isolated clone. The build/slice rungs
		//    ORCHESTRATE `do` through the INJECTED job-worktree driver (their OWN
		//    worktree off the arbiter — the SAME isolation `run`'s build tick gives),
		//    NOT in `process.cwd()`. The surface/apply/triage rungs run tree-less in
		//    the clone, targeting the arbiter remote wired above.
		const context: AdvanceContext = {
			...stripIsolatedFields(options),
			cwd: cloneDir,
			arbiter: arbiterRemoteName,
			doDriver: jobWorktreeDoDriver({
				// Off the REAL arbiter URL (NOT the local mirror path) so `performDoRemote`
				// reuses the SAME hub mirror `ensureMirror` already created above (keyed on
				// `mirror.url` = the resolved arbiter URL) + integrates back to the arbiter.
				remote: mirror.url,
				workspacesDir: options.workspacesDir,
			}),
		};
		const result = await run({
			...context,
			arg: options.arg,
			read: options.read,
		});

		// A TREE-LESS rung (surface/apply/triage) committed the sidecar / marker
		// LOCALLY in the clone; ff-push it to the arbiter so the result LANDS (a
		// one-shot from a busy checkout would otherwise vanish with the reaped clone).
		// The build/slice rungs already pushed via the job-worktree `doDriver`.
		if (
			result.exitCode === 0 &&
			result.rung !== undefined &&
			TREELESS_RUNGS.has(result.rung)
		) {
			await pushTreelessResult({
				cwd: cloneDir,
				arbiter: arbiterRemoteName,
				retries: 3,
				env,
				note,
			});
		}
		return result;
	} finally {
		// 4. REAP the per-item clone (a disposable working tree, like a failed
		//    `do --isolated`'s worktree). The durable artifact is the arbiter; the
		//    clone is never the recovery surface.
		rmSync(cloneDir, {recursive: true, force: true});
	}
}

/** Strip the isolated-only fields, leaving exactly the per-item {@link AdvanceContext} base. */
function stripIsolatedFields(
	options: PerformAdvanceIsolatedOptions,
): Omit<AdvanceContext, 'cwd' | 'doDriver'> {
	const {
		remote: _remote,
		workspacesDir: _workspacesDir,
		arg: _arg,
		read: _read,
		env: _env,
		run: _run,
		arbiter: _arbiter,
		...rest
	} = options;
	void _remote;
	void _workspacesDir;
	void _arg;
	void _read;
	void _env;
	void _run;
	void _arbiter;
	return rest;
}

/** Options shared with every per-item isolated tick run, threaded verbatim. */
type SharedIsolatedContext = IsolatedAdvanceContext;

export interface PerformAdvanceIsolatedMultiOptions extends SharedIsolatedContext {
	/**
	 * The resolved (remote) repo config — provides `autoBuild`/`autoSlice` (the
	 * mirror scan applies them at the SELECTION layer) + `selectionOrder` (the
	 * cross-pool order), exactly as the in-place one-shot driver applies them.
	 */
	config: Config;
	/**
	 * `advance --isolated -n <x>`: how many eligible items to advance, IN SEQUENCE.
	 * Auto-pick (no arg, no count) ⇒ 1. SEQUENTIAL — never a parallelism knob
	 * (US #25; parallelism is `run` / the CI matrix).
	 */
	count?: number;
	/** The read seam (mirror pool); defaults to {@link ledgerRead}. */
	read?: LedgerReadStrategy;
	/** Environment for child git/agent processes. */
	env?: NodeJS.ProcessEnv;
	/** Override the per-item isolated tick runner (tests). Defaults to {@link performAdvanceIsolated}. */
	runIsolated?: (
		options: PerformAdvanceIsolatedOptions,
	) => Promise<AdvanceResult>;
	/** Override the per-tick runner forwarded to {@link performAdvanceIsolated} (tests). */
	run?: AdvanceTickRunner;
	/** Sink for a non-fatal mirror-config-read warning, forwarded to the scan. */
	warn?: (message: string) => void;
	/**
	 * The LIFECYCLE-POOL create-gates forwarded to {@link scanMirrorPool} (triage /
	 * surface sub-pools), the SAME gates the in-place auto-pick + the loop driver
	 * apply. Omitted ⇒ both off (the apply sub-pool is always-on).
	 */
	lifecycleGates?: LifecyclePoolGates;
}

/**
 * Run the `advance --isolated` AUTO-PICK / `-n <x>` form — the advance analogue of
 * `performDoRemoteAuto`, SHARING its scan/select/refetch SKELETON but using the
 * ISOLATED advance-tick runner as the per-item unit:
 *
 *   1. `ensureMirror` ONCE up front (the per-item runner re-`ensureMirror`s the
 *      SAME mirror idempotently — a fetch, never a re-clone);
 *   2. {@link scanMirrorPool} over the bare hub mirror's committed `main` (the
 *      isolated counterpart of the in-place pool scan, gated per-action);
 *   3. {@link selectPrioritised} (slices-first / `prdsFirst`, bounded by `count`);
 *   4. a SEQUENTIAL loop over the FROZEN selected set (selected ONCE in 2–3, NEVER
 *      re-scanned) where each per-item {@link performAdvanceIsolated} re-fetches the
 *      SAME mirror, so item N's clone branches off a `main` that contains item N-1's
 *      result (FRESHNESS, not re-selection — the SNAPSHOT-ONCE parity with
 *      `do --isolated -n`).
 *
 * **`-n` is ALWAYS SEQUENTIAL (US #25)** — selecting N items from the mirror and
 * running them one at a time is a dumb "run the tick N times" loop; parallelism is
 * `run`'s concurrent loop or the CI matrix, NEVER `-n`. **SNAPSHOT-ONCE, NOT
 * dependency-aware:** a `blockedBy` dependent ineligible at scan time is NOT
 * selected and is NOT drained in the same run — IDENTICAL to `do --isolated -n`
 * (dependency-aware scheduling is a SEPARATE cross-verb enhancement,
 * `work/observations/do-autopick-no-dependency-aware-scheduling.md`).
 */
export async function performAdvanceIsolatedAuto(
	options: PerformAdvanceIsolatedMultiOptions,
): Promise<AdvanceMultiResult> {
	const runIsolated = options.runIsolated ?? performAdvanceIsolated;
	const read = options.read ?? ledgerRead;
	const note = options.note ?? (() => {});
	const count = options.count ?? 1;

	// Ensure the bare hub mirror ONCE up front so the pool scan reads the freshest
	// committed `main`. Each per-item `performAdvanceIsolated` re-ensures the SAME
	// mirror idempotently (a fetch, never a re-clone).
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

	// Scan the mirror's committed `main` for the SAME pools the in-place scan
	// enumerates (eligible slices gated on `autoBuild`, sliceable PRDs gated on
	// `autoSlice`, + the lifecycle sub-pools), through the SHARED mirror-pool scan.
	const scan = await scanMirrorPool({
		mirrorPath: mirror.path,
		config: options.config,
		read,
		warn: options.warn,
		env: options.env,
		lifecycleGates: options.lifecycleGates,
	});

	// Order across the pools per the resolved `selectionOrder` + bound by count —
	// the SAME shared, pure `selectPrioritised` the in-place + `run` drivers use.
	// Selected ONCE here; the loop iterates the FROZEN set (snapshot-once).
	const selected = selectPrioritised({
		report: scan.report,
		caps: {
			maxParallel: Number.MAX_SAFE_INTEGER,
			perRepoMax: Number.MAX_SAFE_INTEGER,
		},
		prds: scan.prds,
		selectionOrder: options.config.selectionOrder,
		lifecycle: scan.lifecycle,
		count,
	});

	if (selected.length === 0) {
		const message =
			'Nothing eligible to advance on the remote (no eligible slices and no ' +
			'sliceable PRDs under the per-action gates).';
		note(message);
		return {results: [], exitCode: 0, message};
	}

	const results: AdvanceResult[] = [];
	for (const item of selected) {
		const result = await runIsolated(
			perItemOptions(options, argForSelected(item)),
		);
		results.push(result);
	}
	return aggregate(results);
}

/**
 * Run the EXPLICIT multi-arg form (`advance --isolated <a> <b> …`): the NAMED items
 * in the GIVEN order (no pool/priority — the operator chose them), each through the
 * ISOLATED advance-tick runner, SEQUENTIALLY. No mirror scan is needed (the args
 * are explicit); the per-item tick resolves each bare/`prd:`/`obs:` arg itself.
 */
export async function performAdvanceIsolatedArgs(
	args: string[],
	options: PerformAdvanceIsolatedMultiOptions,
): Promise<AdvanceMultiResult> {
	const runIsolated = options.runIsolated ?? performAdvanceIsolated;
	const results: AdvanceResult[] = [];
	for (const arg of args) {
		const result = await runIsolated(perItemOptions(options, arg));
		results.push(result);
	}
	return aggregate(results);
}

/**
 * The TREE-LESS rung kinds (slice `advance-isolated-one-shot` `## Decisions` #2)
 * — the rungs that commit the sidecar / `needsAnswers` / triage marker LOCALLY in
 * the tick cwd (a working clone of the arbiter) rather than going through `do`'s
 * build/slice integration. After one of these advances, the isolated runner
 * fast-forward-pushes the clone's `main` to the arbiter so the result LANDS on the
 * arbiter (a one-shot `advance --isolated` surface from a busy checkout would
 * otherwise commit only into the reaped clone and vanish). The `advancing` borrow
 * already serialised the item, and the surface/apply persist appends/clears under
 * the held lock, so this is a true fast-forward; we re-fetch + retry a bounded few
 * times if `main` advanced under us, mirroring the lock CAS's retry shape. The
 * build/slice rungs already pushed via the job-worktree `doDriver`, so they are NOT
 * in this set. NO new isolation MECHANISM — just a git ff-push of an already-
 * committed `main`.
 */
const TREELESS_RUNGS = new Set(['surface', 'apply', 'triage-observation']);

/**
 * Fast-forward-push the isolated clone's `main` to the arbiter after a tree-less
 * rung committed locally, so the sidecar / marker LANDS on the arbiter. Re-fetches
 * + retries a bounded few times if `main` advanced under us (NEVER `--force`); a
 * push that keeps failing is reported but does not crash the tick (the work is
 * still saved in the clone for the next pass / a human).
 */
async function pushTreelessResult(params: {
	cwd: string;
	arbiter: string;
	retries: number;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<void> {
	const {cwd, arbiter, retries, env, note} = params;
	for (let i = 0; i <= retries; i++) {
		const push = await runAsync(
			'git',
			['push', '--quiet', arbiter, 'HEAD:main'],
			cwd,
			{env},
		);
		if (push.status === 0) {
			return;
		}
		const contended = /non-fast-forward|rejected|fetch first|stale info/i.test(
			push.stderr,
		);
		if (!contended || i === retries) {
			note(
				`advance --isolated: could not publish the tree-less result to ` +
					`${arbiter}/main (${push.stderr.trim() || 'push failed'}); the work is ` +
					`saved in the isolated clone and will re-apply on the next pass.`,
			);
			return;
		}
		// `main` advanced under us — re-fetch + rebase our (one) commit onto it, retry.
		await runAsync('git', ['fetch', '--quiet', arbiter], cwd, {env});
		const rebase = await runAsync(
			'git',
			['rebase', '--quiet', `${arbiter}/main`],
			cwd,
			{env},
		);
		if (rebase.status !== 0) {
			await runAsync('git', ['rebase', '--abort'], cwd, {env});
			note(
				`advance --isolated: the tree-less result conflicted with ${arbiter}/main; ` +
					`the work is saved in the isolated clone for the next pass / a human.`,
			);
			return;
		}
	}
}

/** The advance arg for a pool-selected item (the SELECTION->ARG dispatch). */
function argForSelected(item: SelectedItem): string {
	if (item.namespace === 'observation') {
		return `obs:${item.slug}`;
	}
	return item.namespace === 'prd' ? `prd:${item.slug}` : item.slug;
}

/** Build the per-item {@link PerformAdvanceIsolatedOptions} for one arg. */
function perItemOptions(
	options: PerformAdvanceIsolatedMultiOptions,
	arg: string,
): PerformAdvanceIsolatedOptions {
	const {
		config: _config,
		count: _count,
		read,
		env,
		runIsolated: _runIsolated,
		run,
		warn: _warn,
		lifecycleGates: _lifecycleGates,
		...rest
	} = options;
	void _config;
	void _count;
	void _runIsolated;
	void _warn;
	void _lifecycleGates;
	return {...rest, arg, read, env, run};
}

/** Aggregate per-item results into the multi-item contract (mirrors `do`'s). */
function aggregate(results: AdvanceResult[]): AdvanceMultiResult {
	const firstFailure = results.find((r) => r.exitCode !== 0);
	const exitCode: AdvanceExitCode = firstFailure ? firstFailure.exitCode : 0;
	const ok = results.filter((r) => r.exitCode === 0).length;
	const message =
		`advanced ${results.length} item${results.length === 1 ? '' : 's'} ` +
		`(${ok} ok, ${results.length - ok} not).`;
	return {results, exitCode, message};
}
