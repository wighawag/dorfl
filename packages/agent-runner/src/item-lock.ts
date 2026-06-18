import {randomUUID} from 'node:crypto';
import {runAsync, type RunResult} from './git.js';
import {resolveSidecarIdentity} from './sidecar.js';

/**
 * The **unified item-lock module** (PRD `ledger-status-per-item-lock-refs`, ADR
 * `ledger-status-on-per-item-lock-refs`). The runner's ONE lock primitive: ONE
 * lock per item, on a PER-ITEM hidden ref `refs/agent-runner/lock/<entry>`,
 * acquired by an ATOMIC create-only push and released by DELETING the ref, with a
 * two-axis (`action` × `state`) entry. It collapses the old transient status
 * folders (`in-progress`, `needs-attention`, `slicing`, `advancing`) into ONE
 * lock keyed by item identity; `in-progress` = lock held active for `implement`,
 * `needs-attention` = lock held `stuck`.
 *
 * It GENERALISES the green tracer that proved the dangerous core end-to-end on a
 * bare `file://` arbiter (the tracer is now this file). The one production
 * difference from the tracer is the IDENTITY SEAM: callers pass a NAMESPACED item
 * identity (`slice:<slug>` / `prd:<slug>` / `observation:<slug>` / `obs:<slug>`,
 * or a bare `<slug>` = slice), and this module derives the type-encoded lock
 * `<entry>` (`<type>-<slug>`) through {@link resolveSidecarIdentity} — the SAME
 * single source of truth the sidecar (`work/questions/<type>-<slug>.md`) and the
 * advancing-lock marker (`advancingMarkerPath`, `work/advancing/<type>-<slug>.md`)
 * already use. There is deliberately NO second identity scheme: a slice, a PRD,
 * and an observation that share a slug get DISTINCT lock refs, and the SAME item
 * under different actions shares ONE ref (so implement / slice / advance on one
 * item are mutually exclusive by construction).
 *
 * It is NOT yet wired into claim/slice/advance — those are separate, dependent
 * slices — and deliberately does NOT touch `main`.
 *
 * WHY a per-item ref (not a marker on `main` or a tree on one shared ref):
 *   - **No false contention, no retry.** The ONLY writer that can contend on item
 *     X's lock is another writer FOR X — a GENUINE conflict the loser SHOULD lose.
 *     Two writers for DIFFERENT items touch DIFFERENT refs and never serialise. So
 *     acquire needs NO refetch-retry budget (contrast the shared-`main` CAS, which
 *     falsely-contends under parallelism and exhausts its retry cap → exit 3).
 *   - **Self-cleaning, no storage growth.** Acquire CREATES the ref; release
 *     DELETES it (not "empties" it), so the live ref set = currently-held items
 *     only. The lock commit is PARENTLESS (no `main` parent), so on ref-delete it
 *     is immediately unreachable and reclaimed by normal git gc — and the lock ref
 *     is fully decoupled from `main`'s object graph.
 *   - **Branch-inheritance impossible.** Nothing is in `main`'s tree, so a work
 *     branch cut from `main` inherits no lock state.
 *   - **Provider-agnostic.** A ref is a ref: the create-only / delete pushes work
 *     identically on a `--bare file://` arbiter and a real remote.
 *
 * ATOMICITY is the `--force-with-lease=<ref>:` (EMPTY expected) create-only push:
 * the arbiter accepts it ONLY if the ref is still absent; a racer who lost finds
 * the ref present and is rejected. No nonce gymnastics are needed here (unlike the
 * shared-`main` CAS) because the ref NAME is the identity — two acquires for the
 * same item race the SAME ref, and ref-level create-only is itself the mutex.
 */

/** The ref namespace for per-item locks. HIDDEN (not `refs/heads/*`): invisible
 * in the GitHub UI, not swept by branch automation, not fetched by a default
 * clone. Deletion = "all locks released" (recoverable; work is on the work
 * branches + `main`). */
export const LOCK_REF_PREFIX = 'refs/agent-runner/lock';

/**
 * The single IDENTITY SEAM for the lock: derive the type-encoded lock `<entry>`
 * (`<type>-<slug>`) from a NAMESPACED item identity, through the shared
 * {@link resolveSidecarIdentity} resolver (the single source of truth, which the
 * sidecar filename + the advancing-lock marker also key onto). Accepts the same
 * forms as that resolver: `slice:<slug>` / `prd:<slug>` / `observation:<slug>` /
 * `obs:<slug>`, or a bare `<slug>` (= slice). Acquire/release/read ALL key
 * through THIS function, so there is one — and only one — addressing scheme.
 */
export function lockEntryFor(item: string): string {
	const {type, slug} = resolveSidecarIdentity(item);
	return `${type}-${slug}`;
}

/** The lock ref for a type-encoded `<entry>` (`<type>-<slug>`). */
export function itemLockRef(entry: string): string {
	return `${LOCK_REF_PREFIX}/${entry}`;
}

/** WHAT holds the lock — the three mutually-exclusive actions over one item. */
export type LockAction = 'implement' | 'slice' | 'advance';

/** Health of the hold: `active` (in-progress) or `stuck` (needs-attention). */
export type LockState = 'active' | 'stuck';

/**
 * The two-axis lock entry. `action` and `state` are INDEPENDENT axes (so
 * "advanced-and-stuck" and "building-and-stuck" are both representable, which a
 * single action-field could not do). `reason` is present IFF `state === 'stuck'`.
 */
export interface LockEntry {
	entry: string;
	action: LockAction;
	state: LockState;
	holder: string;
	since: string;
	reason?: string;
}

/** Outcome of an acquire attempt. `acquired` = we hold it; `lost` = someone else
 * does (a genuine same-item conflict). `error` = environment/usage. */
export type AcquireOutcome = 'acquired' | 'lost' | 'error';
export type ReleaseOutcome = 'released' | 'not-held' | 'error';

export interface AcquireResult {
	outcome: AcquireOutcome;
	/** The type-encoded lock entry (`<type>-<slug>`) the acquire keyed onto. */
	entry: string;
	ref: string;
	message: string;
}
export interface ReleaseResult {
	outcome: ReleaseOutcome;
	/** The type-encoded lock entry (`<type>-<slug>`) the release keyed onto. */
	entry: string;
	ref: string;
	message: string;
}

/**
 * Outcome of an AMEND-style transition (mark-stuck / resume / requeue) — the
 * lock-entry STATE MACHINE's interior moves (PRD `ledger-status-per-item-lock-refs`,
 * the C8 lock-entry state machine in the design trail). Each is a single CAS on the
 * held ref (no retry loop), so the verdict is definitive:
 *   - `transitioned` — we won the CAS; the entry now holds the target `(action, state)`.
 *   - `not-held`     — there is no entry to transition (the move's precondition is
 *                      "a held entry in the right state"; absent ⇒ illegal here).
 *   - `wrong-state`  — an entry exists but in the wrong `state` for this move
 *                      (e.g. resume on an `active` entry, mark-stuck on a `stuck` one).
 *                      An ILLEGAL transition, rejected, not coerced.
 *   - `lost`         — the leased CAS was rejected because a CONCURRENT writer changed
 *                      the ref between our read and our push (a genuine same-item race).
 *   - `error`        — environment/usage (missing item, missing reason for mark-stuck, …).
 */
export type TransitionOutcome =
	| 'transitioned'
	| 'not-held'
	| 'wrong-state'
	| 'lost'
	| 'error';

export interface TransitionResult {
	outcome: TransitionOutcome;
	/** The type-encoded lock entry (`<type>-<slug>`) the transition keyed onto. */
	entry: string;
	ref: string;
	message: string;
	/** The lock entry AFTER a successful `transitioned` (absent for requeue's removal). */
	lock?: LockEntry;
}

function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	return runAsync('git', args, cwd, {env});
}
async function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	const r = await runAsync('git', args, cwd, {env});
	if (r.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`,
		);
	}
	return r;
}

/** Serialise a lock entry to the ref's blob body (markdown frontmatter, like the
 * advancing marker, so it round-trips and is previewable). */
export function serialiseLockEntry(e: LockEntry): string {
	const lines = [
		'---',
		`entry: ${e.entry}`,
		`action: ${e.action}`,
		`state: ${e.state}`,
		`holder: ${e.holder}`,
		`since: ${e.since}`,
		...(e.state === 'stuck' && e.reason ? [`reason: ${e.reason}`] : []),
		'---',
		'',
		`Lock held for \`${e.entry}\` (${e.action}/${e.state}).`,
		'',
	];
	return lines.join('\n');
}

/**
 * Build a PARENTLESS commit whose tree contains the single lock-entry blob, and
 * return its sha. Parentless (no `-p`) so it is decoupled from `main` and becomes
 * unreachable the instant the ref is deleted (gc reclaims it). Uses plumbing
 * (`hash-object` → `mktree` → `commit-tree`), never the working tree/index/HEAD,
 * so it is safe to call from any worktree.
 */
async function buildLockCommit(
	entry: LockEntry,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const body = serialiseLockEntry(entry);
	const blob = (
		await gitHardInput(['hash-object', '-w', '--stdin'], cwd, env, body)
	).stdout.trim();
	// One tree entry: `lock.md` → the blob.
	const treeInput = `100644 blob ${blob}\tlock.md\n`;
	const tree = (
		await gitHardInput(['mktree'], cwd, env, treeInput)
	).stdout.trim();
	const message = `lock: ${entry.entry} (${entry.action}/${entry.state})`;
	// PARENTLESS commit (no -p): the lock graph never joins main's history.
	const commit = (
		await gitHard(['commit-tree', tree, '-m', message], cwd, env)
	).stdout.trim();
	return commit;
}

/** `gitHard` variant that pipes `input` to stdin (for hash-object/mktree). */
async function gitHardInput(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
	input: string,
): Promise<RunResult> {
	const r = await runAsync('git', args, cwd, {env, input});
	if (r.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`,
		);
	}
	return r;
}
export interface AcquireOptions {
	/**
	 * The NAMESPACED item identity to lock (`slice:<slug>` / `prd:<slug>` /
	 * `observation:<slug>` / `obs:<slug>`, or a bare `<slug>` = slice). Resolved to
	 * the type-encoded lock `<entry>` through {@link lockEntryFor}.
	 */
	item: string;
	action: LockAction;
	cwd: string;
	arbiter?: string;
	holder?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * Acquire the per-item lock atomically: build a parentless lock commit and push it
 * to `refs/agent-runner/lock/<entry>` with `--force-with-lease=<ref>:` (the EMPTY
 * expected value = create-only). The arbiter accepts ONLY if the ref is still
 * absent. A racer who lost finds the ref present → its lease fails → `lost`. No
 * retry loop: a rejection here is a GENUINE same-item conflict, not false
 * contention.
 */
export async function acquireItemLock(
	opts: AcquireOptions,
): Promise<AcquireResult> {
	const arbiter = opts.arbiter ?? 'origin';
	const env = opts.env;
	const cwd = opts.cwd;
	if (!opts.item) {
		return {outcome: 'error', entry: '', ref: '', message: 'missing item'};
	}
	const entry = lockEntryFor(opts.item);
	const ref = itemLockRef(entry);
	try {
		// Fetch the current lock refs so the lease sees the real state.
		await gitHard(
			[
				'fetch',
				'--quiet',
				arbiter,
				`+${LOCK_REF_PREFIX}/*:${LOCK_REF_PREFIX}/*`,
			],
			cwd,
			env,
		);
		const holder = opts.holder ?? (await resolveHolder(cwd, env));
		const commit = await buildLockCommit(
			{
				entry,
				action: opts.action,
				state: 'active',
				holder,
				since: new Date().toISOString(),
			},
			cwd,
			env,
		);
		// CREATE-ONLY push: --force-with-lease=<ref>: (empty) succeeds iff ref absent.
		const push = await gitSoft(
			['push', arbiter, `${commit}:${ref}`, `--force-with-lease=${ref}:`],
			cwd,
			env,
		);
		if (push.status === 0) {
			return {outcome: 'acquired', entry, ref, message: `locked ${entry}`};
		}
		// Rejected: the ref already exists (held by someone for the SAME item).
		return {
			outcome: 'lost',
			entry,
			ref,
			message: `'${entry}' is already locked (held by another). Back off.`,
		};
	} catch (err) {
		return {
			outcome: 'error',
			entry,
			ref,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

export interface ReleaseOptions {
	/** The NAMESPACED item identity (same forms as {@link AcquireOptions.item}). */
	item: string;
	cwd: string;
	arbiter?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * Release the per-item lock by DELETING the ref (`git push <arbiter>
 * :refs/agent-runner/lock/<entry>`). Deleting (not emptying) is what makes the
 * lock set self-cleaning: a released item has NO ref, and its parentless commit
 * becomes unreachable for gc. Idempotent: deleting an absent ref is `not-held`.
 */
export async function releaseItemLock(
	opts: ReleaseOptions,
): Promise<ReleaseResult> {
	const arbiter = opts.arbiter ?? 'origin';
	const env = opts.env;
	const cwd = opts.cwd;
	if (!opts.item) {
		return {outcome: 'error', entry: '', ref: '', message: 'missing item'};
	}
	const entry = lockEntryFor(opts.item);
	const ref = itemLockRef(entry);
	try {
		await gitHard(
			[
				'fetch',
				'--quiet',
				arbiter,
				`+${LOCK_REF_PREFIX}/*:${LOCK_REF_PREFIX}/*`,
			],
			cwd,
			env,
		);
		const held =
			(await gitSoft(['rev-parse', '--verify', '--quiet', ref], cwd, env))
				.status === 0;
		if (!held) {
			return {
				outcome: 'not-held',
				entry,
				ref,
				message: `'${entry}' not locked`,
			};
		}
		// Delete the ref on the arbiter. Lease on the current value guards against a
		// concurrent change between our fetch and the delete.
		const cur = (await gitHard(['rev-parse', ref], cwd, env)).stdout.trim();
		const del = await gitSoft(
			['push', arbiter, '--delete', ref, `--force-with-lease=${ref}:${cur}`],
			cwd,
			env,
		);
		if (del.status === 0) {
			// Drop our local copy of the ref too (best-effort).
			await gitSoft(['update-ref', '-d', ref], cwd, env);
			return {outcome: 'released', entry, ref, message: `released ${entry}`};
		}
		return {
			outcome: 'error',
			entry,
			ref,
			message: `release push rejected: ${del.stderr.trim()}`,
		};
	} catch (err) {
		return {
			outcome: 'error',
			entry,
			ref,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Fetch the lock refs and return the held entry + its current ref sha, or
 * `undefined` when the item is at REST (no ref). Shared read-before-CAS step for
 * the amend-style transitions (mark-stuck / resume / requeue): they all need BOTH
 * the current entry (to check the state precondition + carry forward `action` /
 * `holder` / `since`) and the current sha (to lease the CAS on it).
 */
async function fetchHeldEntry(
	entry: string,
	ref: string,
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<{lock: LockEntry; sha: string} | undefined> {
	await gitHard(
		['fetch', '--quiet', arbiter, `+${LOCK_REF_PREFIX}/*:${LOCK_REF_PREFIX}/*`],
		cwd,
		env,
	);
	const rev = await gitSoft(
		['rev-parse', '--verify', '--quiet', ref],
		cwd,
		env,
	);
	if (rev.status !== 0 || rev.stdout.trim() === '') {
		return undefined;
	}
	const sha = rev.stdout.trim();
	const show = await gitSoft(['show', `${ref}:lock.md`], cwd, env);
	const lock = show.status === 0 ? parseLockEntry(show.stdout) : undefined;
	if (!lock) {
		return undefined;
	}
	return {lock, sha};
}

/**
 * AMEND the held entry in place via a leased CAS: build a NEW parentless commit
 * carrying `next` and push it to the SAME ref with `--force-with-lease=<ref>:<sha>`
 * (the sha we just read). The arbiter accepts ONLY if the ref is unchanged since
 * our read — a concurrent writer who moved it makes our lease fail (`lost`). No
 * retry loop: a rejection is a genuine same-item race the caller should lose.
 */
async function amendHeldEntry(
	next: LockEntry,
	ref: string,
	expectedSha: string,
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<TransitionResult> {
	const commit = await buildLockCommit(next, cwd, env);
	const push = await gitSoft(
		[
			'push',
			arbiter,
			`${commit}:${ref}`,
			`--force-with-lease=${ref}:${expectedSha}`,
		],
		cwd,
		env,
	);
	if (push.status === 0) {
		// Move our local copy to the new commit too (best-effort) so a subsequent
		// read in the same clone sees the amended entry without a refetch.
		await gitSoft(['update-ref', ref, commit], cwd, env);
		return {
			outcome: 'transitioned',
			entry: next.entry,
			ref,
			message: `${next.entry} → ${next.action}/${next.state}`,
			lock: next,
		};
	}
	return {
		outcome: 'lost',
		entry: next.entry,
		ref,
		message: `'${next.entry}' lock changed concurrently (CAS lost). Back off.`,
	};
}

export interface MarkStuckOptions {
	/** The NAMESPACED item identity (same forms as {@link AcquireOptions.item}). */
	item: string;
	/** The needs-attention prose. REQUIRED — a `stuck` entry always carries a reason. */
	reason: string;
	cwd: string;
	arbiter?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * mark-stuck (transition 2): `[action, active] -> [action, stuck] + reason`. The
 * runner bounces (red gate, agent failure, decomposition-unclear). A leased CAS
 * amend of the SAME entry's `state` + `reason`, keeping `action`/`holder`/`since`.
 * It is the source of the needs-attention SURFACE (now read from the lock ref,
 * not a `work/needs-attention/` folder).
 *
 * PRECONDITIONS (the state machine + invariants):
 *   - the entry must be HELD and `active` (`not-held` / `wrong-state` otherwise) —
 *     stuck is reachable only FROM active, never from absent or already-stuck.
 *   - `reason` must be non-empty (the `reason` PRESENT iff `state: stuck` invariant).
 */
export async function markStuckItemLock(
	opts: MarkStuckOptions,
): Promise<TransitionResult> {
	const arbiter = opts.arbiter ?? 'origin';
	const env = opts.env;
	const cwd = opts.cwd;
	if (!opts.item) {
		return {outcome: 'error', entry: '', ref: '', message: 'missing item'};
	}
	const entry = lockEntryFor(opts.item);
	const ref = itemLockRef(entry);
	if (!opts.reason || opts.reason.trim() === '') {
		return {
			outcome: 'error',
			entry,
			ref,
			message: 'mark-stuck requires a reason (reason iff stuck)',
		};
	}
	try {
		const held = await fetchHeldEntry(entry, ref, cwd, arbiter, env);
		if (!held) {
			return {
				outcome: 'not-held',
				entry,
				ref,
				message: `'${entry}' not locked`,
			};
		}
		if (held.lock.state !== 'active') {
			return {
				outcome: 'wrong-state',
				entry,
				ref,
				message: `'${entry}' is ${held.lock.state}, not active; cannot mark-stuck`,
			};
		}
		const next: LockEntry = {
			...held.lock,
			state: 'stuck',
			reason: opts.reason.trim(),
		};
		return await amendHeldEntry(next, ref, held.sha, cwd, arbiter, env);
	} catch (err) {
		return {
			outcome: 'error',
			entry,
			ref,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

export interface ResumeOptions {
	/** The NAMESPACED item identity (same forms as {@link AcquireOptions.item}). */
	item: string;
	cwd: string;
	arbiter?: string;
	/** Optionally reassign the holder on resume (a human/continue picks it up). */
	holder?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * resume (transition 3): `[action, stuck] -> [action, active]`. A human (or a
 * `continue`) picks the stuck item up: amend `state` back to `active` and CLEAR
 * `reason` (the `reason` iff `stuck` invariant — an active entry never carries a
 * stuck reason). Keeps the same `action`; `holder` may be reassigned. The
 * lock-entry analogue of the old `needs-attention -> in-progress` folder move.
 *
 * PRECONDITION: the entry must be HELD and `stuck` (`not-held` / `wrong-state`
 * otherwise) — active is reachable from stuck only, not from absent.
 */
export async function resumeItemLock(
	opts: ResumeOptions,
): Promise<TransitionResult> {
	const arbiter = opts.arbiter ?? 'origin';
	const env = opts.env;
	const cwd = opts.cwd;
	if (!opts.item) {
		return {outcome: 'error', entry: '', ref: '', message: 'missing item'};
	}
	const entry = lockEntryFor(opts.item);
	const ref = itemLockRef(entry);
	try {
		const held = await fetchHeldEntry(entry, ref, cwd, arbiter, env);
		if (!held) {
			return {
				outcome: 'not-held',
				entry,
				ref,
				message: `'${entry}' not locked`,
			};
		}
		if (held.lock.state !== 'stuck') {
			return {
				outcome: 'wrong-state',
				entry,
				ref,
				message: `'${entry}' is ${held.lock.state}, not stuck; nothing to resume`,
			};
		}
		const next: LockEntry = {
			...held.lock,
			state: 'active',
			holder: opts.holder ?? held.lock.holder,
		};
		// reason is PRESENT iff stuck: drop it on the way back to active.
		delete next.reason;
		return await amendHeldEntry(next, ref, held.sha, cwd, arbiter, env);
	} catch (err) {
		return {
			outcome: 'error',
			entry,
			ref,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * requeue (transition 4): `[action, stuck] -> (absent)`. Give up on a STUCK hold
 * and return the item to the pool by REMOVING the entry. The body never moved
 * (Amendment 5 — it is already resting in `backlog/` on `main`), so requeue is
 * purely "release the lock"; the kept `work/<slug>` branch remains for recovery.
 *
 * Distinct from {@link releaseItemLock} (transition 6, abort from ACTIVE): requeue
 * is the GUARDED give-up from `stuck` only, so it rejects (`wrong-state`) an
 * `active` entry — abandoning an in-flight active hold goes through `release`, not
 * `requeue`. The removal itself is a leased delete (a concurrent change ⇒ `lost`).
 */
export async function requeueItemLock(
	opts: ReleaseOptions,
): Promise<TransitionResult> {
	const arbiter = opts.arbiter ?? 'origin';
	const env = opts.env;
	const cwd = opts.cwd;
	if (!opts.item) {
		return {outcome: 'error', entry: '', ref: '', message: 'missing item'};
	}
	const entry = lockEntryFor(opts.item);
	const ref = itemLockRef(entry);
	try {
		const held = await fetchHeldEntry(entry, ref, cwd, arbiter, env);
		if (!held) {
			return {
				outcome: 'not-held',
				entry,
				ref,
				message: `'${entry}' not locked`,
			};
		}
		if (held.lock.state !== 'stuck') {
			return {
				outcome: 'wrong-state',
				entry,
				ref,
				message: `'${entry}' is ${held.lock.state}, not stuck; use release to abort an active hold`,
			};
		}
		const del = await gitSoft(
			[
				'push',
				arbiter,
				'--delete',
				ref,
				`--force-with-lease=${ref}:${held.sha}`,
			],
			cwd,
			env,
		);
		if (del.status === 0) {
			await gitSoft(['update-ref', '-d', ref], cwd, env);
			return {
				outcome: 'transitioned',
				entry,
				ref,
				message: `requeued ${entry} (lock released, body still in pool)`,
			};
		}
		return {
			outcome: 'lost',
			entry,
			ref,
			message: `'${entry}' lock changed concurrently (CAS lost). Back off.`,
		};
	} catch (err) {
		return {
			outcome: 'error',
			entry,
			ref,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Read the current lock entry for an item from the arbiter (the `status`/`scan`
 * read path): fetch the lock refs, read `lock.md` from the ref's tree. Returns
 * `undefined` when the item is not locked.
 */
export async function readItemLock(
	opts: ReleaseOptions,
): Promise<LockEntry | undefined> {
	const arbiter = opts.arbiter ?? 'origin';
	const env = opts.env;
	const cwd = opts.cwd;
	const ref = itemLockRef(lockEntryFor(opts.item));
	await gitHard(
		['fetch', '--quiet', arbiter, `+${LOCK_REF_PREFIX}/*:${LOCK_REF_PREFIX}/*`],
		cwd,
		env,
	);
	const show = await gitSoft(['show', `${ref}:lock.md`], cwd, env);
	if (show.status !== 0) {
		return undefined;
	}
	return parseLockEntry(show.stdout);
}

/** List the entries (`<type>-<slug>`) currently locked on the arbiter (the
 * stuck-lock report / `status` read path). */
export async function listItemLocks(
	cwd: string,
	arbiter = 'origin',
	env?: NodeJS.ProcessEnv,
): Promise<string[]> {
	await gitHard(
		['fetch', '--quiet', arbiter, `+${LOCK_REF_PREFIX}/*:${LOCK_REF_PREFIX}/*`],
		cwd,
		env,
	);
	const out = await gitSoft(
		['for-each-ref', '--format=%(refname)', `${LOCK_REF_PREFIX}/*`],
		cwd,
		env,
	);
	if (out.status !== 0) {
		return [];
	}
	return out.stdout
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.startsWith(`${LOCK_REF_PREFIX}/`))
		.map((l) => l.slice(`${LOCK_REF_PREFIX}/`.length))
		.sort();
}

/** Parse a serialised lock entry body back into a {@link LockEntry}. */
export function parseLockEntry(body: string): LockEntry | undefined {
	const fm = /^---\n([\s\S]*?)\n---/.exec(body);
	if (!fm) {
		return undefined;
	}
	const fields: Record<string, string> = {};
	for (const line of fm[1].split('\n')) {
		const m = /^([a-zA-Z]+):\s*(.*)$/.exec(line);
		if (m) {
			fields[m[1]] = m[2];
		}
	}
	if (!fields.entry || !fields.action || !fields.state) {
		return undefined;
	}
	return {
		entry: fields.entry,
		action: fields.action as LockAction,
		state: fields.state as LockState,
		holder: fields.holder ?? '',
		since: fields.since ?? '',
		reason: fields.reason,
	};
}

/** Advisory holder id: git user.name, else $USER, else a uuid fragment. */
async function resolveHolder(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const name = await gitSoft(['config', 'user.name'], cwd, env);
	if (name.status === 0 && name.stdout.trim() !== '') {
		return name.stdout.trim();
	}
	const e = env ?? process.env;
	return e.USER ?? e.USERNAME ?? randomUUID().slice(0, 8);
}
