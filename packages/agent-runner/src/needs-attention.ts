import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run, runAsync, type RunResult} from './git.js';
import {branchAheadOf} from './continue-branch.js';
import {ledgerRead} from './ledger-read.js';
import {ledgerWrite} from './ledger-write.js';
import {workBranchRef} from './slug-namespace.js';
import {
	retryWithBackoff,
	realSleep,
	type BackoffOptions,
	type Sleep,
} from './retry-backoff.js';

/**
 * The folder-native **needs-attention mechanism** (ADR §12; WORK-CONTRACT
 * `needs-attention/` section). Every "couldn't finish, a human must look"
 * outcome — a failed acceptance gate (red `verify`), a rebase/merge conflict
 * (ADR §10), a slice the agent reported too ambiguous to build, a timeout, or a
 * rejected review — resolves to ONE move: the RUNNER `git mv`s the claimed item
 * from `work/in-progress/<slug>.md` to `work/needs-attention/<slug>.md`, writing
 * the reason (+ any agent-surfaced questions) into the file BODY, and commits it
 * exactly like the done-move.
 *
 * This is the conflict-safe form of "surfacing": the surface is a folder you can
 * `ls`, read by `scan`/`status` — there is **no status/label field** (honours
 * WORK-CONTRACT rule 3: status = the folder). The reason is prose in the body,
 * never a source-of-truth frontmatter field.
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
	 * commits landed on. A slicing bounce passes its own branch (`work/slicing/
	 * <slug>`). The supplied branch MUST be the one HEAD is on (the branch the
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
	 * When `moved`, the sha of the **move-only** commit — the tip of `work/<slug>`
	 * that carries PURELY the `git mv → needs-attention/` + the reason (the wip
	 * commit holding the aborted agent work sits BELOW it). A surfacing strategy
	 * cherry-picks THIS commit to make the stuck state observable, so the wip never
	 * reaches the ledger.
	 */
	moveCommit?: string;
	/** When NOT moved, why (e.g. the slug was not in-progress). */
	reasonNotMoved?: string;
}

export interface ReturnToBacklogOptions {
	/** The working clone the `work/` tree lives in. */
	cwd: string;
	/**
	 * The slug of the stuck item to re-queue — recovered from `needs-attention/`
	 * OR `in-progress/` (the actual current folder is resolved on the arbiter).
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
	/** When NOT moved, why (e.g. the slug was in neither needs-attention/ nor in-progress/, or a failed --reset delete). */
	reasonNotMoved?: string;
}

export interface ResolveFromNeedsAttentionOptions {
	/** The working clone the `work/` tree lives in. */
	cwd: string;
	/** The slug of the needs-attention item to resolve back to in-progress. */
	slug: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ResolveFromNeedsAttentionResult {
	/** True iff the item was moved back to in-progress + committed. */
	moved: boolean;
	/** When `moved`, the committed transition message. */
	commitMessage?: string;
	/** When `moved`, the sha of the reverse move-only commit (the new tip). */
	moveCommit?: string;
	/** When NOT moved, why (e.g. the slug was not in needs-attention). */
	reasonNotMoved?: string;
}

/**
 * The folder the item to route currently lives in. Probes `in-progress/` (the
 * test-gate path, before the done-move) and `done/` (the rebase-conflict path,
 * after it) FIRST, then `needs-attention/` itself.
 *
 * The `needs-attention/` arm makes the route an IDEMPOTENT RE-SURFACE: on an
 * onboard-time CONTINUE rebase-conflict the worktree is cut from the kept
 * `work/<slug>` branch, whose tree ALREADY holds the item in
 * `needs-attention/<slug>.md` (from the prior bounce). Without this arm the probe
 * returned `undefined` ⇒ `{moved: false}` ⇒ no surface re-publish, so a `main`
 * that currently shows the item elsewhere (e.g. `in-progress/` after a re-claim)
 * went STALE. Recognising `needs-attention/` lets the route re-publish the
 * surface (the move becomes a no-op-content self-move the caller handles). It is
 * probed LAST so a real pre-needs-attention source (`in-progress/`/`done/`) still
 * wins when the item is mid-transition.
 */
function findSourceFolder(
	cwd: string,
	slug: string,
): {rel: string; abs: string} | undefined {
	for (const folder of ['in-progress', 'done', 'needs-attention']) {
		const rel = join('work', folder, `${slug}.md`);
		const abs = join(cwd, rel);
		if (existsSync(abs)) {
			return {rel, abs};
		}
	}
	return undefined;
}

/** One needs-attention item as the surface (`status`) reads it. */
export interface NeedsAttentionItem {
	/** Filename within `work/needs-attention/` (e.g. `alpha.md`). */
	file: string;
	/** Resolved slug (frontmatter `slug:`, falling back to the filename). */
	slug: string;
	/**
	 * The recorded reason prose (the text under the `## Needs attention` heading),
	 * when present — surfaced by `status`. Empty string when no reason block was
	 * written (e.g. an item moved here by hand).
	 */
	reason: string;
}

/**
 * Route a stuck claimed item to `needs-attention/` (ADR §12). The RUNNER calls
 * this; the build agent never does. It always **saves the aborted work** and
 * produces TWO commits on `work/<slug>` (never-lose-work; PRD
 * `needs-attention-cherry-pick`):
 *
 *   1. A **wip** commit holding the aborted agent work (`git add -A` of whatever
 *      the agent left uncommitted in the tree). This is committed FIRST and
 *      stays BELOW the tip, so a surfacing strategy that publishes only the tip
 *      never leaks the half-finished work onto the ledger. When the tree is
 *      already clean (nothing uncommitted) no wip commit is made — there is no
 *      aborted work to save.
 *   2. A **move-only** commit on top (the tip): the reason appended to the file
 *      BODY (prose, NOT a frontmatter field — WORK-CONTRACT rule 3) +
 *      `git mv work/<src>/<slug>.md work/needs-attention/<slug>.md` (mkdir -p the
 *      destination first — git tracks no empty dirs). The source is whichever of
 *      `in-progress/` (the test-gate path, before the done-move) or `done/` (the
 *      rebase-conflict path, after it) the item currently sits in. This commit is
 *      PURELY the move + reason — it is the one a surfacing strategy cherry-picks.
 *
 * Optionally pushes the work branch to the arbiter (the RECOVERABLE half) so the
 * saved wip + the move travel cross-machine, when an `arbiter` is given. The
 * push is BEST-EFFORT (an unreachable arbiter leaves the local branch + the
 * ledger surface standing — recovery degrades, never crashes the bounce),
 * BRANCH-PARAMETERISED (default `work/<slug>`; an explicit `branch` overrides;
 * `pushBranch: false` ⇒ push NOTHING), and EMPTINESS-GUARDED (a branch with no
 * commits beyond main, or an absent branch, is skipped — a couldn't-even-start
 * bounce has nothing to push). The branch MUST be the one HEAD is on.
 *
 * NEVER throws for the expected "not in-progress/done" case — it returns
 * `{moved: false, reasonNotMoved}` so consumers can branch cleanly. Genuine git
 * plumbing failures still throw (they are unexpected).
 */
export async function routeToNeedsAttention(
	options: RouteToNeedsAttentionOptions,
): Promise<RouteToNeedsAttentionResult> {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	// The item could be in-progress (test-gate path, before the done-move), already
	// moved to done/ (rebase-conflict path, after it), or ALREADY in
	// needs-attention/ (the continue-conflict RE-SURFACE: the kept work/<slug>
	// branch's tree still holds the prior bounce). Route from whichever folder holds
	// it; a needs-attention/ source is a no-op-content re-surface (see below).
	const source = findSourceFolder(cwd, slug);
	if (!source) {
		return {
			moved: false,
			reasonNotMoved:
				`work/in-progress/${slug}.md (nor work/done/ nor ` +
				`work/needs-attention/${slug}.md) not found — nothing to route to ` +
				'needs-attention (wrong slug, or not claimed?).',
		};
	}
	const destRel = join('work', 'needs-attention', `${slug}.md`);
	const alreadyInNeedsAttention = source.rel === destRel;

	// 1. WIP commit: save whatever the agent left uncommitted FIRST, so it sits
	//    BELOW the move-only tip and a tip-only surface never carries it. Skip when
	//    the tree is clean (no aborted work to save).
	gitHard(['add', '-A'], cwd, env);
	if (!nothingStaged(cwd, env)) {
		gitHard(
			['commit', '-q', '-m', `chore(${slug}): save aborted work (wip)`],
			cwd,
			env,
		);
	}

	// 2. Record the reason as PROSE in the body (never a frontmatter field), then
	//    move folders (mkdir -p first; git tracks no empty dirs — no .gitkeep), and
	//    commit the MOVE-ONLY transition (reason + the git mv, nothing else) as the
	//    tip. This is the commit a surfacing strategy cherry-picks.
	appendReasonBlock(source.abs, options.reason, options.questions);
	const destDir = join(cwd, 'work', 'needs-attention');
	mkdirSync(destDir, {recursive: true});
	// When the item is ALREADY in needs-attention/ (the continue-conflict
	// re-surface), source.rel === destRel: there is no folder change, so `git mv
	// A A` would ERROR. Skip the mv; the file is in place and any reason-block
	// refresh staged below carries the re-surface. The move-only commit may then be
	// EMPTY (reason already present, idempotent) — `--allow-empty` keeps a stable
	// tip to (re)publish without thrashing.
	if (!alreadyInNeedsAttention) {
		gitHard(['mv', source.rel, destRel], cwd, env);
	}
	gitHard(['add', '-A'], cwd, env);
	const commitMessage = `chore(${slug}): route to needs-attention; ${options.reason}`;
	// On a re-surface the reason block may already be present (idempotent append),
	// leaving NOTHING staged — a plain commit would error. `--allow-empty` keeps a
	// stable move-only tip to (re)publish, so re-surfacing never thrashes nor fails.
	const commitArgs = ['commit', '-q', '-m', commitMessage];
	if (alreadyInNeedsAttention) {
		commitArgs.push('--allow-empty');
	}
	gitHard(commitArgs, cwd, env);
	const moveCommit = revParseHead(cwd, env);
	note(`Routed '${slug}' to needs-attention: ${options.reason}`);

	// Optionally push the work branch to the arbiter — the RECOVERABLE half of the
	//    bounce (so the saved wip + the move travel cross-machine and a requeue can
	//    continue from the branch tip). Three behaviours: SURFACE-ONLY (no push)
	//    when `pushBranch === false`; an explicit `branch` target; else the default
	//    `work/<slug>`. BEST-EFFORT (no throw on a failed/unreachable push), now
	//    RETRIED with bounded backoff on an OUTAGE before a clean give-up, and
	//    EMPTINESS-GUARDED (a branch with no work beyond main / an absent branch is
	//    skipped — a couldn't-even-start bounce has nothing to push). The OUTCOME is
	//    CAPTURED + RETURNED (`branchPush`) so the caller reports what ACTUALLY
	//    landed rather than assuming "pushed" off the local move.
	let branchPush: BranchPushOutcome = 'not-attempted';
	let pushError: string | undefined;
	if (options.arbiter && options.pushBranch !== false) {
		// DEFAULT to the slice-namespaced build-bounce branch; a non-slice caller
		// (the slicing bounce) passes its own `work/prd-<slug>` via `branch`.
		const branch = options.branch ?? workBranchRef('slice', slug);
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
 * slice stuck in EITHER `work/needs-attention/<slug>.md` (the resolved-surface
 * path) OR `work/in-progress/<slug>.md` (a claim that never surfaced — an
 * un-surfaced abort, a killed run, or an in-place requeue note; defect 2, story
 * 4): the slug's ACTUAL current folder is resolved on the arbiter and moved to
 * `backlog/` via the SAME tree-less CAS. Any recorded reason/handoff block stays
 * in the body as a durable note of what happened; the resolution itself is the
 * human's.
 *
 * The `requeue` verb's THREE behaviours (ADR §14 / slice
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
	// `work/observations/drive-backlog-skill-assumes-in-place-do-not-remote.md`).
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

	// Where is the item ON THE ARBITER? (We read the arbiter ref, NOT the cwd tree
	// — the cwd may be on a branch that never checked out the surfaced state.)
	// `requeue` recovers from BOTH `needs-attention/` (the resolved-surface path)
	// AND `in-progress/` (a claim that never surfaced: an un-surfaced abort, a
	// killed run, or an in-place requeue note — defect 2, story 4): both are
	// legitimate stuck states the conductor's recovery verb must recover from, via
	// the SAME tree-less CAS. We resolve the slug's ACTUAL current folder on the
	// arbiter (arbiter-is-truth) rather than assuming needs-attention/. Absent from
	// BOTH ⇒ nothing to requeue.
	const sourceRel = await resolveRequeueSourceRel(arbiter, slug, cwd, env);
	if (!sourceRel) {
		return {
			moved: false,
			reasonNotMoved:
				`'${slug}' is neither in work/needs-attention/ nor work/in-progress/ on ` +
				`${arbiter}/main — nothing to return to backlog (wrong slug, or already ` +
				'in backlog/done?). requeue recovers a slice stuck in needs-attention/ or ' +
				'in-progress/.',
		};
	}

	// `--reset`: DELETE the remote work branch FIRST (before the backlog move).
	// Delete-before-move closes the claim-race window. A FAILED delete ABORTS the
	// requeue (no backlog move) — the item stays in needs-attention rather than
	// become claimable while continuing from a branch we meant to discard. This is
	// a remote ref op (provider-agnostic; works against a local `--bare` arbiter) —
	// it never touches the cwd working tree.
	let deletedRemoteBranch = false;
	if (options.reset) {
		const branch = workBranchRef('slice', slug);
		// Explicit/guarded departure from the "never delete the remote branch"
		// invariant; only on the `--reset` path, never the default.
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
					'aborting the requeue — item left in needs-attention (no backlog move).';
				note(message);
				return {moved: false, reasonNotMoved: message};
			}
		}
		deletedRemoteBranch = true;
		note(`Deleted the remote branch ${branch} on ${arbiter} (--reset).`);
		// Drop any stale LOCAL work branch too (best-effort — it may not exist here).
		await gitSoftAsync(['branch', '-D', branch], cwd, env);
	}

	// DEFAULT (keep+continue) REQUEUE-SAFETY GUARD: a claimable item's continue-
	// branch MUST be reachable by ANY worker, so before moving the item back to
	// backlog verify the ARBITER branch `<arbiter>/work/<slug>` exists + is ahead
	// of main — the EXACT "is the continue-branch on the arbiter?" question the
	// continue-path asks in `isolation.ts`
	// (`branchAheadOf(checkout, '<arbiter>/<branch>', '<arbiter>/main')`). We check
	// the ARBITER ref (already fetched above), NOT the local `work/<slug>` (which
	// SURVIVES a failed push, so testing it would pass falsely). NOT on `--reset`
	// (which discards the branch by design).
	if (!options.reset) {
		const branch = workBranchRef('slice', slug);
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
				'`requeue --reset` to discard and start fresh. Item left in ' +
				'needs-attention (no backlog move).';
			note(message);
			return {moved: false, reasonNotMoved: message};
		}
	}

	const commitMessage = `chore(${slug}): return to backlog for re-claiming`;
	const message =
		options.message && options.message.trim() !== ''
			? options.message.trim()
			: undefined;

	// Build + CAS-push the move tree-lessly. Reuses the SHARED write-seam CAS
	// (`ledgerWrite.applyTransition`, the very push+lease+verify `claim` uses) —
	// NOT a second hand-rolled one. On a CONTENTION rejection (main advanced under
	// us) we refetch + rebuild against the new base and retry, exactly as `claim`
	// and the surface publish do.
	const contentionAttempts = 5;
	for (let i = 0; i < contentionAttempts; i++) {
		if (i > 0) {
			await gitSoftAsync(['fetch', '--quiet', arbiter], cwd, env);
		}
		const base = (
			await gitHardAsync(['rev-parse', `${arbiter}/main`], cwd, env)
		).stdout.trim();

		// Prepare the move as a commit OFF the arbiter's main, with PLUMBING on a
		// SCRATCH INDEX — never the caller's index/HEAD/working tree. One file is
		// relocated needs-attention/ → backlog/ (with the optional handoff note
		// appended to its BODY first). The commit lands under a throwaway local ref.
		const prepared = prepareReturnToBacklogCommit({
			cwd,
			slug,
			base,
			sourceRel,
			commitMessage,
			message,
			env,
		});

		// Publish THROUGH the shared seam (the same `:main` push + force-with-lease +
		// verify `claim` uses). The transition's WHO stays the caller's ambient env
		// (threaded by `commit-tree` above) — tree-less is orthogonal to attribution.
		const result = await ledgerWrite.applyTransition({
			kind: 'requeue',
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
			await gitSoftAsync(['fetch', '--quiet', arbiter], cwd, env);
			note(`Returned '${slug}' to backlog.`);
			return {moved: true, commitMessage, deletedRemoteBranch};
		}
		// rejected: main moved under us — refetch + rebuild against the new base.
		note(
			`main advanced under us — refetch and retry (${i + 1}/${contentionAttempts})...`,
		);
	}

	const message2 =
		`requeue for '${slug}': the arbiter's main kept moving (contended) after ` +
		`${contentionAttempts} attempts — item left in needs-attention (no move). ` +
		'Try again shortly.';
	note(message2);
	return {moved: false, reasonNotMoved: message2};
}

/**
 * Resolve the slug's ACTUAL current folder ON THE ARBITER for a requeue source
 * (arbiter-is-truth; we read the arbiter ref, not the cwd tree). `requeue`
 * recovers a slice stuck in `needs-attention/` (the resolved-surface path) OR in
 * `in-progress/` (a claim that never surfaced — an un-surfaced abort, a killed
 * run, or an in-place requeue note; defect 2, story 4). Returns the source
 * `work/<folder>/<slug>.md` rel path the move should relocate FROM, or
 * `undefined` when the slug is in NEITHER (nothing to requeue). `needs-attention/`
 * is probed first so a slice mid-transition that briefly appears in both resolves
 * to its surfaced state; in practice the one-slug-one-folder invariant means at
 * most one holds it.
 */
async function resolveRequeueSourceRel(
	arbiter: string,
	slug: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string | undefined> {
	for (const folder of ['needs-attention', 'in-progress']) {
		const rel = `work/${folder}/${slug}.md`;
		if (
			(
				await gitSoftAsync(
					['cat-file', '-e', `${arbiter}/main:${rel}`],
					cwd,
					env,
				)
			).status === 0
		) {
			return rel;
		}
	}
	return undefined;
}

/**
 * Build the return-to-backlog MOVE as a commit off the arbiter's `main`, using
 * PLUMBING on a SCRATCH INDEX — it never touches the caller's index, HEAD, or
 * working tree (so a concurrent writer's uncommitted cwd files can never be swept
 * in). It loads `base`'s tree into a throwaway index, relocates ONLY this slug's
 * ledger file from its CURRENT folder (`sourceRel` — `needs-attention/` OR
 * `in-progress/`, resolved on the arbiter) to `work/backlog/<slug>.md` (appending
 * the optional `-m` handoff note to its BODY first — read from the blob on `main`,
 * NOT from any cwd file), writes the tree, commits it parented on `base`, and
 * points a throwaway local ref at the commit. Returns that ref + the commit sha
 * for the seam's CAS push.
 */
function prepareReturnToBacklogCommit(params: {
	cwd: string;
	slug: string;
	base: string;
	sourceRel: string;
	commitMessage: string;
	message: string | undefined;
	env: NodeJS.ProcessEnv | undefined;
}): {ref: string; commit: string} {
	const {cwd, slug, base, sourceRel, commitMessage, message, env} = params;
	const backlogRel = `work/backlog/${slug}.md`;

	// The item's body on `main`, optionally with the dated handoff note appended.
	const original = catBlob(`${base}:${sourceRel}`, cwd, env);
	const content =
		message !== undefined ? appendRequeueNoteText(original, message) : original;
	// Hash the (possibly note-appended) blob INTO the cwd's object store. A blob
	// write does not touch the working tree.
	const blob = hashObject(content, cwd, env);

	// A scratch index so read-tree/update-index never disturb the caller's index.
	const scratchIndex = join(
		tmpdir(),
		`agent-runner-requeue-${process.pid}-${Date.now()}.index`,
	);
	const withIndex: NodeJS.ProcessEnv = {
		...(env ?? process.env),
		GIT_INDEX_FILE: scratchIndex,
	};
	try {
		gitHard(['read-tree', base], cwd, withIndex);
		// Remove the item from its current folder (needs-attention/ OR in-progress/),
		// add it under backlog/ (one file).
		gitHard(['update-index', '--force-remove', sourceRel], cwd, withIndex);
		gitHard(
			['update-index', '--add', '--cacheinfo', `100644,${blob},${backlogRel}`],
			cwd,
			withIndex,
		);
		const tree = runHard(['write-tree'], cwd, withIndex).stdout.trim();
		// commit-tree threads the caller's ambient identity (env) — the WHO is
		// unchanged from before (the human's, for `requeue`); tree-less only changed
		// the WHERE-it-writes (the arbiter ref, not the cwd tree).
		const commit = runHard(
			['commit-tree', tree, '-p', base, '-m', commitMessage],
			cwd,
			env,
		).stdout.trim();
		// A throwaway local ref the seam's push uses as its source (`<ref>:main`).
		const ref = `refs/agent-runner/requeue/${slug}`;
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
 * Resolve a stuck item back to `in-progress/` (the reverse of the
 * needs-attention move) so a human can pick it up again. The clean-up half of
 * the surfacing design (PRD `needs-attention-cherry-pick`): once a human starts
 * a stuck slice, the needs-attention surface must be CLEARED and the item
 * restored to in-progress. It `git mv work/needs-attention/<slug>.md →
 * work/in-progress/<slug>.md` and commits the MOVE-ONLY transition (the recorded
 * reason stays in the body as a durable note). Returns the move commit sha so a
 * surfacing strategy can publish the reverse move to clear the ledger surface.
 *
 * Like the other moves, NEVER throws for the expected "not in needs-attention"
 * case — it returns `{moved: false, reasonNotMoved}`.
 */
export function resolveFromNeedsAttention(
	options: ResolveFromNeedsAttentionOptions,
): ResolveFromNeedsAttentionResult {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	const naRel = join('work', 'needs-attention', `${slug}.md`);
	const naAbs = join(cwd, naRel);
	if (!existsSync(naAbs)) {
		return {
			moved: false,
			reasonNotMoved:
				`work/needs-attention/${slug}.md not found — nothing to resolve back ` +
				'to in-progress (wrong slug, or not in needs-attention?).',
		};
	}

	const destDir = join(cwd, 'work', 'in-progress');
	mkdirSync(destDir, {recursive: true});
	const destRel = join('work', 'in-progress', `${slug}.md`);
	gitHard(['mv', naRel, destRel], cwd, env);

	gitHard(['add', '-A'], cwd, env);
	const commitMessage = `chore(${slug}): resolve needs-attention; return to in-progress`;
	gitHard(['commit', '-q', '-m', commitMessage], cwd, env);
	const moveCommit = revParseHead(cwd, env);
	note(`Resolved '${slug}' from needs-attention back to in-progress.`);

	return {moved: true, commitMessage, moveCommit};
}

/**
 * List the `work/needs-attention/*.md` items for a repo with their recorded
 * reason — the "look here" surface `status` renders. Read-only; returns `[]`
 * when the folder is absent (the common case). Skipped by `scan`/eligibility for
 * claiming (those read only `work/backlog/`), this is the surface companion.
 */
export function readNeedsAttentionItems(
	repoPath: string,
): NeedsAttentionItem[] {
	// Resolve the needs-attention surface THROUGH the read seam's local-tree
	// method (offline). The seam returns each item's raw `content`; we extract the
	// reason prose here, exactly as the inline read did.
	const {needsAttention} = ledgerRead.resolveLocalState({repoPath});
	return needsAttention.map((item) => ({
		file: item.file,
		slug: item.slug,
		reason: extractReason(item.content),
	}));
}

/**
 * Append the reason (and any surfaced questions) to an item file as a body
 * block. We add ONLY to the body, never the frontmatter — state stays the folder
 * (WORK-CONTRACT rule 3); the reason is durable prose. A single trailing block
 * keeps it idempotent-ish and easy to read in `ls`/`status`.
 */
function appendReasonBlock(
	path: string,
	reason: string,
	questions: string[] | undefined,
): void {
	const current = readFileSync(path, 'utf8');
	// Ensure a clear separation from whatever the body ended with.
	const base = current.replace(/\s*$/, '');
	const block = reasonBlockText(reason, questions);
	// IDEMPOTENT re-surface: if the body ALREADY ends with this exact reason block
	// (the continue-conflict re-route of an item already in needs-attention with an
	// unchanged reason), do NOT append a duplicate — re-surfacing must not thrash the
	// file. The move-only commit then carries no content change (handled by
	// `--allow-empty` upstream).
	if (base.endsWith(block.replace(/\s*$/, ''))) {
		return;
	}
	writeFileSync(path, `${base}\n${block}`);
}

/**
 * The body block text for a reason (+ any surfaced questions), without the
 * leading separator. Shared by the append + the idempotent-re-surface guard so
 * the two agree byte-for-byte on what "the same reason block" is.
 */
function reasonBlockText(
	reason: string,
	questions: string[] | undefined,
): string {
	const lines: string[] = ['', REASON_HEADING, '', reason];
	if (questions && questions.length > 0) {
		lines.push('');
		lines.push('### Surfaced questions');
		lines.push('');
		for (const q of questions) {
			lines.push(`- ${q}`);
		}
	}
	lines.push('');
	return lines.join('\n');
}

/**
 * Extract the prose written under the `## Needs attention` heading — the reason
 * `status` surfaces. Returns the first non-empty line(s) of the block as a
 * single line (stops at the next `## ` heading); '' when no block is present.
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
