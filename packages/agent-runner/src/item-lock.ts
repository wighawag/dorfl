import {randomUUID} from 'node:crypto';
import {runAsync, type RunResult} from './git.js';
import {resolveSidecarIdentity, type SidecarType} from './sidecar.js';
import {workItemRel} from './work-layout.js';

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
 * identity (`task:<slug>` / `brief:<slug>` / `observation:<slug>` / `obs:<slug>`,
 * or a bare `<slug>` = task), and this module derives the type-encoded lock
 * `<entry>` (`<type>-<slug>`) through {@link resolveSidecarIdentity} — the SAME
 * single source of truth the sidecar (`work/questions/<type>-<slug>.md`) and the
 * work branch (`work/<type>-<slug>`) already use. There is deliberately NO second
 * identity scheme: a task, a brief,
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
 * forms as that resolver: `task:<slug>` / `brief:<slug>` / `observation:<slug>` /
 * `obs:<slug>`, or a bare `<slug>` (= task). Acquire/release/read ALL key
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
 *
 * Since the lock entry is the SOLE stuck record (slice
 * `cutover-needs-attention-becomes-lock-stuck-recovery-surface`, decision i+: the
 * `needs-attention/` folder is retired), `reason` is the FULL bounce prose (it may
 * span multiple lines — a red-gate excerpt, a rebase-conflict report, an agent's
 * ambiguity note), and `questions` carries any agent-surfaced questions for the
 * human. Both ride in the lock blob BODY (not a single frontmatter field) so they
 * round-trip richly, in a shape a future advance-surface rung
 * (`work/ideas/advance-surfaces-and-self-clears-stuck-locks-via-questions.md`) can
 * render into a `work/questions/` sidecar. `questions` is present (non-empty) only
 * for a stuck entry that recorded them.
 */
export interface LockEntry {
	entry: string;
	action: LockAction;
	state: LockState;
	holder: string;
	since: string;
	reason?: string;
	questions?: string[];
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

/** The body heading that opens the (possibly multi-line) stuck reason prose. */
const LOCK_REASON_HEADING = '## Reason';
/** The body heading that opens the agent-surfaced questions list. */
const LOCK_QUESTIONS_HEADING = '## Questions';

/**
 * Serialise a lock entry to the ref's blob body (markdown frontmatter, like the
 * advancing marker, so it round-trips and is previewable). The two-axis state
 * (`entry`/`action`/`state`/`holder`/`since`) lives in the frontmatter; a stuck
 * entry's FULL reason prose + any surfaced questions live in the BODY (under
 * `## Reason` / `## Questions`) so they round-trip RICHLY (multi-line reason,
 * bulleted questions) — the lock entry is the SOLE stuck record now, in a shape a
 * future advance-surface rung can render. {@link parseLockEntry} is the exact
 * inverse.
 */
export function serialiseLockEntry(e: LockEntry): string {
	const lines = [
		'---',
		`entry: ${e.entry}`,
		`action: ${e.action}`,
		`state: ${e.state}`,
		`holder: ${e.holder}`,
		`since: ${e.since}`,
		'---',
		'',
		`Lock held for \`${e.entry}\` (${e.action}/${e.state}).`,
	];
	if (e.state === 'stuck' && e.reason) {
		lines.push('', LOCK_REASON_HEADING, '', ...e.reason.split('\n'));
	}
	if (e.state === 'stuck' && e.questions && e.questions.length > 0) {
		lines.push('', LOCK_QUESTIONS_HEADING, '');
		for (const q of e.questions) {
			lines.push(`- ${q}`);
		}
	}
	lines.push('');
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
	 * The NAMESPACED item identity to lock (`task:<slug>` / `brief:<slug>` /
	 * `observation:<slug>` / `obs:<slug>`, or a bare `<slug>` = task). Resolved to
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

/** Outcome of a GUARDED release ({@link releaseHeldItemLock}): the caller HELD the
 * lock, so an absent ref is NOT benign — it is `vanished` (the ref was deleted
 * under us, an abort signal). */
export type ReleaseHeldOutcome = 'released' | 'vanished' | 'error';

export interface ReleaseHeldResult {
	outcome: ReleaseHeldOutcome;
	/** The type-encoded lock entry (`<type>-<slug>`) the release keyed onto. */
	entry: string;
	ref: string;
	message: string;
}

/**
 * GUARDED release for a runner that KNOWS it acquired and HELD the lock (PRD
 * `ledger-status-per-item-lock-refs` US #13): unlike {@link releaseItemLock} —
 * whose `not-held` is a BENIGN idempotent case the complete/slicing/needs-attention
 * callers tolerate (the body may predate the lock, or a crash-recovery may have
 * already cleared it) — here the absence of OUR ref is an ABORT SIGNAL. A held
 * runner whose own lock VANISHED mid-build (someone `release-lock`-ed it, or a
 * `gc`/recovery cleared it) must DETECT it on release and route to
 * needs-attention rather than silently "clean-release" a lock it no longer holds:
 * the work it just did was NOT protected by the exclusion it thought it had.
 *
 * So this maps {@link releaseItemLock}'s `not-held` to a DISTINCT `vanished`
 * outcome the caller branches on (abort / needs-attention), while a genuine
 * `released` is the happy path and `error` stays `error`. It is otherwise the
 * SAME leased delete (no second mechanism): a clean `released` deletes the ref we
 * held. Use this ONLY where the caller provably HELD the lock (the in-flight
 * runner's own release); the tolerant idempotent callers keep using
 * {@link releaseItemLock}.
 */
export async function releaseHeldItemLock(
	opts: ReleaseOptions,
): Promise<ReleaseHeldResult> {
	const rel = await releaseItemLock(opts);
	if (rel.outcome === 'not-held') {
		return {
			outcome: 'vanished',
			entry: rel.entry,
			ref: rel.ref,
			message: `'${rel.entry}' lock VANISHED before our release (the ref is gone) — our hold was lost mid-build; abort / route to needs-attention rather than clean-release.`,
		};
	}
	return {
		outcome: rel.outcome,
		entry: rel.entry,
		ref: rel.ref,
		message: rel.message,
	};
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

/** Verdict of the SHARED leased delete {@link leasedDeleteLockRef}: `deleted` (the
 * ref was removed), `lost` (a concurrent change moved the ref between the read and
 * the delete — the lease was REJECTED, never `--force`d), or `error`. */
export type LeasedDeleteOutcome = 'deleted' | 'lost' | 'error';

/**
 * The ONE leased-delete CLEAR path shared by every code path that removes a held
 * lock ref by lease (the recovery {@link reconcileItemLockAgainstMain}, the
 * human-invoked {@link reapStaleItemLocks} sweep, …): delete `ref` on the arbiter
 * with `--force-with-lease=<ref>:<expectedSha>`, so the arbiter accepts ONLY if the
 * ref is UNCHANGED since the caller read `expectedSha`. A concurrent writer who
 * moved the ref (e.g. a racer who just marked it `stuck`) makes the lease FAIL →
 * `lost` (reported, NEVER force-deleted). On success the local copy is dropped too
 * (best-effort). It is the SAME leased delete `release-lock` / requeue use — there
 * is no second clear mechanism.
 */
async function leasedDeleteLockRef(
	ref: string,
	expectedSha: string,
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LeasedDeleteOutcome> {
	const del = await gitSoft(
		[
			'push',
			arbiter,
			'--delete',
			ref,
			`--force-with-lease=${ref}:${expectedSha}`,
		],
		cwd,
		env,
	);
	if (del.status !== 0) {
		return 'lost';
	}
	// Drop our local copy of the ref too (best-effort) so a subsequent read in the
	// same clone does not see the now-deleted lock.
	await gitSoft(['update-ref', '-d', ref], cwd, env);
	return 'deleted';
}

export interface MarkStuckOptions {
	/** The NAMESPACED item identity (same forms as {@link AcquireOptions.item}). */
	item: string;
	/** The needs-attention prose. REQUIRED — a `stuck` entry always carries a reason. */
	reason: string;
	/**
	 * Any agent-surfaced QUESTIONS for the human, recorded on the stuck entry's
	 * body (the lock is the SOLE stuck record now). Optional; empty/absent ⇒ no
	 * questions block. A future advance-surface rung renders these into a
	 * `work/questions/` sidecar.
	 */
	questions?: string[];
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
		const questions = (opts.questions ?? [])
			.map((q) => q.trim())
			.filter((q) => q !== '');
		if (questions.length > 0) {
			next.questions = questions;
		} else {
			delete next.questions;
		}
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
		// reason + questions are PRESENT iff stuck: drop them on the way to active.
		delete next.reason;
		delete next.questions;
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

/**
 * The DURABLE-`main` terminal record paths for an item, by its type — the
 * authoritative resting records the cross-substrate reconciliation reads. An
 * item is TERMINAL on `main` iff ANY of these paths exists on `<arbiter>/main`.
 * The won't-proceed terminal is PER-REGIME (the slug-collision correctness fix:
 * a dropped task and a dropped brief sharing a slug used to collide on one
 * bare-slug `work/dropped/<slug>.md`):
 *   - a TASK: `work/tasks/done/<slug>.md` (completed) OR
 *     `work/tasks/cancelled/<slug>.md` (the task regime's won't-proceed terminal).
 *   - a BRIEF: `work/briefs/tasked/<slug>.md` (sliced) OR `work/briefs/dropped/<slug>.md`
 *     (the brief regime's won't-proceed terminal).
 *   - an OBSERVATION: NONE. A note has no durable terminal folder — it leaves by
 *     deletion (its absence, not a terminal record, is the end state). A promoted
 *     observation becomes a NEW task/brief with its own ref.
 */
export function terminalMainPaths(type: SidecarType, slug: string): string[] {
	const file = `${slug}.md`;
	switch (type) {
		case 'task':
			return [workItemRel('done', file), workItemRel('cancelled', file)];
		case 'brief':
			return [
				workItemRel('briefs-tasked', file),
				workItemRel('briefs-dropped', file),
			];
		case 'observation':
			return [];
	}
}

/** The outcome of a cross-substrate reconciliation of one item's lock against
 * the authoritative `main` durable record (PRD `ledger-status-per-item-lock-refs`
 * US #9/#10; ADR `ledger-status-on-per-item-lock-refs`). */
export type ReconcileOutcome =
	| 'cleared-stale' // `main` is terminal + the lock was `active` (stranded) → cleared
	| 'kept-stuck' // `main` is terminal + the lock is `stuck` → kept (co-exists, wins human attention)
	| 'kept-in-flight' // `main` is NOT terminal + a lock is held → the normal in-flight state, kept
	| 'no-lock' // there is no lock to reconcile (already at rest)
	| 'error'; // environment/usage problem (best-effort; never throws)

export interface ReconcileResult {
	outcome: ReconcileOutcome;
	/** The type-encoded lock entry (`<type>-<slug>`) reconciled. */
	entry: string;
	ref: string;
	/** Whether `<arbiter>/main` shows the item terminal (per {@link terminalMainPaths}:
	 * a slice at `tasks/done`/`tasks/cancelled`, a brief at `briefs/tasked`/`briefs/dropped`). */
	terminalOnMain: boolean;
	message: string;
}

/**
 * Reconcile ONE item's per-item lock against the AUTHORITATIVE `main` durable
 * record — the heart of complete's cross-substrate crash-safety (PRD
 * `ledger-status-per-item-lock-refs` US #9/#10; ADR
 * `ledger-status-on-per-item-lock-refs`; the design trail's Amendment 6).
 *
 * complete's order is hold lock → land the DURABLE `main` move FIRST → release
 * the lock SECOND. A crash BETWEEN the move and the release leaves a
 * terminal-on-`main` item (a completed/cancelled task or a tasked/dropped brief,
 * per {@link terminalMainPaths}) with a STILL-HELD lock — a stale lock with no
 * in-flight work behind it. This is the recovery that converges it.
 *
 * THE RECOVERY RULE (the `main` record is authoritative over a stale lock):
 *   - `main` is TERMINAL + the held lock is `active`  → the item is RESTED, the
 *     lock is STALE (the crash was after the move) → CLEAR it (`cleared-stale`).
 *   - `main` is TERMINAL + the held lock is `stuck`   → KEEP it (`kept-stuck`).
 *     `done` + `stuck` may legitimately CO-EXIST (a rebase-conflict bounce of a
 *     just-completed item — US #10). The stuck lock wins the human's attention;
 *     the `main` record wins dependency resolution. NOT corruption, never cleared
 *     here (a human resolves it via `resume`/`requeue`/`release-lock`).
 *   - `main` is NOT terminal + a lock is held         → the NORMAL in-flight
 *     state (`kept-in-flight`); the lock is doing its job, leave it.
 *   - no lock at all                                   → `no-lock` (at rest).
 *
 * Best-effort + idempotent: it NEVER throws (a fetch/read fault degrades to
 * `error`, leaving the lock untouched — the safe direction), and re-running it
 * on an already-reconciled item is a clean `no-lock`. The clear is the SAME
 * leased delete {@link releaseItemLock} uses, so it cannot race off a concurrent
 * change.
 */
export async function reconcileItemLockAgainstMain(
	opts: ReleaseOptions,
): Promise<ReconcileResult> {
	const arbiter = opts.arbiter ?? 'origin';
	const env = opts.env;
	const cwd = opts.cwd;
	if (!opts.item) {
		return {
			outcome: 'error',
			entry: '',
			ref: '',
			terminalOnMain: false,
			message: 'missing item',
		};
	}
	const {type, slug} = resolveSidecarIdentity(opts.item);
	const entry = lockEntryFor(opts.item);
	const ref = itemLockRef(entry);
	try {
		// One fetch refreshes BOTH the lock refs and `<arbiter>/main` so the lock and
		// the durable record are read from the SAME live arbiter snapshot.
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
		await gitHard(['fetch', '--quiet', arbiter], cwd, env);

		const held = await fetchHeldEntry(entry, ref, cwd, arbiter, env);
		const terminalOnMain = await isTerminalOnMain(
			type,
			slug,
			arbiter,
			cwd,
			env,
		);
		if (!held) {
			return {
				outcome: 'no-lock',
				entry,
				ref,
				terminalOnMain,
				message: `'${entry}' has no lock to reconcile`,
			};
		}
		if (!terminalOnMain) {
			// A held lock + a non-terminal `main` is the NORMAL in-flight state.
			return {
				outcome: 'kept-in-flight',
				entry,
				ref,
				terminalOnMain,
				message: `'${entry}' is in flight (held, not terminal on ${arbiter}/main)`,
			};
		}
		if (held.lock.state === 'stuck') {
			// a terminal-on-main record + `stuck` co-exist legitimately (US #10) —
			// NOT corruption. Keep the stuck lock (it wins the human's attention).
			return {
				outcome: 'kept-stuck',
				entry,
				ref,
				terminalOnMain,
				message: `'${entry}' is terminal on ${arbiter}/main but STUCK — kept for human attention (resume/requeue/release-lock)`,
			};
		}
		// Terminal on `main` + an `active` lock = a STALE lock (the crash was after
		// the durable move, before the release). The `main` record is authoritative:
		// clear the stale lock with the SHARED leased delete (the SAME one
		// `release-lock` / requeue / the reaper use).
		const cleared = await leasedDeleteLockRef(ref, held.sha, cwd, arbiter, env);
		if (cleared === 'deleted') {
			return {
				outcome: 'cleared-stale',
				entry,
				ref,
				terminalOnMain,
				message: `cleared the stale lock for '${entry}' (terminal on ${arbiter}/main; the durable record is authoritative)`,
			};
		}
		// The leased delete was REJECTED. Distinguish two sub-cases at the recovery
		// boundary so callers (the reaper) can route them differently:
		//   (a) the remote ref is ALREADY GONE — a concurrent reaper / release-lock /
		//       requeue cleared the SAME stale lock first. The desired end state;
		//       benign — we report `no-lock` (the existing "already at rest" verdict).
		//   (b) the remote ref still exists but at a DIFFERENT sha than we leased
		//       against — a genuine concurrent mutation (e.g. a racer just marked it
		//       `stuck`). Back off rather than force; this is the real `error`.
		const remote = await gitSoft(['ls-remote', arbiter, ref], cwd, env);
		const remoteEmpty = remote.status === 0 && remote.stdout.trim() === '';
		if (remoteEmpty) {
			// Drop our stale local copy too — a non-pruning fetch left it pointing at
			// the now-gone sha; with it gone locally a subsequent read in this clone
			// sees the correct (deleted) state.
			await gitSoft(['update-ref', '-d', ref], cwd, env);
			return {
				outcome: 'no-lock',
				entry,
				ref,
				terminalOnMain,
				message: `'${entry}' has no lock to reconcile (already cleared by another reaper / release-lock / requeue)`,
			};
		}
		return {
			outcome: 'error',
			entry,
			ref,
			terminalOnMain,
			message: `stale-lock clear for '${entry}' rejected (changed concurrently to a different value); a racer may have moved the ref. Re-run after re-checking.`,
		};
	} catch (err) {
		return {
			outcome: 'error',
			entry,
			ref,
			terminalOnMain: false,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * The READ-ONLY classifier behind {@link reconcileItemLockAgainstMain}: it derives
 * the SAME {@link ReconcileOutcome} verdict, but NEVER mutates the arbiter — it
 * does NOT clear a stale-active lock, it only REPORTS that the lock IS
 * reconcilable. This is what the `gc --ledger` stuck-lock report keys off (the
 * forward-pointer's wiring): per the no-auto-sweep ADR rule, the plain report
 * surfaces a stale-active lock as `cleared-stale`-eligible WITHOUT clearing it —
 * a human still asserts the clear via `release-lock` (or runs complete's recovery,
 * which DOES clear via {@link reconcileItemLockAgainstMain}). The classification
 * is identical so the report and the recovery never disagree about WHAT a lock is;
 * only the ACTION differs (report vs clear).
 *
 * A `cleared-stale` outcome here therefore means "would be cleared by recovery /
 * `release-lock`" (the lock is terminal-on-`main` + `active` = stale), NOT that
 * anything was cleared. Best-effort + never throws (a fetch/read fault degrades to
 * `error`).
 */
export async function classifyItemLockAgainstMain(
	opts: ReleaseOptions,
): Promise<ReconcileResult> {
	const arbiter = opts.arbiter ?? 'origin';
	const env = opts.env;
	const cwd = opts.cwd;
	if (!opts.item) {
		return {
			outcome: 'error',
			entry: '',
			ref: '',
			terminalOnMain: false,
			message: 'missing item',
		};
	}
	const {type, slug} = resolveSidecarIdentity(opts.item);
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
		await gitHard(['fetch', '--quiet', arbiter], cwd, env);
		const held = await fetchHeldEntry(entry, ref, cwd, arbiter, env);
		const terminalOnMain = await isTerminalOnMain(
			type,
			slug,
			arbiter,
			cwd,
			env,
		);
		if (!held) {
			return {
				outcome: 'no-lock',
				entry,
				ref,
				terminalOnMain,
				message: `'${entry}' has no lock to reconcile`,
			};
		}
		if (!terminalOnMain) {
			return {
				outcome: 'kept-in-flight',
				entry,
				ref,
				terminalOnMain,
				message: `'${entry}' is in flight (held, not terminal on ${arbiter}/main)`,
			};
		}
		if (held.lock.state === 'stuck') {
			return {
				outcome: 'kept-stuck',
				entry,
				ref,
				terminalOnMain,
				message: `'${entry}' is terminal on ${arbiter}/main but STUCK — kept for human attention (resume/requeue/release-lock)`,
			};
		}
		// Terminal on `main` + an `active` lock = a STALE lock. Unlike
		// `reconcileItemLockAgainstMain` we do NOT clear it here — the report only
		// names it as reconcilable; the human asserts the clear (no auto-sweep).
		return {
			outcome: 'cleared-stale',
			entry,
			ref,
			terminalOnMain,
			message: `'${entry}' is terminal on ${arbiter}/main but the lock is ACTIVE — reconcilable (stale); clear via 'release-lock' (NOT auto-cleared by the report)`,
		};
	} catch (err) {
		return {
			outcome: 'error',
			entry,
			ref,
			terminalOnMain: false,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

/** One lingering lock in the `gc --ledger` stuck-lock REPORT: the held entry plus
 * the read-only cross-substrate {@link ReconcileOutcome} classification of it
 * against the authoritative `main` durable record (held/stuck vs stale-active over
 * a terminal item). Reported, NEVER cleared by the report itself. */
export interface LockReportEntry {
	/** The full held lock entry (action × state + holder/since/reason). */
	lock: LockEntry;
	/** The lock ref (`refs/agent-runner/lock/<entry>`). */
	ref: string;
	/**
	 * The READ-ONLY {@link classifyItemLockAgainstMain} verdict:
	 *   - `kept-in-flight` — a normal in-flight hold (not terminal on `main`).
	 *   - `kept-stuck`     — terminal on `main` + `stuck` (the `done`+`stuck`
	 *     co-existence; wins the human's attention, never cleared here).
	 *   - `cleared-stale`  — terminal on `main` + `active` = a STALE lock the report
	 *     names as reconcilable; a human clears it via `release-lock` (NOT
	 *     auto-cleared by the report — no auto-sweep).
	 *   - `error`          — a per-item classification fault (kept verbatim).
	 */
	reconcile: ReconcileOutcome;
}

/** The `gc --ledger` stuck/orphaned-lock REPORT (PRD
 * `ledger-status-per-item-lock-refs` US #14): every lingering per-item lock on the
 * arbiter, each classified read-only against `main`. An EMPTY list = no locks held
 * (an absent ref namespace reads as `[]`, the recoverable "all locks released"
 * state — US #12). The report NEVER clears anything. */
export interface ItemLockReport {
	locks: LockReportEntry[];
}

/**
 * Build the `gc --ledger` stuck/orphaned-lock REPORT (PRD
 * `ledger-status-per-item-lock-refs` US #12/#13/#14; ADR
 * `ledger-status-on-per-item-lock-refs`): enumerate every per-item lock currently
 * held on the arbiter ({@link listItemLockEntries} — held active + stuck, with
 * holder/since/reason) and classify EACH read-only against the authoritative
 * `main` durable record via {@link classifyItemLockAgainstMain} (the wiring the
 * `complete-lock-then-durable-main-move-crash-safe` slice's
 * `reconcileItemLockAgainstMain` had no production caller for). This is the
 * generalisation of the (now-retired) advancing-marker report from advancing-only
 * to the UNIFIED lock (the `gc --ledger` stuck-lock report).
 *
 * It is a REPORT, never a sweep: it CLEARS nothing (no liveness heartbeat, no
 * auto-sweep — the same trust model as the advancing report; a human asserts a
 * lock is dead via `release-lock`). A stale-active lock over a terminal-on-`main`
 * item is surfaced as `cleared-stale`-eligible ("reconcilable") but left in place.
 *
 * Best-effort + degrades safely: an absent lock-ref namespace ⇒ an EMPTY report
 * ({@link listItemLockEntries} returns `[]`) — so a deleted lock ref reads as "all
 * locks released" (recoverable; work is safe on the `work/<slug>` branches +
 * `main`).
 */
export async function reportItemLocks(
	cwd: string,
	arbiter = 'origin',
	env?: NodeJS.ProcessEnv,
): Promise<ItemLockReport> {
	const entries = await listItemLockEntries(cwd, arbiter, env);
	const locks: LockReportEntry[] = [];
	for (const lock of entries) {
		const ref = itemLockRef(lock.entry);
		// Read-only classification against `main` — NEVER clears (the report is
		// advisory; a human asserts the clear via `release-lock`).
		const verdict = await classifyItemLockAgainstMain({
			item: itemFromLockEntry(lock.entry),
			cwd,
			arbiter,
			env,
		});
		locks.push({lock, ref, reconcile: verdict.outcome});
	}
	return {locks};
}

/**
 * Format the `gc --ledger` stuck/orphaned-lock REPORT for the terminal: one block
 * per lingering lock (entry, action/state, holder, since, the stuck `reason`, the
 * read-only `main`-reconciliation note, and a copy-pasteable `release-lock`
 * hint). An EMPTY report yields NO lines (a clean lock set is silent here, like
 * the duplicate-slug surface). It REPORTS only — the matching wording makes the
 * no-auto-sweep contract explicit (a human asserts a lock is dead).
 */
/**
 * Does the `gc --ledger` lock report contain a lock that NEEDS HUMAN ATTENTION
 * (PRD US#14/#21; ADR `ledger-status-on-per-item-lock-refs`: this surface is the
 * STUCK / crash-orphaned lock, NOT every held one)? TRUE iff some lock is
 * `kept-stuck` (terminal-on-`main` + stuck) or `cleared-stale`-eligible
 * (terminal-on-`main` + a stale active orphan). A `kept-in-flight` (active,
 * non-terminal) lock is the NORMAL in-flight state of a healthy concurrent build
 * (read by `status` as healthy) and does NOT count — so a routine `gc --ledger`
 * health check whose only locks are healthy in-flight holds exits 0. This is the
 * fail-loud EXIT predicate for the gc lock surface (the report itself still lists
 * every held lock, in-flight ones informationally).
 */
export function itemLockReportNeedsAttention(report: ItemLockReport): boolean {
	return report.locks.some(
		(l) => l.reconcile === 'kept-stuck' || l.reconcile === 'cleared-stale',
	);
}

export function formatItemLockReport(report: ItemLockReport): string[] {
	if (report.locks.length === 0) {
		return [];
	}
	const lines = [
		`Per-item locks: ${report.locks.length} lock(s) held on the arbiter ` +
			'(REPORT only — no automatic sweep; the lock has no liveness heartbeat, so ' +
			'a human asserts a stuck/stale lock is dead via `release-lock`):',
	];
	for (const {lock, reconcile} of report.locks) {
		const item = itemFromLockEntry(lock.entry);
		lines.push(`  ${lock.entry}  [${lock.action}/${lock.state}]`);
		lines.push(
			`    holder: ${lock.holder || '(unknown)'}  since: ${lock.since || '(unknown)'}`,
		);
		if (lock.state === 'stuck' && lock.reason) {
			lines.push(`    reason: ${lock.reason}`);
		}
		lines.push(`    ${reconcileNote(reconcile)}`);
		lines.push(
			`    resolve (if the lock is dead): \`agent-runner release-lock ${item}\` (never --force).`,
		);
	}
	return lines;
}

/** The human-readable line for a lock's read-only `main`-reconciliation verdict. */
function reconcileNote(reconcile: ReconcileOutcome): string {
	switch (reconcile) {
		case 'kept-in-flight':
			return 'in flight (held, not terminal on main) — normal; left untouched.';
		case 'kept-stuck':
			return 'terminal on main + STUCK (done+stuck co-exist) — kept for human attention.';
		case 'cleared-stale':
			return 'terminal on main + ACTIVE = STALE (reconcilable) — NOT auto-cleared; a human clears it.';
		case 'no-lock':
			return 'no lock (already at rest).';
		case 'error':
			return 'reconciliation against main could not be determined (left untouched — the safe direction).';
	}
}

/** Per-lock outcome of the human-invoked {@link reapStaleItemLocks} SWEEP:
 *   - `reaped`         — a `cleared-stale` lock (terminal-on-main + active) cleared
 *                        via the SHARED leased delete.
 *   - `already-reaped` — BENIGN: the lock was already gone by the time the sweep
 *                        re-read the ref (`no-lock`) — another reaper / a
 *                        `release-lock` / a `requeue` got there first; the ref is
 *                        at the desired end state. NOT `lost` and does NOT count
 *                        as needs-attention (see the exit-code contract recorded
 *                        in this task's done record).
 *   - `kept-stuck`     — left untouched (terminal + stuck — human attention; US #10).
 *   - `kept-in-flight` — left untouched (active, non-terminal — a healthy build).
 *   - `lost`           — a `cleared-stale` candidate whose leased delete was REJECTED
 *                        (the ref changed concurrently to a DIFFERENT value);
 *                        REPORTED, never `--force`d.
 *   - `error`          — a per-item classification/clear fault (left untouched). */
export type ReapOutcome =
	| 'reaped'
	| 'already-reaped'
	| 'kept-stuck'
	| 'kept-in-flight'
	| 'lost'
	| 'error';

/** One lock's disposition in the {@link ReapReport}. */
export interface ReapEntry {
	/** The full lock entry as the report saw it (action × state + holder/since). */
	lock: LockEntry;
	/** The lock ref (`refs/agent-runner/lock/<entry>`). */
	ref: string;
	/** What the sweep DID with this lock. */
	outcome: ReapOutcome;
	/** A human-readable note (the clear message, or why it was kept). */
	message: string;
}

/** The result of {@link reapStaleItemLocks}: every held lock with what the sweep
 * did to it, plus convenience counts. A lock NEEDS HUMAN ATTENTION after the sweep
 * iff it is `kept-stuck` or `lost` (a `cleared-stale` whose leased delete lost the
 * race); a `kept-in-flight` is the normal healthy state and does NOT. */
export interface ReapReport {
	entries: ReapEntry[];
	reaped: number;
	/** BENIGN already-reaped count: the sweep found the ref already gone (`no-lock`)
	 * — another reaper / release-lock / requeue cleared it first. The desired end
	 * state; NOT `lost`, does NOT contribute to needs-attention / a non-zero exit. */
	alreadyReaped: number;
	kept: number;
	lost: number;
}

/**
 * The OPT-IN `gc --ledger --reap-stale-locks` SWEEP (PRD
 * `ledger-status-per-item-lock-refs` US #14): a human asserting "clear the dead
 * TERMINAL locks now", so one command sweeps every orphaned terminal lock instead
 * of N hand-run `release-lock`s. It is the WRITE twin of {@link reportItemLocks}
 * (the default report-only surface): it enumerates the SAME held locks, classifies
 * each read-only, and for EXACTLY the `cleared-stale` class (terminal-on-`main` +
 * `active` = stranded) performs the SHARED leased delete via
 * {@link reconcileItemLockAgainstMain} (the recovery's clear, re-checked fresh per
 * item) — there is NO parallel clear mechanism.
 *
 * SCOPE FENCE (the trust model the default preserves):
 *   - it clears ONLY `cleared-stale`. A `kept-stuck` (terminal + stuck — human
 *     attention) and a `kept-in-flight` (active + non-terminal — a healthy build)
 *     are NEVER reaped, even here. Because each clear goes through
 *     {@link reconcileItemLockAgainstMain}, which RE-reads + RE-classifies before
 *     deleting, a lock that turned stuck/in-flight between the report and the sweep
 *     is still safe (reconcile returns `kept-*`, not a delete).
 *   - the clear is a LEASED delete: a concurrent change to the ref makes it REJECT
 *     (`lost`), reported — never a blind `--force`.
 *
 * The DEFAULT `gc --ledger` (no flag) never calls this: it stays report-only,
 * fail-loud, delete-nothing. This is gated behind the explicit `--reap-stale-locks`
 * flag (a human authorising the clear), exactly as `release-lock`'s trust model.
 */
export async function reapStaleItemLocks(
	cwd: string,
	arbiter = 'origin',
	env?: NodeJS.ProcessEnv,
): Promise<ReapReport> {
	const report = await reportItemLocks(cwd, arbiter, env);
	const entries: ReapEntry[] = [];
	let reaped = 0;
	let alreadyReaped = 0;
	let kept = 0;
	let lost = 0;
	for (const {lock, ref, reconcile} of report.locks) {
		const item = itemFromLockEntry(lock.entry);
		if (reconcile === 'cleared-stale') {
			// Re-check + clear through the recovery's SHARED leased delete. Reconcile
			// re-reads the live ref, so a lock that turned stuck/in-flight since the
			// report is left alone; a concurrent change to the ref makes the lease lose.
			const rec = await reconcileItemLockAgainstMain({
				item,
				cwd,
				arbiter,
				env,
			});
			if (rec.outcome === 'cleared-stale') {
				reaped++;
				entries.push({lock, ref, outcome: 'reaped', message: rec.message});
			} else if (rec.outcome === 'no-lock') {
				// BENIGN: the ref is already gone — the desired end state. The LOSER of
				// a concurrent double-reap (another reaper deleted the ref between our
				// report and our re-read), or a `release-lock`/`requeue` that cleared
				// the same stale lock in the meantime. NOT a lost lease (the lease was
				// not REJECTED; there was simply nothing left to delete), so this does
				// NOT count as needs-attention. Kept SEPARATE from `reaped` so the
				// summary does not lie about who did the deleting.
				alreadyReaped++;
				entries.push({
					lock,
					ref,
					outcome: 'already-reaped',
					message: rec.message,
				});
			} else if (
				rec.outcome === 'kept-stuck' ||
				rec.outcome === 'kept-in-flight'
			) {
				// The lock changed between the report and the sweep — no longer stale.
				kept++;
				entries.push({lock, ref, outcome: rec.outcome, message: rec.message});
			} else {
				// A lost lease (the ref was REJECTED because it changed concurrently to
				// a DIFFERENT value) or a per-item error — REPORTED, never forced.
				// Counts as needing attention after the sweep.
				lost++;
				entries.push({lock, ref, outcome: 'lost', message: rec.message});
			}
			continue;
		}
		// NOT a cleared-stale candidate: a stuck or in-flight lock the reaper must
		// NEVER touch, even with the flag.
		if (reconcile === 'kept-stuck' || reconcile === 'kept-in-flight') {
			kept++;
			entries.push({
				lock,
				ref,
				outcome: reconcile,
				message: reconcileNote(reconcile),
			});
		} else {
			// no-lock / error from the classifier — nothing to reap; surface verbatim.
			lost++;
			entries.push({
				lock,
				ref,
				outcome: 'error',
				message: reconcileNote(reconcile),
			});
		}
	}
	return {entries, reaped, alreadyReaped, kept, lost};
}

/**
 * Does a {@link reapStaleItemLocks} sweep leave a lock that STILL needs human
 * attention? TRUE iff some entry is `kept-stuck` (a stuck lock the reaper rightly
 * left) or `lost`/`error` (a `cleared-stale` whose leased delete lost the race, or
 * an unresolvable fault). A `reaped` (successfully cleared) or a `kept-in-flight`
 * (healthy build) lock does NOT count — so a sweep that cleared every stale lock
 * and left only healthy in-flight holds exits 0. This is the post-sweep analogue of
 * {@link itemLockReportNeedsAttention}.
 */
export function reapReportNeedsAttention(report: ReapReport): boolean {
	// EXIT-CODE CONTRACT (recorded in this task's done record): the reaper exits 0
	// when all stale locks are reaped and only healthy in-flight locks remain;
	// exits 1 when a `kept-stuck` survives or a delete genuinely lost the race /
	// errored. An `already-reaped` (the loser of a concurrent double-reap saw the
	// ref already gone via `no-lock`) is BENIGN — the desired end state — and is
	// NOT in this set.
	return report.entries.some(
		(e) =>
			e.outcome === 'kept-stuck' ||
			e.outcome === 'lost' ||
			e.outcome === 'error',
	);
}

/**
 * Format the `gc --ledger --reap-stale-locks` sweep for the terminal: a header
 * line with the reaped/kept counts, then one line per lock (what was reaped vs
 * kept vs lost). An EMPTY sweep (no locks held) yields NO lines (silent, like the
 * report). The wording keeps the no-blind-force contract explicit.
 */
export function formatReapReport(report: ReapReport): string[] {
	if (report.entries.length === 0) {
		return [];
	}
	const lines = [
		`Per-item lock sweep (--reap-stale-locks): reaped ${report.reaped} stale ` +
			`terminal lock(s), kept ${report.kept} (stuck/in-flight, never reaped)` +
			(report.alreadyReaped > 0
				? `, ${report.alreadyReaped} already reaped by another sweep (no-lock — benign, the desired end state)`
				: '') +
			(report.lost > 0
				? `, ${report.lost} could not be cleared (lease lost / error — reported, NEVER forced)`
				: '') +
			':',
	];
	for (const {lock, outcome, message} of report.entries) {
		const tag =
			outcome === 'reaped'
				? '[reaped]  '
				: outcome === 'already-reaped'
					? '[already] '
					: outcome === 'lost'
						? '[lost]    '
						: outcome === 'error'
							? '[error]   '
							: '[kept]    ';
		lines.push(
			`  ${tag} ${lock.entry}  [${lock.action}/${lock.state}]  ${message}`,
		);
	}
	return lines;
}

/**
 * Convert a type-encoded lock `<entry>` (`<type>-<slug>`) back into the namespaced
 * item form (`<namespace>:<slug>`) that {@link lockEntryFor} /
 * {@link resolveSidecarIdentity} accept — so the report's suggested `release-lock`
 * command is copy-pasteable and the classifier can re-key off the SAME identity.
 * Unknown prefixes fall back to the raw entry (still copyable). The inverse of
 * {@link lockEntryFor} for the three known namespaces.
 */
export function itemFromLockEntry(entry: string): string {
	for (const prefix of ['task', 'brief', 'observation'] as const) {
		const tag = `${prefix}-`;
		if (entry.startsWith(tag)) {
			return `${prefix}:${entry.slice(tag.length)}`;
		}
	}
	return entry;
}

/** True iff `<arbiter>/main` shows the item TERMINAL — any of
 * {@link terminalMainPaths} present in `<arbiter>/main`'s tree. */
async function isTerminalOnMain(
	type: SidecarType,
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	for (const path of terminalMainPaths(type, slug)) {
		const exists =
			(await gitSoft(['cat-file', '-e', `${arbiter}/main:${path}`], cwd, env))
				.status === 0;
		if (exists) {
			return true;
		}
	}
	return false;
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

/**
 * Read the FULL lock entries currently held on the arbiter — the `status`/`scan`
 * in-flight read path (PRD `ledger-status-per-item-lock-refs` US #8; slice
 * `needs-attention-as-stuck-lock-state`). One fetch of the lock refs, then read
 * each held entry's `lock.md` blob, returning the parsed {@link LockEntry} for
 * every ref (so a caller can surface `active` (in-progress) and `stuck`
 * (needs-attention) holds + their reasons WITHOUT N fetches). Sorted by `entry`.
 * Best-effort: a fetch/read fault yields an EMPTY list, so the read-only
 * `status`/`scan` views degrade to "no in-flight locks" rather than erroring
 * (parity with {@link heldSliceSlugs}).
 */
export async function listItemLockEntries(
	cwd: string,
	arbiter = 'origin',
	env?: NodeJS.ProcessEnv,
): Promise<LockEntry[]> {
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
		const out = await gitSoft(
			['for-each-ref', '--format=%(refname)', `${LOCK_REF_PREFIX}/*`],
			cwd,
			env,
		);
		if (out.status !== 0) {
			return [];
		}
		const refs = out.stdout
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l.startsWith(`${LOCK_REF_PREFIX}/`))
			.sort();
		const entries: LockEntry[] = [];
		for (const ref of refs) {
			const show = await gitSoft(['show', `${ref}:lock.md`], cwd, env);
			if (show.status !== 0) {
				continue;
			}
			const lock = parseLockEntry(show.stdout);
			if (lock) {
				entries.push(lock);
			}
		}
		return entries;
	} catch {
		return [];
	}
}

/**
 * List the TASK slugs currently lock-held on the arbiter — the held-slug set the
 * `todo/` pool readers SUBTRACT (PRD `ledger-status-per-item-lock-refs` US #15;
 * slice `claim-acquires-unified-lock-no-body-move`). Enumerates {@link listItemLocks}
 * and keeps only the `task-<slug>` entries (a brief/observation lock does not gate
 * the TASK pool), mapping each to its bare `<slug>`. Best-effort: a fetch
 * fault yields an EMPTY set, so the offline pool read degrades to "subtract
 * nothing" rather than erroring — while the body still moves to `in-progress/` the
 * subtraction is redundant anyway (the moved body already leaves the pool); it is
 * wired now so the capstone that stops the body move (slice #9) has the predicate
 * "in `backlog/` on `main` AND no lock held" already in force without re-touching
 * the readers.
 */
export async function heldSliceSlugs(
	cwd: string,
	arbiter = 'origin',
	env?: NodeJS.ProcessEnv,
): Promise<Set<string>> {
	try {
		const entries = await listItemLocks(cwd, arbiter, env);
		const prefix = 'task-';
		return new Set(
			entries
				.filter((e) => e.startsWith(prefix))
				.map((e) => e.slice(prefix.length)),
		);
	} catch {
		return new Set();
	}
}

/**
 * Parse a serialised lock entry body back into a {@link LockEntry} — the exact
 * inverse of {@link serialiseLockEntry}. Reads the two-axis state from the
 * frontmatter and, for a stuck entry, the FULL reason prose + any questions from
 * the body (`## Reason` / `## Questions`). Tolerates a LEGACY entry whose reason
 * lived in a one-line frontmatter `reason:` field (the pre-cutover shape) so a
 * lock written by an older binary still reads.
 */
export function parseLockEntry(body: string): LockEntry | undefined {
	const normalized = body.replace(/\r\n/g, '\n');
	const fm = /^---\n([\s\S]*?)\n---/.exec(normalized);
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
	const bodyText = normalized.slice(fm[0].length);
	const reason = extractBodyReason(bodyText) ?? fields.reason;
	const questions = extractBodyQuestions(bodyText);
	const entry: LockEntry = {
		entry: fields.entry,
		action: fields.action as LockAction,
		state: fields.state as LockState,
		holder: fields.holder ?? '',
		since: fields.since ?? '',
	};
	if (reason !== undefined && reason !== '') {
		entry.reason = reason;
	}
	if (questions.length > 0) {
		entry.questions = questions;
	}
	return entry;
}

/** Extract the `## Reason` block's prose (joined multi-line), or undefined. */
function extractBodyReason(bodyText: string): string | undefined {
	const lines = bodyText.split('\n');
	const start = lines.findIndex((l) => l.trim() === LOCK_REASON_HEADING);
	if (start === -1) {
		return undefined;
	}
	const collected: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (/^##\s/.test(lines[i])) {
			break;
		}
		collected.push(lines[i]);
	}
	// Trim leading/trailing blank lines but PRESERVE interior newlines (rich prose).
	const text = collected.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
	return text === '' ? undefined : text;
}

/** Extract the `## Questions` block's bulleted list, or [] when absent. */
function extractBodyQuestions(bodyText: string): string[] {
	const lines = bodyText.split('\n');
	const start = lines.findIndex((l) => l.trim() === LOCK_QUESTIONS_HEADING);
	if (start === -1) {
		return [];
	}
	const questions: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (/^##\s/.test(lines[i])) {
			break;
		}
		const m = /^-\s+(.*)$/.exec(lines[i].trim());
		if (m) {
			questions.push(m[1]);
		}
	}
	return questions;
}

/**
 * Advisory holder id: git user.name, else $USER, else a uuid fragment. Exported
 * as {@link resolveLockHolder} so callers (e.g. claim's stale-lock self-heal) can
 * resolve THE SAME holder string the lock would stamp, to compare against a held
 * entry's `holder` without duplicating the resolution order.
 */
export async function resolveLockHolder(
	cwd: string,
	env?: NodeJS.ProcessEnv,
): Promise<string> {
	return resolveHolder(cwd, env);
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
