import {rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	type WorkFolderKey,
	workFolderPrefix,
	workFolderRel,
	workItemRel,
	isWorkItemFile,
} from './work-layout.js';
import {run, runAsync, type RunResult} from './git.js';
import {branchAheadOf} from './continue-branch.js';
import {
	acquireItemLock,
	releaseItemLock,
	readItemLock,
	itemLockRef,
	lockEntryFor,
	parseLockEntry,
	type LockEntry,
} from './item-lock.js';
import {ledgerWrite, type LedgerTransitionKind} from './ledger-write.js';
import {workBranchRef} from './slug-namespace.js';
import {
	retryWithBackoff,
	realSleep,
	type BackoffOptions,
	type Sleep,
} from './retry-backoff.js';

/**
 * The **needs-attention mechanism** (ADR `ledger-status-on-per-item-lock-refs`;
 * spec `ledger-status-per-item-lock-refs`; ADR §12 for the original folder model).
 * Every "couldn't finish, a human must look" outcome (a failed acceptance gate
 * (red `verify`), a rebase/merge conflict (ADR §10), a task the agent reported
 * too ambiguous to build, a timeout, or a rejected review) resolves to ONE
 * observable move: the RUNNER AMENDS the claimed item's HELD per-item lock
 * `active → stuck` (`refs/dorfl/lock/<entry>`), writing the reason (+ any
 * agent-surfaced questions) into the lock-entry BODY. There is NO `git mv` to a
 * `work/needs-attention/` folder and NO on-`main` surface (the lock cut-over,
 * task `cutover-needs-attention-becomes-lock-stuck-recovery-surface`): so a
 * protected-`main` bounce succeeds, and a work branch cut from `main` inherits no
 * stuck record. The RECOVERABLE half is the kept `work/<slug>` branch.
 *
 * This is the conflict-safe form of "surfacing": the surface is the lock
 * `state: stuck`, read by `scan`/`status`/`gc --ledger` reading the lock refs (a
 * COMMAND a human runs, not an `ls` of a folder). There is **no status/label
 * field** on `main` (honours WORK-CONTRACT rule 3). The reason is prose in the
 * lock-entry body, never a source-of-truth frontmatter field.
 *
 * Ownership: this module OWNS the mechanism (the move helper + the surface
 * reader + the return path). Consumers (`complete.ts`'s gate-failed/rebase-
 * conflict abort paths, the runner's stuck routing in `run.ts`, the human
 * `return` command) drive these through the ledger write seam's NEEDS-ATTENTION
 * transition (`ledgerWrite.applyNeedsAttentionTransition` /
 * `applyReturnToBacklogTransition` in `ledger-write.ts`), whose sole strategy
 * delegates to `routeToNeedsAttention` / `returnToBacklog` here UNCHANGED — so
 * the later cherry-pick-to-`main` surfacing is built AGAINST the seam, not
 * bolted onto this move code. The build agent NEVER does this — agents do no git
 * (ADR §12).
 */

/** Marker that opens the appended reason block in a needs-attention item body. */
const REASON_HEADING = '## Needs attention';

export interface RouteToNeedsAttentionOptions {
	/** The working clone / job worktree the `work/<slug>` branch lives in. */
	cwd: string;
	/** The slug of the in-progress item to bounce. */
	slug: string;
	/** Why the item is stuck (red gate, rebase conflict, ambiguity, timeout, …). */
	reason: string;
	/** Any questions the agent surfaced for the human, recorded under the reason. */
	questions?: string[];
	/**
	 * The arbiter remote to push the transition to (like the done-move). When
	 * omitted, the move is committed locally only (the caller pushes the branch as
	 * part of its own flow, e.g. the runner's integration step).
	 */
	arbiter?: string;
	/**
	 * The work branch to push to the arbiter (the RECOVERABLE half — see the seam
	 * docstring). DEFAULT `work/<slug>`: the build-bounce branch the wip/move
	 * commits landed on. A tasking bounce passes its own branch (`work/specs/
	 * ready-<slug>`). The supplied branch MUST be the one HEAD is on (the branch the
	 * wip/move commits landed on) — NEVER a default that differs from HEAD; a
	 * caller NOT checked out on the work branch (e.g. a temp branch off main) must
	 * be SURFACE-ONLY ({@link pushBranch} `false`) so no wrong-branch ref is
	 * pushed. Only consulted when {@link arbiter} is given and {@link pushBranch}
	 * is not `false`.
	 */
	branch?: string;
	/**
	 * SURFACE-ONLY when `false`: publish the ledger surface (when an `arbiter` is
	 * given) but push NO work branch. For a caller that is NOT checked out on the
	 * work branch (a throwaway temp branch off main — e.g. `start.ts`'s
	 * `routeContinueConflict`, whose real `work/<slug>` is already on the arbiter
	 * from the prior requeue). Defaults to pushing (the build-bounce common case).
	 */
	pushBranch?: boolean;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
	/**
	 * Bounded-backoff bounds for the RECOVERABLE branch push (the OUTAGE-retry,
	 * NOT the instant-contention loop). Defaults to {@link DEFAULT_BACKOFF}.
	 */
	backoff?: BackoffOptions;
	/**
	 * Injectable sleep for the backoff (tests drive the retry timeline with NO
	 * real waits — the `run.ts` `sleep`/`realSleep` seam). Defaults to a real
	 * `setTimeout`. Threaded into {@link backoff} when the latter omits its own.
	 */
	sleep?: Sleep;
}

/** The outcome of the RECOVERABLE branch push (the per-op honest report). */
export type BranchPushOutcome =
	/** Pushed to the arbiter (cross-machine recoverable). */
	| 'pushed'
	/** Skipped by the emptiness guard — nothing beyond main to recover YET. */
	| 'skipped-empty'
	/** Retried with backoff, then gave up — saved LOCALLY only. */
	| 'failed'
	/** No arbiter / surface-only — no push was attempted. */
	| 'not-attempted';

export interface RouteToNeedsAttentionResult {
	/** True iff the item was moved + committed. */
	moved: boolean;
	/** When `moved`, the committed transition message (of the MOVE-ONLY commit). */
	commitMessage?: string;
	/**
	 * The per-op outcome of the RECOVERABLE branch push (honest reporting — the
	 * message reads THIS, never assumes "pushed" off the local move). Absent when
	 * the item did not move.
	 */
	branchPush?: BranchPushOutcome;
	/** When the branch push FAILED after retries, the last git error (for the report). */
	pushError?: string;
	/**
	 * When `moved`, the sha of the `work/<slug>` tip after the RECOVERABLE-half
	 * save. Post lock-cutover this is the **wip** commit holding the aborted agent
	 * work (`git add -A`); there is no separate `git mv → needs-attention/`
	 * move-only commit anymore (that folder is retired). The OBSERVABLE stuck
	 * state rides on the per-item lock amend (`state: stuck` + reason), not on this
	 * commit.
	 */
	moveCommit?: string;
	/** When NOT moved, why (e.g. the slug was not in-progress). */
	reasonNotMoved?: string;
}

export interface ReturnToBacklogOptions {
	/** The working clone the `work/` tree lives in. */
	cwd: string;
	/**
	 * The slug of the stuck item to re-queue — recovered via its per-item lock on
	 * the arbiter (post lock-cutover the body never moves into a status folder; it
	 * rests in `backlog/` and stuck is the lock `state: stuck`).
	 */
	slug: string;
	/** The arbiter remote to push the transition to. Optional (see above). */
	arbiter?: string;
	/**
	 * `requeue --reset` (the destructive opt-out): DISCARD the kept work, so the
	 * NEXT claim starts FRESH. At requeue-time — BEFORE the backlog move — delete
	 * the remote `work/<slug>` branch on `arbiter`
	 * (`git push <arbiter> --delete work/<slug>`, plain provider-agnostic git that
	 * works against a local `--bare` arbiter) and drop any stale LOCAL `work/<slug>`.
	 * Delete-before-move closes the claim-race window (no backlog item exists while
	 * the to-be-discarded branch still does). A FAILED delete ABORTS the requeue
	 * (no backlog move) — the item stays in needs-attention rather than become
	 * claimable while continuing from a branch you meant to throw away. Requires
	 * `arbiter`. Explicit/guarded — a deliberate departure from the loud "never
	 * delete the remote branch" invariant; never on the default (keep+continue)
	 * path.
	 */
	reset?: boolean;
	/**
	 * `requeue -m "<note>"` (the handoff note): an optional human steer for the
	 * NEXT agent. APPENDED (never overwritten) as a dated `## Requeue YYYY-MM-DD`
	 * section to the item BODY before the move — the ledger file is the durable,
	 * conflict-safe, cross-machine home (same place the needs-attention reason
	 * lives). Repeated requeues ACCUMULATE a handoff log. Applies to BOTH modes
	 * (a steer is relevant even on `--reset`).
	 */
	message?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ReturnToBacklogResult {
	/** True iff the item was moved back + committed. */
	moved: boolean;
	/** When `moved`, the committed transition message. */
	commitMessage?: string;
	/** True iff `--reset` deleted the remote `work/<slug>` branch on the arbiter. */
	deletedRemoteBranch?: boolean;
	/** When NOT moved, why (e.g. the slug held no recoverable per-item lock on the arbiter, or a failed --reset delete). */
	reasonNotMoved?: string;
}

export interface SurfaceToNeedsAttentionOptions {
	/**
	 * The working clone the move is ORIGINATED from — purely the ORIGIN SOURCE
	 * (it resolves the arbiter remote + holds the object store the plumbing writes
	 * into), NEVER a write TARGET. Tree-less: the cwd index/HEAD/working tree are
	 * never touched (parity with {@link returnToBacklog}).
	 */
	cwd: string;
	/** The slug of the in-progress item to surface to needs-attention. */
	slug: string;
	/** Why the item is stuck (terminal continue-push failure, rebase conflict, …). */
	reason: string;
	/** Any questions the agent surfaced for the human, recorded under the reason. */
	questions?: string[];
	/**
	 * The arbiter remote the surface move is CAS-published to. REQUIRED — like
	 * {@link returnToBacklog}, the move is a tree-less compare-and-swap to the
	 * arbiter ref, so there is no local-only mode.
	 */
	arbiter: string;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface SurfaceToNeedsAttentionResult {
	/** True iff the item was surfaced (moved + CAS-published) on the arbiter. */
	moved: boolean;
	/** When `moved`, the committed transition message. */
	commitMessage?: string;
	/** When NOT moved, why (no arbiter, item not on the arbiter, contention exhausted). */
	reasonNotMoved?: string;
}

/**
 * Save the RECOVERABLE half of a stuck-item bounce (ADR §12). The RUNNER calls
 * this; the build agent never does.
 *
 * **Post `ledger-status-per-item-lock-refs` cut-over (tasks 9a–9d, decision i+):**
 * a bounce is now a PURE LOCK AMEND — the seam (`bounceToStuckLock` →
 * `markStuckItemLock`) marks the per-item lock `state: stuck` and records the
 * reason/questions ON THE LOCK ENTRY. There is NO `git mv` to a
 * `needs-attention/` folder and NO on-`main` surface commit. The item body never
 * moves (it rests in `backlog/` since claim stopped moving it, task 9a). So what
 * REMAINS here is purely the never-lose-work half:
 *
 *   1. A **wip** commit on the `work/<slug>` branch tip holding whatever the agent
 *      left uncommitted (`git add -A`). Skipped when the tree is already clean
 *      (no aborted work to save). No bookkeeping trailer — after the cut-over NO
 *      transient-status move-only commit lands on a branch, so a branch rebases
 *      PLAINLY with nothing to drop (`drop-bookkeeping-rebase` is deleted, 9d).
 *   2. Optionally PUSH the work branch to the arbiter so the saved wip travels
 *      cross-machine and a `requeue` continues from the branch tip. BEST-EFFORT
 *      (an unreachable arbiter leaves the local branch standing — recovery
 *      degrades, never crashes the bounce; retried with bounded backoff on an
 *      outage), BRANCH-PARAMETERISED (default `work/<slug>`; an explicit `branch`
 *      overrides — the tasking bounce passes `work/specs/ready-<slug>`; `pushBranch: false`
 *      ⇒ push NOTHING), and EMPTINESS-GUARDED (a branch with no commits beyond
 *      main, or an absent branch, is skipped). The branch MUST be the one HEAD is
 *      on. The work-branch push is NOT a `main` write.
 *
 * The stuck STATE itself (the `state: stuck` + reason/questions) is owned by the
 * lock amend in the seam, not by this function. NEVER throws for the expected
 * case — returns `{moved, ...}` so consumers can branch cleanly; genuine git
 * plumbing failures still throw (they are unexpected).
 */
export async function routeToNeedsAttention(
	options: RouteToNeedsAttentionOptions,
): Promise<RouteToNeedsAttentionResult> {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	// TASK `cutover-needs-attention-becomes-lock-stuck-recovery-surface`
	// (decision i+): the bounce is now a PURE lock amend (done by the seam) — there
	// is NO `git mv` to `needs-attention/` and NO on-`main` surface. What REMAINS
	// here is the RECOVERABLE half: SAVE the agent's uncommitted work as a wip
	// commit on the `work/<slug>` branch tip and PUSH the branch to the arbiter, so
	// the partial work travels cross-machine and a `requeue` continues from the
	// branch tip. The reason/questions ride on the lock entry (the seam amends it),
	// NOT a moved `.md`. The work branch push is NOT a `main` write.

	// 1. WIP commit: save whatever the agent left uncommitted to the work branch
	//    tip. Skip when the tree is clean (no aborted work to save). NOTE this no
	//    longer needs a folder source — the body rests in `backlog/` (task 9a) and
	//    never moves on a bounce.
	gitHard(['add', '-A'], cwd, env);
	const hadWip = !nothingStaged(cwd, env);
	if (hadWip) {
		// Save the agent's uncommitted work as a plain wip commit on the work-branch
		// tip (the RECOVERABLE half — a `requeue` continues from it). No bookkeeping
		// trailer: after the per-item-lock cut-over (tasks 9a–9d) NO transient status
		// (no `needs-attention/` move-only commit) lands on a branch, so a branch cut
		// from `main` rebases PLAINLY with nothing to drop — the `drop-bookkeeping-rebase`
		// machinery and its `Dorfl-Bookkeeping` trailer are gone (9d).
		const wipBody = `chore(${slug}): save aborted work (wip)`;
		gitHard(['commit', '-q', '-m', wipBody], cwd, env);
	}
	const commitMessage = `chore(${slug}): bounce to stuck; ${options.reason}`;
	const moveCommit = hadWip ? revParseHead(cwd, env) : undefined;
	note(`Bounced '${slug}' to stuck (lock): ${options.reason}`);

	// 2. Push the work branch to the arbiter — the RECOVERABLE half of the bounce
	//    (so the saved wip travels cross-machine and a requeue continues from the
	//    branch tip). Three behaviours: SURFACE-ONLY (no push) when
	//    `pushBranch === false`; an explicit `branch` target; else the default
	//    `work/<slug>`. BEST-EFFORT (no throw on a failed/unreachable push), RETRIED
	//    with bounded backoff on an OUTAGE, and EMPTINESS-GUARDED (a branch with no
	//    work beyond main / an absent branch is skipped). The OUTCOME is CAPTURED +
	//    RETURNED (`branchPush`) so the caller reports what ACTUALLY landed.
	let branchPush: BranchPushOutcome = 'not-attempted';
	let pushError: string | undefined;
	if (options.arbiter && options.pushBranch !== false) {
		// DEFAULT to the task-namespaced build-bounce branch; a non-task caller
		// (the tasking bounce) passes its own `work/specs/ready-<slug>` via `branch`.
		const branch = options.branch ?? workBranchRef('task', slug);
		if (branchAheadOf(cwd, branch, 'main', env)) {
			const arbiter = options.arbiter;
			const result = await retryWithBackoff(
				async () => {
					const r = gitSoftRun(
						['push', arbiter, `${branch}:${branch}`],
						cwd,
						env,
					);
					return r.status === 0
						? {ok: true as const, value: undefined}
						: {ok: false as const, error: r.stderr.trim()};
				},
				{sleep: options.sleep ?? realSleep, ...options.backoff},
			);
			if (result.ok) {
				branchPush = 'pushed';
			} else {
				branchPush = 'failed';
				pushError = result.lastError;
				note(
					`Could not push ${branch} to ${arbiter} after ${result.attempts} ` +
						`attempt(s) (${pushError ?? 'unknown error'}) — the work is saved ` +
						'LOCALLY only; push the branch when online, then `requeue`.',
				);
			}
		} else {
			branchPush = 'skipped-empty';
			note(
				`Skipped pushing ${branch} (no work beyond main / branch absent) — ` +
					'nothing to recover.',
			);
		}
	}

	return {moved: true, commitMessage, moveCommit, branchPush, pushError};
}

/**
 * The clean re-queue (ADR §12 / WORK-CONTRACT return path): once the human has
 * resolved the cause, move the stuck item back to `work/backlog/<slug>.md` and
 * commit it so the item can be re-claimed (it must not rot stuck). It recovers a
 * task stuck in EITHER `work/needs-attention/<slug>.md` (the resolved-surface
 * path) OR `work/in-progress/<slug>.md` (a claim that never surfaced — an
 * un-surfaced abort, a killed run, or an in-place requeue note; defect 2, story
 * 4): the slug's ACTUAL current folder is resolved on the arbiter and moved to
 * `backlog/` via the SAME tree-less CAS. Any recorded reason/handoff block stays
 * in the body as a durable note of what happened; the resolution itself is the
 * human's.
 *
 * The `requeue` verb's THREE behaviours (ADR §14 / task
 * `requeue-continue-and-reset`) are realised here:
 *   - **default = KEEP + CONTINUE.** The `work/<slug>` branch is left UNTOUCHED;
 *     it is the durable artifact the next claim CONTINUES from (the continue-
 *     detection in `continue-branch.ts` feeds both onboarding paths). This
 *     function only does the ledger move.
 *   - **`--reset` = DISCARD + FRESH.** When `reset` is set, DELETE the remote
 *     `work/<slug>` branch on `arbiter` FIRST (+ drop any stale local branch),
 *     THEN the backlog move. Delete-before-move closes the claim-race window; a
 *     FAILED delete ABORTS (no backlog move) so the item stays in
 *     needs-attention. The next claim then finds NO arbiter branch and cuts
 *     fresh — no special claim-time logic.
 *   - **`-m "<note>"` = HANDOFF NOTE.** When `message` is set, APPEND a dated
 *     `## Requeue YYYY-MM-DD` section to the item BODY (append-only; accumulates
 *     over repeated requeues) for the next agent. Applies to BOTH modes.
 *
 * Like the move, NEVER throws for the expected "not in needs-attention" case.
 */
/**
 * Read the item's lock entry from the LOCAL lock ref (no fetch) — the resilient
 * fall-back for {@link returnToBacklog} when an arbiter fetch fails (e.g. a
 * `--reset` against a moved-away arbiter). The up-front soft fetch already
 * refreshed the local refs, so reading them locally is the best-effort truth
 * without throwing.
 */
async function readLocalItemLock(
	slug: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LockEntry | undefined> {
	const ref = itemLockRef(lockEntryFor(`task:${slug}`));
	const show = await gitSoftAsync(['show', `${ref}:lock.md`], cwd, env);
	if (show.status !== 0) {
		return undefined;
	}
	return parseLockEntry(show.stdout);
}

export async function returnToBacklog(
	options: ReturnToBacklogOptions,
): Promise<ReturnToBacklogResult> {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	// Tree-less CAS, EXACTLY like `claim` (`performClaim`): the move is published
	// to the arbiter ref via the shared `ledger-write` write seam — it NEVER stages
	// or commits in the cwd working tree (so a `requeue` in a shared checkout can no
	// longer sweep up a concurrent writer's uncommitted files — the `8c92f63`
	// incident, see
	// `work/notes/observations/drive-backlog-skill-assumes-in-place-do-not-remote.md`).
	// `--cwd` is purely the ORIGIN SOURCE (it resolves the arbiter remote + holds
	// the object store the plumbing writes into), never a write TARGET. A tree-less
	// CAS needs a ref to push to, so an `arbiter` is REQUIRED (parity with `claim`).
	if (!options.arbiter) {
		return {
			moved: false,
			reasonNotMoved:
				`requeue for '${slug}' needs an --arbiter: the move is published as a ` +
				'tree-less compare-and-swap to the arbiter ref (like claim), so there ' +
				'is no local-only mode — pass --arbiter.',
		};
	}
	const arbiter = options.arbiter;

	if (
		(await gitSoftAsync(['remote', 'get-url', arbiter], cwd, env)).status !== 0
	) {
		return {
			moved: false,
			reasonNotMoved: `no git remote named '${arbiter}' (set one, or pass --arbiter).`,
		};
	}

	// Refresh the remote-tracking refs so every check below (the item's residence,
	// the continue-branch guard, the CAS base) sees the arbiter's TRUTH, not a stale
	// local copy. This is a fetch, not a checkout — the working tree is untouched.
	await gitSoftAsync(['fetch', '--quiet', arbiter], cwd, env);

	// Is the item LOCK-HELD on the arbiter? (task
	// `cutover-needs-attention-becomes-lock-stuck-recovery-surface`, decision i+:
	// stuck-state is the per-item lock `state: stuck`, NOT a `needs-attention/`
	// folder file). `requeue` recovers a STUCK hold (the resolved-recovery path) and
	// tolerates an ACTIVE hold (a killed run that never surfaced) — both legitimate
	// in-flight states the human's recovery verb returns to the pool. We read the
	// LOCK ref (arbiter-is-truth), NOT a folder. No held lock ⇒ nothing to requeue
	// (the item is already at rest — unclaimed in `backlog/`, or terminal).
	// Read the held lock TOLERANTLY: a broken/unreachable arbiter (e.g. a
	// `--reset` against a moved-away arbiter) must NOT throw out of requeue — the
	// up-front soft fetch above already refreshed the local lock refs, so on a
	// fetch fault we fall back to the local lock ref (best-effort) rather than
	// crashing. A genuinely absent lock still refuses below.
	let held: Awaited<ReturnType<typeof readItemLock>>;
	try {
		held = await readItemLock({item: `task:${slug}`, cwd, arbiter, env});
	} catch {
		held = await readLocalItemLock(slug, cwd, env);
	}
	if (!held) {
		return {
			moved: false,
			reasonNotMoved:
				`'${slug}' has no held per-item lock on ${arbiter} — nothing to requeue ` +
				'(wrong slug, or already at rest in backlog/done?). requeue recovers a ' +
				'task whose lock is held stuck (needs-attention) or active (a killed ' +
				'in-progress run).',
		};
	}

	// `--reset`: DELETE the remote work branch (before the backlog move). The
	// deletion is WRITE-THROUGH: the LOCAL refs that drive continue-detection
	// (`refs/remotes/<arbiter>/work/<slug>` AND any local head `work/<slug>`) are
	// deleted FIRST, THEN the arbiter `git push --delete`. The asymmetry is the
	// point: the arbiter is the source of truth and the local ref is derived, so
	// inverting today's arbiter-first ordering converts a dangerous failure mode
	// (local AHEAD of arbiter — a permanent stale-continue) into a self-healing
	// one (local BEHIND — the next fetch restores it from the arbiter). A FAILED
	// arbiter delete still ABORTS the requeue (no backlog move); the local
	// behind-state is recoverable by a subsequent fetch and CANNOT drive a wrong
	// continue. Delete-before-move also closes the claim-race window.
	let deletedRemoteBranch = false;
	if (options.reset) {
		const branch = workBranchRef('task', slug);
		// LOCAL-FIRST: the tracking ref `branchAheadOf` reads (the one whose
		// staleness today silently turns `--reset` into a no-op — verified live in
		// `work/notes/observations/requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md`,
		// where `--reset` deleted the arbiter branch but the local tracking ref
		// survived and resurrected a "continue" on the next `do`). Both deletes
		// are best-effort — their absence is fine, what matters is they are not
		// LEFT BEHIND when the arbiter delete succeeds.
		await gitSoftAsync(
			['update-ref', '-d', `refs/remotes/${arbiter}/${branch}`],
			cwd,
			env,
		);
		await gitSoftAsync(['branch', '-D', branch], cwd, env);
		// THEN the arbiter delete (explicit/guarded departure from the "never delete
		// the remote branch" invariant; only on the `--reset` path, never the
		// default).
		const del = await gitSoftAsync(
			['push', arbiter, '--delete', branch],
			cwd,
			env,
		);
		if (del.status !== 0) {
			const stderr = del.stderr.trim();
			// Tolerate "remote ref does not exist" (already gone): treat as deleted.
			const alreadyGone = /remote ref does not exist|unable to delete/i.test(
				stderr,
			);
			if (!alreadyGone) {
				const message =
					`requeue --reset for '${slug}': failed to delete the remote branch ` +
					`${branch} on ${arbiter} (${stderr || 'unknown error'}); ` +
					'aborting the requeue — item left in needs-attention (no backlog move). ' +
					'The local tracking ref was already cleared (write-through ordering); ' +
					'a subsequent fetch will restore it from the arbiter — the local store ' +
					'is BEHIND the arbiter (self-healing), never AHEAD (which would drive a ' +
					'stale continue).';
				note(message);
				return {moved: false, reasonNotMoved: message};
			}
		}
		deletedRemoteBranch = true;
		note(`Deleted the remote branch ${branch} on ${arbiter} (--reset).`);
	}

	// DEFAULT (keep+continue) REQUEUE-SAFETY GUARD: a claimable item's continue-
	// branch MUST be reachable by ANY worker, so before releasing the lock verify
	// the ARBITER branch `<arbiter>/work/<slug>` exists + is ahead of main — the
	// EXACT "is the continue-branch on the arbiter?" question the continue-path asks
	// in `isolation.ts`. We check the ARBITER ref (already fetched above), NOT the
	// local `work/<slug>` (which SURVIVES a failed push). NOT on `--reset` (which
	// discards the branch by design).
	if (!options.reset) {
		const branch = workBranchRef('task', slug);
		// Split the guard into TWO cases (task
		// `default-requeue-succeeds-when-no-work-branch-exists`):
		//   (a) the arbiter branch does NOT EXIST at all (never pushed, or a prior
		//       `--reset` already deleted it) — there is NO continue-branch a future
		//       worker would resume from, so the guard's precondition is vacuously
		//       satisfied. Degrade gracefully to the same effective outcome as
		//       `--reset` (nothing to discard) and proceed with the keep+continue
		//       backlog move: no arbiter delete (there is nothing to delete), no
		//       forcing the caller into the destructive `--reset` verb.
		//   (b) the arbiter branch EXISTS but is NOT ahead of `<arbiter>/main` — a
		//       real anomaly (the continue-branch would resume from a state already
		//       reachable from main). Preserve today's refusal so the case surfaces.
		const tip = gitSoftRun(
			['rev-parse', '--verify', '--quiet', `${arbiter}/${branch}^{commit}`],
			cwd,
			env,
		);
		const arbiterBranchExists = tip.status === 0 && tip.stdout.trim() !== '';
		if (!arbiterBranchExists) {
			note(
				`'${slug}' has no work branch on ${arbiter} — requeueing to backlog ` +
					'for a FRESH claim (nothing to continue from; no --reset needed).',
			);
		} else {
			const onArbiter = branchAheadOf(
				cwd,
				`${arbiter}/${branch}`,
				`${arbiter}/main`,
				env,
			);
			if (!onArbiter) {
				const message =
					`the work branch ${branch} isn't on ${arbiter} (the continue ` +
					`branch a cross-machine worker would resume from) — push it first, or ` +
					'`requeue --reset` to discard and start fresh. Item left stuck (lock not ' +
					'released).';
				note(message);
				return {moved: false, reasonNotMoved: message};
			}
		}
	}

	const commitMessage = `chore(${slug}): return to backlog for re-claiming`;
	const handoff =
		options.message && options.message.trim() !== ''
			? options.message.trim()
			: undefined;
	// The body rests EITHER in the pool (`tasks-ready`) OR — for a staged item driven
	// with `--allow-backlog` — in staging (`tasks-backlog`). Probe in the SAME
	// precedence `resolveTask`/`--allow-backlog` uses (ready first, then backlog), so
	// the handoff note finds a staged body too (obs
	// `requeue-dash-m-fails-and-strands-lock-for-staged-backlog-item`).
	const bodyResidenceCandidates: readonly WorkFolderKey[] = [
		'tasks-ready',
		'tasks-backlog',
	];

	// `-m "<note>"` (the handoff steer): APPEND a dated `## Requeue YYYY-MM-DD`
	// section to the item BODY where it already rests (pool or staging), via the SAME
	// tree-less CAS move (same-folder rewrite with the body transform) — it NEVER
	// stages/commits in the cwd tree. The handoff is OPTIONAL and NON-FATAL: a failed
	// append degrades to a WARNING and the lock release below STILL runs, because the
	// lock release is the load-bearing recovery and must never be stranded by an
	// optional note (obs `requeue-dash-m-fails-and-strands-lock-for-staged-backlog-item`).
	if (handoff !== undefined) {
		const noted = await runTreelessLedgerMove({
			cwd,
			slug,
			arbiter,
			kind: 'requeue',
			onContended: 'requeue',
			explicitMainRefspec: false,
			env,
			note,
			plan: (base) => {
				const bodyRel = bodyResidenceCandidates
					.map((folder) => workItemRel(folder, `${slug}.md`))
					.find((rel) => pathInCommit(base, rel, cwd, env));
				if (bodyRel === undefined) {
					// The body is in neither tasks/ready/ nor tasks/backlog/ on this base —
					// nothing to annotate (the durable move that placed it must land first).
					return 'missing';
				}
				return prepareTreelessMoveCommit({
					cwd,
					slug,
					base,
					sourceRel: bodyRel,
					destRel: bodyRel,
					transformBody: (body) => appendRequeueNoteText(body, handoff),
					commitMessage: `chore(${slug}): requeue handoff note`,
					refNamespace: 'requeue',
					env,
				});
			},
		});
		if (!noted) {
			// NON-FATAL: warn and fall through to the lock release. We do NOT strand the
			// lock for a failed OPTIONAL note (the previous behaviour, which left a
			// half-applied state: branch deleted on --reset, lock still held).
			note(
				`requeue for '${slug}': could not append the -m handoff note (the body ` +
					`is in neither tasks/ready/ nor tasks/backlog/ on ${arbiter}/main, or ` +
					'main kept moving). Releasing the lock anyway — the requeue still ' +
					'recovers the item; only the note was skipped.',
			);
		}
	}

	// RELEASE the held lock (`stuck → released` / give up the hold): the item
	// returns to the claimable pool (its body already rests in `backlog/`). Use the
	// tolerant {@link releaseItemLock} (idempotent) so requeue recovers BOTH a
	// `stuck` hold (the resolved-recovery path) and an `active` hold (a killed run
	// that never surfaced) — the human asserting "put it back".
	const released = await releaseItemLock({
		item: `task:${slug}`,
		cwd,
		arbiter,
		env,
	});
	if (released.outcome === 'error') {
		const message =
			`requeue for '${slug}': could not release the per-item lock ` +
			`(${released.message}). The item is left stuck. Try again shortly.`;
		note(message);
		return {moved: false, reasonNotMoved: message};
	}
	note(
		`Returned '${slug}' to backlog (released the lock; body rests in pool).`,
	);
	return {moved: true, commitMessage, deletedRemoteBranch};
}

/**
 * **Promote a STAGED task into the agent-eligible pool** (spec
 * `staging-pool-position-gate-and-trust-model`, task
 * `pre-backlog-staging-folder-and-promote-step-a`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). Moves
 * `work/pre-backlog/<slug>.md → work/backlog/<slug>.md` as a durable `main`
 * move, the same category as {@link returnToBacklog} (tree-less CAS via
 * {@link runTreelessLedgerMove}). After this transition the task is in the
 * pool and claimable.
 *
 * **RUNNER/human-owned.** There is no agent-facing path that performs this:
 * the agent's tasking output lands STAGED in `work/pre-backlog/` (the runner's
 * deterministic placement decision), and only a runner/human invocation moves
 * it into the pool. The agent does no git here, as everywhere.
 *
 * Storage-agnostic: it names the slug + the arbiter, NOT *where* the move
 * lands; the sole strategy publishes to `<arbiter>/main`. Like
 * {@link returnToBacklog} the tree-less CAS needs a ref to push to, so an
 * `arbiter` is REQUIRED. NEVER throws for the expected
 * "not in pre-backlog/" / contention-exhausted cases — it returns
 * `{moved: false, reasonNotMoved}` so callers can branch cleanly.
 */
export interface PromoteFromPreBacklogOptions {
	/**
	 * The working clone the move is ORIGINATED from — purely the ORIGIN SOURCE
	 * (it resolves the arbiter remote + holds the object store the plumbing
	 * writes into), NEVER a write TARGET. Tree-less: the cwd index/HEAD/working
	 * tree are never touched (parity with {@link returnToBacklog}).
	 */
	cwd: string;
	/** The slug of the staged task to promote into the pool. */
	slug: string;
	/**
	 * The arbiter remote the promotion is CAS-published to. REQUIRED — the
	 * tree-less CAS needs a ref to push to (parity with `requeue`/`claim`).
	 */
	arbiter: string;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface PromoteFromPreBacklogResult {
	/** True iff the staged task was moved into the pool + committed. */
	moved: boolean;
	/** When `moved`, the committed transition message. */
	commitMessage?: string;
	/** When NOT moved, why (no such pre-backlog item, already in backlog, contention). */
	reasonNotMoved?: string;
}

export async function promoteFromPreBacklog(
	options: PromoteFromPreBacklogOptions,
): Promise<PromoteFromPreBacklogResult> {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	if (!options.arbiter) {
		return {
			moved: false,
			reasonNotMoved:
				`promote for '${slug}' needs an --arbiter: the move is published as a ` +
				'tree-less compare-and-swap to the arbiter ref (like requeue/claim), so ' +
				'there is no local-only mode — pass --arbiter.',
		};
	}
	const arbiter = options.arbiter;

	if (
		(await gitSoftAsync(['remote', 'get-url', arbiter], cwd, env)).status !== 0
	) {
		return {
			moved: false,
			reasonNotMoved: `no git remote named '${arbiter}' (set one, or pass --arbiter).`,
		};
	}

	// Refresh `<arbiter>/main` so the residence probe + the CAS base see the
	// arbiter's TRUTH. A fetch, not a checkout — the working tree is untouched.
	await gitSoftAsync(['fetch', '--quiet', arbiter], cwd, env);

	// UNIFIED PER-ITEM LOCK around the CAS window (spec
	// `staging-surface-and-apply-promote-safety`, task
	// `f3b-promote-takes-per-item-advancing-lock`): promote and apply BOTH key onto
	// the item's `refs/dorfl/lock/<entry>` ref with `action: advance` (the
	// SAME action `apply` takes via `advancing-lock.ts`), so an apply mid-flight
	// and a promote attempt on the SAME item are mutually exclusive BY
	// CONSTRUCTION (the second acquirer loses the create-only ref CAS). Reusing
	// the existing `advance` action value (rather than introducing a distinct
	// `'promote'` axis) is deliberate — the lock entry is keyed on the item
	// identity, and what matters is that ALL three transitions of one item
	// (implement/task/advance) serialise on ONE ref. A lock `lost` exits CLEAN
	// (no partial state on `main`, mirroring claim-cas loss semantics); on success
	// or failure we release the lock in `finally`. Crash-safe release mirrors the
	// apply rung: a crashed promote leaves an `advance`-active lock that the
	// existing `release-lock` / `gc --ledger` recovery surface clears.
	const item = `task:${slug}`;
	const acquired = await acquireItemLock({
		item,
		action: 'advance',
		cwd,
		arbiter,
		env,
	});
	if (acquired.outcome !== 'acquired') {
		const message =
			acquired.outcome === 'lost'
				? `promote for '${slug}' lost the per-item lock race (another implement/task/advance hold is in flight). No move on ${arbiter}/main. Try again shortly.`
				: `promote for '${slug}': could not acquire the per-item lock (${acquired.message}).`;
		note(message);
		return {moved: false, reasonNotMoved: message};
	}
	try {
		const sourceRel = workItemRel('tasks-backlog', `${slug}.md`);
		const destRel = workItemRel('tasks-ready', `${slug}.md`);

		// Early-exit message: if NEITHER staged nor already-in-pool, there is
		// nothing to promote (the per-attempt `plan` is the authoritative
		// resolution against the live base).
		const hasSource =
			(
				await gitSoftAsync(
					['cat-file', '-e', `${arbiter}/main:${sourceRel}`],
					cwd,
					env,
				)
			).status === 0;
		const hasDest =
			(
				await gitSoftAsync(
					['cat-file', '-e', `${arbiter}/main:${destRel}`],
					cwd,
					env,
				)
			).status === 0;
		if (!hasSource && !hasDest) {
			const message =
				`'${slug}' is not staged in ${workFolderPrefix('tasks-backlog')} on ${arbiter}/main ` +
				`(and not already in ${workFolderPrefix('tasks-ready')}) — nothing to promote ` +
				'(wrong slug, or never staged?).';
			note(message);
			return {moved: false, reasonNotMoved: message};
		}

		const commitMessage = `chore(${slug}): promote ${workFolderPrefix(
			'tasks-backlog',
		)} -> ${workFolderPrefix('tasks-ready')}`;
		const moved = await runTreelessLedgerMove({
			cwd,
			slug,
			arbiter,
			kind: 'promote',
			onContended: 'promote',
			// The surface direction's main-only refspec works here too: this runs in
			// the project checkout, but we only need `<arbiter>/main` resolved, and
			// the explicit refspec is the safer default (mirrors `surface`).
			explicitMainRefspec: true,
			env,
			note,
			plan: (base) => {
				// If already in the pool on this base, a prior attempt landed
				// (idempotent).
				if (pathInCommit(base, destRel, cwd, env)) {
					return 'already-done';
				}
				if (!pathInCommit(base, sourceRel, cwd, env)) {
					return 'missing';
				}
				return prepareTreelessMoveCommit({
					cwd,
					slug,
					base,
					sourceRel,
					destRel,
					// The body is carried byte-for-byte from tasks/backlog into the
					// pool — promotion is a placement decision, not a content transform.
					transformBody: (body) => body,
					commitMessage,
					refNamespace: 'promote',
					env,
				});
			},
		});
		if (moved) {
			note(`Promoted '${slug}' from tasks/backlog to tasks/ready (claimable).`);
			return {moved: true, commitMessage};
		}

		const message =
			`promote for '${slug}': the arbiter's main kept moving (contended) after ` +
			`${TREELESS_CONTENTION_ATTEMPTS} attempts — item left in tasks/backlog ` +
			'(no move). Try again shortly.';
		note(message);
		return {moved: false, reasonNotMoved: message};
	} finally {
		await releaseItemLock({item, cwd, arbiter, env});
	}
}

/**
 * **Promote a STAGED spec into the auto-task pool** (spec
 * `staging-pool-position-gate-and-trust-model`, task
 * `pre-prd-staging-pool-split-and-untrusted-prd-placement`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). The spec
 * twin of {@link promoteFromPreBacklog}: moves
 * `work/specs/proposed/<slug>.md → work/specs/ready/<slug>.md` as a durable `main` move
 * (tree-less CAS via {@link runTreelessLedgerMove}). After this transition
 * the spec is in the auto-task POOL and eligible to be auto-tasked (subject
 * to the existing `autoTask`/`humanOnly`/`needsAnswers`/`taskedAfter` gates,
 * which are UNCHANGED — the staging/pool split changes only WHICH folder is
 * the auto-task pool, not the gates).
 *
 * **RUNNER/human-owned.** There is no agent-facing path that performs this:
 * `intake`'s `spec` dispatch lands the spec STAGED in `work/specs/proposed/` (the
 * runner's deterministic placement decision), and only a runner/human
 * invocation moves it into the pool. The agent does no git here, as
 * everywhere; this function is not reachable from any agent surface.
 *
 * Storage-agnostic + tree-less, exactly like {@link promoteFromPreBacklog}:
 * cwd index/HEAD/working tree are never touched, an arbiter remote is
 * REQUIRED, and "not in specs/proposed/" / contention-exhausted cases are returned
 * (NEVER thrown) via `{moved: false, reasonNotMoved}` so callers branch
 * cleanly. Idempotent: re-running after the move LANDED is a no-op success.
 */
export interface PromoteFromPreSpecOptions {
	/** The working clone the move is originated from (origin source only; never written). */
	cwd: string;
	/** The slug of the staged spec to promote into the pool. */
	slug: string;
	/** The arbiter remote the promotion is CAS-published to. REQUIRED. */
	arbiter: string;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface PromoteFromPreSpecResult {
	/** True iff the staged spec was moved into the pool + committed. */
	moved: boolean;
	/** When `moved`, the committed transition message. */
	commitMessage?: string;
	/** When NOT moved, why (no such specs/proposed item, already in specs/ready/, contention). */
	reasonNotMoved?: string;
}

export async function promoteFromPreSpec(
	options: PromoteFromPreSpecOptions,
): Promise<PromoteFromPreSpecResult> {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	if (!options.arbiter) {
		return {
			moved: false,
			reasonNotMoved:
				`promote for '${slug}' needs an --arbiter: the move is published as ` +
				'a tree-less compare-and-swap to the arbiter ref (like requeue/claim), so ' +
				'there is no local-only mode — pass --arbiter.',
		};
	}
	const arbiter = options.arbiter;

	if (
		(await gitSoftAsync(['remote', 'get-url', arbiter], cwd, env)).status !== 0
	) {
		return {
			moved: false,
			reasonNotMoved: `no git remote named '${arbiter}' (set one, or pass --arbiter).`,
		};
	}

	// Refresh `<arbiter>/main` so the residence probe + the CAS base see the
	// arbiter's TRUTH. A fetch, not a checkout — the working tree is untouched.
	await gitSoftAsync(['fetch', '--quiet', arbiter], cwd, env);

	// UNIFIED PER-ITEM LOCK around the CAS window — symmetric with
	// {@link promoteFromPreBacklog} (spec `staging-surface-and-apply-promote-safety`,
	// task `f3b-promote-takes-per-item-advancing-lock`, decisive spec q4 answer:
	// specs share the apply×promote mutual-exclusion fix with tasks). The lock
	// keys on `spec:${slug}` (a distinct ref from a task with the same slug, via
	// {@link lockEntryFor}'s `<type>-<slug>` encoding), with `action: advance` —
	// the SAME action an apply for a spec would take — so spec promote and spec
	// apply on the same item are mutually exclusive by construction. MIGRATE step
	// (spec `prd-to-spec-vocabulary-cutover-and-migration-command`): the lock
	// identity is `spec:${slug}` to match the `spec-<slug>` entry the tasking/apply
	// path now acquires (`tasking.ts` releases under `spec:${slug}`); a stale
	// ''prd:${slug}'' here would key a DIFFERENT ref and break the mutual exclusion.
	// Loss / crash semantics mirror the task case.
	const item = `spec:${slug}`;
	const acquired = await acquireItemLock({
		item,
		action: 'advance',
		cwd,
		arbiter,
		env,
	});
	if (acquired.outcome !== 'acquired') {
		const message =
			acquired.outcome === 'lost'
				? `promote for '${slug}' lost the per-item lock race (another implement/task/advance hold is in flight). No move on ${arbiter}/main. Try again shortly.`
				: `promote for '${slug}': could not acquire the per-item lock (${acquired.message}).`;
		note(message);
		return {moved: false, reasonNotMoved: message};
	}
	try {
		const sourceRel = workItemRel('specs-proposed', `${slug}.md`);
		const destRel = workItemRel('specs-ready', `${slug}.md`);

		const hasSource =
			(
				await gitSoftAsync(
					['cat-file', '-e', `${arbiter}/main:${sourceRel}`],
					cwd,
					env,
				)
			).status === 0;
		const hasDest =
			(
				await gitSoftAsync(
					['cat-file', '-e', `${arbiter}/main:${destRel}`],
					cwd,
					env,
				)
			).status === 0;
		if (!hasSource && !hasDest) {
			const message =
				`'${slug}' is not staged in ${workFolderPrefix('specs-proposed')} on ${arbiter}/main ` +
				`(and not already in ${workFolderPrefix('specs-ready')}) — nothing to promote ` +
				'(wrong slug, or never staged?).';
			note(message);
			return {moved: false, reasonNotMoved: message};
		}

		const commitMessage = `chore(${slug}): promote ${workFolderPrefix(
			'specs-proposed',
		)} -> ${workFolderPrefix('specs-ready')}`;
		const moved = await runTreelessLedgerMove({
			cwd,
			slug,
			arbiter,
			kind: 'promote',
			onContended: 'promote',
			explicitMainRefspec: true,
			env,
			note,
			plan: (base) => {
				if (pathInCommit(base, destRel, cwd, env)) {
					return 'already-done';
				}
				if (!pathInCommit(base, sourceRel, cwd, env)) {
					return 'missing';
				}
				return prepareTreelessMoveCommit({
					cwd,
					slug,
					base,
					sourceRel,
					destRel,
					// The body is carried byte-for-byte from specs/proposed into the pool —
					// promotion is a placement decision, not a content transform.
					transformBody: (body) => body,
					commitMessage,
					refNamespace: 'promote',
					env,
				});
			},
		});
		if (moved) {
			note(
				`Promoted spec '${slug}' from specs/proposed to specs/ready (auto-taskable).`,
			);
			return {moved: true, commitMessage};
		}

		const message =
			`promote for '${slug}': the arbiter's main kept moving (contended) ` +
			`after ${TREELESS_CONTENTION_ATTEMPTS} attempts — item left in specs/proposed ` +
			'(no move). Try again shortly.';
		note(message);
		return {moved: false, reasonNotMoved: message};
	} finally {
		await releaseItemLock({item, cwd, arbiter, env});
	}
}

/** One staged item awaiting promotion (a task in `pre-backlog/` or a spec in `specs/proposed/`). */
export interface PromotableItem {
	/** `'task'` (staged in `work/pre-backlog/`) or `'spec'` (staged in `work/specs/proposed/`). */
	namespace: 'task' | 'spec';
	/** The slug (filename minus `.md`). */
	slug: string;
}

export interface ListPromotableOptions {
	/** The working clone the arbiter remote is resolved FROM (origin source only). */
	cwd: string;
	/** The arbiter remote whose `main` the staging folders are read from. REQUIRED. */
	arbiter: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
}

export interface ListPromotableResult {
	/** Every staged item awaiting promotion, tasks then prds, each sorted by slug. */
	items: PromotableItem[];
	/** When the listing could not run (no such remote), why. */
	error?: string;
}

/**
 * LIST every staged item awaiting a runner/human promotion — the tasks in
 * `work/pre-backlog/` and the prds in `work/specs/proposed/` on `<arbiter>/main` (the
 * discovery half of the `promote` verb, so `promote` with no argument answers
 * "what is staged waiting for me?"). It reads the ARBITER's truth (a fetch + a
 * tree read), NOT the local working tree (which may be stale) — the same source
 * the promotion functions act against, so the list and the move never disagree.
 * Read-only: it never fetches a checkout, never moves anything.
 */
export async function listPromotable(
	options: ListPromotableOptions,
): Promise<ListPromotableResult> {
	const {cwd, arbiter, env} = options;
	if (
		(await gitSoftAsync(['remote', 'get-url', arbiter], cwd, env)).status !== 0
	) {
		return {
			items: [],
			error: `no git remote named '${arbiter}' (set one, or pass --arbiter).`,
		};
	}
	// Refresh `<arbiter>/main` so the listing sees the arbiter's TRUTH (a fetch,
	// not a checkout — the working tree is untouched), exactly as the promote
	// functions do before their residence probe.
	await gitSoftAsync(['fetch', '--quiet', arbiter], cwd, env);
	const tasks = await listMarkdownSlugsInTree(
		`${arbiter}/main:${workFolderRel('tasks-backlog')}`,
		cwd,
		env,
	);
	const specs = await listMarkdownSlugsInTree(
		`${arbiter}/main:${workFolderRel('specs-proposed')}`,
		cwd,
		env,
	);
	return {
		items: [
			...tasks.map((slug) => ({namespace: 'task' as const, slug})),
			...specs.map((slug) => ({namespace: 'spec' as const, slug})),
		],
	};
}

/**
 * `git ls-tree --name-only <base>` → the `.md` filenames' SLUGS (filename minus
 * `.md`), sorted. An absent folder on the ref reads as empty (the staging folder
 * may not exist yet). The bare-repo-safe read (`ls-tree`, no working tree), the
 * SAME mechanism the ledger read seam uses.
 */
async function listMarkdownSlugsInTree(
	base: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string[]> {
	const tree = await gitSoftAsync(['ls-tree', '--name-only', base], cwd, env);
	if (tree.status !== 0) {
		return [];
	}
	return tree.stdout
		.split('\n')
		.map((s) => s.trim())
		.filter((name) => isWorkItemFile(name))
		.map((name) => name.replace(/\.md$/i, ''))
		.sort();
}

/** The contention-retry cap shared by the tree-less requeue + surface moves. */
const TREELESS_CONTENTION_ATTEMPTS = 5;

/**
 * The plan for ONE attempt of a tree-less move, computed FRESH against the
 * current (re-fetched) base so a retry never reuses a stale source/blob:
 *  - `{ref, commit}` — a prepared move commit on a throwaway ref, ready to CAS.
 *  - `'already-done'` — the item is ALREADY at the destination on this base (an
 *    idempotent re-surface, or a prior attempt that actually landed but whose CAS
 *    verify reported rejected) — treat as success, no push needed.
 *  - `'missing'` — the item is in NEITHER the source nor the destination folder on
 *    this base — nothing to move.
 */
type TreelessAttemptPlan =
	| {ref: string; commit: string}
	| 'already-done'
	| 'missing';

/**
 * The SHARED tree-less ledger-move core (ONE mechanism for BOTH directions — the
 * requeue `needs-attention|in-progress → backlog` and the surface `in-progress →
 * needs-attention`). It runs the contention-retry loop: fetch `<arbiter>/main`,
 * resolve `expectedBase`, ask the caller's `plan(base)` to build the one-file move
 * on a SCRATCH INDEX via {@link prepareTreelessMoveCommit} (so the caller's
 * index/HEAD/working tree are NEVER touched), CAS-publish it THROUGH the shared
 * write seam (`ledgerWrite.applyTransition`, the very push+lease+verify `claim`
 * uses), drop the throwaway ref, and on a CONTENTION rejection refetch + REPLAN
 * against the advanced base and retry. Re-planning per attempt is what makes the
 * retry safe when the item itself moved under us (e.g. a prior attempt landed but
 * the CAS verify reported rejected): the next plan sees it `already-done`.
 */
async function runTreelessLedgerMove(params: {
	cwd: string;
	slug: string;
	arbiter: string;
	kind: LedgerTransitionKind;
	/** Build (or short-circuit) the move against the current base. Called per attempt. */
	plan: (base: string) => TreelessAttemptPlan;
	/** A label for the contention-progress note (the verb the caller surfaces). */
	onContended: string;
	/**
	 * Fetch the arbiter's `main` with an EXPLICIT refspec
	 * (`+refs/heads/main:refs/remotes/<arbiter>/main`) instead of a plain
	 * `fetch <arbiter>`. The surface direction sets this `true` because it runs from
	 * a JOB WORKTREE whose remote's default fetch refspec may NOT map `main →
	 * refs/remotes/<arbiter>/main` (a bare-mirror worktree), so the plain fetch can
	 * leave `<arbiter>/main` unresolved. The requeue direction leaves it `false`: it
	 * needs ALL refs (the continue-branch guard reads `<arbiter>/work/<slug>`), so a
	 * main-only refspec would be too narrow there.
	 */
	explicitMainRefspec: boolean;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<boolean> {
	const {
		cwd,
		arbiter,
		kind,
		plan,
		onContended,
		explicitMainRefspec,
		env,
		note,
	} = params;
	const fetchArgs = explicitMainRefspec
		? [
				'fetch',
				'--quiet',
				arbiter,
				`+refs/heads/main:refs/remotes/${arbiter}/main`,
			]
		: ['fetch', '--quiet', arbiter];

	for (let i = 0; i < TREELESS_CONTENTION_ATTEMPTS; i++) {
		if (i > 0) {
			await gitSoftAsync(fetchArgs, cwd, env);
		}
		const base = (
			await gitHardAsync(['rev-parse', `${arbiter}/main`], cwd, env)
		).stdout.trim();

		// Plan the move FRESH against this (possibly re-fetched) base. The item may
		// already be at the destination (idempotent / a prior landed-but-reported-
		// rejected attempt) or absent — both are terminal, no push.
		const prepared = plan(base);
		if (prepared === 'already-done') {
			return true;
		}
		if (prepared === 'missing') {
			return false;
		}

		// Publish THROUGH the shared seam (the same `:main` push + force-with-lease +
		// verify `claim` uses). The transition's WHO stays the caller's ambient env
		// (threaded by `commit-tree` above) — tree-less is orthogonal to attribution.
		const result = await ledgerWrite.applyTransition({
			kind,
			arbiter,
			localBranch: prepared.ref,
			expectedBase: base,
			head: prepared.commit,
			cwd,
			env,
			note,
		});
		// Drop the throwaway ref either way (it served only as the push source).
		await gitSoftAsync(['update-ref', '-d', prepared.ref], cwd, env);

		if (result.kind === 'published') {
			// Advance the LOCAL remote-tracking `<arbiter>/main` so it INCLUDES the
			// move (the push only moved the arbiter's main). Best-effort.
			await gitSoftAsync(fetchArgs, cwd, env);
			return true;
		}
		// rejected: main moved under us — refetch + REPLAN against the new base.
		note(
			`main advanced under us — ${onContended} refetch and retry (${i + 1}/${TREELESS_CONTENTION_ATTEMPTS})...`,
		);
	}
	return false;
}

/** True iff `path` exists in the given commit's tree (a soft cat-file probe). */
function pathInCommit(
	commit: string,
	path: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	return (
		run('git', ['cat-file', '-e', `${commit}:${path}`], cwd, {env}).status === 0
	);
}

/**
 * Build a one-file ledger MOVE as a commit off the arbiter's `main`, using
 * PLUMBING on a SCRATCH INDEX — it never touches the caller's index, HEAD, or
 * working tree (so a concurrent writer's uncommitted cwd files can never be swept
 * in). It loads `base`'s tree into a throwaway index, relocates ONLY this slug's
 * ledger file from `sourceRel` to `destRel` (applying `transformBody` to its body
 * first — read from the blob on `main`, NOT from any cwd file: the requeue note,
 * or the needs-attention reason), writes the tree, commits it parented on `base`,
 * and points a throwaway local ref at the commit. Returns that ref + the commit
 * sha for the seam's CAS push. The SHARED prep for BOTH tree-less directions.
 */
function prepareTreelessMoveCommit(params: {
	cwd: string;
	slug: string;
	base: string;
	sourceRel: string;
	destRel: string;
	transformBody: (body: string) => string;
	commitMessage: string;
	refNamespace: string;
	env: NodeJS.ProcessEnv | undefined;
}): {ref: string; commit: string} {
	const {
		cwd,
		slug,
		base,
		sourceRel,
		destRel,
		transformBody,
		commitMessage,
		refNamespace,
		env,
	} = params;

	// The item's body on `main`, with the caller's body transform applied.
	const original = catBlob(`${base}:${sourceRel}`, cwd, env);
	const content = transformBody(original);
	// Hash the (possibly transformed) blob INTO the cwd's object store. A blob
	// write does not touch the working tree.
	const blob = hashObject(content, cwd, env);

	// A scratch index so read-tree/update-index never disturb the caller's index.
	const scratchIndex = join(
		tmpdir(),
		`dorfl-${refNamespace}-${process.pid}-${Date.now()}.index`,
	);
	const withIndex: NodeJS.ProcessEnv = {
		...(env ?? process.env),
		GIT_INDEX_FILE: scratchIndex,
	};
	try {
		gitHard(['read-tree', base], cwd, withIndex);
		// Remove the item from its source folder, add it under the dest folder. When
		// source === dest (an idempotent re-surface), force-remove + re-add the same
		// path is a no-op move that still carries any body change. One file changes.
		gitHard(['update-index', '--force-remove', sourceRel], cwd, withIndex);
		gitHard(
			['update-index', '--add', '--cacheinfo', `100644,${blob},${destRel}`],
			cwd,
			withIndex,
		);
		const tree = runHard(['write-tree'], cwd, withIndex).stdout.trim();
		// commit-tree threads the caller's ambient identity (env) — tree-less only
		// changed the WHERE-it-writes (the arbiter ref, not the cwd tree), not the WHO.
		const commit = runHard(
			['commit-tree', tree, '-p', base, '-m', commitMessage],
			cwd,
			env,
		).stdout.trim();
		// A throwaway local ref the seam's push uses as its source (`<ref>:main`).
		const ref = `refs/dorfl/${refNamespace}/${slug}`;
		gitHard(['update-ref', ref, commit], cwd, env);
		return {ref, commit};
	} finally {
		rmSync(scratchIndex, {force: true});
	}
}

/** The heading that opens an appended requeue handoff note in the item body. */
const REQUEUE_HEADING_PREFIX = '## Requeue';

/**
 * Append a dated `## Requeue YYYY-MM-DD` handoff section to an item body's TEXT
 * (append-only — never overwrites; repeated requeues accumulate a handoff log).
 * Body prose only (never a frontmatter field — WORK-CONTRACT rule 3). The date is
 * UTC `YYYY-MM-DD`; multiple notes on the same day are distinct appended blocks.
 *
 * A PURE string transform (it operates on the body CONTENT, not a file path) so
 * the tree-less requeue can apply it to the blob read from `<arbiter>/main`
 * without touching the cwd working tree.
 */
function appendRequeueNoteText(content: string, message: string): string {
	const date = new Date().toISOString().slice(0, 10);
	const base = content.replace(/\s*$/, '');
	return [base, '', `${REQUEUE_HEADING_PREFIX} ${date}`, '', message, ''].join(
		'\n',
	);
}

/**
 * Extract the prose written under the `## Needs attention` heading from an item
 * body. Returns the first non-empty line(s) of the block as a single line
 * (stops at the next `## ` heading); '' when no block is present. The
 * needs-attention REASON is now recorded on the per-item lock entry (task
 * `cutover-needs-attention-becomes-lock-stuck-recovery-surface`, decision i+),
 * NOT in the body, but this extractor stays for any historical body text that
 * still carries the heading (a tolerant best-effort read).
 */
export function extractReason(content: string): string {
	const normalized = content.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const start = lines.findIndex((l) => l.trim() === REASON_HEADING);
	if (start === -1) {
		return '';
	}
	const collected: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^##\s/.test(line)) {
			break;
		}
		if (/^###\s/.test(line)) {
			// The questions sub-section starts here; the reason itself is above it.
			break;
		}
		if (line.trim() === '') {
			if (collected.length > 0) {
				// Stop at the first blank line AFTER we captured the reason text.
				break;
			}
			continue;
		}
		collected.push(line.trim());
	}
	return collected.join(' ').trim();
}

/** Run git; throw on non-zero (genuinely unexpected plumbing failures). */
function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	runHard(args, cwd, env);
}

/** Like {@link gitHard} but returns the raw result (for plumbing that emits stdout). */
function runHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): RunResult {
	const result = run('git', args, cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result;
}

/** Async soft git (no throw) — for the tree-less requeue's remote checks. */
function gitSoftAsync(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	return runAsync('git', args, cwd, {env});
}

/** Async git; throw on non-zero (unexpected plumbing failures). */
async function gitHardAsync(
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

/** Read an object's content (`git cat-file -p <object>`) from the cwd's store. */
function catBlob(
	object: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): string {
	return runHard(['cat-file', '-p', object], cwd, env).stdout;
}

/** Write a blob into the cwd's object store (`git hash-object -w`), return its sha. */
function hashObject(
	content: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): string {
	const result = run('git', ['hash-object', '-w', '--stdin'], cwd, {
		env,
		input: content,
	});
	if (result.status !== 0) {
		throw new Error(
			`git hash-object failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result.stdout.trim();
}

/**
 * Run git, returning the raw result (no throw) — for soft checks like the
 * `--reset` remote-branch delete, whose non-zero exit is a meaningful outcome
 * (the requeue aborts) rather than an unexpected plumbing failure.
 */
function gitSoftRun(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): {status: number; stdout: string; stderr: string} {
	return run('git', args, cwd, {env});
}

/** True when the index has no staged changes against HEAD (nothing to commit). */
function nothingStaged(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	// `diff --cached --quiet` exits 0 when NOTHING is staged, 1 when there is.
	return run('git', ['diff', '--cached', '--quiet'], cwd, {env}).status === 0;
}

/** The current HEAD commit sha (the just-made commit's tip). */
function revParseHead(cwd: string, env: NodeJS.ProcessEnv | undefined): string {
	const result = run('git', ['rev-parse', 'HEAD'], cwd, {env});
	if (result.status !== 0) {
		throw new Error(
			`git rev-parse HEAD failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result.stdout.trim();
}
