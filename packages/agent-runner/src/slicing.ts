import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {parseFrontmatter, setSlicedMarker} from './frontmatter.js';
import {runAsync, type RunResult} from './git.js';
import {
	performIntegration,
	type IntegrationCoreResult,
} from './integration-core.js';
import type {IntegrationMode, ReviewProviderName} from './config.js';
import {
	resolveSlicingEligibility,
	type SlicingEligibilityResult,
} from './slicing-eligibility.js';
import {
	acquireSlicingLock,
	releaseSlicingLock,
	type AcquireSlicingLockOptions,
	type AcquireSlicingLockResult,
	type ReleaseSlicingLockOptions,
	type ReleaseSlicingLockResult,
} from './slicing-lock.js';
import {NullHarness, type Harness} from './harness.js';
import {launchWithOptionalWatch} from './agent-launch.js';
import {setNeedsAnswersMarker} from './frontmatter.js';
import {
	runSliceReviewLoop,
	type SliceReviewGate,
	type RunSliceReviewLoopResult,
} from './slicer-review-loop.js';

/**
 * The **`do prd:<slug>` slicing path** (PRD `auto-slice`, slice
 * `autoslice-command`) — the orchestration that ties the slicing GATE
 * (`slicing-eligibility.ts`) and the slicing LOCK (`slicing-lock.ts`) together to
 * slice a PRD into `work/backlog/` items, with the RUNNER owning every git-state
 * transition. This is the PRD branch of the `do` worker (ADR
 * `command-surface-and-journeys.md` §3/§3a), NOT a standalone `slice` command;
 * `do.ts` dispatches `resolved.namespace === 'prd'` here.
 *
 * The end-to-end flow (mirroring the `do`/`run` runner-owns-git discipline — the
 * agent only EDITS files, the runner does ALL git):
 *
 *   1. **Resolve the gate** (agent path): refuse to slice a PRD that is
 *      `humanOnly`/`needsAnswers`, or where `autoSlice` is off, or whose
 *      `sliceAfter` PRDs are not yet sliced. The HUMAN path is unbound by the gate.
 *   2. **Acquire the lock** (agent path) via the seam CAS — serialising concurrent
 *      slicers (`prd → work/slicing/`). The HUMAN path with no contention may slice
 *      on `main` directly WITHOUT the lock.
 *   3. **Invoke the agent harness** with the `to-slices` brief — the agent runs the
 *      slicer methodology and produces `work/backlog/<slug>.md` FILES ONLY; it does
 *      NOT commit/push/move (the same in-band boundary as the build agent).
 *   4. **The runner integrates the COMPLETING transition through the SHARED core**
 *      (`performIntegration`, slice `slice-output-through-integration`): the agent's
 *      slicing runs on a `work/<slug>` branch cut from `<arbiter>/main` (which the
 *      lock just published `work/slicing/<slug>.md` onto), and the produced backlog
 *      slices + the PRD lifecycle move (`work/slicing/ → work/prd/` + the `sliced:`
 *      marker) integrate via the band honoring `--propose` (push the branch + open a
 *      PR, NO `main` touch) / `--merge` (land on `main`). Because the integrate-time
 *      args resolve ONCE in the shared core, EVERY `do slice:` integrate arg applies
 *      to `do prd:` by construction. A content-identity STALE CHECK (the lock's
 *      read-stability backstop) fires FIRST against the acquire-time `lockedBlob`,
 *      so a concurrent edit of the held PRD still fails loud (`stale`).
 *
 * The slicing LOCK (`slicing-lock.ts`, `acquireSlicingLock`/`releaseSlicingLock`)
 * is UNCHANGED — the ledger-write CAS `prd → slicing/` on the visibility ref
 * (`docs/adr/claim-ledger-vs-protected-main.md`). The lock RELEASE still owns the
 * `slicing/ → needs-attention/` redirect for the loop's decomposition-unclear
 * verdict; only the SUCCESS output now integrates through the shared core instead
 * of committing slices straight to `main` via `emitSlices`/`markSliced`. This path
 * does NOT build the no-human confidence routing — that is the review/edit loop
 * owned by `slicer-review-edit-loop`; this path produces + integrates the slices.
 */

/** The terminal status of one `do prd:<slug>` slicing run. */
export type SliceOutcome =
	| 'sliced' // gate passed (agent) / unbound (human) → lock → agent → committed
	| 'gate-refused' // the agent gate refused (humanOnly/needsAnswers/autoSlice/sliceAfter)
	| 'lock-lost' // the lock was lost/contended (another slicer holds it)
	| 'agent-failed' // the agent invocation itself errored
	| 'stale' // the held PRD was edited under the lock → the slicing is stale
	| 'needs-attention' // the slicer edit loop found the decomposition unclear → PRD routed to needs-attention (no slices)
	| 'usage-error'; // usage / environment problem (missing PRD, bad release, …)

export interface SliceResult {
	exitCode: 0 | 1 | 2 | 3 | 4;
	outcome: SliceOutcome;
	/** The PRD slug acted on. */
	slug: string;
	/** Repo-relative paths of the backlog slices the runner committed. */
	emitted?: string[];
	/**
	 * The slicer review→edit LOOP's disposition (`slicer-review-edit-loop`), when
	 * the loop ran. `converged` = the improved slices landed; `uncertain-slices` =
	 * the cap was hit and specific slices landed `needsAnswers: true`; absent when
	 * no loop ran or the PRD was routed to needs-attention (`outcome:
	 * 'needs-attention'`).
	 */
	loop?: 'converged' | 'uncertain-slices';
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/**
 * The agent invocation: runs the `to-slices` brief in `cwd`, WRITING
 * `work/backlog/<slug>.md` slice files (and trimming the PRD). It does NO git —
 * the runner captures the produced files and commits them.
 */
export type SliceAgentRunner = (input: {
	cwd: string;
	prompt: string;
	slug: string;
	env?: NodeJS.ProcessEnv;
}) => {ok: boolean; detail?: string};

/** Injectable lock seams (production: the real CAS; tests: stubs). */
export interface SlicingLockSeam {
	acquire(
		options: AcquireSlicingLockOptions,
	): Promise<AcquireSlicingLockResult>;
	release(
		options: ReleaseSlicingLockOptions,
	): Promise<ReleaseSlicingLockResult>;
}

const DEFAULT_LOCK_SEAM: SlicingLockSeam = {
	acquire: acquireSlicingLock,
	release: releaseSlicingLock,
};

export interface PerformSliceOptions {
	/** The PRD slug to slice (`work/prd/<slug>.md`). */
	slug: string;
	/** The working clone/checkout the slicing runs in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/**
	 * The DOER: `'agent'` (the default; bound by the gate, MUST take the lock) or
	 * `'human'` (unbound by the gate; with no contention slices on `main` directly
	 * WITHOUT the lock). The human-vs-agent choice the command wires.
	 */
	doer?: 'agent' | 'human';
	/** Per-repo `autoSlice` policy (resolved by `autoslice-gate`). Agent path only. */
	autoSlice?: boolean;
	/**
	 * The agent invocation. Tests inject this to write slice files directly;
	 * production wires the harness seam. When omitted, {@link harness} is used.
	 */
	agentRunner?: SliceAgentRunner;
	/** The harness seam used when `agentRunner` is omitted; defaults to the null adapter. */
	harness?: Harness;
	/** The configured agent command the harness shells out to (null adapter). */
	agentCmd?: string;
	/** The model routing intent forwarded to the harness (ADR §13). */
	model?: string;
	/** The HOST-ONLY sessions root for the pi session file. */
	sessionsDir?: string;
	/** Today's date (`YYYY-MM-DD`) stamped as the PRD `sliced:` marker. Defaults to now. */
	today?: string;
	/**
	 * The integration mode the produced slices integrate THROUGH the shared core
	 * with (slice `slice-output-through-integration`): `propose` (default — push the
	 * `work/<slug>` branch + open a PR carrying the slices, NO `main` touch) or
	 * `merge` (land them on `main`). Resolved ONCE in {@link performIntegration},
	 * so EVERY `do slice:` integrate-time arg applies to `do prd:` by construction.
	 * The AGENT path only; the human path commits its own output. Defaults to the
	 * system default (`propose`).
	 */
	integration?: IntegrationMode;
	/** The review-request provider override (propose mode); auto-detect when unset. */
	provider?: ReviewProviderName;
	/** Injectable lock seam (tests stub acquire/release). Defaults to the real CAS. */
	lock?: SlicingLockSeam;
	/**
	 * **The slicer review→edit→converge LOOP** (`slicer-review-edit-loop`, GATES PRD
	 * `work/prd/review.md` RESOLVED DESIGN — Shape 2 / insertion point A). When
	 * provided, AFTER the agent produces candidate slices (step 3) and BEFORE the
	 * runner finalises them (step 4), run the `review` SKILL as a review→edit→
	 * re-review loop that IMPROVES the candidate slices in place, then routes the
	 * verdict through the three outcomes (converge→land / uncertain-slice→
	 * needsAnswers / decomposition-unclear→PRD-to-needs-attention). The seam is the
	 * review+edit gate (tests inject a canned verdict+edits; production:
	 * {@link harnessSliceReviewGate}). Omitted ⇒ NO loop (the candidate slices land
	 * as-is — the pre-loop behaviour). The HUMAN path is unaffected (the loop runs
	 * on the auto-slicer's output only — see the gating in {@link performSlice}).
	 */
	reviewLoop?: SliceReviewGate;
	/**
	 * The HARD CAP on the slicer edit loop's in-context review passes (N) — resolved
	 * per-repo (flag > env > per-repo > global > cheap default). Only consulted when
	 * {@link reviewLoop} is set. Defaults to 3 (the cheap default) when omitted.
	 */
	maxReview?: number;
	/**
	 * How many fresh-context EXECUTIONS (M) of the loop to run — each a NEW launch in
	 * a fresh context. Default 1 (the cheap degenerate case). Only consulted when
	 * {@link reviewLoop} is set.
	 */
	reviewExecutions?: number;
	/** The model the review agent runs on (de-correlated from the slicer). Loop only. */
	reviewModel?: string;
	/** Environment for child git/agent processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

const DEFAULT_ARBITER = 'origin';

/**
 * Run the `do prd:<slug>` slicing path end-to-end. Never throws for the expected
 * gate-refused / lock-lost / agent-failed / stale cases — those are returned with
 * the appropriate exit code and outcome. The runner owns all git; the agent only
 * writes slice files.
 */
export async function performSlice(
	options: PerformSliceOptions,
): Promise<SliceResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env;
	const slug = options.slug;
	const doer = options.doer ?? 'agent';
	const lock = options.lock ?? DEFAULT_LOCK_SEAM;

	// 0. The PRD must exist in the checkout (`work/prd/<slug>.md`) — it is the
	//    source the agent slices + the file the lock holds.
	const prdPath = join(cwd, 'work', 'prd', `${slug}.md`);
	if (!existsSync(prdPath)) {
		const message = `no PRD '${slug}' found at work/prd/${slug}.md.`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', slug, message};
	}
	const prdContent = readFileSync(prdPath, 'utf8');
	const prdFm = parseFrontmatter(prdContent);

	// 1. RESOLVE THE GATE (agent path only). The human path is UNBOUND — a human
	//    decides for themselves whether a PRD is sliceable.
	if (doer === 'agent') {
		const eligibility = resolveAgentGate(cwd, slug, prdFm, options.autoSlice);
		if (!eligibility.sliceable) {
			const message = gateRefusalReason(slug, prdFm, eligibility, options);
			note(message);
			return {exitCode: 1, outcome: 'gate-refused', slug, message};
		}
	}

	// 2. ACQUIRE THE LOCK (agent path; concurrency serialisation). The human path
	//    with no contention may slice on `main` directly WITHOUT the lock.
	let lockedBlob: string | undefined;
	const useLock = doer === 'agent';
	if (useLock) {
		const acquired = await lock.acquire({slug, cwd, arbiter, env, note});
		if (acquired.outcome === 'lost') {
			return {
				exitCode: 2,
				outcome: 'lock-lost',
				slug,
				message: acquired.message,
			};
		}
		if (acquired.outcome === 'contended') {
			return {
				exitCode: 3,
				outcome: 'lock-lost',
				slug,
				message: acquired.message,
			};
		}
		if (acquired.exitCode !== 0) {
			return {
				exitCode: 1,
				outcome: 'usage-error',
				slug,
				message: acquired.message,
			};
		}
		lockedBlob = acquired.lockedBlob;
	}

	// 2b. ONBOARD the agent's slicing work onto a `work/<slug>` BRANCH cut from the
	//     freshly-fetched `<arbiter>/main` (slice `slice-output-through-integration`).
	//     The lock has just published `work/slicing/<slug>.md` to `<arbiter>/main`, so
	//     the branch's base HOLDS the held PRD — the lifecycle stage below restores it
	//     `slicing/ → prd/` ON THIS BRANCH and the shared integrate core (`--propose`
	//     PR / `--merge` main) lands the whole transition, WITHOUT the lock release
	//     committing slices straight to `main`. The agent runs IN-PLACE on this branch
	//     (branch ≠ worktree; the isolation seam upgrades it). The HUMAN path stays on
	//     its own branch and commits its output itself (no integrate, no branch cut).
	if (useLock) {
		await switchToWorkBranch(cwd, arbiter, slug, env);
	}

	// 3. INVOKE THE AGENT with the to-slices brief. It WRITES work/backlog/*.md
	//    slice files; it does NO git. We snapshot the backlog folder before/after
	//    so the runner (not the agent) captures + commits exactly what was produced.
	const before = snapshotBacklog(cwd);
	const prompt = buildSlicingBrief(slug, prdFm.prd);
	let agent: {ok: boolean; detail?: string};
	try {
		agent = await runSliceAgent(options, cwd, prompt, slug);
	} catch (err) {
		agent = {
			ok: false,
			detail: err instanceof Error ? err.message : String(err),
		};
	}
	if (!agent.ok) {
		const detail = agent.detail ?? `the agent failed to slice '${slug}'.`;
		const message = `Agent failed slicing '${slug}' (${detail}).`;
		note(message);
		// The lock stays held (the runner did not release it): a stuck slicing is
		// recoverable / re-runnable. Surfacing it is the review/edit loop's job.
		return {exitCode: 1, outcome: 'agent-failed', slug, message};
	}

	// 3.5 THE SLICER REVIEW→EDIT→CONVERGE LOOP (`slicer-review-edit-loop`, Shape 2 /
	//     insertion point A): when a loop seam is wired, run the `review` SKILL as a
	//     review→edit→re-review loop that IMPROVES the candidate slices in place, then
	//     determines the disposition (the three outcomes). This plugs in AFTER the
	//     candidate slices are produced and BEFORE they are finalised. The agent makes
	//     the review/edit JUDGEMENTS; the loop applies edits to the candidate files
	//     and routes the verdict; the runner (below) owns the git transition. Only the
	//     AGENT path runs the loop — the human slicing path is unaffected.
	let loopDisposition: RunSliceReviewLoopResult | undefined;
	if (options.reviewLoop && doer === 'agent') {
		loopDisposition = await runSliceReviewLoop({
			slug,
			cwd,
			gate: options.reviewLoop,
			// SCOPING FENCE (the requeue fix): the loop reviews/edits/flags ONLY the
			// slices THIS run produced (new-or-changed vs `before`), never the
			// pre-existing landed slices that share work/backlog/.
			before,
			maxReview: options.maxReview ?? 3,
			executions: options.reviewExecutions,
			reviewModel: options.reviewModel,
			sessionsDir: options.sessionsDir,
			env,
			note,
		});
		// DECOMPOSITION UNCLEAR: emit NO guessed slices — route the held PRD to
		// needs-attention with the questions as the reason (the lock is released by
		// the SAME runner-owned transition, redirecting slicing/ → needs-attention/).
		if (loopDisposition.outcome === 'decomposition-unclear') {
			const reason = decompositionUnclearReason(
				slug,
				loopDisposition.prdQuestions,
			);
			if (useLock) {
				const routed = await lock.release({
					slug,
					cwd,
					arbiter,
					lockedBlob,
					routeToNeedsAttention: {reason},
					env,
					note,
				});
				if (routed.outcome !== 'released') {
					return releaseFailureToResult(routed, slug);
				}
			}
			note(loopDisposition.message);
			return {
				exitCode: 1,
				outcome: 'needs-attention',
				slug,
				message: loopDisposition.message,
			};
		}
		// UNCERTAIN SLICES: mark each named candidate `needsAnswers: true` + record
		// its questions in the body, so it lands but is not agent-buildable. The
		// runner writes the marker (the agent does no git/disk-escape).
		if (loopDisposition.outcome === 'uncertain-slices') {
			for (const uncertain of loopDisposition.uncertainSlices) {
				markSliceNeedsAnswers(cwd, uncertain.path, uncertain.questions, note);
			}
		}
	}

	// 4. The RUNNER commits the COMPLETING transition: drop the produced backlog
	//    slices IN + restore the PRD slicing/ -> prd/ + mark the PRD `sliced:` — now
	//    through the SHARED integrate core (`--propose` PR / `--merge` main), NOT a
	//    direct commit to `main`. The agent never does git. (The backlog snapshot is
	//    taken AFTER any loop edits, so the runner integrates the IMPROVED slices,
	//    not the pre-loop candidates.)
	const emitted = newOrChangedBacklog(cwd, before);
	const emitSlices = collectEmittedSlices(cwd, emitted);
	const today = options.today ?? new Date().toISOString().slice(0, 10);
	const loopTag: 'converged' | 'uncertain-slices' | undefined =
		loopDisposition?.outcome === 'converged'
			? 'converged'
			: loopDisposition?.outcome === 'uncertain-slices'
				? 'uncertain-slices'
				: undefined;

	if (useLock) {
		// READ-STABILITY BACKSTOP (the lock's content-identity check, now owned at the
		// integrate seam): the OUTPUT no longer rides the lock release, so the band
		// below would otherwise rebase a concurrent edit of the held PRD body CLEANLY
		// into prd/ (a rename+edit merge) while the slices were cut from the OLD body —
		// the exact silent stale-slice drift the lock forbids
		// (`work/observations/slicing-lock-does-not-stabilise-prd-content.md`). So we
		// compare the CURRENTLY held `work/slicing/<slug>.md` blob on the arbiter against
		// the snapshot the lock TOOK (`lockedBlob`); ANY change ⇒ STALE ⇒ fail loud,
		// touch NOTHING (the lock stays held; a human re-slices or routes to
		// needs-attention). It is the SAME content-identity check `releaseSlicingLock`
		// runs — relocated here because this transition, not the release, owns the
		// completing commit now.
		const stale = await heldPrdIsStale(cwd, arbiter, slug, lockedBlob, env);
		if (stale) {
			const message =
				`RELEASE CONFLICT for '${slug}': the PRD was edited (work/slicing/${slug}.md ` +
				`changed on ${arbiter}/main) while the slicing lock was held. The slicing is ` +
				`STALE — re-slice from the edited PRD or route it to work/needs-attention/. ` +
				`The arbiter was NOT modified (lock still held).`;
			note(message);
			return {exitCode: 4, outcome: 'stale', slug, message};
		}

		// Route the OUTPUT through the SHARED integrate back-half (slice
		// `slice-output-through-integration`): the produced backlog slices + the PRD
		// lifecycle move (`work/slicing/ -> work/prd/` + the `sliced:` marker) integrate
		// via `performIntegration` honoring `--propose` (push the work branch + open a
		// PR, NO `main` touch) / `--merge` (land on `main`). Because the integrate-time
		// args resolve ONCE in the shared core, every `do slice:` arg applies here by
		// construction. The agent did NO git; the runner (the band) owns the ONE commit.
		const core = await performIntegration({
			cwd,
			arbiter,
			slug,
			// `source`/`recovering` are slice-shaped and IGNORED when `lifecycle` is set
			// (a slicing transition never recovers a surfaced needs-attention move).
			source: 'in-progress',
			recovering: false,
			// Skip the build acceptance gate: a slicing transition has no `verify` floor
			// (the slicer review loop above is its quality gate). The fresh-context slice
			// acceptance gate is the SEPARATE `slice-acceptance-gate` slice, blocked on
			// this one — NOT added here.
			skipVerify: true,
			mode: options.integration ?? 'propose',
			provider: options.provider,
			type: 'slicing',
			lifecycle: {
				// Read the PR title / commit summary from the held PRD (before it moves).
				titlePath: join(cwd, 'work', 'slicing', `${slug}.md`),
				commitTag: 'sliced',
				stage: () => stageSlicingLifecycle({cwd, slug, today, emitSlices, env}),
			},
			env,
			note,
		});
		return integrationToSliceResult(core, {slug, emitted, loop: loopTag});
	}

	// HUMAN, no-lock path: the human commits on `main` directly (the runner does
	// not own the human's git). We report the produced slices; marking the PRD
	// `sliced:` and committing is the human's to do, as with the human `complete`.
	const message =
		`Sliced '${slug}' -> ${emitted.length} backlog slice` +
		`${emitted.length === 1 ? '' : 's'} (human path, no lock). Inspect + commit ` +
		`the produced files (and the PRD's sliced: marker) yourself.`;
	note(message);
	return {
		exitCode: 0,
		outcome: 'sliced',
		slug,
		emitted,
		loop: loopTag,
		message,
	};
}

/**
 * Map a non-`released` lock-release result onto the {@link SliceResult} contract
 * (the decomposition-unclear routing reuses the SAME release seam, so it can also
 * be `stale`/`lost`/`contended`/usage-error). Mirrors the step-4 release mapping.
 */
function releaseFailureToResult(
	released: ReleaseSlicingLockResult,
	slug: string,
): SliceResult {
	if (released.outcome === 'stale') {
		return {exitCode: 4, outcome: 'stale', slug, message: released.message};
	}
	if (released.outcome === 'lost' || released.outcome === 'contended') {
		const code = released.outcome === 'lost' ? 2 : 3;
		return {
			exitCode: code,
			outcome: 'lock-lost',
			slug,
			message: released.message,
		};
	}
	return {exitCode: 1, outcome: 'usage-error', slug, message: released.message};
}

/**
 * Map the shared integrate band's {@link IntegrationCoreResult} onto the slicing
 * {@link SliceResult} (slice `slice-output-through-integration`). On `completed`
 * (propose pushed the work branch + opened a PR / merge landed on `main`) the
 * slicing is `sliced`. The band's FAILURE outcomes are reported on the slicing
 * contract: a `rebase-conflict` against a concurrently-advanced `main` maps to
 * `stale` (exit 4) — the slicing analogue of "the held PRD moved under us"; a
 * `gate-failed` cannot occur (the slicing path passes `skipVerify`) but maps to a
 * usage error defensively; `review-blocked` likewise (no review gate is wired
 * here — the `slice-acceptance-gate` slice adds it).
 */
function integrationToSliceResult(
	core: IntegrationCoreResult,
	ctx: {
		slug: string;
		emitted: string[];
		loop: 'converged' | 'uncertain-slices' | undefined;
	},
): SliceResult {
	const {slug, emitted, loop} = ctx;
	if (core.outcome === 'completed') {
		const landed =
			core.integration?.mode === 'merge'
				? 'landed them on the arbiter main'
				: 'opened a PR carrying them (main untouched)';
		const message =
			`Sliced '${slug}' -> ${emitted.length} backlog slice` +
			`${emitted.length === 1 ? '' : 's'}; the runner integrated the transition ` +
			`through the shared core (restored work/slicing/ -> work/prd/, marked the PRD ` +
			`sliced) and ${landed}.`;
		return {exitCode: 0, outcome: 'sliced', slug, emitted, loop, message};
	}
	if (core.outcome === 'rebase-conflict') {
		return {
			exitCode: 4,
			outcome: 'stale',
			slug,
			message:
				core.reason ??
				`Integrating the slicing of '${slug}' conflicted against the latest ` +
					`${slug} main — the slicing is stale; re-slice from the current PRD.`,
		};
	}
	return {
		exitCode: 1,
		outcome: 'usage-error',
		slug,
		message:
			core.reason ??
			`Integrating the slicing of '${slug}' failed unexpectedly.`,
	};
}

/**
 * ONBOARD the slicing work onto a `work/<slug>` branch cut from the freshly-
 * fetched `<arbiter>/main` (slice `slice-output-through-integration`). Called
 * AFTER the lock published `work/slicing/<slug>.md` to `<arbiter>/main`, so the
 * branch's base HOLDS the locked PRD — the lifecycle stage then restores it
 * `slicing/ -> prd/` ON THIS BRANCH and the shared integrate core lands it. A
 * pre-existing local `work/<slug>` (a re-run) is force-recreated off fresh main.
 * The agent runs in-place on this branch (branch ≠ worktree).
 */
async function switchToWorkBranch(
	cwd: string,
	arbiter: string,
	slug: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	const branch = `work/${slug}`;
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	await gitHard(
		['switch', '--quiet', '-C', branch, `${arbiter}/main`],
		cwd,
		env,
	);
}

/**
 * The READ-STABILITY content-identity STALE CHECK (the lock's backstop, owned at
 * the integrate seam now that the OUTPUT no longer rides the lock release): true
 * iff the CURRENTLY held `work/slicing/<slug>.md` blob on `<arbiter>/main` DIFFERS
 * from the snapshot the lock TOOK (`lockedBlob`). ANY change = a concurrent edit
 * under the lock = the slicing is STALE. Stronger than a textual rebase conflict
 * (which a rename+edit merge can apply CLEANLY), exactly as `releaseSlicingLock`
 * documents. When `lockedBlob` is absent (never, in production) it reads as
 * not-stale (the lock acquire always returns it).
 */
async function heldPrdIsStale(
	cwd: string,
	arbiter: string,
	slug: string,
	lockedBlob: string | undefined,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	if (lockedBlob === undefined) {
		return false;
	}
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	const held = await gitSoft(
		['rev-parse', `${arbiter}/main:work/slicing/${slug}.md`],
		cwd,
		env,
	);
	// The lock not being held (no slicing/<slug>.md) is NOT this check's concern
	// (the integrate's rebase/push surfaces a genuinely-lost lock); only a CHANGED
	// held blob is stale.
	if (held.status !== 0) {
		return false;
	}
	return held.stdout.trim() !== lockedBlob;
}

/**
 * STAGE the slicing lifecycle into the index on the `work/<slug>` branch (the
 * {@link performIntegration} lifecycle seam): restore the held PRD
 * `git mv work/slicing/<slug>.md -> work/prd/<slug>.md`, stamp its `sliced:`
 * marker, and write+`git add` the produced `work/backlog/*.md` files. The band's
 * subsequent `git add -A` + atomic commit folds this AND the agent's uncommitted
 * backlog writes into ONE runner-owned commit (the agent never does git). Keeps
 * the CURRENT `slicing/ -> prd/` restore + `sliced:` marker UNCHANGED (the folder
 * destination is the separate `prd-sliced-folder-step-a` slice).
 */
async function stageSlicingLifecycle(params: {
	cwd: string;
	slug: string;
	today: string;
	emitSlices: Record<string, string>;
	env: NodeJS.ProcessEnv | undefined;
}): Promise<void> {
	const {cwd, slug, today, emitSlices, env} = params;
	const slicing = `work/slicing/${slug}.md`;
	const prd = `work/prd/${slug}.md`;
	// Restore the held PRD slicing/ -> prd/ (release the lock as part of THIS
	// transition's commit, not the lock release's own commit-to-main).
	mkdirSync(dirname(join(cwd, prd)), {recursive: true});
	await gitHard(['mv', slicing, prd], cwd, env);
	// Stamp the derived `sliced:` marker on the restored PRD (kept during the
	// migration; the folder becomes source-of-truth in a later sequenced slice).
	const prdAbs = join(cwd, prd);
	writeFileSync(prdAbs, setSlicedMarker(readFileSync(prdAbs, 'utf8'), today));
	await gitHard(['add', '--', prd], cwd, env);
	// Drop the produced backlog slices IN (write + stage; the band's `git add -A`
	// also catches them, but staging here keeps the transition explicit + atomic).
	for (const [relPath, content] of Object.entries(emitSlices)) {
		const abs = join(cwd, relPath);
		mkdirSync(dirname(abs), {recursive: true});
		writeFileSync(abs, content);
		await gitHard(['add', '--', relPath], cwd, env);
	}
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

/**
 * Build the needs-attention REASON for a decomposition-unclear loop verdict (the
 * PRD is routed to `work/needs-attention/` with these open questions, no guessed
 * slices). Prose only — recorded as the PRD's needs-attention body block.
 */
function decompositionUnclearReason(slug: string, questions: string[]): string {
	const head =
		`The slicer review→edit loop could not converge on a sound decomposition of ` +
		`'${slug}' (maxReview exhausted with unresolved blockers). The PRD is routed ` +
		`to needs-attention with no guessed slices; a human must resolve:`;
	const body =
		questions.length > 0
			? questions.map((q) => `- ${q}`).join('\n')
			: '- (no specific questions surfaced; the decomposition is broadly unclear)';
	return `${head}\n${body}`;
}

/**
 * Mark a candidate slice file `needsAnswers: true` and record its open questions in
 * its body (the loop's uncertain-slice routing outcome). The runner writes the
 * file; the agent does no git/disk-escape. A path outside `work/backlog/` is
 * skipped (defensive). A relative `work/backlog/<slug>.md` that does not exist is
 * skipped with a note (never crash the transition).
 */
function markSliceNeedsAnswers(
	cwd: string,
	relPath: string,
	questions: string[],
	note: (message: string) => void,
): void {
	const normalized = relPath.replace(/\\/g, '/');
	if (!normalized.startsWith('work/backlog/') || normalized.includes('..')) {
		note(`Skipped a needsAnswers mark outside work/backlog/ (${relPath}).`);
		return;
	}
	const abs = join(cwd, normalized);
	if (!existsSync(abs)) {
		note(`Skipped a needsAnswers mark for missing candidate slice ${relPath}.`);
		return;
	}
	const current = readFileSync(abs, 'utf8');
	const marked = setNeedsAnswersMarker(current, true);
	writeFileSync(abs, appendQuestionsBlock(marked, questions));
}

/** The heading that opens the open-questions block in an uncertain slice body. */
const OPEN_QUESTIONS_HEADING = '## Open questions';

/**
 * Append an `## Open questions` block (prose, never a frontmatter field —
 * WORK-CONTRACT rule 3) listing the loop's surfaced questions to an uncertain
 * slice's body. A human answers these before the slice becomes agent-buildable.
 */
function appendQuestionsBlock(content: string, questions: string[]): string {
	if (questions.length === 0) {
		return content;
	}
	const base = content.replace(/\s*$/, '');
	const items = questions.map((q) => `- ${q}`).join('\n');
	return [base, '', OPEN_QUESTIONS_HEADING, '', items, ''].join('\n');
}

/**
 * Resolve the AGENT slicing gate for `slug`: the pure predicate
 * (`needsAnswers !== true && humanOnly !== true && autoSlice`) plus the
 * cross-PRD `sliceAfter` ordering, resolved against the `sliced:` markers of the
 * PRDs present in the checkout.
 */
function resolveAgentGate(
	cwd: string,
	slug: string,
	prdFm: {humanOnly?: boolean; needsAnswers?: boolean; sliceAfter: string[]},
	autoSlice: boolean | undefined,
): SlicingEligibilityResult {
	return resolveSlicingEligibility({
		humanOnly: prdFm.humanOnly,
		needsAnswers: prdFm.needsAnswers,
		sliceAfter: prdFm.sliceAfter,
		slicedSlugs: readSlicedSlugs(cwd),
		autoSlice: autoSlice ?? false,
	});
}

/** Build an HONEST gate-refusal message naming WHY the agent skipped the PRD. */
function gateRefusalReason(
	slug: string,
	prdFm: {humanOnly?: boolean; needsAnswers?: boolean},
	eligibility: SlicingEligibilityResult,
	options: PerformSliceOptions,
): string {
	const reasons: string[] = [];
	if (prdFm.humanOnly === true) {
		reasons.push('the PRD is humanOnly (a human must drive its slicing)');
	}
	if (prdFm.needsAnswers === true) {
		reasons.push(
			'the PRD has needsAnswers (open questions block auto-slicing)',
		);
	}
	if (
		prdFm.humanOnly !== true &&
		prdFm.needsAnswers !== true &&
		(options.autoSlice ?? false) !== true
	) {
		reasons.push("the repo's autoSlice policy is off");
	}
	if (!eligibility.sliceAfter.satisfied) {
		reasons.push(
			`sliceAfter PRD(s) not yet sliced: ${eligibility.sliceAfter.missing.join(', ')}`,
		);
	}
	const why =
		reasons.length > 0 ? reasons.join('; ') : 'the slicing gate refused';
	return `Skipped slicing '${slug}': ${why}.`;
}

/**
 * Read the set of slugs whose PRDs are already SLICED in this checkout — a PRD's
 * `sliced:` frontmatter marker (NOT residence in any folder). Reads both
 * `work/prd/` and `work/slicing/` (a PRD mid-slice still occupies its slug); a
 * `sliced:` marker is what counts. Missing folders read as empty.
 */
function readSlicedSlugs(cwd: string): Set<string> {
	const slugs = new Set<string>();
	for (const folder of ['prd', 'slicing'] as const) {
		const dir = join(cwd, 'work', folder);
		for (const file of listMarkdown(dir)) {
			const content = readFileSync(join(dir, file), 'utf8');
			const fm = parseFrontmatter(content);
			if (fm.sliced !== undefined) {
				slugs.add(fm.slug ?? file.replace(/\.md$/i, ''));
			}
		}
	}
	return slugs;
}

/** Build the `to-slices` brief the agent runs against the PRD. */
function buildSlicingBrief(slug: string, _prd: string | undefined): string {
	return [
		`Use the **to-slices** skill to slice the PRD \`work/prd/${slug}.md\` into`,
		'independently-grabbable `work/backlog/<slug>.md` slices (tracer-bullet',
		'vertical slices). Read the PRD fully first.',
		'',
		'No human is present, so do the CONFIDENCE CHECK (to-slices step 4): only emit',
		'slices you would have gotten a human to approve. If granularity, dependency',
		'order, a gate, or a seam is genuinely unresolved, set `needsAnswers: true`',
		'on the specific uncertain slice (questions in its body) rather than guessing.',
		'',
		'WRITE the slice files only. Do NOT perform any git operations — do not stage,',
		'commit, push, or move any files. The RUNNER owns every git-state transition',
		'(it commits the produced slices, releases the slicing lock, and marks the PRD',
		'sliced). Set each slice\u2019s `prd:` field to the source PRD slug so the link',
		'back to the PRD survives.',
	].join('\n');
}

/** Run the slice agent. Prefers the injected runner; else the harness seam. */
async function runSliceAgent(
	options: PerformSliceOptions,
	cwd: string,
	prompt: string,
	slug: string,
): Promise<{ok: boolean; detail?: string}> {
	if (options.agentRunner) {
		return options.agentRunner({cwd, prompt, slug, env: options.env});
	}
	const harness = options.harness ?? new NullHarness();
	const launched = await launchWithOptionalWatch({
		harness,
		dir: cwd,
		slug,
		command: options.agentCmd ?? '',
		prompt,
		model: options.model,
		sessionId: `slice-${slug}`,
		sessionsDir: options.sessionsDir,
		env: options.env,
	});
	return {ok: launched.ok, detail: launched.detail};
}

/** A snapshot of `work/backlog/`: filename → file content (for change detection). */
function snapshotBacklog(cwd: string): Map<string, string> {
	const dir = join(cwd, 'work', 'backlog');
	const snap = new Map<string, string>();
	for (const file of listMarkdown(dir)) {
		snap.set(file, readFileSync(join(dir, file), 'utf8'));
	}
	return snap;
}

/**
 * Repo-relative paths of the `work/backlog/*.md` files the agent NEWLY created or
 * CHANGED vs the pre-run snapshot — exactly what the runner captures + commits.
 * (An untouched pre-existing slice is NOT re-committed.)
 */
function newOrChangedBacklog(
	cwd: string,
	before: Map<string, string>,
): string[] {
	const dir = join(cwd, 'work', 'backlog');
	const changed: string[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		if (before.get(file) !== content) {
			changed.push(`work/backlog/${file}`);
		}
	}
	return changed.sort();
}

/** Read the produced backlog slices' content keyed by repo-relative path. */
function collectEmittedSlices(
	cwd: string,
	relPaths: string[],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rel of relPaths) {
		out[rel] = readFileSync(join(cwd, rel), 'utf8');
	}
	return out;
}

/** List `*.md` files in `dir`, sorted; an absent dir reads as empty. */
function listMarkdown(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.filter((name) => name.toLowerCase().endsWith('.md')).sort();
}
