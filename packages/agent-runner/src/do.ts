import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {performStart} from './start.js';
import {performComplete} from './complete.js';
import {performClaim} from './claim-cas.js';
import {resolveSlug, SlugResolutionError} from './slug-namespace.js';
import {performSlice, type SliceResult} from './slicing.js';
import type {SliceReviewGate} from './slicer-review-loop.js';
import {
	resolveSlice,
	buildAgentPrompt,
	resolveContinueContext,
	PromptError,
} from './prompt.js';
import {NullHarness, type Harness} from './harness.js';
import {PiHarness} from './pi-harness.js';
import {launchWithOptionalWatch} from './agent-launch.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {
	ledgerWrite,
	type ApplyNeedsAttentionTransitionResult,
} from './ledger-write.js';
import {
	jobWorktreeStrategy,
	selectIsolationStrategy,
	type IsolatedTree,
} from './isolation.js';
import {ensureMirror, encodeRepoKey} from './repo-mirror.js';
import type {IntegrationMode, ReviewProviderName} from './config.js';
import type {VerifyConfig} from './verify.js';
import type {ReviewGate} from './review-gate.js';
import {git, runAsync, localMainAheadCount} from './git.js';
import {
	parseStopSentinel,
	isWorkBranchDiffEmpty,
	emptyDiffStopReason,
} from './agent-stop.js';
import {
	classifyFailureCause,
	failureCauseLabel,
	type FailureCause,
} from './failure-cause.js';

/**
 * `agent-runner do <slug>` (in-place form) — the per-repo, in-place WORKER that
 * claims + builds + gates + integrates in ONE checkout, then EXITS (ADR §3).
 * **This is the CI command** (CI has a checkout, is one repo, is one triggered
 * invocation, exits) and it ABSORBS the manual `ar-run.sh` test-driver.
 *
 * In-place `do` is on the ISOLATION SEAM (`do-run-share-isolation-seam`): it is
 * the FIRST production consumer of `selectIsolationStrategy`/`inPlaceStrategy`,
 * so all THREE `do`/`run` forms (in-place `do`, `do --remote`, `run`) share the
 * ONE `IsolatedTree`-handle post-claim shape. The composition mirrors
 * `do --remote`/`run` exactly: keep the two in-place GUARDS (dirty-tree refusal
 * + pre-flight diverged-main guard) in this driver BEFORE onboarding, CLAIM
 * explicitly via the CAS (`performClaim`), then let
 * `selectIsolationStrategy({checkout}).prepare()` do the ONBOARDING half (fetch +
 * continue-detection + fresh-main `work/<slug>` switch, incl. the §14
 * continue/rebase + §10 conflict path) WITHOUT re-claiming. The agent run is the
 * ONLY new middle step (the one `ar-run.sh` shelled out for, `prompt | pi`). The
 * runner owns EVERY git-state transition (claim, done-move, completion commit,
 * integration); the agent only edits code.
 *
 * The in-place ISOLATION (ADR §3): the current checkout / CI container IS the
 * isolation — no hub mirror, no external worktree. `inPlaceStrategy.prepare()`
 * puts the checkout on `work/<slug>` cut from the freshly-fetched
 * `<arbiter>/main`; its handle's `teardown` is a NO-OP (the checkout is left in a
 * defined state on `work/<slug>`, NEVER reaped). `do --remote` (the job-worktree
 * strategy) is the SEPARATE `do-remote` slice; auto-pick / multi-arg / `-n` is
 * `do-autopick`.
 *
 * CLAIM SEMANTICS (autonomous, same as `do --remote`/`run`): the claim is
 * explicit and claim-or-lose. An item that is NOT in backlog on the arbiter
 * (already in-progress / done / absent) is not claimable, so the CAS returns
 * `lost` (exit 2) and the run skips cleanly — `do`, the unattended CI worker,
 * never re-claims an item someone else holds and never silently picks up a
 * needs-attention item (a human does that through the human face).
 *
 * **CRITICAL — `do` is AUTONOMOUS, so its failure path is `run`'s, NOT
 * `complete`'s.** On a red gate / rebase conflict, `performComplete` routes the
 * item to needs-attention via the SAME seam call as `run`'s `runOneItem`, but
 * `complete` calls it WITHOUT an arbiter (the human path: a human is right
 * there). `do` runs UNATTENDED, so it MUST get the autonomous, arbiter-passed
 * surfacing like `run` (the on-`main` cherry-pick that makes a stuck CI run
 * visible to `scan`/`status`/another machine). We achieve this by passing
 * `surfaceArbiter` into `performComplete` (resolution (a) from the slice): the
 * success path reuses `complete`'s machinery; only the NEEDS-ATTENTION routing
 * becomes the autonomous variant.
 *
 * `--propose` (default) / `--merge` is resolved at integrate-time exactly like
 * `complete` (the caller threads the resolved mode in as `integration`).
 */

/** The terminal status of one in-place `do` run. */
export type DoOutcome =
	| 'completed' // claimed/onboarded → agent → gate green → integrated → exited
	| 'lost' // claim lost the race — skipped cleanly
	| 'contended' // claim push kept being rejected
	| 'needs-attention' // red gate / rebase conflict / review-block → surfaced (autonomous)
	| 'agent-failed' // the agent ran but produced bad/empty output (the conservative generic), OR the cause is unknown — work SAVED + surfaced
	| 'transient-infra' // a harness-surfaced model/connection outage (post-retry) or a git/provider outage — RETRY the same work (FAILURE-CAUSE axis)
	| 'config-error' // a thrown CORE wiring/config error (e.g. review on, no reviewGate) — fix the WIRING, not the slice (FAILURE-CAUSE axis)
	| 'agent-stopped' // the agent DELIBERATELY stopped (slice drifted/ambiguous) OR produced no change → surfaced; gate + Gate-2 SKIPPED
	| 'refused' // refused (dirty tree, wrong folder, nothing to complete, …)
	| 'usage-error' // usage / environment problem, or a slug-resolution error
	| 'sliced' // `do prd:<slug>` — the PRD was sliced into work/backlog/ (runner-owned)
	| 'gate-refused' // `do prd:<slug>` — the slicing gate refused (honest skip)
	| 'stale'; // `do prd:<slug>` — the held PRD was edited under the lock (stale slicing)

export interface DoResult {
	exitCode: 0 | 1 | 2 | 3;
	outcome: DoOutcome;
	/** The resolved bare slug acted on (slice or PRD), when one was resolved. */
	slug?: string;
	/** The work branch the run operated on, when one was created/switched-to. */
	branch?: string;
	/**
	 * True iff a FAILURE (agent-failed) SAVED + surfaced the partial work via the
	 * needs-attention mechanism (committed the agent's work, pushed the
	 * `work/<slug>` branch, surfaced on the arbiter's main) rather than dropping it.
	 * Undefined/false on the success, lost/contended/refused, and usage-error paths.
	 */
	routedToNeedsAttention?: boolean;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/** The agent invocation: edits code in `cwd` to satisfy the prompt. */
export type DoAgentRunner = (input: {
	cwd: string;
	prompt: string;
	slug: string;
	env?: NodeJS.ProcessEnv;
}) => {
	ok: boolean;
	detail?: string;
	/**
	 * The agent's FINAL SUMMARY (the harness seam's `LaunchResult.output`): the
	 * channel the propose-mode PR BODY is built from. Optional so a test agent may
	 * supply a body; production surfaces the build agent's last assistant message.
	 * Absent ⇒ no body ⇒ the provider degrades to `--fill` (no regression).
	 */
	output?: string;
};

export interface DoOptions {
	/** The raw CLI slug argument: bare (= slice), `slice:<slug>`, or `prd:<slug>`. */
	arg: string;
	/** The working clone/checkout to run in-place in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/**
	 * Per-repo `autoSlice` policy (resolved by `autoslice-gate`: flag > env >
	 * per-repo > global > default false). Consumed ONLY by the `do prd:<slug>`
	 * slicing path — the agent gate refuses to auto-slice an undeclared PRD unless
	 * this is on. Ignored by the slice-build path.
	 */
	autoSlice?: boolean;
	/**
	 * **The slicer review→edit→converge LOOP seam** (`slicer-review-edit-loop`):
	 * consumed ONLY by the `do prd:<slug>` slicing path — after the agent produces
	 * candidate slices, run the `review` SKILL as a review→edit→re-review loop that
	 * improves them, routing the verdict through the needsAnswers / needs-attention
	 * sink. Ignored by the slice-build path. Omitted ⇒ no loop (candidate slices land
	 * as-is). Production wires {@link harnessSliceReviewGate}; tests inject a canned
	 * verdict+edits.
	 */
	reviewLoop?: SliceReviewGate;
	/** The slicer improver loop's `slicerLoopMax` cap (flag > env > per-repo > global > default). Loop only. */
	slicerLoopMax?: number;
	/** The slicer improver loop's de-correlated review model (`--slicer-loop-model`). Loop only. */
	slicerLoopModel?: string;
	/** How many fresh-context (M) executions of the slicer loop to run. Default 1. Loop only. */
	reviewExecutions?: number;
	/** Integration mode resolved at integrate-time (flag > per-repo > global > default). */
	integration?: IntegrationMode;
	/**
	 * Override the pre-flight DIVERGENCE guard (`--ignore-diverged-main`, mirroring
	 * `--ignore-not-ready`): proceed even when local `main` is ahead of
	 * `<arbiter>/main` (has unpushed commits). When overridden and the divergence
	 * persists, `complete`'s now-NON-FATAL local-main sync handles the outcome
	 * honestly (the work lands on the arbiter; local `main` is left for the operator
	 * to rebase). Loud, never the default.
	 */
	ignoreDivergedMain?: boolean;
	/** The declared per-repo acceptance gate (string | list). */
	verify?: VerifyConfig;
	/** Review-request provider override (propose mode); auto-detect when unset. */
	provider?: ReviewProviderName;
	/**
	 * **Gate 2 — the PR/code review gate** (GATES PRD `work/prd/review.md`):
	 * threaded VERBATIM into `performComplete` (the gate rides inside the shared
	 * `do`/`complete` pipeline, so CI inherits it for free). When `review` is on,
	 * the `review` SKILL runs as a fresh-context agent AFTER the green `verify` and
	 * BEFORE the done-move; a `block` maps to the `needs-attention` outcome the same
	 * way `gate-failed` does (exit 1). `autoMerge`/`reviewModel`/`reviewMaxRounds`
	 * tune it; `reviewGate` is the injectable seam (production: harness-backed).
	 */
	review?: boolean;
	autoMerge?: boolean;
	reviewModel?: string;
	reviewMaxRounds?: number;
	reviewGate?: ReviewGate;
	/**
	 * **The slice-SET ACCEPTANCE GATE seam** (slice `slice-acceptance-gate`):
	 * consumed ONLY by the `do prd:<slug>` slicing path. When `review` resolves on,
	 * a fresh-context review of the produced slice SET runs BEFORE the slices
	 * integrate (riding `performIntegration`'s review block); `block` routes the set
	 * to needs-attention, `approve` lets it integrate. It rides the SAME BUILD
	 * `--review`/`--no-review`/`--review-model` family as Gate-2 (one gate-config
	 * story) and is ONE-SHOT (no rounds; it does NOT inherit `reviewMaxRounds`). It
	 * is DISTINCT from the build {@link reviewGate} (a slice-SET prompt, not a code
	 * diff) and from the slicer improver loop ({@link reviewLoop}). Production wires
	 * `harnessSliceAcceptanceGate`; tests inject a canned verdict. Omitted ⇒ no gate.
	 */
	sliceReviewGate?: ReviewGate;
	/**
	 * The autonomous agent invocation. Tests inject this to edit files directly;
	 * production wires the harness seam (the prompt-fed, run-to-completion launch
	 * `run` uses). When omitted, {@link harness} is used.
	 */
	agentRunner?: DoAgentRunner;
	/** The harness seam used when `agentRunner` is omitted; defaults to the null adapter. */
	harness?: Harness;
	/**
	 * `do --watch`: stream the agent's high-signal events live by tailing the pi
	 * session `.jsonl` (slice `do-watch`, option (a)). A READ-ONLY observer — it
	 * NEVER changes the run's outcome, gate, integration, git, or exit code; only a
	 * concurrent log-tail is added. REQUIRES the pi harness (the null adapter has
	 * no session log to tail) — passing it with a non-pi harness is a usage error.
	 */
	watch?: boolean;
	/** The configured agent command the harness shells out to (null adapter). */
	agentCmd?: string;
	/** The model routing intent forwarded to the harness (ADR §13). */
	model?: string;
	/**
	 * The HOST-ONLY root folder under which this run's pi session FILE is generated
	 * (resolved `config.sessionsDir`; flag > env > global > default). `undefined`
	 * ⇒ pi's default per-cwd folder. Mapped from `Config` in `cli.ts`'s `do`
	 * action (the bridge from resolved config to the launch — without it the key
	 * resolves but never reaches pi).
	 */
	sessionsDir?: string;
	/** Override the read seam (slug resolution); defaults to {@link ledgerRead}. */
	read?: LedgerReadStrategy;
	/** Override the resolver's repo path (slug-namespace existence reads). Defaults to `cwd`. */
	repoPath?: string;
	/** Environment for child git/agent processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
	/**
	 * Sink for a pre-formatted block printed VERBATIM (forwarded to `complete`'s
	 * propose-mode next-step block). Defaults to `note`.
	 */
	noteBlock?: (message: string) => void;
	/** Emit ANSI color in `complete`'s (cosmetic) propose next-step block. */
	color?: boolean;
	/**
	 * Where `--watch`'s tailed events are written (defaults to stderr). Tests inject
	 * a sink to assert the surfaced lines without a real terminal.
	 */
	watchSink?: (line: string) => void;
}

/**
 * The agent-launch fields {@link runDoAgent} reads, shared by the in-place
 * {@link DoOptions} and the remote {@link DoRemoteOptions} (so one launch helper
 * serves both forms). A structural subset — both option shapes satisfy it.
 */
interface DoAgentLaunchOptions {
	agentRunner?: DoAgentRunner;
	harness?: Harness;
	agentCmd?: string;
	model?: string;
	sessionsDir?: string;
	watch?: boolean;
	watchSink?: (line: string) => void;
	color?: boolean;
	env?: NodeJS.ProcessEnv;
}

/**
 * Options for {@link performDoRemote} — `do --remote <r> <arg>`. It carries the
 * SAME pipeline knobs as {@link DoOptions} (integration / verify / review /
 * agent-launch), but selects a REGISTERED repo by `remote` (auto-mirrored) +
 * `workspacesDir` (the agents' execution area) INSTEAD of an in-place `cwd`:
 * there is no checkout, so the worktree is materialised under `workspacesDir`.
 */
export interface DoRemoteOptions extends DoAgentLaunchOptions {
	/** The raw CLI slug argument: bare (= slice), `slice:<slug>`, or `prd:<slug>`. */
	arg: string;
	/**
	 * The registered remote spec/URL to run against (`do --remote <r>`). Resolved
	 * to a hub mirror via `ensureMirror` (auto-created when unregistered).
	 */
	remote: string;
	/**
	 * The execution working area (config `workspacesDir`) — the AGENTS' area where
	 * the hub mirror + job worktree live. NEVER the human area.
	 */
	workspacesDir: string;
	/**
	 * Name of the arbiter remote, used ONLY for human-readable surfacing messages
	 * (the actual rebase/integrate/push target inside the worktree is `origin`, the
	 * bare mirror's clone remote). Defaults to `origin`.
	 */
	arbiter?: string;
	/**
	 * Per-repo `autoSlice` policy — consumed only by the `do --remote prd:<slug>`
	 * slicing path (the agent slicing gate). Ignored by the slice-build path.
	 */
	autoSlice?: boolean;
	/** The slicer review→edit→converge loop seam — `do --remote prd:<slug>` path only (see {@link DoOptions.reviewLoop}). */
	reviewLoop?: SliceReviewGate;
	/** The slicer improver loop's `slicerLoopMax` cap. Loop only. */
	slicerLoopMax?: number;
	/** The slicer improver loop's de-correlated review model (`--slicer-loop-model`). Loop only. */
	slicerLoopModel?: string;
	/** How many fresh-context (M) executions of the slicer loop to run. Default 1. Loop only. */
	reviewExecutions?: number;
	/** Integration mode resolved at integrate-time (flag > per-repo > global > default). */
	integration?: IntegrationMode;
	/** The declared per-repo acceptance gate (string | list). */
	verify?: VerifyConfig;
	/** Review-request provider override (propose mode); auto-detect when unset. */
	provider?: ReviewProviderName;
	/** Gate 2 (PR/code review) toggle — threaded verbatim into `performComplete`. */
	review?: boolean;
	autoMerge?: boolean;
	reviewModel?: string;
	reviewMaxRounds?: number;
	reviewGate?: ReviewGate;
	/** The slice-SET ACCEPTANCE GATE seam — `do --remote prd:<slug>` path only (see {@link DoOptions.sliceReviewGate}). */
	sliceReviewGate?: ReviewGate;
	/** Override the read seam (slug resolution); defaults to {@link ledgerRead}. */
	read?: LedgerReadStrategy;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
	/** Sink for a pre-formatted block (forwarded to `complete`'s next-step block). */
	noteBlock?: (message: string) => void;
}

const DEFAULT_ARBITER = 'origin';

/**
 * Map a `do prd:<slug>` {@link SliceResult} onto the `do` {@link DoResult}
 * contract: outcomes pass through (sliced / gate-refused / stale / agent-failed /
 * usage-error), the lock-lost outcome splits into `lost` (exit 2) vs `contended`
 * (exit 3) by its exit code, and the slicing-only exit 4 (stale) is reported on
 * the `do` exit contract (`0|1|2|3`) as exit 1 — the needs-attention-class
 * failure code, same as a stuck build.
 */
function sliceResultToDoResult(sliced: SliceResult): DoResult {
	let outcome: DoOutcome;
	let exitCode: 0 | 1 | 2 | 3;
	switch (sliced.outcome) {
		case 'sliced':
			outcome = 'sliced';
			exitCode = 0;
			break;
		case 'gate-refused':
			outcome = 'gate-refused';
			exitCode = 1;
			break;
		case 'lock-lost':
			if (sliced.exitCode === 3) {
				outcome = 'contended';
				exitCode = 3;
			} else {
				outcome = 'lost';
				exitCode = 2;
			}
			break;
		case 'stale':
			outcome = 'stale';
			exitCode = 1;
			break;
		case 'needs-attention':
			// The slicer review→edit loop found the decomposition unclear and routed the
			// PRD to needs-attention (no guessed slices). Same exit class as a stuck
			// build (1).
			outcome = 'needs-attention';
			exitCode = 1;
			break;
		case 'agent-failed':
			outcome = 'agent-failed';
			exitCode = 1;
			break;
		default:
			outcome = 'usage-error';
			exitCode = 1;
	}
	return {exitCode, outcome, slug: sliced.slug, message: sliced.message};
}

/**
 * Run the in-place `do` ritual end-to-end. Never throws for the expected
 * lost/contended/refused/needs-attention cases — those are returned with the
 * appropriate exit code and outcome. The runner owns all git; the agent only
 * edits code.
 */
export async function performDo(options: DoOptions): Promise<DoResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env;

	// 0. `--watch` REQUIRES the pi harness (slice `do-watch`): only the pi adapter
	//    writes a session `.jsonl` event log to tail. The null/shell adapter has no
	//    session log / event taxonomy, so there is nothing to observe — ERROR
	//    CLEARLY here, BEFORE any git transition (no claim, no branch), rather than
	//    silently running without the view. The injected `agentRunner` (tests /
	//    custom embeddings) is its own launch path and is exempt.
	if (
		options.watch === true &&
		options.agentRunner === undefined &&
		!(options.harness instanceof PiHarness)
	) {
		return {
			exitCode: 1,
			outcome: 'usage-error',
			message:
				'`do --watch` requires the pi harness; configure `harness: pi` or drop ' +
				'`--watch`.',
		};
	}

	// 1. Resolve the slug across BOTH namespaces — `do` is the ONE command that
	//    spans them (ADR §3a): bare → slice (after a no-PRD-collision check;
	//    ERROR on collision), `slice:`/`prd:` explicit. A collision / resolution
	//    failure is a loud usage error (exit 1).
	let resolved;
	try {
		resolved = resolveSlug({
			arg: options.arg,
			repoPath: options.repoPath ?? cwd,
			read: options.read ?? ledgerRead,
		});
	} catch (err) {
		if (err instanceof SlugResolutionError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}

	// 2. `do prd:<slug>` → the PRD-SLICING path (`autoslice-command`): the in-place
	//    `do` worker is AUTONOMOUS, so it slices as the AGENT (gate-bound + lock).
	//    The orchestration (gate → lock → to-slices harness → runner-owned commit)
	//    lives in `slicing.ts`; `do` dispatches `prd:` here. The agent only writes
	//    slice files — the runner owns every git transition (same boundary as the
	//    build path). It does NOT run the slice-build pipeline below.
	if (resolved.namespace === 'prd') {
		const sliced = await performSlice({
			slug: resolved.slug,
			cwd,
			arbiter,
			doer: 'agent',
			autoSlice: options.autoSlice,
			// The injected agent runner (tests) writes slice files directly. The
			// DoAgentRunner shape is a structural superset of SliceAgentRunner (its
			// extra `output` is ignored by the slicing path), so it threads straight in.
			agentRunner: options.agentRunner,
			harness: options.harness,
			agentCmd: options.agentCmd,
			model: options.model,
			sessionsDir: options.sessionsDir,
			// The integrate-time args (slice `slice-output-through-integration`): the
			// SAME `integration`/`provider` the slice-build path threads, so they resolve
			// ONCE in the shared `performIntegration` core (arg parity by construction).
			integration: options.integration,
			provider: options.provider,
			// The slicer review→edit→converge loop (slicer-review-edit-loop): improves the
			// candidate slices in place + routes the verdict through the needsAnswers /
			// needs-attention sink. Threaded only on the `do prd:` path; omitted ⇒ no loop.
			reviewLoop: options.reviewLoop,
			slicerLoopMax: options.slicerLoopMax,
			reviewExecutions: options.reviewExecutions,
			slicerLoopModel: options.slicerLoopModel,
			// The slice-SET ACCEPTANCE GATE (slice-acceptance-gate): rides the BUILD
			// `--review`/`--review-model` family — a fresh-context review of the produced
			// SET before it integrates, ONE-SHOT, independent of the improver loop above.
			review: options.review,
			reviewGate: options.sliceReviewGate,
			acceptanceReviewModel: options.reviewModel,
			env,
			note,
		});
		return sliceResultToDoResult(sliced);
	}

	const slug = resolved.slug;

	// 3. Refuse on a DIRTY working tree (ar-run.sh's first guard). `do` runs in a
	//    REAL checkout (the human's clone / the CI container); it must NOT
	//    entangle unrelated work or run over uncommitted changes. (Mirrors the
	//    bash driver: "error: working tree is dirty — commit/stash before
	//    running a slice.")
	if (await isDirtyTree(cwd, env)) {
		const message =
			`working tree is dirty — commit or stash before running '${slug}' ` +
			'(do runs in-place in this checkout and will not entangle unrelated ' +
			'changes).';
		return {exitCode: 1, outcome: 'refused', slug, message};
	}

	// 3b. Refuse on a DIVERGED local `main` (sibling to the dirty-tree refusal). A
	//     local `main` that is AHEAD of `<arbiter>/main` (unpushed commits) is the
	//     same class of "checkout state that breaks the in-place flow": the slice is
	//     built off `<arbiter>/main`, so the merge-back ff cannot fast-forward. Catch
	//     it UP FRONT — before the claim + agent run — so a whole build is not wasted.
	//     Fetch first (as the onboarding flow does), then compare. `--ignore-diverged
	//     -main` overrides (mirrors `--ignore-not-ready`); when overridden, Part 1's
	//     non-fatal sync handles the persisting divergence honestly at complete-time.
	if (options.ignoreDivergedMain !== true) {
		await runAsync('git', ['fetch', '--quiet', arbiter], cwd, {env});
		const ahead = await localMainAheadCount(cwd, arbiter, env);
		if (ahead > 0) {
			const message =
				`local main is ahead of ${arbiter}/main by ${ahead} commit` +
				`${ahead === 1 ? '' : 's'} (unpushed); the slice builds off ${arbiter}/main ` +
				"and the merge-back can't fast-forward — push or reconcile main first " +
				'(or re-run with --ignore-diverged-main to proceed anyway).';
			return {exitCode: 1, outcome: 'refused', slug, message};
		}
	}

	// 4. Onboard via the ISOLATION SEAM (`selectIsolationStrategy`/`inPlaceStrategy`)
	//    with the SAME claim-first composition `do --remote` (and `run`) use — this
	//    is the consumer that finally puts in-place `do` on the seam, so all THREE
	//    `do`/`run` forms share the one `IsolatedTree`-handle post-claim shape:
	//
	//      a. CLAIM explicitly via the CAS (the claim is the `do` driver's job,
	//         BEFORE prepare). A lost/contended/usage claim is propagated verbatim
	//         and NOTHING is onboarded — the same clean skip `run`/`do --remote` do.
	//         An already-in-progress / done / absent item is NOT claimable, so the
	//         CAS returns `lost` (exit 2): `do` (the autonomous CI worker) never
	//         re-claims an item someone else holds, exactly like its siblings.
	//      b. `selectIsolationStrategy({checkout})` → `inPlaceStrategy`, whose
	//         `prepare` does the ONBOARDING half (fetch + continue-detection +
	//         fresh-main `work/<slug>` switch, incl. the §14 continue/rebase path)
	//         WITHOUT re-claiming — the split the seam mandates (claim → driver,
	//         onboarding → strategy).
	const claim = await performClaim({slug, cwd, arbiter, env, note});
	if (claim.outcome === 'lost') {
		return {exitCode: 2, outcome: 'lost', slug, message: claim.message};
	}
	if (claim.outcome === 'contended') {
		return {exitCode: 3, outcome: 'contended', slug, message: claim.message};
	}
	if (claim.exitCode !== 0) {
		// usage/environment error (not inside a repo, no arbiter remote, dirty
		// index, …): surface verbatim. NOTHING was onboarded.
		return {exitCode: 1, outcome: 'usage-error', slug, message: claim.message};
	}

	// The claim landed (the item is now in-progress on the arbiter). Onboard the
	// checkout onto its work branch THROUGH the seam — the in-place strategy puts
	// `cwd` on `work/<slug>` off the freshly-fetched `<arbiter>/main` (or continues
	// a kept requeue branch + rebases it, §14/§10). `prepare` can throw on a genuine
	// plumbing failure (unreachable arbiter, …) — surface that as a usage error,
	// never a false success.
	let tree: IsolatedTree;
	try {
		tree = selectIsolationStrategy({checkout: cwd, arbiter}).prepare({
			slug,
			env,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', slug, message};
	}
	const branch = tree.branch;

	// 4a. CONTINUE rebase conflict (ADR §14 + §10): a requeue kept a `work/<slug>`
	//     that did not replay onto the current main at onboard-time (aborted, never
	//     auto-resolved). Route to needs-attention via the SAME seam `run`/
	//     `do --remote` use (surfaced on the arbiter; the kept branch is already on
	//     the arbiter) instead of running the agent — the §10 path. The work did NOT
	//     onboard; the runner owns the bounce.
	if (tree.continueRebaseConflict) {
		const reason =
			`continuing the kept work/${slug}: rebase onto the latest main ` +
			'conflicted (aborted, never auto-resolved) — resolve against the latest ' +
			'main, or `requeue --reset` to discard and start fresh';
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: tree.dir,
			slug,
			reason,
			arbiter: tree.arbiterRemote,
			env,
			note,
		});
		return {
			exitCode: 1,
			outcome: 'needs-attention',
			slug,
			branch,
			message: reason,
		};
	}

	// 5. Run the agent autonomously in the checkout, ON the work branch — the
	//    SAME prompt assembly `agent-runner prompt` emits (canonical wrapper +
	//    source PRD + the slice's ## Prompt). The agent only edits code (it does
	//    no git). This is the one NEW middle step `ar-run.sh` shelled out for
	//    (`prompt | pi`).
	//    The post-claim pipeline reads the uniform `IsolatedTree` handle (`tree.dir`)
	//    — in-place that IS `cwd`, but reading the handle keeps the shared shape the
	//    future advance-loop tick wraps (no in-place-only special case).
	let prompt: string;
	try {
		const slice = resolveSlice(tree.dir, slug);
		// CONTINUE-mode (the `agent-prompt-continue-context` slice): if the arbiter
		// holds a kept `work/<slug>` ahead of main (a requeue) the checkout was
		// CONTINUED onto it — inject the continue block (prior diff + reason + note).
		// REUSE the SAME continue-detection the onboarding path used (in-place clone
		// refs: `<arbiter>/work/<slug>` vs `<arbiter>/main`).
		const continueContext = resolveContinueContext({
			cwd: tree.dir,
			slug,
			arbiter: tree.arbiterRemote,
			branchRef: `${tree.arbiterRemote}/work/${slug}`,
			mainRef: `${tree.arbiterRemote}/main`,
			content: readFileSync(slice.path, 'utf8'),
			env,
		});
		prompt = buildAgentPrompt(slice.slug, slice.prd, slice.slicePrompt, {
			continueContext,
		});
	} catch (err) {
		if (err instanceof PromptError) {
			return await saveAgentFailure({
				slug,
				branch,
				cwd: tree.dir,
				arbiter: tree.arbiterRemote,
				detail: err.message,
				env,
				note,
			});
		}
		throw err;
	}

	let agent: {ok: boolean; detail?: string; output?: string};
	try {
		agent = await runDoAgent(options, tree.dir, prompt, slug);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return await saveAgentFailure({
			slug,
			branch,
			cwd: tree.dir,
			arbiter: tree.arbiterRemote,
			detail: message,
			env,
			note,
		});
	}
	if (!agent.ok) {
		const detail = agent.detail ?? `the agent failed to build '${slug}'.`;
		return await saveAgentFailure({
			slug,
			branch,
			cwd: tree.dir,
			arbiter: tree.arbiterRemote,
			detail,
			env,
			note,
		});
	}

	// 5b. HONOR a deliberate STOP (slice `agent-stop-signal`). The agent exited
	//     cleanly (`agent.ok`), but the CLAIM-PROTOCOL wrapper tells it to STOP and
	//     report on a DRIFTED/ambiguous/stale-premise slice WITHOUT building. Detect
	//     that BEFORE the gate via the in-band sentinel (the agent's reason is the
	//     needs-attention reason VERBATIM); a clean STOP with no source change is the
	//     deterministic empty-diff backstop. Either routes to needs-attention and
	//     SKIPS the acceptance gate AND Gate-2 — a clean STOP is NOT "a build that
	//     changed nothing".
	const stopReason = await resolveStopReason({
		output: agent.output,
		slug,
		cwd: tree.dir,
		arbiter: tree.arbiterRemote,
		env,
	});
	if (stopReason !== undefined) {
		return await saveAgentStop({
			slug,
			branch,
			cwd: tree.dir,
			arbiter: tree.arbiterRemote,
			reason: stopReason,
			env,
			note,
		});
	}

	// 6. Gate + done-move + commit + rebase + integrate + branch-tidy LIKE
	//    `complete` — but with the AUTONOMOUS needs-attention surfacing (pass
	//    `surfaceArbiter` so a red gate / rebase conflict surfaces on the
	//    arbiter's main, cross-machine visible — a stuck CI `do` that only routed
	//    locally would be invisible). The success path reuses `complete`'s
	//    machinery unchanged.
	const completed = await performComplete({
		slug,
		cwd: tree.dir,
		arbiter: tree.arbiterRemote,
		integration: options.integration,
		// `do` already ran the pre-flight divergence guard UP FRONT (step 3b), before
		// the claim + agent; skip `complete`'s redundant re-check. When `do` was run
		// with --ignore-diverged-main the guard was bypassed there too, so either way
		// the (now non-fatal) local-main sync handles any persisting divergence.
		ignoreDivergedMain: true,
		verify: options.verify,
		provider: options.provider,
		// Half B (propose-mode PR body): the build agent's FINAL SUMMARY, captured
		// from the harness seam's `LaunchResult.output` (surfaced by `runDoAgent`
		// below) and threaded as the PR description. `complete` scaffolds a
		// deterministic header (slice pointer) above it. Undefined ⇒ no body ⇒ the
		// provider degrades to `gh ... --fill` (no regression).
		body: agent.output,
		// Gate 2 (PR/code review) rides INSIDE `complete`: run the `review` SKILL as a
		// fresh-context agent after the green `verify` (the non-skippable floor) and
		// before the done-move. A `block` re-uses the same needs-attention surfacing
		// (`surfaceArbiter`) the red gate does; mapped to `needs-attention` below.
		review: options.review,
		autoMerge: options.autoMerge,
		reviewModel: options.reviewModel,
		reviewMaxRounds: options.reviewMaxRounds,
		reviewGate: options.reviewGate,
		// `--watch` (slice `watch-review-session`): tail the Gate-2 review agent's
		// session live too, AFTER the build stream the `runDoAgent` watch surfaced
		// (the gate prints a build→review boundary). Threaded into the gate launch via
		// `complete`; OFF ⇒ the review path is byte-identical (sync launch, no tailer).
		watch: options.watch,
		watchSink: options.watchSink,
		sessionsDir: options.sessionsDir,
		// The autonomous failure-surfacing: route stuck items to the arbiter's
		// main (the `run` semantics), NOT local-only (the human `complete`).
		surfaceArbiter: tree.arbiterRemote,
		color: options.color,
		note,
		noteBlock: options.noteBlock,
		env,
	});

	if (completed.outcome === 'completed') {
		return {
			exitCode: 0,
			outcome: 'completed',
			slug,
			branch,
			message: completed.message,
		};
	}
	if (
		completed.outcome === 'gate-failed' ||
		completed.outcome === 'review-blocked' ||
		completed.outcome === 'rebase-conflict'
	) {
		// Red gate / Gate-2 review block / rebase conflict — routed to needs-attention
		// (surfaced on the arbiter). A `review-blocked` is mapped HERE the SAME way
		// `gate-failed` is (the slice's "add a review-blocked terminal the same way /
		// fold into the existing needs-attention mapping"). The work did NOT complete;
		// the runner owns the bounce.
		return {
			exitCode: 1,
			outcome: 'needs-attention',
			slug,
			branch,
			message: completed.message,
		};
	}
	// refused (nothing to commit, wrong folder) / usage-error: surface verbatim —
	// BUT first reclassify a thrown CORE wiring/config error (which `performComplete`
	// swallows into `usage-error`) onto the SAME `config-error` cause `run` records,
	// closing the cross-path divergence (`do`: usage-error vs `run`: agent-failed for
	// the identical thrown core error). Best-effort: a non-config usage-error stays
	// `usage-error` (the conservative default — the classifier only re-labels what it
	// recognises).
	if (completed.outcome === 'usage-error') {
		const cause = classifyFailureCause(completed.message);
		if (cause === 'config-error') {
			return {
				exitCode: 1,
				outcome: 'config-error',
				slug,
				branch,
				message: completed.message,
			};
		}
	}
	const outcome: DoOutcome =
		completed.outcome === 'refused' ? 'refused' : 'usage-error';
	return {exitCode: 1, outcome, slug, branch, message: completed.message};
}

/**
 * Build the HONEST per-op fragment describing WHAT actually reached the arbiter
 * after a needs-attention route — reading the seam's captured per-op outcomes
 * (`surface`, `branchPush`) rather than ASSUMING "surfaced + pushed" off the
 * local move. Shared by every save-failure / save-stop message site so they can
 * never drift from reality (the observed bug: the report claimed "pushed" when
 * the branch push was skipped-empty or failed). A PUSH failure (HIGH severity:
 * work-at-risk / breaks cross-machine recovery) flips the fragment to a loud
 * "saved LOCALLY only" with recovery guidance.
 */
function routeReport(
	routed: ApplyNeedsAttentionTransitionResult,
	arbiter: string,
	branch: string,
): {fragment: string; pushFailed: boolean} {
	const surface = routed.surface ?? 'not-attempted';
	const branchPush = routed.branchPush ?? 'not-attempted';
	const surfaceFailed = surface === 'failed';
	const branchFailed = branchPush === 'failed';
	const pushFailed = surfaceFailed || branchFailed;

	if (pushFailed) {
		// HIGH severity: at least one push did not reach the arbiter — say so loudly,
		// the work is saved LOCALLY only, and how to recover.
		const parts: string[] = [];
		parts.push(
			surfaceFailed
				? `surface to ${arbiter}/main FAILED`
				: `surfaced on ${arbiter}/main`,
		);
		if (branchPush === 'skipped-empty') {
			parts.push(`branch ${branch} skipped (nothing to recover yet)`);
		} else if (branchFailed) {
			parts.push(`push of ${branch} FAILED`);
		} else if (branchPush === 'pushed') {
			parts.push(`pushed ${branch}`);
		}
		return {
			fragment:
				`${parts.join('; ')} — the work is saved LOCALLY only; push it when ` +
				'online, then `requeue` (continue), or `requeue --reset` to discard',
			pushFailed: true,
		};
	}

	// All pushes that were attempted succeeded (or were honestly skipped). Report
	// the surface + branch state truthfully.
	const parts: string[] = [];
	if (surface === 'surfaced') {
		parts.push(`surfaced on ${arbiter}/main`);
	}
	if (branchPush === 'pushed') {
		parts.push(`pushed ${branch}`);
	} else if (branchPush === 'skipped-empty') {
		parts.push(`branch ${branch} skipped (nothing to recover yet)`);
	}
	const landed = parts.length > 0 ? parts.join('; ') : 'saved locally';
	return {
		fragment: `${landed}. Recover via \`requeue\` (continue) or \`requeue --reset\` to discard`,
		pushFailed: false,
	};
}

/**
 * SAVE the partial work of a FAILED agent instead of dropping it (the keystone of
 * the `agent-fail-saves-work` slice). An agent failure (`runDoAgent` returned
 * `ok:false`, threw, or the prompt could not be assembled) used to BARE-RETURN
 * `agent-failed`, leaving whatever the agent edited only on the local work branch
 * in the (disposable, possibly remote) job worktree — silently lost.
 *
 * This routes it through the SAME work-preserving machinery a RED GATE uses: the
 * ledger write seam's needs-attention transition (`git add -A` + a wip commit
 * capturing the agent's work + the `git mv → needs-attention/` move-only commit
 * with the failure detail recorded as the reason in the body), surfaced on the
 * arbiter's `main` (the autonomous, cross-machine-visible mode-M surfacing `do`
 * already uses for the gate-fail path) so `scan`/`status`/another machine see it.
 *
 * It ALSO pushes the `work/<slug>` branch to the arbiter so the saved partial
 * commits travel cross-machine and the item is RECOVERABLE via `requeue`
 * (continue): the continue-detection in `continue-branch.ts` looks for an arbiter
 * `work/<slug>` ahead of main. That push now lives IN the ledger write seam (the
 * RECOVERABLE half of the needs-attention transition — fired when an `arbiter` is
 * given, best-effort, emptiness-guarded), consolidated there by
 * `centralise-bounce-branch-push` so it cannot drift from the OBSERVABLE surface;
 * this function no longer pushes separately.
 *
 * The EMPTY-failure case (the agent made NO commits / no changes) is handled
 * without crashing on an empty commit: `routeToNeedsAttention` (under the seam)
 * skips the wip commit when the tree is clean, and the move-only commit (reason +
 * the `git mv`) is always non-empty, so the failure reason is still surfaced.
 *
 * The OUTCOME is the classified failure CAUSE (the FAILURE-CAUSE axis): the
 * genuinely-new `transient-infra` / `config-error` where the surfaced detail makes
 * the cause knowable, else the conservative generic `agent-failed` (still distinct
 * from a clean success and from a red `gate-failed`/`needs-attention` — `do`'s exit
 * contract stays coherent). Only the WORK-PRESERVING side-effect (unchanged here)
 * matches the gate-failure path. We do NOT validate or "fix" the partial work — a broken
 * tree committed + surfaced (with the reason) is recoverable; the human chooses
 * `requeue` (continue) vs `requeue --reset` (discard).
 */
async function saveAgentFailure(params: {
	slug: string;
	branch: string | undefined;
	cwd: string;
	arbiter: string;
	detail: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<DoResult> {
	const {slug, cwd, arbiter, detail, env, note} = params;
	// The work branch is always `work/<slug>` (the onboarding switched the checkout
	// to it before the agent ran); derive it from the slug so the push target is
	// always defined even when the caller's `branch` was not narrowed.
	const branch = params.branch ?? `work/${slug}`;
	// Classify the failure CAUSE (best-effort + conservative) from the surfaced
	// detail — the SAME `classifyFailureCause` `run` uses, so `do`/`run` agree on the
	// same error. The cause LABEL prefixes the recorded reason so the cause is legible
	// on the needs-attention route without a second naming scheme; `agent-failed`
	// keeps the historical "agent failed:" prefix (no reason-prose regression).
	const cause = classifyFailureCause(detail);
	const reason = `${failureCauseLabel(cause)}: ${detail}`;

	// Route through the SAME seam the gate-fail path uses: save the agent's work as
	// a wip commit (skipped when the tree is clean — the empty-failure case),
	// `git mv` the item to needs-attention/ with the reason in the body, surface the
	// move-only commit on the arbiter's main (OBSERVABLE, mode-M, cross-machine
	// visible) AND push the `work/<slug>` branch (RECOVERABLE — so a requeue-continue
	// reading <arbiter>/work/<slug> lands on the saved wip). Both halves fire from
	// the single `arbiter` here; no separate push to forget.
	const routed = await ledgerWrite.applyNeedsAttentionTransition({
		cwd,
		slug,
		reason,
		arbiter,
		env,
		note,
	});

	const report = routed.moved
		? routeReport(routed, arbiter, branch)
		: undefined;
	const message = routed.moved
		? `Agent run failed building '${slug}' [${cause}] (${detail}); SAVED the ` +
			`partial work and routed it to work/needs-attention/ (${report!.fragment}).`
		: `Agent run failed building '${slug}' [${cause}] (${detail}); could not ` +
			`route to work/needs-attention/ (${routed.reasonNotMoved ?? 'unknown'}).`;
	note(message);
	return {
		exitCode: 1,
		outcome: failureCauseToDoOutcome(cause),
		slug,
		branch,
		routedToNeedsAttention: routed.moved,
		message,
	};
}

/**
 * Map a {@link FailureCause} onto the `do` {@link DoOutcome}. The cause names ARE
 * the outcome names (the FAILURE-CAUSE axis reuses the terminal vocabulary), so
 * this is identity — a single helper documents the mapping + keeps the `do`/`run`
 * sites symmetric (`run` has the twin {@link failureCauseToItemStatus}).
 */
function failureCauseToDoOutcome(cause: FailureCause): DoOutcome {
	return cause;
}

/**
 * Resolve the STOP reason for a clean (`agent.ok`) run, or `undefined` when the
 * run is a genuine build that should proceed to the gate (slice
 * `agent-stop-signal`). TWO independent triggers, the sentinel winning:
 *
 *   1. The IN-BAND STOP sentinel in the agent's output ({@link parseStopSentinel})
 *      — the principled case: the agent declared the slice drifted/ambiguous and
 *      reported WHY. Its reason is used VERBATIM (a non-empty diff with a sentinel
 *      is still a STOP — the agent may have left scratch; the sentinel wins).
 *   2. The DETERMINISTIC empty-diff backstop ({@link isWorkBranchDiffEmpty}) — the
 *      observable safety net for when the agent stopped WITHOUT (or with a
 *      malformed) sentinel: `agent.ok` but no source change vs `<arbiter>/main` is
 *      never a successful build.
 *
 * Shared by `performDo` and `runRemotePipeline` so the in-place and remote forms
 * detect a STOP identically.
 */
async function resolveStopReason(params: {
	output: string | undefined;
	slug: string;
	cwd: string;
	arbiter: string;
	env: NodeJS.ProcessEnv | undefined;
}): Promise<string | undefined> {
	const {output, slug, cwd, arbiter, env} = params;
	const sentinel = parseStopSentinel(output);
	if (sentinel !== undefined) {
		return sentinel.reason;
	}
	if (await isWorkBranchDiffEmpty({cwd, arbiter, env})) {
		return emptyDiffStopReason(slug);
	}
	return undefined;
}

/**
 * Route a DELIBERATE agent STOP (slice `agent-stop-signal`) to needs-attention
 * through the SAME work-preserving seam `saveAgentFailure` uses (save the branch,
 * surface on the arbiter) — but as the DISTINCT `agent-stopped` outcome, NOT
 * `agent-failed` (the agent did not error) nor `needs-attention` (no red gate /
 * rebase conflict). The agent's STOP reason is recorded VERBATIM as the
 * needs-attention reason. The acceptance gate AND Gate-2 are NEVER reached.
 */
async function saveAgentStop(params: {
	slug: string;
	branch: string | undefined;
	cwd: string;
	arbiter: string;
	reason: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<DoResult> {
	const {slug, cwd, arbiter, reason, env, note} = params;
	const branch = params.branch ?? `work/${slug}`;

	const routed = await ledgerWrite.applyNeedsAttentionTransition({
		cwd,
		slug,
		reason,
		arbiter,
		env,
		note,
	});

	const report = routed.moved
		? routeReport(routed, arbiter, branch)
		: undefined;
	const message = routed.moved
		? `The agent STOPPED building '${slug}' (the slice drifted / is ambiguous / ` +
			`produced no change); routed it to work/needs-attention/ (${report!.fragment}) ` +
			`WITHOUT running the gate or Gate-2 review. Reason: ${reason}`
		: `The agent STOPPED building '${slug}' but it could not be routed to ` +
			`work/needs-attention/ (${routed.reasonNotMoved ?? 'unknown'}). Reason: ${reason}`;
	note(message);
	return {
		exitCode: 1,
		outcome: 'agent-stopped',
		slug,
		branch,
		routedToNeedsAttention: routed.moved,
		message,
	};
}

/**
 * Run the agent against the checkout. Prefers the injected `agentRunner` (tests
 * / custom embeddings); otherwise launches `agentCmd` through the SHARED
 * {@link launchWithOptionalWatch} helper (the null adapter by default),
 * forwarding the model routing intent.
 *
 * With `--watch` (pi harness only, validated earlier), the helper launches the
 * agent NON-BLOCKING (`PiHarness.launchAsync` — `spawn`, not `spawnSync`) so a
 * `SessionTailer` can READ the growing session `.jsonl` concurrently and surface
 * the high-signal events live. The tailer is a pure observer: the launch result
 * is IDENTICAL to the non-watch path, so outcome / gate / git / exit code are
 * unchanged — only a concurrent log-tail is added.
 *
 * The build session-id is the SLUG (in-place `do` has no work-id), which the
 * helper makes unique per launch; the Gate-2 REVIEW launch uses the SAME helper
 * with a DISTINCT id (`<slug>-review`) so the two sessions never collide — one
 * watch implementation, two callers (slice `watch-review-session`).
 */
async function runDoAgent(
	options: DoAgentLaunchOptions,
	cwd: string,
	prompt: string,
	slug: string,
): Promise<{ok: boolean; detail?: string; output?: string}> {
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
		// In-place `do` has NO work-id, so the build session id is the slug.
		sessionId: slug,
		sessionsDir: options.sessionsDir,
		watch: options.watch,
		watchSink: options.watchSink,
		color: options.color,
		env: options.env,
	});
	// Surface the agent's FINAL SUMMARY (`LaunchResult.output`) — the source channel
	// for the propose-mode PR body — instead of dropping it. Absent (no parseable
	// assistant text) ⇒ undefined ⇒ the body degrades to `--fill` (no regression).
	return {ok: launched.ok, detail: launched.detail, output: launched.output};
}

/**
 * True when the working tree has uncommitted (unstaged OR staged) changes — the
 * dirty-tree refusal predicate (ar-run.sh: `git diff --quiet` AND
 * `git diff --cached --quiet`). Read-only.
 */
async function isDirtyTree(
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
	const unstaged = await runAsync('git', ['diff', '--quiet'], cwd, {env});
	if (unstaged.status !== 0) {
		return true;
	}
	const staged = await runAsync('git', ['diff', '--cached', '--quiet'], cwd, {
		env,
	});
	return staged.status !== 0;
}

/**
 * `agent-runner do --remote <r> <arg>` — the per-repo `do` WORKER run against a
 * REGISTERED repo with NO checkout (`docs/adr/command-surface-and-journeys.md`
 * §3). Where the in-place {@link performDo} uses the CURRENT checkout AS its
 * isolation, this form materialises a **hub mirror + job worktree in the AGENTS'
 * area** (`workspacesDir`, the SAME isolation `run` uses — NEVER the human area),
 * runs the existing `do` pipeline against that worktree, then tears it down per
 * the §4 provably-safe deletion predicate.
 *
 * **Option A — materialise-then-reuse** (the drift correction; the full
 * IsolatedTree-seam unification is the SEPARATE `do-run-share-isolation-seam`
 * slice). `performDo` composes the human verbs against a literal `cwd`; this
 * function does the same — it just points that `cwd` at a freshly-cut job
 * worktree instead of a checkout. It reuses (does NOT reimplement) the pipeline:
 * `performStart` (resume) → agent → `performComplete`.
 *
 * **The claim ↔ worktree ↔ start composition.** Both `createJob` (cuts the
 * `work/<slug>` branch off the mirror's fresh main) and `performStart` (claims +
 * switches to `work/<slug>`) overlap. To compose without double-claiming or
 * fighting over the branch we order them as the slice mandates:
 *
 *   1. **CLAIM FIRST** — the CAS push to the arbiter, run in a throwaway clone of
 *      the mirror (the CAS needs a non-bare checkout with an `origin/main`
 *      tracking ref + a worktree to commit in, which a bare mirror does not
 *      provide — exactly `work-on`'s remote-form claim context).
 *   2. **MATERIALISE the worktree** off the POST-CLAIM fresh main via the EXISTING
 *      job-worktree machinery (`jobWorktreeStrategy`/`createJob`): `createJob`
 *      re-`ensureMirror`s (fetching the claim move) then cuts `work/<slug>` off
 *      the freshly-fetched mirror main.
 *   3. **RUN start/agent/complete** against the worktree dir as `cwd`. `start` is
 *      driven with `resume: true` so it PLAIN-SWITCHES the branch `createJob`
 *      already created (the item is in-progress on the arbiter after the claim;
 *      `performStart`'s resume path switches without re-claiming) — no
 *      double-claim, no branch fight. The worktree's arbiter remote is `origin`
 *      (the bare mirror's clone remote), so both `start` and `complete` use
 *      `origin`.
 *
 * **Teardown** re-applies the §4 predicate via the strategy handle's `teardown`
 * (`reapJob`): reap the worktree iff clean AND on the arbiter, retain otherwise
 * (the never-lose-work signal). NEVER `--force`.
 *
 * **Recovery contract.** The worktree is disposable; the durable artifact is the
 * `work/<slug>` BRANCH (pushed by the autonomous needs-attention surfacing on a
 * stuck/failed run). A human recovers via the human face (`requeue` + re-claim,
 * or `work-on`), NEVER by editing the agents'-area worktree.
 */
export async function performDoRemote(
	options: DoRemoteOptions,
): Promise<DoResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const env = options.env;
	const workspacesDir = options.workspacesDir;

	// 0. `--watch` REQUIRES the pi harness (same guard as in-place `do`): only the
	//    pi adapter writes a session `.jsonl` to tail. Error CLEARLY here, BEFORE
	//    any mirror/claim/worktree side-effect. The injected `agentRunner` (tests)
	//    is its own launch path and is exempt.
	if (
		options.watch === true &&
		options.agentRunner === undefined &&
		!(options.harness instanceof PiHarness)
	) {
		return {
			exitCode: 1,
			outcome: 'usage-error',
			message:
				'`do --watch` requires the pi harness; configure `harness: pi` or drop ' +
				'`--watch`.',
		};
	}

	// 1. Resolve / auto-create the hub mirror for `<r>` (the `registry-remote` /
	//    `work-on`-remote precedent: an unregistered remote is auto-mirrored
	//    before use). `ensureMirror` creates it (`git clone --bare`) when absent
	//    or fetches it when present, under `workspacesDir/repos/` — the agents'
	//    area, NEVER the human area.
	let mirror;
	try {
		mirror = ensureMirror({url: options.remote, workspacesDir, env});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
	note(
		mirror.created
			? `Auto-registered hub mirror for ${mirror.url} at ${mirror.path}.`
			: `Using hub mirror for ${mirror.url} at ${mirror.path}.`,
	);

	// 2. A throwaway claim clone of the mirror (the CAS context). Slug resolution
	//    + the claim both run here against `origin` (the arbiter URL).
	const claimDir = join(
		workspacesDir,
		'claim',
		`${encodeRepoKey(mirror.url).split('/').join('__')}__remote`,
	);
	rmSync(claimDir, {recursive: true, force: true});
	mkdirSync(dirname(claimDir), {recursive: true});
	git(['clone', '--quiet', mirror.url, claimDir], dirname(claimDir), {env});

	try {
		// 2a. Resolve the slug across BOTH namespaces against the claim clone (it
		//     carries `work/` from the mirror's main). A collision / resolution
		//     failure is a loud usage error; a `prd:` arg reaches the not-yet-wired
		//     stub — identical behaviour to in-place `do`.
		let resolved;
		try {
			resolved = resolveSlug({
				arg: options.arg,
				repoPath: claimDir,
				read: options.read ?? ledgerRead,
			});
		} catch (err) {
			if (err instanceof SlugResolutionError) {
				return {exitCode: 1, outcome: 'usage-error', message: err.message};
			}
			const message = err instanceof Error ? err.message : String(err);
			return {exitCode: 1, outcome: 'usage-error', message};
		}

		if (resolved.namespace === 'prd') {
			// `do --remote prd:<slug>`: slice the PRD as the AGENT, against the claim
			// clone (its `origin` IS the arbiter URL + it carries a working tree from the
			// mirror's main). No job worktree is needed — the slicing transition is a
			// runner-owned `prd → slicing → prd` move + emit-backlog on the arbiter, not
			// a build pipeline. The agent only writes slice files; the runner does all git.
			const sliced = await performSlice({
				slug: resolved.slug,
				cwd: claimDir,
				arbiter: 'origin',
				doer: 'agent',
				autoSlice: options.autoSlice,
				agentRunner: options.agentRunner,
				harness: options.harness,
				agentCmd: options.agentCmd,
				model: options.model,
				sessionsDir: options.sessionsDir,
				// The integrate-time args (slice `slice-output-through-integration`): the
				// SAME `integration`/`provider` the slice-build path threads, so the
				// `--remote prd:` output ALSO routes through the shared core (arg parity).
				integration: options.integration,
				provider: options.provider,
				// The slicer review→edit→converge loop on the `do --remote prd:` path too.
				reviewLoop: options.reviewLoop,
				slicerLoopMax: options.slicerLoopMax,
				reviewExecutions: options.reviewExecutions,
				slicerLoopModel: options.slicerLoopModel,
				// The slice-SET ACCEPTANCE GATE on the `do --remote prd:` path too.
				review: options.review,
				reviewGate: options.sliceReviewGate,
				acceptanceReviewModel: options.reviewModel,
				env,
				note,
			});
			return sliceResultToDoResult(sliced);
		}
		const slug = resolved.slug;

		// 3. CLAIM FIRST (the CAS push to the arbiter), in the throwaway clone.
		//    `origin` there IS the arbiter URL. A lost/contended/usage claim is
		//    propagated verbatim — NO worktree is materialised (clean failure, like
		//    `run`'s `runOneItem`).
		const claim = await performClaim({
			slug,
			cwd: claimDir,
			arbiter: 'origin',
			env,
			note,
		});
		if (claim.outcome === 'lost') {
			return {exitCode: 2, outcome: 'lost', slug, message: claim.message};
		}
		if (claim.outcome === 'contended') {
			return {exitCode: 3, outcome: 'contended', slug, message: claim.message};
		}
		if (claim.exitCode !== 0) {
			return {
				exitCode: 1,
				outcome: 'usage-error',
				slug,
				message: claim.message,
			};
		}

		// 4. MATERIALISE the job worktree off the POST-CLAIM fresh main via the
		//    EXISTING job-worktree machinery (the SAME path `run` uses). `createJob`
		//    re-`ensureMirror`s (fetching the claim move) then cuts `work/<slug>`
		//    off the freshly-fetched mirror main, in the agents' area.
		const strategy = jobWorktreeStrategy({
			fromRepo: claimDir,
			arbiter: 'origin',
			workspacesDir,
		});
		let tree: IsolatedTree | undefined;
		try {
			tree = strategy.prepare({slug, env});
			return await runRemotePipeline(options, tree, slug, arbiter, note, env);
		} finally {
			// 7. Teardown via the strategy handle: reap iff clean AND on the arbiter,
			//    retain otherwise. NEVER --force. Always safe to call.
			if (tree) {
				tree.teardown();
			}
		}
	} finally {
		// Remove the throwaway claim clone either way.
		rmSync(claimDir, {recursive: true, force: true});
	}
}

/**
 * Run the existing `do` pipeline (start[resume] → agent → complete) against an
 * already-materialised job worktree. Mirrors {@link performDo}'s middle/back —
 * but `cwd` is the worktree and the arbiter remote inside it is `origin`. The
 * needs-attention surfacing is the AUTONOMOUS, arbiter-passed variant (like
 * `run`/in-place `do`): a stuck remote `do` must be cross-machine visible.
 */
async function runRemotePipeline(
	options: DoRemoteOptions,
	tree: IsolatedTree,
	slug: string,
	displayArbiter: string,
	note: (m: string) => void,
	env: NodeJS.ProcessEnv | undefined,
): Promise<DoResult> {
	const cwd = tree.dir;
	const arbiterRemote = tree.arbiterRemote; // `origin` (the bare mirror's clone).

	// 4a. CONTINUE rebase conflict (ADR §14 + §10): a requeue kept a `work/<slug>`
	//     that did not replay onto the current main at onboard-time (aborted, never
	//     auto-resolved). Route to needs-attention via the seam (surfaced on the
	//     arbiter + the kept branch already on the arbiter) instead of running the
	//     agent — the §10 path `run` uses.
	if (tree.continueRebaseConflict) {
		const reason =
			`continuing the kept work/${slug}: rebase onto the latest main ` +
			'conflicted (aborted, never auto-resolved) — resolve against the latest ' +
			'main, or `requeue --reset` to discard and start fresh';
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd,
			slug,
			reason,
			arbiter: arbiterRemote,
			env,
			note,
		});
		return {
			exitCode: 1,
			outcome: 'needs-attention',
			slug,
			branch: tree.branch,
			message: reason,
		};
	}

	// 5. HARDEN start to work against a job-worktree `cwd` (the load-bearing work).
	//    `performStart` reads/switches via the `<arbiter>/main` REMOTE-TRACKING ref
	//    (`origin/main` here). A job worktree is cut from a BARE hub mirror whose
	//    `origin` remote has NO fetch refspec, so `origin/main` /
	//    `origin/work/<slug>` would not otherwise resolve — and `start` would
	//    wrongly read the slug as "absent". Prime those two remote-tracking refs
	//    EXPLICITLY (the SAME technique `integrator.rebaseOntoArbiterMain` /
	//    `gc.fetchTracking` use against a bare-mirror worktree). After this the
	//    existing `performStart` runs UNCHANGED against the worktree.
	await primeWorktreeTrackingRef(cwd, arbiterRemote, 'main', env);
	await primeWorktreeTrackingRef(cwd, arbiterRemote, `work/${slug}`, env);

	// Onboard onto the work branch like in-place `do` — but the item is ALREADY
	// CLAIMED (step 3), so `performStart` runs with `resume: true`: it
	// PLAIN-SWITCHES the `work/<slug>` branch `createJob` already created WITHOUT
	// re-claiming (no double-claim, no branch fight). This proves `start` works
	// against a job-worktree `cwd`.
	const started = await performStart({
		slug,
		cwd,
		arbiter: arbiterRemote,
		resume: true,
		env,
		note,
	});
	if (started.outcome === 'needs-attention') {
		return {
			exitCode: 1,
			outcome: 'needs-attention',
			slug,
			branch: started.branch,
			message: started.message,
		};
	}
	if (started.exitCode !== 0) {
		const outcome: DoOutcome =
			started.outcome === 'refused' ? 'refused' : 'usage-error';
		return {exitCode: 1, outcome, slug, message: started.message};
	}
	const branch = started.branch;

	// 6. Build the prompt + run the agent autonomously in the worktree (the SAME
	//    assembly in-place `do` uses). The agent only edits code.
	let prompt: string;
	try {
		const slice = resolveSlice(cwd, slug);
		// CONTINUE-mode (job-worktree path): the worktree's tracking refs were primed
		// above (`primeWorktreeTrackingRef`), so reuse the SAME continue-detection with
		// the worktree's `<origin>/work/<slug>` vs `<origin>/main` refs.
		const continueContext = resolveContinueContext({
			cwd,
			slug,
			arbiter: arbiterRemote,
			branchRef: `${arbiterRemote}/work/${slug}`,
			mainRef: `${arbiterRemote}/main`,
			content: readFileSync(slice.path, 'utf8'),
			env,
		});
		prompt = buildAgentPrompt(slice.slug, slice.prd, slice.slicePrompt, {
			continueContext,
		});
	} catch (err) {
		if (err instanceof PromptError) {
			return await saveRemoteAgentFailure({
				slug,
				branch,
				cwd,
				arbiterRemote,
				displayArbiter,
				detail: err.message,
				env,
				note,
			});
		}
		throw err;
	}

	let agent: {ok: boolean; detail?: string; output?: string};
	try {
		agent = await runDoAgent(options, cwd, prompt, slug);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return await saveRemoteAgentFailure({
			slug,
			branch,
			cwd,
			arbiterRemote,
			displayArbiter,
			detail: message,
			env,
			note,
		});
	}
	if (!agent.ok) {
		const detail = agent.detail ?? `the agent failed to build '${slug}'.`;
		return await saveRemoteAgentFailure({
			slug,
			branch,
			cwd,
			arbiterRemote,
			displayArbiter,
			detail,
			env,
			note,
		});
	}

	// 6b. HONOR a deliberate STOP (slice `agent-stop-signal`) — the SAME detection
	//     in-place `do` runs, shared via `resolveStopReason`/`saveAgentStop`. A
	//     sentinel STOP (verbatim reason) or an empty work-branch diff routes to
	//     needs-attention (surfaced on the arbiter) and SKIPS the gate + Gate-2. The
	//     diff base is the worktree's `origin` (arbiterRemote).
	const stopReason = await resolveStopReason({
		output: agent.output,
		slug,
		cwd,
		arbiter: arbiterRemote,
		env,
	});
	if (stopReason !== undefined) {
		return await saveAgentStop({
			slug,
			branch,
			cwd,
			arbiter: arbiterRemote,
			reason: stopReason,
			env,
			note,
		});
	}

	// 7. Gate + done-move + commit + rebase + integrate LIKE in-place `do`: the
	//    AUTONOMOUS surfacing (`surfaceArbiter: origin`) so a red gate / rebase
	//    conflict / review block surfaces on the arbiter's main (cross-machine
	//    visible). The success path reuses `complete`'s machinery unchanged.
	const completed = await performComplete({
		slug,
		cwd,
		arbiter: arbiterRemote,
		integration: options.integration,
		// SCOPE: the divergence guard is in-place only. A job worktree is cut fresh off
		// the bare mirror and never ff's the operator's local main, so the guard does
		// not apply here — opt out explicitly (the slice: do NOT touch do --remote/run).
		ignoreDivergedMain: true,
		verify: options.verify,
		provider: options.provider,
		body: agent.output,
		review: options.review,
		autoMerge: options.autoMerge,
		reviewModel: options.reviewModel,
		reviewMaxRounds: options.reviewMaxRounds,
		reviewGate: options.reviewGate,
		watch: options.watch,
		watchSink: options.watchSink,
		sessionsDir: options.sessionsDir,
		surfaceArbiter: arbiterRemote,
		color: options.color,
		note,
		noteBlock: options.noteBlock,
		env,
	});

	if (completed.outcome === 'completed') {
		return {
			exitCode: 0,
			outcome: 'completed',
			slug,
			branch,
			message: completed.message,
		};
	}
	if (
		completed.outcome === 'gate-failed' ||
		completed.outcome === 'review-blocked' ||
		completed.outcome === 'rebase-conflict'
	) {
		return {
			exitCode: 1,
			outcome: 'needs-attention',
			slug,
			branch,
			message: completed.message,
		};
	}
	// Reclassify a thrown CORE wiring/config error (swallowed into `usage-error` by
	// `performComplete`) onto `config-error` — the SAME convergence in-place `do`
	// applies, so `do --remote` agrees with `do`/`run` on the same error too.
	if (completed.outcome === 'usage-error') {
		const cause = classifyFailureCause(completed.message);
		if (cause === 'config-error') {
			return {
				exitCode: 1,
				outcome: 'config-error',
				slug,
				branch,
				message: completed.message,
			};
		}
	}
	const outcome: DoOutcome =
		completed.outcome === 'refused' ? 'refused' : 'usage-error';
	return {exitCode: 1, outcome, slug, branch, message: completed.message};
}

/**
 * SAVE the partial work of a FAILED agent in a remote `do` worktree — the same
 * work-preserving routing in-place `do`'s {@link saveAgentFailure} uses, but
 * against the worktree's `origin` arbiter remote. The agent's edits + the failure
 * reason are committed + surfaced on the arbiter's main AND the `work/<slug>`
 * branch is pushed (the RECOVERABLE durable artifact — the disposable worktree is
 * NOT the recovery surface). The outcome is the classified failure CAUSE
 * (`transient-infra` / `config-error` / the generic `agent-failed`), same as the
 * in-place form.
 */
async function saveRemoteAgentFailure(params: {
	slug: string;
	branch: string | undefined;
	cwd: string;
	arbiterRemote: string;
	displayArbiter: string;
	detail: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<DoResult> {
	const {slug, cwd, arbiterRemote, displayArbiter, detail, env, note} = params;
	const branch = params.branch ?? `work/${slug}`;
	// Same best-effort cause classification as in-place `do`'s `saveAgentFailure`
	// (shared `classifyFailureCause`), so the remote form labels the SAME error the
	// SAME way too.
	const cause = classifyFailureCause(detail);
	const reason = `${failureCauseLabel(cause)}: ${detail}`;

	const routed = await ledgerWrite.applyNeedsAttentionTransition({
		cwd,
		slug,
		reason,
		arbiter: arbiterRemote,
		env,
		note,
	});

	const report = routed.moved
		? routeReport(routed, displayArbiter, branch)
		: undefined;
	const message = routed.moved
		? `Agent run failed building '${slug}' [${cause}] (${detail}); SAVED the ` +
			`partial work and routed it to work/needs-attention/ (${report!.fragment}).`
		: `Agent run failed building '${slug}' [${cause}] (${detail}); could not ` +
			`route to work/needs-attention/ (${routed.reasonNotMoved ?? 'unknown'}).`;
	note(message);
	return {
		exitCode: 1,
		outcome: failureCauseToDoOutcome(cause),
		slug,
		branch,
		routedToNeedsAttention: routed.moved,
		message,
	};
}

/**
 * Prime ONE arbiter head into its remote-tracking ref inside a job worktree
 * (`+refs/heads/<head>:refs/remotes/<arbiter>/<head>`). A job worktree is cut
 * from a BARE hub mirror whose `origin` remote has no fetch refspec, so
 * `<arbiter>/main` / `<arbiter>/work/<slug>` would not otherwise resolve — which
 * makes the (otherwise unchanged) `performStart` read the slug as absent. This is
 * the EXACT technique `integrator.rebaseOntoArbiterMain` + `gc.fetchTracking`
 * already use for the same bare-mirror-worktree reason. Best-effort: an
 * unreachable arbiter / a missing head leaves the local ref absent, which `start`
 * then handles (the FRESH branch already exists locally from `createJob`).
 */
async function primeWorktreeTrackingRef(
	cwd: string,
	arbiter: string,
	head: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	// SOFT (no throw): the head may not exist on the arbiter (e.g. a FRESH cut has
	// no pushed `work/<slug>` yet) — that is the common, expected case, and `start`
	// handles a missing remote-tracking ref (the local branch `createJob` created
	// is plain-switched). A genuine fetch error likewise leaves the ref absent →
	// the safe direction.
	await runAsync(
		'git',
		[
			'fetch',
			'--quiet',
			arbiter,
			`+refs/heads/${head}:refs/remotes/${arbiter}/${head}`,
		],
		cwd,
		{env},
	);
}
