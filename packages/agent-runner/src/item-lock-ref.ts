import {randomUUID} from 'node:crypto';
import {runAsync, type RunResult} from './git.js';

/**
 * **TRACER (PRD `ledger-status-per-item-lock-refs`, ADR
 * `ledger-status-on-per-item-lock-refs`).** A minimal, self-contained proof that
 * the DANGEROUS core of the new lock model works end-to-end on a bare `file://`
 * arbiter: ONE lock per item, on a PER-ITEM hidden ref, acquired by an ATOMIC
 * create-only push and released by DELETING the ref, with a two-axis
 * (`action` × `state`) entry. It is NOT yet wired into claim/slice/advance, and
 * deliberately does NOT touch `main` — it exists to validate the substrate before
 * the full substrate-swap is sliced. The production version GENERALISES the
 * landed advancing-lock (see `advancing-lock.ts`) onto this substrate.
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
	entry: string;
	ref: string;
	message: string;
}
export interface ReleaseResult {
	outcome: ReleaseOutcome;
	entry: string;
	ref: string;
	message: string;
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
	item: string; // the type-encoded entry `<type>-<slug>` (tracer: pass it directly)
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
	const entry = opts.item;
	const ref = itemLockRef(entry);
	if (!entry) {
		return {outcome: 'error', entry, ref, message: 'missing item'};
	}
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
	const entry = opts.item;
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
 * Read the current lock entry for an item from the arbiter (the `status`/`scan`
 * read path, in tracer form): fetch the lock refs, read `lock.md` from the ref's
 * tree. Returns `undefined` when the item is not locked.
 */
export async function readItemLock(
	opts: ReleaseOptions,
): Promise<LockEntry | undefined> {
	const arbiter = opts.arbiter ?? 'origin';
	const env = opts.env;
	const cwd = opts.cwd;
	const ref = itemLockRef(opts.item);
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

/** List the entries currently locked on the arbiter (the stuck-lock report read
 * path, in tracer form). */
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
