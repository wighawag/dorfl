import {runAsync, type RunResult} from './git.js';
import {
	acquireItemLock,
	releaseItemLock,
	markStuckItemLock,
} from './item-lock.js';
import {workItemRel} from './work-layout.js';

/**
 * The **slicing concurrency lock** (PRD `auto-slice`, slice `autoslice-lock`).
 *
 * Serialises *concurrent* slicers (two CI runs, or human + CI) so a PRD is never
 * double-sliced. As of the capstone cut-over (slice
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`, PRD
 * `ledger-status-per-item-lock-refs`; ADR `ledger-status-on-per-item-lock-refs`)
 * the legacy `git mv work/prd/<slug>.md → work/slicing/<slug>.md` MARKER on `main`
 * is GONE: the body NEVER relocates until the durable promotion, exactly as claim
 * no longer moves the slice body (slice
 * `cutover-claim-body-stays-and-complete-sources-from-backlog`). The slicing lock
 * is now ONLY the UNIFIED per-item lock (`refs/agent-runner/lock/<entry>`,
 * `action: slice`, keyed `prd:<slug>`) — the SAME ref claim and advance use for
 * the same item, so slicing a PRD is mutually exclusive with claiming/advancing
 * the SAME item BY CONSTRUCTION (the second acquirer loses the SAME create-only
 * ref CAS, with NO retry budget and NO false contention). There is no transient
 * status in `main`'s tree anymore, so a work branch cut from `main` inherits no
 * stale `slicing/` marker.
 *
 * - **Acquire** ({@link acquireSlicingLock}) acquires the unified per-item lock.
 *   A `lost` (the item is already held for implement/slice/advance) makes the
 *   slicing acquire lose DEFINITIVELY (exit 2, no retry). On a successful acquire
 *   it returns {@link AcquireSlicingLockResult.lockedBlob}: the git blob sha of the
 *   PRD body the lock TOOK, read from `work/prd/<slug>.md` on the arbiter — the
 *   snapshot the slicer reads + slices from, handed back so the integrate
 *   transition can fail loud if the held PRD was edited concurrently (the
 *   read-stability backstop). A dry-run takes no lock (it mutates nothing).
 *
 * - **Release** ({@link releaseSlicingLock}) DELETES the unified lock ref. It
 *   moves NO lifecycle file: the durable `prd → prd-sliced` success move is owned
 *   by the integrate band (`slicing.ts`/`integration-core.ts`), and there is no
 *   `slicing/ → prd/` abort bounce anymore (the body never left `prd/`). When
 *   `routeToNeedsAttention` is set (the slicer review/edit loop's
 *   decomposition-unclear verdict, or the slice-SET acceptance gate's `block`),
 *   release amends the lock `active → stuck` with the reason on the entry INSTEAD
 *   of deleting it — the per-item-lock stuck state IS the slicing needs-attention
 *   surface now (no `work/needs-attention/` folder write), consistent with the
 *   needs-attention cut-over (slice
 *   `cutover-needs-attention-becomes-lock-stuck-recovery-surface`). A human reads
 *   it via `agent-runner status` / `gc --ledger` and resolves via
 *   `release-lock`/`resume`.
 *
 * The READ-STABILITY backstop (the content-identity stale check that used to live
 * in the release, comparing the held `work/slicing/<slug>.md` blob against the
 * acquire-time snapshot) now lives at the integrate seam (`slicing.ts`
 * `heldPrdIsStale`, comparing `work/prd/<slug>.md`) — relocated because the
 * completing transition, not the release, owns the commit. See
 * `work/observations/slicing-lock-does-not-stabilise-prd-content.md`.
 *
 * This module provides the lock PRIMITIVES only. The orchestrating `do prd:<slug>`
 * slicing command (`slicing.ts`) acquires, drives the agent's slicing, integrates
 * the emitted slices + the durable `prd → prd-sliced` move, and releases. The
 * human path (no contention) may slice on `main` directly without the lock.
 */

const DEFAULT_ARBITER = 'origin';

/** A semantic label for the lock-acquire outcome (never the verdict itself). */
export type AcquireSlicingLockOutcome =
	| 'acquired'
	| 'usage-error'
	| 'lost'
	| 'contended';

/** Maps onto the claim-CAS exit codes (identical semantics). */
export type AcquireSlicingLockExitCode = 0 | 1 | 2 | 3;

export interface AcquireSlicingLockOptions {
	/** The PRD slug to lock (`work/prd/<slug>.md`). */
	slug: string;
	/** Working clone/worktree the lock acquire runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Advisory locker id. Defaults to git user.name, then $USER. */
	by?: string;
	/** Cap on push retries when main merely advanced. Default 3. (Unified lock is retry-free; retained for API parity.) */
	retries?: number;
	/** Show the intended acquire without mutating the arbiter (`--dry-run`). */
	dryRun?: boolean;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface AcquireSlicingLockResult {
	exitCode: AcquireSlicingLockExitCode;
	outcome: AcquireSlicingLockOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
	/**
	 * On a successful acquire (`acquired`), the git BLOB sha of the PRD body that
	 * the lock TOOK (`work/prd/<slug>.md` on the arbiter). This IS the snapshot the
	 * slicer reads + slices from; the integrate transition compares the current
	 * `work/prd/<slug>.md` blob against it to fail loud on a concurrent edit (the
	 * read-stability backstop). `undefined` unless `outcome === 'acquired'` (and on
	 * dry-run, where nothing was published).
	 */
	lockedBlob?: string;
}

/** Raised for usage/environment errors (exit 1). */
class SlicingLockUsageError extends Error {}

/**
 * Acquire the slicing lock for `slug`: take the item's unified `action: slice`
 * lock (a parentless ref CAS). Never throws for the expected "lost the race"
 * (exit 2) case — it is returned. Usage/environment problems surface as exit 1; a
 * held lock is exit 0.
 */
export async function acquireSlicingLock(
	options: AcquireSlicingLockOptions,
): Promise<AcquireSlicingLockResult> {
	const note = options.note ?? (() => {});
	try {
		return await runAcquire(options, note);
	} catch (err) {
		if (err instanceof SlicingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runAcquire(
	options: AcquireSlicingLockOptions,
	note: (m: string) => void,
): Promise<AcquireSlicingLockResult> {
	const slug = options.slug;
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const dryRun = options.dryRun ?? false;
	const cwd = options.cwd;
	const env = options.env;

	if (!slug) {
		throw new SlicingLockUsageError(
			'missing <slug>. usage: acquireSlicingLock({slug, cwd, arbiter})',
		);
	}
	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new SlicingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new SlicingLockUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}
	const by = options.by || (await resolveBy(cwd, env));

	// Is the PRD still lockable (present in work/prd/ on the arbiter's main)?
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	const prd = workItemRel('prd', `${slug}.md`);
	const prdBlob = await gitSoft(
		['rev-parse', `${arbiter}/main:${prd}`],
		cwd,
		env,
	);
	if (prdBlob.status !== 0) {
		const message = `'${prd}' not found on ${arbiter}/main (no such PRD, or it was already moved/sliced).`;
		note(message);
		return {exitCode: 2, outcome: 'lost', message};
	}
	const lockedBlob = prdBlob.stdout.trim();

	// A dry-run takes no lock (it mutates nothing) but still reports the lockable
	// snapshot it WOULD take.
	if (dryRun) {
		const message = `[dry-run] would acquire the slicing lock for '${slug}' (work/prd/${slug}.md present on ${arbiter}/main).`;
		note(message);
		return {exitCode: 0, outcome: 'acquired', message, lockedBlob};
	}

	// Acquire the UNIFIED per-item lock (`action: slice`, keyed `prd:<slug>` so it
	// shares the ONE ref with claim/advance of the SAME item). A create-only ref
	// CAS: the winner holds it, the loser is DEFINITIVELY `lost` (exit 2, no retry
	// budget). No auto-steal of an orphaned lock, consistent with claim/advance and
	// the ADR's recovery model (no liveness heartbeat / auto-sweep; a human asserts
	// a lock is dead via `release-lock` + `gc --ledger`).
	const lock = await acquireItemLock({
		item: `prd:${slug}`,
		action: 'slice',
		cwd,
		arbiter,
		holder: by,
		env,
	});
	if (lock.outcome === 'error') {
		throw new SlicingLockUsageError(
			`failed to acquire the item lock for '${slug}': ${lock.message}`,
		);
	}
	if (lock.outcome === 'lost') {
		note(lock.message);
		return {exitCode: 2, outcome: 'lost', message: lock.message};
	}
	const message = `LOCKED '${slug}' for slicing on ${arbiter} (unified lock).`;
	note(message);
	return {exitCode: 0, outcome: 'acquired', message, lockedBlob};
}

// --- Release --------------------------------------------------------------

/** A semantic label for the lock-release outcome. */
export type ReleaseSlicingLockOutcome =
	| 'released'
	| 'usage-error'
	| 'lost'
	| 'contended'
	| 'stale';

/** Maps onto the claim-CAS exit codes, plus `4` for a STALE (conflicting) lock. */
export type ReleaseSlicingLockExitCode = 0 | 1 | 2 | 3 | 4;

export interface ReleaseSlicingLockOptions {
	/** The PRD slug whose lock to release. */
	slug: string;
	/** Working clone/worktree the release runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/**
	 * The git BLOB sha the lock TOOK ({@link AcquireSlicingLockResult.lockedBlob}).
	 * RETAINED for API parity; the content-identity stale check now lives at the
	 * integrate seam (`slicing.ts` `heldPrdIsStale`), which runs BEFORE the
	 * completing commit. The release itself no longer reads the held body (there is
	 * no `slicing/` marker), so it does not consult this.
	 */
	lockedBlob?: string;
	/** Advisory releaser id. Defaults to git user.name, then $USER. */
	by?: string;
	/** Cap on push retries when main merely advanced. Default 3. */
	retries?: number;
	/**
	 * The slicer review→edit LOOP's **decomposition-unclear** verdict
	 * (`slicer-review-edit-loop`), or the slice-SET acceptance gate's `block`:
	 * instead of DELETING the lock (returning the PRD to the claimable/sliceable
	 * pool), amend it `active → stuck` with this reason recorded on the entry,
	 * emitting NO guessed slices. The PRD body stays in `work/prd/` (it never moved
	 * under the lock); the stuck lock IS the slicing needs-attention surface (no
	 * `work/needs-attention/` folder write), so it is NOT re-sliceable until a human
	 * resolves it via `release-lock`/`resume`. Omitted ⇒ the normal release DELETES
	 * the lock ref.
	 */
	routeToNeedsAttention?: {reason: string};
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ReleaseSlicingLockResult {
	exitCode: ReleaseSlicingLockExitCode;
	outcome: ReleaseSlicingLockOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/**
 * Release the slicing lock for `slug`: DELETE the unified `action: slice` lock ref
 * (idempotent — an already-absent ref is a clean `released`). It moves NO lifecycle
 * file: the durable `prd → prd-sliced` success move is owned by the integrate band,
 * and the PRD body never left `work/prd/` under the lock, so there is no
 * `slicing/ → prd/` restore.
 *
 * When `routeToNeedsAttention` is set (the slicer decomposition-unclear verdict /
 * the slice-SET acceptance gate `block`), the lock is AMENDED `active → stuck`
 * with the reason on the entry INSTEAD of deleted — the stuck per-item lock IS the
 * slicing needs-attention surface now (no folder write).
 *
 * Outcomes:
 *   - `released` (0): the lock ref is deleted (or amended stuck), the slicing is done.
 *   - `usage-error` (1): bad input / environment / a lock-amend fault.
 *   - `lost` (2): the lock is not held (nothing to release).
 */
export async function releaseSlicingLock(
	options: ReleaseSlicingLockOptions,
): Promise<ReleaseSlicingLockResult> {
	const note = options.note ?? (() => {});
	try {
		return await runRelease(options, note);
	} catch (err) {
		if (err instanceof SlicingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runRelease(
	options: ReleaseSlicingLockOptions,
	note: (m: string) => void,
): Promise<ReleaseSlicingLockResult> {
	const slug = options.slug;
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env;

	if (!slug) {
		throw new SlicingLockUsageError(
			'missing <slug>. usage: releaseSlicingLock({slug, cwd, arbiter})',
		);
	}
	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new SlicingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new SlicingLockUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}

	// DECOMPOSITION-UNCLEAR / SLICE-GATE BLOCK: amend the lock `active → stuck` with
	// the reason on the entry (the slicing needs-attention surface), NOT delete it.
	// The PRD body stays in `work/prd/`; the stuck lock keeps it out of the
	// sliceable pool until a human resolves it (`release-lock`/`resume`).
	if (options.routeToNeedsAttention !== undefined) {
		const stuck = await markStuckItemLock({
			item: `prd:${slug}`,
			reason: options.routeToNeedsAttention.reason,
			cwd,
			arbiter,
			env,
		});
		if (stuck.outcome === 'transitioned' || stuck.outcome === 'wrong-state') {
			// `wrong-state` (already stuck) is a tolerated idempotent re-surface.
			const message = `Routed the slicing of '${slug}' to needs-attention (per-item lock marked stuck).`;
			note(message);
			return {exitCode: 0, outcome: 'released', message};
		}
		if (stuck.outcome === 'not-held') {
			const message = `'${slug}' is not locked for slicing — nothing to mark stuck.`;
			note(message);
			return {exitCode: 2, outcome: 'lost', message};
		}
		const message = `could not mark the per-item lock for '${slug}' stuck (${stuck.outcome}: ${stuck.message}).`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', message};
	}

	// NORMAL release: delete the lock ref (idempotent).
	const released = await releaseItemLock({
		item: `prd:${slug}`,
		cwd,
		arbiter,
		env,
	});
	if (released.outcome === 'error') {
		throw new SlicingLockUsageError(
			`failed to release the item lock for '${slug}': ${released.message}`,
		);
	}
	const message =
		released.outcome === 'not-held'
			? `'${slug}' was not locked for slicing (already released).`
			: `RELEASED the slicing lock for '${slug}' on ${arbiter}.`;
	note(message);
	return {exitCode: 0, outcome: 'released', message};
}

// --- Shared helpers -------------------------------------------------------

/** Resolve the advisory locker: git user.name, else $USER/$USERNAME, else ''. */
async function resolveBy(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const name = await gitSoft(['config', 'user.name'], cwd, env);
	if (name.status === 0 && name.stdout.trim() !== '') {
		return name.stdout.trim();
	}
	const e = env ?? process.env;
	return e.USER ?? e.USERNAME ?? '';
}

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	return runAsync('git', args, cwd, {env});
}

/** Run git; throw on non-zero (genuinely unexpected plumbing failures). */
async function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	const result = await runAsync('git', args, cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result;
}
