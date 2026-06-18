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
import {BOOKKEEPING_TRAILER} from './drop-bookkeeping-rebase.js';
import {releaseItemLock} from './item-lock.js';
import {ledgerRead} from './ledger-read.js';
import {ledgerWrite, type LedgerTransitionKind} from './ledger-write.js';
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
	// Stamp the durable `Agent-Runner-Bookkeeping: route-to-needs-attention` git
	// TRAILER on the move-only commit (a blank line separates it from the subject
	// so git parses it as a trailer, never as reason prose). This is the EXPLICIT,
	// version-stable mark the rebase drop identifies the commit by — it lives on
	// the commit OBJECT so it travels with the kept branch cross-machine. The
	// returned `commitMessage` keeps the human-facing subject (no trailer) for
	// reporting; the trailer is on the COMMIT, distinct from the reason prose.
	const commitBody = `${commitMessage}\n\n${BOOKKEEPING_TRAILER}`;
	// On a re-surface the reason block may already be present (idempotent append),
	// leaving NOTHING staged — a plain commit would error. `--allow-empty` keeps a
	// stable move-only tip to (re)publish, so re-surfacing never thrashes nor fails.
	const commitArgs = ['commit', '-q', '-m', commitBody];
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
		const branch = workBranchRef('slice', slug);
		// LOCAL-FIRST: the tracking ref `branchAheadOf` reads (the one whose
		// staleness today silently turns `--reset` into a no-op — verified live in
		// `work/observations/requeue-reset-does-not-prune-hub-mirror-stale-branch-ref.md`,
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
	const backlogRel = `work/backlog/${slug}.md`;

	// Build + CAS-push the move tree-lessly through the SHARED core (one mechanism
	// for BOTH the requeue direction here and the surface direction — see
	// {@link runTreelessLedgerMove}). On a CONTENTION rejection (main advanced under
	// us) it refetches + rebuilds against the new base and retries, exactly as
	// `claim` and the surface publish do.
	const moved = await runTreelessLedgerMove({
		cwd,
		slug,
		arbiter,
		kind: 'requeue',
		onContended: 'requeue',
		// requeue runs from the project checkout + needs ALL refs (the continue-branch
		// guard reads `<arbiter>/work/<slug>`), so a plain fetch (its own up-front
		// fetch above + the loop's) is correct here — not a main-only refspec.
		explicitMainRefspec: false,
		env,
		note,
		// Plan FRESH per attempt: the source `work/<folder>/<slug>.md` resolved at
		// the top may have moved if main advanced under us, so re-resolve on the
		// current base. Already-in-backlog ⇒ a prior attempt landed (idempotent).
		plan: (base) => {
			if (pathInCommit(base, backlogRel, cwd, env)) {
				return 'already-done';
			}
			const src = pathInCommit(base, sourceRel, cwd, env)
				? sourceRel
				: pathInCommit(base, `work/in-progress/${slug}.md`, cwd, env)
					? `work/in-progress/${slug}.md`
					: pathInCommit(base, `work/needs-attention/${slug}.md`, cwd, env)
						? `work/needs-attention/${slug}.md`
						: undefined;
			if (!src) {
				return 'missing';
			}
			return prepareTreelessMoveCommit({
				cwd,
				slug,
				base,
				sourceRel: src,
				destRel: backlogRel,
				// Append the optional dated handoff note to the item BODY before the move.
				transformBody: (body) =>
					message !== undefined ? appendRequeueNoteText(body, message) : body,
				commitMessage,
				refNamespace: 'requeue',
				env,
			});
		},
	});
	if (moved) {
		// INTERIM DUAL-WRITE complement of `claim` acquiring the per-item lock (PRD
		// `ledger-status-per-item-lock-refs`, slice
		// `claim-acquires-unified-lock-no-body-move`): returning the item to the
		// claimable pool GIVES UP the hold, so RELEASE the per-item lock the prior
		// claim took. Without this the lock would orphan and the re-claim would lose on
		// a stale lock from this item's OWN previous in-flight cycle. Best-effort +
		// idempotent (`not-held` when there is no lock, e.g. a requeue of an item that
		// predates the lock or was already released); the durable backlog move above is
		// the authoritative return-to-pool, the lock release just keeps the two
		// substrates in agreement. The held-lock state machine's own `requeue`/`release`
		// transitions are later slices; here we only undo claim's additive acquire.
		await releaseItemLock({item: `slice:${slug}`, cwd, arbiter, env});
		note(`Returned '${slug}' to backlog.`);
		return {moved: true, commitMessage, deletedRemoteBranch};
	}

	const message2 =
		`requeue for '${slug}': the arbiter's main kept moving (contended) after ` +
		`${TREELESS_CONTENTION_ATTEMPTS} attempts — item left in needs-attention ` +
		'(no move). Try again shortly.';
	note(message2);
	return {moved: false, reasonNotMoved: message2};
}

/**
 * **Promote a STAGED slice into the agent-eligible pool** (PRD
 * `staging-pool-position-gate-and-trust-model`, slice
 * `pre-backlog-staging-folder-and-promote-step-a`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). Moves
 * `work/pre-backlog/<slug>.md → work/backlog/<slug>.md` as a durable `main`
 * move, the same category as {@link returnToBacklog} (tree-less CAS via
 * {@link runTreelessLedgerMove}). After this transition the slice is in the
 * pool and claimable.
 *
 * **RUNNER/human-owned.** There is no agent-facing path that performs this:
 * the agent's slicing output lands STAGED in `work/pre-backlog/` (the runner's
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
	/** The slug of the staged slice to promote into the pool. */
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
	/** True iff the staged slice was moved into the pool + committed. */
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

	const sourceRel = `work/pre-backlog/${slug}.md`;
	const destRel = `work/backlog/${slug}.md`;

	// Early-exit message: if NEITHER staged nor already-in-pool, there is nothing
	// to promote (the per-attempt `plan` is the authoritative resolution against
	// the live base).
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
			`'${slug}' is not staged in work/pre-backlog/ on ${arbiter}/main (and not ` +
			'already in work/backlog/) — nothing to promote (wrong slug, or never ' +
			'staged?).';
		note(message);
		return {moved: false, reasonNotMoved: message};
	}

	const commitMessage = `chore(${slug}): promote work/pre-backlog/ -> work/backlog/`;
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
			// If already in the pool on this base, a prior attempt landed (idempotent).
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
				// The body is carried byte-for-byte from pre-backlog into the pool —
				// promotion is a placement decision, not a content transform.
				transformBody: (body) => body,
				commitMessage,
				refNamespace: 'promote',
				env,
			});
		},
	});
	if (moved) {
		note(`Promoted '${slug}' from pre-backlog to backlog (claimable).`);
		return {moved: true, commitMessage};
	}

	const message =
		`promote for '${slug}': the arbiter's main kept moving (contended) after ` +
		`${TREELESS_CONTENTION_ATTEMPTS} attempts — item left in pre-backlog (no ` +
		'move). Try again shortly.';
	note(message);
	return {moved: false, reasonNotMoved: message};
}

/**
 * **Promote a STAGED PRD into the auto-slice pool** (PRD
 * `staging-pool-position-gate-and-trust-model`, slice
 * `pre-prd-staging-pool-split-and-untrusted-prd-placement`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). The PRD
 * twin of {@link promoteFromPreBacklog}: moves
 * `work/pre-prd/<slug>.md → work/prd/<slug>.md` as a durable `main` move
 * (tree-less CAS via {@link runTreelessLedgerMove}). After this transition
 * the PRD is in the auto-slice POOL and eligible to be auto-sliced (subject
 * to the existing `autoSlice`/`humanOnly`/`needsAnswers`/`sliceAfter` gates,
 * which are UNCHANGED — the staging/pool split changes only WHICH folder is
 * the auto-slice pool, not the gates).
 *
 * **RUNNER/human-owned.** There is no agent-facing path that performs this:
 * `intake`'s `prd` dispatch lands the PRD STAGED in `work/pre-prd/` (the
 * runner's deterministic placement decision), and only a runner/human
 * invocation moves it into the pool. The agent does no git here, as
 * everywhere; this function is not reachable from any agent surface.
 *
 * Storage-agnostic + tree-less, exactly like {@link promoteFromPreBacklog}:
 * cwd index/HEAD/working tree are never touched, an arbiter remote is
 * REQUIRED, and "not in pre-prd/" / contention-exhausted cases are returned
 * (NEVER thrown) via `{moved: false, reasonNotMoved}` so callers branch
 * cleanly. Idempotent: re-running after the move LANDED is a no-op success.
 */
export interface PromoteFromPrePrdOptions {
	/** The working clone the move is originated from (origin source only; never written). */
	cwd: string;
	/** The slug of the staged PRD to promote into the pool. */
	slug: string;
	/** The arbiter remote the promotion is CAS-published to. REQUIRED. */
	arbiter: string;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface PromoteFromPrePrdResult {
	/** True iff the staged PRD was moved into the pool + committed. */
	moved: boolean;
	/** When `moved`, the committed transition message. */
	commitMessage?: string;
	/** When NOT moved, why (no such pre-prd item, already in prd/, contention). */
	reasonNotMoved?: string;
}

export async function promoteFromPrePrd(
	options: PromoteFromPrePrdOptions,
): Promise<PromoteFromPrePrdResult> {
	const note = options.note ?? (() => {});
	const {cwd, slug, env} = options;

	if (!options.arbiter) {
		return {
			moved: false,
			reasonNotMoved:
				`promote-prd for '${slug}' needs an --arbiter: the move is published as ` +
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

	const sourceRel = `work/pre-prd/${slug}.md`;
	const destRel = `work/prd/${slug}.md`;

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
			`'${slug}' is not staged in work/pre-prd/ on ${arbiter}/main (and not ` +
			'already in work/prd/) — nothing to promote (wrong slug, or never staged?).';
		note(message);
		return {moved: false, reasonNotMoved: message};
	}

	const commitMessage = `chore(${slug}): promote work/pre-prd/ -> work/prd/`;
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
				// The body is carried byte-for-byte from pre-prd into the pool —
				// promotion is a placement decision, not a content transform.
				transformBody: (body) => body,
				commitMessage,
				refNamespace: 'promote',
				env,
			});
		},
	});
	if (moved) {
		note(`Promoted PRD '${slug}' from pre-prd to prd (auto-sliceable).`);
		return {moved: true, commitMessage};
	}

	const message =
		`promote-prd for '${slug}': the arbiter's main kept moving (contended) ` +
		`after ${TREELESS_CONTENTION_ATTEMPTS} attempts — item left in pre-prd ` +
		'(no move). Try again shortly.';
	note(message);
	return {moved: false, reasonNotMoved: message};
}

/** One staged item awaiting promotion (a slice in `pre-backlog/` or a PRD in `pre-prd/`). */
export interface PromotableItem {
	/** `'slice'` (staged in `work/pre-backlog/`) or `'prd'` (staged in `work/pre-prd/`). */
	namespace: 'slice' | 'prd';
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
	/** Every staged item awaiting promotion, slices then PRDs, each sorted by slug. */
	items: PromotableItem[];
	/** When the listing could not run (no such remote), why. */
	error?: string;
}

/**
 * LIST every staged item awaiting a runner/human promotion — the slices in
 * `work/pre-backlog/` and the PRDs in `work/pre-prd/` on `<arbiter>/main` (the
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
	const slices = await listMarkdownSlugsInTree(
		`${arbiter}/main:work/pre-backlog`,
		cwd,
		env,
	);
	const prds = await listMarkdownSlugsInTree(
		`${arbiter}/main:work/pre-prd`,
		cwd,
		env,
	);
	return {
		items: [
			...slices.map((slug) => ({namespace: 'slice' as const, slug})),
			...prds.map((slug) => ({namespace: 'prd' as const, slug})),
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
		.filter((name) => name.toLowerCase().endsWith('.md'))
		.map((name) => name.replace(/\.md$/i, ''))
		.sort();
}

/**
 * Surface a stuck in-progress item to `needs-attention/` TREE-LESSLY — the
 * SURFACE-direction sibling of {@link returnToBacklog}, sharing its EXACT
 * tree-less recipe ({@link runTreelessLedgerMove}): fetch `<arbiter>/main`, build
 * the one-file `work/in-progress/<slug>.md → work/needs-attention/<slug>.md` move
 * (with the reason appended to its BODY) on a SCRATCH INDEX, point a throwaway
 * ref at the commit, and CAS-publish it via `ledgerWrite.applyTransition` —
 * touching NO worktree/HEAD/index. The reverse of `requeue`'s tree-less move, the
 * same mechanism.
 *
 * The home for the AFTER-COMMIT, LEDGER-ONLY surfaces (continue-push-failure +
 * continue-rebase-conflict): the work is ALREADY committed on the kept
 * `work/<slug>` branch (intact on the arbiter, recoverable), so the surface is
 * PURELY the one-file ledger move + reason — it needs no `pushBranch` and no
 * checkout. It is NOT for the wip-save / gate-failed / agent-failed surfaces,
 * which may carry UN-committed work that needs the cwd commit path
 * ({@link routeToNeedsAttention}); the tree-less move only relocates a committed
 * `.md`.
 *
 * REQUIRES an arbiter (the tree-less CAS needs a ref to push to). NEVER throws
 * for the expected "not on the arbiter" / contention-exhausted cases — it returns
 * `{moved: false, reasonNotMoved}`.
 */
export async function surfaceToNeedsAttention(
	options: SurfaceToNeedsAttentionOptions,
): Promise<SurfaceToNeedsAttentionResult> {
	const note = options.note ?? (() => {});
	const {cwd, slug, reason, questions, env} = options;

	if (!options.arbiter) {
		return {
			moved: false,
			reasonNotMoved:
				`surface for '${slug}' needs an --arbiter: the move is published as a ` +
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

	// Refresh the remote-tracking `<arbiter>/main` so the source-residence probe +
	// the CAS base see the arbiter's TRUTH. EXPLICIT refspec
	// (`+refs/heads/main:refs/remotes/<arbiter>/main`): the surface runs from a JOB
	// WORKTREE whose remote may not map `main → refs/remotes/<arbiter>/main` under a
	// plain fetch (a bare-mirror worktree), so we name it (mirrors
	// `publishSurfaceCommit`). A fetch, not a checkout — the working tree is untouched.
	await gitSoftAsync(
		[
			'fetch',
			'--quiet',
			arbiter,
			`+refs/heads/main:refs/remotes/${arbiter}/main`,
		],
		cwd,
		env,
	);

	// Probe up front purely for the EARLY-EXIT message (the per-attempt `plan` is
	// the authoritative resolution against the live base). At the after-commit
	// surface sites the claim landed, so the item is in `in-progress/`; an
	// `needs-attention/` source is an IDEMPOTENT re-surface. Absent from BOTH ⇒
	// nothing to surface.
	const sourceRel = await resolveSurfaceSourceRel(arbiter, slug, cwd, env);
	if (!sourceRel) {
		const message =
			`'${slug}' is neither in work/in-progress/ nor work/needs-attention/ on ` +
			`${arbiter}/main — nothing to surface to needs-attention (wrong slug, or ` +
			'not claimed?).';
		note(message);
		return {moved: false, reasonNotMoved: message};
	}
	const destRel = `work/needs-attention/${slug}.md`;
	const inProgressRel = `work/in-progress/${slug}.md`;

	const commitMessage = `chore(${slug}): route to needs-attention; ${reason}`;
	// The message handed to `commit-tree` carries the durable
	// `Agent-Runner-Bookkeeping: route-to-needs-attention` git TRAILER (blank line
	// before it so git parses it as a trailer, distinct from the reason prose) —
	// the SAME mark the in-worktree author site stamps, so BOTH move-only author
	// sites produce a trailer'd commit the rebase drop identifies by plumbing
	// (never by the version-unstable rendered todo). The returned `commitMessage`
	// stays the bare subject for reporting; the trailer lives on the COMMIT.
	const commitBody = `${commitMessage}\n\n${BOOKKEEPING_TRAILER}`;
	// Append the reason (+ any surfaced questions) to the item BODY before the move
	// — the PURE-string sibling of `appendReasonBlock`, applied to the blob read off
	// `<arbiter>/main` (never a cwd file). Idempotent on a re-surface whose body
	// already ends with this exact reason block.
	const transformBody = (body: string): string =>
		appendReasonBlockText(body, reason, questions);
	const moved = await runTreelessLedgerMove({
		cwd,
		slug,
		arbiter,
		kind: 'needs-attention',
		onContended: 'surface',
		// The surface runs from a job worktree; name the main refspec so
		// `<arbiter>/main` resolves even when the remote's default refspec does not
		// map it (a bare-mirror worktree).
		explicitMainRefspec: true,
		env,
		note,
		// Plan FRESH per attempt against the live base. If the item is ALREADY at the
		// destination with the reason block present, a prior attempt landed (or it is
		// an idempotent re-surface) → done, no push (never thrash the file). Otherwise
		// move from wherever it currently is (in-progress, OR needs-attention for an
		// idempotent reason-refresh) to needs-attention with the reason appended.
		plan: (base) => {
			const atDest = pathInCommit(base, destRel, cwd, env);
			const src = atDest
				? destRel
				: pathInCommit(base, inProgressRel, cwd, env)
					? inProgressRel
					: undefined;
			if (!src) {
				return 'missing';
			}
			if (atDest) {
				// Already surfaced: skip if the reason block is already present (the
				// idempotent re-surface), else refresh the body in place at dest.
				const body = catBlob(`${base}:${destRel}`, cwd, env);
				if (transformBody(body) === body) {
					return 'already-done';
				}
			}
			return prepareTreelessMoveCommit({
				cwd,
				slug,
				base,
				sourceRel: src,
				destRel,
				transformBody,
				// The trailer'd message (subject + Agent-Runner-Bookkeeping trailer) is
				// what gets committed; the bare `commitMessage` is returned for reporting.
				commitMessage: commitBody,
				refNamespace: 'surface',
				env,
			});
		},
	});
	if (moved) {
		note(`Surfaced '${slug}' to needs-attention: ${reason}`);
		return {moved: true, commitMessage};
	}

	const message2 =
		`surface for '${slug}': the arbiter's main kept moving (contended) after ` +
		`${TREELESS_CONTENTION_ATTEMPTS} attempts — item left in in-progress (no ` +
		'surface). Try again shortly.';
	note(message2);
	return {moved: false, reasonNotMoved: message2};
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
 * Resolve the slug's ACTUAL current folder ON THE ARBITER for a SURFACE source
 * (arbiter-is-truth; we read the arbiter ref, not the cwd tree). The after-commit
 * surface sites have a landed claim, so the item is in `in-progress/`; an
 * `needs-attention/` source is an IDEMPOTENT re-surface (the
 * continue-rebase-conflict re-route of an item the arbiter already shows
 * surfaced). Returns the source `work/<folder>/<slug>.md` rel path, or `undefined`
 * when the slug is in NEITHER. `in-progress/` is probed FIRST (the common landed-
 * claim case); the one-slug-one-folder invariant means at most one holds it.
 */
async function resolveSurfaceSourceRel(
	arbiter: string,
	slug: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string | undefined> {
	for (const folder of ['in-progress', 'needs-attention']) {
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
		`agent-runner-${refNamespace}-${process.pid}-${Date.now()}.index`,
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
		const ref = `refs/agent-runner/${refNamespace}/${slug}`;
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
	writeFileSync(path, appendReasonBlockText(current, reason, questions));
}

/**
 * Append the reason (+ any surfaced questions) to an item body's TEXT — the
 * PURE-string sibling of {@link appendReasonBlock} (it operates on body CONTENT,
 * not a file path), so the tree-less surface can apply it to the blob read off
 * `<arbiter>/main` without touching the cwd working tree. IDEMPOTENT: if the body
 * ALREADY ends with this exact reason block (a re-surface with an unchanged
 * reason), it returns the body unchanged — re-surfacing must not thrash the file
 * nor accrete duplicate blocks. Shared by both the cwd-bound and tree-less paths
 * so the two agree byte-for-byte on what "the same reason block" is.
 */
function appendReasonBlockText(
	content: string,
	reason: string,
	questions: string[] | undefined,
): string {
	// Ensure a clear separation from whatever the body ended with.
	const base = content.replace(/\s*$/, '');
	const block = reasonBlockText(reason, questions);
	// IDEMPOTENT re-surface: if the body ALREADY ends with this exact reason block
	// (the continue-conflict re-route of an item already in needs-attention with an
	// unchanged reason), do NOT append a duplicate — re-surfacing must not thrash the
	// file. The move-only commit then carries no content change.
	if (base.endsWith(block.replace(/\s*$/, ''))) {
		return content;
	}
	return `${base}\n${block}`;
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
