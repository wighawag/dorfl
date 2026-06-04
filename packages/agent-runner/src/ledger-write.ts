import {runAsync, type RunResult} from './git.js';
import {
	Integrator,
	type IntegrateResult,
	type ReviewProvider,
} from './integrator.js';
import type {IntegrationMode} from './config.js';

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
 */

/** The three `work/` lifecycle transitions the write seam can apply. */
export type LedgerTransitionKind = 'claim' | 'complete' | 'needs-attention';

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
		cwd,
		env,
	}): ApplyCompleteTransitionResult {
		const integrator = new Integrator({provider});
		return integrator.integrate({cwd, arbiter, branch, mode, env});
	},
};

/**
 * The active ledger-write strategy. There is exactly one (current behaviour);
 * this indirection is the seam's single insertion point — NOT a selectable mode.
 */
export const ledgerWrite: LedgerWriteStrategy = currentLedgerWrite;
