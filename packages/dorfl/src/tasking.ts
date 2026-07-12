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
	resolveTaskingEligibility,
	type TaskingEligibilityResult,
} from './tasking-eligibility.js';
import {
	acquireTaskingLock,
	releaseTaskingLock,
	type AcquireTaskingLockOptions,
	type AcquireTaskingLockResult,
	type ReleaseTaskingLockOptions,
	type ReleaseTaskingLockResult,
} from './tasking-lock.js';
import {releaseItemLock} from './item-lock.js';
import {NullHarness, type Harness} from './harness.js';
import {launchWithOptionalWatch} from './agent-launch.js';
import {placementFolder, resolvePlacement} from './placement.js';
import {setNeedsAnswersMarker, propagateOrigin} from './frontmatter.js';
import {workBranchRef} from './slug-namespace.js';
import {
	runTaskReviewLoop,
	type TaskReviewGate,
	type RunTaskReviewLoopResult,
} from './tasker-review-loop.js';
import type {ReviewGate} from './review-gate.js';

/**
 * The **`do spec:<slug>` tasking path** (spec `auto-slice`, task
 * `autoslice-command`) — the orchestration that ties the tasking GATE
 * (`tasking-eligibility.ts`) and the tasking LOCK (`tasking-lock.ts`) together to
 * task a spec into `work/tasks/backlog/` STAGED items (task
 * `pre-backlog-staging-folder-and-promote-step-a` — the runner-owned promotion
 * moves them `pre-backlog/ → backlog/` later), with the RUNNER owning every git-state
 * transition. This is the spec branch of the `do` worker (ADR
 * `command-surface-and-journeys.md` §3/§3a), NOT a standalone `task` command;
 * `do.ts` dispatches `resolved.namespace === 'spec'` here.
 *
 * The end-to-end flow (mirroring the `do`/`run` runner-owns-git discipline — the
 * agent only EDITS files, the runner does ALL git):
 *
 *   1. **Resolve the gate** (agent path): refuse to task a spec that is
 *      `humanOnly`/`needsAnswers`, or whose `taskedAfter` specs are not yet tasked.
 *      The repo's `autoTask` POLICY also refuses on the AUTO-PICK pool path, but
 *      NOT when the spec was named EXPLICITLY (`do spec:<slug>`, `explicit: true`):
 *      naming it IS the authorization, exactly as `do <task>` builds regardless of
 *      `autoBuild` (the pool, not the explicit claim, gates the policy). The HUMAN
 *      path is unbound by the gate entirely.
 *   2. **Acquire the lock** (agent path) via the unified per-item lock CAS —
 *      serialising concurrent taskers on the `spec:<slug>` ref (the body STAYS in
 *      `work/specs/ready/`; the lock no longer moves it). The HUMAN path with no contention
 *      may task on `main` directly WITHOUT the lock.
 *   3. **Invoke the agent harness** with the `to-task` spec — the agent runs the
 *      tasker methodology and produces `work/tasks/backlog/<slug>.md` FILES ONLY; it does
 *      NOT commit/push/move (the same in-band boundary as the build agent).
 *   4. **The runner integrates the COMPLETING transition through the SHARED core**
 *      (`performIntegration`, task `slice-output-through-integration`): the agent's
 *      tasking runs on a `work/<slug>` branch cut from `<arbiter>/main` (whose base
 *      holds the spec in `work/specs/ready/`), and the produced backlog tasks + the durable
 *      spec lifecycle move (`work/specs/ready/ → work/specs/tasked/`)
 *      integrate via the band honoring `--propose` (push the branch + open a
 *      PR, NO `main` touch) / `--merge` (land on `main`). Because the integrate-time
 *      args resolve ONCE in the shared core, EVERY `do task:` integrate arg applies
 *      to `do spec:` by construction. A content-identity STALE CHECK (the lock's
 *      read-stability backstop) fires FIRST against the acquire-time `lockedBlob`,
 *      so a concurrent edit of the held spec still fails loud (`stale`).
 *
 * The tasking LOCK (`tasking-lock.ts`, `acquireTaskingLock`/`releaseTaskingLock`)
 * is the UNIFIED per-item lock (`refs/dorfl/lock/<entry>`, `action: task`)
 * — the transient `tasking/` folder marker is RETIRED (task
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`). The lock
 * RELEASE owns the needs-attention redirect for the loop's decomposition-unclear
 * verdict (it amends the lock `active → stuck` — no folder write); only the SUCCESS
 * output integrates through the shared core. This path
 * does NOT build the no-human confidence routing — that is the review/edit loop
 * owned by `slicer-review-edit-loop`; this path produces + integrates the tasks.
 */

/** The terminal status of one `do spec:<slug>` tasking run. */
export type TaskOutcome =
	| 'tasked' // gate passed (agent) / unbound (human) → lock → agent → committed
	| 'gate-refused' // the agent gate refused (humanOnly/needsAnswers/autoTask/taskedAfter)
	| 'lock-lost' // the lock was lost/contended (another tasker holds it)
	| 'agent-failed' // the agent invocation itself errored
	| 'stale' // the held spec was edited under the lock → the tasking is stale
	| 'needs-attention' // the tasker edit loop found the decomposition unclear → spec routed to needs-attention (no tasks)
	| 'usage-error'; // usage / environment problem (missing spec, bad release, …)

export interface TaskResult {
	exitCode: 0 | 1 | 2 | 3 | 4;
	outcome: TaskOutcome;
	/** The spec slug acted on. */
	slug: string;
	/** Repo-relative paths of the backlog tasks the runner committed. */
	emitted?: string[];
	/**
	 * The tasker review→edit LOOP's disposition (`slicer-review-edit-loop`), when
	 * the loop ran. `converged` = the improved tasks landed; `uncertain-tasks` =
	 * the cap was hit and specific tasks landed `needsAnswers: true`; absent when
	 * no loop ran or the spec was routed to needs-attention (`outcome:
	 * 'needs-attention'`).
	 */
	loop?: 'converged' | 'uncertain-tasks';
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/**
 * The agent invocation: runs the `to-task` spec in `cwd`, WRITING
 * `work/tasks/backlog/<slug>.md` task files (and trimming the spec). It does NO git —
 * the runner captures the produced files and commits them.
 */
export type TaskDorfl = (input: {
	cwd: string;
	prompt: string;
	slug: string;
	env?: NodeJS.ProcessEnv;
}) => {ok: boolean; detail?: string};

/** Injectable lock seams (production: the real CAS; tests: stubs). */
export interface TaskingLockSeam {
	acquire(
		options: AcquireTaskingLockOptions,
	): Promise<AcquireTaskingLockResult>;
	release(
		options: ReleaseTaskingLockOptions,
	): Promise<ReleaseTaskingLockResult>;
}

const DEFAULT_LOCK_SEAM: TaskingLockSeam = {
	acquire: acquireTaskingLock,
	release: releaseTaskingLock,
};

export interface PerformTaskOptions {
	/** The spec slug to task (`work/specs/ready/<slug>.md`). */
	slug: string;
	/** The working clone/checkout the tasking runs in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/**
	 * The DOER: `'agent'` (the default; bound by the gate, MUST take the lock) or
	 * `'human'` (unbound by the gate; with no contention tasks on `main` directly
	 * WITHOUT the lock). The human-vs-agent choice the command wires.
	 */
	doer?: 'agent' | 'human';
	/** Per-repo `autoTask` policy (resolved by `autoslice-gate`). Agent path only. */
	autoTask?: boolean;
	/**
	 * The spec was named EXPLICITLY by the operator (`do spec:<slug>`), so the
	 * `autoTask` POLICY is already satisfied — naming the spec IS the authorization,
	 * EXACTLY as `do <task>` builds a named task regardless of `autoBuild` (the
	 * build path's precedent: `autoBuild` gates the scan/selection POOL only, never
	 * `performDo`'s explicit claim). When `true`, the agent tasking gate drops the
	 * `autoTask` policy term and binds ONLY the spec's own readiness axes
	 * (`humanOnly`/`needsAnswers`) + `taskedAfter`. Defaults `false`. Both the
	 * explicit `do spec:` dispatch AND the auto-pick path pass `true` here: the
	 * auto-pick POOL (`do-autopick.ts`) is the single `autoTask`-enforcement point
	 * (a pool-ineligible spec is never selected), so once a spec is dispatched its
	 * policy is already settled. Agent path only.
	 */
	explicit?: boolean;
	/**
	 * The agent invocation. Tests inject this to write task files directly;
	 * production wires the harness seam. When omitted, {@link harness} is used.
	 */
	dorfl?: TaskDorfl;
	/** The harness seam used when `dorfl` is omitted; defaults to the null adapter. */
	harness?: Harness;
	/** The configured agent command the harness shells out to (null adapter). */
	agentCmd?: string;
	/** The model routing intent forwarded to the harness (ADR §13). */
	model?: string;
	/** The HOST-ONLY sessions root for the pi session file. */
	sessionsDir?: string;
	/**
	 * The integration mode the produced tasks integrate THROUGH the shared core
	 * with (task `slice-output-through-integration`): `propose` (default — push the
	 * `work/<slug>` branch + open a PR carrying the tasks, NO `main` touch) or
	 * `merge` (land them on `main`). Resolved ONCE in {@link performIntegration},
	 * so EVERY `do task:` integrate-time arg applies to `do spec:` by construction.
	 * The AGENT path only; the human path commits its own output. Defaults to the
	 * system default (`propose`).
	 */
	integration?: IntegrationMode;
	/**
	 * **The PR-INTENT axis** (config `noPR`, ADR §6): when `true`, propose pushes
	 * the produced task branch but skips the PR (the explicit suppress-PR intent).
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
	 * **The task-SET ACCEPTANCE GATE** (task `slice-acceptance-gate`): the
	 * task-path mirror of the build Gate-2, riding {@link performIntegration}'s
	 * review-before-integrate block. When `review` resolves on, a FRESH-CONTEXT
	 * agent reviews the WHOLE produced task SET (coherence / dependency graph /
	 * gaps + overlap / spec-goal correct-if-implemented) BEFORE the tasks integrate;
	 * `approve` lands them, `block` routes the set to needs-attention. It is
	 * controlled by the BUILD `--review`/`--no-review`/`--review-model` family (ONE
	 * gate-configuration story shared with the build path) and is ONE-SHOT —
	 * terminal pass/fail, NO rounds (it does NOT inherit `--review-max-rounds`; the
	 * caller drives it with a single reviewer invocation). It is DISTINCT from and
	 * independently controllable from the tasker improver loop ({@link reviewLoop} /
	 * the `--tasker-loop*` family).
	 */
	review?: boolean;
	/** The task-SET acceptance-gate SEAM (injectable). Required when `review` is on. */
	reviewGate?: ReviewGate;
	/**
	 * The model the task-SET acceptance-gate reviewer runs on (the BUILD
	 * `--review-model`, de-correlated from the tasker). DISTINCT from the improver
	 * loop's {@link taskerLoopModel} — see the note there.
	 */
	acceptanceReviewModel?: string;
	/**
	 * **The cross-job merge-serialiser CAS-retry cap** (config `mergeRetries`, spec
	 * `land-time-reverify-and-parallel-merge-ceiling` Story 5 / Applied Answer q1
	 * (a)). Threaded VERBATIM into {@link performIntegration} so a wide-matrix CI's
	 * raised cap actually reaches the cross-job land queue (the CAS loop IS the
	 * queue across separate jobs) on the `do spec:<slug>` tasking-transition path
	 * too. Resolved ONCE at the entry point through the gate-family precedence chain
	 * (flag > env > per-repo > global > default), same as `complete`/`do`/`run`.
	 * Unset ⇒ falls through to the engine's `DEFAULT_MERGE_RETRIES = 1000`
	 * (byte-for-byte unchanged).
	 */
	mergeRetries?: number;
	/** Injectable lock seam (tests stub acquire/release). Defaults to the real CAS. */
	lock?: TaskingLockSeam;
	/**
	 * **The per-repo TASK-PLACEMENT default** (spec
	 * `staging-pool-position-gate-and-trust-model` US #5, task
	 * `runner-deterministic-slice-placement-policy-and-precedence`). The
	 * resolved per-repo default landing for the tasker's emitted tasks, fed as
	 * the CONFIGURED-DEFAULT rung into the runner-deterministic placement
	 * resolver (`src/placement.ts`). The resolver overlays an EXPLICIT operator
	 * flag ({@link explicitTasksLandIn}, top) and the UNTRUSTED-ORIGIN force
	 * (`originTrust: untrusted` ⇒ staging) on top. Unset ⇒ the resolver's
	 * built-in floor applies (`staging` = `pre-backlog/`, the conservative
	 * landing that preserves zero behaviour change for the normal path).
	 */
	tasksLandIn?: 'pre-backlog' | 'ready';
	/**
	 * **The OPERATOR's EXPLICIT task-placement override** (the TOP precedence
	 * rung). When set, the runner-deterministic resolver lands the tasks HERE
	 * regardless of `originTrust` or {@link tasksLandIn} — the positional
	 * analogue of `explicitMerge` overriding the untrusted-origin
	 * build-propose rule ("the operator is present; CLI always wins, no special
	 * force-key"). Set ONLY when the operator typed `--tasks-land-in <where>`;
	 * never when the value came from config.
	 */
	explicitTasksLandIn?: 'pre-backlog' | 'ready';
	/**
	 * **The tasker review→edit→converge LOOP** (`slicer-review-edit-loop`, GATES spec
	 * `work/specs/ready/review.md` RESOLVED DESIGN — Shape 2 / insertion point A). When
	 * provided, AFTER the agent produces candidate tasks (step 3) and BEFORE the
	 * runner finalises them (step 4), run the `review` SKILL as a review→edit→
	 * re-review loop that IMPROVES the candidate tasks in place, then routes the
	 * verdict through the three outcomes (converge→land / uncertain-task→
	 * needsAnswers / decomposition-unclear→spec-to-needs-attention). The seam is the
	 * review+edit gate (tests inject a canned verdict+edits; production:
	 * {@link harnessTaskReviewGate}). Omitted ⇒ NO loop (the candidate tasks land
	 * as-is — the pre-loop behaviour). The HUMAN path is unaffected (the loop runs
	 * on the auto-tasker's output only — see the gating in {@link performTask}).
	 */
	reviewLoop?: TaskReviewGate;
	/**
	 * The HARD CAP on the tasker improver loop's in-context review passes (N) —
	 * resolved per-repo (flag `--tasker-loop-max` > env > per-repo > global > cheap
	 * default). Only consulted when {@link reviewLoop} is set. Defaults to 3 (the
	 * cheap default) when omitted.
	 */
	taskerLoopMax?: number;
	/**
	 * How many fresh-context EXECUTIONS (M) of the loop to run — each a NEW launch in
	 * a fresh context. Default 1 (the cheap degenerate case). Only consulted when
	 * {@link reviewLoop} is set.
	 */
	reviewExecutions?: number;
	/**
	 * The model the IMPROVER loop's review agent runs on (de-correlated from the
	 * tasker; the `--tasker-loop-model` family). Loop only. DISTINCT from the
	 * acceptance gate's {@link acceptanceReviewModel} (build `--review-model`).
	 */
	taskerLoopModel?: string;
	/** Environment for child GIT/provider processes (the identity-scoped env). */
	env?: NodeJS.ProcessEnv;
	/**
	 * Environment for the AGENT launches (the tasker agent + the review/improver
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
 * **The STAGED-TASKS dir** (spec `staging-pool-position-gate-and-trust-model`,
 * task `pre-backlog-staging-folder-and-promote-step-a`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). The runner
 * lands the tasker's emitted task files HERE, NOT in `work/tasks/ready/`: an item
 * born in `pre-backlog/` is durable + readable but NOT in the agent-eligible
 * pool (`work/tasks/ready/` STILL means the pool — every reader is byte-for-byte
 * unchanged). A runner/human-owned promotion (`promoteFromPreBacklog` in
 * `needs-attention.ts`) moves an approved item `pre-backlog/ → backlog/` to make
 * it claimable. STEP A: ADDITIVE — no `work/tasks/ready/` reader changes here.
 */
export const STAGED_TASKS_DIR = workFolderRel('tasks-backlog');

/**
 * The POOL folder tasks land in when the runner-deterministic placement
 * resolver chooses the pool side (`tasksLandIn: 'ready'` and a trusted
 * origin, or an `--tasks-land-in ready` operator override). The agent NEVER
 * writes here — it always writes to {@link STAGED_TASKS_DIR}; the runner
 * redirects the emitted files to the resolved destination at integrate-stage
 * time. spec US #4 / the governing ADR: the agent cannot self-place into the
 * pool. Task `runner-deterministic-slice-placement-policy-and-precedence`.
 */
const POOL_TASKS_DIR = workFolderRel('tasks-ready');

/** The placement slots for the TASK lifecycle (folder names). */
const TASK_PLACEMENT_SLOTS = {
	staging: STAGED_TASKS_DIR,
	pool: POOL_TASKS_DIR,
} as const;

/**
 * Map the `tasksLandIn` value spelling (`pre-backlog` | `ready`) onto the
 * resolver's lifecycle-generic side enum (`staging` | `pool`). Returns
 * `undefined` when no value is set, so the resolver's next precedence rung
 * applies (the built-in floor). The legacy `'backlog'`/`'todo'` pool spellings
 * are NOT accepted (clean break — the value was renamed `'backlog'` → `'todo'`
 * → `'ready'`, ADR `rename-task-pool-folder-todo-to-ready`).
 */
function landingToSide(
	landing: 'pre-backlog' | 'ready' | undefined,
): 'staging' | 'pool' | undefined {
	if (landing === 'pre-backlog') return 'staging';
	if (landing === 'ready') return 'pool';
	return undefined;
}

/** The repo-relative path of a staged task's `.md` (per {@link STAGED_TASKS_DIR}). */
function stagedTaskPath(name: string): string {
	return `${STAGED_TASKS_DIR}/${name}`;
}

/**
 * Run the `do spec:<slug>` tasking path end-to-end. Never throws for the expected
 * gate-refused / lock-lost / agent-failed / stale cases — those are returned with
 * the appropriate exit code and outcome. The runner owns all git; the agent only
 * writes task files.
 */
export async function performTask(
	options: PerformTaskOptions,
): Promise<TaskResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	// `env` is the runner's GIT/provider env (identity-scoped). `agentEnv` is the
	// AMBIENT env for AGENT launches (tasker agent, review/improver agents) — an
	// agent must not act as the bot. Falls back to `env` when no identity.
	const env = options.env;
	const agentEnv = options.agentEnv ?? options.env;
	const slug = options.slug;
	const doer = options.doer ?? 'agent';
	const lock = options.lock ?? DEFAULT_LOCK_SEAM;

	// 0. The spec must exist in the checkout (`work/specs/ready/<slug>.md`) — it is the
	//    source the agent tasks + the file the lock holds.
	const specPath = workItemPath(cwd, 'specs-ready', slug);
	if (!existsSync(specPath)) {
		const message = `no spec '${slug}' found at ${workFolderRel('specs-ready')}/${slug}.md.`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', slug, message};
	}
	const specContent = readFileSync(specPath, 'utf8');
	const specFm = parseFrontmatter(specContent);

	// 1. RESOLVE THE GATE (agent path only). The human path is UNBOUND — a human
	//    decides for themselves whether a spec is taskable.
	if (doer === 'agent') {
		const eligibility = resolveAgentGate(
			cwd,
			slug,
			specFm,
			options.autoTask,
			options.explicit ?? false,
		);
		if (!eligibility.taskable) {
			const message = gateRefusalReason(slug, specFm, eligibility, options);
			note(message);
			return {exitCode: 1, outcome: 'gate-refused', slug, message};
		}
	}

	// 2. ACQUIRE THE LOCK (agent path; concurrency serialisation). The human path
	//    with no contention may task on `main` directly WITHOUT the lock.
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

	// 2b. ONBOARD the agent's tasking work onto a `work/<slug>` BRANCH cut from the
	//     freshly-fetched `<arbiter>/main` (task `slice-output-through-integration`).
	//     The spec body rests in `work/specs/ready/<slug>.md` on `<arbiter>/main` (the lock no
	//     longer moves it), so the branch's base HOLDS the held spec — the lifecycle
	//     stage below moves it `specs/ready/ → specs/tasked/` ON THIS BRANCH and the shared integrate core (`--propose`
	//     PR / `--merge` main) lands the whole transition, WITHOUT the lock release
	//     committing tasks straight to `main`. The agent runs IN-PLACE on this branch
	//     (branch ≠ worktree; the isolation seam upgrades it). The HUMAN path stays on
	//     its own branch and commits its output itself (no integrate, no branch cut).
	if (useLock) {
		await switchToWorkBranch(cwd, arbiter, slug, env);
	}

	// 3. INVOKE THE AGENT with the to-task spec. It WRITES
	//    `work/tasks/backlog/*.md` task files (the STAGED area — NOT `work/tasks/ready/`,
	//    which is the agent-eligible pool the runner owns the promotion into; task
	//    `pre-backlog-staging-folder-and-promote-step-a`); it does NO git. We
	//    snapshot the staged-tasks folder before/after so the runner (not the
	//    agent) captures + commits exactly what was produced.
	const before = snapshotStagedTasks(cwd);
	// Also snapshot the POOL `work/tasks/ready/` BEFORE the agent runs: the runner's
	// final commit must scrub any agent writes there (an attempt to self-place into
	// the pool, spec US #4) before `git add -A` would sweep them in.
	const poolBefore = snapshotPool(cwd);
	// Read the parent-spec self-pointer off `specFm.spec` (populated from the
	// `spec:` key).
	const prompt = buildTaskingSpec(slug, specFm.spec);
	let agent: {ok: boolean; detail?: string};
	try {
		agent = await runTaskAgent(options, cwd, prompt, slug);
	} catch (err) {
		agent = {
			ok: false,
			detail: err instanceof Error ? err.message : String(err),
		};
	}
	if (!agent.ok) {
		const detail = agent.detail ?? `the agent failed to task '${slug}'.`;
		const message = `Agent failed tasking '${slug}' (${detail}).`;
		note(message);
		// The lock stays held (the runner did not release it): a stuck tasking is
		// recoverable / re-runnable. Surfacing it is the review/edit loop's job.
		return {exitCode: 1, outcome: 'agent-failed', slug, message};
	}

	// 3.5 THE TASKER REVIEW→EDIT→CONVERGE LOOP (`slicer-review-edit-loop`, Shape 2 /
	//     insertion point A): when a loop seam is wired, run the `review` SKILL as a
	//     review→edit→re-review loop that IMPROVES the candidate tasks in place, then
	//     determines the disposition (the three outcomes). This plugs in AFTER the
	//     candidate tasks are produced and BEFORE they are finalised. The agent makes
	//     the review/edit JUDGEMENTS; the loop applies edits to the candidate files
	//     and routes the verdict; the runner (below) owns the git transition. Only the
	//     AGENT path runs the loop — the human tasking path is unaffected.
	let loopDisposition: RunTaskReviewLoopResult | undefined;
	if (options.reviewLoop && doer === 'agent') {
		loopDisposition = await runTaskReviewLoop({
			slug,
			cwd,
			gate: options.reviewLoop,
			// SCOPING FENCE (the requeue fix): the loop reviews/edits/flags ONLY the
			// tasks THIS run produced (new-or-changed vs `before`), never the
			// pre-existing staged tasks that share `work/tasks/backlog/`.
			before,
			taskerLoopMax: options.taskerLoopMax ?? 3,
			executions: options.reviewExecutions,
			taskerLoopModel: options.taskerLoopModel,
			sessionsDir: options.sessionsDir,
			// The improver loop's review AGENT launches AMBIENT, never the identity.
			env: agentEnv,
			note,
		});
		// DECOMPOSITION UNCLEAR: emit NO guessed tasks — route the held spec to
		// needs-attention with the questions as the reason. The lock release amends the
		// `spec:<slug>` unified lock `active → stuck` (the tasking needs-attention surface
		// is the stuck lock now — NO folder write; the spec body stays in `work/specs/ready/`).
		if (loopDisposition.outcome === 'decomposition-unclear') {
			const reason = decompositionUnclearReason(
				slug,
				loopDisposition.specQuestions,
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
		// UNCERTAIN TASKS: mark each named candidate `needsAnswers: true` + record
		// its questions in the body, so it lands but is not agent-buildable. The
		// runner writes the marker (the agent does no git/disk-escape).
		if (loopDisposition.outcome === 'uncertain-tasks') {
			for (const uncertain of loopDisposition.uncertainTasks) {
				markTaskNeedsAnswers(cwd, uncertain.path, uncertain.questions, note);
			}
		}
	}

	// 4. The RUNNER commits the COMPLETING transition: drop the produced backlog
	//    tasks IN + move the spec specs/ready/ -> specs/tasked/ (residence = tasked-ness) — now
	//    through the SHARED integrate core (`--propose` PR / `--merge` main), NOT a
	//    direct commit to `main`. The agent never does git. (The backlog snapshot is
	//    taken AFTER any loop edits, so the runner integrates the IMPROVED tasks,
	//    not the pre-loop candidates.)
	const stagedEmitted = newOrChangedStagedTasks(cwd, before);
	const emitTasks = collectEmittedTasks(cwd, stagedEmitted);
	// RUNNER-DETERMINISTIC PLACEMENT (task
	// `runner-deterministic-slice-placement-policy-and-precedence`). Resolve which
	// folder the runner lands the emitted tasks in BEFORE handing them to the
	// shared integrate band: precedence `explicit > untrusted-origin ⇒ staging >
	// tasksLandIn > built-in (staging)`, all from unforgeable inputs (the spec's
	// stamped `originTrust:` + the resolved per-repo default + the operator's
	// explicit flag). The agent NEVER influences this; it always writes to
	// `work/tasks/backlog/`, and the runner redirects at `stage()` time.
	const placementDecision = resolvePlacement({
		explicit: landingToSide(options.explicitTasksLandIn),
		originTrust: specFm.originTrust,
		configuredDefault: landingToSide(options.tasksLandIn),
	});
	const placementDir = placementFolder(
		TASK_PLACEMENT_SLOTS,
		placementDecision.choice,
	);
	// REWRITE the emitted list to the RUNNER-RESOLVED destination so callers see
	// where the runner actually placed the files (not where the agent wrote them).
	const emitted = stagedEmitted.map(
		(rel) => `${placementDir}/${basename(rel)}`,
	);
	const loopTag: 'converged' | 'uncertain-tasks' | undefined =
		loopDisposition?.outcome === 'converged'
			? 'converged'
			: loopDisposition?.outcome === 'uncertain-tasks'
				? 'uncertain-tasks'
				: undefined;

	if (useLock) {
		// READ-STABILITY BACKSTOP (the lock's content-identity check, now owned at the
		// integrate seam): the OUTPUT no longer rides the lock release, so the band
		// below would otherwise rebase a concurrent edit of the held spec body CLEANLY
		// into spec/ (a rename+edit merge) while the tasks were cut from the OLD body —
		// the exact silent stale-task drift the lock forbids
		// (`work/notes/observations/tasking-lock-does-not-stabilise-spec-content.md`). So we
		// compare the CURRENTLY held `work/specs/ready/<slug>.md` blob on the arbiter against
		// the snapshot the lock TOOK (`lockedBlob`); ANY change ⇒ STALE ⇒ fail loud,
		// touch NOTHING (the lock stays held; a human re-tasks or routes to
		// needs-attention). It is the SAME content-identity check `releaseTaskingLock`
		// runs — relocated here because this transition, not the release, owns the
		// completing commit now.
		const stale = await heldSpecIsStale(cwd, arbiter, slug, lockedBlob, env);
		if (stale) {
			const specRel = workItemRel('specs-ready', `${slug}.md`);
			const message =
				`RELEASE CONFLICT for '${slug}': the spec was edited (${specRel} ` +
				`changed on ${arbiter}/main) while the tasking lock was held. The tasking is ` +
				`STALE — re-task from the edited spec or route it to needs-attention. ` +
				`The arbiter was NOT modified (lock still held).`;
			note(message);
			return {exitCode: 4, outcome: 'stale', slug, message};
		}

		// Route the OUTPUT through the SHARED integrate back-half (task
		// `slice-output-through-integration`): the produced backlog tasks + the spec
		// lifecycle move (`work/specs/ready/ -> work/specs/tasked/`, residence = tasked-ness) integrate
		// via `performIntegration` honoring `--propose` (push the work branch + open a
		// PR, NO `main` touch) / `--merge` (land on `main`). Because the integrate-time
		// args resolve ONCE in the shared core, every `do task:` arg applies here by
		// construction. The agent did NO git; the runner (the band) owns the ONE commit.
		const core = await performIntegration({
			cwd,
			arbiter,
			slug,
			// `source`/`recovering` are task-shaped and IGNORED when `lifecycle` is set
			// (a tasking transition never recovers a surfaced needs-attention move).
			source: 'in-progress',
			recovering: false,
			// Skip the build acceptance gate (Gate 1 / verify): a tasking transition has
			// no `verify` floor (the tasker review loop above is its quality gate).
			skipVerify: true,
			// THE TASK-SET ACCEPTANCE GATE (task `slice-acceptance-gate`): the
			// task-path mirror of the build Gate-2, riding THIS shared core's
			// review-before-integrate block. When `review` resolves on, the wired
			// `reviewGate` (production: `harnessTaskReviewGate` with the task-SET
			// prompt) runs a FRESH-CONTEXT review of the produced task SET before it
			// integrates: `approve` lands it, `block` routes the set to needs-attention
			// via the SAME machinery the build block uses (mapped to the tasking
			// `needs-attention` outcome below). It is ONE-SHOT: we pin
			// `reviewMaxRounds: 1` so the gate is a SINGLE reviewer invocation → verdict
			// (terminal pass/fail). The task path NEVER exposes/consults
			// `--review-max-rounds` — a gate is terminal, the rounds bound is an orphan
			// that belongs to a future revise↔review loop (see
			// `work/notes/observations/reviewmaxrounds-on-wrong-concept.md`). This is
			// independently controllable from the tasker improver loop (`reviewLoop` /
			// the `--tasker-loop*` family); toggling one does not affect the other.
			review: options.review,
			reviewGate: options.reviewGate,
			reviewModel: options.acceptanceReviewModel,
			reviewMaxRounds: 1,
			// The cross-job merge-serialiser CAS-retry cap (config `mergeRetries`) —
			// threaded so a wide-matrix CI's raised cap reaches the tasking-
			// transition's land tail too (task
			// `thread-merge-retries-cross-task-and-ratify-default`). Unset ⇒ falls
			// through to the engine default (byte-for-byte unchanged).
			mergeRetries: options.mergeRetries,
			// The EXPLICITLY-chosen integrate mode proceeds AS-IS on an APPROVE — a
			// `--merge` tasking run lands on main, `--propose` opens a PR. The tasking
			// path's merge-vs-propose decision is the `integration` mode the user typed;
			// `merge` IS the auto-land mode, so a resolved `merge` is never downgraded.
			// The task gate family is `--review`/`--no-review`/`--review-model` only
			// (spec US #6).
			mode: options.integration ?? 'propose',
			noPR: options.noPR,
			providerInstance: options.providerInstance,
			type: 'tasking',
			lifecycle: {
				// Read the PR title / commit summary from the held spec (before it moves).
				titlePath: workItemPath(cwd, 'specs-ready', slug),
				commitTag: 'tasked',
				stage: () =>
					stageTaskingLifecycle({
						cwd,
						slug,
						emitTasks,
						poolBefore,
						placementDir,
						placementReason: placementDecision.reason,
						note,
						env,
					}),
			},
			env,
			// The task-SET acceptance review AGENT launches AMBIENT, never the
			// identity-scoped `env` (an agent must not act as the bot).
			agentEnv,
			note,
		});

		// THE TASK-SET ACCEPTANCE GATE BLOCKED (task `slice-acceptance-gate`): the
		// fresh-context review of the produced SET returned `block`, so the core ran
		// the review BEFORE the stage/integrate and did NOT integrate the tasks
		// (correct). The CORRECT task-path destination is the SAME needs-attention
		// route the lock release owns for the decomposition-unclear verdict: it amends
		// the `spec:<slug>` unified lock `active -> stuck` with the block reason (the
		// tasking needs-attention surface is the stuck lock now — NO folder write; the
		// spec body stays in `work/specs/ready/`). So on a block we route the held spec to
		// needs-attention THROUGH the lock release — the set never lands.
		if (core.outcome === 'review-blocked') {
			const reason = taskGateBlockedReason(slug, core.reviewBlockReason);
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
					`The task acceptance gate blocked the set produced for '${slug}'; ` +
					`marked the per-item lock stuck (needs attention; no tasks landed).`,
			};
		}
		if (core.outcome === 'review-unparseable') {
			// The task-set acceptance gate RAN but its verdict was UNPARSEABLE (malformed
			// JSON). Route the held spec to needs-attention through the SAME lock-release
			// seam the block path uses (the tasking needs-attention surface is the stuck
			// `spec:<slug>` lock; no folder write). It is NOT a block (the gate output was
			// unreadable) — record it as the transient-infra-class re-run signal so the
			// stuck reason reads correctly; nothing landed.
			const reason =
				`The task acceptance gate for '${slug}' produced an UNPARSEABLE verdict ` +
				`(re-run — transient): ${core.reason ?? ''}`;
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
					`The task acceptance gate produced an unparseable verdict for '${slug}'; ` +
					`marked the per-item lock stuck (needs attention; no tasks landed; re-run).`,
			};
		}
		if (core.outcome === 'completed') {
			// The durable `specs/ready → specs/tasked` `main` move landed through the shared integrate
			// core (the body moved straight from `work/specs/ready/` — no transient `tasking/`
			// marker). The completing commit is owned by the integrate band, NOT
			// `releaseTaskingLock`, so the unified per-item lock that `acquireTaskingLock`
			// took is released HERE (delete the ref). A
			// `propose` (`mode: 'propose'`) is ALSO `completed` (the PR opened, the lock's
			// hold over the in-flight tasking is done); the eventual hold-across-the-PR
			// crash-safe ordering is the capstone task #7's concern, not this interim
			// half. Best-effort + idempotent (`not-held` is fine).
			// MIGRATE step: release under the `spec:<slug>` identity (keyed to the
			// `spec-<slug>` lock entry the acquire now takes). Idempotent.
			if (useLock) {
				await releaseItemLock({item: `spec:${slug}`, cwd, arbiter, env});
			}
		}
		return integrationToTaskResult(core, {slug, emitted, loop: loopTag});
	}

	// HUMAN, no-lock path: the human commits on `main` directly (the runner does
	// not own the human's git). We report the produced tasks; moving the spec into
	// `work/specs/tasked/` (residence = tasked-ness) and committing is the human's to
	// do, as with the human `complete`.
	const message =
		`Tasked '${slug}' -> ${emitted.length} backlog task` +
		`${emitted.length === 1 ? '' : 's'} (human path, no lock). Inspect + commit ` +
		`the produced files (and move the spec into work/specs/tasked/) yourself.`;
	note(message);
	return {
		exitCode: 0,
		outcome: 'tasked',
		slug,
		emitted,
		loop: loopTag,
		message,
	};
}

/**
 * Map a non-`released` lock-release result onto the {@link TaskResult} contract
 * (the decomposition-unclear routing reuses the SAME release seam, so it can also
 * be `stale`/`lost`/`contended`/usage-error). Mirrors the step-4 release mapping.
 */
function releaseFailureToResult(
	released: ReleaseTaskingLockResult,
	slug: string,
): TaskResult {
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
 * Map the shared integrate band's {@link IntegrationCoreResult} onto the tasking
 * {@link TaskResult} (task `slice-output-through-integration`). On `completed`
 * (propose pushed the work branch + opened a PR / merge landed on `main`) the
 * tasking is `tasked`. The band's FAILURE outcomes are reported on the tasking
 * contract: a `rebase-conflict` against a concurrently-advanced `main` maps to
 * `stale` (exit 4) — the tasking analogue of "the held spec moved under us"; a
 * a `gate-failed` cannot occur (the tasking path passes `skipVerify`) but maps to
 * a usage error defensively. A `review-blocked` (the task-SET ACCEPTANCE GATE
 * blocked the set, task `slice-acceptance-gate`) is handled by `performTask`
 * BEFORE this mapper — it routes the held spec to needs-attention via
 * the lock release (the task-path needs-attention route) — so it never reaches
 * here; it is mapped defensively to a usage error if it ever does.
 */
function integrationToTaskResult(
	core: IntegrationCoreResult,
	ctx: {
		slug: string;
		emitted: string[];
		loop: 'converged' | 'uncertain-tasks' | undefined;
	},
): TaskResult {
	const {slug, emitted, loop} = ctx;
	if (core.outcome === 'completed') {
		const landed =
			core.integration?.mode === 'merge'
				? 'landed them on the arbiter main'
				: 'opened a PR carrying them (main untouched)';
		const message =
			`Tasked '${slug}' -> ${emitted.length} backlog task` +
			`${emitted.length === 1 ? '' : 's'}; the runner integrated the transition ` +
			`through the shared core (moved work/specs/ready/ -> work/specs/tasked/, the ` +
			`tasked resting state) and ${landed}.`;
		return {exitCode: 0, outcome: 'tasked', slug, emitted, loop, message};
	}
	if (core.outcome === 'rebase-conflict') {
		return {
			exitCode: 4,
			outcome: 'stale',
			slug,
			message:
				core.reason ??
				`Integrating the tasking of '${slug}' conflicted against the latest ` +
					`${slug} main — the tasking is stale; re-task from the current spec.`,
		};
	}
	return {
		exitCode: 1,
		outcome: 'usage-error',
		slug,
		message:
			core.reason ??
			`Integrating the tasking of '${slug}' failed unexpectedly.`,
	};
}

/**
 * ONBOARD the tasking work onto a `work/<slug>` branch cut from the freshly-
 * fetched `<arbiter>/main` (task `slice-output-through-integration`). Called
 * AFTER the tasking lock is held, so the branch's base HOLDS the spec in
 * `work/specs/ready/` (the lock no longer moves the body) — the lifecycle stage then moves
 * it `specs/ready/ -> specs/tasked/` ON THIS BRANCH and the shared integrate core lands it. A
 * pre-existing local `work/<slug>` (a re-run) is force-recreated off fresh main.
 * The agent runs in-place on this branch (branch ≠ worktree).
 */
async function switchToWorkBranch(
	cwd: string,
	arbiter: string,
	slug: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	// The tasking path is the parent-spec namespace (`do spec:<slug>`): the branch
	// is `work/spec-<slug>`, distinct from a same-slug task-build's `work/task-<slug>`.
	// MIGRATE step (spec `prd-to-spec-vocabulary-cutover-and-migration-command`):
	// MINT the work-branch under the `spec` namespace token (`workBranchRef` still
	// parses the legacy `work/prd-<slug>` form, so in-flight branches keep resolving).
	const branch = workBranchRef('spec', slug);
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
 * iff the CURRENTLY held `work/specs/ready/<slug>.md` blob on `<arbiter>/main` DIFFERS
 * from the snapshot the lock TOOK (`lockedBlob`, read from `work/specs/ready/<slug>.md` at
 * acquire). ANY change = a concurrent edit under the lock = the tasking is STALE.
 * Stronger than a textual rebase conflict (which a rename+edit merge can apply
 * CLEANLY). When `lockedBlob` is absent (never, in production) it reads as
 * not-stale (the lock acquire always returns it).
 */
async function heldSpecIsStale(
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
		['rev-parse', `${arbiter}/main:${workFolderRel('specs-ready')}/${slug}.md`],
		cwd,
		env,
	);
	// The spec being absent (already tasked/moved) is NOT this check's concern
	// (the integrate's rebase/push surfaces that); only a CHANGED held blob is stale.
	if (held.status !== 0) {
		return false;
	}
	return held.stdout.trim() !== lockedBlob;
}

/**
 * STAGE the tasking lifecycle into the index on the `work/<slug>` branch (the
 * {@link performIntegration} lifecycle seam): move the held spec
 * `git mv work/specs/ready/<slug>.md -> work/specs/tasked/<slug>.md` (the TASKED resting
 * state — the build-machine `done/` analogue, the SOURCE OF TRUTH for tasked-ness),
 * and write+`git add` the produced `work/tasks/backlog/*.md` files. The band's subsequent
 * `git add -A` + atomic commit folds this AND the agent's uncommitted backlog writes
 * into ONE runner-owned commit (the agent never does git).
 *
 * TASK `prd-sliced-folder-step-a` (spec `slicing-coherence` US #8): the lifecycle
 * destination is `work/specs/tasked/` (NOT back to `work/specs/ready/`) — `specs/tasked/`
 * residence IS tasked-ness (like `done/` for tasks, with no `done:` marker). The
 * `tasked:` frontmatter marker was removed entirely in `remove-sliced-marker-step-b`
 * (sequenced last): residence in `work/specs/tasked/` is now the sole signal.
 */
async function stageTaskingLifecycle(params: {
	cwd: string;
	slug: string;
	emitTasks: Record<string, string>;
	poolBefore: Map<string, string>;
	/**
	 * The runner-resolved destination folder (task
	 * `runner-deterministic-slice-placement-policy-and-precedence`). Computed
	 * ONCE in `performTask` via the shared {@link resolvePlacement} from the
	 * spec's `originTrust:` stamp + the configured `tasksLandIn` default + the
	 * operator's explicit override, then passed in here — so the call site sees
	 * exactly where the emitted tasks landed (the placement decision is not
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
		emitTasks,
		poolBefore,
		placementDir,
		placementReason,
		note,
		env,
	} = params;
	const spec = workItemRel('specs-ready', `${slug}.md`);
	const specTasked = workItemRel('specs-tasked', `${slug}.md`);
	// PROPAGATE the origin-trust PROVENANCE (task
	// `untrusted-origin-forces-build-propose`): read the held spec's `origin`/
	// `originTrust` stamp BEFORE the move, so each emitted task can carry it. A
	// task's risk is its BUILD; the stamp must reach the task so the build
	// transition can force `propose` for untrusted-origin work. An UNSTAMPED spec (a
	// human/local-authored one ⇒ trusted) propagates nothing — the normal path is
	// untouched.
	const specAbs = join(cwd, spec);
	const specProvenance = existsSync(specAbs)
		? parseFrontmatter(readFileSync(specAbs, 'utf8'))
		: {origin: undefined, originTrust: undefined};
	if (placementReason === 'untrusted-origin') {
		note(
			`Untrusted-origin spec '${slug}': forcing the emitted tasks STAGED ` +
				`(${placementDir}/) regardless of tasksLandIn (a human promotes ` +
				'them into work/tasks/ready/). Pass --tasks-land-in <where> to override.',
		);
	}
	// Move the held spec specs/ready/ -> specs/tasked/ (the TASKED resting state — folder =
	// source of truth, like done/ for tasks). This is the DURABLE `specs/ready → specs/tasked`
	// success move, owned by THIS transition's commit (the lock no longer moved the
	// body, so the source is `work/specs/ready/`, never `work/tasking/`).
	mkdirSync(dirname(join(cwd, specTasked)), {recursive: true});
	await gitHard(['mv', spec, specTasked], cwd, env);
	await gitHard(['add', '--', specTasked], cwd, env);
	// **POOL-PLACEMENT FENCE (spec US #4 / governing ADR
	// `placement-is-runner-deterministic-humanonly-is-agent-judgement`).** The
	// agent ALWAYS writes to the STAGING folder (`work/tasks/backlog/`); the POOL
	// (`work/tasks/ready/`) is the agent-eligible pool the runner owns the promotion
	// into. Anything the agent dropped under the pool would otherwise be swept in
	// by `performIntegration`'s subsequent `git add -A` — a self-placement into
	// the pool. Scrub it FIRST (before the runner writes its resolved destination
	// files below), so when the runner-deterministic placement resolves to the
	// pool the runner's writes are the ONLY legitimate pool entries in the commit.
	await scrubPoolDrift(cwd, poolBefore, env);
	// Drop the produced backlog tasks IN at the RUNNER-RESOLVED destination
	// (write + stage; the band's `git add -A` also catches them, but staging here
	// keeps the transition explicit + atomic). The runner STAMPS the propagated
	// provenance onto each task as it writes it (the agent does no git; the runner
	// owns the file write here). When the resolved destination DIFFERS from where
	// the agent wrote (the staging folder), remove the agent's source file too —
	// otherwise `git add -A` would commit BOTH (staging twin + pool destination).
	for (const [agentRel, content] of Object.entries(emitTasks)) {
		const filename = basename(agentRel);
		const destRel = `${placementDir}/${filename}`;
		const destAbs = join(cwd, destRel);
		mkdirSync(dirname(destAbs), {recursive: true});
		writeFileSync(destAbs, propagateOrigin(specProvenance, content));
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
 * Revert any change/addition the agent made to the POOL `work/tasks/ready/` during a
 * tasking run. The agent's STAGING folder is `work/tasks/backlog/`; a write to the
 * pool is an attempt to self-place into the agent-eligible pool the runner owns
 * the promotion into (spec US #4 / governing ADR). Compared to the `poolBefore`
 * snapshot (the branch-base state of `work/tasks/ready/`, taken BEFORE the agent
 * ran), any new file is removed from the worktree and any changed file is
 * checked back out to HEAD — so the subsequent `git add -A` cannot land it. The
 * runner's commit then carries ONLY the explicit `pre-backlog/` placement.
 */
async function scrubPoolDrift(
	cwd: string,
	poolBefore: Map<string, string>,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	const dir = workFolderPath(cwd, 'tasks-ready');
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
			// The agent edited a pre-existing pool task — restore it from HEAD.
			await gitSoft(
				['checkout', 'HEAD', '--', workItemRel('tasks-ready', name)],
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
 * Build the needs-attention REASON for a task-SET ACCEPTANCE GATE block (task
 * `slice-acceptance-gate`): the fresh-context review of the produced set returned
 * `block`, so the spec is marked stuck on its per-item lock (post lock-cutover —
 * `state: stuck` with this reason on the lock entry, no `work/needs-attention/`
 * folder write) and NO tasks land. Takes the core's
 * structured `reviewBlockReason` (the gate's blocking findings); falls back to a
 * generic line when absent. DISTINCT from the improver loop's
 * {@link decompositionUnclearReason} (which carries the loop's open questions).
 */
function taskGateBlockedReason(
	slug: string,
	findingsReason: string | undefined,
): string {
	const head =
		`The task acceptance gate (fresh-context review of the produced SET) blocked ` +
		`'${slug}'. The spec is routed to needs-attention with no tasks landed; a human ` +
		`must resolve the blocking findings, then re-task.`;
	return findingsReason ? `${head}\n\n${findingsReason}` : head;
}

/**
 * Build the needs-attention REASON for a decomposition-unclear loop verdict (the
 * spec is marked stuck on its per-item lock with these open questions, no guessed
 * tasks). Prose only — recorded as the spec's stuck-lock reason.
 */
function decompositionUnclearReason(slug: string, questions: string[]): string {
	const head =
		`The tasker review→edit loop could not converge on a sound decomposition of ` +
		`'${slug}' (--tasker-loop-max exhausted with unresolved blockers). The spec is routed ` +
		`to needs-attention with no guessed tasks; a human must resolve:`;
	const body =
		questions.length > 0
			? questions.map((q) => `- ${q}`).join('\n')
			: '- (no specific questions surfaced; the decomposition is broadly unclear)';
	return `${head}\n${body}`;
}

/**
 * Mark a candidate task file `needsAnswers: true` and record its open questions in
 * its body (the loop's uncertain-task routing outcome). The runner writes the
 * file; the agent does no git/disk-escape. A path outside `work/tasks/backlog/`
 * is skipped (defensive). A relative `work/tasks/backlog/<slug>.md` that does not
 * exist is skipped with a note (never crash the transition).
 */
function markTaskNeedsAnswers(
	cwd: string,
	relPath: string,
	questions: string[],
	note: (message: string) => void,
): void {
	const normalized = relPath.replace(/\\/g, '/');
	if (
		!normalized.startsWith(`${STAGED_TASKS_DIR}/`) ||
		normalized.includes('..')
	) {
		note(
			`Skipped a needsAnswers mark outside ${STAGED_TASKS_DIR}/ (${relPath}).`,
		);
		return;
	}
	const abs = join(cwd, normalized);
	if (!existsSync(abs)) {
		note(`Skipped a needsAnswers mark for missing candidate task ${relPath}.`);
		return;
	}
	const current = readFileSync(abs, 'utf8');
	const marked = setNeedsAnswersMarker(current, true);
	writeFileSync(abs, appendQuestionsBlock(marked, questions));
}

/** The heading that opens the open-questions block in an uncertain task body. */
const OPEN_QUESTIONS_HEADING = '## Open questions';

/**
 * Append an `## Open questions` block (prose, never a frontmatter field —
 * WORK-CONTRACT rule 3) listing the loop's surfaced questions to an uncertain
 * task's body. A human answers these before the task becomes agent-buildable.
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
 * Resolve the AGENT tasking gate for `slug`: the pure predicate
 * (`needsAnswers !== true && humanOnly !== true && autoTask`) plus the
 * cross-spec `taskedAfter` ordering, resolved against `work/specs/tasked/` residence of
 * the specs present in the checkout.
 */
function resolveAgentGate(
	cwd: string,
	slug: string,
	specFm: {humanOnly?: boolean; needsAnswers?: boolean; taskedAfter: string[]},
	autoTask: boolean | undefined,
	explicit: boolean,
): TaskingEligibilityResult {
	return resolveTaskingEligibility({
		humanOnly: specFm.humanOnly,
		needsAnswers: specFm.needsAnswers,
		taskedAfter: specFm.taskedAfter,
		taskedSlugs: readTaskedSlugs(cwd),
		autoTask: autoTask ?? false,
		explicit,
	});
}

/** Build an HONEST gate-refusal message naming WHY the agent skipped the spec. */
function gateRefusalReason(
	slug: string,
	specFm: {humanOnly?: boolean; needsAnswers?: boolean},
	eligibility: TaskingEligibilityResult,
	options: PerformTaskOptions,
): string {
	const reasons: string[] = [];
	if (specFm.humanOnly === true) {
		reasons.push('the spec is humanOnly (a human must drive its tasking)');
	}
	if (specFm.needsAnswers === true) {
		reasons.push(
			'the spec has needsAnswers (open questions block auto-tasking)',
		);
	}
	// The autoTask POLICY only refuses on the NON-explicit (auto-pick pool) path:
	// an explicitly-named `do spec:<slug>` is authorized by the naming itself (the
	// build path's autoBuild precedent), so the policy is never the reason there.
	if (
		options.explicit !== true &&
		specFm.humanOnly !== true &&
		specFm.needsAnswers !== true &&
		(options.autoTask ?? false) !== true
	) {
		reasons.push("the repo's autoTask policy is off");
	}
	if (!eligibility.taskedAfter.satisfied) {
		reasons.push(
			`taskedAfter spec(s) not yet tasked: ${eligibility.taskedAfter.missing.join(', ')}`,
		);
	}
	const why =
		reasons.length > 0 ? reasons.join('; ') : 'the tasking gate refused';
	return `Skipped tasking '${slug}': ${why}.`;
}

/**
 * Read the set of slugs whose specs are already TASKED in this checkout — RESIDENCE
 * in `work/specs/tasked/` (the tasked resting state, task `prd-sliced-folder-step-a`
 * / spec `slicing-coherence` US #9), the build-machine `done/` analogue. The FOLDER
 * is the source of truth; the `tasked:` frontmatter marker was removed entirely in
 * `remove-sliced-marker-step-b` and is NOT consulted. So `taskedAfter` resolves
 * against `specs/tasked/` residence
 * (mirroring `blockedBy` -> `done/`). A missing folder reads as empty. The slug is
 * read from each file's frontmatter `slug:`, falling back to the filename — the same
 * shape the task readers use.
 */
function readTaskedSlugs(cwd: string): Set<string> {
	const slugs = new Set<string>();
	const dir = workFolderPath(cwd, 'specs-tasked');
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		slugs.add(fm.slug ?? file.replace(/\.md$/i, ''));
	}
	return slugs;
}

/**
 * Build the tasking PROMPT: instruct a fresh-context agent to apply the
 * **tasking discipline** (`work/protocol/TASKING-PROTOCOL.md`) to the held
 * spec at `work/specs/ready/<slug>.md` and to EMIT tracer-bullet vertical
 * tasks under `work/tasks/backlog/`. The discipline body (the tracer-bullet
 * rules, the two-axis gate guidance, the confidence check, file-orthogonality,
 * the emitted task shape) lives in `TASKING-PROTOCOL.md` — NOT inlined here
 * (task `slicing-protocol-doc-and-vocabulary-fix`). The shape's source of
 * truth is the frontmatter parser + the task template (`work/protocol/
 * task-template.md`); the doc DESCRIBES it (D2).
 *
 * This builder owns ONLY the PER-BUILDER framing: who you are (a fresh-context
 * tasker for ONE spec), where the held spec is, where the emitted task files
 * MUST land (the staging folder, never the pool), and the runner-owns-git
 * boundary on the agent path. The shared discipline body is NOT duplicated
 * here.
 */
function buildTaskingSpec(slug: string, _spec: string | undefined): string {
	const specReady = workFolderRel('specs-ready');
	const specTasked = workFolderRel('specs-tasked');
	return [
		`You are a FRESH-CONTEXT tasker for the spec \`${specReady}/${slug}.md\`.`,
		`Apply the tasking discipline defined in \`work/protocol/TASKING-PROTOCOL.md\``,
		`(the in-band, protocol-native tasking protocol every set-up repo carries; the`,
		`human-facing pointer is \`skills/to-task/SKILL.md\`) to this ONE spec:`,
		`decompose it into independently-grabbable, tracer-bullet vertical tasks.`,
		`Read the spec fully first.`,
		``,
		`The discipline rules — the tracer-bullet test, the two-axis gate guidance`,
		`(\`humanOnly\` is NARROW; \`needsAnswers\` flags genuine uncertainty), the`,
		`confidence check that REPLACES the human-quiz step when no human is present,`,
		`the file-orthogonality preference, the spec-vs-task gate disjointness, and`,
		`the emitted task shape — ALL live in that doc. Read them there.`,
		``,
		`No human is present, so apply the CONFIDENCE CHECK (\`TASKING-PROTOCOL.md\``,
		`step 4): only emit tasks you would have gotten a human to approve. If`,
		`granularity, dependency order, a gate, or a seam is genuinely unresolved, set`,
		`\`needsAnswers: true\` on the specific uncertain task (questions in its body)`,
		`rather than guessing — or, if the whole decomposition is unclear, stop and`,
		`route the spec to needs-attention with the questions.`,
		``,
		`WRITE EVERY emitted task file under \`${STAGED_TASKS_DIR}/\` (the STAGING folder)`,
		`— NEVER \`work/tasks/ready/\`. \`work/tasks/ready/\` is the agent-eligible POOL and`,
		`the runner owns the runner/human-only promotion into it; the tasker's staging`,
		`folder is \`work/tasks/backlog/\`. A write outside the staging folder is dropped`,
		`by the runner-deterministic placement resolver.`,
		``,
		`Set each task's \`spec:\` field to the source spec slug (\`${slug}\`) so the`,
		`link back to the spec survives.`,
		``,
		`Do NOT perform any git operations — do not stage, commit, push, or move any`,
		`files. The RUNNER owns every git-state transition (it commits the produced`,
		`tasks, releases the tasking lock, and moves the spec into \`${specTasked}/\`).`,
	].join('\n');
}

/** Run the task agent. Prefers the injected runner; else the harness seam. */
async function runTaskAgent(
	options: PerformTaskOptions,
	cwd: string,
	prompt: string,
	slug: string,
): Promise<{ok: boolean; detail?: string}> {
	// The tasker AGENT launches with the AMBIENT env (`agentEnv`), never the
	// identity-scoped `env` (an agent must not act as the bot). Falls back to `env`
	// when no identity is configured.
	const agentEnv = options.agentEnv ?? options.env;
	if (options.dorfl) {
		return options.dorfl({cwd, prompt, slug, env: agentEnv});
	}
	const harness = options.harness ?? new NullHarness();
	const launched = await launchWithOptionalWatch({
		harness,
		dir: cwd,
		slug,
		command: options.agentCmd ?? '',
		prompt,
		model: options.model,
		sessionId: `task-${slug}`,
		sessionsDir: options.sessionsDir,
		env: agentEnv,
	});
	return {ok: launched.ok, detail: launched.detail};
}

/** A snapshot of {@link STAGED_TASKS_DIR}: filename → file content. */
function snapshotStagedTasks(cwd: string): Map<string, string> {
	const dir = join(cwd, STAGED_TASKS_DIR);
	const snap = new Map<string, string>();
	for (const file of listMarkdown(dir)) {
		snap.set(file, readFileSync(join(dir, file), 'utf8'));
	}
	return snap;
}

/**
 * Repo-relative paths of the {@link STAGED_TASKS_DIR}`/*.md` files the agent
 * NEWLY created or CHANGED vs the pre-run snapshot — exactly what the runner
 * captures + commits. (An untouched pre-existing staged task is NOT
 * re-committed.) The agent's staging folder is `work/tasks/backlog/`; writes to
 * the pool `work/tasks/ready/` are scrubbed at stage time, never picked up here.
 */
function newOrChangedStagedTasks(
	cwd: string,
	before: Map<string, string>,
): string[] {
	const dir = join(cwd, STAGED_TASKS_DIR);
	const changed: string[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		if (before.get(file) !== content) {
			changed.push(stagedTaskPath(file));
		}
	}
	return changed.sort();
}

/** Snapshot the POOL `work/tasks/ready/` (for the agent-write fence at stage time). */
function snapshotPool(cwd: string): Map<string, string> {
	const dir = workFolderPath(cwd, 'tasks-ready');
	const snap = new Map<string, string>();
	for (const file of listMarkdown(dir)) {
		snap.set(file, readFileSync(join(dir, file), 'utf8'));
	}
	return snap;
}

/** Read the produced backlog tasks' content keyed by repo-relative path. */
function collectEmittedTasks(
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
