/**
 * **The build path split into the three CI phases** (spec
 * `ci-agent-job-without-write-token` §3 build row and §8, ADR
 * `ci-agent-job-holds-no-write-token`, task `ci-split-build-path`).
 *
 * `advance task:<slug>` / `do <slug>` with `--phase` run ONE of three halves of
 * the one build pipeline (`performDo`), never a second implementation:
 *
 *  - **lock** ({@link performBuildLockPhase}): fetch `<arbiter>/main` (its tip
 *    is `baseSha`, and the tree the item is classified in, never the run's
 *    commit); claim (`acquireItemLock`, `action: implement`); publish
 *    `acquired`, `needsAgent`, `rung`, `baseSha`, `lockSha`, `continueTip`,
 *    `handoffName`. An item that is not claimable at `baseSha` (it already
 *    advanced, or its lock is held) is a no-op that writes nothing.
 *  - **agent** ({@link performBuildAgentPhase}): check, read-only, that the lock
 *    ref still equals `lockSha`, then run `performDo` without its claim under
 *    the phase recorder: the build agent, the gate, the Gate-2 review, the
 *    done-move commit, the local rebase and the fresh-worktree gate run exactly
 *    as today, and the pipeline halts at its first write. The success path's
 *    first write is the land half (`integrationLand.land`), handed over as
 *    `integrate` with the work-branch bundle, the PR title and body and the
 *    Gate-2 review prose. Every other outcome is handed over as `agent-failed`
 *    for now (task `ci-split-build-path-non-integrate-intents` adds the real
 *    intents).
 *  - **apply** ({@link performBuildApplyPhase}): refuse to write unless the
 *    lock ref still equals `lockSha`; validate the handoff as hostile
 *    (`validateApplyHandoff`); resume at the land half (`landIntegration`, the
 *    unchanged compare-and-swap loop, then the review comment); release the lock
 *    with a lease on `lockSha` once the work is durably on `main` (a propose PR
 *    keeps it held, exactly as `complete` does today).
 */

import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {classifyTick} from './advance-classify.js';
import {readItemSignals} from './advance.js';
import {
	HANDOFF_LIMITS,
	HandoffRejected,
	handoffName as deriveHandoffName,
	type HandoffRecord,
} from './ci-handoff-format.js';
import {writeHandoff} from './ci-handoff.js';
import {validateApplyHandoff} from './ci-handoff-apply.js';
import type {LockOutputs} from './ci-lock-outputs.js';
import {
	PhaseDriverError,
	arbiterLockSha,
	arbiterRefSha,
	boundHandoffText,
	checkLockOwnership,
	emitLockOutputs,
	fetchArbiterMain,
	noSmudgeEnv,
	releaseLockLeased,
	requireHeldLock,
	runnerTempFrom,
	withBaseWorktree,
	type HeldLock,
} from './ci-phase-driver.js';
import {performClaim} from './claim-cas.js';
import {performDo, type DoOptions} from './do.js';
import {
	checkGatePreconditions,
	detectLockfileOnDisk,
} from './gate-readiness.js';
import {git, runAsync} from './git.js';
import {identityEnv} from './identity.js';
import {
	integrationLand,
	type IntegrationCoreInput,
	type IntegrationCoreResult,
	type IntegrationLandInput,
} from './integration-core.js';
import {ledgerRead} from './ledger-read.js';
import {ledgerWrite} from './ledger-write.js';
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
	/** apply: the handoff broke a rule; nothing from it was written. */
	| 'rejected'
	/** A usage or environment problem, or a path this task does not split yet. */
	| 'usage-error';

/** The result of one build phase run. */
export interface BuildPhaseResult {
	exitCode: 0 | 1 | 2 | 3;
	outcome: BuildPhaseOutcome;
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
		note(verdict.skip);
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
		note(message);
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

/** The `agent-failed` detail for a halt at a write this task does not carry yet. */
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
		'(this outcome is not carried through the CI phases yet)'
	);
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
		note(ownership.message);
		return {
			exitCode: 1,
			outcome: 'stale-lock',
			slug,
			message: ownership.message,
		};
	}

	const recorder = createPhaseRecorder({record: buildRecordableCalls()});
	let products: HandoffRecord;
	let bundle: {repo: string; workBranch: string; baseSha: string} | undefined;
	try {
		const outcome = await runAgentPhase(recorder, () =>
			performDo({
				...options,
				phase: 'agent',
				providerInstance:
					options.providerInstance === undefined
						? undefined
						: recordingReviewProvider(options.providerInstance, recorder),
			}),
		);
		if (outcome.halted && outcome.intent.seam === 'integrationLand') {
			const land = outcome.intent.input as IntegrationLandInput;
			if (land.branch !== workBranchRef('task', slug)) {
				throw new Error(
					`the land half names the branch ${land.branch}, not ` +
						workBranchRef('task', slug),
				);
			}
			const limit = HANDOFF_LIMITS.commentChars;
			products = {
				schema: 1,
				item,
				intent: {kind: 'integrate'},
				products: {
					prTitle: land.title,
					prBody: boundHandoffText(land.body ?? '', limit),
					...(land.reviewProse === undefined
						? {}
						: {reviewProse: boundHandoffText(land.reviewProse, limit)}),
				},
			};
			bundle = {repo: land.cwd, workBranch: land.branch, baseSha: held.baseSha};
		} else {
			const detail = outcome.halted
				? haltDetail(outcome.intent)
				: `the build ended without reaching a write: ${outcome.result.message}`;
			products = agentFailed(item, detail);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		products = agentFailed(item, `the build failed: ${message}`);
	}

	writeHandoff({
		dir: options.handoffDir,
		rung: 'build-task',
		record: products,
		bundle,
	});
	const message = `handed over ${products.intent.kind} for ${item}`;
	note(message);
	return {
		exitCode: 0,
		outcome: 'handed-over',
		slug,
		message,
		intent: products.intent.kind,
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

/**
 * The done-move source folder of the task AT `baseSha` (trusted), which picks
 * the land half's ledger reconcile arms exactly as the agent's `complete` did.
 */
function sourceAtBase(
	cwd: string,
	baseSha: string,
	slug: string,
	env: NodeJS.ProcessEnv,
): IntegrationCoreInput['source'] {
	const folders = ['tasks-ready', 'tasks-backlog', 'done'] as const;
	for (const folder of folders) {
		const spec = `${baseSha}:${workItemRel(folder, `${slug}.md`)}`;
		try {
			git(['cat-file', '-e', spec], cwd, {env});
			return folder;
		} catch {
			// not in this folder
		}
	}
	return 'tasks-ready';
}

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
 * hostile, then resume the build at the land half. Runs no agent and no
 * repository code; every write goes through dorfl's seams.
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
	const slug = buildSlug(options, options.repoPath ?? cwd);
	const item = `task:${slug}`;

	// Lock ownership BEFORE the first write (spec §8): a lock that was released,
	// reaped or re-taken since the lock job ran means this run writes nothing.
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
			slug,
			message: ownership.message,
		};
	}

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
	if (record.intent.kind !== 'integrate' || validated.bundle === undefined) {
		const reason =
			record.intent.kind === 'agent-failed'
				? `the agent job's build failed: ${
						(record.products as {failureDetail: string}).failureDetail
					}`
				: `the agent job handed over ${record.intent.kind}, which the apply ` +
					'phase does not carry yet';
		return surface({
			cwd,
			arbiter,
			slug,
			reason,
			env,
			note,
			outcome: 'surfaced',
		});
	}

	const products = record.products as {
		prTitle: string;
		prBody: string;
		reviewProse?: string;
	};
	const branch = validated.bundle.workBranch;
	const tip = validated.bundle.tip;
	await gitHard(['checkout', '--quiet', '-B', branch, tip], cwd, env);
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
		source: sourceAtBase(cwd, held.baseSha, slug, env),
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
	return {
		exitCode: 0,
		outcome: 'proposed',
		slug,
		message:
			`Completed '${slug}': pushed ${branch} for review; the lock stays held ` +
			'until the PR merges.',
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
