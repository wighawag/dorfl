import {rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run, runAsync, type RunResult} from './git.js';
import {
	Integrator,
	type IntegrateResult,
	type ReviewProvider,
} from './integrator.js';
import type {IntegrationMode} from './config.js';
import {
	routeToNeedsAttention,
	returnToBacklog,
	resolveFromNeedsAttention,
	type RouteToNeedsAttentionOptions,
	type RouteToNeedsAttentionResult,
	type ReturnToBacklogOptions,
	type ReturnToBacklogResult,
	type ResolveFromNeedsAttentionOptions,
	type ResolveFromNeedsAttentionResult,
} from './needs-attention.js';

/**
 * The **write half** of the ledger-transition seam (ADR
 * `docs/adr/claim-ledger-vs-protected-main.md`, status: accepted — the "Write
 * seam"). ONE entry point — "apply this `work/` transition" — that every
 * transition (claim / complete / needs-attention) routes through, so a FUTURE
 * strategy could publish a transition elsewhere (e.g. a dedicated `main`-free
 * ledger ref) without the transition call sites learning a new mechanism.
 *
 * It is a PURE REFACTOR: there is exactly ONE strategy ({@link
 * currentLedgerWrite}) and it does EXACTLY what the code did before — it
 * CAS-publishes the prepared transition commit to the arbiter's `main` with
 * `--force-with-lease` and then verifies `<arbiter>/main` is now that commit. No
 * mode, no config, no `ledgerMode`, no new ref.
 *
 * The seam stays at the SEMANTIC level: the caller hands the seam a *prepared*
 * transition (a local branch carrying the commit, the base the ledger must still
 * be at for the CAS, and the commit it expects to land) plus the transition
 * KIND, and asks the seam to publish it. The public input is storage-agnostic —
 * it does NOT name `main`; that `main` is the publish/verify target is an
 * implementation detail of the sole strategy below.
 *
 * This slice routes the CLAIM transition through the seam (see `claim-cas.ts`).
 * The `complete` and `needs-attention` kinds are named here so the companion
 * slices route through the SAME entry point; they are not yet wired.
 *
 * The NEEDS-ATTENTION transition is wired here too: the abort paths in
 * `complete.ts` (red gate, rebase conflict), the runner's stuck routing in
 * `run.ts`, and the human `return` command all drive the
 * `* → needs-attention` move (and its `needs-attention → backlog` re-queue)
 * through this SAME seam rather than calling the move helpers directly. The
 * sole strategy delegates to the folder-native mechanism in
 * `needs-attention.ts` UNCHANGED (reason-in-the-body — WORK-CONTRACT rule 3,
 * bounce from in-progress OR done, ONE atomic commit, optional branch push); the
 * seam only relocates WHERE the "apply the needs-attention transition" call is
 * expressed, so the later cherry-pick-to-`main` surfacing is built AGAINST the
 * seam, not bolted onto the move code.
 */

/**
 * The `work/` lifecycle transitions the write seam can apply.
 *
 * `slicing` is the **slicing-lock** transition (ADR `auto-slice`): it races a
 * `git mv work/prd/<slug>.md → work/slicing/<slug>.md` micro-commit to the
 * arbiter via the SAME CAS the `claim` transition uses, so two concurrent slicers
 * never double-slice one PRD. Like `claim` it rides {@link applyTransition} (the
 * publish/lease is identical); it is a distinct KIND only so the lock is
 * self-documenting and uses a non-colliding branch name (see
 * `slicing-lock.ts`). `work/slicing/` is a TRANSIENT held lock, not a resting
 * state — release returns the PRD to `work/prd/`.
 */
export type LedgerTransitionKind =
	| 'claim'
	| 'complete'
	| 'needs-attention'
	| 'slicing';

/**
 * A *prepared* COMPLETE transition the caller asks the seam to publish: a
 * finished work branch whose code should be integrated back to the arbiter. Like
 * {@link ApplyTransitionInput} it is storage-agnostic — it names the work branch
 * + the integration MODE + the review provider, NOT *where* the integration
 * lands (the sole strategy decides that; today `merge` ff's to the arbiter's
 * `main`, `propose` pushes the branch + requests review). The caller has already
 * done the gate / done-move / commit / rebase-onto-arbiter — the seam only
 * APPLIES the integration of that prepared branch.
 */
export interface ApplyCompleteTransitionInput {
	/** Name of the arbiter git remote the integration is published to. */
	arbiter: string;
	/** The prepared (gated, committed, rebased) work branch to integrate. */
	branch: string;
	/** Integration mode: `merge` (ff to the ledger) or `propose` (push + review). */
	mode: IntegrationMode;
	/** The review-request provider (propose mode); push-only `none` otherwise. */
	provider: ReviewProvider;
	/**
	 * Optional single-line review-request TITLE (propose mode), threaded straight
	 * to the provider. Absent ⇒ the provider's `--fill` default (no regression).
	 */
	title?: string;
	/**
	 * Optional review-request BODY (propose mode) — advisory prose, gates nothing —
	 * threaded straight to the provider. Absent ⇒ the provider's `--fill` default.
	 */
	body?: string;
	/** Working clone/worktree the integration runs in. */
	cwd: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
}

/**
 * The outcome of asking the seam to apply (publish) a prepared COMPLETE
 * transition. It is exactly the integration result the {@link Integrator}
 * produces — the seam adds NO interpretation, it only relocates WHERE the
 * "apply the complete transition" call is expressed.
 */
export type ApplyCompleteTransitionResult = IntegrateResult;

/**
 * A *prepared* NEEDS-ATTENTION transition the caller asks the seam to apply: a
 * stuck claimed item to bounce to `work/needs-attention/` with its reason. Like
 * the other inputs it is storage-agnostic — it names the slug, the reason prose,
 * any surfaced questions, and an OPTIONAL arbiter to also push the branch to,
 * NOT *where* the move commits/publishes (the sole strategy decides that: a
 * `git mv` from whichever of in-progress/ or done/ holds the item, the
 * reason-in-the-body, the ONE atomic commit, the optional branch push). This
 * mirrors {@link RouteToNeedsAttentionOptions} so the move mechanism is unchanged.
 */
export type ApplyNeedsAttentionTransitionInput = RouteToNeedsAttentionOptions;

/**
 * The outcome of asking the seam to apply a NEEDS-ATTENTION transition — exactly
 * the move result the folder-native mechanism produces. The seam adds NO
 * interpretation; it only relocates WHERE the call is expressed.
 */
export type ApplyNeedsAttentionTransitionResult = RouteToNeedsAttentionResult;

/**
 * A *prepared* RETURN-TO-BACKLOG transition: re-queue a resolved
 * needs-attention item so it can be re-claimed (the `needs-attention → backlog`
 * re-queue half of the needs-attention mechanism). Storage-agnostic, mirroring
 * {@link ReturnToBacklogOptions}.
 */
export type ApplyReturnToBacklogTransitionInput = ReturnToBacklogOptions;

/** The outcome of asking the seam to apply a RETURN-TO-BACKLOG transition. */
export type ApplyReturnToBacklogTransitionResult = ReturnToBacklogResult;

/**
 * A *prepared* RESOLVE-NEEDS-ATTENTION transition: a human is picking up a stuck
 * item, so the seam must **clear the stuck surface** and restore the item to
 * `in-progress`. Storage-agnostic, mirroring {@link
 * ResolveFromNeedsAttentionOptions} — it names the slug + the working clone (and
 * an OPTIONAL arbiter to clear the surface on), NOT *where* the surface lives.
 * The mode-M strategy implements "clear the surface" by reverse-moving
 * needs-attention → in-progress on the arbiter's `main`; a future strategy could
 * clear it elsewhere without `start.ts` learning a new mechanism.
 */
export type ApplyResolveNeedsAttentionTransitionInput =
	ResolveFromNeedsAttentionOptions & {
		/**
		 * The arbiter remote whose ledger surface to CLEAR (mode M: the reverse move
		 * is published to its `main`). Omitted ⇒ the local move only (no surface to
		 * clear). Storage-agnostic: it names the remote, not `main`.
		 */
		arbiter?: string;
	};

/** The outcome of asking the seam to apply a RESOLVE-NEEDS-ATTENTION transition. */
export type ApplyResolveNeedsAttentionTransitionResult =
	ResolveFromNeedsAttentionResult;

/**
 * A *prepared* transition the caller asks the seam to publish. Storage-agnostic:
 * it describes the transition semantically (a kind + a prepared local commit +
 * the CAS lease), NOT *where* it should be published. The sole strategy decides
 * that (today: the arbiter's `main`).
 */
export interface ApplyTransitionInput {
	/** Which `work/` transition this is (claim / complete / needs-attention). */
	kind: LedgerTransitionKind;
	/** Name of the arbiter git remote the transition is published to. */
	arbiter: string;
	/** Local branch carrying the prepared transition commit (its tip = {@link head}). */
	localBranch: string;
	/**
	 * The ledger commit the publish must be a fast-forward FROM — the
	 * compare-and-swap lease. If the ledger has moved past this, the publish is
	 * rejected (someone else advanced it under us).
	 */
	expectedBase: string;
	/** The commit sha the caller expects to become the ledger tip after publish. */
	head: string;
	/** Working clone/worktree the publish runs in. */
	cwd: string;
	/** Show the intended publish without mutating the arbiter (dry-run). */
	dryRun?: boolean;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/** The outcome of asking the seam to publish a prepared transition. */
export interface ApplyTransitionResult {
	/**
	 * `published` — the transition landed (and was verified to be the ledger tip).
	 * `rejected` — the CAS lease failed (the ledger moved under us); the caller
	 * decides whether to refetch+retry or give up. The seam never throws for this
	 * expected contended case.
	 */
	kind: 'published' | 'rejected';
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/**
 * The write-seam interface: ONE entry point — apply (publish) a prepared `work/`
 * transition. A future strategy implements this same interface to publish the
 * transition elsewhere — without any transition call site changing.
 */
export interface LedgerWriteStrategy {
	applyTransition(input: ApplyTransitionInput): Promise<ApplyTransitionResult>;
	/**
	 * Apply (publish) a prepared COMPLETE transition: integrate a finished work
	 * branch back to the arbiter per its mode. The sole strategy delegates to the
	 * integration mechanism unchanged; a future strategy could integrate elsewhere
	 * without `complete.ts` changing.
	 */
	applyCompleteTransition(
		input: ApplyCompleteTransitionInput,
	): ApplyCompleteTransitionResult;
	/**
	 * Apply a NEEDS-ATTENTION transition: bounce a stuck claimed item to
	 * `work/needs-attention/` with its reason recorded in the body. The sole
	 * strategy delegates to the folder-native move mechanism unchanged; a future
	 * strategy could surface the stuck item elsewhere (e.g. the cherry-pick-to-
	 * `main` follow-on) without `complete.ts`/`run.ts` changing.
	 */
	applyNeedsAttentionTransition(
		input: ApplyNeedsAttentionTransitionInput,
	): ApplyNeedsAttentionTransitionResult;
	/**
	 * Apply a RETURN-TO-BACKLOG transition: re-queue a resolved needs-attention
	 * item for re-claiming. The re-queue half of the needs-attention mechanism,
	 * routed through the SAME seam.
	 */
	applyReturnToBacklogTransition(
		input: ApplyReturnToBacklogTransitionInput,
	): ApplyReturnToBacklogTransitionResult;
	/**
	 * Apply a RESOLVE-NEEDS-ATTENTION transition: a human is picking up a stuck
	 * item, so **clear the stuck surface** and restore it to `in-progress`. The
	 * seam carries only that INTENT — "clear the surface" — NOT *how*; the sole
	 * (mode-M) strategy clears it by reverse-moving needs-attention → in-progress
	 * on the arbiter's `main`, but a future strategy could clear it differently
	 * without `start.ts` changing.
	 */
	applyResolveNeedsAttentionTransition(
		input: ApplyResolveNeedsAttentionTransitionInput,
	): ApplyResolveNeedsAttentionTransitionResult;
}

// --- The sole strategy: exactly today's behaviour -------------------------

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

/**
 * The ONLY ledger-write strategy: current behaviour. It CAS-publishes the
 * prepared transition commit to the arbiter's `main` — the `main` push and the
 * `--force-with-lease=main:<base>` lease live HERE, not in the public input — and
 * verifies the arbiter's `main` is now that commit (guarding against an
 * "Everything up-to-date" push masquerading as a successful transition). A future
 * strategy would be a different object implementing the same interface — chosen
 * NOWHERE today (no mode/config selects it).
 */
export const currentLedgerWrite: LedgerWriteStrategy = {
	async applyTransition({
		arbiter,
		localBranch,
		expectedBase,
		head,
		cwd,
		dryRun,
		env,
		note,
	}): Promise<ApplyTransitionResult> {
		const emit = note ?? (() => {});

		if (dryRun) {
			const message = `[dry-run] would: git push ${arbiter} ${localBranch}:main --force-with-lease=main:${expectedBase}`;
			emit(message);
			return {kind: 'published', message};
		}

		// The atomic compare-and-swap. --force-with-lease=main:<base> asserts the
		// arbiter's main is STILL <base> (unchanged since our fetch); the push then
		// fast-forwards main to our commit. If main moved, the lease fails → rejected.
		const push = await gitSoft(
			[
				'push',
				arbiter,
				`${localBranch}:main`,
				`--force-with-lease=main:${expectedBase}`,
			],
			cwd,
			env,
		);
		if (push.status === 0) {
			// Verify the arbiter main now points at OUR commit (not merely "up-to-date").
			await gitHard(['fetch', '--quiet', arbiter], cwd, env);
			const arbiterHead = (
				await gitHard(['rev-parse', `${arbiter}/main`], cwd, env)
			).stdout.trim();
			if (arbiterHead === head) {
				return {kind: 'published', message: 'transition published'};
			}
			emit(
				`push reported success but ${arbiter}/main is not our commit — treating as rejected.`,
			);
		}
		return {kind: 'rejected', message: 'push rejected / lease failed'};
	},

	/**
	 * The complete transition under the SAME strategy: integrate the prepared work
	 * branch back to the arbiter exactly as `complete.ts` did before — it builds
	 * the {@link Integrator} with the chosen provider and calls `integrate` (the
	 * branch was already rebased onto the latest arbiter ledger by the caller, so
	 * this is the non-rebasing `integrate`, never `--force`). `merge` ff's the
	 * branch to the arbiter's `main`; `propose` pushes the branch + asks the
	 * provider to request review. That `merge` targets `main` is an implementation
	 * detail of THIS strategy — the public input never names it.
	 */
	applyCompleteTransition({
		arbiter,
		branch,
		mode,
		provider,
		title,
		body,
		cwd,
		env,
	}): ApplyCompleteTransitionResult {
		const integrator = new Integrator({provider});
		return integrator.integrate({cwd, arbiter, branch, mode, title, body, env});
	},

	/**
	 * The needs-attention transition under the SAME strategy. The seam's contract
	 * is transition-kind-agnostic: durably record a stuck job =
	 *
	 *   - **OBSERVABLE** — publish the stuck state to the ledger surface so
	 *     `scan`/`status`/a fresh checkout/another machine can see it. (THIS mode-M
	 *     strategy does that by CHERRY-PICKING the move-only commit — the reason +
	 *     the `git mv` — onto the arbiter's `main`, all-or-nothing, never `--force`d,
	 *     so the half-finished wip below it never lands there. A future mode-P
	 *     strategy could make it observable WITHOUT writing `main`, e.g. by reading
	 *     work-branch tips.)
	 *   - **RECOVERABLE** — push the work branch (when there IS one), so the saved
	 *     work travels cross-machine and a requeue continues from its tip. (Mode M
	 *     does that by `git push`ing the branch; the WHICH branch is the caller's,
	 *     not assumed `work/<slug>` — a build bounce pushes `work/<slug>`, a slicing
	 *     bounce its `work/slicing/<slug>`, a temp-branch caller pushes NOTHING.)
	 *
	 * Both halves are ONE operation done in ONE place: it delegates to {@link
	 * routeToNeedsAttention}, which appends the reason as body prose (never a
	 * frontmatter field — WORK-CONTRACT rule 3), saves the aborted work as a
	 * **wip** commit, `git mv`s the item to `work/needs-attention/` as the
	 * **move-only** commit (the tip), and — when an `arbiter` is given — pushes the
	 * work branch (best-effort, branch-parameterised, emptiness-guarded; SURFACE-
	 * ONLY when `pushBranch: false`). The seam does NOT strip the arbiter: the same
	 * arbiter both publishes the surface (here) AND drives the helper's branch push,
	 * so "record stuck" and "save the work" can never drift apart. The human-vs-
	 * autonomous gate rides on whether an `arbiter` is given at all (human
	 * `complete` passes none → no surface, no push, local-only; autonomous `do`/`run`
	 * pass it → both).
	 */
	applyNeedsAttentionTransition(
		input: ApplyNeedsAttentionTransitionInput,
	): ApplyNeedsAttentionTransitionResult {
		// Route WITH the arbiter intact so the helper's (best-effort, branch-
		// parameterised, emptiness-guarded) RECOVERABLE push fires — the one home for
		// the push. The OBSERVABLE surface is published below from the same arbiter.
		const result = routeToNeedsAttention(input);
		if (result.moved && result.moveCommit && input.arbiter) {
			// Make the stuck state observable on the ledger (mode M): publish ONLY the
			// move-only commit (the reason + the git mv) to the arbiter's main, so the
			// half-finished wip below it never lands there.
			publishSurfaceCommit({
				cwd: input.cwd,
				arbiter: input.arbiter,
				slug: input.slug,
				moveCommit: result.moveCommit,
				env: input.env,
				note: input.note,
			});
		}
		return result;
	},

	/**
	 * The return-to-backlog transition under the SAME strategy: re-queue the
	 * resolved item exactly as before by delegating to {@link returnToBacklog}
	 * (`git mv work/needs-attention/<slug>.md → work/backlog/<slug>.md`, commit,
	 * optional push).
	 */
	applyReturnToBacklogTransition(
		input: ApplyReturnToBacklogTransitionInput,
	): ApplyReturnToBacklogTransitionResult {
		return returnToBacklog(input);
	},

	/**
	 * The resolve-needs-attention transition under the SAME strategy — satisfying
	 * the INTENT "clear the stuck surface + restore in-progress." It delegates to
	 * {@link resolveFromNeedsAttention} (reverse `git mv` needs-attention →
	 * in-progress, committed) and, when an `arbiter` is given, publishes that
	 * reverse move-only commit to the arbiter's `main` — CLEARING the stuck surface
	 * there (the item is back in in-progress on the ledger). Same all-or-nothing,
	 * never-`--force` publish. "Reverse-move on `main`" is a detail of THIS
	 * strategy; the seam's contract is only the intent "clear the surface."
	 */
	applyResolveNeedsAttentionTransition(
		input: ApplyResolveNeedsAttentionTransitionInput,
	): ApplyResolveNeedsAttentionTransitionResult {
		const result = resolveFromNeedsAttention(input);
		if (result.moved && result.moveCommit && input.arbiter) {
			publishSurfaceCommit({
				cwd: input.cwd,
				arbiter: input.arbiter,
				slug: input.slug,
				moveCommit: result.moveCommit,
				env: input.env,
				note: input.note,
			});
		}
		return result;
	},
};

/** The `work/` folders a slug's ledger file can live in, on `main`. */
const WORK_FOLDERS = ['backlog', 'in-progress', 'done', 'needs-attention'];

/**
 * Publish the EFFECT of a single MOVE-ONLY commit (a `work/` ledger move — a
 * route-to-needs-attention or its reverse) onto the arbiter's `main`, so the
 * stuck state is observable there (mode M). It reproduces the move-only commit's
 * placement of the slug's ledger file (which `work/<folder>/<slug>.md` it lands
 * in, with what body — including the recorded reason) ON TOP of the freshly-
 * fetched `<arbiter>/main`, and fast-forward pushes it. ONLY that one ledger file
 * is touched, so the half-finished wip / the conflicting code never reach `main`.
 *
 * It is built with plumbing on a SCRATCH INDEX (`git read-tree` + `update-index`
 * + `commit-tree`), so it NEVER touches the caller's working tree or HEAD — safe
 * to call from a job worktree mid-flight or from the human's checkout. It is
 * ALL-OR-NOTHING: it computes the full surface commit before pushing, and on any
 * failure pushes nothing (no half-surfaced state). A concurrent advance of `main`
 * is retried a few times (refetch + rebuild against the new base). The push uses
 * `--force-with-lease=main:<base>` (a true fast-forward of the fresh surface
 * commit; the lease guards the CAS) — NEVER a plain `--force` to `main`.
 *
 * Reproducing the move from `main`'s OWN state (not literally cherry-picking the
 * commit) is what makes it robust across both stuck paths: the gate-failed path's
 * commit moves `in-progress → needs-attention` while the rebase-conflict path's
 * moves `done → needs-attention`, but on `main` the item is always in
 * `in-progress/` (the done-move never reached `main`), so we always relocate from
 * wherever it actually is on `main` to the target folder the move-only commit
 * chose.
 *
 * This is the mode-M MECHANISM, deliberately living inside the strategy — NOT in
 * the seam's public contract: a future mode-P strategy would make the same stuck
 * state observable WITHOUT writing `main` (e.g. reading work-branch tips).
 */
function publishSurfaceCommit(params: {
	cwd: string;
	arbiter: string;
	slug: string;
	moveCommit: string;
	env?: NodeJS.ProcessEnv;
	note?: (message: string) => void;
}): void {
	const {cwd, arbiter, slug, moveCommit, env} = params;
	const emit = params.note ?? (() => {});
	const gx = (args: string[], input?: string): RunResult =>
		run('git', args, cwd, {env, input});
	const gxHard = (args: string[], input?: string): RunResult => {
		const r = gx(args, input);
		if (r.status !== 0) {
			throw new Error(
				`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`,
			);
		}
		return r;
	};

	// Where the slug's ledger file lands AFTER the move (per the move-only commit's
	// tree) — the placement we mirror onto main. Exactly one of WORK_FOLDERS holds
	// it; we read its path + content from the commit's tree (plumbing, no checkout).
	const target = readLedgerPlacement(gx, moveCommit, slug);
	if (!target) {
		emit('could not resolve the surfaced ledger file from the move commit.');
		return;
	}

	// A scratch index so update-index/write-tree never disturb the caller's index.
	const scratchIndex = join(
		tmpdir(),
		`agent-runner-surface-${process.pid}-${Date.now()}.index`,
	);
	const withIndex: NodeJS.ProcessEnv = {
		...(env ?? process.env),
		GIT_INDEX_FILE: scratchIndex,
	};
	const sx = (args: string[], input?: string): RunResult =>
		run('git', args, cwd, {env: withIndex, input});
	const sxHard = (args: string[], input?: string): RunResult => {
		const r = sx(args, input);
		if (r.status !== 0) {
			throw new Error(
				`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`,
			);
		}
		return r;
	};

	const attempts = 5;
	try {
		for (let i = 0; i < attempts; i++) {
			gxHard([
				'fetch',
				'--quiet',
				arbiter,
				`+refs/heads/main:refs/remotes/${arbiter}/main`,
			]);
			const base = gxHard(['rev-parse', `${arbiter}/main`]).stdout.trim();

			// Load main's tree into the scratch index, then relocate ONLY this slug's
			// ledger file to the target folder (remove it from every other work folder,
			// write the move commit's blob at the target path). One file changes.
			rmSync(scratchIndex, {force: true});
			sxHard(['read-tree', base]);
			for (const folder of WORK_FOLDERS) {
				const path = `work/${folder}/${slug}.md`;
				if (path !== target.path) {
					// Remove if present (force-remove tolerates an absent path).
					sx(['update-index', '--force-remove', path]);
				}
			}
			sxHard([
				'update-index',
				'--add',
				'--cacheinfo',
				`100644,${target.blob},${target.path}`,
			]);
			const tree = sxHard(['write-tree']).stdout.trim();
			const commit = gxHard([
				'commit-tree',
				tree,
				'-p',
				base,
				'-m',
				target.message,
			]).stdout.trim();

			// Fast-forward push the surface commit to main (the lease guards the CAS).
			// NEVER a plain --force.
			const push = gx([
				'push',
				arbiter,
				`${commit}:main`,
				`--force-with-lease=main:${base}`,
			]);
			if (push.status === 0) {
				emit(`Surfaced the stuck state on ${arbiter}/main.`);
				return;
			}
			// Contended: someone advanced main. Loop to refetch + rebuild against it.
		}
		emit(
			`could not surface the stuck state on ${arbiter}/main after ${attempts} ` +
				'attempts (main kept moving) — left unsurfaced.',
		);
	} finally {
		rmSync(scratchIndex, {force: true});
	}
}

/**
 * Read, from a move-only commit's tree, WHICH `work/<folder>/<slug>.md` the slug
 * lands in, plus that file's blob sha + a surface commit message. Returns
 * `undefined` if the slug's ledger file is not found (nothing to surface). The
 * move commit's tree has exactly one such file for the slug.
 */
function readLedgerPlacement(
	gx: (args: string[]) => RunResult,
	moveCommit: string,
	slug: string,
): {path: string; blob: string; message: string} | undefined {
	// Find THIS slug's ledger file in the move commit's tree (the post-move
	// placement). Probe each work folder for `work/<folder>/<slug>.md` and read its
	// blob sha; exactly one holds it after the move.
	for (const folder of WORK_FOLDERS) {
		const path = `work/${folder}/${slug}.md`;
		const ls = gx(['ls-tree', moveCommit, path]);
		if (ls.status !== 0 || ls.stdout.trim() === '') {
			continue;
		}
		// `<mode> blob <sha>\t<path>`
		const match = /^\d+ blob ([0-9a-f]+)\t/.exec(ls.stdout.trim());
		if (!match) {
			continue;
		}
		const blob = match[1];
		const message =
			folder === 'needs-attention'
				? `chore(${slug}): surface needs-attention on main`
				: `chore(${slug}): clear needs-attention surface on main (${folder})`;
		return {path, blob, message};
	}
	return undefined;
}

/**
 * The active ledger-write strategy. There is exactly one (current behaviour);
 * this indirection is the seam's single insertion point — NOT a selectable mode.
 */
export const ledgerWrite: LedgerWriteStrategy = currentLedgerWrite;
