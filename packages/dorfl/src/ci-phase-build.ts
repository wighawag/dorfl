/**
 * **The build path split into the three CI phases** (spec
 * `ci-agent-job-without-write-token` §3 build row and §8, ADR
 * `ci-agent-job-holds-no-write-token`, tasks `ci-split-build-path` and
 * `ci-split-build-path-non-integrate-intents`).
 *
 * `advance task:<slug>` / `do <slug>` with `--phase` run ONE of three halves of
 * the one build pipeline (`performDo`), never a second implementation:
 *
 *  - **lock** ({@link performBuildLockPhase}): fetch `<arbiter>/main` (its tip
 *    is `baseSha`, and the tree the item is classified in, never the run's
 *    commit); claim (`acquireItemLock`, `action: implement`); publish
 *    `acquired`, `needsAgent`, `rung`, `baseSha`, `lockSha`, `continueTip`,
 *    `handoffName` (it carries `github.run_attempt`, so a "Re-run all jobs"
 *    attempt never collides with an earlier attempt's artifact) and
 *    `agentTimeoutMinutes` (from the config at `baseSha`). An item that is not
 *    claimable at `baseSha` (it already advanced, or its lock is held) is a
 *    no-op that writes nothing.
 *  - **agent** ({@link performBuildAgentPhase}): check, read-only, that the lock
 *    ref still equals `lockSha`, then run `performDo` without its claim under
 *    the phase recorder: the continue rebase (LOCAL only, decision 7), the
 *    build agent, the STOP and deadline detection, the gate, the Gate-2 review,
 *    the done-move commit, the local rebase and the fresh-worktree gate run
 *    exactly as today, and the pipeline halts at its first write, which names
 *    the intent handed over ({@link handOverHalt}):
 *      - the land half (`integrationLand.land`): `integrate`, with the
 *        work-branch bundle, the PR title and body and the Gate-2 review prose;
 *      - a needs-attention bounce (red gate, blocked review, rebase conflict):
 *        `needs-attention`, the wip committed locally and bundled;
 *      - the deadline checkpoint's branch save: `deadline-checkpoint`, the
 *        checkpoint commit bundled;
 *      - the agent's deliberate STOP: `stop`; an agent failure: `agent-failed`
 *        (both with the wip bundled, when there is any).
 *  - **apply** ({@link performBuildApplyPhase}): refuse to write unless the
 *    lock ref still equals `lockSha` (so a "Re-run failed jobs" of a finished
 *    run writes nothing); act on the agent job's result first (task
 *    `ci-split-agent-result-and-reruns`): anything but `success` never reads
 *    the handoff, and surfaces the item (failure, timeout, an unexpected skip)
 *    or only releases the lock (a real cancel); validate the handoff as hostile
 *    (`validateApplyHandoff`); push the handoff's Git LFS objects before any
 *    ref, for every intent (decision 6, `pushLfsObjects`); when the lock job saw a kept branch, push the
 *    bundle's tip with a lease on that `continueTip` first (decision 7; a
 *    stale lease writes nothing); then resume at the write half of the intent:
 *    the land half (`landIntegration`, the unchanged compare-and-swap loop, then
 *    the review comment), the needs-attention route, `routeDeadlineCheckpoint`
 *    (with `maxAutoCheckpoints` from the config at `baseSha`),
 *    `saveAgentStop` or `saveAgentFailure`. Every lock release in the apply
 *    phase is leased on `lockSha` (`leaseLockReleases`), and the lock is
 *    released once the work is durably on `main` (a propose PR keeps it held,
 *    exactly as `complete` does today).
 */

import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {classifyTick} from './advance-classify.js';
import {readItemSignals} from './advance.js';
import {
	HANDOFF_LIMITS,
	HandoffRejected,
	handoffName as deriveHandoffName,
	type AgentFailedProducts,
	type HandoffRecord,
	type NeedsAttentionProducts,
	type StopProducts,
} from './ci-handoff-format.js';
import {writeHandoff} from './ci-handoff.js';
import {validateApplyHandoff} from './ci-handoff-apply.js';
import type {LockOutputs} from './ci-lock-outputs.js';
import type {AgentJobResult, GithubApiGet} from './ci-agent-result.js';
import {
	PhaseDriverError,
	agentTimeoutMinutesAt,
	arbiterLockSha,
	arbiterRefSha,
	boundHandoffText,
	checkLockOwnership,
	emitLockOutputs,
	fetchArbiterMain,
	noSmudgeEnv,
	pushHandoffLfs,
	releaseLockLeased,
	repoConfigAt,
	requireHeldLock,
	resolveAgentResult,
	runnerTempFrom,
	taskSourceAtBase,
	withBaseWorktree,
	type HeldLock,
} from './ci-phase-driver.js';
import {performClaim} from './claim-cas.js';
import {
	deadlineSurfaceReason,
	performDo,
	routeDeadlineCheckpoint,
	saveAgentFailure,
	saveAgentStop,
	type BuildBoundary,
	type DoOptions,
	type DoResult,
} from './do.js';
import {
	checkGatePreconditions,
	detectLockfileOnDisk,
} from './gate-readiness.js';
import {run, runAsync} from './git.js';
import {selectProvider} from './github.js';
import {identityEnv} from './identity.js';
import {leaseLockReleases} from './item-lock.js';
import {
	arbiterUrl,
	integrationLand,
	type IntegrationCoreResult,
	type IntegrationLandInput,
} from './integration-core.js';
import {proposeRequestNotOpened} from './integrator.js';
import {ledgerRead} from './ledger-read.js';
import {ledgerWrite} from './ledger-write.js';
import {
	commitAbortedWork,
	type RouteToNeedsAttentionOptions,
} from './needs-attention.js';
import {refWrite} from './ref-write.js';
import type {Phase} from './phase.js';
import {
	createPhaseRecorder,
	recordingReviewProvider,
	runAgentPhase,
	type RecordedWriteIntent,
	type WriteSeamCall,
} from './phase-recorder.js';
import {
	SlugResolutionError,
	resolveAdvanceArg,
	resolveSlug,
	workBranchRef,
} from './slug-namespace.js';
import {workItemRel} from './work-layout.js';

const DEFAULT_ARBITER = 'origin';

/** The verb a build phase runs under (they classify the argument differently). */
export type BuildPhaseVerb = 'do' | 'advance';

/** Options of a build phase run: the `do` pipeline's options plus the phase inputs. */
export interface BuildPhaseOptions extends DoOptions {
	/** Which of the three jobs this process is. */
	phase: Phase;
	/** `do <slug>` or `advance task:<slug>`. */
	verb: BuildPhaseVerb;
	/**
	 * The handoff directory: the agent phase writes the artifact here (it must be
	 * empty or absent); the apply phase reads it (it must be under
	 * {@link runnerTemp}).
	 */
	handoffDir?: string;
	/** `$RUNNER_TEMP` (the apply phase); defaults to the env's. */
	runnerTemp?: string;
	/** The lock job's outputs (agent / apply); defaults to `DORFL_LOCK_OUTPUTS`. */
	lockOutputs?: LockOutputs;
	/** `github.run_attempt` (the lock phase names the artifact with it); default the env's, else 1. */
	runAttempt?: string;
	/** The `$GITHUB_OUTPUT` file the lock phase appends to; default the env's. */
	githubOutput?: string;
	/** The merge-mode CAS-loop jitter (tests pass 0). */
	mergeJitterMs?: number;
	/**
	 * apply: `needs.agent.result` (`--agent-result`), REQUIRED. Only `success`
	 * reads the handoff (decision 5, task `ci-split-agent-result-and-reruns`).
	 */
	agentResult?: AgentJobResult;
	/**
	 * apply: the agent job's timeout (`--agent-timeout-minutes`, the trusted
	 * lock output); defaults to the lock outputs' `agentTimeoutMinutes`.
	 */
	agentTimeoutMinutes?: number;
	/** apply: the Actions API reader (tests stub it); default `fetch` with `GITHUB_TOKEN`. */
	actionsApi?: GithubApiGet;
}

/** How a build phase run ended. */
export type BuildPhaseOutcome =
	/** lock: the item is claimed; the agent phase runs next. */
	| 'locked'
	/** lock: nothing to do at the arbiter's `main` (not claimable, or not a build). */
	| 'no-op'
	/** lock: another run holds the item's lock. */
	| 'lost'
	/** agent / apply: the lock ref no longer equals `lockSha`; nothing was done. */
	| 'stale-lock'
	/** agent: the handoff was written (see `intent`). */
	| 'handed-over'
	/** apply: the work landed on `main` and the lock was released. */
	| 'landed'
	/** apply: the branch was pushed (and a PR requested); the lock stays held. */
	| 'proposed'
	/** apply: the item was surfaced to needs-attention. */
	| 'surfaced'
	/** apply: surfacing the item did not land on the arbiter (it stays locked). */
	| 'surface-unmoved'
	/** apply: a deadline checkpoint was saved and the lock released to continue. */
	| 'auto-continued'
	/** apply: the agent job was cancelled (not timed out); the lock was only released. */
	| 'released'
	/** apply: the cancelled agent job's leased lock release was refused. */
	| 'release-refused'
	/**
	 * apply: the kept work branch moved on the arbiter since the lock job saw it
	 * (`continueTip`), so the leased continue push was refused; nothing was written.
	 */
	| 'stale-lease'
	/** apply: the handoff broke a rule; nothing from it was written. */
	| 'rejected'
	/** A usage or environment problem, or a path this task does not split yet. */
	| 'usage-error';

/** The result of one build phase run. */
export interface BuildPhaseResult {
	exitCode: 0 | 1 | 2 | 3;
	outcome: BuildPhaseOutcome;
	/**
	 * The result line: the CLI prints it (`>> ` or `error: `), so the phase does
	 * NOT also `note` it (each line appears once in the job log).
	 */
	message: string;
	slug?: string;
	/** lock: the facts published. */
	lockOutputs?: LockOutputs;
	/** agent: the handed-over intent kind. */
	intent?: HandoffRecord['intent']['kind'];
	/** apply: the land half's result, when it ran. */
	land?: IntegrationCoreResult;
}

/**
 * Run one phase of the build path. The CLI calls this for `do <slug> --phase`
 * and `advance task:<slug> --phase`.
 */
export async function performBuildPhase(
	options: BuildPhaseOptions,
): Promise<BuildPhaseResult> {
	try {
		switch (options.phase) {
			case 'lock':
				return await performBuildLockPhase(options);
			case 'agent':
				return await performBuildAgentPhase(options);
			case 'apply':
				return await performBuildApplyPhase(options);
		}
	} catch (err) {
		if (err instanceof PhaseDriverError || err instanceof SlugResolutionError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------

/** The task slug a build phase acts on, from the (trusted) workflow argument. */
function buildSlug(options: BuildPhaseOptions, repoPath: string): string {
	if (options.verb === 'advance') {
		const resolved = resolveAdvanceArg({
			arg: options.arg,
			repoPath,
			read: options.read ?? ledgerRead,
		});
		if (resolved.namespace !== 'task') {
			throw new PhaseDriverError(
				`--phase splits only the build path so far; ${options.arg} is not a task`,
			);
		}
		return resolved.slug;
	}
	const resolved = resolveSlug({
		arg: options.arg,
		repoPath,
		read: options.read ?? ledgerRead,
	});
	if (resolved.namespace !== 'task') {
		throw new PhaseDriverError(
			`--phase splits only the build path so far; ${options.arg} is not a task`,
		);
	}
	return resolved.slug;
}

/**
 * The lock phase: classify the item at the arbiter's `main`, claim it and
 * publish the trusted facts. Runs no agent and no repository code. An item that
 * already advanced (not claimable at `baseSha`), or whose lock another run
 * holds, is refused BEFORE any write.
 */
export async function performBuildLockPhase(
	options: BuildPhaseOptions,
): Promise<BuildPhaseResult> {
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
	const verdict = await withBaseWorktree(
		{cwd, baseSha, env},
		async (base): Promise<{slug: string; skip?: string}> => {
			const slug = buildSlug(options, base);
			if (options.verb === 'advance') {
				const item = `task:${slug}`;
				const signals = readItemSignals({
					repoPath: base,
					type: 'task',
					slug,
					item,
				});
				const kind = classifyTick({type: 'task', ...signals}).kind;
				if (kind !== 'build-task') {
					if (kind === 'no-op') {
						return {slug, skip: `no-op for ${item} at ${baseSha}`};
					}
					throw new PhaseDriverError(
						`--phase splits only the build path so far; ${item} classifies ` +
							`as ${kind} at ${baseSha}`,
					);
				}
			}
			const folders =
				options.allowBacklog === true
					? (['tasks-ready', 'tasks-backlog'] as const)
					: (['tasks-ready'] as const);
			const claimable = folders.some((f) =>
				existsSync(join(base, workItemRel(f, `${slug}.md`))),
			);
			if (!claimable) {
				return {
					slug,
					skip:
						`'${slug}' is not claimable at ${arbiter}/main (${baseSha}): it ` +
						'already advanced, or was removed',
				};
			}
			const guard = checkGatePreconditions({
				freshWorktreeGate: options.freshWorktreeGate,
				prepare: options.prepare,
				verify: options.verify,
				lockfile: detectLockfileOnDisk(base),
			});
			if (guard !== undefined) throw new PhaseDriverError(guard.message);
			return {slug};
		},
	);
	const slug = verdict.slug;
	const item = `task:${slug}`;
	if (verdict.skip !== undefined) {
		return {
			exitCode: 0,
			outcome: 'no-op',
			slug,
			message: verdict.skip,
			lockOutputs: publish({acquired: false, baseSha}),
		};
	}
	if ((await arbiterLockSha({cwd, arbiter, item, env})) !== undefined) {
		const message = `'${slug}' is already locked on ${arbiter}; backing off.`;
		return {
			exitCode: 2,
			outcome: 'lost',
			slug,
			message,
			lockOutputs: publish({acquired: false, rung: 'build-task', baseSha}),
		};
	}

	const claim = await performClaim({
		slug,
		cwd,
		arbiter,
		allowBacklog: options.allowBacklog === true,
		env,
		note,
	});
	if (claim.exitCode !== 0) {
		const outcome = claim.outcome === 'lost' ? 'lost' : 'usage-error';
		return {
			exitCode: claim.exitCode,
			outcome,
			slug,
			message: claim.message,
			lockOutputs: publish({acquired: false, rung: 'build-task', baseSha}),
		};
	}
	const lockSha = await arbiterLockSha({cwd, arbiter, item, env});
	if (lockSha === undefined) {
		throw new Error(`the lock of ${item} vanished right after the claim`);
	}
	const continueTip = await arbiterRefSha({
		cwd,
		arbiter,
		ref: `refs/heads/${workBranchRef('task', slug)}`,
		env,
	});
	const facts = publish({
		acquired: true,
		needsAgent: true,
		rung: 'build-task',
		baseSha,
		lockSha,
		continueTip,
		handoffName: deriveHandoffName(
			item,
			options.runAttempt ?? env.GITHUB_RUN_ATTEMPT ?? '1',
		),
		agentTimeoutMinutes: agentTimeoutMinutesAt(cwd, baseSha, env),
	});
	return {
		exitCode: 0,
		outcome: 'locked',
		slug,
		message: `locked ${item} at ${baseSha} (lock ${lockSha})`,
		lockOutputs: facts,
	};
}

// ---------------------------------------------------------------------------
// agent
// ---------------------------------------------------------------------------

/** Every write seam call the build pipeline can reach (all are recorded). */
function buildRecordableCalls(): WriteSeamCall[] {
	return [
		'integrationLand.land',
		...Object.keys(ledgerWrite).map((m) => `ledgerWrite.${m}` as const),
		...Object.keys(refWrite).map((m) => `refWrite.${m}` as const),
		'reviewProvider.openRequest',
		'reviewProvider.postPRComment',
		'reviewProvider.postPRCommentOnBranch',
		'reviewProvider.closeRequestOnBranch',
	];
}

/** The `agent-failed` detail for a halt at a write the build path does not carry. */
function haltDetail(intent: RecordedWriteIntent): string {
	const input = intent.input as {reason?: unknown} | undefined;
	const reason =
		input !== null &&
		typeof input === 'object' &&
		typeof input.reason === 'string'
			? `: ${input.reason}`
			: '';
	return (
		`the build stopped at ${intent.seam}.${intent.method}${reason} ` +
		'(this outcome is not carried through the CI phases)'
	);
}

/** What the agent phase writes: the record, and the work branch to bundle. */
interface Handover {
	record: HandoffRecord;
	bundle?: {repo: string; workBranch: string; baseSha: string};
}

/** The context {@link handOverHalt} maps a halt in. */
interface HaltContext {
	item: string;
	slug: string;
	arbiter: string;
	baseSha: string;
	env: NodeJS.ProcessEnv;
}

/**
 * The work branch to bundle as the WIP of a non-integrate intent, or
 * `undefined` when it carries nothing to recover: the checkout is not on the
 * item's work branch, or the branch has no commit that `<arbiter>/main` lacks
 * (the apply phase refuses a bundle without a new commit).
 */
function wipBundle(
	cwd: string,
	ctx: HaltContext,
): Handover['bundle'] | undefined {
	const workBranch = workBranchRef('task', ctx.slug);
	const head = run('git', ['symbolic-ref', '--quiet', 'HEAD'], cwd, {
		env: ctx.env,
	});
	if (head.status !== 0 || head.stdout.trim() !== `refs/heads/${workBranch}`) {
		return undefined;
	}
	const ahead = run(
		'git',
		[
			'rev-list',
			'--count',
			`refs/heads/${workBranch}`,
			`^refs/remotes/${ctx.arbiter}/main`,
			`^${ctx.baseSha}`,
		],
		cwd,
		{env: ctx.env},
	);
	if (ahead.status !== 0 || Number(ahead.stdout.trim()) === 0) {
		return undefined;
	}
	return {repo: cwd, workBranch, baseSha: ctx.baseSha};
}

/** A bounded reason (or question) for the handoff record. */
function reasonText(text: string): string {
	return boundHandoffText(text, HANDOFF_LIMITS.reasonChars);
}

/** The `needs-attention` handover of a bounce's recorded input. */
function needsAttention(
	ctx: HaltContext,
	input: {reason: string; questions?: string[]},
	bundle: Handover['bundle'] | undefined,
): Handover {
	return {
		record: {
			schema: 1,
			item: ctx.item,
			intent: {kind: 'needs-attention'},
			products: {
				reason: reasonText(input.reason),
				...(input.questions === undefined || input.questions.length === 0
					? {}
					: {questions: input.questions.map(reasonText)}),
			},
		},
		bundle,
	};
}

/**
 * Map the build's FIRST WRITE (the recorded halt) to the handoff (task
 * `ci-split-build-path-non-integrate-intents`). The seam call names the write;
 * the pipeline's {@link BuildBoundary} annotation names the outcome when several
 * share one seam call. A bounce's LOCAL half (the wip commit, which the seam
 * would have made before pushing) runs here, so the wip travels in the bundle.
 */
function handOverHalt(intent: RecordedWriteIntent, ctx: HaltContext): Handover {
	const call = `${intent.seam}.${intent.method}`;
	const boundary = intent.annotation as BuildBoundary | undefined;

	if (call === 'integrationLand.land') {
		const land = intent.input as IntegrationLandInput;
		if (land.branch !== workBranchRef('task', ctx.slug)) {
			throw new Error(
				`the land half names the branch ${land.branch}, not ` +
					workBranchRef('task', ctx.slug),
			);
		}
		const limit = HANDOFF_LIMITS.commentChars;
		return {
			record: {
				schema: 1,
				item: ctx.item,
				intent: {kind: 'integrate'},
				products: {
					prTitle: land.title,
					prBody: boundHandoffText(land.body ?? '', limit),
					...(land.reviewProse === undefined
						? {}
						: {reviewProse: boundHandoffText(land.reviewProse, limit)}),
				},
			},
			bundle: {repo: land.cwd, workBranch: land.branch, baseSha: ctx.baseSha},
		};
	}

	// The deadline checkpoint: its marker commit is already made (locally) when
	// the branch save is recorded.
	if (
		call === 'refWrite.saveWorkBranch' &&
		boundary?.kind === 'deadline-checkpoint'
	) {
		const input = intent.input as RouteToNeedsAttentionOptions;
		commitAbortedWork({cwd: input.cwd, slug: ctx.slug, env: ctx.env});
		const bundle = wipBundle(input.cwd, ctx);
		if (!boundary.predecessorGone) {
			const reason = deadlineSurfaceReason({
				slug: ctx.slug,
				kind: 'unreaped',
				detail: boundary.reapDetail,
			});
			return needsAttention(ctx, {reason}, bundle);
		}
		if (bundle === undefined) {
			// Nothing on the branch: no progress, so today's route surfaces.
			const reason = deadlineSurfaceReason({
				slug: ctx.slug,
				kind: 'no-progress',
			});
			return needsAttention(ctx, {reason}, undefined);
		}
		return {
			record: {
				schema: 1,
				item: ctx.item,
				intent: {kind: 'deadline-checkpoint'},
				products: {},
			},
			bundle,
		};
	}

	// The empty-diff STOP surfaces a question on main without a branch save.
	if (boundary?.kind === 'stop' && boundary.stopKind === 'empty-diff') {
		return {
			record: {
				schema: 1,
				item: ctx.item,
				intent: {kind: 'stop'},
				products: {
					reason: reasonText(boundary.reason),
					stopKind: 'empty-diff',
				},
			},
		};
	}

	if (call === 'ledgerWrite.applyNeedsAttentionTransition') {
		const input = intent.input as RouteToNeedsAttentionOptions;
		commitAbortedWork({cwd: input.cwd, slug: ctx.slug, env: ctx.env});
		const bundle =
			input.pushBranch === false ? undefined : wipBundle(input.cwd, ctx);
		if (boundary?.kind === 'agent-failed') {
			return {record: agentFailed(ctx.item, boundary.failureDetail), bundle};
		}
		if (boundary?.kind === 'stop') {
			return {
				record: {
					schema: 1,
					item: ctx.item,
					intent: {kind: 'stop'},
					products: {
						reason: reasonText(boundary.reason),
						stopKind: boundary.stopKind,
					},
				},
				bundle,
			};
		}
		return needsAttention(ctx, input, bundle);
	}

	// A tree-less surface (the continue rebase conflicted at onboarding): the
	// kept branch is untouched on the arbiter, so nothing is bundled.
	if (call === 'ledgerWrite.applyTreelessNeedsAttentionTransition') {
		const input = intent.input as {reason: string; questions?: string[]};
		return needsAttention(ctx, input, undefined);
	}

	return {record: agentFailed(ctx.item, haltDetail(intent))};
}

/**
 * The agent phase: after a read-only lock-ownership check, run the build
 * pipeline (`performDo`, without its claim) under the phase recorder, halt at
 * the first write, and write the handoff. Holds a read-only token: it never
 * writes to the arbiter.
 */
export async function performBuildAgentPhase(
	options: BuildPhaseOptions,
): Promise<BuildPhaseResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env ?? process.env;
	const held = requireHeldLock({
		lockOutputs: options.lockOutputs,
		env,
		rung: 'build-task',
	});
	if (options.handoffDir === undefined) {
		throw new PhaseDriverError('the agent phase needs a handoff directory');
	}
	const slug = buildSlug(options, options.repoPath ?? cwd);
	const item = `task:${slug}`;

	const ownership = await checkLockOwnership({
		cwd,
		arbiter,
		item,
		lockSha: held.lockSha,
		env,
	});
	if (!ownership.owned) {
		return {
			exitCode: 1,
			outcome: 'stale-lock',
			slug,
			message: ownership.message,
		};
	}

	const recorder = createPhaseRecorder({record: buildRecordableCalls()});
	const ctx: HaltContext = {item, slug, arbiter, baseSha: held.baseSha, env};
	let handover: Handover;
	try {
		// EVERY review provider the pipeline can reach records (never only an
		// injected one): without an injected instance, resolve the one the
		// integration core would select from the arbiter URL, and wrap it.
		const provider =
			options.providerInstance ??
			selectProvider({arbiterUrl: await arbiterUrl(cwd, arbiter, env)});
		const outcome = await runAgentPhase(recorder, () =>
			performDo({
				...options,
				phase: 'agent',
				providerInstance: recordingReviewProvider(provider, recorder),
			}),
		);
		handover = outcome.halted
			? handOverHalt(outcome.intent, ctx)
			: {
					record: agentFailed(
						item,
						`the build ended without reaching a write: ${outcome.result.message}`,
					),
				};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		handover = {record: agentFailed(item, `the build failed: ${message}`)};
	}

	const written = writeHandoff({
		dir: options.handoffDir,
		rung: 'build-task',
		record: handover.record,
		bundle: handover.bundle,
	});
	if (written.lfsMissing.length > 0) {
		note(
			`the local LFS store lacks ${written.lfsMissing.length} object(s) a new ` +
				`commit points at (${written.lfsMissing.slice(0, 5).join(', ')}); the ` +
				'apply job will reject the handoff',
		);
	}
	const kind = handover.record.intent.kind;
	const message = `handed over ${kind} for ${item}`;
	return {
		exitCode: 0,
		outcome: 'handed-over',
		slug,
		message,
		intent: kind,
	};
}

function agentFailed(item: string, detail: string): HandoffRecord {
	return {
		schema: 1,
		item,
		intent: {kind: 'agent-failed'},
		products: {
			failureDetail: boundHandoffText(detail, HANDOFF_LIMITS.reasonChars),
		},
	};
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/** Surface the item to needs-attention (tree-less) with `reason`. */
async function surface(params: {
	cwd: string;
	arbiter: string;
	slug: string;
	reason: string;
	env: NodeJS.ProcessEnv;
	note: (message: string) => void;
	outcome: BuildPhaseOutcome;
}): Promise<BuildPhaseResult> {
	const surfaced = await ledgerWrite.applyTreelessNeedsAttentionTransition({
		cwd: params.cwd,
		slug: params.slug,
		reason: params.reason,
		arbiter: params.arbiter,
		env: params.env,
		note: params.note,
	});
	const where = surfaced.moved
		? 'surfaced it to needs-attention'
		: `could not surface it (${surfaced.reasonNotMoved ?? 'unknown'})`;
	return {
		exitCode: 1,
		outcome: params.outcome,
		slug: params.slug,
		message: `${params.reason}; ${where}.`,
	};
}

/**
 * The apply phase: check the lock is still this run's, validate the handoff as
 * hostile, then resume the build at the intent's write half. Runs no agent and
 * no repository code; every write goes through dorfl's seams.
 */
export async function performBuildApplyPhase(
	options: BuildPhaseOptions,
): Promise<BuildPhaseResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = noSmudgeEnv(
		identityEnv(options.identity, options.env ?? process.env),
	);
	const held: HeldLock = requireHeldLock({
		lockOutputs: options.lockOutputs,
		env,
		rung: 'build-task',
	});
	if (options.agentResult === undefined) {
		throw new PhaseDriverError(
			'the apply phase needs the agent job result (--agent-result, ' +
				'needs.agent.result): only success reads the handoff',
		);
	}
	const agentResult = options.agentResult;
	const slug = buildSlug(options, options.repoPath ?? cwd);
	const item = `task:${slug}`;

	// Lock ownership BEFORE the first write (spec §8): a lock that was released,
	// reaped or re-taken since the lock job ran means this run writes nothing.
	// This is also what makes a "Re-run failed jobs" of a finished run safe: it
	// replays the old lock outputs and artifact, but the first apply already
	// released or surfaced the item, so the lock is gone and nothing is written.
	const ownership = await checkLockOwnership({
		cwd,
		arbiter,
		item,
		lockSha: held.lockSha,
		env,
	});
	if (!ownership.owned) {
		return {
			exitCode: 1,
			outcome: 'stale-lock',
			slug,
			message: ownership.message,
		};
	}

	// Every lock release from here on (the land's, the surface's, the
	// return-to-backlog's) is leased on the sha this run owns: none of them may
	// delete a lock another run took since the ownership check.
	const restoreLease = leaseLockReleases(item, held.lockSha);
	try {
		const ctx: ApplyContext = {options, held, slug, item, arbiter, cwd, env};
		// The agent job's result (decision 5) BEFORE any artifact is read: only
		// `success` reads it; the build path has no agent-less rung, so a
		// `skipped` agent job is never the deterministic case here.
		const decision = await resolveAgentResult({
			result: agentResult,
			held,
			agentTimeoutMinutes: options.agentTimeoutMinutes,
			api: options.actionsApi,
			env,
		});
		switch (decision.action) {
			case 'read-handoff':
				return await applyOwned(ctx);
			case 'deterministic':
				return await surfaceAgentResult(
					ctx,
					'the agent job was skipped (needsAgent: false), but the build ' +
						'path has no rung that runs without an agent; the handoff was not read',
				);
			case 'surface':
				return await surfaceAgentResult(ctx, decision.reason);
			case 'release':
				return await releaseAfterCancel(ctx, decision.reason);
		}
	} finally {
		restoreLease();
	}
}

/** What {@link applyOwned} works with (the apply phase, past the ownership check). */
interface ApplyContext {
	options: BuildPhaseOptions;
	held: HeldLock;
	slug: string;
	item: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

/**
 * The apply phase once the lock is known to be this run's: validate the
 * handoff, publish a continued branch with its lease, then resume at the
 * intent's write half.
 */
async function applyOwned(ctx: ApplyContext): Promise<BuildPhaseResult> {
	const {options, held, slug, item, arbiter, cwd, env} = ctx;
	const note = options.note ?? (() => {});

	let validated;
	try {
		if (options.handoffDir === undefined) {
			throw new HandoffRejected('layout', 'no handoff directory was given');
		}
		validated = validateApplyHandoff({
			dir: options.handoffDir,
			runnerTemp: runnerTempFrom(options.runnerTemp, env),
			repo: cwd,
			trust: {
				item,
				rung: 'build-task',
				baseSha: held.baseSha,
				arbiter,
				integrationMode: options.integration ?? 'propose',
			},
			env,
		});
	} catch (err) {
		if (!(err instanceof HandoffRejected)) throw err;
		note(err.message);
		return surface({
			cwd,
			arbiter,
			slug,
			reason: err.message,
			env,
			note,
			outcome: 'rejected',
		});
	}

	const record = validated.handoff.record;
	const bundle = validated.bundle;

	// The LFS objects go FIRST (decision 6), before any ref of any intent (the
	// continue push, the land's pushes, a WIP branch save), so a ref never lands
	// pointing at a missing object.
	const lfs = await pushHandoffLfs({
		cwd,
		arbiter,
		objects: validated.lfsObjects,
		env,
		note,
	});
	if (!lfs.ok) {
		return surface({
			cwd,
			arbiter,
			slug,
			reason: lfs.reason,
			env,
			note,
			outcome: lfs.rejected ? 'rejected' : 'surfaced',
		});
	}

	if (bundle !== undefined) {
		await gitHard(
			['checkout', '--quiet', '-B', bundle.workBranch, bundle.tip],
			cwd,
			env,
		);
		// The CONTINUE push (decision 7): the agent job rebased the kept branch
		// locally; publish it with a lease on the tip the LOCK job observed, before
		// any other write. A branch that moved since then refuses the push, and
		// this run writes nothing at all.
		if (held.continueTip !== undefined) {
			const pushed = await refWrite.pushLeasedWorkBranch({
				arbiter,
				branch: bundle.workBranch,
				commit: bundle.tip,
				expectedTip: held.continueTip,
				cwd,
				env,
			});
			if (pushed.status !== 0) {
				const message =
					`${bundle.workBranch} on ${arbiter} moved since the lock job saw it ` +
					`at ${held.continueTip}, so the leased push of the continued branch ` +
					`was refused (${pushed.stderr.trim()}). Nothing was written and the ` +
					`lock of ${item} is still held: inspect the branch, then \`dorfl ` +
					`requeue ${slug}\` to retry the item.`;
				return {exitCode: 1, outcome: 'stale-lease', slug, message};
			}
		}
	}

	const pushBranch = bundle !== undefined;
	const branch = workBranchRef('task', slug);
	switch (record.intent.kind) {
		case 'integrate':
			return applyIntegrate(ctx, validated);
		case 'needs-attention': {
			const {reason, questions} = record.products as NeedsAttentionProducts;
			const routed = pushBranch
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
				? `Surfaced '${slug}' to needs-attention: ${reason}`
				: `Could not surface '${slug}' (${routed.reasonNotMoved ?? 'unknown'}): ${reason}`;
			return {
				exitCode: routed.moved ? 0 : 1,
				outcome: routed.moved ? 'surfaced' : 'surface-unmoved',
				slug,
				message,
			};
		}
		case 'stop': {
			const stop = record.products as StopProducts;
			return fromDoResult(
				await saveAgentStop({
					slug,
					branch,
					cwd,
					arbiter,
					reason: stop.reason,
					kind: stop.stopKind,
					pushBranch,
					env,
					note,
				}),
			);
		}
		case 'agent-failed':
			return fromDoResult(
				await saveAgentFailure({
					slug,
					branch,
					cwd,
					arbiter,
					detail: (record.products as AgentFailedProducts).failureDetail,
					pushBranch,
					env,
					note,
				}),
			);
		case 'deadline-checkpoint':
			return fromDoResult(
				await routeDeadlineCheckpoint({
					slug,
					branch,
					cwd,
					arbiter,
					maxAutoCheckpoints: maxAutoCheckpointsAt(
						cwd,
						held.baseSha,
						options.maxAutoCheckpoints,
						env,
					),
					env,
					note,
				}),
			);
		default:
			return surface({
				cwd,
				arbiter,
				slug,
				reason:
					`the agent job handed over ${record.intent.kind}, which the build ` +
					'path does not carry',
				env,
				note,
				outcome: 'surfaced',
			});
	}
}

/**
 * Surface the item to needs-attention because the agent job did not succeed
 * (decision 5): tree-less (nothing from the agent job is pushed: its artifact is
 * not read), the lock released leased on `lockSha`. A kept work branch stays as
 * it is on the arbiter.
 */
async function surfaceAgentResult(
	ctx: ApplyContext,
	reason: string,
): Promise<BuildPhaseResult> {
	const {options, slug, arbiter, cwd, env} = ctx;
	const note = options.note ?? (() => {});
	const routed = await ledgerWrite.applyTreelessNeedsAttentionTransition({
		cwd,
		slug,
		reason,
		arbiter,
		env,
		note,
	});
	const message = routed.moved
		? `Surfaced '${slug}' to needs-attention: ${reason}`
		: `Could not surface '${slug}' (${routed.reasonNotMoved ?? 'unknown'}): ${reason}`;
	return {
		exitCode: routed.moved ? 0 : 1,
		outcome: routed.moved ? 'surfaced' : 'surface-unmoved',
		slug,
		message,
	};
}

/**
 * The agent job was cancelled before its timeout (decision 5): only release the
 * lock, leased on `lockSha`, so the next run picks the item up again.
 */
async function releaseAfterCancel(
	ctx: ApplyContext,
	reason: string,
): Promise<BuildPhaseResult> {
	const {options, held, slug, item, arbiter, cwd, env} = ctx;
	const note = options.note ?? (() => {});
	const released = await releaseLockLeased({
		cwd,
		arbiter,
		item,
		expectedSha: held.lockSha,
		env,
	});
	note(released.message);
	const message = released.released
		? `Released '${slug}': ${reason}.`
		: `Could not release '${slug}' (${released.message}): ${reason}.`;
	return {
		exitCode: released.released ? 0 : 1,
		outcome: released.released ? 'released' : 'release-refused',
		slug,
		message,
	};
}

/** Map a reused `do` write half's result to the apply phase's. */
function fromDoResult(r: DoResult): BuildPhaseResult {
	const outcome: BuildPhaseOutcome =
		r.outcome === 'deadline-auto-continued'
			? 'auto-continued'
			: r.routedToNeedsAttention === true
				? 'surfaced'
				: 'surface-unmoved';
	return {exitCode: r.exitCode, outcome, slug: r.slug, message: r.message};
}

/**
 * The `maxAutoCheckpoints` ceiling from the repository config AT `baseSha`
 * (trusted, the arbiter's `main` the lock job classified at), never from the
 * bundle: a work branch could raise its own ceiling otherwise. Falls back to
 * the resolved option, then to the default, when the file does not set a
 * valid value.
 */
function maxAutoCheckpointsAt(
	cwd: string,
	baseSha: string,
	fallback: number | undefined,
	env: NodeJS.ProcessEnv,
): number {
	const cap = repoConfigAt(cwd, baseSha, env)?.maxAutoCheckpoints;
	if (typeof cap === 'number' && Number.isInteger(cap) && cap >= 1) {
		return cap;
	}
	return fallback ?? 5;
}

/** The `integrate` write half: the land loop, the review comment, the release. */
async function applyIntegrate(
	ctx: ApplyContext,
	validated: ReturnType<typeof validateApplyHandoff>,
): Promise<BuildPhaseResult> {
	const {options, held, slug, item, arbiter, cwd, env} = ctx;
	const note = options.note ?? (() => {});
	const record = validated.handoff.record;
	if (record.intent.kind !== 'integrate' || validated.bundle === undefined) {
		throw new Error('applyIntegrate needs an integrate handoff with a bundle');
	}
	const products = record.products as {
		prTitle: string;
		prBody: string;
		reviewProse?: string;
	};
	const branch = validated.bundle.workBranch;
	const tip = validated.bundle.tip;
	if (validated.forcedPropose) {
		note(
			`Untrusted-origin task '${slug}': forcing the BUILD transition to ` +
				'propose (recomputed from the task at the base).',
		);
	}
	const commitMessage = (
		await gitHard(['log', '-1', '--format=%s', tip], cwd, env)
	).trim();
	const land = await integrationLand.land({
		cwd,
		arbiter,
		slug,
		branch,
		lifecycle: false,
		source: taskSourceAtBase(cwd, held.baseSha, slug, env),
		surfaceArbiter: arbiter,
		commitMessage,
		env,
		note,
		mode: validated.mode,
		noPR: options.noPR,
		providerInstance: options.providerInstance,
		title: products.prTitle,
		body: proposeBody(products.prBody, validated.ledgerReport),
		reviewProse: products.reviewProse,
		mergeRetries: options.mergeRetries,
		mergeJitterMs: options.mergeJitterMs,
		// The landed-vs-gated report (decision 2): the agent job gated the
		// bundle tip, so a merge land that lands another tree says so.
		gatedTip: tip,
	});

	if (land.outcome !== 'completed') {
		return {
			exitCode: land.routedToNeedsAttention ? 0 : 1,
			outcome: land.routedToNeedsAttention ? 'surfaced' : 'usage-error',
			slug,
			message: land.reason ?? `the land ended as ${land.outcome}`,
			land,
		};
	}
	const integration = land.integration!;
	if (integration.mergedToMain === true || integration.alreadyLanded === true) {
		const released = await releaseLockLeased({
			cwd,
			arbiter,
			item,
			expectedSha: held.lockSha,
			env,
		});
		note(released.message);
		return {
			exitCode: 0,
			outcome: 'landed',
			slug,
			message: `Completed '${slug}': merged to ${arbiter}/main.`,
			land,
		};
	}
	// Say "for review" ONLY when a PR was opened (task
	// `intake-reports-the-pr-it-actually-opened`): a degraded `gh pr create`
	// pushed the branch but opened nothing, and the land already printed why.
	const notOpened = proposeRequestNotOpened(integration);
	return {
		exitCode: 0,
		outcome: 'proposed',
		slug,
		message:
			notOpened === undefined
				? `Completed '${slug}': pushed ${branch} for review; the lock stays ` +
					'held until the PR merges.'
				: `Completed '${slug}': pushed ${branch} but opened NO PR ` +
					`(${notOpened}); the lock stays held until the branch lands.`,
		land,
	};
}

/**
 * The propose PR body: the agent's summary (from the validated record) with the
 * bundle validation's ledger report appended (user story 23). The report is
 * never cut; the summary is shortened to keep the whole under the comment limit.
 */
function proposeBody(
	prBody: string,
	ledgerReport: string | undefined,
): string | undefined {
	if (ledgerReport === undefined) return prBody === '' ? undefined : prBody;
	const room = HANDOFF_LIMITS.commentChars - ledgerReport.length - 2;
	const summary = boundHandoffText(prBody, Math.max(0, room));
	return summary === '' ? ledgerReport : `${summary}\n\n${ledgerReport}`;
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
