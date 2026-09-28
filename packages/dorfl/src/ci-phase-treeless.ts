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
 *    `kind: merge` entry is refused before any write (task
 *    `ci-split-answered-merge-action`).
 *  - **agent** ({@link performTreelessAgentPhase}): check, read-only, that the
 *    lock ref still equals `lockSha`; run the rung body in a worktree of
 *    `baseSha` with the REAL agent seams, each wrapped to capture what the agent
 *    emitted, and every write seam replaced by a stub that writes nothing; hand
 *    over what the agents decided: `surface` (the surface questions), `triage`
 *    (the triage gate's disposition, or `keep` plus the surface questions on
 *    the fall-through) or `apply-decision` (the agentic verdict). Writes nothing
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
 *    handoff does not answer throws.
 */

import type {
	AdvanceContext,
	AdvanceOutcome,
	RungExecInput,
	RungExecResult,
	RungExecutor,
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
import type {AgentJobResult, GithubApiGet} from './ci-agent-result.js';
import {
	HANDOFF_LIMITS,
	HandoffRejected,
	canonicalHandoffItem,
	handoffName as deriveHandoffName,
	type ApplyDecisionProducts,
	type HandoffRecord,
	type SurfaceProducts,
	type TriageProducts,
} from './ci-handoff-format.js';
import {readHandoff, writeHandoff} from './ci-handoff.js';
import {readLockOutputsFromEnv, type LockOutputs} from './ci-lock-outputs.js';
import {
	PhaseDriverError,
	agentTimeoutMinutesAt,
	arbiterLockSha,
	boundHandoffText,
	checkLockOwnership,
	emitLockOutputs,
	fetchArbiterMain,
	noSmudgeEnv,
	releaseLockLeased,
	requireHeldLock,
	resolveAgentResult,
	runnerTempFrom,
	withBaseWorktree,
	type HeldLock,
} from './ci-phase-driver.js';
import type {DecisionVerdict} from './decision-engine.js';
import {harnessApplyDecider, type ApplyDecider} from './apply-decide.js';
import {runAsync} from './git.js';
import {identityEnv, type Identity} from './identity.js';
import {leaseLockReleases} from './item-lock.js';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
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
	type SlugNamespace,
} from './slug-namespace.js';
import {
	harnessSurfaceGate,
	type SurfaceEmit,
	type SurfaceGate,
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
	exitCode: 0 | 1 | 2 | 3;
	outcome: TreelessPhaseOutcome;
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
		| {rung: TreelessPhaseRung; needsAgent: boolean}
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
			const need = treelessAgentNeed(
				rungInput(resolved, classification, {...options, cwd: base}),
			);
			if (need.needsAgent === undefined) {
				throw new PhaseDriverError(
					`--phase does not split ${resolved.item} yet: ${need.unsplit}`,
				);
			}
			return {resolved, rung: kind, needsAgent: need.needsAgent};
		},
	);
	const {item} = verdict.resolved;
	if ('skip' in verdict) {
		note(verdict.skip);
		return {
			exitCode: 0,
			outcome: 'no-op',
			item,
			message: verdict.skip,
			lockOutputs: publish({acquired: false, baseSha}),
		};
	}
	if ('invariant' in verdict) {
		note(verdict.invariant);
		return {
			exitCode: 1,
			outcome: 'invariant-violation',
			item,
			message: verdict.invariant,
			lockOutputs: publish({acquired: false, baseSha}),
		};
	}
	const {rung, needsAgent} = verdict;
	if ((await arbiterLockSha({cwd, arbiter, item, env})) !== undefined) {
		const message = `'${item}' is already locked on ${arbiter}; backing off.`;
		note(message);
		return {
			exitCode: 2,
			outcome: 'lost',
			item,
			message,
			lockOutputs: publish({acquired: false, rung, baseSha}),
		};
	}
	const acquired = await acquireAdvancingLock({
		item,
		cwd,
		arbiter,
		acquireUnified: true,
		env,
		note,
	});
	if (acquired.exitCode !== 0) {
		return {
			exitCode: acquired.exitCode,
			outcome: acquired.outcome === 'usage-error' ? 'usage-error' : 'lost',
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
		mergeAction: async () => {
			throw new Error('the answered merge action is not split into CI phases');
		},
	};
}

/** The surface questions of a captured emit, bounded for the handoff. */
function questionTexts(emit: SurfaceEmit | undefined): string[] {
	return (emit?.questions ?? [])
		.map((q) => boundHandoffText(q.question, HANDOFF_LIMITS.reasonChars))
		.filter((q) => q.trim() !== '');
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
				questions: [
					boundHandoffText(verdict.question ?? '', HANDOFF_LIMITS.reasonChars),
				],
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
}): Promise<HandoffRecord> {
	const {options, rung, resolved, dir} = params;
	const {item} = resolved;
	const captured: Captured = {surfacePersisted: false, autoDisposed: false};
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
	if (exec.exitCode !== 0) {
		throw new Error(`the ${rung} rung failed: ${exec.message}`);
	}
	const nothing = (): never => {
		throw new Error(
			`the ${rung} rung of ${item} reached nothing to hand over (${exec.outcome}: ${exec.message})`,
		);
	};
	switch (rung) {
		case 'surface':
			if (!captured.surfacePersisted) nothing();
			return {
				schema: 1,
				item,
				intent: {kind: 'surface'},
				products: {
					questions: questionTexts(captured.surface),
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
					questions: questionTexts(captured.surface),
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
		note(ownership.message);
		return {
			exitCode: 1,
			outcome: 'stale-lock',
			item,
			message: ownership.message,
		};
	}

	let record: HandoffRecord;
	try {
		// A read-only fetch, so the lock job's base is in this checkout.
		await fetchArbiterMain({cwd, arbiter, env});
		record = await withBaseWorktree(
			{cwd, baseSha: held.baseSha, env},
			async (dir) => {
				const outcome = await runAgentPhase(
					createPhaseRecorder({record: []}),
					() => treelessHandover({options, rung: held.rung, resolved, dir}),
				);
				if (outcome.halted) {
					throw new Error(
						`the ${held.rung} rung reached a write (${outcome.intent.seam}.${outcome.intent.method})`,
					);
				}
				return outcome.result;
			},
		);
		writeHandoff({dir: options.handoffDir, rung: held.rung, record});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		note(message);
		return {exitCode: 1, outcome: 'agent-failed', item, message};
	}
	const kind = record.intent.kind;
	const message = `handed over ${kind} for ${item}`;
	note(message);
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
		note(ownership.message);
		return {
			exitCode: 1,
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

/** A gate the apply phase never launches: the handoff did not answer it. */
function noAgent(what: string): never {
	throw new PhaseDriverError(
		`the apply phase launches no agent (${what}); the handoff does not answer it`,
	);
}

/** Replay the checked handoff's surface questions as the surface gate's emit. */
function replaySurface(questions: string[] | undefined): SurfaceGate {
	return async () => ({
		questions: (questions ?? []).map((question) => ({question})),
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
				return {
					outcome: 'ask',
					question: (p.questions ?? [])
						.map((q) => q.trim())
						.filter((q) => q !== '')
						.join('\n\n'),
				};
		}
	};
}

type AgentSeams = Pick<
	AdvanceContext,
	'surfaceGate' | 'triageGate' | 'applyDecide'
>;

/**
 * The agent seams of the apply phase: replays of the checked handoff, and a
 * throwing gate for every seam the handoff does not answer (all of them when
 * the rung runs deterministically).
 */
function replayGates(record: HandoffRecord | undefined): AgentSeams {
	const gates: AgentSeams = {
		surfaceGate: async () => noAgent('the surface-questions agent'),
		triageGate: async () => noAgent('the triage gate'),
		applyDecide: async () => noAgent('the apply decision agent'),
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
): Promise<TreelessPhaseResult> {
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
				...replayGates(record),
			});
			const need =
				classification.kind === held.rung
					? treelessAgentNeed(input)
					: undefined;
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
					message: `${item} ${what} on ${arbiter}/main (${tip}); nothing was written`,
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
	note(message);
	if (!r.surfaced) {
		return {exitCode: 1, outcome: 'surface-unmoved', item, message};
	}
	return {
		exitCode: outcome === 'rejected' ? 1 : 0,
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
