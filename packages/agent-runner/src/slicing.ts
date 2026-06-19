import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {parseFrontmatter} from './frontmatter.js';
import {runAsync, type RunResult} from './git.js';
import {
	workFolderRel,
	workFolderPath,
	workItemPath,
	workItemRel,
	isWorkItemFile,
} from './work-layout.js';
import {
	performIntegration,
	type IntegrationCoreResult,
} from './integration-core.js';
import type {IntegrationMode} from './config.js';
import type {ReviewProvider} from './integrator.js';
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
import {releaseItemLock} from './item-lock.js';
import {NullHarness, type Harness} from './harness.js';
import {launchWithOptionalWatch} from './agent-launch.js';
import {placementFolder, resolvePlacement} from './placement.js';
import {setNeedsAnswersMarker, propagateOrigin} from './frontmatter.js';
import {workBranchRef} from './slug-namespace.js';
import {
	runSliceReviewLoop,
	type SliceReviewGate,
	type RunSliceReviewLoopResult,
} from './slicer-review-loop.js';
import type {ReviewGate} from './review-gate.js';

/**
 * The **`do prd:<slug>` slicing path** (PRD `auto-slice`, slice
 * `autoslice-command`) — the orchestration that ties the slicing GATE
 * (`slicing-eligibility.ts`) and the slicing LOCK (`slicing-lock.ts`) together to
 * slice a PRD into `work/pre-backlog/` STAGED items (slice
 * `pre-backlog-staging-folder-and-promote-step-a` — the runner-owned promotion
 * moves them `pre-backlog/ → backlog/` later), with the RUNNER owning every git-state
 * transition. This is the PRD branch of the `do` worker (ADR
 * `command-surface-and-journeys.md` §3/§3a), NOT a standalone `slice` command;
 * `do.ts` dispatches `resolved.namespace === 'brief'` here.
 *
 * The end-to-end flow (mirroring the `do`/`run` runner-owns-git discipline — the
 * agent only EDITS files, the runner does ALL git):
 *
 *   1. **Resolve the gate** (agent path): refuse to slice a PRD that is
 *      `humanOnly`/`needsAnswers`, or whose `briefAfter` PRDs are not yet sliced.
 *      The repo's `autoSlice` POLICY also refuses on the AUTO-PICK pool path, but
 *      NOT when the PRD was named EXPLICITLY (`do prd:<slug>`, `explicit: true`):
 *      naming it IS the authorization, exactly as `do <slice>` builds regardless of
 *      `autoBuild` (the pool, not the explicit claim, gates the policy). The HUMAN
 *      path is unbound by the gate entirely.
 *   2. **Acquire the lock** (agent path) via the unified per-item lock CAS —
 *      serialising concurrent slicers on the `prd:<slug>` ref (the body STAYS in
 *      `work/prd/`; the lock no longer moves it). The HUMAN path with no contention
 *      may slice on `main` directly WITHOUT the lock.
 *   3. **Invoke the agent harness** with the `to-slices` brief — the agent runs the
 *      slicer methodology and produces `work/pre-backlog/<slug>.md` FILES ONLY; it does
 *      NOT commit/push/move (the same in-band boundary as the build agent).
 *   4. **The runner integrates the COMPLETING transition through the SHARED core**
 *      (`performIntegration`, slice `slice-output-through-integration`): the agent's
 *      slicing runs on a `work/<slug>` branch cut from `<arbiter>/main` (whose base
 *      holds the PRD in `work/prd/`), and the produced backlog slices + the durable
 *      PRD lifecycle move (`work/prd/ → work/prd-sliced/`)
 *      integrate via the band honoring `--propose` (push the branch + open a
 *      PR, NO `main` touch) / `--merge` (land on `main`). Because the integrate-time
 *      args resolve ONCE in the shared core, EVERY `do slice:` integrate arg applies
 *      to `do prd:` by construction. A content-identity STALE CHECK (the lock's
 *      read-stability backstop) fires FIRST against the acquire-time `lockedBlob`,
 *      so a concurrent edit of the held PRD still fails loud (`stale`).
 *
 * The slicing LOCK (`slicing-lock.ts`, `acquireSlicingLock`/`releaseSlicingLock`)
 * is the UNIFIED per-item lock (`refs/agent-runner/lock/<entry>`, `action: slice`)
 * — the transient `slicing/` folder marker is RETIRED (slice
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`). The lock
 * RELEASE owns the needs-attention redirect for the loop's decomposition-unclear
 * verdict (it amends the lock `active → stuck` — no folder write); only the SUCCESS
 * output integrates through the shared core. This path
 * does NOT build the no-human confidence routing — that is the review/edit loop
 * owned by `slicer-review-edit-loop`; this path produces + integrates the slices.
 */

/** The terminal status of one `do prd:<slug>` slicing run. */
export type SliceOutcome =
	| 'sliced' // gate passed (agent) / unbound (human) → lock → agent → committed
	| 'gate-refused' // the agent gate refused (humanOnly/needsAnswers/autoSlice/briefAfter)
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
 * `work/pre-backlog/<slug>.md` slice files (and trimming the PRD). It does NO git —
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
	 * The PRD was named EXPLICITLY by the operator (`do prd:<slug>`), so the
	 * `autoSlice` POLICY is already satisfied — naming the PRD IS the authorization,
	 * EXACTLY as `do <slice>` builds a named slice regardless of `autoBuild` (the
	 * build path's precedent: `autoBuild` gates the scan/selection POOL only, never
	 * `performDo`'s explicit claim). When `true`, the agent slicing gate drops the
	 * `autoSlice` policy term and binds ONLY the PRD's own readiness axes
	 * (`humanOnly`/`needsAnswers`) + `briefAfter`. Defaults `false`. Both the
	 * explicit `do prd:` dispatch AND the auto-pick path pass `true` here: the
	 * auto-pick POOL (`do-autopick.ts`) is the single `autoSlice`-enforcement point
	 * (a pool-ineligible PRD is never selected), so once a PRD is dispatched its
	 * policy is already settled. Agent path only.
	 */
	explicit?: boolean;
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
	/**
	 * **The PR-INTENT axis** (config `noPR`, ADR §6): when `true`, propose pushes
	 * the produced slice branch but skips the PR (the explicit suppress-PR intent).
	 * NOT a provider choice — the provider is purely arbiter-derived. Unset/false ⇒
	 * the PR opens normally.
	 */
	noPR?: boolean;
	/**
	 * Optional FULLY-FORMED review provider INSTANCE used VERBATIM (the SAME seam
	 * `run`/`do` expose; forwarded to `performIntegration` as `providerInstance`).
	 * Tests/embeddings inject a stubbed `GitHubProvider` (a custom `gh` path) to
	 * drive the propose pipeline OFFLINE. The resolved provider OBJECT, NOT a config
	 * override. Unset ⇒ the core selects from the arbiter URL.
	 */
	providerInstance?: ReviewProvider;
	/**
	 * **The slice-SET ACCEPTANCE GATE** (slice `slice-acceptance-gate`): the
	 * slice-path mirror of the build Gate-2, riding {@link performIntegration}'s
	 * review-before-integrate block. When `review` resolves on, a FRESH-CONTEXT
	 * agent reviews the WHOLE produced slice SET (coherence / dependency graph /
	 * gaps + overlap / PRD-goal correct-if-implemented) BEFORE the slices integrate;
	 * `approve` lands them, `block` routes the set to needs-attention. It is
	 * controlled by the BUILD `--review`/`--no-review`/`--review-model` family (ONE
	 * gate-configuration story shared with the build path) and is ONE-SHOT —
	 * terminal pass/fail, NO rounds (it does NOT inherit `--review-max-rounds`; the
	 * caller drives it with a single reviewer invocation). It is DISTINCT from and
	 * independently controllable from the slicer improver loop ({@link reviewLoop} /
	 * the `--slicer-loop*` family).
	 */
	review?: boolean;
	/** The slice-SET acceptance-gate SEAM (injectable). Required when `review` is on. */
	reviewGate?: ReviewGate;
	/**
	 * The model the slice-SET acceptance-gate reviewer runs on (the BUILD
	 * `--review-model`, de-correlated from the slicer). DISTINCT from the improver
	 * loop's {@link slicerLoopModel} — see the note there.
	 */
	acceptanceReviewModel?: string;
	/** Injectable lock seam (tests stub acquire/release). Defaults to the real CAS. */
	lock?: SlicingLockSeam;
	/**
	 * **The per-repo SLICE-PLACEMENT default** (PRD
	 * `staging-pool-position-gate-and-trust-model` US #5, slice
	 * `runner-deterministic-slice-placement-policy-and-precedence`). The
	 * resolved per-repo default landing for the slicer's emitted slices, fed as
	 * the CONFIGURED-DEFAULT rung into the runner-deterministic placement
	 * resolver (`src/placement.ts`). The resolver overlays an EXPLICIT operator
	 * flag ({@link explicitSlicesLandIn}, top) and the UNTRUSTED-ORIGIN force
	 * (`originTrust: untrusted` ⇒ staging) on top. Unset ⇒ the resolver's
	 * built-in floor applies (`staging` = `pre-backlog/`, the conservative
	 * landing that preserves zero behaviour change for the normal path).
	 */
	slicesLandIn?: 'pre-backlog' | 'backlog';
	/**
	 * **The OPERATOR's EXPLICIT slice-placement override** (the TOP precedence
	 * rung). When set, the runner-deterministic resolver lands the slices HERE
	 * regardless of `originTrust` or {@link slicesLandIn} — the positional
	 * analogue of `explicitMerge` overriding the untrusted-origin
	 * build-propose rule ("the operator is present; CLI always wins, no special
	 * force-key"). Set ONLY when the operator typed `--slices-land-in <where>`;
	 * never when the value came from config.
	 */
	explicitSlicesLandIn?: 'pre-backlog' | 'backlog';
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
	 * The HARD CAP on the slicer improver loop's in-context review passes (N) —
	 * resolved per-repo (flag `--slicer-loop-max` > env > per-repo > global > cheap
	 * default). Only consulted when {@link reviewLoop} is set. Defaults to 3 (the
	 * cheap default) when omitted.
	 */
	slicerLoopMax?: number;
	/**
	 * How many fresh-context EXECUTIONS (M) of the loop to run — each a NEW launch in
	 * a fresh context. Default 1 (the cheap degenerate case). Only consulted when
	 * {@link reviewLoop} is set.
	 */
	reviewExecutions?: number;
	/**
	 * The model the IMPROVER loop's review agent runs on (de-correlated from the
	 * slicer; the `--slicer-loop-model` family). Loop only. DISTINCT from the
	 * acceptance gate's {@link acceptanceReviewModel} (build `--review-model`).
	 */
	slicerLoopModel?: string;
	/** Environment for child GIT/provider processes (the identity-scoped env). */
	env?: NodeJS.ProcessEnv;
	/**
	 * Environment for the AGENT launches (the slicer agent + the review/improver
	 * loop's review agent). Distinct from {@link env}: an AGENT must NOT carry the
	 * runner identity (only the runner's git transitions do). Unset ⇒ falls back to
	 * {@link env} (byte-for-byte unchanged for non-identity callers).
	 */
	agentEnv?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

const DEFAULT_ARBITER = 'origin';

/**
 * **The STAGED-SLICES dir** (PRD `staging-pool-position-gate-and-trust-model`,
 * slice `pre-backlog-staging-folder-and-promote-step-a`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). The runner
 * lands the slicer's emitted slice files HERE, NOT in `work/backlog/`: an item
 * born in `pre-backlog/` is durable + readable but NOT in the agent-eligible
 * pool (`work/backlog/` STILL means the pool — every reader is byte-for-byte
 * unchanged). A runner/human-owned promotion (`promoteFromPreBacklog` in
 * `needs-attention.ts`) moves an approved item `pre-backlog/ → backlog/` to make
 * it claimable. STEP A: ADDITIVE — no `work/backlog/` reader changes here.
 */
export const STAGED_SLICES_DIR = workFolderRel('pre-backlog');

/**
 * The POOL folder slices land in when the runner-deterministic placement
 * resolver chooses the pool side (`slicesLandIn: 'backlog'` and a trusted
 * origin, or an `--slices-land-in backlog` operator override). The agent NEVER
 * writes here — it always writes to {@link STAGED_SLICES_DIR}; the runner
 * redirects the emitted files to the resolved destination at integrate-stage
 * time. PRD US #4 / the governing ADR: the agent cannot self-place into the
 * pool. Slice `runner-deterministic-slice-placement-policy-and-precedence`.
 */
const POOL_SLICES_DIR = workFolderRel('backlog');

/** The placement slots for the SLICE lifecycle (folder names). */
const SLICE_PLACEMENT_SLOTS = {
	staging: STAGED_SLICES_DIR,
	pool: POOL_SLICES_DIR,
} as const;

/**
 * Map the `slicesLandIn` folder-name spelling (`pre-backlog` | `backlog`) onto
 * the resolver's lifecycle-generic side enum (`staging` | `pool`). Returns
 * `undefined` when no value is set, so the resolver's next precedence rung
 * applies (the built-in floor).
 */
function landingToSide(
	landing: 'pre-backlog' | 'backlog' | undefined,
): 'staging' | 'pool' | undefined {
	if (landing === 'pre-backlog') return 'staging';
	if (landing === 'backlog') return 'pool';
	return undefined;
}

/** The repo-relative path of a staged slice's `.md` (per {@link STAGED_SLICES_DIR}). */
function stagedSlicePath(name: string): string {
	return `${STAGED_SLICES_DIR}/${name}`;
}

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
	// `env` is the runner's GIT/provider env (identity-scoped). `agentEnv` is the
	// AMBIENT env for AGENT launches (slicer agent, review/improver agents) — an
	// agent must not act as the bot. Falls back to `env` when no identity.
	const env = options.env;
	const agentEnv = options.agentEnv ?? options.env;
	const slug = options.slug;
	const doer = options.doer ?? 'agent';
	const lock = options.lock ?? DEFAULT_LOCK_SEAM;

	// 0. The PRD must exist in the checkout (`work/prd/<slug>.md`) — it is the
	//    source the agent slices + the file the lock holds.
	const prdPath = workItemPath(cwd, 'prd', slug);
	if (!existsSync(prdPath)) {
		const message = `no PRD '${slug}' found at ${workFolderRel('prd')}/${slug}.md.`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', slug, message};
	}
	const prdContent = readFileSync(prdPath, 'utf8');
	const prdFm = parseFrontmatter(prdContent);

	// 1. RESOLVE THE GATE (agent path only). The human path is UNBOUND — a human
	//    decides for themselves whether a PRD is sliceable.
	if (doer === 'agent') {
		const eligibility = resolveAgentGate(
			cwd,
			slug,
			prdFm,
			options.autoSlice,
			options.explicit ?? false,
		);
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
	//     The PRD body rests in `work/prd/<slug>.md` on `<arbiter>/main` (the lock no
	//     longer moves it), so the branch's base HOLDS the held PRD — the lifecycle
	//     stage below moves it `prd/ → prd-sliced/` ON THIS BRANCH and the shared integrate core (`--propose`
	//     PR / `--merge` main) lands the whole transition, WITHOUT the lock release
	//     committing slices straight to `main`. The agent runs IN-PLACE on this branch
	//     (branch ≠ worktree; the isolation seam upgrades it). The HUMAN path stays on
	//     its own branch and commits its output itself (no integrate, no branch cut).
	if (useLock) {
		await switchToWorkBranch(cwd, arbiter, slug, env);
	}

	// 3. INVOKE THE AGENT with the to-slices brief. It WRITES
	//    `work/pre-backlog/*.md` slice files (the STAGED area — NOT `work/backlog/`,
	//    which is the agent-eligible pool the runner owns the promotion into; slice
	//    `pre-backlog-staging-folder-and-promote-step-a`); it does NO git. We
	//    snapshot the staged-slices folder before/after so the runner (not the
	//    agent) captures + commits exactly what was produced.
	const before = snapshotStagedSlices(cwd);
	// Also snapshot the POOL `work/backlog/` BEFORE the agent runs: the runner's
	// final commit must scrub any agent writes there (an attempt to self-place into
	// the pool, PRD US #4) before `git add -A` would sweep them in.
	const poolBefore = snapshotPool(cwd);
	const prompt = buildSlicingBrief(slug, prdFm.brief);
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
			// pre-existing staged slices that share `work/pre-backlog/`.
			before,
			slicerLoopMax: options.slicerLoopMax ?? 3,
			executions: options.reviewExecutions,
			slicerLoopModel: options.slicerLoopModel,
			sessionsDir: options.sessionsDir,
			// The improver loop's review AGENT launches AMBIENT, never the identity.
			env: agentEnv,
			note,
		});
		// DECOMPOSITION UNCLEAR: emit NO guessed slices — route the held PRD to
		// needs-attention with the questions as the reason. The lock release amends the
		// `prd:<slug>` unified lock `active → stuck` (the slicing needs-attention surface
		// is the stuck lock now — NO folder write; the PRD body stays in `work/prd/`).
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
	//    slices IN + move the PRD slicing/ -> prd-sliced/ (residence = sliced-ness) — now
	//    through the SHARED integrate core (`--propose` PR / `--merge` main), NOT a
	//    direct commit to `main`. The agent never does git. (The backlog snapshot is
	//    taken AFTER any loop edits, so the runner integrates the IMPROVED slices,
	//    not the pre-loop candidates.)
	const stagedEmitted = newOrChangedStagedSlices(cwd, before);
	const emitSlices = collectEmittedSlices(cwd, stagedEmitted);
	// RUNNER-DETERMINISTIC PLACEMENT (slice
	// `runner-deterministic-slice-placement-policy-and-precedence`). Resolve which
	// folder the runner lands the emitted slices in BEFORE handing them to the
	// shared integrate band: precedence `explicit > untrusted-origin ⇒ staging >
	// slicesLandIn > built-in (staging)`, all from unforgeable inputs (the PRD's
	// stamped `originTrust:` + the resolved per-repo default + the operator's
	// explicit flag). The agent NEVER influences this; it always writes to
	// `work/pre-backlog/`, and the runner redirects at `stage()` time.
	const placementDecision = resolvePlacement({
		explicit: landingToSide(options.explicitSlicesLandIn),
		originTrust: prdFm.originTrust,
		configuredDefault: landingToSide(options.slicesLandIn),
	});
	const placementDir = placementFolder(
		SLICE_PLACEMENT_SLOTS,
		placementDecision.choice,
	);
	// REWRITE the emitted list to the RUNNER-RESOLVED destination so callers see
	// where the runner actually placed the files (not where the agent wrote them).
	const emitted = stagedEmitted.map(
		(rel) => `${placementDir}/${basename(rel)}`,
	);
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
		// compare the CURRENTLY held `work/prd/<slug>.md` blob on the arbiter against
		// the snapshot the lock TOOK (`lockedBlob`); ANY change ⇒ STALE ⇒ fail loud,
		// touch NOTHING (the lock stays held; a human re-slices or routes to
		// needs-attention). It is the SAME content-identity check `releaseSlicingLock`
		// runs — relocated here because this transition, not the release, owns the
		// completing commit now.
		const stale = await heldPrdIsStale(cwd, arbiter, slug, lockedBlob, env);
		if (stale) {
			const message =
				`RELEASE CONFLICT for '${slug}': the PRD was edited (work/prd/${slug}.md ` +
				`changed on ${arbiter}/main) while the slicing lock was held. The slicing is ` +
				`STALE — re-slice from the edited PRD or route it to needs-attention. ` +
				`The arbiter was NOT modified (lock still held).`;
			note(message);
			return {exitCode: 4, outcome: 'stale', slug, message};
		}

		// Route the OUTPUT through the SHARED integrate back-half (slice
		// `slice-output-through-integration`): the produced backlog slices + the PRD
		// lifecycle move (`work/prd/ -> work/prd-sliced/`, residence = sliced-ness) integrate
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
			// Skip the build acceptance gate (Gate 1 / verify): a slicing transition has
			// no `verify` floor (the slicer review loop above is its quality gate).
			skipVerify: true,
			// THE SLICE-SET ACCEPTANCE GATE (slice `slice-acceptance-gate`): the
			// slice-path mirror of the build Gate-2, riding THIS shared core's
			// review-before-integrate block. When `review` resolves on, the wired
			// `reviewGate` (production: `harnessSliceReviewGate` with the slice-SET
			// prompt) runs a FRESH-CONTEXT review of the produced slice SET before it
			// integrates: `approve` lands it, `block` routes the set to needs-attention
			// via the SAME machinery the build block uses (mapped to the slicing
			// `needs-attention` outcome below). It is ONE-SHOT: we pin
			// `reviewMaxRounds: 1` so the gate is a SINGLE reviewer invocation → verdict
			// (terminal pass/fail). The slice path NEVER exposes/consults
			// `--review-max-rounds` — a gate is terminal, the rounds bound is an orphan
			// that belongs to a future revise↔review loop (see
			// `work/observations/reviewmaxrounds-on-wrong-concept.md`). This is
			// independently controllable from the slicer improver loop (`reviewLoop` /
			// the `--slicer-loop*` family); toggling one does not affect the other.
			review: options.review,
			reviewGate: options.reviewGate,
			reviewModel: options.acceptanceReviewModel,
			reviewMaxRounds: 1,
			// The EXPLICITLY-chosen integrate mode proceeds AS-IS on an APPROVE — a
			// `--merge` slicing run lands on main, `--propose` opens a PR. The slicing
			// path's merge-vs-propose decision is the `integration` mode the user typed;
			// `merge` IS the auto-land mode, so a resolved `merge` is never downgraded.
			// The slice gate family is `--review`/`--no-review`/`--review-model` only
			// (PRD US #6).
			mode: options.integration ?? 'propose',
			noPR: options.noPR,
			providerInstance: options.providerInstance,
			type: 'slicing',
			lifecycle: {
				// Read the PR title / commit summary from the held PRD (before it moves).
				titlePath: workItemPath(cwd, 'prd', slug),
				commitTag: 'sliced',
				stage: () =>
					stageSlicingLifecycle({
						cwd,
						slug,
						emitSlices,
						poolBefore,
						placementDir,
						placementReason: placementDecision.reason,
						note,
						env,
					}),
			},
			env,
			// The slice-SET acceptance review AGENT launches AMBIENT, never the
			// identity-scoped `env` (an agent must not act as the bot).
			agentEnv,
			note,
		});

		// THE SLICE-SET ACCEPTANCE GATE BLOCKED (slice `slice-acceptance-gate`): the
		// fresh-context review of the produced SET returned `block`, so the core ran
		// the review BEFORE the stage/integrate and did NOT integrate the slices
		// (correct). The CORRECT slice-path destination is the SAME needs-attention
		// route the lock release owns for the decomposition-unclear verdict: it amends
		// the `prd:<slug>` unified lock `active -> stuck` with the block reason (the
		// slicing needs-attention surface is the stuck lock now — NO folder write; the
		// PRD body stays in `work/prd/`). So on a block we route the held PRD to
		// needs-attention THROUGH the lock release — the set never lands.
		if (core.outcome === 'review-blocked') {
			const reason = sliceGateBlockedReason(slug, core.reviewBlockReason);
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
			note(reason);
			return {
				exitCode: 1,
				outcome: 'needs-attention',
				slug,
				message:
					`The slice acceptance gate blocked the set produced for '${slug}'; ` +
					`marked the per-item lock stuck (needs attention; no slices landed).`,
			};
		}
		if (core.outcome === 'completed') {
			// The durable `prd → prd-sliced` `main` move landed through the shared integrate
			// core (the body moved straight from `work/prd/` — no transient `slicing/`
			// marker). The completing commit is owned by the integrate band, NOT
			// `releaseSlicingLock`, so the unified per-item lock that `acquireSlicingLock`
			// took is released HERE (delete the ref). A
			// `propose` (`mode: 'propose'`) is ALSO `completed` (the PR opened, the lock's
			// hold over the in-flight slicing is done); the eventual hold-across-the-PR
			// crash-safe ordering is the capstone slice #7's concern, not this interim
			// half. Best-effort + idempotent (`not-held` is fine).
			if (useLock) {
				await releaseItemLock({item: `brief:${slug}`, cwd, arbiter, env});
			}
		}
		return integrationToSliceResult(core, {slug, emitted, loop: loopTag});
	}

	// HUMAN, no-lock path: the human commits on `main` directly (the runner does
	// not own the human's git). We report the produced slices; moving the PRD into
	// `work/prd-sliced/` (residence = sliced-ness) and committing is the human's to
	// do, as with the human `complete`.
	const message =
		`Sliced '${slug}' -> ${emitted.length} backlog slice` +
		`${emitted.length === 1 ? '' : 's'} (human path, no lock). Inspect + commit ` +
		`the produced files (and move the PRD into work/prd-sliced/) yourself.`;
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
 * a `gate-failed` cannot occur (the slicing path passes `skipVerify`) but maps to
 * a usage error defensively. A `review-blocked` (the slice-SET ACCEPTANCE GATE
 * blocked the set, slice `slice-acceptance-gate`) is handled by `performSlice`
 * BEFORE this mapper — it routes the held PRD `slicing/ -> needs-attention/` via
 * the lock release (the slice-path needs-attention route) — so it never reaches
 * here; it is mapped defensively to a usage error if it ever does.
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
			`through the shared core (moved work/prd/ -> work/prd-sliced/, the ` +
			`sliced resting state) and ${landed}.`;
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
 * AFTER the slicing lock is held, so the branch's base HOLDS the PRD in
 * `work/prd/` (the lock no longer moves the body) — the lifecycle stage then moves
 * it `prd/ -> prd-sliced/` ON THIS BRANCH and the shared integrate core lands it. A
 * pre-existing local `work/<slug>` (a re-run) is force-recreated off fresh main.
 * The agent runs in-place on this branch (branch ≠ worktree).
 */
async function switchToWorkBranch(
	cwd: string,
	arbiter: string,
	slug: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	// The slicing path is the PRD namespace (`do prd:<slug>`): the branch is
	// `work/prd-<slug>`, distinct from a same-slug slice-build's `work/slice-<slug>`.
	const branch = workBranchRef('brief', slug);
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
 * iff the CURRENTLY held `work/prd/<slug>.md` blob on `<arbiter>/main` DIFFERS
 * from the snapshot the lock TOOK (`lockedBlob`, read from `work/prd/<slug>.md` at
 * acquire). ANY change = a concurrent edit under the lock = the slicing is STALE.
 * Stronger than a textual rebase conflict (which a rename+edit merge can apply
 * CLEANLY). When `lockedBlob` is absent (never, in production) it reads as
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
		['rev-parse', `${arbiter}/main:${workFolderRel('prd')}/${slug}.md`],
		cwd,
		env,
	);
	// The PRD being absent (already sliced/moved) is NOT this check's concern
	// (the integrate's rebase/push surfaces that); only a CHANGED held blob is stale.
	if (held.status !== 0) {
		return false;
	}
	return held.stdout.trim() !== lockedBlob;
}

/**
 * STAGE the slicing lifecycle into the index on the `work/<slug>` branch (the
 * {@link performIntegration} lifecycle seam): move the held PRD
 * `git mv work/prd/<slug>.md -> work/prd-sliced/<slug>.md` (the SLICED resting
 * state — the build-machine `done/` analogue, the SOURCE OF TRUTH for sliced-ness),
 * and write+`git add` the produced `work/pre-backlog/*.md` files. The band's subsequent
 * `git add -A` + atomic commit folds this AND the agent's uncommitted backlog writes
 * into ONE runner-owned commit (the agent never does git).
 *
 * SLICE `prd-sliced-folder-step-a` (PRD `slicing-coherence` US #8): the lifecycle
 * destination is `work/prd-sliced/` (NOT back to `work/prd/`) — `prd-sliced/`
 * residence IS sliced-ness (like `done/` for slices, with no `done:` marker). The
 * `sliced:` frontmatter marker was removed entirely in `remove-sliced-marker-step-b`
 * (sequenced last): residence in `work/prd-sliced/` is now the sole signal.
 */
async function stageSlicingLifecycle(params: {
	cwd: string;
	slug: string;
	emitSlices: Record<string, string>;
	poolBefore: Map<string, string>;
	/**
	 * The runner-resolved destination folder (slice
	 * `runner-deterministic-slice-placement-policy-and-precedence`). Computed
	 * ONCE in `performSlice` via the shared {@link resolvePlacement} from the
	 * PRD's `originTrust:` stamp + the configured `slicesLandIn` default + the
	 * operator's explicit override, then passed in here — so the call site sees
	 * exactly where the emitted slices landed (the placement decision is not
	 * buried in the stage closure).
	 */
	placementDir: string;
	/** Which precedence rung the resolver took (for honest reporting). */
	placementReason:
		| 'explicit'
		| 'untrusted-origin'
		| 'configured-default'
		| 'built-in';
	note: (message: string) => void;
	env: NodeJS.ProcessEnv | undefined;
}): Promise<void> {
	const {
		cwd,
		slug,
		emitSlices,
		poolBefore,
		placementDir,
		placementReason,
		note,
		env,
	} = params;
	const prd = workItemRel('prd', `${slug}.md`);
	const prdSliced = workItemRel('prd-sliced', `${slug}.md`);
	// PROPAGATE the origin-trust PROVENANCE (slice
	// `untrusted-origin-forces-build-propose`): read the held PRD's `origin`/
	// `originTrust` stamp BEFORE the move, so each emitted slice can carry it. A
	// slice's risk is its BUILD; the stamp must reach the slice so the build
	// transition can force `propose` for untrusted-origin work. An UNSTAMPED PRD (a
	// human/local-authored one ⇒ trusted) propagates nothing — the normal path is
	// untouched.
	const prdAbs = join(cwd, prd);
	const prdProvenance = existsSync(prdAbs)
		? parseFrontmatter(readFileSync(prdAbs, 'utf8'))
		: {origin: undefined, originTrust: undefined};
	if (placementReason === 'untrusted-origin') {
		note(
			`Untrusted-origin PRD '${slug}': forcing the emitted slices STAGED ` +
				`(${placementDir}/) regardless of slicesLandIn (a human promotes ` +
				'them into work/backlog/). Pass --slices-land-in <where> to override.',
		);
	}
	// Move the held PRD prd/ -> prd-sliced/ (the SLICED resting state — folder =
	// source of truth, like done/ for slices). This is the DURABLE `prd → prd-sliced`
	// success move, owned by THIS transition's commit (the lock no longer moved the
	// body, so the source is `work/prd/`, never `work/slicing/`).
	mkdirSync(dirname(join(cwd, prdSliced)), {recursive: true});
	await gitHard(['mv', prd, prdSliced], cwd, env);
	await gitHard(['add', '--', prdSliced], cwd, env);
	// **POOL-PLACEMENT FENCE (PRD US #4 / governing ADR
	// `placement-is-runner-deterministic-humanonly-is-agent-judgement`).** The
	// agent ALWAYS writes to the STAGING folder (`work/pre-backlog/`); the POOL
	// (`work/backlog/`) is the agent-eligible pool the runner owns the promotion
	// into. Anything the agent dropped under the pool would otherwise be swept in
	// by `performIntegration`'s subsequent `git add -A` — a self-placement into
	// the pool. Scrub it FIRST (before the runner writes its resolved destination
	// files below), so when the runner-deterministic placement resolves to the
	// pool the runner's writes are the ONLY legitimate pool entries in the commit.
	await scrubPoolDrift(cwd, poolBefore, env);
	// Drop the produced backlog slices IN at the RUNNER-RESOLVED destination
	// (write + stage; the band's `git add -A` also catches them, but staging here
	// keeps the transition explicit + atomic). The runner STAMPS the propagated
	// provenance onto each slice as it writes it (the agent does no git; the runner
	// owns the file write here). When the resolved destination DIFFERS from where
	// the agent wrote (the staging folder), remove the agent's source file too —
	// otherwise `git add -A` would commit BOTH (staging twin + pool destination).
	for (const [agentRel, content] of Object.entries(emitSlices)) {
		const filename = basename(agentRel);
		const destRel = `${placementDir}/${filename}`;
		const destAbs = join(cwd, destRel);
		mkdirSync(dirname(destAbs), {recursive: true});
		writeFileSync(destAbs, propagateOrigin(prdProvenance, content));
		await gitHard(['add', '--', destRel], cwd, env);
		if (destRel !== agentRel) {
			const srcAbs = join(cwd, agentRel);
			rmSync(srcAbs, {force: true});
			// Also unstage if `git add --` from a previous run picked it up;
			// untracked-and-now-gone is fine.
			await gitSoft(['rm', '-f', '--quiet', '--', agentRel], cwd, env);
		}
	}
}

/**
 * Revert any change/addition the agent made to the POOL `work/backlog/` during a
 * slicing run. The agent's STAGING folder is `work/pre-backlog/`; a write to the
 * pool is an attempt to self-place into the agent-eligible pool the runner owns
 * the promotion into (PRD US #4 / governing ADR). Compared to the `poolBefore`
 * snapshot (the branch-base state of `work/backlog/`, taken BEFORE the agent
 * ran), any new file is removed from the worktree and any changed file is
 * checked back out to HEAD — so the subsequent `git add -A` cannot land it. The
 * runner's commit then carries ONLY the explicit `pre-backlog/` placement.
 */
async function scrubPoolDrift(
	cwd: string,
	poolBefore: Map<string, string>,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	const dir = workFolderPath(cwd, 'backlog');
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		if (!isWorkItemFile(name)) {
			continue;
		}
		const abs = join(dir, name);
		const content = readFileSync(abs, 'utf8');
		if (poolBefore.has(name)) {
			if (poolBefore.get(name) === content) {
				continue;
			}
			// The agent edited a pre-existing pool slice — restore it from HEAD.
			await gitSoft(
				['checkout', 'HEAD', '--', workItemRel('backlog', name)],
				cwd,
				env,
			);
			continue;
		}
		// The agent introduced a NEW file in the pool: drop it.
		rmSync(abs, {force: true});
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
 * Build the needs-attention REASON for a slice-SET ACCEPTANCE GATE block (slice
 * `slice-acceptance-gate`): the fresh-context review of the produced set returned
 * `block`, so the PRD is routed to `work/needs-attention/` with the review's
 * blocking findings as the body prose and NO slices landed. Takes the core's
 * structured `reviewBlockReason` (the gate's blocking findings); falls back to a
 * generic line when absent. DISTINCT from the improver loop's
 * {@link decompositionUnclearReason} (which carries the loop's open questions).
 */
function sliceGateBlockedReason(
	slug: string,
	findingsReason: string | undefined,
): string {
	const head =
		`The slice acceptance gate (fresh-context review of the produced SET) blocked ` +
		`'${slug}'. The PRD is routed to needs-attention with no slices landed; a human ` +
		`must resolve the blocking findings, then re-slice.`;
	return findingsReason ? `${head}\n\n${findingsReason}` : head;
}

/**
 * Build the needs-attention REASON for a decomposition-unclear loop verdict (the
 * PRD is routed to `work/needs-attention/` with these open questions, no guessed
 * slices). Prose only — recorded as the PRD's needs-attention body block.
 */
function decompositionUnclearReason(slug: string, questions: string[]): string {
	const head =
		`The slicer review→edit loop could not converge on a sound decomposition of ` +
		`'${slug}' (--slicer-loop-max exhausted with unresolved blockers). The PRD is routed ` +
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
 * file; the agent does no git/disk-escape. A path outside `work/pre-backlog/`
 * is skipped (defensive). A relative `work/pre-backlog/<slug>.md` that does not
 * exist is skipped with a note (never crash the transition).
 */
function markSliceNeedsAnswers(
	cwd: string,
	relPath: string,
	questions: string[],
	note: (message: string) => void,
): void {
	const normalized = relPath.replace(/\\/g, '/');
	if (
		!normalized.startsWith(`${STAGED_SLICES_DIR}/`) ||
		normalized.includes('..')
	) {
		note(
			`Skipped a needsAnswers mark outside ${STAGED_SLICES_DIR}/ (${relPath}).`,
		);
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
 * cross-PRD `briefAfter` ordering, resolved against `work/prd-sliced/` residence of
 * the PRDs present in the checkout.
 */
function resolveAgentGate(
	cwd: string,
	slug: string,
	prdFm: {humanOnly?: boolean; needsAnswers?: boolean; briefAfter: string[]},
	autoSlice: boolean | undefined,
	explicit: boolean,
): SlicingEligibilityResult {
	return resolveSlicingEligibility({
		humanOnly: prdFm.humanOnly,
		needsAnswers: prdFm.needsAnswers,
		briefAfter: prdFm.briefAfter,
		slicedSlugs: readSlicedSlugs(cwd),
		autoSlice: autoSlice ?? false,
		explicit,
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
	// The autoSlice POLICY only refuses on the NON-explicit (auto-pick pool) path:
	// an explicitly-named `do prd:<slug>` is authorized by the naming itself (the
	// build path's autoBuild precedent), so the policy is never the reason there.
	if (
		options.explicit !== true &&
		prdFm.humanOnly !== true &&
		prdFm.needsAnswers !== true &&
		(options.autoSlice ?? false) !== true
	) {
		reasons.push("the repo's autoSlice policy is off");
	}
	if (!eligibility.briefAfter.satisfied) {
		reasons.push(
			`briefAfter PRD(s) not yet sliced: ${eligibility.briefAfter.missing.join(', ')}`,
		);
	}
	const why =
		reasons.length > 0 ? reasons.join('; ') : 'the slicing gate refused';
	return `Skipped slicing '${slug}': ${why}.`;
}

/**
 * Read the set of slugs whose PRDs are already SLICED in this checkout — RESIDENCE
 * in `work/prd-sliced/` (the sliced resting state, slice `prd-sliced-folder-step-a`
 * / PRD `slicing-coherence` US #9), the build-machine `done/` analogue. The FOLDER
 * is the source of truth; the `sliced:` frontmatter marker was removed entirely in
 * `remove-sliced-marker-step-b` and is NOT consulted. So `briefAfter` resolves
 * against `prd-sliced/` residence
 * (mirroring `blockedBy` -> `done/`). A missing folder reads as empty. The slug is
 * read from each file's frontmatter `slug:`, falling back to the filename — the same
 * shape the slice readers use.
 */
function readSlicedSlugs(cwd: string): Set<string> {
	const slugs = new Set<string>();
	const dir = workFolderPath(cwd, 'prd-sliced');
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		slugs.add(fm.slug ?? file.replace(/\.md$/i, ''));
	}
	return slugs;
}

/** Build the `to-slices` brief the agent runs against the PRD. */
function buildSlicingBrief(slug: string, _prd: string | undefined): string {
	return [
		`Use the **to-slices** skill to slice the PRD \`work/prd/${slug}.md\` into`,
		`independently-grabbable \`${STAGED_SLICES_DIR}/<slug>.md\` slices (tracer-`,
		'bullet vertical slices). Read the PRD fully first.',
		'',
		`WRITE EVERY emitted slice file under \`${STAGED_SLICES_DIR}/\` — NEVER`,
		'`work/backlog/`. `work/backlog/` is the agent-eligible POOL and the runner',
		'owns the runner/human-only promotion into it; the slicer’s STAGING folder is',
		`\`${STAGED_SLICES_DIR}/\`. A write outside the staging folder is dropped.`,
		'',
		'No human is present, so do the CONFIDENCE CHECK (to-slices step 4): only emit',
		'slices you would have gotten a human to approve. If granularity, dependency',
		'order, a gate, or a seam is genuinely unresolved, set `needsAnswers: true`',
		'on the specific uncertain slice (questions in its body) rather than guessing.',
		'',
		'SLICE `humanOnly` IS NARROW. Only flag `humanOnly: true` on a slice when',
		'building THAT slice is genuinely never-for-agents BY NATURE (secrets/release/',
		'security/AGENTS.md prohibition) — a `humanOnly` slice is not agent-claimable',
		'EVEN from the pool `work/backlog/`. Do NOT stamp `humanOnly` to mean "a human',
		'should REVIEW this first": that is the POSITION’s job — every emitted slice',
		'is BIRTHED STAGED in `work/pre-backlog/` (not eligible), and a human promotes',
		'the approved ones into the pool. Review-first is the staging position; the',
		'overloaded "stamp `humanOnly` for review" reading is retired.',
		'',
		'WRITE the slice files only. Do NOT perform any git operations — do not stage,',
		'commit, push, or move any files. The RUNNER owns every git-state transition',
		'(it commits the produced slices, releases the slicing lock, and moves the PRD',
		'into work/prd-sliced/). Set each slice\u2019s `prd:` field to the source PRD slug so the link',
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
	// The slicer AGENT launches with the AMBIENT env (`agentEnv`), never the
	// identity-scoped `env` (an agent must not act as the bot). Falls back to `env`
	// when no identity is configured.
	const agentEnv = options.agentEnv ?? options.env;
	if (options.agentRunner) {
		return options.agentRunner({cwd, prompt, slug, env: agentEnv});
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
		env: agentEnv,
	});
	return {ok: launched.ok, detail: launched.detail};
}

/** A snapshot of {@link STAGED_SLICES_DIR}: filename → file content. */
function snapshotStagedSlices(cwd: string): Map<string, string> {
	const dir = join(cwd, STAGED_SLICES_DIR);
	const snap = new Map<string, string>();
	for (const file of listMarkdown(dir)) {
		snap.set(file, readFileSync(join(dir, file), 'utf8'));
	}
	return snap;
}

/**
 * Repo-relative paths of the {@link STAGED_SLICES_DIR}`/*.md` files the agent
 * NEWLY created or CHANGED vs the pre-run snapshot — exactly what the runner
 * captures + commits. (An untouched pre-existing staged slice is NOT
 * re-committed.) The agent's staging folder is `work/pre-backlog/`; writes to
 * the pool `work/backlog/` are scrubbed at stage time, never picked up here.
 */
function newOrChangedStagedSlices(
	cwd: string,
	before: Map<string, string>,
): string[] {
	const dir = join(cwd, STAGED_SLICES_DIR);
	const changed: string[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		if (before.get(file) !== content) {
			changed.push(stagedSlicePath(file));
		}
	}
	return changed.sort();
}

/** Snapshot the POOL `work/backlog/` (for the agent-write fence at stage time). */
function snapshotPool(cwd: string): Map<string, string> {
	const dir = workFolderPath(cwd, 'backlog');
	const snap = new Map<string, string>();
	for (const file of listMarkdown(dir)) {
		snap.set(file, readFileSync(join(dir, file), 'utf8'));
	}
	return snap;
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
	return entries.filter((name) => isWorkItemFile(name)).sort();
}
