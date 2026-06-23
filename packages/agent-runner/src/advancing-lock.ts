import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {runAsync, type RunResult} from './git.js';
import {ledgerWrite} from './ledger-write.js';
import {resolveSidecarIdentity} from './sidecar.js';
import {acquireItemLock, releaseItemLock} from './item-lock.js';

/**
 * The **advancing-lock BORROW** (brief `advance-loop`, task
 * `advancing-lock-borrow`, US #19–24).
 *
 * The surface/apply/triage phase's SHORT borrow. As of the capstone cut-over
 * (task `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`, brief
 * `ledger-status-per-item-lock-refs`; ADR `ledger-status-on-per-item-lock-refs`)
 * the legacy `work/advancing/<entry>.md` presence-MARKER on `main` is GONE. The
 * advancing borrow now rides ONLY the UNIFIED per-item lock
 * (`refs/agent-runner/lock/<entry>`, `action: advance`) — there is no transient
 * status in `main`'s tree anymore, so a work branch cut from `main` inherits no
 * stale advancing marker.
 *
 * The borrow is keyed by item IDENTITY (`<type>-<slug>`, via
 * {@link resolveSidecarIdentity} — the single source of truth the unified lock,
 * the sidecar, and the work branch all share), so a task, a brief, and an
 * observation that share a slug NEVER collide, and the SAME `<entry>` ref means an
 * `advance` hold is MUTUALLY EXCLUSIVE with a claim/task hold of the SAME item BY
 * CONSTRUCTION (the second acquirer loses the SAME create-only ref CAS).
 *
 * It is file-ORTHOGONAL to the item it locks: the item's own lifecycle file NEVER
 * moves (the borrow is a LOCK, not a lifecycle transition), which is exactly why
 * it can lock items resting in DIFFERENT source folders (a backlog task, a `briefs/`
 * brief, an `observations/` note) with one uniform mechanism.
 *
 * **TREE-LESS vs BUILD/TASK RUNGS (`acquireUnified`).** The advance tick sets
 * `acquireUnified` PER RUNG (the policy lives in `advance.ts`, where the rung is
 * known):
 *
 *   - **TREE-LESS rungs** (`surface`/`apply`/`triage`) have NO inner `do`, so the
 *     advancing acquire takes the item's unified `action: advance` lock — that hold
 *     IS the advance∥claim / advance∥task exclusion. Acquire/release delegate to
 *     {@link acquireItemLock} / {@link releaseItemLock} (a parentless ref CAS, no
 *     working-tree write, no retry budget).
 *   - **BUILD-TASK / TASK-PRD rungs** never take the unified lock at the advance
 *     layer (`acquireUnified` false): `performAdvance` orchestrates an inner
 *     `performDo` that ITSELF acquires the SAME `task-<slug>`/`brief-<slug>` ref
 *     (the create-only CAS with NO re-entrancy/auto-steal), so taking it again here
 *     would DEADLOCK the tick against itself. For these rungs the acquire/release
 *     are a NO-OP (`acquired`/`released`); the inner `do`'s lock is the sole
 *     exclusion point (the POST-#9 EXCLUSION PROOF, owned by this task).
 *
 * A dry-run never takes the lock (it mutates nothing). This module stays
 * rung-agnostic — it only knows "unified or not", never the rung kind.
 *
 * This module also delivers {@link createItemThroughCas}: new-item creation routed
 * THROUGH the SAME write-seam CAS, keyed on the NEW item's identity (its target
 * path), so the (unlikely) same-slug new-item race needs NO special case — the
 * loser simply fails the CAS and backs off. The triage rung (observation→promote
 * drafting a new `work/backlog/<new-slug>.md`) consumes it. It is NOT a lock and
 * was never tied to the marker.
 *
 * Lock discipline: MANDATORY for the autonomous driver (a contender may be active),
 * a no-op formality for a solo human (no contender). Every lock acquire/release is
 * RUNNER-mediated (the agent never touches the lock ref). Recovery is the unified
 * lock's: `release-lock <item>` + the `gc --ledger` stuck-lock report (no liveness
 * heartbeat, no auto-sweep; a human asserts a lock is dead).
 */

const DEFAULT_ARBITER = 'origin';

// --- Acquire --------------------------------------------------------------

/** A semantic label for the lock-acquire outcome (never the verdict itself). */
export type AcquireAdvancingLockOutcome =
	| 'acquired'
	| 'usage-error'
	| 'lost'
	| 'contended';

/** Maps onto the claim-CAS exit codes (identical semantics). */
export type AcquireAdvancingLockExitCode = 0 | 1 | 2 | 3;

export interface AcquireAdvancingLockOptions {
	/**
	 * The NAMESPACED item identity to lock (`task:<slug>` / `brief:<slug>` /
	 * `obs:<slug>` / `observation:<slug>`, or a bare `<slug>` = task). The
	 * resolver derives the type-encoded entry `<type>-<slug>` from it.
	 */
	item: string;
	/** Working clone/worktree the lock acquire runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Advisory locker id. Defaults to git user.name, then $USER. */
	by?: string;
	/** Cap on push retries when main merely advanced. Default 3. (Unified lock is retry-free; retained for API parity.) */
	retries?: number;
	/** Show the intended push without mutating the arbiter (`--dry-run`). */
	dryRun?: boolean;
	/**
	 * Acquire the item's UNIFIED per-item lock (`action: advance`). The advance tick
	 * sets this PER RUNG (the policy lives where the rung is known — `advance.ts`):
	 * `true` for the TREE-LESS rungs (`surface`/`apply`/`triage`), which have no
	 * inner `do` and so genuinely need the unified hold to realise advance∥claim /
	 * advance∥task exclusion; `false` (the default) for the build-task / task-brief
	 * rungs, whose inner `performDo` ALREADY takes the SAME `task-<slug>`/`brief-<slug>`
	 * ref — taking it again here would DEADLOCK the tick against itself, so for those
	 * the acquire is a NO-OP `acquired`. When `true`, a lock `lost` makes the acquire
	 * lose DEFINITIVELY (no retry budget). A dry-run never takes the lock (it mutates
	 * nothing). This module stays rung-agnostic — it only knows "unified or not".
	 */
	acquireUnified?: boolean;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface AcquireAdvancingLockResult {
	exitCode: AcquireAdvancingLockExitCode;
	outcome: AcquireAdvancingLockOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
	/**
	 * The type-encoded lock entry name (`<type>-<slug>`) the borrow keyed onto —
	 * the unified lock ref is `refs/agent-runner/lock/<entry>`. Surfaced so the
	 * caller hands the SAME entry back (and so tests can assert the type-encoding).
	 */
	entry?: string;
}

/** Raised for usage/environment errors (exit 1). */
class AdvancingLockUsageError extends Error {}

/**
 * Acquire the advancing borrow for `item`. For a TREE-LESS rung
 * (`acquireUnified: true`) this is the item's unified `action: advance` lock (a
 * parentless ref CAS); for a build/task rung (the default) it is a NO-OP
 * `acquired` (the inner `do`'s claim/task lock is the exclusion). Never throws
 * for the expected "lost the race" (exit 2) case — it is returned.
 */
export async function acquireAdvancingLock(
	options: AcquireAdvancingLockOptions,
): Promise<AcquireAdvancingLockResult> {
	const note = options.note ?? (() => {});
	try {
		return await runAcquire(options, note);
	} catch (err) {
		if (err instanceof AdvancingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runAcquire(
	options: AcquireAdvancingLockOptions,
	note: (m: string) => void,
): Promise<AcquireAdvancingLockResult> {
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const dryRun = options.dryRun ?? false;
	const cwd = options.cwd;
	const env = options.env;

	if (!options.item) {
		throw new AdvancingLockUsageError(
			'missing <item>. usage: acquireAdvancingLock({item, cwd, arbiter})',
		);
	}
	// The type-encoded entry `<type>-<slug>` — the SAME identity scheme the sidecar
	// and the unified lock use, derived via the shared resolver (the source of truth).
	const {type, slug} = resolveSidecarIdentity(options.item);
	const entry = `${type}-${slug}`;

	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}
	const by = options.by || (await resolveBy(cwd, env));

	// BUILD/TASK rung (or a dry-run): NO advance-layer hold at all. The inner `do`'s
	// claim/task unified lock is the sole exclusion point — taking it again here
	// would deadlock the tick against itself. A NO-OP `acquired`.
	const acquireUnified = (options.acquireUnified ?? false) && !dryRun;
	if (!acquireUnified) {
		const message = dryRun
			? `[dry-run] advancing borrow for '${entry}' (no lock taken).`
			: `advancing borrow for '${entry}' rides the inner do's lock (no advance-layer hold).`;
		note(message);
		return {exitCode: 0, outcome: 'acquired', message, entry};
	}

	// TREE-LESS rung: take the item's UNIFIED per-item lock (`action: advance`,
	// keyed `item` so it shares the ONE `<type>-<slug>` ref with claim/task/advance
	// of the SAME item). A create-only ref CAS: the winner holds it, the loser is
	// DEFINITIVELY `lost` (exit 2, no retry budget — a per-item conflict the loser
	// should lose). No auto-steal of an orphaned lock, consistent with claim/task
	// and the ADR's recovery model (no liveness heartbeat / auto-sweep; a human
	// asserts a lock is dead via `release-lock` + `gc --ledger`).
	const lock = await acquireItemLock({
		item: options.item,
		action: 'advance',
		cwd,
		arbiter,
		holder: by,
		env,
	});
	if (lock.outcome === 'error') {
		throw new AdvancingLockUsageError(
			`failed to acquire the item lock for '${entry}': ${lock.message}`,
		);
	}
	if (lock.outcome === 'lost') {
		note(lock.message);
		return {exitCode: 2, outcome: 'lost', message: lock.message, entry};
	}
	const message = `LOCKED '${entry}' for advancing on ${arbiter} (unified lock).`;
	note(message);
	return {exitCode: 0, outcome: 'acquired', message, entry};
}

// --- Release --------------------------------------------------------------

/** A semantic label for the lock-release outcome. */
export type ReleaseAdvancingLockOutcome =
	| 'released'
	| 'usage-error'
	| 'lost'
	| 'contended';

/** Maps onto the claim-CAS exit codes (identical semantics). */
export type ReleaseAdvancingLockExitCode = 0 | 1 | 2 | 3;

export interface ReleaseAdvancingLockOptions {
	/** The NAMESPACED item identity whose borrow to release (same forms as acquire). */
	item: string;
	/** Working clone/worktree the release runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Advisory releaser id. Defaults to git user.name, then $USER. */
	by?: string;
	/** Cap on push retries when main merely advanced. Default 3. (Retained for API parity.) */
	retries?: number;
	/**
	 * Release the item's UNIFIED per-item lock (the complement of
	 * {@link AcquireAdvancingLockOptions.acquireUnified}). The advance tick sets this
	 * for a TREE-LESS rung (`surface`/`apply`/`triage`), where the acquire took the
	 * unified lock; `false` (the default) for the build-task / task-brief rungs,
	 * which never took it at the advance layer (the inner `performDo`'s claim/task
	 * lock is the exclusion point and is released by the inner `do`) — for those the
	 * release is a NO-OP `released`.
	 */
	releaseUnified?: boolean;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ReleaseAdvancingLockResult {
	exitCode: ReleaseAdvancingLockExitCode;
	outcome: ReleaseAdvancingLockOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
	/** The type-encoded lock entry name (`<type>-<slug>`) that was released. */
	entry?: string;
}

/**
 * Release the advancing borrow for `item`. For a TREE-LESS rung
 * (`releaseUnified: true`) this DELETES the item's unified `action: advance` lock
 * ref; for a build/task rung (the default) it is a NO-OP `released` (that rung
 * never took an advance-layer hold — the inner `do` released its own lock). It
 * moves NO lifecycle file: the borrow is a LOCK, not a lifecycle transition, so
 * the item is returned exactly where it rested.
 *
 * Idempotent: a unified release of an already-absent ref reports `released` (the
 * item is returned to rest with no held lock). Best-effort + never throws for the
 * expected cases.
 */
export async function releaseAdvancingLock(
	options: ReleaseAdvancingLockOptions,
): Promise<ReleaseAdvancingLockResult> {
	const note = options.note ?? (() => {});
	try {
		return await runRelease(options, note);
	} catch (err) {
		if (err instanceof AdvancingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runRelease(
	options: ReleaseAdvancingLockOptions,
	note: (m: string) => void,
): Promise<ReleaseAdvancingLockResult> {
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env;

	if (!options.item) {
		throw new AdvancingLockUsageError(
			'missing <item>. usage: releaseAdvancingLock({item, cwd, arbiter})',
		);
	}
	const {type, slug} = resolveSidecarIdentity(options.item);
	const entry = `${type}-${slug}`;

	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}

	// BUILD/TASK rung: nothing was held at the advance layer — a NO-OP `released`.
	const releaseUnified = options.releaseUnified ?? false;
	if (!releaseUnified) {
		const message = `advancing borrow for '${entry}' released (no advance-layer hold to drop).`;
		note(message);
		return {exitCode: 0, outcome: 'released', message, entry};
	}

	// TREE-LESS rung: delete the unified `action: advance` lock ref (idempotent —
	// an already-absent ref is `not-held`, still mapped to `released`: the item is
	// returned to rest with no held lock).
	const released = await releaseItemLock({
		item: options.item,
		cwd,
		arbiter,
		env,
	});
	if (released.outcome === 'error') {
		throw new AdvancingLockUsageError(
			`failed to release the item lock for '${entry}': ${released.message}`,
		);
	}
	const message =
		released.outcome === 'not-held'
			? `advancing borrow for '${entry}' was already released (no lock held).`
			: `RELEASED '${entry}' advancing borrow on ${arbiter} (item untouched).`;
	note(message);
	return {exitCode: 0, outcome: 'released', message, entry};
}

// --- New-item creation through the CAS ------------------------------------

/** A semantic label for the new-item creation outcome. */
export type CreateItemOutcome =
	| 'created'
	| 'usage-error'
	| 'lost'
	| 'contended';

/** Maps onto the claim-CAS exit codes (identical semantics). */
export type CreateItemExitCode = 0 | 1 | 2 | 3;

export interface CreateItemThroughCasOptions {
	/**
	 * The NEW item's path RELATIVE to the repo root (e.g.
	 * `work/backlog/<new-slug>.md`). The CAS is keyed on THIS path (the new item's
	 * identity): two concurrent creators of the same path race, the loser fails the
	 * CAS — no special case for the (unlikely) same-slug new-item collision.
	 */
	path: string;
	/** The new item's file content. */
	content: string;
	/** Working clone/worktree the creation runs in. */
	cwd: string;
	/** Name of the arbiter remote (`--arbiter`). Defaults to `origin`. */
	arbiter?: string;
	/** Advisory creator id. Defaults to git user.name, then $USER. */
	by?: string;
	/** Cap on push retries when main merely advanced. Default 3. */
	retries?: number;
	/** Show the intended push without mutating the arbiter (`--dry-run`). */
	dryRun?: boolean;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface CreateItemThroughCasResult {
	exitCode: CreateItemExitCode;
	outcome: CreateItemOutcome;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/** Internal: the result of a single create attempt. */
type CreateAttemptResult =
	| {kind: 'created'; message: string}
	| {kind: 'lost'; message: string}
	| {kind: 'rejected'; message: string};

/**
 * Create a NEW `work/` item THROUGH the CAS, keyed on the new item's identity (its
 * `path`). The reusable helper the triage rung consumes when an observation→promote
 * drafts a new `work/backlog/<new-slug>.md`: the (unlikely) same-slug new-item race
 * needs NO special case — exactly one creator lands the file, the loser fails the
 * CAS (exit 2) and backs off. Same CAS-micro-commit / force-with-lease shape as the
 * unified lock; it is NOT a lock (it does not hold a borrow), it ATOMICALLY publishes
 * a new file iff that path is still absent on the arbiter.
 */
export async function createItemThroughCas(
	options: CreateItemThroughCasOptions,
): Promise<CreateItemThroughCasResult> {
	const note = options.note ?? (() => {});
	try {
		return await runCreate(options, note);
	} catch (err) {
		if (err instanceof AdvancingLockUsageError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runCreate(
	options: CreateItemThroughCasOptions,
	note: (m: string) => void,
): Promise<CreateItemThroughCasResult> {
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const retries = options.retries ?? 3;
	const dryRun = options.dryRun ?? false;
	const cwd = options.cwd;
	const env = options.env;
	const path = options.path;

	if (!path) {
		throw new AdvancingLockUsageError(
			'missing <path>. usage: createItemThroughCas({path, content, cwd, arbiter})',
		);
	}
	if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError('not inside a git repository');
	}
	if ((await gitSoft(['remote', 'get-url', arbiter], cwd, env)).status !== 0) {
		throw new AdvancingLockUsageError(
			`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
		);
	}
	const by = options.by || (await resolveBy(cwd, env));

	const dirtyWorktree =
		(await gitSoft(['diff', '--quiet'], cwd, env)).status !== 0;
	const dirtyIndex =
		(await gitSoft(['diff', '--cached', '--quiet'], cwd, env)).status !== 0;
	if (dirtyWorktree || dirtyIndex) {
		throw new AdvancingLockUsageError(
			'working tree has uncommitted changes; commit/stash them before creating',
		);
	}

	// A throwaway create branch, slugified off the new item's path (so concurrent
	// creators of DIFFERENT paths don't collide on the branch name either).
	const createBranch = `create/${path.replace(/[^A-Za-z0-9._-]+/g, '-')}`;

	const origRef = await originalRef(cwd, env);
	try {
		let i = 0;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const result = await createAttempt({
				path,
				content: options.content,
				by,
				arbiter,
				dryRun,
				cwd,
				env,
				createBranch,
				note,
			});
			if (result.kind === 'created') {
				return {exitCode: 0, outcome: 'created', message: result.message};
			}
			if (result.kind === 'lost') {
				return {exitCode: 2, outcome: 'lost', message: result.message};
			}
			i += 1;
			if (i > retries) {
				const message = `push rejected ${i} times (main is contended). Try again shortly.`;
				note(message);
				return {exitCode: 3, outcome: 'contended', message};
			}
			note(`main advanced under us — refetch and retry (${i}/${retries})...`);
		}
	} finally {
		await cleanup(cwd, origRef, createBranch, env);
	}
}

interface CreateAttemptContext {
	path: string;
	content: string;
	by: string;
	arbiter: string;
	dryRun: boolean;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	createBranch: string;
	note: (m: string) => void;
}

/** One create attempt: branch off arbiter/main, add the new file, CAS-push. */
async function createAttempt(
	ctx: CreateAttemptContext,
): Promise<CreateAttemptResult> {
	const {arbiter, path, content, createBranch, cwd, env, note} = ctx;

	await gitHard(['fetch', '--quiet', arbiter], cwd, env);

	// Is the path still free on the arbiter's main? (the new item absent.)
	if (await catFileExists(`${arbiter}/main:${path}`, cwd, env)) {
		const message = `'${path}' already exists on ${arbiter}/main — the new item lost the create race (or the slug is taken). Back off.`;
		note(message);
		return {kind: 'lost', message};
	}

	await gitHard(
		['checkout', '--quiet', '--detach', `${arbiter}/main`],
		cwd,
		env,
	);
	await gitSoft(['branch', '-D', createBranch], cwd, env);
	await gitHard(
		['checkout', '--quiet', '-b', createBranch, `${arbiter}/main`],
		cwd,
		env,
	);

	const fileAbs = join(cwd, path);
	mkdirSync(dirname(fileAbs), {recursive: true});
	writeFileSync(fileAbs, content);
	const add = await gitSoft(['add', '--', path], cwd, env);
	if (add.status !== 0) {
		throw new AdvancingLockUsageError(
			`git add failed for '${path}' (unexpected — aborting create)`,
		);
	}

	await gitHard(
		['commit', '--quiet', '-m', `advance: create ${path} (by ${ctx.by})`],
		cwd,
		env,
	);

	const base = (
		await gitHard(['rev-parse', `${arbiter}/main`], cwd, env)
	).stdout.trim();
	const head = (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
	if (head === base) {
		throw new AdvancingLockUsageError(
			'advance-create commit is a no-op (nothing added) — aborting',
		);
	}

	// Publish through the SAME seam (kind `advancing`) — keyed on the new item's
	// identity (its path). The lease guards the CAS: a concurrent creator that
	// landed first advanced main past our base, so our lease fails → rejected; the
	// outer loop refetches and the next attempt finds the path TAKEN → lost (no
	// special case). This holds EVEN for a same-identity racer who built an
	// identical create commit within git's 1-second timestamp resolution: the seam
	// stamps each attempt with a per-attempt `CAS-Nonce`, so the two racers'
	// commits have DISTINCT shas — the loser's push is a genuine lease rejection,
	// NOT an "Everything up-to-date" no-op that would spuriously verify as won.
	if (ctx.dryRun) {
		const result = await ledgerWrite.applyTransition({
			kind: 'advancing',
			arbiter,
			localBranch: createBranch,
			expectedBase: base,
			head,
			cwd,
			dryRun: true,
			env,
			note,
		});
		return {kind: 'created', message: result.message};
	}

	const result = await ledgerWrite.applyTransition({
		kind: 'advancing',
		arbiter,
		localBranch: createBranch,
		expectedBase: base,
		head,
		cwd,
		env,
		note,
	});
	if (result.kind === 'published') {
		const message = `CREATED '${path}' on ${arbiter}/main.`;
		note(message);
		return {kind: 'created', message};
	}
	return {kind: 'rejected', message: result.message};
}

// --- Shared helpers (same shape as claim-cas.ts) --------------------------

/** The branch (or detached HEAD sha) we should return to afterward. */
async function originalRef(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const sym = await gitSoft(
		['symbolic-ref', '--quiet', '--short', 'HEAD'],
		cwd,
		env,
	);
	if (sym.status === 0 && sym.stdout.trim() !== '') {
		return sym.stdout.trim();
	}
	return (await gitHard(['rev-parse', 'HEAD'], cwd, env)).stdout.trim();
}

/** Best-effort: return to where we were and drop the throwaway branch. */
async function cleanup(
	cwd: string,
	origRef: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	await gitSoft(['checkout', '--quiet', origRef], cwd, env);
	await gitSoft(['branch', '-D', branch], cwd, env);
}

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

/** `git cat-file -e <object>` — true iff the object exists. */
async function catFileExists(
	object: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	return (await gitSoft(['cat-file', '-e', object], cwd, env)).status === 0;
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
