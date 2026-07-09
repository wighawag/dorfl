import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {runAsync, type RunResult} from './git.js';
import {workFolderRel, workItemRel} from './work-layout.js';
import {paramCase} from './brand.js';
import {
	performIntegration,
	type IntegrationCoreResult,
} from './integration-core.js';
import type {IntegrateResult, ReviewProvider} from './integrator.js';
import {integrationFromFlags} from './complete.js';
import type {IntegrationMode, PrdsLandIn} from './config.js';
import type {OriginTrust} from './frontmatter.js';
import {
	placementFolder,
	resolvePlacement,
	type PlacementSlots,
} from './placement.js';
import {
	identityEnv,
	assertTransportAllowed,
	type Identity,
} from './identity.js';
import {NullHarness, type Harness} from './harness.js';
import {workBranchRef, type SlugNamespace} from './slug-namespace.js';
import {launchWithOptionalWatch} from './agent-launch.js';
import {
	GitHubIssueProvider,
	PROCESSING_LOCK_LABEL,
	type Issue,
	type IssueComment,
	type IssueProvider,
} from './issue-provider.js';
import {extractJsonObjectSpan} from './verdict-json.js';
import {
	parseReviewVerdict,
	reviewDisciplinePrompt,
	verdictContractPrompt,
	type ReviewFinding,
	type ReviewVerdict,
} from './review-verdict.js';
import {
	stampIntakeMarker,
	computeSeenDelta,
	type IntakeMarkerKind,
} from './intake-marker.js';
import {triageIntake, type IntakeTriageDecision} from './intake-triage.js';
import {renderTaskBody, renderPrdBody} from './buildable-body.js';

/**
 * **`intake <N>`** (prd `issue-intake`, task `intake-tracer-slice-outcome`): the
 * KEYSTONE of the issue front-door. A new, GATE-FREE command — explicit invocation
 * IS the authorization (precedent: `explicit-do-prd-not-gated-by-autoslice`), so
 * `autoTask`/`autoBuild` config does NOT apply — that reads a GitHub issue + its
 * thread through the {@link IssueProvider} seam, runs the decision as a
 * **prompt → VERDICT**, and DISPATCHES on the verdict.
 *
 * The engine shape MIRRORS the review gate (prompt → `approve|block` → dispatch):
 * the decision prompt is an INLINE builder ({@link buildIntakeDecisionPrd}, like
 * `buildTaskingPrd`); the **dispatcher is the testable seam** — a STUBBED verdict
 * (injected, no model/network) drives it, exactly as `ReviewGate` is injected. The
 * prompt's JUDGEMENT is NOT unit-tested (like the review prompt's is not); only the
 * dispatch is.
 *
 * The dispatcher implements the FULL four-outcome decision table (prd
 * `issue-intake` — the source of truth):
 * - **ASK** (not clear enough to act on): `postIssueComment` the next clarifying
 *   question; emit NOTHING; STOP.
 * - **TASK** (clear AND fits ONE tracer-bullet task): write
 *   `work/backlog/<slug>.md` (`covers: []`, NO `prd:`) carrying `issue: N` (the
 *   lone-task closure link, NOT `Fixes #N`), integrate via {@link
 *   performIntegration} (default `propose`).
 * - **PRD** (clear AND coherent but >1 task — INCLUDING a coupled-but-SMALL pair,
 *   which is NEVER bounced): write the prd file (`work/prds/ready/<slug>.md`) with `issue: N` (+ the gate
 *   axes the verdict carried), integrate, STOP (tasking is the separate `do prd:`
 *   step).
 * - **BOUNCE** (genuinely UNRELATED concerns — no shared vision): the bounce is
 *   TERMINAL (the asks are unrelated and must be re-filed), so intake CLOSES the
 *   issue ATOMICALLY — the "file separate issues" text as the closing comment +
 *   `reason: not planned` (the honest GitHub-native signal) in ONE `closeIssue`
 *   call; emit NOTHING. Intake closes on BOUNCE (as not planned); NEVER on
 *   task/prd (CI's close-job closes those via the `issue:` field) / ask.
 *
 * The per-outcome integration KNOBS, the processing LOCK, and event-classification
 * are LATER tasks and are NOT built here (default `propose` is fine here).
 *
 * The AGENT only DRAFTS (returns the verdict object); the RUNNER (this dispatcher)
 * owns every git/seam side-effect — the write + integrate (and, in later tasks,
 * the comment + label ops). The agent is git-free AND seam-free: the in-band
 * boundary (the SAME discipline the build/tasker agents follow).
 */

/**
 * The four outcomes the decision prompt classifies an issue into (the decision
 * table). EXPAND step (prd
 * `prd-to-spec-vocabulary-cutover-and-migration-command`): the `spec` outcome is
 * added BESIDE the legacy `prd` outcome — both name the SAME "clear + coherent but
 * >1 task" classification (a parent SPEC), dispatched through the SAME path. Both
 * are valid through the cutover so the intake emit path can produce either until
 * the migrate batch flips the prompt onto `spec`; the contract task removes `prd`.
 */
export type IntakeOutcome = 'ask' | 'task' | 'spec' | 'prd' | 'bounce';

/**
 * The VERDICT the decision prompt returns — `{ask,task,prd,bounce}` + the drafted
 * content for the chosen outcome. THIS code path consumes only the `task` branch's
 * fields (`taskSlug` / `taskTitle` / `taskBody`); the `ask`/`prd`/`bounce`
 * fields are carried on the shape (so the type is stable for the next task) but
 * not dispatched here.
 */
export interface IntakeVerdict {
	/** Which outcome the prompt chose for the issue. */
	outcome: IntakeOutcome;
	/**
	 * The drafted task's content-derived slug (`task` outcome). The dispatcher
	 * SANITISES it (a content-derived slug, never a counter) before writing
	 * `work/backlog/<slug>.md`. Falls back to a slug derived from {@link taskTitle}
	 * when absent/empty.
	 */
	taskSlug?: string;
	/** The drafted task's `title:` (`task` outcome). */
	taskTitle?: string;
	/**
	 * The drafted task BODY (`task` outcome) — the markdown AFTER the frontmatter
	 * (the `## What to build` / `## Acceptance criteria` / `## Prompt` sections). The
	 * dispatcher writes the frontmatter (slug/title/`covers: []`, NO `prd:`) carrying
	 * the lone-task `issue: N` closure link itself; the agent never writes
	 * git-visible files.
	 */
	taskBody?: string;
	/**
	 * The drafted clarifying question (`ask` outcome) — the dispatcher posts it via
	 * `postIssueComment`, emits nothing, and STOPS (a later run resumes from the
	 * updated thread).
	 */
	question?: string;
	/**
	 * The drafted prd's content-derived slug (`prd` outcome). The dispatcher
	 * SANITISES it through `paramCase` (never a counter) before writing the prd
	 * file (`work/prds/ready/<slug>.md`). Falls back to a slug derived from {@link prdTitle} when
	 * absent/empty.
	 */
	prdSlug?: string;
	/** The drafted prd's `title:` (`prd` outcome). */
	prdTitle?: string;
	/**
	 * The drafted prd BODY (`prd` outcome) — the markdown AFTER the frontmatter
	 * (`## Problem Statement` / `## Solution` / `## User Stories` / …). The dispatcher
	 * writes the frontmatter (title/slug/`issue: N` + the gate axes) itself; the
	 * agent never writes git-visible files.
	 */
	prdBody?: string;
	/**
	 * The prd's gate axes (`prd` outcome) AS THE PROMPT JUDGED THEM — surfaced onto
	 * the emitted prd frontmatter (prd `issue-intake` US #8: "the emitted artifact
	 * carries … its own gate axes"). Both omitted (undeclared) by default; the prompt
	 * sets `prdHumanOnly: true` when a human should drive the TASKING and/or
	 * `prdNeedsAnswers: true` when open questions remain.
	 */
	prdHumanOnly?: boolean;
	prdNeedsAnswers?: boolean;
	/**
	 * The drafted bounce message (`bounce` outcome) — the dispatcher carries it as
	 * the CLOSING COMMENT on the atomic `closeIssue` ("please file separate issues")
	 * with `reason: not planned`, then emits nothing. A bounce is TERMINAL, so the
	 * issue is CLOSED (not left open).
	 */
	bounceMessage?: string;
}

/** The terminal status of one `intake <N>` run. */
export type IntakeRunOutcome =
	| 'tasked' // a `task` verdict → backlog task written + integrated
	| 'asked' // an `ask` verdict → clarifying question posted, nothing emitted
	| 'prd-written' // a `prd` verdict → the prd file (`work/prds/ready/<slug>.md`) written + integrated
	| 'bounced' // a `bounce` verdict → split-issues comment posted, nothing emitted
	| 'no-new-input' // the TRIAGE saw intake had the last word + nothing unseen → SKIP (ran, deliberately did nothing)
	| 'already-terminal' // the TRIAGE saw the issue was already transformed (a `bounced`/`created` marker) → SKIP
	| 'locked' // the `processing` lock was already held → backed off (did nothing)
	| 'lock-failed' // the lock could not be ACQUIRED on a label-supporting provider → fail (do NOT proceed lock-less)
	| 'agent-failed' // the decision agent invocation itself errored
	| 'stale' // the integrate rebase conflicted against an advanced main
	| 'usage-error'; // usage / environment problem

export interface IntakeResult {
	exitCode: 0 | 1 | 4;
	outcome: IntakeRunOutcome;
	/** The issue number acted on. */
	issueNumber: number;
	/** The slug of the emitted artifact (task OR prd outcome). */
	emittedSlug?: string;
	/** Repo-relative path of the emitted artifact (task OR prd outcome). */
	emitted?: string;
	/** True iff a comment was posted on the issue (ask / bounce outcomes). */
	commented?: boolean;
	/**
	 * True iff the ISSUE was closed (the BOUNCE outcome — a terminal bounce closes
	 * the issue atomically as `not planned`). Additive (mirrors {@link commented}),
	 * so CI / callers can observe the close. Never set on ask/task/prd.
	 */
	closed?: boolean;
	/** Human-readable summary of the terminal condition. */
	message: string;
}

/**
 * The DECISION step: given the issue + thread, return a VERDICT. Tests inject a
 * canned verdict (the STUBBED seam that drives the dispatcher, no model/network).
 * Production wires the harness through {@link harnessIntakeDecision}.
 */
export type IntakeDecider = (input: {
	cwd: string;
	issue: Issue;
	comments: IssueComment[];
	prompt: string;
	env?: NodeJS.ProcessEnv;
}) => Promise<IntakeVerdict>;

export interface PerformIntakeOptions {
	/** The issue number to intake (`intake <N>`). */
	issueNumber: number;
	/** The working clone/checkout the intake runs in. */
	cwd: string;
	/** Name of the arbiter git remote. Defaults to `origin`. */
	arbiter?: string;
	/**
	 * The issue seam (read the issue + thread). Tests inject a STUB; production
	 * defaults to {@link GitHubIssueProvider} (the only place `gh` is shelled out).
	 */
	issueProvider?: IssueProvider;
	/**
	 * The DECISION seam (prompt → verdict). Tests inject a CANNED verdict (no
	 * model/network) — this is the unit-test target. Production wires the harness.
	 */
	decide?: IntakeDecider;
	/**
	 * The LONE-TASK bounded-review seam (prompt → review verdict). After a `task`
	 * verdict and BEFORE the write/integrate, {@link dispatchTask} runs a bounded
	 * (3-round, HARD-CAPPED) adversarial self-review on the SINGLE drafted task
	 * through this seam (observation
	 * `intake-lone-task-skips-adversarial-review-the-prd-path-gets`, rulings A/B/C).
	 * Tests inject a CANNED review verdict (no model/network) — the new testable
	 * seam; production wires the harness ({@link harnessLoneTaskReviewGate}). It
	 * mirrors {@link decide}'s injectable shape, NOT the tasker loop (which is a
	 * SET-level reviewer this never imports/calls).
	 */
	reviewTask?: LoneTaskReviewGate;
	/** The harness seam used when {@link decide} is omitted; defaults to the null adapter. */
	harness?: Harness;
	/** The configured agent command the harness shells out to (null adapter). */
	agentCmd?: string;
	/** The model routing intent forwarded to the harness (ADR §13). */
	model?: string;
	/** The HOST-ONLY sessions root for the pi session file. */
	sessionsDir?: string;
	/**
	 * The PER-OUTCOME integration modes (prd `issue-intake` US #9) the emitted artifact integrates
	 * THROUGH the shared core with. Because `intake` decides the artifact TYPE at
	 * RUNTIME, the mode is keyed per type: an emitted task integrates with
	 * `integration.task`, an emitted prd with `integration.prd` (`propose` =
	 * push the `work/<slug>` branch + open a PR, NO `main` touch; `merge` = land on
	 * `main`). The CLI resolves this from the granular + aggregate flags via
	 * {@link resolveIntakeIntegrationModes}; ask/bounce emit nothing, so the modes
	 * are no-ops for them. Unset ⇒ propose for both.
	 */
	integration?: IntakeIntegrationModes;
	/**
	 * **The ORIGIN-TRUST verdict, passed IN** (task
	 * `untrusted-origin-forces-build-propose`; the `--origin-trust <trusted|untrusted>`
	 * CLI flag). `intake` STAMPS `origin: issue` + this `originTrust` onto every prd/
	 * task it emits, so the author-trust signal SURVIVES the prd/task merge
	 * boundary (a landed-on-main artifact otherwise erases how it was born, the
	 * laundering gap). `intake` does NOT resolve trust itself: the verdict is CI's
	 * POLICY, computed in the `intake.yml` shell from the SAME `author_association`
	 * case as the integration flags and threaded IN here (preserving the ~L296
	 * boundary). UNSET means the artifact is emitted UNSTAMPED, read as `human`/trusted:
	 * a LOCAL `dorfl intake <N>` (no CI shell, no `--origin-trust`) is the
	 * human-IS-the-checkpoint path, gate-free exactly as `do`.
	 */
	originTrust?: OriginTrust;
	/**
	 * **The PR-INTENT axis** (config `noPR`, ADR §6): when `true`, intake's propose
	 * emissions push the branch but skip the PR (the explicit suppress-PR intent).
	 * NOT a provider choice — the provider is purely arbiter-derived. Unset/false ⇒
	 * the PR opens normally.
	 */
	noPR?: boolean;
	/**
	 * **The per-repo PRD-PLACEMENT default, passed IN** (prd
	 * `staging-pool-position-gate-and-trust-model` US #2/#5, task
	 * `pre-prd-staging-pool-split-and-untrusted-prd-placement`). The resolved
	 * per-repo default landing for `intake`-authored prds (`pre-proposed` =
	 * staging; `ready` = the auto-tasking pool), fed as the CONFIGURED-DEFAULT rung
	 * into the shared placement resolver (`src/placement.ts`). The resolver
	 * overlays an EXPLICIT operator flag ({@link explicitPrdsLandIn}, top) and
	 * the UNTRUSTED-ORIGIN force (`originTrust: untrusted` ⇒ staging) on top.
	 * Unset ⇒ the resolver's built-in floor applies (`staging` = `prds/proposed/`,
	 * the conservative landing). The PRD TWIN of `tasksLandIn` on the tasker
	 * path — one resolver, two lifecycles.
	 */
	prdsLandIn?: PrdsLandIn;
	/**
	 * **The OPERATOR's EXPLICIT prd-placement override** (the TOP precedence
	 * rung). When set, the runner-deterministic resolver lands the prd HERE
	 * regardless of `originTrust` or {@link prdsLandIn} — the positional
	 * analogue of `explicitMerge` overriding the untrusted-origin
	 * build-propose rule ("the operator is present; CLI always wins, no
	 * special force-key"). Set ONLY when the operator typed
	 * `--prds-land-in <where>`; never when the value came from config.
	 */
	explicitPrdsLandIn?: PrdsLandIn;
	/**
	 * Optional FULLY-FORMED review provider INSTANCE used VERBATIM (the SAME seam
	 * `run`/`do` expose; forwarded to `performIntegration` as `providerInstance`).
	 * Tests/embeddings inject a stubbed `GitHubProvider` (a custom `gh` path) to
	 * drive intake's propose pipeline OFFLINE. The resolved provider OBJECT, NOT a
	 * config override. Unset ⇒ the core selects from the arbiter URL.
	 */
	providerInstance?: ReviewProvider;
	/**
	 * The optional runner IDENTITY (a bot), threaded from host-only
	 * `config.identity`. It scopes intake's GIT + provider operations — the `gh`
	 * issue ops (read/label/comment/close), the push, and the PR — via process-
	 * scoped env overrides. It is NEVER applied to the intake AGENT launches (the
	 * decision agent + the lone-task review agent), which stay ambient: an agent
	 * must not act as the bot. Absent ⇒ ambient (today's behaviour).
	 */
	identity?: Identity;
	/** Environment for child git/agent processes (the AGENT-launch ambient env). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

const DEFAULT_ARBITER = 'origin';

/**
 * **The STAGED-prds dir** (prd `staging-pool-position-gate-and-trust-model`,
 * task `pre-prd-staging-pool-split-and-untrusted-prd-placement`, governing
 * ADR `placement-is-runner-deterministic-humanonly-is-agent-judgement`). When
 * the runner-deterministic placement resolver picks the staging side for an
 * `intake`-authored prd, the runner writes the prd file HERE instead of in
 * `work/prds/ready/`. An item born in `prds/proposed/` is durable + readable but NOT in
 * the tasking candidate POOL (`work/prds/ready/` is the pool). A runner/human-owned promotion
 * ({@link promoteFromPrePrd} in `needs-attention.ts`) moves an approved prd
 * `prds/proposed/ → prds/ready/` to make it taskable.
 */
export const STAGED_PRDS_DIR = workFolderRel('specs-proposed');

/**
 * The POOL folder prds land in when the runner-deterministic placement
 * resolver chooses the pool side (`prdsLandIn: 'ready'` + a trusted origin, or
 * an `--prds-land-in ready` operator override). This is `work/prds/ready/`,
 * the tasking candidate pool.
 */
const POOL_PRDS_DIR = workFolderRel('specs-ready');

/** The placement slots for the prd lifecycle (folder names). */
const PRD_PLACEMENT_SLOTS: PlacementSlots = {
	staging: STAGED_PRDS_DIR,
	pool: POOL_PRDS_DIR,
};

/**
 * Map the `prdsLandIn` value spelling (`pre-proposed` | `ready`) onto the
 * resolver's lifecycle-generic side enum (`staging` | `pool`). Returns
 * `undefined` when no value is set, so the resolver's next precedence rung
 * applies (the built-in floor). The prd twin of `landingToSide` on the
 * tasker path — same shape, different slots.
 */
function prdLandingToSide(
	landing: PrdsLandIn | undefined,
): 'staging' | 'pool' | undefined {
	if (landing === 'pre-proposed') return 'staging';
	if (landing === 'ready') return 'pool';
	return undefined;
}

/**
 * The emitted artifact TYPE `intake` decides at RUNTIME — a `task` verdict emits
 * `work/backlog/<slug>.md`, a `prd` verdict emits the prd file (`work/prds/ready/<slug>.md`). The two
 * granular flag axes (`--merge-task`/`--propose-task` vs `--merge-prd`/
 * `--propose-prd`) are keyed on this. (ask/bounce emit NOTHING, so the modes are
 * no-ops for them.)
 */
export type IntakeArtifactType = 'task' | 'spec' | 'prd';

/**
 * The PER-OUTCOME integration mode FLAG SET (prd `issue-intake` US #9). Because
 * `intake` decides the artifact TYPE at runtime, a single `--merge`/`--propose`
 * cannot express a type-conditional policy ("merge a prd but propose a task") —
 * hence the four GRANULAR per-type flags layered over the two AGGREGATES:
 *
 * - **granular:** `--merge-prd`/`--propose-prd` apply iff the outcome is a prd;
 *   `--merge-task`/`--propose-task` apply iff it is a task.
 * - **aggregates:** `--merge` = merge BOTH types; `--propose` = propose BOTH.
 *
 * `intake` owns only these KNOBS; WHICH knobs CI sets (from gate state +
 * author-trust) is CI's POLICY, authored in `runner-in-ci` — NOT here.
 */
export interface IntakeIntegrationFlags {
	/** Aggregate: merge BOTH a task and a prd (the broad knob, overridden per type). */
	merge?: boolean;
	/** Aggregate: propose BOTH a task and a prd. */
	propose?: boolean;
	/** Granular: merge a prd (overrides the aggregate for the prd outcome). */
	mergePrd?: boolean;
	/** Granular: propose a prd (overrides the aggregate for the prd outcome). */
	proposePrd?: boolean;
	/** Granular: merge a task (overrides the aggregate for the task outcome). */
	mergeTask?: boolean;
	/** Granular: propose a task (overrides the aggregate for the task outcome). */
	proposeTask?: boolean;
}

/** Both per-type integration modes, resolved from the flag set in ONE eager pass. */
export interface IntakeIntegrationModes {
	/** The mode an EMITTED task integrates with. */
	task: IntegrationMode;
	/** The mode an EMITTED prd integrates with. */
	prd: IntegrationMode;
}

/** Default per-outcome integration mode when no flag selects one — propose (matches `do`). */
const DEFAULT_INTEGRATION: IntegrationMode = 'propose';

/**
 * Resolve the GRANULAR per-type axis (`--merge-<t>` / `--propose-<t>`) for ONE
 * artifact type, REUSING {@link integrationFromFlags} for its mutual-exclusion +
 * "mutually exclusive" error message (the same-type-both usage error) — so the
 * granular axis is NOT a forked second resolver, just `integrationFromFlags`
 * applied to the per-type pair. Returns the granular mode, or `undefined` when
 * neither granular flag for this type was given (the aggregate/default then
 * decides). The error message is reworded to name the granular flag pair.
 */
function granularFromFlags(
	type: IntakeArtifactType,
	merge: boolean | undefined,
	propose: boolean | undefined,
): IntegrationMode | undefined {
	try {
		return integrationFromFlags({merge, propose});
	} catch {
		throw new Error(
			`--merge-${type} and --propose-${type} are mutually exclusive; pass at most one.`,
		);
	}
}

/**
 * The PURE per-outcome integration mode resolution (prd `issue-intake` US #9 —
 * the canonical table). Given ONLY the flag set, resolve BOTH per-type modes in
 * one eager pass (so a usage error is caught before the runtime verdict is even
 * known). The rules, all decided in the prd:
 *
 * - **unset ⇒ propose for BOTH** (conservative default; matches `do`).
 * - **aggregates:** `--merge` ⇒ merge both; `--propose` ⇒ propose both (this axis
 *   COMPOSES the existing {@link integrationFromFlags}, reusing its mutual
 *   exclusion + error message).
 * - **granular routes per type:** `--merge-prd` merges a prd (and leaves a task at
 *   the aggregate/default), etc.
 * - **GRANULAR OVERRIDES AGGREGATE:** `--merge --propose-task` ⇒ merge a prd,
 *   propose a task.
 * - **same type + both modes is a usage ERROR:** `--merge-prd --propose-prd` (and
 *   `--merge-task --propose-task`), and the aggregate `--merge --propose`.
 *
 * Throws (a usage error) on any mutually-exclusive pair. The dispatcher picks the
 * field matching the runtime verdict's type; ask/bounce never integrate, so the
 * modes are no-ops for them.
 *
 * `defaultMode` is the FALLBACK when NEITHER a granular nor the aggregate flag
 * selects a mode for a type — it defaults to `propose` (so the pure table reads
 * "unset ⇒ propose for both"), but the CLI passes the per-repo/global
 * config-resolved mode so the established precedence chain (flag > per-repo >
 * global > default) is preserved, exactly as `do`/`complete` resolve it.
 */
export function resolveIntakeIntegrationModes(
	flags: IntakeIntegrationFlags,
	defaultMode: IntegrationMode = DEFAULT_INTEGRATION,
): IntakeIntegrationModes {
	// AGGREGATE axis — reuse the existing resolver (its mutual exclusion + the
	// "--merge and --propose are mutually exclusive" message). `undefined` ⇒ unset.
	const aggregate = integrationFromFlags({
		merge: flags.merge,
		propose: flags.propose,
	});
	// GRANULAR axes — `integrationFromFlags` per type (the same-type-both error).
	const prdGranular = granularFromFlags(
		'prd',
		flags.mergePrd,
		flags.proposePrd,
	);
	const taskGranular = granularFromFlags(
		'task',
		flags.mergeTask,
		flags.proposeTask,
	);
	// GRANULAR OVERRIDES AGGREGATE; aggregate over the (config/propose) default.
	// The result KEYS carry the task/prd vocabulary; the per-type flag axes
	// (`--merge-prd`/`--merge-task`) keep their user-facing spelling.
	return {
		prd: prdGranular ?? aggregate ?? defaultMode,
		task: taskGranular ?? aggregate ?? defaultMode,
	};
}

/**
 * Run `intake <N>` end-to-end (the LOCAL one-shot). Never throws for the expected
 * agent-failed / stale / usage cases — those are returned with the corresponding
 * exit code and outcome. The runner owns all git/seam side-effects; the agent only
 * DRAFTS the verdict.
 */
export async function performIntake(
	options: PerformIntakeOptions,
): Promise<IntakeResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	// `env` is intake's GIT + provider env, scoped to the configured identity (the
	// `gh` issue ops, the push, the PR). The intake AGENT launches (decision agent
	// + lone-task review agent) read `options.env` directly — they stay AMBIENT
	// (an agent must not act as the bot). Absent identity ⇒ `options.env` unchanged.
	// A configured identity that cannot be resolved (e.g. `tokenEnv` names an unset
	// env var) is a clean usage error, never a crash or a silent ambient fallback.
	const issueNumber = options.issueNumber;
	let env: NodeJS.ProcessEnv;
	try {
		env = identityEnv(options.identity, options.env ?? process.env);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		note(message);
		return {exitCode: 1, outcome: 'usage-error', issueNumber, message};
	}
	const issueProvider = options.issueProvider ?? new GitHubIssueProvider();

	// Push-time transport-coherence guard (identity): if a configured identity
	// forbids the arbiter's transport, fail with a clear message rather than
	// silently pushing under an ambient credential. Resolve the arbiter URL softly
	// (a non-zero/unknown URL is skipped — the guard is a no-op without an identity
	// or a resolvable URL).
	if (options.identity !== undefined) {
		const urlRes = await runAsync('git', ['remote', 'get-url', arbiter], cwd, {
			env,
		});
		if (urlRes.status === 0) {
			try {
				assertTransportAllowed(options.identity, urlRes.stdout.trim());
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				note(message);
				return {exitCode: 1, outcome: 'usage-error', issueNumber, message};
			}
		}
	}

	// 1. READ the issue + thread via the seam (the core never imports `gh`; only the
	//    adapter shells out). A read failure surfaces as a usage error — `intake`
	//    cannot decide without the issue.
	let issue: Issue;
	let comments: IssueComment[];
	try {
		issue = await issueProvider.getIssue({cwd, issueNumber, env});
		comments = await issueProvider.listComments({cwd, issueNumber, env});
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		const message = `Could not read issue #${issueNumber}: ${detail}`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', issueNumber, message};
	}

	// 2. ACQUIRE the `processing` LOCK (prd `issue-intake` US #10): a TRANSIENT concurrency mutex
	//    that serialises two concurrent runs on the SAME issue. Read the labels; if
	//    the lock is ALREADY present, BACK OFF (do nothing — another run owns it). The
	//    winner ADDS the label and proceeds; the label is REMOVED on finish (success
	//    OR handled failure, in the `finally` below). It is NOT a `work/` CAS and NOT a
	//    label state-machine (ADR §12) — ONE transient lock label.
	//
	//    Fail-vs-degrade (maintainer decision): a lock that is MEANINGFUL but cannot
	//    be taken must NOT silently proceed lock-less. Only a genuinely-UNSUPPORTED
	//    provider (no label concept at all) legitimately degrades to best-effort (the
	//    spec's provider-pluggability; CI's per-issue concurrency group is then the
	//    only serialiser — out of scope here). A real FAILURE on a label-supporting
	//    provider (e.g. `gh` unauthenticated) FAILS the run with the REAL cause
	//    surfaced, rather than misattributing it or proceeding without serialisation.
	const labels = await issueProvider.getLabels({cwd, issueNumber, env});
	if (labels.outcome === 'failed') {
		// The provider HAS labels but we could not READ the lock state — we cannot tell
		// whether another run holds it, so guessing "free" could let two runs proceed.
		// FAIL with the real cause (the actual `gh` stderr), not a hard-coded guess.
		const message =
			`Intake of issue #${issueNumber} could not acquire the ` +
			`\`${PROCESSING_LOCK_LABEL}\` lock: ${labels.instruction}`;
		note(message);
		return {exitCode: 1, outcome: 'lock-failed', issueNumber, message};
	}
	if (
		labels.outcome === 'ok' &&
		labels.labels.includes(PROCESSING_LOCK_LABEL)
	) {
		const message =
			`Intake of issue #${issueNumber} backed off: the \`${PROCESSING_LOCK_LABEL}\` ` +
			`lock is already held by a concurrent run; doing nothing.`;
		note(message);
		return {exitCode: 0, outcome: 'locked', issueNumber, message};
	}
	let locked = false;
	if (labels.outcome === 'ok') {
		const acquired = await issueProvider.addLabel({
			cwd,
			issueNumber,
			label: PROCESSING_LOCK_LABEL,
			env,
		});
		if (acquired.outcome === 'failed') {
			// The provider HAS labels but the ACQUIRE failed for a real reason (e.g. `gh`
			// lost auth, or the label could not be created on a fresh repo). The lock is
			// meaningful but unacquirable → FAIL with the real cause, do NOT proceed
			// lock-less (which would let a concurrent run race us).
			const message =
				`Intake of issue #${issueNumber} could not acquire the ` +
				`\`${PROCESSING_LOCK_LABEL}\` lock: ${acquired.instruction}`;
			note(message);
			return {exitCode: 1, outcome: 'lock-failed', issueNumber, message};
		}
		locked = acquired.applied;
	} else {
		// Non-label provider (genuinely UNSUPPORTED) → the ONLY legitimate degrade:
		// proceed without the lock, surfaced honestly.
		note(`Processing lock degraded: ${labels.instruction}`);
	}

	// INTERRUPTION-SAFETY (maintainer point 3): the `finally` below releases on every
	// EXCEPTION path, but a SIGINT/SIGTERM (Ctrl-C, kill) unwinds the process WITHOUT
	// running `finally` — which would LEAK the lock label and block all future intake
	// runs on this issue. While the lock is held we install signal handlers that
	// release it best-effort before the process exits. A leaked lock must ALSO be
	// recoverable by hand and that recovery must be DISCOVERABLE, so we surface the
	// exact manual command (`gh issue edit <N> --remove-label <label>`) whenever the
	// best-effort release does not confirm.
	const manualRecovery =
		`If the \`${PROCESSING_LOCK_LABEL}\` lock is left behind, release it with: ` +
		`gh issue edit ${issueNumber} --remove-label '${PROCESSING_LOCK_LABEL}'`;
	const releaseLock = createLockReleaser({
		locked,
		issueProvider,
		cwd,
		issueNumber,
		env,
		note,
		manualRecovery,
	});
	const onSignal = (signal: NodeJS.Signals) => {
		// Synchronous best-effort release on interruption, then re-raise the default
		// disposition so the process still exits with the conventional signal code.
		if (locked) {
			note(
				`Received ${signal}; releasing the \`${PROCESSING_LOCK_LABEL}\` lock on issue #${issueNumber} before exit.`,
			);
		}
		releaseLock.releaseSync();
		process.removeListener('SIGINT', onSignal);
		process.removeListener('SIGTERM', onSignal);
		process.kill(process.pid, signal);
	};
	if (locked) {
		process.once('SIGINT', onSignal);
		process.once('SIGTERM', onSignal);
	}

	try {
		return await decideAndDispatch(options, cwd, issue, comments, {
			arbiter,
			issueProvider,
			note,
			// The identity-scoped GIT/provider env (the `gh` ops, push, PR). The AGENT
			// launches inside dispatch read `options.env` (ambient) — not this.
			gitEnv: env,
		});
	} finally {
		// RELEASE the lock on FINISH (success OR handled failure). Only the winner that
		// actually acquired it releases it — a degraded/best-effort run holds nothing.
		process.removeListener('SIGINT', onSignal);
		process.removeListener('SIGTERM', onSignal);
		await releaseLock.release();
	}
}

/**
 * Build the lock RELEASER for {@link performIntake}: one `release()` (the normal
 * async finish path) and one `releaseSync()` (the signal-handler path — a
 * best-effort synchronous release that must run inside a signal handler). Both are
 * no-ops when the run never held the lock (a degraded/unsupported run holds
 * nothing). When a release does not CONFIRM, the manual-recovery hint is surfaced
 * so a leaked lock stays recoverable AND discoverable (maintainer point 3).
 */
function createLockReleaser(params: {
	locked: boolean;
	issueProvider: IssueProvider;
	cwd: string;
	issueNumber: number;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
	manualRecovery: string;
}): {release: () => Promise<void>; releaseSync: () => void} {
	const {locked, issueProvider, cwd, issueNumber, env, note, manualRecovery} =
		params;
	let released = false;
	const surfaceFailure = (instruction: string) => {
		note(`Processing lock release degraded: ${instruction}`);
		note(manualRecovery);
	};
	return {
		async release() {
			if (!locked || released) {
				return;
			}
			released = true;
			const result = await issueProvider.removeLabel({
				cwd,
				issueNumber,
				label: PROCESSING_LOCK_LABEL,
				env,
			});
			if (!result.applied) {
				surfaceFailure(result.instruction);
			}
		},
		releaseSync() {
			if (!locked || released) {
				return;
			}
			released = true;
			// A signal handler cannot await. The GitHub adapter's `removeLabel` shells out
			// SYNCHRONOUSLY (spawnSync) inside its async wrapper, so firing it here still
			// runs the `gh` call before the process exits — but we cannot READ the result
			// synchronously through the async seam, so we ALWAYS surface the manual-recovery
			// hint too. That keeps a leaked lock both recoverable AND discoverable even if
			// the in-handler release did not complete (maintainer point 3).
			void issueProvider.removeLabel({
				cwd,
				issueNumber,
				label: PROCESSING_LOCK_LABEL,
				env,
			});
			note(manualRecovery);
		},
	};
}

/**
 * The DECIDE (prompt → verdict) + DISPATCH (the four-outcome table) band, run
 * INSIDE the `processing` lock {@link performIntake} acquires/releases around it.
 * Split out so the lock release is a clean `try`/`finally` in the caller (the lock
 * MUST release on every terminal path — success or handled failure). The agent
 * DRAFTS only; the runner owns every git/seam side-effect here.
 */
async function decideAndDispatch(
	options: PerformIntakeOptions,
	cwd: string,
	issue: Issue,
	comments: IssueComment[],
	ctx: {
		arbiter: string;
		issueProvider: IssueProvider;
		note: (message: string) => void;
		/** The identity-scoped GIT/provider env (the `gh` ops, push, PR). */
		gitEnv: NodeJS.ProcessEnv | undefined;
	},
): Promise<IntakeResult> {
	const {arbiter, issueProvider, note} = ctx;
	const issueNumber = issue.number;
	// `env` here is the identity-scoped GIT/provider env (the runner's `gh`/git
	// ops). The AGENT launches (decision agent, lone-task review) use the AMBIENT
	// `options.env` — an agent must not act as the bot.
	const env = ctx.gitEnv;

	// TRIAGE (deterministic, under the lock, BEFORE the prompt): decide whether to run
	// the decision at all, built ENTIRELY on intake's own MARKER on the thread (no
	// sidecar/cursor/bot-identity). It SKIPS when intake has the last word
	// (`no-new-input`) or the issue is already terminal (`already-terminal`), and runs
	// the prompt ONLY on genuine new human input. This is also the COMPLETE fix for the
	// self-trigger hazard: intake's own freshly-posted comment carries a marker, so it
	// is excluded from the human-comment check by construction.
	const triage = triageIntake(comments);
	if (triage.action === 'skip') {
		const message =
			triage.outcome === 'no-new-input'
				? `Intake of issue #${issueNumber} found nothing new: it has the last word ` +
					`on the thread and has already seen every human comment up to it; doing ` +
					`nothing (the decision prompt did not run).`
				: `Intake of issue #${issueNumber} skipped: the issue was already ` +
					`transformed (a terminal intake marker is on the thread); a later human ` +
					`comment does not re-open it (the decision prompt did not run).`;
		note(message);
		return {exitCode: 0, outcome: triage.outcome, issueNumber, message};
	}

	// DECIDE: prompt → VERDICT. The agent DRAFTS only (no git, no seam ops). Tests
	// inject a canned verdict (the dispatcher's testable seam); production wires the
	// harness. The prompt's judgement is not unit-tested — only the dispatch.
	const prompt = buildIntakeDecisionPrd(issue, comments, triage);
	let verdict: IntakeVerdict;
	try {
		verdict = await runDecision(options, cwd, issue, comments, prompt);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		const message = `Intake decision failed for issue #${issueNumber}: ${detail}`;
		note(message);
		return {exitCode: 1, outcome: 'agent-failed', issueNumber, message};
	}

	// DISPATCH on the verdict — the FULL four-outcome decision table (prd
	// `issue-intake`). The agent only DRAFTED the verdict; the runner owns every
	// git/seam side-effect below (the in-band boundary): the write + integrate
	// (task/prd) and the `postIssueComment` (ask/bounce).
	//
	// PER-OUTCOME integration (prd `issue-intake` US #9): the resolved mode is keyed on the runtime
	// artifact TYPE — a `task` verdict integrates with the task mode, a `prd`
	// verdict with the prd mode. Unset ⇒ propose for both. ask/bounce never
	// integrate, so the modes are no-ops for them.
	const modes = options.integration ?? {task: 'propose', prd: 'propose'};
	// The per-run `seen=` DELTA (the HUMAN comment ids intake READ this run, excluding
	// its own marker-comments + already-seen ids) the marker records on every comment
	// intake posts — the chain-model primitive the TRIAGE unions into `seenSet`.
	const seenDelta = computeSeenDelta(comments);
	switch (verdict.outcome) {
		case 'task':
			return dispatchTask({
				verdict,
				issueNumber,
				cwd,
				arbiter,
				integration: modes.task,
				// The origin-trust STAMP, passed IN (not resolved here): the emitted task
				// carries `origin: issue` + this verdict so the becomes-code checkpoint is
				// not laundered. Unset ⇒ unstamped (a local intake ⇒ human/trusted).
				originTrust: options.originTrust,
				noPR: options.noPR,
				providerInstance: options.providerInstance,
				issueProvider,
				// The bounded lone-task review seam (tests inject a canned verdict;
				// production wires the harness via the default below).
				reviewTask: resolveLoneTaskReviewGate(options),
				seen: seenDelta,
				env,
				// The lone-task review AGENT launches AMBIENT (an agent must not act as
				// the bot); `env` above is the identity-scoped git/provider env.
				agentEnv: options.env,
				note,
			});
		// EXPAND step: the new `spec` outcome routes through the SAME dispatch as the
		// legacy `prd` outcome (they name the SAME parent-spec artifact). Both use
		// `modes.prd`; the migrate batch renames the key + dispatcher, the contract
		// task drops the `prd` case.
		case 'spec':
		case 'prd':
			return dispatchPrd({
				verdict,
				issueNumber,
				cwd,
				arbiter,
				integration: modes.prd,
				// Same origin-trust stamp on the prd outcome (propagated onto its tasks
				// later by the tasker). Passed IN; not resolved here.
				originTrust: options.originTrust,
				noPR: options.noPR,
				// RUNNER-DETERMINISTIC PLACEMENT (task
				// `pre-prd-staging-pool-split-and-untrusted-prd-placement`): the
				// configured-default + explicit-flag rungs, fed into the SHARED placement
				// resolver alongside the `originTrust` stamp above. The resolver decides
				// `prds/proposed/` (staging) vs `prds/ready/` (the tasking pool); `intake` never
				// places itself.
				prdsLandIn: options.prdsLandIn,
				explicitPrdsLandIn: options.explicitPrdsLandIn,
				providerInstance: options.providerInstance,
				issueProvider,
				seen: seenDelta,
				env,
				note,
			});
		case 'ask':
			return dispatchComment({
				outcome: 'asked',
				cwd,
				issueNumber,
				issueProvider,
				// The drafted clarifying question; a thin fallback keeps the comment
				// non-empty if the agent left it blank.
				body:
					verdict.question && verdict.question.trim() !== ''
						? verdict.question
						: `Could you clarify issue #${issueNumber} so it can be acted on?`,
				// STAMP the MARKER recording `kind=ask` (non-terminal — the TRIAGE owns
				// that) + the `seen=` delta, so a re-run recognises this as intake's own
				// turn and resumes only on genuine new human input.
				markerKind: 'ask',
				seen: seenDelta,
				env,
				note,
			});
		case 'bounce':
			return dispatchComment({
				outcome: 'bounced',
				cwd,
				issueNumber,
				issueProvider,
				// The drafted bounce message; a thin fallback restates the "file separate
				// issues" ask. A bounce is TERMINAL: the issue is CLOSED atomically (this
				// text as the closing comment + reason not planned).
				body:
					verdict.bounceMessage && verdict.bounceMessage.trim() !== ''
						? verdict.bounceMessage
						: `This issue looks like multiple unrelated concerns — please file ` +
							`separate issues so each can be intaken on its own.`,
				// STAMP `kind=bounced` (TERMINAL — the TRIAGE then SKIPS `already-terminal`
				// on a later human comment) + the `seen=` delta.
				markerKind: 'bounced',
				seen: seenDelta,
				env,
				note,
			});
	}
}

/**
 * DISPATCH the `ask` / `bounce` outcomes — the SHARED comment band, which now
 * BRANCHES on the outcome:
 *
 * - **ask** (non-terminal): `postIssueComment` the drafted question, emit NOTHING,
 *   and LEAVE THE ISSUE OPEN — it waits for the thread to be answered (a later run
 *   resumes from it). The task/prd path also never closes (CI's close-job does,
 *   via the `issue:` field). Intake closes ONLY on BOUNCE.
 * - **bounce** (TERMINAL): the asks are unrelated and must be re-filed, so an OPEN
 *   issue is a dishonest "still in play" signal. Intake CLOSES the issue
 *   ATOMICALLY via a single `closeIssue` carrying the bounce text as the closing
 *   comment + `reason: not planned` (one call — no post-then-close partial-failure
 *   window). The result's `closed` reflects it.
 *
 * Both the comment poster and the atomic close are advisory and DEGRADE (a
 * missing/unauthenticated `gh` never throws — the text/real cause is surfaced via
 * `ghFailureReason`, never a hard-coded guess), so the terminal outcome is
 * unchanged (`asked`/`bounced`, exit 0) and the run still terminates cleanly.
 */
async function dispatchComment(params: {
	outcome: 'asked' | 'bounced';
	cwd: string;
	issueNumber: number;
	issueProvider: IssueProvider;
	body: string;
	/** The neutral `kind` the MARKER records (`ask` for an ask, `bounced` for a bounce). */
	markerKind: IntakeMarkerKind;
	/** The per-run `seen=` delta of HUMAN comment ids intake read this run. */
	seen: string[];
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<IntakeResult> {
	const {
		outcome,
		cwd,
		issueNumber,
		issueProvider,
		body,
		markerKind,
		seen,
		env,
		note,
	} = params;
	// STAMP the intake MARKER onto the body so a re-run recognises this as intake's
	// own comment (the SOLE self-recognition signal — no author identity). Hidden HTML
	// comment; renders as nothing, present in the raw markdown the TRIAGE parses.
	const stamped = stampIntakeMarker(body, {kind: markerKind, seen});

	if (outcome === 'bounced') {
		// BOUNCE is TERMINAL: CLOSE the issue ATOMICALLY (bounce text as the closing
		// comment + reason not planned) in ONE call — no separate postIssueComment, no
		// post-then-close window. The close DEGRADES (never throws) on a missing/
		// unauthenticated `gh`, surfacing the REAL cause; the terminal outcome stays
		// `bounced`/exit 0 regardless.
		const close = await issueProvider.closeIssue({
			cwd,
			issueNumber,
			comment: stamped,
			reason: 'not planned',
			env,
		});
		const tail = close.closed
			? 'the issue was closed (as not planned) with the bounce comment'
			: `the issue could NOT be closed (${close.instruction})`;
		const message =
			`Intake bounced issue #${issueNumber}; emitted no artifact and closed the ` +
			`issue as not planned — ${tail}.`;
		note(message);
		return {
			exitCode: 0,
			outcome,
			issueNumber,
			commented: close.closed,
			closed: close.closed,
			message,
		};
	}

	// ASK (non-terminal): post the clarifying question and LEAVE THE ISSUE OPEN.
	const posted = await issueProvider.postIssueComment({
		cwd,
		issueNumber,
		body: stamped,
		env,
	});
	const tail = posted.posted
		? 'the comment was posted'
		: `the comment could NOT be posted (${posted.instruction})`;
	const message =
		`Intake asked a clarifying question on issue #${issueNumber}; emitted no ` +
		`artifact and left the issue open — ${tail}.`;
	note(message);
	return {
		exitCode: 0,
		outcome,
		issueNumber,
		commented: posted.posted,
		message,
	};
}

/**
 * DISPATCH the `task` outcome: derive a content-derived slug, write
 * `work/backlog/<slug>.md` (`covers: []`, NO `prd:`) carrying `issue: N` (the
 * lone-task closure link, NOT `Fixes #N`), and integrate via {@link
 * performIntegration}. The runner owns the git: it onboards a
 * `work/<slug>` branch off fresh `<arbiter>/main`, then the lifecycle `stage`
 * writes + stages the task and the band commits + rebases + integrates it. The
 * agent did NO git/seam ops.
 */
async function dispatchTask(params: {
	verdict: IntakeVerdict;
	issueNumber: number;
	cwd: string;
	arbiter: string;
	integration: IntegrationMode;
	/** The origin-trust stamp passed IN (unset ⇒ emit unstamped ⇒ human/trusted). */
	originTrust: OriginTrust | undefined;
	noPR: boolean | undefined;
	providerInstance: ReviewProvider | undefined;
	/** The issue seam the completion comment is posted back through (runner-owned). */
	issueProvider: IssueProvider;
	/** The bounded lone-task review seam (tests inject a canned verdict; prod: harness). */
	reviewTask: LoneTaskReviewGate;
	/** The per-run `seen=` delta of HUMAN comment ids the completion marker records. */
	seen: string[];
	/** The identity-scoped GIT/provider env (push, PR, completion comment). */
	env: NodeJS.ProcessEnv | undefined;
	/** The AMBIENT env for the lone-task review AGENT launch (never the identity). */
	agentEnv: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<IntakeResult> {
	const {
		verdict,
		issueNumber,
		cwd,
		arbiter,
		integration,
		originTrust,
		noPR,
		providerInstance,
		issueProvider,
		reviewTask,
		seen,
		env,
		agentEnv,
		note,
	} = params;

	// A content-derived slug — NEVER a counter (prd `issue-intake` US #8). Prefer the drafted
	// `taskSlug`, else derive from the drafted title; sanitise either through
	// `paramCase` so the filename + frontmatter slug are well-formed.
	const slug = resolveSlug(verdict);
	if (slug === '') {
		const message =
			`Intake produced a 'task' verdict for issue #${issueNumber} with no usable ` +
			`slug/title to derive a content-derived slug from (never a counter).`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', issueNumber, message};
	}
	const relPath = workItemRel('tasks-ready', `${slug}.md`);

	// BOUNDED INTERNAL REVIEW (observation
	// `intake-lone-task-skips-adversarial-review-the-prd-path-gets`, rulings A/B/C):
	// the `do prd:` path gets `runTaskReviewLoop`; the lone-TASK path got NOTHING.
	// AFTER the `task` verdict and BEFORE the write/integrate, run a bounded (3-round,
	// HARD-CAPPED) adversarial self-review on the SINGLE drafted task. It mutates the
	// candidate body IN MEMORY (no `work/backlog/` write pre-convergence). A launch/
	// parse failure THROWS — `decideAndDispatch`'s try/catch maps it onto `agent-failed`
	// (never a silent emit of the un-reviewed task).
	let review: LoneTaskReviewResult;
	try {
		review = await runLoneTaskReview({
			slug,
			issueNumber,
			draftTitle: verdict.taskTitle ?? slug,
			draftBody: verdict.taskBody,
			gate: reviewTask,
			cwd,
			// The review AGENT launches AMBIENT (never the identity-scoped env).
			env: agentEnv,
			note,
		});
	} catch (err) {
		// A review-agent launch/parse FAILURE DEGRADES honestly onto the EXISTING
		// `agent-failed` outcome (exit 1) — NEVER a silent emit of the un-reviewed
		// task. The SAME try/catch discipline the decision step uses.
		const detail = err instanceof Error ? err.message : String(err);
		const message = `Intake lone-task review failed for issue #${issueNumber}: ${detail}`;
		note(message);
		return {exitCode: 1, outcome: 'agent-failed', issueNumber, message};
	}

	if (review.outcome === 'non-converge') {
		// NON-CONVERGE (ruling C): FLIP the verdict TASK→ASK, reusing the EXISTING
		// `asked` outcome + `kind=ask` marker. The ASK comment carries BOTH the proposed
		// task DRAFT and the open question(s) in its BODY (NOT a new marker kind) — the
		// human reacts to a concrete draft, strictly richer than a blank-question ask.
		// NEVER write `work/backlog/<slug>.md`; NEVER silently emit the under-refined
		// task. The next intake run resumes via the already-built triage gate.
		note(
			`Intake's lone-task review did not converge for issue #${issueNumber} ` +
				`(${review.passes} round(s)); flipping TASK→ASK with the draft + open ` +
				`question(s) in the comment body.`,
		);
		return dispatchComment({
			outcome: 'asked',
			cwd,
			issueNumber,
			issueProvider,
			body: composeLoneTaskAskComment({
				issueNumber,
				slug,
				draftTitle: review.title,
				draftBody: review.body,
				questions: review.questions,
			}),
			markerKind: 'ask',
			seen,
			env,
			note,
		});
	}

	// CONVERGED: the (possibly edited) task is emitted via the EXISTING write/integrate
	// path below + the existing `task created` completion comment. The refined body
	// replaces the agent's first draft.
	const reviewedBody = review.body;

	// ONBOARD the task write onto a `work/intake-task-<slug>` branch cut from the
	// freshly-fetched `<arbiter>/main` (the SAME runner-owns-git discipline the
	// tasking path uses): the lifecycle `stage` writes the file ON THIS BRANCH and
	// the shared integrate core (`--propose` PR / `--merge` main) lands it. The
	// intake- producer prefix keeps it distinct from a later `do task:<slug>`
	// build branch for the same slug. The agent ran no git.
	await switchToWorkBranch(cwd, arbiter, 'task', slug, env);

	const taskContent = renderBacklogTask({
		slug,
		title: review.title,
		body: reviewedBody,
		issueNumber,
		originTrust,
	});

	const core = await performIntegration({
		cwd,
		arbiter,
		slug,
		// `source`/`recovering` are task-shaped and IGNORED when `lifecycle` is set.
		source: 'in-progress',
		recovering: false,
		// An intake-emitted task has no `verify` floor of its own (it is a new
		// backlog item, not a build); skip the acceptance gate, exactly as the
		// tasking transition does.
		skipVerify: true,
		// Default `propose` (the per-outcome KNOBS are a later task). The
		// EXPLICITLY-chosen mode proceeds as-is: a future `--merge-task` lands on main
		// (`merge` IS the auto-land mode, never downgraded).
		mode: integration,
		noPR,
		providerInstance,
		type: 'feat',
		lifecycle: {
			// The emitted task IS the title source. Pass the DRAFTED title EXPLICITLY
			// (not a read-from-path): `stage()` WRITES `work/backlog/<slug>.md` AFTER the
			// core reads the title, so a `titlePath` read would race the write and degrade
			// the commit subject / PR title to the generic fallback. `titlePath` stays set
			// (the lifecycle contract requires it) but is IGNORED while `title` is present.
			titlePath: join(cwd, relPath),
			title: review.title,
			commitTag: 'intake',
			stage: () =>
				stageIntakeContent({cwd, relPath, content: taskContent, env}),
		},
		env,
		note,
	});

	return integrationToIntakeResult(core, {
		issueNumber,
		slug,
		relPath,
		cwd,
		issueProvider,
		seen,
		env,
		note,
	});
}

/**
 * DISPATCH the `prd` outcome: derive a content-derived slug, write the prd
 * file (`work/prds/ready/<slug>.md`) carrying `issue: N` (the loop-closure linkage the close JOB
 * reaches via `task.prd: → prd issue:`; on a fanned prd the number lives ONLY on
 * the prd — a fanned task uses `prd:`, NOT its own `issue:`, which is the
 * lone-task outcome's link) + the gate axes the prompt JUDGED, integrate it
 * via {@link performIntegration}, then STOP. Tasking the emitted prd is the SEPARATE
 * `do prd:` step (NOT done here). A coupled-but-SMALL pair lands here too (the prd
 * vs BOUNCE line is SHARED VISION, not size — the over-bounce guard). The runner
 * owns the git exactly as the task branch does; the agent did NO git/seam ops.
 */
async function dispatchPrd(params: {
	verdict: IntakeVerdict;
	issueNumber: number;
	cwd: string;
	arbiter: string;
	integration: IntegrationMode;
	/** The origin-trust stamp passed IN (unset ⇒ emit unstamped ⇒ human/trusted). */
	originTrust: OriginTrust | undefined;
	noPR: boolean | undefined;
	/** The per-repo PRD-PLACEMENT default (configured-default rung of the placement chain). */
	prdsLandIn: PrdsLandIn | undefined;
	/** The OPERATOR's EXPLICIT prd-placement override (the TOP rung). */
	explicitPrdsLandIn: PrdsLandIn | undefined;
	providerInstance: ReviewProvider | undefined;
	/** The issue seam the completion comment is posted back through (runner-owned). */
	issueProvider: IssueProvider;
	/** The per-run `seen=` delta of HUMAN comment ids the completion marker records. */
	seen: string[];
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<IntakeResult> {
	const {
		verdict,
		issueNumber,
		cwd,
		arbiter,
		integration,
		originTrust,
		noPR,
		prdsLandIn,
		explicitPrdsLandIn,
		providerInstance,
		issueProvider,
		seen,
		env,
		note,
	} = params;

	// A content-derived slug — NEVER a counter (prd `issue-intake` US #8). Prefer the drafted
	// `prdSlug`, else derive from the drafted title.
	const slug = resolvePrdSlug(verdict);
	if (slug === '') {
		const message =
			`Intake produced a 'prd' verdict for issue #${issueNumber} with no usable ` +
			`slug/title to derive a content-derived slug from (never a counter).`;
		note(message);
		return {exitCode: 1, outcome: 'usage-error', issueNumber, message};
	}
	// RUNNER-DETERMINISTIC PLACEMENT (task
	// `pre-prd-staging-pool-split-and-untrusted-prd-placement`, governing ADR
	// `placement-is-runner-deterministic-humanonly-is-agent-judgement`). Resolve
	// which folder the runner writes the intake-authored prd into BEFORE handing
	// it to the shared integrate band: the SAME precedence chain the tasker uses
	// (`explicit > untrusted-origin ⇒ staging > prdsLandIn > built-in (staging)`),
	// the SAME shared resolver — only the lifecycle SLOTS differ. The agent
	// (the intake decider) never influences placement; it returns the verdict and
	// the runner computes the destination from unforgeable inputs.
	const placementDecision = resolvePlacement({
		explicit: prdLandingToSide(explicitPrdsLandIn),
		originTrust,
		configuredDefault: prdLandingToSide(prdsLandIn),
	});
	const placementDir = placementFolder(
		PRD_PLACEMENT_SLOTS,
		placementDecision.choice,
	);
	const relPath = `${placementDir}/${slug}.md`;

	// ONBOARD onto a `work/intake-prd-<slug>` branch off fresh `<arbiter>/main` —
	// the SAME runner-owns-git discipline the task branch uses; the intake-
	// producer prefix keeps it distinct from a `do prd:<slug>` tasking branch.
	await switchToWorkBranch(cwd, arbiter, 'prd', slug, env);

	const prdContent = renderPrd({
		slug,
		title: verdict.prdTitle ?? slug,
		body: verdict.prdBody,
		issueNumber,
		humanOnly: verdict.prdHumanOnly,
		needsAnswers: verdict.prdNeedsAnswers,
		originTrust,
	});

	const core = await performIntegration({
		cwd,
		arbiter,
		slug,
		source: 'in-progress',
		recovering: false,
		// An intake-emitted prd has no `verify` floor of its own (it is a new spec,
		// not a build), exactly as the task branch + the tasking transition skip it.
		skipVerify: true,
		mode: integration,
		noPR,
		providerInstance,
		type: 'feat',
		lifecycle: {
			// The emitted prd IS the title source. Pass the DRAFTED title EXPLICITLY (same
			// race as the task path: `stage()` writes the prd file AFTER the title
			// read). `titlePath` stays set but is IGNORED while `title` is present.
			titlePath: join(cwd, relPath),
			title: verdict.prdTitle ?? slug,
			commitTag: 'intake',
			stage: () => stageIntakeContent({cwd, relPath, content: prdContent, env}),
		},
		env,
		note,
	});

	return integrationToIntakeResult(core, {
		issueNumber,
		slug,
		relPath,
		kind: 'prd',
		cwd,
		issueProvider,
		seen,
		env,
		note,
	});
}

/**
 * Map the shared integrate band's {@link IntegrationCoreResult} onto the intake
 * {@link IntakeResult}. On `completed` the artifact was written + integrated; a
 * `rebase-conflict` against an advanced `main` maps to `stale` (the analogue of
 * "the backlog moved under us"); everything else maps defensively to a usage error
 * (the intake task path passes `skipVerify` + has no review gate, so neither
 * `gate-failed` nor `review-blocked` can occur).
 */
async function integrationToIntakeResult(
	core: IntegrationCoreResult,
	ctx: {
		issueNumber: number;
		slug: string;
		relPath: string;
		kind?: 'task' | 'prd';
		/** The working checkout the issue seam shells `gh` in. */
		cwd: string;
		/** The issue seam the completion comment is posted back through. */
		issueProvider: IssueProvider;
		/** The per-run `seen=` delta the completion marker records (chain model). */
		seen: string[];
		env: NodeJS.ProcessEnv | undefined;
		note: (message: string) => void;
	},
): Promise<IntakeResult> {
	const {issueNumber, slug, relPath, cwd, issueProvider, seen, env, note} = ctx;
	const kind = ctx.kind ?? 'task';
	const artifact = kind === 'prd' ? 'prd' : 'task';
	if (core.outcome === 'completed') {
		const landed =
			core.integration?.mode === 'merge'
				? 'landed it on the arbiter main'
				: 'opened a PR carrying it (main untouched)';
		// Both a lone task and a prd carry `issue: N` as their closure link (the task
		// closes its own issue; a prd is reached via `task.prd: → prd issue:`). On the
		// task/prd path `intake` never closes the issue (CI's close-job does, via the
		// `issue:` field; intake closes ONLY on BOUNCE) and emits no `Fixes #N` (a
		// deferred GitHub-only optimisation).
		const link = `issue: ${issueNumber}`;
		const message =
			`Intake of issue #${issueNumber} → wrote ${relPath} (${link}); ` +
			`the runner integrated it through the shared core and ${landed}.`;
		// CLOSE THE LOOP (this task): post ONE INFORMATIONAL completion comment back on
		// the issue for the SUCCESSFUL outcome — the confirmation the ASK/BOUNCE comments
		// already give the author. It reports `task created` / `prd created` (NEVER
		// "issue resolved"; intake never closes on task/prd — CI's close-job does, via
		// the `issue:` field) and links the artifact by integration mode: the PR `url` in
		// propose, the landed `commit` in merge. The marker carries `kind=created` (the
		// TRIAGE treats it as TERMINAL → `already-terminal`), so the comment cannot
		// re-trigger intake. ADVISORY — it DEGRADES (a missing/unauthenticated `gh` never
		// throws), so a degrade leaves the run's success outcome unchanged.
		const posted = await postCompletionComment({
			issueProvider,
			issueNumber,
			kind,
			slug,
			integration: core.integration,
			seen,
			cwd,
			env,
			note,
		});
		return {
			exitCode: 0,
			outcome: kind === 'prd' ? 'prd-written' : 'tasked',
			issueNumber,
			emittedSlug: slug,
			emitted: relPath,
			commented: posted,
			message,
		};
	}
	if (core.outcome === 'rebase-conflict') {
		return {
			exitCode: 4,
			outcome: 'stale',
			issueNumber,
			message:
				core.reason ??
				`Integrating the intake ${artifact} for issue #${issueNumber} conflicted ` +
					`against the latest main; re-run intake.`,
		};
	}
	return {
		exitCode: 1,
		outcome: 'usage-error',
		issueNumber,
		message:
			core.reason ??
			`Integrating the intake ${artifact} for issue #${issueNumber} failed unexpectedly.`,
	};
}

/**
 * Build the INFORMATIONAL completion-comment BODY (with its FULL `created` marker)
 * for a SUCCESSFUL `task` / `prd` outcome — the PURE, seam-free core of
 * {@link postCompletionComment}, exported so both link variants are unit-testable
 * without a live seam. The comment:
 *
 * - reports `task created` / `prd created` framed as CREATED — NEVER "issue
 *   resolved/closed" (intake never closes on the task/prd path).
 * - LINKS the artifact by INTEGRATION MODE: the PR `url` in propose, the landed
 *   `commit` (the additive {@link IntegrateResult.commit}) in merge. A degraded
 *   propose (no `url`) or a failed merge-tip read (no `commit`) simply OMITS the
 *   link — the comment still confirms what was created (the artifact is safe on the
 *   branch/main regardless). No prd link beyond the slug.
 * - carries the FULL intake MARKER via the SHARED {@link stampIntakeMarker} helper
 *   (`kind=created slug=<slug> seen=<id>,…`) so the triage's `already-terminal`
 *   branch consumes it — the comment cannot re-trigger intake.
 */
export function composeIntakeCompletionComment(params: {
	kind: 'task' | 'prd';
	slug: string;
	integration: IntegrateResult | undefined;
	seen: string[];
}): string {
	const {kind, slug, integration, seen} = params;
	const artifact = kind === 'prd' ? 'prd' : 'task';
	const link =
		integration?.mode === 'merge'
			? integration.commit !== undefined
				? `\n\nIt landed on \`main\` in commit ${integration.commit}.`
				: ''
			: integration?.url !== undefined
				? `\n\nIt is carried by the PR: ${integration.url}`
				: '';
	const body =
		`Created ${artifact} \`${slug}\` from this issue.${link}\n\n` +
		`This is an informational update — the issue stays open (it remains in play ` +
		`until the ${artifact} lands; intake does not change the issue's state).`;
	// STAMP the FULL marker (incl. `seen=`) via the SHARED helper, so the triage's
	// `already-terminal` branch recognises this terminal `created` comment.
	return stampIntakeMarker(body, {kind: 'created', seen, slug});
}

/**
 * Post the INFORMATIONAL completion comment for a SUCCESSFUL `task` / `prd`
 * outcome (this task). It closes the loop the ASK/BOUNCE comments already close
 * for the other outcomes: the issue author gets a confirmation when intake did the
 * useful thing. The comment:
 *
 * - reports `task created` / `prd created` — NEVER "issue resolved/closed".
 *   Intake never closes the issue on the task/prd path (CI's future close-job
 *   does, via the `issue:` field); this comment changes NO issue state.
 * - LINKS the artifact by INTEGRATION MODE: the PR `url` in propose, the landed
 *   `commit` (the additive {@link IntegrateResult.commit} this task surfaces) in
 *   merge. No prd link beyond the slug.
 * - carries the FULL intake MARKER via the SHARED {@link stampIntakeMarker} helper
 *   (`kind=created slug=<slug> seen=<id>,…`). `kind=created` is TERMINAL, so the
 *   triage's `already-terminal` branch then treats the issue as already-transformed
 *   — the completion comment cannot re-trigger intake.
 *
 * ADVISORY — it DEGRADES (a missing/unauthenticated `gh` surfaces the text, never
 * throws), so a degrade does NOT change the run's success outcome. Returns whether
 * a comment was actually posted (for {@link IntakeResult.commented}).
 */
async function postCompletionComment(params: {
	issueProvider: IssueProvider;
	issueNumber: number;
	kind: 'task' | 'prd';
	slug: string;
	/** The integrate result — carries the propose `url` / the merge `commit` link. */
	integration: IntegrateResult | undefined;
	/** The per-run `seen=` delta the marker records (the chain-model primitive). */
	seen: string[];
	/** The working checkout the issue seam shells `gh` in. */
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<boolean> {
	const {
		issueProvider,
		issueNumber,
		kind,
		slug,
		integration,
		seen,
		cwd,
		env,
		note,
	} = params;
	const artifact = kind === 'prd' ? 'prd' : 'task';
	// Build the full stamped body (CREATED wording + mode-keyed link + the FULL
	// `created` marker) via the exported pure builder — unit-tested directly for both
	// link variants (propose `url` / merge `commit`).
	const stamped = composeIntakeCompletionComment({
		kind,
		slug,
		integration,
		seen,
	});
	const posted = await issueProvider.postIssueComment({
		cwd,
		issueNumber,
		body: stamped,
		env,
	});
	note(
		posted.posted
			? `Posted a '${artifact} created' completion comment on issue #${issueNumber}.`
			: `Could not post the completion comment on issue #${issueNumber} ` +
					`(${posted.instruction}); the ${artifact} was still created.`,
	);
	return posted.posted;
}

/**
 * Resolve a content-derived slug from the verdict — NEVER a counter (prd `issue-intake` US #8).
 * Prefer the drafted `taskSlug`, else derive from the drafted title; both go
 * through `paramCase` (the brand case-transform) so the result is a clean
 * lowercase-`-`-joined slug. An empty result (no slug AND no title) signals the
 * caller to refuse (a counter fallback is forbidden).
 */
function resolveSlug(verdict: IntakeVerdict): string {
	const candidate =
		verdict.taskSlug && verdict.taskSlug.trim() !== ''
			? verdict.taskSlug
			: (verdict.taskTitle ?? '');
	return paramCase(candidate);
}

/**
 * Resolve a content-derived slug for the prd outcome — NEVER a counter (prd `issue-intake` US #8).
 * Prefer the drafted `prdSlug`, else derive from the drafted prd title; both go
 * through `paramCase`. An empty result signals the caller to refuse.
 */
function resolvePrdSlug(verdict: IntakeVerdict): string {
	const candidate =
		verdict.prdSlug && verdict.prdSlug.trim() !== ''
			? verdict.prdSlug
			: (verdict.prdTitle ?? '');
	return paramCase(candidate);
}

/**
 * Render the backlog task file: the frontmatter (`title`/`slug`/`covers: []`, NO
 * `prd:` — its own source of truth, prd `issue-intake` decision table) carrying the lone-task
 * `issue: N` closure link + the drafted body. The task closes its source issue
 * via its `issue:` field (the provider-agnostic link a FUTURE CI close-job reads
 * from folder + field state); it carries NO `Fixes #N` (a deferred GitHub-only
 * optimisation, structurally unplaceable on the `--merge` path). The number is
 * the task's own closure path — `issue:` XOR `prd:`; a lone task never carries a
 * `prd:` (prd `issue-intake` decision table). When the agent drafted no body, a thin default
 * scaffold keeps the file a valid task.
 */
export function renderBacklogTask(params: {
	slug: string;
	title: string;
	body: string | undefined;
	issueNumber: number;
	/**
	 * The origin-trust STAMP (task `untrusted-origin-forces-build-propose`).
	 * Present ⇒ emit `origin: issue` + `originTrust: <value>` so the becomes-code
	 * checkpoint survives the merge boundary. UNSET (a local intake, no CI shell)
	 * ⇒ NO stamp (the human running intake IS the checkpoint ⇒ human/trusted).
	 */
	originTrust?: OriginTrust;
}): string {
	const {slug, title, body, issueNumber, originTrust} = params;
	const lines = [
		'---',
		`title: ${title}`,
		`slug: ${slug}`,
		`issue: ${issueNumber}`,
	];
	if (originTrust !== undefined) {
		lines.push('origin: issue', `originTrust: ${originTrust}`);
	}
	lines.push('covers: []', 'blockedBy: []', '---');
	const frontmatter = lines.join('\n');
	// The drafted body (agent-authored, headings and all) is wrapped VERBATIM.
	// Only the empty-body DEFAULT SCAFFOLD is sourced from the shared section
	// skeleton owner (`renderTaskBody`, prd
	// `centralize-buildable-task-renderer-shared-by-intake-and-promotion` US #2),
	// so intake's fallback and promotion's body cannot drift on section
	// names/order. The shared renderer ends its body with a trailing newline (its
	// last line is a blank); intake owns the single trailing `\n` in the join
	// below, so we `trimEnd()` the renderer output to stay byte-for-byte identical
	// to the pre-rewire literal.
	const drafted =
		body && body.trim() !== ''
			? body.trim()
			: renderTaskBody({
					whatToBuild: title,
					acceptanceCriteria: '- [ ] the issue is resolved',
					prompt: `Resolve issue #${issueNumber}: ${title}`,
				}).trimEnd();
	return `${frontmatter}\n\n${drafted}\n`;
}

/**
 * Render the emitted prd file: the frontmatter (`title`/`slug` + the loop-closure
 * `issue: N` + the gate axes the prompt JUDGED) followed by the drafted prd body.
 * For a FANNED prd the `issue: N` lives ONLY on the prd — never duplicated across
 * the N fanned tasks, which reach it via `task.prd: → prd issue:` (a fanned
 * task carries `prd:`, NOT its own `issue:`; the lone-task outcome is the only
 * one that puts `issue:` on a task). The close JOB reaches the prd's number via
 * `task.prd: → prd issue:`. The gate axes (`humanOnly`/`needsAnswers`) are emitted ONLY when the
 * verdict declared them `true` — an omitted axis is `undefined` (undeclared), the
 * same convention `frontmatter.ts` parses. When the agent drafted no body, a thin
 * default scaffold keeps the file a valid prd that `do prd:` can later task.
 */
export function renderPrd(params: {
	slug: string;
	title: string;
	body: string | undefined;
	issueNumber: number;
	humanOnly: boolean | undefined;
	needsAnswers: boolean | undefined;
	/**
	 * The origin-trust STAMP (task `untrusted-origin-forces-build-propose`).
	 * Present ⇒ emit `origin: issue` + `originTrust: <value>`, PROPAGATED onto every
	 * emitted task by the tasker so the build transition can read it. UNSET (a
	 * local intake) ⇒ NO stamp (human/trusted).
	 */
	originTrust?: OriginTrust;
}): string {
	const {slug, title, body, issueNumber, humanOnly, needsAnswers, originTrust} =
		params;
	const lines = [
		'---',
		`title: ${title}`,
		`slug: ${slug}`,
		`issue: ${issueNumber}`,
	];
	// The origin-trust stamp (only when passed IN from the CI shell): the
	// becomes-code checkpoint that survives the merge boundary. A local intake
	// leaves it unset ⇒ no stamp ⇒ human/trusted.
	if (originTrust !== undefined) {
		lines.push('origin: issue', `originTrust: ${originTrust}`);
	}
	// Surface the gate axes AS THE PROMPT JUDGED THEM (prd `issue-intake` US #8). Only emit a `true`
	// axis — an undeclared axis stays absent (parsed as `undefined`).
	if (humanOnly === true) {
		lines.push('humanOnly: true');
	}
	if (needsAnswers === true) {
		lines.push('needsAnswers: true');
	}
	lines.push('---');
	const frontmatter = lines.join('\n');
	// As with `renderBacklogTask`: the drafted PRD body is wrapped VERBATIM; only
	// the empty-body DEFAULT SCAFFOLD is sourced from the shared section skeleton
	// owner (`renderPrdBody` with `solution` + `userStories`, prd
	// `centralize-buildable-task-renderer-shared-by-intake-and-promotion` US #2),
	// so intake's PRD fallback and promotion's PRD body cannot drift. `trimEnd()`
	// drops the renderer's trailing blank line so intake's single trailing `\n`
	// (owned by the join below) keeps the bytes identical to the pre-rewire literal.
	const drafted =
		body && body.trim() !== ''
			? body.trim()
			: renderPrdBody({
					problemStatement: `Transformed from issue #${issueNumber}: ${title}`,
					solution: '(to be detailed; this prd needs tasking via `do prd:`).',
					userStories: `1. As a user, I want issue #${issueNumber} addressed.`,
				}).trimEnd();
	return `${frontmatter}\n\n${drafted}\n`;
}

/**
 * STAGE the intake artifact content into the index on the `work/<slug>` branch (the
 * {@link performIntegration} lifecycle seam): write the `work/backlog/<slug>.md`
 * file (runner-owned; the agent never writes git-visible files) and `git add` it.
 * The band's subsequent `git add -A` + atomic commit folds it into ONE runner-owned
 * commit.
 */
async function stageIntakeContent(params: {
	cwd: string;
	relPath: string;
	content: string;
	env: NodeJS.ProcessEnv | undefined;
}): Promise<void> {
	const {cwd, relPath, content, env} = params;
	const abs = join(cwd, relPath);
	mkdirSync(dirname(abs), {recursive: true});
	writeFileSync(abs, content);
	await gitHard(['add', '--', relPath], cwd, env);
}

/**
 * ONBOARD the intake write onto a NAMESPACED, INTAKE-PRODUCED branch
 * (`work/intake-task-<slug>` / `work/intake-prd-<slug>`) cut from the freshly-
 * fetched `<arbiter>/main` (the SAME discipline `tasking.ts` uses). The
 * `intake-` PRODUCER prefix keeps this short-lived "create the item" branch
 * DISTINCT from the later build branch (`work/task-<slug>`) for the same slug
 * — the firing `intake` × `do task:` collision the observation traced. The
 * task-emit path passes `'task'`, the prd-emit path `'prd'`. A pre-existing
 * local branch (a re-run) is force-recreated off fresh main.
 */
async function switchToWorkBranch(
	cwd: string,
	arbiter: string,
	type: SlugNamespace,
	slug: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<void> {
	const branch = workBranchRef(type, slug, {producer: 'intake'});
	await gitHard(['fetch', '--quiet', arbiter], cwd, env);
	await gitHard(
		['switch', '--quiet', '-C', branch, `${arbiter}/main`],
		cwd,
		env,
	);
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

/** Run the decision step. Prefers the injected decider; else the harness seam. */
async function runDecision(
	options: PerformIntakeOptions,
	cwd: string,
	issue: Issue,
	comments: IssueComment[],
	prompt: string,
): Promise<IntakeVerdict> {
	if (options.decide) {
		return options.decide({cwd, issue, comments, prompt, env: options.env});
	}
	// PRODUCTION: launch the harness with the decision prd, then PARSE the verdict
	// the agent emitted out of its ANSWER channel (`launched.output`) — the SAME wire
	// the review gate runs (launch → `parseReviewVerdict(readOutput(launched.output))`;
	// `harnessReviewGate`). The agent emits a single fenced ```json block (the OUTPUT
	// CONTRACT {@link buildIntakeDecisionPrd} appends); {@link parseIntakeVerdict}
	// extracts + validates it. The model's JUDGEMENT is not unit-tested — only the
	// parse + dispatch — exactly as the review prompt's judgement is not.
	const harness = options.harness ?? new NullHarness();
	const launched = await launchWithOptionalWatch({
		harness,
		dir: cwd,
		slug: `intake-${issue.number}`,
		command: options.agentCmd ?? '',
		prompt,
		model: options.model,
		sessionId: `intake-${issue.number}`,
		sessionsDir: options.sessionsDir,
		env: options.env,
	});
	if (!launched.ok) {
		throw new Error(launched.detail ?? 'the intake decision agent failed.');
	}
	// Read the verdict from the agent's ANSWER channel (`output`), NOT `detail` (the
	// failure channel, empty on success) — the SAME `output ?? ''` normalisation the
	// review gate's `readOutput` default applies. A malformed/absent verdict throws,
	// which `decideAndDispatch`'s try/catch already maps onto `agent-failed` (exit 1).
	return parseIntakeVerdict(launched.output ?? '');
}

/**
 * Parse the decision agent's emitted VERDICT out of its (possibly prose-wrapped /
 * fenced) textual output into an {@link IntakeVerdict} — the PRODUCTION wire
 * between the launched agent and the already-built dispatcher, modeled 1:1 on the
 * review gate's `parseReviewVerdict` twin (`review-gate.ts`). It pulls the first
 * JSON object carrying an `"outcome"` field via the SHARED
 * {@link extractJsonObjectSpan} (NOT a forked second "first JSON object in agent
 * prose" extractor — the review gates anchor on `"verdict"`, intake on
 * `"outcome"`; same need, one implementation — coherence), `JSON.parse`s it, and
 * validates the shape: `outcome ∈ {ask,task,prd,bounce}`.
 *
 * The per-outcome fields map 1:1 onto {@link IntakeVerdict} (`task` →
 * taskSlug?/taskTitle/taskBody, `prd` →
 * prdSlug?/prdTitle/prdBody/prdHumanOnly?/prdNeedsAnswers?, `ask` → question,
 * `bounce` → bounceMessage). Missing OPTIONALS are tolerated — the dispatcher
 * already has fallbacks (slug-from-title, the thin comment/scaffold defaults).
 *
 * THROWS a clear error on: no JSON object present, invalid JSON, or an `outcome`
 * not in the set. The caller (`decideAndDispatch`) maps any throw onto the
 * `agent-failed` outcome (exit 1) — a malformed verdict degrades honestly, never
 * a crash and never a silent dispatch.
 */
export function parseIntakeVerdict(output: string): IntakeVerdict {
	const span = extractJsonObjectSpan(output, 'outcome');
	if (span === undefined) {
		throw new Error(
			'intake decision agent produced no parseable {outcome, …} verdict.',
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(output.slice(span.start, span.end));
	} catch (err) {
		throw new Error(
			`intake verdict was not valid JSON: ${(err as Error).message}`,
		);
	}
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('intake verdict was not an object.');
	}
	const obj = parsed as Record<string, unknown>;
	const outcome = obj.outcome;
	if (
		outcome !== 'ask' &&
		outcome !== 'task' &&
		outcome !== 'spec' &&
		outcome !== 'prd' &&
		outcome !== 'bounce'
	) {
		// EXPAND step (prd `prd-to-spec-vocabulary-cutover-and-migration-command`):
		// the new `spec` outcome is ACCEPTED beside the legacy `prd` outcome (both
		// name the parent-spec classification). Additive — `prd` stays valid; the
		// contract task removes it.
		throw new Error(
			`intake verdict 'outcome' was not one of ask|task|spec|prd|bounce (got ` +
				`${JSON.stringify(outcome)}).`,
		);
	}
	// Map the per-outcome fields onto the verdict shape, keeping ONLY the strings/
	// booleans the dispatcher consumes (a missing optional stays absent — the
	// dispatcher's fallbacks cover it). Every field is optional on the type, so the
	// `task`/`prd` content + the `ask`/`bounce` text are carried verbatim when present.
	const str = (v: unknown): string | undefined =>
		typeof v === 'string' ? v : undefined;
	const bool = (v: unknown): boolean | undefined =>
		typeof v === 'boolean' ? v : undefined;
	return {
		outcome,
		...(str(obj.taskSlug) !== undefined ? {taskSlug: str(obj.taskSlug)} : {}),
		...(str(obj.taskTitle) !== undefined
			? {taskTitle: str(obj.taskTitle)}
			: {}),
		...(str(obj.taskBody) !== undefined ? {taskBody: str(obj.taskBody)} : {}),
		...(str(obj.question) !== undefined ? {question: str(obj.question)} : {}),
		...(str(obj.prdSlug) !== undefined ? {prdSlug: str(obj.prdSlug)} : {}),
		...(str(obj.prdTitle) !== undefined ? {prdTitle: str(obj.prdTitle)} : {}),
		...(str(obj.prdBody) !== undefined ? {prdBody: str(obj.prdBody)} : {}),
		...(bool(obj.prdHumanOnly) !== undefined
			? {prdHumanOnly: bool(obj.prdHumanOnly)}
			: {}),
		...(bool(obj.prdNeedsAnswers) !== undefined
			? {prdNeedsAnswers: bool(obj.prdNeedsAnswers)}
			: {}),
		...(str(obj.bounceMessage) !== undefined
			? {bounceMessage: str(obj.bounceMessage)}
			: {}),
	};
}

// ---------------------------------------------------------------------------
// The LONE-TASK bounded internal review (observation
// `intake-lone-task-skips-adversarial-review-the-prd-path-gets`, rulings A/B/C).
//
// Give intake's lone-TASK outcome the adversarial refinement the `do prd:` path
// already gets — but as a small intake-NATIVE bounded review, NOT by integrating
// the tasker loop. This is a NEW prompt + a small loop + an injectable gate seam,
// MIRRORING the tasker loop's verdict/output CONVENTIONS (fenced JSON
// `{verdict, findings, edit}` parsed via the shared `extractJsonObjectSpan`) WITHOUT
// importing or calling `runTaskReviewLoop`. The differences are load-bearing: this
// reviews ONE drafted task (N=1 — the SET/graph/overlap lenses are OFF), it never
// touches disk pre-convergence (the task has not been emitted yet), and its only
// non-converge sink is the EXISTING `asked` outcome (verdict flips TASK→ASK with
// the draft + question(s) in the comment body — ruling C).
// ---------------------------------------------------------------------------

/** The HARD-CODED round cap for the lone-task review (ruling A — a literal, no config/flag). */
const LONE_TASK_REVIEW_MAX_ROUNDS = 3;

/**
 * Backwards-compatible alias for {@link ReviewFinding} (task
 * `review-protocol-doc-and-shared-machinery`). Existing imports keep compiling;
 * new code should reach for `ReviewFinding` from `review-verdict.ts`.
 */
export type LoneTaskReviewFinding = ReviewFinding;

/**
 * The lone-task review verdict shape is now the UNIFIED {@link ReviewVerdict}.
 * The lone-task caller consumes the `edit` / `questions` channels of the wide
 * type; other review callers consume different channels. The SET/graph/overlap
 * lenses are still N=1-OFF in the PROMPT (intake never spawns the tasker loop's
 * set-level sinks); the type itself is shared.
 */
export type LoneTaskReviewVerdict = ReviewVerdict;

/** What the lone-task review gate needs to launch / answer ONE review round. */
export interface LoneTaskReviewGateInput {
	/** The drafted task's slug (the candidate under review). */
	slug: string;
	/** The source issue number (the destination check's target behaviour). */
	issueNumber: number;
	/** The drafted task's title (the candidate under review). */
	title: string;
	/** The drafted task BODY as it stands THIS round (after any prior in-memory edits). */
	body: string;
	/** Which review ROUND this is (1-based, 1..{@link LONE_TASK_REVIEW_MAX_ROUNDS}). */
	round: number;
	/** The working clone/checkout the review runs in. */
	cwd: string;
	/** Environment for the review-agent launch. */
	env?: NodeJS.ProcessEnv;
}

/**
 * The lone-task review SEAM: run ONE adversarial review round on the SINGLE
 * drafted task and return a parsed verdict (incl. an optional in-memory edit).
 * Tests inject a canned verdict (no model/network) — the new testable seam, mirroring
 * {@link IntakeDecider}. Production uses {@link harnessLoneTaskReviewGate}.
 */
export type LoneTaskReviewGate = (
	input: LoneTaskReviewGateInput,
) => Promise<LoneTaskReviewVerdict>;

/** The terminal disposition of the bounded lone-task review. */
interface LoneTaskReviewResult {
	/** `converge` → emit the (edited) task; `non-converge` → flip TASK→ASK. */
	outcome: 'converge' | 'non-converge';
	/** The task TITLE after the review (unchanged today; carried for symmetry). */
	title: string;
	/** The task BODY after all applied in-memory edits (the body to emit / carry). */
	body: string | undefined;
	/** On `non-converge`: the open question(s) to carry into the ASK comment body. */
	questions: string[];
	/** How many review rounds ran. */
	passes: number;
}

/**
 * Run the BOUNDED lone-task adversarial self-review over the SINGLE drafted task.
 * Each round runs the gate (the `review` skill's per-task + destination lenses on
 * the ONE task); a round may propose an EDIT (full replacement body) applied IN
 * MEMORY and re-reviewed. The cap is the HARD-CODED literal
 * {@link LONE_TASK_REVIEW_MAX_ROUNDS} = 3 (ruling A — no config/flag).
 *
 *   - CONVERGE — a round returns `approve` with no NEW blocking issue → emit the
 *     improved task (the caller's existing write/integrate + completion comment).
 *   - NON-CONVERGE — a round `block`s with an open question (no clear thread answer)
 *     OR the cap is hit with an unresolved blocker → flip TASK→ASK carrying the
 *     draft + the open question(s) (ruling C).
 *
 * A gate launch/parse failure THROWS (the caller's try/catch maps it onto
 * `agent-failed`) — never a silent emit of the un-reviewed task.
 */
async function runLoneTaskReview(params: {
	slug: string;
	issueNumber: number;
	draftTitle: string;
	draftBody: string | undefined;
	gate: LoneTaskReviewGate;
	cwd: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (message: string) => void;
}): Promise<LoneTaskReviewResult> {
	const {slug, issueNumber, draftTitle, draftBody, gate, cwd, env, note} =
		params;
	let body = draftBody;
	let lastVerdict: LoneTaskReviewVerdict = {verdict: 'block', findings: []};
	let passes = 0;
	for (let round = 1; round <= LONE_TASK_REVIEW_MAX_ROUNDS; round++) {
		const verdict = await gate({
			slug,
			issueNumber,
			title: draftTitle,
			// The body the reviewer sees this round (after any prior in-memory edit);
			// fall back to the rendered scaffold-input the emit path also tolerates.
			body: body ?? '',
			round,
			cwd,
			env,
		});
		passes = round;
		lastVerdict = verdict;
		// APPLY the proposed EDIT IN MEMORY (no `work/backlog/` write pre-convergence).
		if (verdict.edit !== undefined && verdict.edit.trim() !== '') {
			body = verdict.edit;
		}
		if (verdict.verdict === 'approve') {
			return {
				outcome: 'converge',
				title: draftTitle,
				body,
				questions: [],
				passes,
			};
		}
		// EARLY FLIP → ASK (the non-converge trigger the source observation names
		// FIRST: "a blocking question with NO clear answer in the issue thread"). When a
		// round BLOCKS, carries open `questions`, and proposes NO `edit`, the agent is
		// saying "this needs the HUMAN, I have nothing left to tighten" — so flip to ASK
		// NOW rather than burning the remaining rounds (which cannot resolve a question
		// only the human can answer). Symmetric with the early CONVERGE return above; it
		// retires the "flips only at the cap" behaviour (PR #62 review nit #1). A `block`
		// that DID propose an `edit` is still iterated — the edit may converge it; only a
		// no-edit blocking question short-circuits.
		const hasEdit = verdict.edit !== undefined && verdict.edit.trim() !== '';
		const earlyQuestions = loneTaskBlockingQuestions(verdict);
		if (!hasEdit && earlyQuestions.length > 0) {
			note(
				`Intake lone-task review round ${round}/${LONE_TASK_REVIEW_MAX_ROUNDS} ` +
					`surfaced a blocking question with no edit to apply; flipping TASK→ASK ` +
					`early (no clear thread answer — the human must decide).`,
			);
			return {
				outcome: 'non-converge',
				title: draftTitle,
				body,
				questions: earlyQuestions,
				passes,
			};
		}
		note(
			`Intake lone-task review round ${round}/${LONE_TASK_REVIEW_MAX_ROUNDS} ` +
				`found ${loneTaskBlockingCount(verdict)} blocking issue(s)` +
				`${hasEdit ? ' (an edit was applied)' : ''}.`,
		);
	}
	// The cap was hit with a still-`block` verdict → NON-CONVERGE (flip TASK→ASK).
	return {
		outcome: 'non-converge',
		title: draftTitle,
		body,
		questions: loneTaskBlockingQuestions(lastVerdict),
		passes,
	};
}

/** Count blocking findings in a lone-task review verdict. */
function loneTaskBlockingCount(verdict: LoneTaskReviewVerdict): number {
	return verdict.findings.filter((f) => f.severity === 'blocking').length;
}

/**
 * The open question(s) for the ASK comment body on a non-converge: prefer the
 * verdict's explicit `questions`, else fall back to the blocking findings'
 * questions (so the human always gets a concrete question, never a blank ask).
 */
function loneTaskBlockingQuestions(verdict: LoneTaskReviewVerdict): string[] {
	if (verdict.questions && verdict.questions.length > 0) {
		return verdict.questions;
	}
	const blocking = verdict.findings.filter((f) => f.severity === 'blocking');
	const source = blocking.length > 0 ? blocking : verdict.findings;
	return source.map((f) =>
		f.context ? `${f.question} (${f.context})` : f.question,
	);
}

/**
 * Compose the NON-CONVERGE ASK comment BODY (ruling C): it carries BOTH the proposed
 * task DRAFT and the open question(s) that arose, so the human reacts to a concrete
 * draft ("yes, yes, but…"), strictly richer than a blank-question ask. The draft
 * rides in the comment BODY — NOT a new marker kind; {@link dispatchComment} stamps
 * the EXISTING `kind=ask` marker around it.
 */
function composeLoneTaskAskComment(params: {
	issueNumber: number;
	slug: string;
	draftTitle: string;
	draftBody: string | undefined;
	questions: string[];
}): string {
	const {issueNumber, slug, draftTitle, draftBody, questions} = params;
	const draft = renderBacklogTask({
		slug,
		title: draftTitle,
		body: draftBody,
		issueNumber,
	});
	const questionLines =
		questions.length > 0
			? questions.map((q) => `- ${q}`).join('\n')
			: '- (the draft below needs a clarification before it can be built)';
	return [
		`I drafted a task for issue #${issueNumber} but the internal review surfaced`,
		`open question(s) it could not resolve from the thread. Please weigh in on the`,
		`draft below — once the question(s) are answered, a later run can emit it.`,
		'',
		'## Open question(s)',
		'',
		questionLines,
		'',
		'## Proposed task draft',
		'',
		'```markdown',
		draft.trimEnd(),
		'```',
	].join('\n');
}

/**
 * Resolve the lone-task review GATE from the intake options: the injected
 * {@link PerformIntakeOptions.reviewTask} (tests' canned seam) when present, else
 * the production harness-backed gate ({@link harnessLoneTaskReviewGate}) wired to
 * the same harness/agent the decision step uses. Mirrors how {@link runDecision}
 * prefers the injected `decide`.
 */
function resolveLoneTaskReviewGate(
	options: PerformIntakeOptions,
): LoneTaskReviewGate {
	if (options.reviewTask) {
		return options.reviewTask;
	}
	return harnessLoneTaskReviewGate({
		harness: options.harness,
		agentCmd: options.agentCmd,
		model: options.model,
		sessionsDir: options.sessionsDir,
	});
}

/** Options for the production harness-backed lone-task review gate. */
export interface HarnessLoneTaskReviewGateOptions {
	/** The harness seam used to launch the fresh-context review agent. */
	harness?: Harness;
	/** The configured agent command the harness shells out to. */
	agentCmd?: string;
	/** The model routing intent forwarded to the harness (ADR §13). */
	model?: string;
	/** The HOST-ONLY sessions root for the review session file. */
	sessionsDir?: string;
}

/**
 * The PRODUCTION lone-task review gate: launch the `review` SKILL as an agent
 * through the EXISTING harness seam (the SAME wire {@link runDecision} uses), then
 * PARSE the emitted `{verdict, findings, edit, questions}` via
 * {@link parseLoneTaskReviewVerdict}. The agent makes the review JUDGEMENT (the
 * per-task + destination lenses on the ONE task); this gate launches it and parses
 * its verdict. A launch failure THROWS (the dispatcher's try/catch maps it onto
 * `agent-failed`). MIRRORS {@link harnessTaskReviewGate} WITHOUT importing it.
 */
export function harnessLoneTaskReviewGate(
	options: HarnessLoneTaskReviewGateOptions = {},
): LoneTaskReviewGate {
	const harness = options.harness ?? new NullHarness();
	return async (
		input: LoneTaskReviewGateInput,
	): Promise<LoneTaskReviewVerdict> => {
		const launched = await launchWithOptionalWatch({
			harness,
			dir: input.cwd,
			slug: `intake-task-review-${input.slug}`,
			command: options.agentCmd ?? '',
			prompt: buildLoneTaskReviewPrompt(input),
			model: options.model,
			// A DISTINCT session id per round so launches never collide.
			sessionId: `intake-task-review-${input.slug}-r${input.round}`,
			sessionsDir: options.sessionsDir,
			env: input.env,
		});
		if (!launched.ok) {
			throw new Error(
				`intake lone-task review agent launch failed${
					launched.detail ? `: ${launched.detail}` : ''
				}`,
			);
		}
		return parseReviewVerdict(launched.output ?? '');
	};
}

/**
 * Build the LONE-TASK review PROMPT: instruct a fresh-context agent to apply
 * the **review discipline** (`work/protocol/REVIEW-PROTOCOL.md`) to the SINGLE
 * drafted task — per-task well-formedness + the destination check ("if this
 * task is built exactly as written, do we end up with the behaviour issue #N
 * asks for?"). The SET / graph / overlap lenses are N=1 and EXPLICITLY OFF.
 * A round may propose an `edit` (the FULL replacement task body) the runner
 * applies IN MEMORY and re-reviews; converge when a round finds NO new blocking
 * issue, else carry the open `questions` into the ASK comment for the human.
 *
 * The discipline body and the JSON-emitted-shape contract are SHARED helpers
 * (task `review-protocol-doc-and-shared-machinery`); this builder owns ONLY
 * the lone-task-specific framing.
 */
export function buildLoneTaskReviewPrompt(
	input: LoneTaskReviewGateInput,
): string {
	return [
		`You are a FRESH-CONTEXT reviewer in intake's BOUNDED lone-task review. A`,
		`single task has just been drafted from GitHub issue #${input.issueNumber}.`,
		`Review THIS ONE task adversarially (round ${input.round} of at most ${LONE_TASK_REVIEW_MAX_ROUNDS}).`,
		'',
		reviewDisciplinePrompt(),
		'',
		`Drafted task slug: ${input.slug}`,
		`Drafted task title: ${input.title}`,
		'',
		'Drafted task body (the markdown AFTER the frontmatter):',
		'```markdown',
		input.body.trim() === ''
			? '(empty — only a scaffold was drafted)'
			: input.body,
		'```',
		'',
		'## Which lenses apply (N=1 — this is ONE task, not a SET)',
		'',
		'Apply ONLY the per-task lenses, ENDING in the destination check:',
		'- **Per-task well-formedness** — is it a single tracer-bullet vertical task',
		'  (one thin end-to-end path)? Are the `## What to build`, `## Acceptance',
		'  criteria`, and `## Prompt` present, concrete, and self-contained (an AFK',
		'  agent could start from the file alone)? Are claims/paths/“reuse X” real?',
		'- **The DESTINATION check** — if this task is built EXACTLY as written, do we',
		`  end up with the behaviour issue #${input.issueNumber} asks for? A hole here is`,
		'  the highest-value thing to flag.',
		'',
		'The SET / graph / overlap / goal-COMPOSITION lenses are OFF: there is only ONE',
		'task (N=1), so there is no dependency graph, no set-level gap, and no',
		'duplicate/overlap to assess. Do NOT invent a decomposition.',
		'',
		'## How to iterate',
		'',
		'You do NOT edit files or run git — you EMIT a verdict and the runner applies it',
		'in memory, then re-reviews. If a finding can be FIXED by tightening the draft,',
		'propose an `edit` (the FULL replacement task body — the markdown AFTER the',
		'frontmatter; the runner writes the frontmatter + the issue link). CONVERGE',
		'(`approve`, no blocking findings) when a round finds NO new blocking issue.',
		'When a BLOCKING question has NO clear answer in the issue thread — it needs the',
		'human, not another edit — `block` and put it in `questions`: the runner asks the',
		'human, carrying this draft. Flag, do not guess.',
		'',
		verdictContractPrompt(),
		'',
		'Fill the channels appropriate to THIS caller (the lone-task review):',
		'  - `edit` — a single full-replacement task body (NOT a path; the task is',
		'    not yet emitted) when tightening the draft fixes the finding.',
		'  - `questions` — the open question(s) for the human when a blocking issue',
		'    has no clear thread answer.',
		'Do NOT fill `review` / `edits` / `uncertainTasks` / `decompositionUnclear`',
		"— those are other callers' channels.",
	].join('\n');
}

/**
 * Backwards-compatible alias for the unified {@link parseReviewVerdict}
 * (task `review-protocol-doc-and-shared-machinery`). The lone-task review
 * verdict is now the unified {@link ReviewVerdict}; the alias keeps existing
 * tests/callers compiling.
 */
export const parseLoneTaskReviewVerdict = parseReviewVerdict;

/**
 * Build the intake decision PRD (an inline prompt builder, like `buildTaskingPrd`
 * in `tasking.ts` / the reviewer prompts in `review-gate.ts` — NOT a standalone
 * asset/`.md` file; no such convention exists in this package). It encodes the FULL
 * four-outcome decision table (prd `issue-intake` — the source of truth) and the
 * three DECISION AIDS stated once there:
 *
 * 1. the **"clear?" bar** = `to-task`/`needsAnswers`' "would I build the wrong
 *    thing if I guessed?" — if a material requirement/scope/acceptance question is
 *    unanswered, ASK (never guess a spec from a vague issue);
 * 2. the **"one task?" bar** = `to-task`' tracer-bullet test (one thin end-to-end
 *    path, demoable on its own) — fits → TASK, needs splitting → PRD;
 * 3. **PRD vs BOUNCE** turns on a **SHARED VISION**: coupled (even if small) → PRD;
 *    genuinely unrelated → BOUNCE. Size NEVER forces a bounce — only unrelatedness
 *    (the over-bounce guard: a coupled-but-small pair gets a light PRD, never a
 *    bounce).
 *
 * The prompt anchors to `to-task`/`to-prd` for the task/prd SHAPES it drafts. Its
 * JUDGEMENT is NOT unit-tested (exactly as the review prompt's is not) — only the
 * dispatch is. The agent only DRAFTS the verdict + its content; it does NO git/seam
 * ops (the runner owns every postComment / write / integrate — the in-band boundary).
 */
export function buildIntakeDecisionPrd(
	issue: Issue,
	comments: IssueComment[],
	triage?: IntakeTriageDecision,
): string {
	const thread =
		comments.length === 0
			? '(no comments yet)'
			: comments
					.map(
						(c, i) =>
							`#${i + 1} ${c.author ? `@${c.author}` : '(unknown)'}: ${c.body}`,
					)
					.join('\n\n');
	// TRIAGE ENRICHMENT (prd `issue-intake`): on the raced PROCEED path the prompt is
	// told which comment(s) PRE-DATE intake's last turn (context for a prior state,
	// not necessarily a fresh answer) and — only then — how many previously-SEEN
	// comments were DELETED (a flag + count; the bodies are gone, so do not name them).
	const triageNotes: string[] = [];
	if (triage?.action === 'proceed' && triage.predatingIds.length > 0) {
		triageNotes.push(
			'',
			'## Triage note — raced comment(s) that PRE-DATE intake’s last turn',
			'',
			`${triage.predatingIds.length} comment(s) landed AFTER intake last read the`,
			'thread but BEFORE it posted its last turn, so they pre-date that turn',
			'(possibly concurrent). Treat them as possibly-already-addressed context for a',
			'PRIOR state — NOT necessarily a direct answer to intake’s latest question.',
		);
		if (triage.deletedSeenCount > 0) {
			triageNotes.push(
				'',
				`ALSO: ${triage.deletedSeenCount} previously-seen comment(s) were DELETED since`,
				'intake last read the thread. Their content is gone and not recoverable; do',
				'NOT assume your prior reasoning’s premises still hold — reassess from the',
				'current thread.',
			);
		}
	}
	return [
		`You are the dorfl INTAKE agent. Decide what to do with GitHub issue`,
		`#${issue.number}: "${issue.title}". You read the issue + its full comment`,
		`thread and return ONE verdict (the runner DISPATCHES on it deterministically).`,
		'',
		'Issue body:',
		issue.body.trim() === '' ? '(empty)' : issue.body,
		'',
		'Comment thread (oldest first):',
		thread,
		...triageNotes,
		'',
		'## The decision — classify the issue into exactly ONE of four verdicts',
		'',
		'- **ASK** — the issue is NOT clear enough to act on: a material requirement,',
		'  scope, or acceptance question is unanswered. Use the same bar `to-task`',
		'  uses for `needsAnswers`: "would I build the WRONG thing if I guessed now?"',
		'  If yes → ASK. Draft the SINGLE next clarifying question (do NOT guess a spec',
		'  from a vague issue). The runner posts it and stops; a later run resumes from',
		'  the updated thread.',
		'',
		'- **TASK** — the issue is CLEAR *and* it fits ONE tracer-bullet vertical task',
		'  (a single thin end-to-end path, demoable on its own — `to-task`’ criterion).',
		'  Draft that ONE task in the `to-task` shape (a `## What to build`,',
		'  `## Acceptance criteria`, and `## Prompt`). The runner writes',
		'  `work/backlog/<slug>.md` (`covers: []`, NO `prd:`) carrying `issue: N` (the',
		'  lone-task closure link, NOT `Fixes #N`) and integrates it.',
		'',
		'- **PRD** — the issue is CLEAR *and* coherent but needs MORE THAN ONE task (it',
		'  cannot be one tracer-bullet path — it splits for scope/architecture). >1 task',
		'  ⟺ a shared vision worth recording ⟺ a prd. Draft a prd in the `to-prd` shape',
		'  (`## Problem Statement`, `## Solution`, `## User Stories`, `## Out of Scope`).',
		'  The runner writes the prd file (`work/prds/ready/<slug>.md`) with `issue: N` and integrates it;',
		'  TASKING the prd is a SEPARATE later step (`do prd:`) — do not task it here.',
		'  **INCLUDES a coupled-but-SMALL pair: if two asks share a vision they get a',
		'  (light) prd — they are NEVER bounced.**',
		'',
		'- **BOUNCE** — the issue is really MULTIPLE UNRELATED concerns wearing one issue:',
		'  you cannot articulate a SINGLE shared vision tying them together. Draft a short',
		'  message asking the author to file separate issues. A bounce is TERMINAL, so the',
		'  runner CLOSES the issue ATOMICALLY — your message as the closing comment +',
		'  reason "not planned" (the honest signal that the asks must be re-filed). Intake',
		'  closes on BOUNCE only; never on task/prd (CI’s close-job) / ask.',
		'',
		'## The three decision aids (apply them in order)',
		'',
		'1. **"clear?"** (ASK vs the rest): the `needsAnswers` bar — would acting now risk',
		'   building the wrong thing? If yes → ASK. Otherwise it is clear; continue.',
		'2. **"one task?"** (TASK vs PRD): the `to-task` tracer-bullet test — one thin',
		'   end-to-end path, demoable alone? Fits → TASK; needs splitting → PRD.',
		'3. **"shared vision?"** (PRD vs BOUNCE): coupled (even if small) → PRD; genuinely',
		'   unrelated → BOUNCE. SIZE NEVER forces a bounce — only UNRELATEDNESS does. Do',
		'   not over-bounce a small coupled pair: it is a light prd.',
		'',
		'## Boundary',
		'',
		'You only DRAFT the verdict + its content (the task/prd body, or the comment',
		'text). You do NOT perform ANY git operation and you do NOT post any comment — the',
		'runner owns every git/seam side-effect (write, integrate, postComment). For a prd',
		'verdict, also judge its gate axes (humanOnly / needsAnswers) so the runner can',
		'surface them on the emitted prd.',
		'',
		'## Output — hand the verdict back as ONE fenced JSON block',
		'',
		'Emit your verdict as a SINGLE fenced ```json block (and nothing else that looks',
		'like JSON). Its keys map 1:1 onto the verdict the runner dispatches on — always an',
		'`"outcome"` plus ONLY the fields for that outcome:',
		'',
		'```json',
		'{"outcome": "task", "taskSlug": "<content-derived-slug>", "taskTitle": "<title>", "taskBody": "<the markdown AFTER the frontmatter>"}',
		'```',
		'',
		'- **task** → `taskTitle` + `taskBody` (the `## What to build` / `## Acceptance',
		'  criteria` / `## Prompt` markdown — NOT the frontmatter; the runner writes the',
		'  frontmatter + the `issue: N` link) and an optional `taskSlug` (the runner',
		'  derives one from the title if you omit it — never a counter).',
		'- **prd** → `prdTitle` + `prdBody` (the `## Problem Statement` / `## Solution` / …',
		'  markdown AFTER the frontmatter; the runner writes the frontmatter + `issue: N`),',
		'  an optional `prdSlug`, and the gate axes `prdHumanOnly` / `prdNeedsAnswers`',
		'  (booleans — set `true` when a human should drive the TASKING and/or open',
		'  questions remain; omit otherwise).',
		'- **ask** → `question` (the single next clarifying question).',
		'- **bounce** → `bounceMessage` (the “file separate issues” message).',
		'',
		'`outcome` MUST be exactly one of `ask` | `task` | `prd` | `bounce`. Strings are',
		'plain text inside the JSON (escape newlines as \\n). Do not wrap the JSON in any',
		'other structure — the runner pulls the first `{"outcome": …}` object out and',
		'dispatches on it.',
	].join('\n');
}
