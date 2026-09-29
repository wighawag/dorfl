/**
 * **The tree-less rungs split into the three CI phases** (spec
 * `ci-agent-job-without-write-token` §3 surface, triage and apply rows, ADR
 * `ci-agent-job-holds-no-write-token`, task `ci-split-treeless-rungs`).
 *
 * `advance <item> --phase` on a `surface`, `triage-observation` or `apply`
 * rung runs ONE of three halves of the one rung body in `advance.ts`
 * (`triageRung`, `surfaceRung`, `applyRung` with `applyAgenticDecision` and
 * `maybeRunStuckAction`), never a second implementation. The phase boundary is
 * the rung's existing injectable seams: its agent seams (`surfaceGate`,
 * `triageGate`, `applyDecide`) on one side, its write seams (`surfacePersist`,
 * `applyPersist`, `stampTriaged`, `autoDisposition`, `promote`, `mintAdr`,
 * `stuckAction`) on the other.
 *
 *  - **lock** ({@link performTreelessLockPhase}): fetch `<arbiter>/main` (its
 *    tip is `baseSha`); in a throwaway worktree of it, classify the item and
 *    work out whether the rung launches an agent (`treelessAgentNeed`, decision
 *    11: the triage back-fill and settled no-op, the surface short-circuit, a
 *    `kind: stuck` answer and a task/spec content answer need none); take the
 *    advancing lock (the unified per-item lock, `action: advance`); publish
 *    `acquired`, `needsAgent`, `rung`, `baseSha`, `lockSha`, `handoffName` and
 *    `agentTimeoutMinutes`. No agent, no repository code. An answered
 *    `kind: merge` entry answered `merge` also publishes `continueTip`, the
 *    kept `work/task-<slug>` tip it observed, and needs the agent job only when
 *    that branch carries work `main` lacks (task
 *    `ci-split-answered-merge-action`).
 *  - **agent** ({@link performTreelessAgentPhase}): check, read-only, that the
 *    lock ref still equals `lockSha`; run the rung body in a worktree of
 *    `baseSha` with the REAL agent seams, each wrapped to capture what the agent
 *    emitted, and every write seam replaced by a stub that writes nothing; hand
 *    over what the agents decided: `surface` (the surface questions), `triage`
 *    (the triage gate's disposition, or `keep` plus the surface questions on
 *    the fall-through) or `apply-decision` (the agentic verdict). For an
 *    answered merge the rung's merge-action seam runs the agent half of the
 *    land instead (`prepareMergeLand`: the `createJob` checkout, the LOCAL
 *    rebase, the optional `strictMergeApproval` re-stale check, the
 *    fresh-worktree gate on the rebased tip) and hands over `integrate` (the
 *    rebased tip bundled), `merge-restale` or `needs-attention`. Writes nothing
 *    to the arbiter. A rung that fails writes no handoff and fails the job.
 *  - **apply** ({@link performTreelessApplyPhase}): refuse to write unless the
 *    lock ref still equals `lockSha`; act on the agent job's result first
 *    (`failure` / timeout surfaces the item, a real cancel only releases the
 *    lock, `skipped` with `needsAgent: false` runs the deterministic rung); read
 *    the handoff as hostile (`readHandoff`: the item, the rung's intent kind,
 *    every enum and every slug); then, on a FRESH checkout of `<arbiter>/main`,
 *    re-classify the item (a rung or agent need that changed is `stale`, nothing
 *    written) and run the SAME rung body with the agent seams replaced by
 *    replays of the checked handoff and the real write seams, so the commits are
 *    today's; check the publish carries only the rung's own commit
 *    (`checkTreelessPublishScope`), publish it (`publishTreelessResult`), and
 *    release the lock, leased on `lockSha`. It launches no agent: a gate the
 *    handoff does not answer throws. An answered merge's handoff is validated
 *    as a bundle (`validateApplyHandoff`, the trusted merge mode); its apply
 *    pushes the bundle's LFS objects, then the rebased branch leased on
 *    `continueTip` (a stale lease writes nothing), lands it through the
 *    unchanged compare-and-swap loop (`integrationLand`, with the gated tip),
 *    and only then records the answer on a fresh checkout of the new `main`
 *    (two writes to `main`, as on the laptop).
 */

import type {
	AdvanceContext,
	AdvanceOutcome,
	RungExecInput,
	RungExecResult,
	RungExecutor,
	TreelessAgentNeed,
} from './advance.js';
import {
	defaultRungExecutor,
	findItemPath,
	readItemSignals,
	sidecarTypeFor,
	treelessAgentNeed,
} from './advance.js';
import {classifyTick} from './advance-classify.js';
import {
	DEFAULT_TREELESS_JITTER_MS,
	checkTreelessPublishScope,
} from './advance-treeless-publish.js';
import {acquireAdvancingLock} from './advancing-lock.js';
import {
	detectAnsweredMergeAction,
	performMergeAction,
	prepareMergeLand,
	type MergeActionHandler,
	type MergeActionResult,
	type MergeLandPreparation,
	type PreparedMergeLand,
} from './apply-merge-action.js';
import type {AgentJobResult, GithubApiGet} from './ci-agent-result.js';
import {
	HANDOFF_LIMITS,
	HandoffRejected,
	canonicalHandoffItem,
	handoffName as deriveHandoffName,
	type ApplyDecisionProducts,
	type HandoffQuestionEntry,
	type HandoffRecord,
	type NeedsAttentionProducts,
	type SurfaceProducts,
	type TriageProducts,
} from './ci-handoff-format.js';
import {readHandoff, writeHandoff} from './ci-handoff.js';
import {validateApplyHandoff, type ApplyHandoff} from './ci-handoff-apply.js';
import {readLockOutputsFromEnv, type LockOutputs} from './ci-lock-outputs.js';
import {
	PhaseDriverError,
	agentTimeoutMinutesAt,
	arbiterLockSha,
	arbiterRefSha,
	boundHandoffText,
	acquireNotingOnce,
	checkLockOwnership,
	emitLockOutputs,
	fetchArbiterMain,
	noSmudgeEnv,
	pushHandoffLfs,
	releaseLockLeased,
	requireHeldLock,
	resolveAgentResult,
	runnerTempFrom,
	taskSourceAtBase,
	withBaseWorktree,
	type HeldLock,
} from './ci-phase-driver.js';
import type {DecisionVerdict} from './decision-engine.js';
import {harnessApplyDecider, type ApplyDecider} from './apply-decide.js';
import {runAsync} from './git.js';
import {identityEnv, type Identity} from './identity.js';
import {integrationLand} from './integration-core.js';
import {leaseLockReleases} from './item-lock.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {ledgerWrite} from './ledger-write.js';
import {surfaceStuckToNeedsAttention} from './needs-attention.js';
import type {Phase} from './phase.js';
import {createPhaseRecorder, runAgentPhase} from './phase-recorder.js';
import {refWrite} from './ref-write.js';
import {sidecarPathFor} from './sidecar.js';
import {ensureSafeSlug} from './slug-safety.js';
import {
	SlugResolutionError,
	parseSlugArg,
	resolveAdvanceArg,
	workBranchRef,
	type SlugNamespace,
} from './slug-namespace.js';
import {
	harnessSurfaceGate,
	type SurfaceEmit,
	type SurfaceGate,
	type SurfaceQuestion,
} from './surface-gate.js';
import {harnessTriageGate, type TriageEmit} from './triage-gate.js';

const DEFAULT_ARBITER = 'origin';

/** The tree-less rungs this module splits. */
export const TREELESS_PHASE_RUNGS = [
	'surface',
	'triage-observation',
	'apply',
] as const;
export type TreelessPhaseRung = (typeof TREELESS_PHASE_RUNGS)[number];

/** Whether `rung` is one of the tree-less rungs this module splits. */
export function isTreelessPhaseRung(
	rung: string | undefined,
): rung is TreelessPhaseRung {
	return (TREELESS_PHASE_RUNGS as readonly string[]).includes(rung ?? '');
}

/** The handoff intent each tree-less rung hands over. */
const INTENT_FOR_RUNG = {
	surface: 'surface',
	'triage-observation': 'triage',
	apply: 'apply-decision',
} as const satisfies Record<TreelessPhaseRung, HandoffRecord['intent']['kind']>;

/** Options of a tree-less phase run: the advance context plus the phase inputs. */
export interface TreelessPhaseOptions extends AdvanceContext {
	/** Which of the three jobs this process is. */
	phase: Phase;
	/** The (trusted) workflow argument: `obs:<slug>`, `task:<slug>`, `spec:<slug>`, a bare slug. */
	arg: string;
	/** The checkout the argument is resolved in (agent / apply); default `cwd`. */
	repoPath?: string;
	/** The read seam of the resolver. */
	read?: LedgerReadStrategy;
	/** The git identity of the lock and apply writes. */
	identity?: Identity;
	/** Environment for the phase's own git processes. */
	env?: NodeJS.ProcessEnv;
	/** agent: write the handoff here (empty or absent); apply: read it (under {@link runnerTemp}). */
	handoffDir?: string;
	/** `$RUNNER_TEMP` (the apply phase); defaults to the env's. */
	runnerTemp?: string;
	/** The lock job's outputs (agent / apply); defaults to `DORFL_LOCK_OUTPUTS`. */
	lockOutputs?: LockOutputs;
	/** `github.run_attempt` (the lock phase names the artifact with it); default the env's, else 1. */
	runAttempt?: string;
	/** The `$GITHUB_OUTPUT` file the lock phase appends to; default the env's. */
	githubOutput?: string;
	/** apply: `needs.agent.result` (`--agent-result`), REQUIRED. Only `success` reads the handoff. */
	agentResult?: AgentJobResult;
	/** apply: the agent job's timeout (`--agent-timeout-minutes`); default the lock outputs'. */
	agentTimeoutMinutes?: number;
	/** apply: the Actions API reader (tests stub it); default `fetch` with `GITHUB_TOKEN`. */
	actionsApi?: GithubApiGet;
	/** The rung bodies (tests inject one); default the production {@link defaultRungExecutor}. */
	executor?: RungExecutor;
	/** apply: the tree-less publish's liveness ceiling (default 1000, as the laptop driver). */
	publishRetries?: number;
	/** apply: the tree-less publish's retry jitter in ms (tests pass 0). */
	publishJitterMs?: number;
	/** apply (answered merge): the land's compare-and-swap liveness ceiling; default `doOptions.mergeRetries`. */
	mergeRetries?: number;
	/** apply (answered merge): the land's refetch jitter in ms (tests pass 0). */
	mergeJitterMs?: number;
}

/** How a tree-less phase run ended. */
export type TreelessPhaseOutcome =
	/** lock: the item is locked; the agent phase (or, `needsAgent: false`, the apply phase) runs next. */
	| 'locked'
	/** lock: nothing to do at the arbiter's `main` (a pending sidecar, or the item is gone). */
	| 'no-op'
	/** lock: the item's `needsAnswers` flag and sidecar disagree; nothing was written. */
	| 'invariant-violation'
	/** lock: another run holds the item's lock. */
	| 'lost'
	/** agent / apply: the lock ref no longer equals `lockSha`; nothing was done. */
	| 'stale-lock'
	/** agent: the handoff was written (see `intent`). */
	| 'handed-over'
	/** agent: the rung (or the phase) failed; no handoff (the job fails). */
	| 'agent-failed'
	/** apply: the rung ran, its result is published and the lock released. */
	| 'applied'
	/** apply: the rung itself failed (its commit, if any, is not published); the lock was released. */
	| 'rung-failed'
	/** apply: the item was surfaced to needs-attention and its lock released. */
	| 'surfaced'
	/**
	 * apply (answered merge): the kept work branch moved on the arbiter since the
	 * lock job saw it (`continueTip`), so the leased push of the rebased branch
	 * was refused; nothing was written and the lock stays held.
	 */
	| 'stale-lease'
	/** apply (answered merge): the land did not reach `main` and did not surface the item; the lock was released. */
	| 'land-failed'
	/** apply: surfacing the item did not land on the arbiter (the lock stays held). */
	| 'surface-unmoved'
	/** apply: the handoff broke a rule; nothing from it was written, the item was surfaced. */
	| 'rejected'
	/** apply: the item no longer classifies as the lock job saw it; nothing was written. */
	| 'stale'
	/** apply: the publish would carry commits that are not the rung's own; nothing was published. */
	| 'publish-refused'
	/** apply: the rung's commit did not reach the arbiter's `main`. */
	| 'publish-failed'
	/** apply: the agent job was cancelled (not timed out); the lock was only released. */
	| 'released'
	/** apply: the cancelled agent job's leased lock release was refused. */
	| 'release-refused'
	/** A usage or environment problem. */
	| 'usage-error';

/** The result of one tree-less phase run. */
export interface TreelessPhaseResult {
	/** See "A handled outcome is green" in `ci-phase-driver.ts`. */
	exitCode: 0 | 1 | 2 | 3;
	outcome: TreelessPhaseOutcome;
	/**
	 * The result line: the CLI prints it (`>> ` or `error: `), so the phase does
	 * NOT also `note` it (each line appears once in the job log).
	 */
	message: string;
	/** The canonical item (`<namespace>:<slug>`). */
	item?: string;
	/** lock: the facts published. */
	lockOutputs?: LockOutputs;
	/** agent: the handed-over intent kind. */
	intent?: HandoffRecord['intent']['kind'];
	/** apply: the rung body's own outcome. */
	rungOutcome?: AdvanceOutcome;
}

/**
 * Run one phase of a tree-less rung. The CLI calls this for `advance <item>
 * --phase` when the item classifies (lock) or was classified (agent, apply) on
 * the `surface`, `triage-observation` or `apply` rung.
 */
export async function performTreelessPhase(
	options: TreelessPhaseOptions,
): Promise<TreelessPhaseResult> {
	try {
		switch (options.phase) {
			case 'lock':
				return await performTreelessLockPhase(options);
			case 'agent':
				return await performTreelessAgentPhase(options);
			case 'apply':
				return await performTreelessApplyPhase(options);
		}
	} catch (err) {
		if (err instanceof PhaseDriverError || err instanceof SlugResolutionError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		throw err;
	}
}

/** The resolved item a phase acts on. */
interface ResolvedItem {
	namespace: SlugNamespace;
	slug: string;
	item: string;
}

/** The item a tree-less phase acts on, from the (trusted) workflow argument. */
function treelessItem(
	options: TreelessPhaseOptions,
	repoPath: string,
): ResolvedItem {
	const resolved = resolveAdvanceArg({
		arg: options.arg,
		repoPath,
		read: options.read ?? ledgerRead,
	});
	return {
		namespace: resolved.namespace,
		slug: resolved.slug,
		item: `${resolved.namespace}:${resolved.slug}`,
	};
}

/** Classify `resolved` in the tree at `dir` (read-only, no model). */
function classifyIn(
	dir: string,
	resolved: ResolvedItem,
): ReturnType<typeof classifyTick> {
	const type = sidecarTypeFor(resolved.namespace);
	const signals = readItemSignals({
		repoPath: dir,
		type,
		slug: resolved.slug,
		item: resolved.item,
	});
	return classifyTick({type, ...signals});
}

/** The rung input for `resolved` with `context`. */
function rungInput(
	resolved: ResolvedItem,
	classification: ReturnType<typeof classifyTick>,
	context: AdvanceContext,
): RungExecInput {
	return {
		item: resolved.item,
		namespace: resolved.namespace,
		slug: resolved.slug,
		classification,
		context,
	};
}

/**
 * The kept `work/task-<slug>` tip of an answered merge, when it carries work
 * `mainSha` lacks; `undefined` when the branch is absent or already on `main`
 * (nothing to land: the laptop's `already-integrated`). Reads the arbiter and
 * fetches the branch's objects only: nothing is checked out and no repository
 * code runs, so the lock phase may call it.
 */
async function keptMergeTip(params: {
	cwd: string;
	arbiter: string;
	slug: string;
	mainSha: string;
	env: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
	const {cwd, arbiter, slug, mainSha, env} = params;
	const branch = workBranchRef('task', slug);
	const ref = `refs/heads/${branch}`;
	if ((await arbiterRefSha({cwd, arbiter, ref, env})) === undefined) {
		return undefined;
	}
	const tracking = `refs/remotes/${arbiter}/${branch}`;
	const fetched = await runAsync(
		'git',
		['fetch', '--quiet', '--no-tags', arbiter, `+${ref}:${tracking}`],
		cwd,
		{env},
	);
	if (fetched.status !== 0) {
		throw new Error(
			`fetching ${branch} from ${arbiter} failed: ${fetched.stderr.trim()}`,
		);
	}
	const tip = (
		await runAsync('git', ['rev-parse', '--verify', tracking], cwd, {env})
	).stdout.trim();
	const onMain = await runAsync(
		'git',
		['merge-base', '--is-ancestor', tip, mainSha],
		cwd,
		{env},
	);
	return onMain.status === 0 ? undefined : tip;
}

/**
 * The agent need of a tree-less rung as the CI phases see it:
 * {@link treelessAgentNeed} (the tree), refined for an answered `merge` by the
 * arbiter's kept branch ({@link keptMergeTip}), which the tree cannot show. The
 * lock phase publishes the result (and the branch tip as `continueTip`); the
 * apply phase recomputes it on its fresh checkout.
 */
async function treelessPhaseNeed(
	input: RungExecInput,
	params: {
		cwd: string;
		arbiter: string;
		mainSha: string;
		env: NodeJS.ProcessEnv;
	},
): Promise<{need: TreelessAgentNeed; continueTip?: string}> {
	const need = treelessAgentNeed(input);
	if (need.needsAgent !== true || input.classification.kind !== 'apply') {
		return {need};
	}
	const merge = detectAnsweredMergeAction(input.context.cwd, input.item);
	if (merge === undefined) return {need};
	const tip = await keptMergeTip({...params, slug: input.slug});
	return tip === undefined
		? {need: {needsAgent: false}}
		: {need, continueTip: tip};
}

/** Dispatch the tree-less rung to its body. */
function dispatchTreeless(
	executor: RungExecutor,
	rung: TreelessPhaseRung,
	input: RungExecInput,
): Promise<RungExecResult> {
	switch (rung) {
		case 'triage-observation':
			return executor.triageObservation(input);
		case 'surface':
			return executor.surface(input);
		case 'apply':
			return executor.apply(input);
	}
}

/** The held lock of an agent or apply phase, whose rung must be a tree-less one. */
function requireTreelessLock(
	options: TreelessPhaseOptions,
	env: NodeJS.ProcessEnv,
): HeldLock & {rung: TreelessPhaseRung} {
	const facts = options.lockOutputs ?? readLockOutputsFromEnv(env);
	if (!isTreelessPhaseRung(facts.rung)) {
		throw new PhaseDriverError(
			`the lock job classified the rung ${String(facts.rung)}, not a tree-less rung`,
		);
	}
	const held = requireHeldLock({lockOutputs: facts, env, rung: facts.rung});
	return {...held, rung: facts.rung};
}

// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------

/**
 * The lock phase: classify the item at the arbiter's `main`, take the advancing
 * lock and publish the trusted facts. Runs no agent and no repository code.
 */
export async function performTreelessLockPhase(
	options: TreelessPhaseOptions,
): Promise<TreelessPhaseResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = identityEnv(options.identity, options.env ?? process.env);
	const githubOutput = options.githubOutput ?? env.GITHUB_OUTPUT;
	const publish = (facts: LockOutputs): LockOutputs => {
		emitLockOutputs(facts, {githubOutput, note});
		return facts;
	};

	const baseSha = await fetchArbiterMain({cwd, arbiter, env});
	type Verdict = {resolved: ResolvedItem} & (
		| {skip: string}
		| {invariant: string}
		| {rung: TreelessPhaseRung; needsAgent: boolean; continueTip?: string}
	);
	const verdict = await withBaseWorktree(
		{cwd, baseSha, env},
		async (base): Promise<Verdict> => {
			const resolved = treelessItem(options, base);
			const classification = classifyIn(base, resolved);
			const kind = classification.kind;
			if (kind === 'no-op') {
				return {
					resolved,
					skip: `no-op for ${resolved.item} at ${baseSha} (${classification.reason ?? 'nothing to advance'})`,
				};
			}
			if (kind === 'invariant-violation') {
				return {
					resolved,
					invariant:
						`refusing to advance ${resolved.item}: the \`needsAnswers\` flag and ` +
						`the sidecar disagree at ${baseSha} (${classification.reason ?? 'invariant violation'}). ` +
						'A human must reconcile them.',
				};
			}
			if (!isTreelessPhaseRung(kind)) {
				throw new PhaseDriverError(
					`${resolved.item} classifies as ${kind} at ${baseSha}, not a tree-less rung`,
				);
			}
			if (findItemPath(base, resolved.namespace, resolved.slug) === undefined) {
				return {
					resolved,
					skip: `no-op for ${resolved.item}: its item file is not on ${arbiter}/main (${baseSha})`,
				};
			}
			const {need, continueTip} = await treelessPhaseNeed(
				rungInput(resolved, classification, {...options, cwd: base}),
				{cwd, arbiter, mainSha: baseSha, env},
			);
			if (need.needsAgent === undefined) {
				throw new PhaseDriverError(
					`--phase does not split ${resolved.item} yet: ${need.unsplit}`,
				);
			}
			return {
				resolved,
				rung: kind,
				needsAgent: need.needsAgent,
				...(continueTip === undefined ? {} : {continueTip}),
			};
		},
	);
	const {item} = verdict.resolved;
	if ('skip' in verdict) {
		return {
			exitCode: 0,
			outcome: 'no-op',
			item,
			message: verdict.skip,
			lockOutputs: publish({acquired: false, baseSha}),
		};
	}
	if ('invariant' in verdict) {
		return {
			exitCode: 1,
			outcome: 'invariant-violation',
			item,
			message: verdict.invariant,
			lockOutputs: publish({acquired: false, baseSha}),
		};
	}
	const {rung, needsAgent, continueTip} = verdict;
	if ((await arbiterLockSha({cwd, arbiter, item, env})) !== undefined) {
		const message = `'${item}' is already locked on ${arbiter}; backing off.`;
		return {
			exitCode: 0,
			outcome: 'lost',
			item,
			message,
			lockOutputs: publish({acquired: false, rung, baseSha}),
		};
	}
	const acquired = await acquireNotingOnce(note, (acquireNote) =>
		acquireAdvancingLock({
			item,
			cwd,
			arbiter,
			acquireUnified: true,
			env,
			note: acquireNote,
		}),
	);
	if (acquired.exitCode !== 0) {
		const outcome = acquired.outcome === 'usage-error' ? 'usage-error' : 'lost';
		return {
			// A lock lost to another run is handled, so green ("A handled
			// outcome is green", `ci-phase-driver.ts`).
			exitCode: outcome === 'lost' ? 0 : acquired.exitCode,
			outcome,
			item,
			message: acquired.message,
			lockOutputs: publish({acquired: false, rung, baseSha}),
		};
	}
	const lockSha = await arbiterLockSha({cwd, arbiter, item, env});
	if (lockSha === undefined) {
		throw new Error(`the lock of ${item} vanished right after the acquire`);
	}
	const facts = publish({
		acquired: true,
		needsAgent,
		rung,
		baseSha,
		lockSha,
		// An answered merge's kept branch as the lock job saw it: the apply job
		// pushes the rebased tip leased on it (decision 7).
		...(continueTip === undefined ? {} : {continueTip}),
		handoffName: deriveHandoffName(
			item,
			options.runAttempt ?? env.GITHUB_RUN_ATTEMPT ?? '1',
		),
		agentTimeoutMinutes: agentTimeoutMinutesAt(cwd, baseSha, env),
	});
	return {
		exitCode: 0,
		outcome: 'locked',
		item,
		message:
			`locked ${item} on the ${rung} rung at ${baseSha} (lock ${lockSha}; ` +
			`${needsAgent ? 'an agent runs next' : 'no agent is needed'})`,
		lockOutputs: facts,
	};
}

// ---------------------------------------------------------------------------
// agent
// ---------------------------------------------------------------------------

/** What the agent phase's wrapped agent seams captured, and which write seams the rung reached. */
interface Captured {
	surface?: SurfaceEmit;
	triage?: TriageEmit;
	verdict?: DecisionVerdict;
	surfacePersisted: boolean;
	autoDisposed: boolean;
	/** The answered merge's agent half, whose job worktree the handoff bundle reads. */
	merge?: PreparedMergeLand;
}

const RECORDED =
	'recorded for the CI apply phase (the agent job writes nothing)';

/**
 * The advance context of the agent phase: the real agent seams, each wrapped to
 * capture its emit, and every write seam a stub that writes nothing.
 */
function agentPhaseContext(
	options: TreelessPhaseOptions,
	dir: string,
	captured: Captured,
): AdvanceContext {
	const surfaceGate = options.surfaceGate ?? harnessSurfaceGate();
	const triageGate = options.triageGate ?? harnessTriageGate();
	const decider = options.applyDecide ?? harnessApplyDecider();
	return {
		...options,
		cwd: dir,
		surfaceGate: async (input) => {
			const emit = await surfaceGate(input);
			captured.surface = emit;
			return emit;
		},
		triageGate: async (input) => {
			const emit = await triageGate(input);
			captured.triage = emit;
			return emit;
		},
		applyDecide: async (input) => {
			const verdict = await decider(input);
			captured.verdict = verdict;
			return verdict;
		},
		surfacePersist: (o) => {
			captured.surfacePersisted = true;
			return {
				outcome: o.questions.length > 0 ? 'surfaced' : 'nothing',
				sidecarPath: sidecarPathFor(o.item),
				entryCount: o.questions.length,
			};
		},
		applyPersist: (o) => ({
			outcome:
				o.appendQuestions !== undefined && o.appendQuestions.length > 0
					? 'repaused'
					: o.dispose !== undefined
						? 'disposed'
						: 'resolved',
			sidecarPath: sidecarPathFor(o.item),
			itemPath: o.itemPath,
			message: RECORDED,
		}),
		stampTriaged: () => ({message: RECORDED}),
		autoDisposition: (o) => {
			captured.autoDisposed = true;
			return {
				outcome: 'deleted',
				commit: '',
				itemPath: o.itemPath,
				message: RECORDED,
			};
		},
		promote: async () => ({
			outcome: 'promoted',
			exitCode: 0,
			message: RECORDED,
		}),
		mintAdr: async () => ({outcome: 'minted', exitCode: 0, message: RECORDED}),
		stuckAction: async () => ({outcome: 'keep', message: RECORDED}),
		mergeAction: async (input) => {
			if (input.workspacesDir === '') {
				throw new Error(
					'the answered merge action needs a workspacesDir to check the ' +
						'work branch out (createJob)',
				);
			}
			const prepared = await prepareMergeLand(input);
			captured.merge = prepared;
			return mergeResultFor(prepared.preparation);
		},
	};
}

/**
 * The merge-action result the rung body sees for the agent half's preparation
 * (it only steers the rung's recording stubs; the handoff comes from the
 * preparation itself, {@link mergeHandover}).
 */
function mergeResultFor(p: MergeLandPreparation): MergeActionResult {
	switch (p.kind) {
		case 'integrate':
			return {outcome: 'landed', message: RECORDED};
		case 'restale':
			return {outcome: 'restale', message: p.message, main: p.main};
		case 'needs-attention':
			return {outcome: 'refused', message: p.reason};
		case 'already-integrated':
			return {outcome: 'already-integrated', message: p.message};
	}
}

/** What the agent phase writes: the record, and the work branch to bundle. */
interface TreelessHandover {
	record: HandoffRecord;
	bundle?: {repo: string; workBranch: string; baseSha: string};
}

/**
 * The handoff of an answered merge's agent half: `integrate` with the rebased
 * tip, `merge-restale`, or `needs-attention` (the red rebased tip bundled, or
 * nothing on a rebase conflict). A branch that landed since the lock job ran
 * has nothing to hand over, so the agent job fails and the apply job surfaces
 * the item.
 */
function mergeHandover(
	item: string,
	p: MergeLandPreparation,
	baseSha: string,
): TreelessHandover {
	switch (p.kind) {
		case 'integrate':
			return {
				record: {schema: 1, item, intent: {kind: 'integrate'}, products: {}},
				bundle: {repo: p.repo, workBranch: p.workBranch, baseSha},
			};
		case 'restale':
			return {
				record: {
					schema: 1,
					item,
					intent: {kind: 'merge-restale'},
					products: {},
				},
			};
		case 'needs-attention': {
			const reason = (t: string): string =>
				boundHandoffText(t, HANDOFF_LIMITS.reasonChars);
			const products: NeedsAttentionProducts = {
				reason: reason(p.reason),
				...(p.questions === undefined || p.questions.length === 0
					? {}
					: {questions: p.questions.map(reason)}),
			};
			return {
				record: {
					schema: 1,
					item,
					intent: {kind: 'needs-attention'},
					products,
				},
				...(p.bundle === undefined ? {} : {bundle: {...p.bundle, baseSha}}),
			};
		}
		case 'already-integrated':
			throw new Error(
				`the answered merge of ${item} has nothing to land: ${p.message}`,
			);
	}
}

/**
 * The surface questions of a captured emit, bounded for the handoff, each with
 * the context and suggested default the agent gave it. A question with neither
 * travels as its bare text (the plain form every schema-1 reader accepts), so
 * only a question that has more to carry needs the object form.
 */
function questionEntries(
	emit: SurfaceEmit | undefined,
): HandoffQuestionEntry[] {
	const bound = (t: string): string =>
		boundHandoffText(t, HANDOFF_LIMITS.reasonChars);
	const entries: HandoffQuestionEntry[] = [];
	for (const q of emit?.questions ?? []) {
		const question = bound(q.question);
		if (question.trim() === '') continue;
		if (q.context === undefined && q.default === undefined) {
			entries.push(question);
			continue;
		}
		entries.push({
			question,
			...(q.context === undefined ? {} : {context: bound(q.context)}),
			...(q.default === undefined ? {} : {default: bound(q.default)}),
		});
	}
	return entries;
}

/** The ask's follow-up questions of a verdict, kept separate (never joined). */
function askQuestions(verdict: DecisionVerdict): string[] {
	const questions =
		verdict.questions !== undefined && verdict.questions.length > 0
			? verdict.questions
			: [verdict.question ?? ''];
	return questions.map((q) => boundHandoffText(q, HANDOFF_LIMITS.reasonChars));
}

/** Control characters and line separators (a one-line handoff field refuses them). */
// eslint-disable-next-line no-control-regex
const LINE_BREAKING_RE = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

/** A drafted title as the handoff's one-line field (or `fallback`). */
function oneLine(text: string | undefined, fallback: string): string {
	const line = (text ?? '')
		.replace(LINE_BREAKING_RE, ' ')
		.trim()
		.slice(0, HANDOFF_LIMITS.documentTitleChars)
		.trim();
	return line === '' ? fallback : line;
}

/**
 * Map the agentic apply verdict to the `apply-decision` products. A mint keeps
 * the laptop defaults: no drafted slug is the observation's slug (sanitised as
 * `promoteObservation` / `mintAdr` sanitise it), no drafted body is `''` (the
 * writer then builds the self-contained body from the note, as it does when the
 * verdict carries none), and no title is the slug (the ADR default; a task or
 * spec draft's title is not used by the writer today).
 */
function decisionProducts(
	verdict: DecisionVerdict,
	itemSlug: string,
): ApplyDecisionProducts {
	const reason = (r: string | undefined): {reason?: string} =>
		r === undefined || r.trim() === ''
			? {}
			: {reason: boundHandoffText(r, HANDOFF_LIMITS.reasonChars)};
	const mint = (
		outcome: 'task' | 'spec' | 'adr',
		slug: string | undefined,
		title: string | undefined,
		body: string | undefined,
	): ApplyDecisionProducts => {
		const safe = ensureSafeSlug(slug ?? itemSlug) || itemSlug;
		return {
			outcome,
			slug: safe,
			title: oneLine(title, safe),
			body: boundHandoffText(body ?? '', HANDOFF_LIMITS.documentChars),
		};
	};
	switch (verdict.outcome) {
		case 'task':
			return mint(
				'task',
				verdict.taskSlug,
				verdict.taskTitle,
				verdict.taskBody,
			);
		case 'spec':
			return mint(
				'spec',
				verdict.specSlug,
				verdict.specTitle,
				verdict.specBody,
			);
		case 'adr':
			return mint('adr', verdict.adrSlug, verdict.adrTitle, verdict.adrBody);
		case 'dispose':
			return {outcome: 'dispose', ...reason(verdict.disposeReason)};
		case 'resolve':
			return {outcome: 'resolve', ...reason(verdict.resolveReason)};
		case 'ask':
			return {
				outcome: 'ask',
				questions: askQuestions(verdict),
			};
		default:
			throw new Error(
				`the decision verdict ${String(verdict.outcome)} cannot be handed over`,
			);
	}
}

/**
 * Run the rung body under the recorder and map what its agents decided to the
 * handoff record. Throws when the rung failed or reached nothing to hand over.
 */
async function treelessHandover(params: {
	options: TreelessPhaseOptions;
	rung: TreelessPhaseRung;
	resolved: ResolvedItem;
	dir: string;
	baseSha: string;
	captured: Captured;
}): Promise<TreelessHandover> {
	const {options, rung, resolved, dir, captured} = params;
	const {item} = resolved;
	const classification = classifyIn(dir, resolved);
	if (classification.kind !== rung) {
		throw new Error(
			`${item} classifies as ${classification.kind} at the base, not ${rung}`,
		);
	}
	const exec = await dispatchTreeless(
		options.executor ?? defaultRungExecutor,
		rung,
		rungInput(
			resolved,
			classification,
			agentPhaseContext(options, dir, captured),
		),
	);
	// The answered merge: what its agent half found IS the handover (a red gate
	// or a conflict ends the rung as `merge-refused`, which is still handed over).
	if (captured.merge !== undefined) {
		return mergeHandover(item, captured.merge.preparation, params.baseSha);
	}
	if (exec.exitCode !== 0) {
		throw new Error(`the ${rung} rung failed: ${exec.message}`);
	}
	const nothing = (): never => {
		throw new Error(
			`the ${rung} rung of ${item} reached nothing to hand over (${exec.outcome}: ${exec.message})`,
		);
	};
	return {record: capturedRecord(rung, resolved, captured, nothing)};
}

/** The handoff record of what the rung's agents decided (see {@link treelessHandover}). */
function capturedRecord(
	rung: TreelessPhaseRung,
	resolved: ResolvedItem,
	captured: Captured,
	nothing: () => never,
): HandoffRecord {
	const {item} = resolved;
	switch (rung) {
		case 'surface':
			if (!captured.surfacePersisted) nothing();
			return {
				schema: 1,
				item,
				intent: {kind: 'surface'},
				products: {
					questions: questionEntries(captured.surface),
				} satisfies SurfaceProducts,
			};
		case 'triage-observation': {
			const t = captured.triage;
			if (captured.autoDisposed && t?.auto === true) {
				return {
					schema: 1,
					item,
					intent: {kind: 'triage'},
					products: {
						disposition: t.kind,
						target: canonicalHandoffItem(t.existing),
						...(t.reason.trim() === ''
							? {}
							: {
									reason: boundHandoffText(
										t.reason,
										HANDOFF_LIMITS.reasonChars,
									),
								}),
					} satisfies TriageProducts,
				};
			}
			if (!captured.surfacePersisted) nothing();
			return {
				schema: 1,
				item,
				intent: {kind: 'triage'},
				products: {
					disposition: 'keep',
					questions: questionEntries(captured.surface),
				} satisfies TriageProducts,
			};
		}
		case 'apply':
			if (captured.verdict === undefined) nothing();
			return {
				schema: 1,
				item,
				intent: {kind: 'apply-decision'},
				products: decisionProducts(
					captured.verdict as DecisionVerdict,
					resolved.slug,
				),
			};
	}
}

/**
 * The agent phase: after a read-only lock-ownership check, run the rung body in
 * a worktree of `baseSha` with the real agents and no write, and write the
 * handoff. Holds a read-only token. Any failure writes no handoff and fails the
 * job (the apply job then surfaces the item).
 */
export async function performTreelessAgentPhase(
	options: TreelessPhaseOptions,
): Promise<TreelessPhaseResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env ?? process.env;
	const held = requireTreelessLock(options, env);
	if (options.handoffDir === undefined) {
		throw new PhaseDriverError('the agent phase needs a handoff directory');
	}
	if (held.needsAgent === false) {
		throw new PhaseDriverError(
			`the lock job said the ${held.rung} rung needs no agent; the agent job ` +
				'must be skipped',
		);
	}
	const resolved = treelessItem(options, options.repoPath ?? cwd);
	const {item} = resolved;

	const ownership = await checkLockOwnership({
		cwd,
		arbiter,
		item,
		lockSha: held.lockSha,
		env,
	});
	if (!ownership.owned) {
		return {
			exitCode: 0,
			outcome: 'stale-lock',
			item,
			message: ownership.message,
		};
	}

	let record: HandoffRecord;
	const captured: Captured = {surfacePersisted: false, autoDisposed: false};
	try {
		// A read-only fetch, so the lock job's base is in this checkout.
		await fetchArbiterMain({cwd, arbiter, env});
		const handover = await withBaseWorktree(
			{cwd, baseSha: held.baseSha, env},
			async (dir) => {
				const outcome = await runAgentPhase(
					createPhaseRecorder({record: []}),
					() =>
						treelessHandover({
							options,
							rung: held.rung,
							resolved,
							dir,
							baseSha: held.baseSha,
							captured,
						}),
				);
				if (outcome.halted) {
					throw new Error(
						`the ${held.rung} rung reached a write (${outcome.intent.seam}.${outcome.intent.method})`,
					);
				}
				return outcome.result;
			},
		);
		record = handover.record;
		const written = writeHandoff({
			dir: options.handoffDir,
			rung: held.rung,
			record,
			bundle: handover.bundle,
		});
		if (written.lfsMissing.length > 0) {
			note(
				`the local LFS store lacks ${written.lfsMissing.length} object(s) a new ` +
					`commit points at (${written.lfsMissing.slice(0, 5).join(', ')}); the ` +
					'apply job will reject the handoff',
			);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'agent-failed', item, message};
	} finally {
		// The answered merge's job worktree, once its bundle is written.
		captured.merge?.dispose();
	}
	const kind = record.intent.kind;
	const message = `handed over ${kind} for ${item}`;
	return {exitCode: 0, outcome: 'handed-over', item, message, intent: kind};
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/** What the apply phase works with past the ownership check. */
interface ApplyContext {
	options: TreelessPhaseOptions;
	held: HeldLock & {rung: TreelessPhaseRung};
	resolved: ResolvedItem;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
	note: (message: string) => void;
}

/**
 * The apply phase: check the lock is still this run's, act on the agent job's
 * result, validate the handoff as hostile, then run the rung's write half on a
 * fresh checkout of `<arbiter>/main`, publish and release. Runs no agent and no
 * repository code.
 */
export async function performTreelessApplyPhase(
	options: TreelessPhaseOptions,
): Promise<TreelessPhaseResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = noSmudgeEnv(
		identityEnv(options.identity, options.env ?? process.env),
	);
	const held = requireTreelessLock(options, env);
	if (options.agentResult === undefined) {
		throw new PhaseDriverError(
			'the apply phase needs the agent job result (--agent-result, ' +
				'needs.agent.result): only success reads the handoff',
		);
	}
	const agentResult = options.agentResult;
	const resolved = treelessItem(options, options.repoPath ?? cwd);
	const {item} = resolved;

	// Lock ownership BEFORE the first write (spec §8).
	const ownership = await checkLockOwnership({
		cwd,
		arbiter,
		item,
		lockSha: held.lockSha,
		env,
	});
	if (!ownership.owned) {
		return {
			exitCode: 0,
			outcome: 'stale-lock',
			item,
			message: ownership.message,
		};
	}

	// Every lock release from here on (the surface's, the final one) is leased
	// on the sha this run owns.
	const restoreLease = leaseLockReleases(item, held.lockSha);
	try {
		const ctx: ApplyContext = {
			options,
			held,
			resolved,
			arbiter,
			cwd,
			env,
			note,
		};
		const decision = await resolveAgentResult({
			result: agentResult,
			held,
			agentTimeoutMinutes: options.agentTimeoutMinutes,
			api: options.actionsApi,
			env,
		});
		switch (decision.action) {
			case 'deterministic':
				return await runRungAndPublish(ctx, undefined);
			case 'read-handoff': {
				if (held.needsAgent === false) {
					// No agent was needed: whatever the agent job left is not read.
					note(
						'the lock job said no agent is needed; the handoff is not read ' +
							'and the rung runs deterministically',
					);
					return await runRungAndPublish(ctx, undefined);
				}
				if (isAnsweredMergeRun(held)) {
					let validated: ApplyHandoff;
					try {
						validated = readAnsweredMergeHandoff(ctx);
					} catch (err) {
						if (!(err instanceof HandoffRejected)) throw err;
						return await surfaceItem(ctx, err.message, 'rejected');
					}
					return await applyAnsweredMerge(ctx, validated);
				}
				let record: HandoffRecord;
				try {
					record = readTreelessHandoff(ctx);
				} catch (err) {
					if (!(err instanceof HandoffRejected)) throw err;
					return await surfaceItem(ctx, err.message, 'rejected');
				}
				return await runRungAndPublish(ctx, record);
			}
			case 'surface':
				return await surfaceItem(ctx, decision.reason, 'surfaced');
			case 'release': {
				const released = await releaseLockLeased({
					cwd,
					arbiter,
					item,
					expectedSha: held.lockSha,
					env,
				});
				note(released.message);
				return released.released
					? {
							exitCode: 0,
							outcome: 'released',
							item,
							message: `Released '${item}': ${decision.reason}.`,
						}
					: {
							exitCode: 1,
							outcome: 'release-refused',
							item,
							message: `Could not release '${item}' (${released.message}): ${decision.reason}.`,
						};
			}
		}
	} finally {
		restoreLease();
	}
}

/**
 * Read the handoff as hostile. `readHandoff` validates the item, the intent
 * kind against the rung, every enum, slug and item reference and every limit;
 * on top, the rules the record format cannot know: the rung's own intent kind,
 * a triage auto-disposition only under `observationTriage: auto` (the triage
 * gate never runs otherwise), and a triage target that is not the note itself.
 * Throws {@link HandoffRejected}.
 */
function readTreelessHandoff(ctx: ApplyContext): HandoffRecord {
	const {options, held, resolved, env} = ctx;
	if (options.handoffDir === undefined) {
		throw new HandoffRejected('layout', 'no handoff directory was given');
	}
	const record = readHandoff({
		dir: options.handoffDir,
		runnerTemp: runnerTempFrom(options.runnerTemp, env),
		trust: {item: resolved.item, rung: held.rung},
	}).record;
	if (record.intent.kind !== INTENT_FOR_RUNG[held.rung]) {
		throw new HandoffRejected(
			'kind-for-rung',
			`a ${held.rung} run hands over ${INTENT_FOR_RUNG[held.rung]}, not ${record.intent.kind}`,
		);
	}
	if (record.intent.kind === 'triage') {
		const t = record.products as TriageProducts;
		if (t.disposition !== 'keep' && options.observationTriage !== 'auto') {
			throw new HandoffRejected(
				'field',
				`products.disposition is ${t.disposition}, but observationTriage is ` +
					`${options.observationTriage ?? 'unset'}: only 'auto' runs the triage gate`,
			);
		}
		if (t.target === resolved.item) {
			throw new HandoffRejected(
				'field',
				'products.target names the observation itself',
			);
		}
	}
	return record;
}

/**
 * Whether this run carries an answered merge's agent job: the lock job
 * publishes `continueTip` on the apply rung only for an answered `merge` whose
 * kept branch carries work `main` lacks (trusted lock outputs, never the
 * artifact).
 */
function isAnsweredMergeRun(held: HeldLock): boolean {
	return held.rung === 'apply' && held.continueTip !== undefined;
}

/** The intents an answered merge's agent job may hand over. */
const ANSWERED_MERGE_INTENTS: readonly HandoffRecord['intent']['kind'][] = [
	'integrate',
	'merge-restale',
	'needs-attention',
];

/**
 * Read an answered merge's handoff as hostile, bundle included
 * (`validateApplyHandoff`: the bundle's one ref is the item's work branch, its
 * history descends from `baseSha`, and every path, size and LFS rule holds). The
 * integration mode is the trusted `merge`: the human's answer is the checkpoint,
 * so the untrusted-origin rule (a BUILD rule) does not apply. Throws
 * {@link HandoffRejected}.
 */
function readAnsweredMergeHandoff(ctx: ApplyContext): ApplyHandoff {
	const {options, held, resolved, arbiter, cwd, env} = ctx;
	if (options.handoffDir === undefined) {
		throw new HandoffRejected('layout', 'no handoff directory was given');
	}
	const validated = validateApplyHandoff({
		dir: options.handoffDir,
		runnerTemp: runnerTempFrom(options.runnerTemp, env),
		repo: cwd,
		trust: {
			item: resolved.item,
			rung: held.rung,
			baseSha: held.baseSha,
			arbiter,
			integrationMode: 'merge',
		},
		env,
	});
	const kind = validated.handoff.record.intent.kind;
	if (!ANSWERED_MERGE_INTENTS.includes(kind)) {
		throw new HandoffRejected(
			'kind-for-rung',
			`an answered merge hands over ${ANSWERED_MERGE_INTENTS.join(', ')}, not ${kind}`,
		);
	}
	return validated;
}

/**
 * The write half of an answered merge (spec §3, the `apply, kind: merge` row).
 * `merge-restale` re-pauses through the rung body. Otherwise, after checking the
 * item still carries the answered `merge` on a fresh `main`: the handoff's LFS
 * objects first, then the rebased branch pushed leased on `continueTip` (a
 * branch that moved writes nothing more), then either the needs-attention route
 * or the land through the unchanged compare-and-swap loop in merge mode, with
 * the gated tip (a land after a lost race carries `Landed-Without-Regate`), and
 * only then the answer recorded and published on the new `main`.
 */
async function applyAnsweredMerge(
	ctx: ApplyContext,
	validated: ApplyHandoff,
): Promise<TreelessPhaseResult> {
	const {options, held, resolved, arbiter, cwd, env, note} = ctx;
	const {item, slug} = resolved;
	const record = validated.handoff.record;
	if (record.intent.kind === 'merge-restale') {
		return runRungAndPublish(ctx, record);
	}

	// Nothing is written unless the item still carries its answered merge.
	const stale = await answeredMergeGone(ctx);
	if (stale !== undefined) return releaseAfter(ctx, stale);

	const lfs = await pushHandoffLfs({
		cwd,
		arbiter,
		objects: validated.lfsObjects,
		env,
		note,
	});
	if (!lfs.ok) {
		return surfaceItem(ctx, lfs.reason, lfs.rejected ? 'rejected' : 'surfaced');
	}

	const bundle = validated.bundle;
	if (bundle !== undefined) {
		await gitHard(
			['checkout', '--quiet', '-B', bundle.workBranch, bundle.tip],
			cwd,
			env,
		);
		// The rebased branch (decision 7): the agent job rebased it locally; publish
		// it leased on the tip the LOCK job observed, before any other ref.
		const pushed = await refWrite.pushLeasedWorkBranch({
			arbiter,
			branch: bundle.workBranch,
			commit: bundle.tip,
			expectedTip: held.continueTip as string,
			cwd,
			env,
		});
		if (pushed.status !== 0) {
			const message =
				`${bundle.workBranch} on ${arbiter} moved since the lock job saw it ` +
				`at ${held.continueTip}, so the leased push of the rebased branch was ` +
				`refused (${pushed.stderr.trim()}). Nothing was written and the lock ` +
				`of ${item} is still held: inspect the branch, then \`dorfl ` +
				`release-lock ${item}\` to retry the item.`;
			return {exitCode: 1, outcome: 'stale-lease', item, message};
		}
	}

	if (record.intent.kind === 'needs-attention') {
		const {reason, questions} = record.products as NeedsAttentionProducts;
		const routed =
			bundle !== undefined
				? await ledgerWrite.applyNeedsAttentionTransition({
						cwd,
						slug,
						reason,
						questions,
						arbiter,
						env,
						note,
					})
				: await ledgerWrite.applyTreelessNeedsAttentionTransition({
						cwd,
						slug,
						reason,
						questions,
						arbiter,
						env,
						note,
					});
		const message = routed.moved
			? `Surfaced '${item}' to needs-attention: ${reason}`
			: `Could not surface '${item}' (${routed.reasonNotMoved ?? 'unknown'}): ${reason}`;
		return {
			exitCode: routed.moved ? 0 : 1,
			outcome: routed.moved ? 'surfaced' : 'surface-unmoved',
			item,
			message,
		};
	}

	// `integrate`: the bundle is required by the intent table.
	if (bundle === undefined) {
		throw new Error('an answered-merge integrate handoff carries no bundle');
	}
	const commitMessage = (
		await gitHard(['log', '-1', '--format=%s', bundle.tip], cwd, env)
	).trim();
	const land = await integrationLand.land({
		cwd,
		arbiter,
		slug,
		branch: bundle.workBranch,
		lifecycle: false,
		source: taskSourceAtBase(cwd, held.baseSha, slug, env),
		surfaceArbiter: arbiter,
		commitMessage,
		env,
		note,
		mode: 'merge',
		title: commitMessage,
		mergeRetries: options.mergeRetries ?? options.doOptions?.mergeRetries,
		mergeJitterMs: options.mergeJitterMs,
		// The landed-vs-gated report (decision 2): the agent job gated the
		// rebased tip, so a land after a lost race says it landed another tree.
		gatedTip: bundle.tip,
	});
	const landed =
		land.outcome === 'completed' &&
		(land.integration?.mergedToMain === true ||
			land.integration?.alreadyLanded === true);
	if (!landed) {
		const message = land.reason ?? `the land ended as ${land.outcome}`;
		if (land.routedToNeedsAttention) {
			return {exitCode: 0, outcome: 'surfaced', item, message};
		}
		return releaseAfter(ctx, {
			exitCode: 1,
			outcome: 'land-failed',
			item,
			message,
		});
	}
	note(`landed ${bundle.workBranch} on ${arbiter}/main`);
	// The answer is recorded AFTER the land, a second write to `main`, as on the
	// laptop.
	return runRungAndPublish(ctx, record, {landed: true});
}

/**
 * The `stale` result when the item no longer carries an answered `merge` on
 * the arbiter's current `main` (answered again, landed, or gone), else
 * `undefined`. Read-only.
 */
async function answeredMergeGone(
	ctx: ApplyContext,
): Promise<TreelessPhaseResult | undefined> {
	const {resolved, arbiter, cwd, env} = ctx;
	const {item} = resolved;
	const tip = await fetchArbiterMain({cwd, arbiter, env});
	return withBaseWorktree({cwd, baseSha: tip, env}, async (dir) => {
		const kind = classifyIn(dir, resolved).kind;
		const verb =
			kind === 'apply' ? detectAnsweredMergeAction(dir, item)?.verb : undefined;
		if (verb === 'merge') return undefined;
		return {
			exitCode: 1,
			outcome: 'stale',
			item,
			message:
				`${item} no longer carries an answered merge on ${arbiter}/main ` +
				`(${tip}: ${kind}${verb === undefined ? '' : `, answered ${verb}`}); nothing was written`,
		};
	});
}

/** Release the lock (leased on `lockSha`) after `result`, folding a refused release into it. */
async function releaseAfter(
	ctx: ApplyContext,
	result: TreelessPhaseResult,
): Promise<TreelessPhaseResult> {
	const {held, resolved, arbiter, cwd, env, note} = ctx;
	const released = await releaseLockLeased({
		cwd,
		arbiter,
		item: resolved.item,
		expectedSha: held.lockSha,
		env,
	});
	note(released.message);
	if (!released.released) {
		return {
			...result,
			exitCode: result.exitCode === 0 ? 1 : result.exitCode,
			message: `${result.message} (${released.message})`,
		};
	}
	return result;
}

async function gitHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
): Promise<string> {
	const r = await runAsync('git', args, cwd, {env});
	if (r.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`,
		);
	}
	return r.stdout;
}

/** A gate the apply phase never launches: the handoff did not answer it. */
function noAgent(what: string): never {
	throw new PhaseDriverError(
		`the apply phase launches no agent (${what}); the handoff does not answer it`,
	);
}

/**
 * Replay the checked handoff's surface questions as the surface gate's emit,
 * with each question's context and suggested default, so the rung persists the
 * same sidecar the laptop does.
 */
function replaySurface(
	questions: HandoffQuestionEntry[] | undefined,
): SurfaceGate {
	return async () => ({
		questions: (questions ?? []).map(
			(q): SurfaceQuestion =>
				typeof q === 'string'
					? {question: q}
					: {
							question: q.question,
							...(q.context === undefined ? {} : {context: q.context}),
							...(q.default === undefined ? {} : {default: q.default}),
						},
		),
	});
}

/** Replay the checked `apply-decision` as the decider's verdict. */
function replayDecision(p: ApplyDecisionProducts): ApplyDecider {
	return async (): Promise<DecisionVerdict> => {
		switch (p.outcome) {
			case 'task':
				return {
					outcome: 'task',
					taskSlug: p.slug,
					taskTitle: p.title,
					taskBody: p.body,
				};
			case 'spec':
				return {
					outcome: 'spec',
					specSlug: p.slug,
					specTitle: p.title,
					specBody: p.body,
				};
			case 'adr':
				return {
					outcome: 'adr',
					adrSlug: p.slug,
					adrTitle: p.title,
					adrBody: p.body,
				};
			case 'dispose':
				return {outcome: 'dispose', disposeReason: p.reason};
			case 'resolve':
				return {outcome: 'resolve', resolveReason: p.reason};
			case 'ask':
				// One follow-up question per handed-over question (never joined).
				return {outcome: 'ask', questions: p.questions ?? []};
		}
	};
}

type AgentSeams = Pick<
	AdvanceContext,
	'surfaceGate' | 'triageGate' | 'applyDecide' | 'mergeAction'
>;

/**
 * The answered merge's action in the apply phase, which never runs the
 * repository's code: the land the apply phase itself just made (`landed`), the
 * agent job's `merge-restale`, and, with no agent job, `hold` / `drop` (the
 * laptop dispatcher, which touches nothing for them) or a `merge` whose kept
 * branch is absent or already on `main` (`already-integrated`, as the laptop
 * reports it). Anything else would need the agent job, so it throws.
 */
function replayMergeAction(
	record: HandoffRecord | undefined,
	landed: boolean,
): MergeActionHandler {
	return async (input) => {
		const kind = record?.intent.kind;
		if (kind === 'integrate' && landed) {
			return {
				outcome: 'landed',
				message:
					`merge-question for ${input.item} answered MERGE: landed ` +
					`\`work/task-${input.slug}\` (rebased and gated by the agent job).`,
			};
		}
		if (kind === 'merge-restale') {
			// The follow-up is asked against the fresh `main` this rung runs on
			// (the base worktree's HEAD), which it records as its `askedAtMain`: a
			// re-answer while `main` stays put then lands (no re-stale livelock).
			const head = await runAsync('git', ['rev-parse', 'HEAD'], input.cwd, {
				env: input.env,
			});
			const main = head.status === 0 ? head.stdout.trim() : '';
			return {
				outcome: 'restale',
				message:
					`merge-question for ${input.item} answered MERGE, but ` +
					'strictMergeApproval is ON and `main` moved since the question was ' +
					'asked (checked by the agent job): re-surfacing the merge-question.',
				...(main === '' ? {} : {main}),
			};
		}
		if (record === undefined) {
			if (input.action.verb !== 'merge') return performMergeAction(input);
			return {
				outcome: 'already-integrated',
				message:
					`merge-question for ${input.item} answered MERGE: ` +
					`\`work/task-${input.slug}\` is absent or already on main (nothing to land).`,
			};
		}
		return noAgent('the answered merge action');
	};
}

/**
 * The agent seams of the apply phase: replays of the checked handoff, and a
 * throwing gate for every seam the handoff does not answer (all of them when
 * the rung runs deterministically).
 */
function replayGates(
	record: HandoffRecord | undefined,
	landed = false,
): AgentSeams {
	const gates: AgentSeams = {
		surfaceGate: async () => noAgent('the surface-questions agent'),
		triageGate: async () => noAgent('the triage gate'),
		applyDecide: async () => noAgent('the apply decision agent'),
		mergeAction: replayMergeAction(record, landed),
	};
	if (record === undefined) return gates;
	if (record.intent.kind === 'surface') {
		gates.surfaceGate = replaySurface(
			(record.products as SurfaceProducts).questions,
		);
	} else if (record.intent.kind === 'triage') {
		const t = record.products as TriageProducts;
		gates.surfaceGate = replaySurface(t.questions);
		gates.triageGate = async (): Promise<TriageEmit> =>
			t.disposition === 'keep'
				? {auto: false}
				: {
						auto: true,
						kind: t.disposition,
						existing: t.target as string,
						reason: t.reason ?? '',
					};
	} else if (record.intent.kind === 'apply-decision') {
		gates.applyDecide = replayDecision(
			record.products as ApplyDecisionProducts,
		);
	}
	return gates;
}

/** Whether `HEAD` of `dir` is now on the arbiter's `main` (after the publish). */
async function publishedToMain(
	dir: string,
	arbiter: string,
	env: NodeJS.ProcessEnv,
): Promise<boolean> {
	await runAsync(
		'git',
		[
			'fetch',
			'--quiet',
			'--no-tags',
			arbiter,
			`+refs/heads/main:refs/remotes/${arbiter}/main`,
		],
		dir,
		{env},
	);
	const r = await runAsync(
		'git',
		['merge-base', '--is-ancestor', 'HEAD', `refs/remotes/${arbiter}/main`],
		dir,
		{env},
	);
	return r.status === 0;
}

/**
 * Run the rung body's write half on a FRESH checkout of `<arbiter>/main`: check
 * the item still classifies on the lock job's rung with the same agent need,
 * run the rung with the replayed (or refusing) agent seams and the real write
 * seams, check the publish scope and publish. Then release the lock (leased),
 * whatever happened past the ownership check.
 */
async function runRungAndPublish(
	ctx: ApplyContext,
	record: HandoffRecord | undefined,
	opts: {landed?: boolean} = {},
): Promise<TreelessPhaseResult> {
	const landed = opts.landed === true;
	const {options, held, resolved, arbiter, cwd, env, note} = ctx;
	const {item} = resolved;
	const tip = await fetchArbiterMain({cwd, arbiter, env});
	const result = await withBaseWorktree(
		{cwd, baseSha: tip, env},
		async (dir): Promise<TreelessPhaseResult> => {
			const classification = classifyIn(dir, resolved);
			const input = rungInput(resolved, classification, {
				...options,
				cwd: dir,
				arbiter,
				note,
				...replayGates(record, landed),
			});
			let need: TreelessAgentNeed | undefined;
			if (classification.kind === held.rung && landed) {
				// The land already happened, so the kept branch is on main and the
				// need would recompute to none: an agent job did run, and its
				// answered merge is what is left to record.
				need =
					detectAnsweredMergeAction(dir, item)?.verb === 'merge'
						? {needsAgent: true}
						: {unsplit: 'no answered merge left to record after the land'};
			} else if (classification.kind === held.rung) {
				need = (
					await treelessPhaseNeed(input, {cwd, arbiter, mainSha: tip, env})
				).need;
			}
			if (need?.needsAgent !== (record !== undefined)) {
				const what =
					need === undefined
						? `classifies as ${classification.kind}, not ${held.rung}`
						: need.needsAgent === undefined
							? `needs ${need.unsplit}`
							: need.needsAgent
								? 'now needs an agent, but none ran'
								: 'now needs no agent, but one ran';
				return {
					exitCode: 1,
					outcome: 'stale',
					item,
					message:
						`${item} ${what} on ${arbiter}/main (${tip}); ` +
						(landed
							? 'its merge landed, but the answer was not recorded'
							: 'nothing was written'),
				};
			}
			const exec = await dispatchTreeless(
				options.executor ?? defaultRungExecutor,
				held.rung,
				input,
			);
			if (exec.exitCode !== 0) {
				return {
					exitCode: exec.exitCode,
					outcome: 'rung-failed',
					item,
					message: exec.message,
					rungOutcome: exec.outcome,
				};
			}
			const scope = await checkTreelessPublishScope({
				cwd: dir,
				base: tip,
				env,
			});
			if (scope.kind === 'refused') {
				return {
					exitCode: 1,
					outcome: 'publish-refused',
					item,
					message: `${exec.message} ${scope.message}; nothing was published`,
					rungOutcome: exec.outcome,
				};
			}
			if (scope.kind === 'rung-commit') {
				await refWrite.publishTreelessResult({
					cwd: dir,
					arbiter,
					retries: options.publishRetries ?? 1000,
					jitterMs: options.publishJitterMs ?? DEFAULT_TREELESS_JITTER_MS,
					env,
					note,
				});
				if (!(await publishedToMain(dir, arbiter, env))) {
					return {
						exitCode: 1,
						outcome: 'publish-failed',
						item,
						message: `${exec.message} The result did not reach ${arbiter}/main.`,
						rungOutcome: exec.outcome,
					};
				}
			}
			return {
				exitCode: 0,
				outcome: 'applied',
				item,
				message: exec.message,
				rungOutcome: exec.outcome,
			};
		},
	);

	// The release, leased on `lockSha`, AFTER the publish: the lock covers the
	// write. It runs whatever happened above, so a refused or failed publish
	// leaves the item for the next tick rather than locked.
	const released = await releaseLockLeased({
		cwd,
		arbiter,
		item,
		expectedSha: held.lockSha,
		env,
	});
	note(released.message);
	if (!released.released) {
		return {
			...result,
			exitCode: result.exitCode === 0 ? 1 : result.exitCode,
			message: `${result.message} (${released.message})`,
		};
	}
	return result;
}

/**
 * Surface the item to needs-attention (decision 5, and a rejected handoff): a
 * `kind: stuck` question in its sidecar and `needsAnswers: true` on `main`, then
 * the lock released (leased). Nothing from the agent job is read or written.
 */
async function surfaceItem(
	ctx: ApplyContext,
	reason: string,
	outcome: 'surfaced' | 'rejected',
): Promise<TreelessPhaseResult> {
	const {resolved, arbiter, cwd, env, note} = ctx;
	const {item} = resolved;
	const r = await surfaceStuckToNeedsAttention({
		cwd,
		slug: resolved.slug,
		item,
		reason,
		arbiter,
		env,
		note,
	});
	const message = r.surfaced
		? `Surfaced '${item}' to needs-attention: ${reason}`
		: `Could not surface '${item}' (${r.reasonNotSurfaced ?? 'unknown'}): ${reason}`;
	if (!r.surfaced) {
		return {exitCode: 1, outcome: 'surface-unmoved', item, message};
	}
	// A clean surface is green, a rejected handoff's included ("A handled
	// outcome is green", `ci-phase-driver.ts`).
	return {
		exitCode: 0,
		outcome,
		item,
		message,
	};
}

// ---------------------------------------------------------------------------
// routing `advance <item> --phase`
// ---------------------------------------------------------------------------

/** Which split path an `advance <item> --phase` run belongs to. */
export type AdvancePhasePath = 'build' | 'tasking' | 'treeless';

function pathForRung(rung: string | undefined): AdvancePhasePath | undefined {
	if (rung === 'build-task') return 'build';
	if (rung === 'task-spec') return 'tasking';
	if (isTreelessPhaseRung(rung)) return 'treeless';
	return undefined;
}

/**
 * Route `advance <item> --phase` to its split path. The agent and apply phases
 * follow the lock job's trusted `rung` output. The lock phase classifies the
 * item at the arbiter's `main` (read-only; the chosen path's lock phase fetches
 * and classifies again, and refuses a rung it does not split). Anything that
 * does not classify (a pending sidecar, an unreadable argument, no lock
 * outputs) falls back to the argument's namespace, so the path's own lock or
 * usage report runs: `spec:` is tasking, `obs:` is tree-less, anything else is
 * the build path.
 */
export async function advancePhasePath(params: {
	phase: Phase;
	arg: string;
	cwd: string;
	arbiter?: string;
	env?: NodeJS.ProcessEnv;
	lockOutputs?: LockOutputs;
	read?: LedgerReadStrategy;
}): Promise<AdvancePhasePath> {
	const explicit = parseSlugArg(params.arg).explicit;
	const fallback: AdvancePhasePath =
		explicit === 'spec'
			? 'tasking'
			: explicit === 'observation'
				? 'treeless'
				: 'build';
	const env = params.env ?? process.env;
	if (params.phase !== 'lock') {
		try {
			const facts = params.lockOutputs ?? readLockOutputsFromEnv(env);
			return pathForRung(facts.rung) ?? fallback;
		} catch {
			return fallback;
		}
	}
	try {
		const cwd = params.cwd;
		const baseSha = await fetchArbiterMain({
			cwd,
			arbiter: params.arbiter ?? DEFAULT_ARBITER,
			env,
		});
		const kind = await withBaseWorktree({cwd, baseSha, env}, async (base) => {
			const resolved = resolveAdvanceArg({
				arg: params.arg,
				repoPath: base,
				read: params.read ?? ledgerRead,
			});
			return classifyIn(base, {
				namespace: resolved.namespace,
				slug: resolved.slug,
				item: `${resolved.namespace}:${resolved.slug}`,
			}).kind;
		});
		return pathForRung(kind) ?? fallback;
	} catch {
		return fallback;
	}
}
