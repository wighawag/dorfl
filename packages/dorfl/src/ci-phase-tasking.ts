/**
 * **The tasking path split into the three CI phases** (spec
 * `ci-agent-job-without-write-token` §3 tasking row, ADR
 * `ci-agent-job-holds-no-write-token`, task `ci-split-tasking`).
 *
 * `do spec:<slug>` / `advance spec:<slug>` with `--phase` run ONE of three
 * halves of the one tasking pipeline (`tasking.ts`: {@link runTaskingAgentHalf}
 * is the agent half, {@link integrateTaskingCandidates} /
 * {@link surfaceTaskingBlock} / {@link persistTaskingCandidates} the write half),
 * never a second implementation:
 *
 *  - **lock** ({@link performTaskingLockPhase}): fetch `<arbiter>/main` (its tip
 *    is `baseSha`); in a throwaway worktree of it, check the spec rests in
 *    `work/specs/ready/` and passes the agent tasking gate (and, for `advance`,
 *    classifies on the `task-spec` rung); take the tasking lock
 *    (`acquireTaskingLock`, the unified `spec:<slug>` lock, `action: task`);
 *    publish `acquired`, `needsAgent`, `rung`, `baseSha`, `lockSha`,
 *    `handoffName` and `agentTimeoutMinutes`. No agent, no repository code.
 *  - **agent** ({@link performTaskingAgentPhase}): check, read-only, that the
 *    lock ref still equals `lockSha`; on a `work/spec-<slug>` branch cut from
 *    `baseSha`, run the tasker, its review rounds, and the one-round task-set
 *    review (which the laptop path runs inside `performIntegration`; it is an
 *    agent, so it runs HERE), then hand over `tasking-land` (the candidates, the
 *    PR body, the review verdict and prose, the trimmed spec body) or
 *    `tasking-surface` (the candidates to save, the reason). Writes nothing to
 *    the arbiter: every write seam records into a recorder that knows no write.
 *    A tasker failure writes no handoff and fails the job.
 *  - **apply** ({@link performTaskingApplyPhase}): refuse to write unless the
 *    lock ref still equals `lockSha`; act on the agent job's result first
 *    (`failure` / timeout surfaces the spec, a real cancel only releases the
 *    lock); read the handoff as hostile and never take a bundle: it re-commits
 *    only VALIDATED candidate files ({@link checkTaskingCandidate}) and the
 *    validated trimmed spec body ({@link checkTrimmedSpecBody}) on a fresh
 *    `work/spec-<slug>` branch cut from `baseSha`, then integrates with the spec
 *    move and the review OFF (it already ran), or saves the candidates on the
 *    work branch, closes a stale PR in propose mode and surfaces. Every lock
 *    release is leased on `lockSha`.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {classifyTick} from './advance-classify.js';
import {readItemSignals} from './advance.js';
import {
	HANDOFF_LIMITS,
	HandoffRejected,
	handoffName as deriveHandoffName,
	type HandoffRecord,
	type TaskingLandProducts,
	type TaskingSurfaceProducts,
} from './ci-handoff-format.js';
import {readHandoff, writeHandoff} from './ci-handoff.js';
import type {LockOutputs} from './ci-lock-outputs.js';
import type {AgentJobResult, GithubApiGet} from './ci-agent-result.js';
import {
	PhaseDriverError,
	agentTimeoutMinutesAt,
	arbiterLockSha,
	boundHandoffText,
	acquireNotingOnce,
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
import type {DoOptions} from './do.js';
import {
	FrontmatterRenderError,
	assertFrontmatterFields,
	parseFrontmatter,
	unquoteYamlScalar,
	type Frontmatter,
} from './frontmatter.js';
import {runAsync} from './git.js';
import {identityEnv} from './identity.js';
import {runReviewRounds} from './integration-core.js';
import {leaseLockReleases} from './item-lock.js';
import {formatBlockReason} from './review-gate.js';
import {ledgerRead} from './ledger-read.js';
import type {Phase} from './phase.js';
import {createPhaseRecorder, runAgentPhase} from './phase-recorder.js';
import {isSafeSlug} from './slug-safety.js';
import {
	SlugResolutionError,
	resolveAdvanceArg,
	resolveSlug,
} from './slug-namespace.js';
import {
	STAGED_TASKS_DIR,
	collectEmittedTasks,
	composeTaskingProposeBody,
	decompositionUnclearReason,
	gateRefusalReason,
	integrateTaskingCandidates,
	newOrChangedStagedTasks,
	persistTaskingCandidates,
	resolveAgentGate,
	reviewFailureReason,
	runTaskingAgentHalf,
	snapshotPool,
	snapshotStagedTasks,
	surfaceTaskingBlock,
	switchToWorkBranch,
	taskGateBlockedReason,
	taskGateUnparseableReason,
	taskPlacementDir,
	type PerformTaskOptions,
	type TaskResult,
} from './tasking.js';
import {acquireTaskingLock, releaseTaskingLock} from './tasking-lock.js';
import {workFolderRel, workItemPath, workItemRel} from './work-layout.js';

const DEFAULT_ARBITER = 'origin';

/** The verb a tasking phase runs under (they classify the argument differently). */
export type TaskingPhaseVerb = 'do' | 'advance';

/** Options of a tasking phase run: the `do` pipeline's options plus the phase inputs. */
export interface TaskingPhaseOptions extends DoOptions {
	/** Which of the three jobs this process is. */
	phase: Phase;
	/** `do spec:<slug>` or `advance spec:<slug>`. */
	verb: TaskingPhaseVerb;
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
	/** The merge-mode CAS-loop jitter (tests pass 0). */
	mergeJitterMs?: number;
	/** apply: `needs.agent.result` (`--agent-result`), REQUIRED. Only `success` reads the handoff. */
	agentResult?: AgentJobResult;
	/** apply: the agent job's timeout (`--agent-timeout-minutes`); default the lock outputs'. */
	agentTimeoutMinutes?: number;
	/** apply: the Actions API reader (tests stub it); default `fetch` with `GITHUB_TOKEN`. */
	actionsApi?: GithubApiGet;
}

/** How a tasking phase run ended. */
export type TaskingPhaseOutcome =
	/** lock: the spec is locked; the agent phase runs next. */
	| 'locked'
	/** lock: nothing to task at the arbiter's `main`. */
	| 'no-op'
	/** lock: the agent tasking gate refused the spec (nothing was written). */
	| 'gate-refused'
	/** lock: another run holds the spec's lock. */
	| 'lost'
	/** agent / apply: the lock ref no longer equals `lockSha`; nothing was done. */
	| 'stale-lock'
	/** agent: the handoff was written (see `intent`). */
	| 'handed-over'
	/** agent: the tasker (or the phase) failed; no handoff (the job fails). */
	| 'agent-failed'
	/** apply: the tasks and the spec move landed on `main`; the lock was released. */
	| 'landed'
	/** apply: the work branch was pushed (and a PR requested); the lock stays held. */
	| 'proposed'
	/** apply: the spec was surfaced to needs-attention and its lock released. */
	| 'surfaced'
	/** apply: surfacing the spec did not land on the arbiter. */
	| 'surface-unmoved'
	/** apply: the spec on `main` changed since the lock job; nothing was written. */
	| 'stale'
	/** apply: the agent job was cancelled (not timed out); the lock was only released. */
	| 'released'
	/** apply: the cancelled agent job's leased lock release was refused. */
	| 'release-refused'
	/** apply: the handoff broke a rule; the spec was surfaced, nothing from it landed. */
	| 'rejected'
	/** A usage or environment problem. */
	| 'usage-error';

/** The result of one tasking phase run. */
export interface TaskingPhaseResult {
	exitCode: 0 | 1 | 2 | 3 | 4;
	outcome: TaskingPhaseOutcome;
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
	/** apply: the repository paths of the tasks the runner committed. */
	emitted?: string[];
}

/**
 * Run one phase of the tasking path. The CLI calls this for `do spec:<slug>
 * --phase` and `advance spec:<slug> --phase`.
 */
export async function performTaskingPhase(
	options: TaskingPhaseOptions,
): Promise<TaskingPhaseResult> {
	try {
		switch (options.phase) {
			case 'lock':
				return await performTaskingLockPhase(options);
			case 'agent':
				return await performTaskingAgentPhase(options);
			case 'apply':
				return await performTaskingApplyPhase(options);
		}
	} catch (err) {
		if (err instanceof PhaseDriverError || err instanceof SlugResolutionError) {
			return {exitCode: 1, outcome: 'usage-error', message: err.message};
		}
		throw err;
	}
}

/** The spec slug a tasking phase acts on, from the (trusted) workflow argument. */
function taskingSlug(options: TaskingPhaseOptions, repoPath: string): string {
	const read = options.read ?? ledgerRead;
	const resolved =
		options.verb === 'advance'
			? resolveAdvanceArg({arg: options.arg, repoPath, read})
			: resolveSlug({arg: options.arg, repoPath, read});
	if (resolved.namespace !== 'spec') {
		throw new PhaseDriverError(
			`the tasking phases take a spec; ${options.arg} is not one`,
		);
	}
	return resolved.slug;
}

/**
 * The `performTask` options the tasking halves read, mapped from the `do`
 * options exactly as `performDo` maps them for `do spec:<slug>`.
 */
function taskOptionsFor(
	options: TaskingPhaseOptions,
	slug: string,
	cwd: string,
	env: NodeJS.ProcessEnv,
	agentEnv: NodeJS.ProcessEnv,
): PerformTaskOptions {
	return {
		slug,
		cwd,
		arbiter: options.arbiter ?? DEFAULT_ARBITER,
		doer: 'agent',
		autoTask: options.autoTask,
		explicit: true,
		dorfl: options.dorfl,
		harness: options.harness,
		agentCmd: options.agentCmd,
		model: options.model,
		sessionsDir: options.sessionsDir,
		integration: options.taskingIntegration ?? options.integration,
		mergeRetries: options.mergeRetries,
		tasksLandIn: options.tasksLandIn,
		untrustedTasksLandIn: options.untrustedTasksLandIn,
		explicitTasksLandIn: options.explicitTasksLandIn,
		noPR: options.noPR,
		providerInstance: options.providerInstance,
		reviewLoop: options.reviewLoop,
		taskerLoopMax: options.taskerLoopMax,
		reviewExecutions: options.reviewExecutions,
		taskerLoopModel: options.taskerLoopModel,
		review: options.review,
		reviewGate: options.taskReviewGate,
		acceptanceReviewModel: options.reviewModel,
		env,
		agentEnv,
		note: options.note,
	};
}

// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------

/**
 * The lock phase: check the spec at the arbiter's `main`, take the tasking lock
 * and publish the trusted facts. Runs no agent and no repository code. A spec
 * that is not taskable at `baseSha` is refused BEFORE any write.
 */
export async function performTaskingLockPhase(
	options: TaskingPhaseOptions,
): Promise<TaskingPhaseResult> {
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
		async (base): Promise<{slug: string; skip?: string; refused?: string}> => {
			const slug = taskingSlug(options, base);
			const item = `spec:${slug}`;
			if (options.verb === 'advance') {
				const signals = readItemSignals({
					repoPath: base,
					type: 'spec',
					slug,
					item,
				});
				const kind = classifyTick({type: 'spec', ...signals}).kind;
				if (kind !== 'task-spec') {
					if (kind === 'no-op') {
						return {slug, skip: `no-op for ${item} at ${baseSha}`};
					}
					throw new PhaseDriverError(
						`--phase splits only the build and tasking paths so far; ${item} ` +
							`classifies as ${kind} at ${baseSha}`,
					);
				}
			}
			const specPath = workItemPath(base, 'specs-ready', slug);
			if (!existsSync(specPath)) {
				return {
					slug,
					skip:
						`'${slug}' is not in ${workFolderRel('specs-ready')}/ at ` +
						`${arbiter}/main (${baseSha}): it was already tasked, or removed`,
				};
			}
			const specFm = parseFrontmatter(readFileSync(specPath, 'utf8'));
			const eligibility = resolveAgentGate(
				base,
				slug,
				specFm,
				options.autoTask,
				true,
			);
			if (!eligibility.taskable) {
				return {
					slug,
					refused: gateRefusalReason(slug, specFm, eligibility, {
						slug,
						cwd: base,
						autoTask: options.autoTask,
						explicit: true,
					}),
				};
			}
			return {slug};
		},
	);
	const slug = verdict.slug;
	const item = `spec:${slug}`;
	if (verdict.skip !== undefined) {
		return {
			exitCode: 0,
			outcome: 'no-op',
			slug,
			message: verdict.skip,
			lockOutputs: publish({acquired: false, baseSha}),
		};
	}
	if (verdict.refused !== undefined) {
		return {
			exitCode: 1,
			outcome: 'gate-refused',
			slug,
			message: verdict.refused,
			lockOutputs: publish({acquired: false, rung: 'task-spec', baseSha}),
		};
	}
	if ((await arbiterLockSha({cwd, arbiter, item, env})) !== undefined) {
		const message = `'${slug}' is already locked on ${arbiter}; backing off.`;
		return {
			exitCode: 2,
			outcome: 'lost',
			slug,
			message,
			lockOutputs: publish({acquired: false, rung: 'task-spec', baseSha}),
		};
	}

	const acquired = await acquireNotingOnce(note, (acquireNote) =>
		acquireTaskingLock({slug, cwd, arbiter, env, note: acquireNote}),
	);
	if (acquired.exitCode !== 0) {
		const outcome =
			acquired.outcome === 'lost' || acquired.outcome === 'contended'
				? 'lost'
				: 'usage-error';
		return {
			exitCode: acquired.exitCode,
			outcome,
			slug,
			message: acquired.message,
			lockOutputs: publish({acquired: false, rung: 'task-spec', baseSha}),
		};
	}
	const lockSha = await arbiterLockSha({cwd, arbiter, item, env});
	if (lockSha === undefined) {
		throw new Error(`the lock of ${item} vanished right after the acquire`);
	}
	const facts = publish({
		acquired: true,
		needsAgent: true,
		rung: 'task-spec',
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
		slug,
		message: `locked ${item} at ${baseSha} (lock ${lockSha})`,
		lockOutputs: facts,
	};
}

// ---------------------------------------------------------------------------
// agent
// ---------------------------------------------------------------------------

/** The candidate task files keyed by slug (their file name without `.md`). */
function candidatesBySlug(
	emitTasks: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [rel, content] of Object.entries(emitTasks)) {
		out[basename(rel).replace(/\.md$/i, '')] = content;
	}
	return out;
}

/** A bounded reason for the handoff record. */
function reasonText(text: string): string {
	return boundHandoffText(text, HANDOFF_LIMITS.reasonChars);
}

/**
 * The agent half's work under the recorder: the tasker, the loop and the
 * task-set review, mapped to the handoff record. Throws on a tasker failure.
 */
async function taskingHandover(params: {
	options: TaskingPhaseOptions;
	slug: string;
	item: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
	note: (message: string) => void;
}): Promise<HandoffRecord> {
	const {options, slug, item, cwd, env, note} = params;
	const specPath = workItemPath(cwd, 'specs-ready', slug);
	if (!existsSync(specPath)) {
		throw new Error(
			`the spec ${workItemRel('specs-ready', `${slug}.md`)} is missing at the base`,
		);
	}
	const specFm = parseFrontmatter(readFileSync(specPath, 'utf8'));
	const taskOptions = taskOptionsFor(options, slug, cwd, env, env);
	const half = await runTaskingAgentHalf(taskOptions, {
		cwd,
		slug,
		specFm,
		doer: 'agent',
		note,
	});
	const surface = (
		reason: string,
		candidates: Record<string, string>,
	): HandoffRecord => ({
		schema: 1,
		item,
		intent: {kind: 'tasking-surface'},
		products: {
			candidates,
			reason: reasonText(reason),
		} satisfies TaskingSurfaceProducts,
	});
	switch (half.kind) {
		case 'agent-failed':
			throw new Error(`Agent failed tasking '${slug}' (${half.detail}).`);
		case 'review-leg-failed': {
			const paths = newOrChangedStagedTasks(cwd, half.before);
			return surface(
				reviewFailureReason(slug, half.error, paths),
				candidatesBySlug(collectEmittedTasks(cwd, paths)),
			);
		}
		case 'decomposition-unclear':
			return surface(decompositionUnclearReason(slug, half.questions), {});
		case 'candidates':
			break;
	}
	const emitTasks = collectEmittedTasks(
		cwd,
		newOrChangedStagedTasks(cwd, half.before),
	);

	// THE TASK-SET ACCEPTANCE GATE, one round (the laptop path runs it inside
	// `performIntegration` with `reviewMaxRounds: 1`). It launches an agent, so
	// it runs here; the apply phase integrates with the review OFF.
	let reviewVerdict: TaskingLandProducts['reviewVerdict'];
	let reviewProse: string | undefined;
	if (taskOptions.review === true) {
		if (taskOptions.reviewGate === undefined) {
			throw new Error(
				`review is on but no task-set review gate is configured for '${slug}' ` +
					'(a wiring bug; the gate must not be skipped)',
			);
		}
		note('Running the task-set acceptance review…');
		const rounds = await runReviewRounds({
			reviewGate: taskOptions.reviewGate,
			slug,
			reviewCwd: cwd,
			maxRounds: 1,
			reviewModel: taskOptions.acceptanceReviewModel,
			sessionsDir: taskOptions.sessionsDir,
			env,
		});
		if (rounds.kind === 'unparseable') {
			return surface(taskGateUnparseableReason(slug, rounds.reason), {});
		}
		if (rounds.kind === 'blocked') {
			const findings =
				rounds.verdict === undefined ? '' : formatBlockReason(rounds.verdict);
			return surface(
				taskGateBlockedReason(slug, findings === '' ? undefined : findings),
				{},
			);
		}
		reviewVerdict = 'approve';
		reviewProse = rounds.verdict?.review;
	}

	return {
		schema: 1,
		item,
		intent: {kind: 'tasking-land'},
		products: {
			candidates: candidatesBySlug(emitTasks),
			prBody: boundHandoffText(
				composeTaskingProposeBody(slug, emitTasks) ?? '',
				HANDOFF_LIMITS.commentChars,
			),
			...(reviewVerdict === undefined ? {} : {reviewVerdict}),
			...(reviewProse === undefined
				? {}
				: {
						reviewProse: boundHandoffText(
							reviewProse,
							HANDOFF_LIMITS.commentChars,
						),
					}),
			specBody: readFileSync(specPath, 'utf8'),
		} satisfies TaskingLandProducts,
	};
}

/**
 * The agent phase: after a read-only lock-ownership check, run the tasker, its
 * review rounds and the task-set review on a `work/spec-<slug>` branch cut from
 * `baseSha`, and write the handoff. Holds a read-only token: every write seam
 * records into a recorder that knows no write, so a write attempt fails the
 * job. Any failure writes no handoff and fails the job (the apply job then
 * surfaces the spec).
 */
export async function performTaskingAgentPhase(
	options: TaskingPhaseOptions,
): Promise<TaskingPhaseResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = options.env ?? process.env;
	const held = requireHeldLock({
		lockOutputs: options.lockOutputs,
		env,
		rung: 'task-spec',
	});
	if (options.handoffDir === undefined) {
		throw new PhaseDriverError('the agent phase needs a handoff directory');
	}
	const slug = taskingSlug(options, options.repoPath ?? cwd);
	const item = `spec:${slug}`;

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

	let record: HandoffRecord;
	try {
		await switchToWorkBranch(cwd, arbiter, slug, env, held.baseSha);
		const outcome = await runAgentPhase(createPhaseRecorder({record: []}), () =>
			taskingHandover({options, slug, item, cwd, env, note}),
		);
		if (outcome.halted) {
			throw new Error(
				`the tasking reached a write (${outcome.intent.seam}.${outcome.intent.method})`,
			);
		}
		record = outcome.result;
		writeHandoff({dir: options.handoffDir, rung: 'task-spec', record});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'agent-failed', slug, message};
	}
	const kind = record.intent.kind;
	const message = `handed over ${kind} for ${item}`;
	return {exitCode: 0, outcome: 'handed-over', slug, message, intent: kind};
}

// ---------------------------------------------------------------------------
// apply: the hostile-handoff checks
// ---------------------------------------------------------------------------

/** The spec's origin stamp at `baseSha`: the one every candidate carries. */
export type OriginStamp = Pick<Frontmatter, 'origin' | 'originTrust'>;

/** A top-level `key: value` frontmatter line (the grammar `parseFrontmatter` reads). */
const TOP_LEVEL_KEY_RE = /^([A-Za-z0-9_.]+)\s*:\s*(.*)$/;

/**
 * The frontmatter of `content` split into its block lines and everything from
 * the closing fence on, or `undefined` when it does not parse: the document must
 * open with a `---` line and close the fence (the rule `parseFrontmatter` uses;
 * an unclosed fence reads as NO frontmatter, so every key in it is silently
 * ignored). A leading BOM and CRLF line ends are normalised away.
 */
function splitFrontmatter(
	content: string,
): {block: string[]; rest: string[]} | undefined {
	const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n')) return undefined;
	const lines = normalized.split('\n');
	const closing = lines.indexOf('---', 1);
	if (closing === -1) return undefined;
	return {block: lines.slice(1, closing), rest: lines.slice(closing)};
}

/** One top-level key of a frontmatter block, with its indented continuation lines. */
interface KeyEntry {
	key: string;
	/** The raw value, then each continuation line (a block-list item). */
	raw: string[];
	/** The block line indexes the entry spans, `[start, end)`. */
	start: number;
	end: number;
}

/** Every top-level key of a frontmatter block, in order (duplicates kept). */
function keyEntries(block: string[]): KeyEntry[] {
	const out: KeyEntry[] = [];
	for (let i = 0; i < block.length; i++) {
		const line = block[i];
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
		const m = TOP_LEVEL_KEY_RE.exec(line);
		if (m === null) continue;
		let end = i + 1;
		while (end < block.length && /^\s+\S/.test(block[end])) end++;
		out.push({
			key: m[1],
			raw: [m[2].trim(), ...block.slice(i + 1, end).map((l) => l.trim())],
			start: i,
			end,
		});
		i = end - 1;
	}
	return out;
}

/** The gate booleans a candidate may set; the apply job checks only that they parse. */
const CANDIDATE_BOOLEAN_KEYS = ['humanOnly', 'needsAnswers'] as const;
/** The origin stamp keys the apply job overwrites on every candidate. */
const STAMP_KEYS = ['origin', 'originTrust'] as const;

/**
 * Check ONE candidate task file of a hostile handoff and return the content the
 * apply job commits (spec §3 "Structured products", task `ci-split-tasking`).
 *
 * - The path is derived, never taken: `work/tasks/backlog/<slug>.md`, and the
 *   slug must be safe (`slug-safety.ts`; the record validation already refused
 *   any other key, so `..` or a folder can never reach here).
 * - It must be NEW relative to `baseSha`: a candidate that names a staged task
 *   already on the base is an edit to a task this run did not produce.
 * - Its frontmatter must parse (an opening AND a closing `---`): an unclosed
 *   fence reads as no frontmatter, which would silently drop the stamp.
 * - `humanOnly` / `needsAnswers` must each appear at most once and read as a
 *   boolean. Their VALUES are not judged: the review loop that sets them ran in
 *   the hostile job, and every candidate lands staged for a human to promote.
 * - `origin` / `originTrust` are OVERWRITTEN with the spec's stamp at `baseSha`:
 *   every such line is dropped (with its continuation lines) and exactly one of
 *   each is written, so a candidate that repeats `originTrust: trusted` cannot
 *   keep one past the stamp (observation
 *   `tasker-drafted-duplicate-origintrust-launders-propagated-stamp`); then the
 *   result is re-parsed with `assertFrontmatterFields`, and any duplicate or
 *   mismatch rejects it.
 *
 * Throws {@link HandoffRejected} on any breach.
 */
export function checkTaskingCandidate(params: {
	slug: string;
	content: string;
	stamp: OriginStamp;
	existsAtBase: boolean;
}): string {
	const {slug, content, stamp} = params;
	const path = `${STAGED_TASKS_DIR}/${slug}.md`;
	if (!isSafeSlug(slug)) {
		throw new HandoffRejected(
			'field',
			`candidate '${slug}' is not a safe slug`,
		);
	}
	if (params.existsAtBase) {
		throw new HandoffRejected(
			'ledger',
			`candidate ${path} already exists at the base: an edit to a ` +
				'pre-existing staged task this run did not produce',
		);
	}
	const fm = splitFrontmatter(content);
	if (fm === undefined) {
		throw new HandoffRejected(
			'field',
			`candidate ${path}: its frontmatter does not parse (it must open and ` +
				'close a --- fence at the top)',
		);
	}
	const entries = keyEntries(fm.block);
	for (const key of CANDIDATE_BOOLEAN_KEYS) {
		const found = entries.filter((e) => e.key === key);
		if (found.length > 1) {
			throw new HandoffRejected(
				'field',
				`candidate ${path}: '${key}' appears ${found.length} times`,
			);
		}
		const value = found[0];
		if (value === undefined) continue;
		const v = unquoteYamlScalar(value.raw[0]).toLowerCase();
		if (value.raw.length > 1 || (v !== 'true' && v !== 'false')) {
			throw new HandoffRejected(
				'field',
				`candidate ${path}: '${key}' does not read as a boolean`,
			);
		}
	}
	const drop = new Set<number>();
	for (const e of entries) {
		if ((STAMP_KEYS as readonly string[]).includes(e.key)) {
			for (let i = e.start; i < e.end; i++) drop.add(i);
		}
	}
	const block = fm.block.filter((_, i) => !drop.has(i));
	if (stamp.origin !== undefined) block.push(`origin: ${stamp.origin}`);
	if (stamp.originTrust !== undefined) {
		block.push(`originTrust: ${stamp.originTrust}`);
	}
	const stamped = ['---', ...block, ...fm.rest].join('\n');
	try {
		assertFrontmatterFields(stamped, {
			origin: stamp.origin,
			originTrust: stamp.originTrust,
		});
	} catch (err) {
		if (!(err instanceof FrontmatterRenderError)) throw err;
		throw new HandoffRejected('field', `candidate ${path}: ${err.message}`);
	}
	return stamped;
}

/**
 * The spec frontmatter keys a trimmed body must keep EXACTLY as they are at
 * `baseSha`: the gate keys (`humanOnly`, `needsAnswers`, `taskedAfter`), the
 * issue link and the origin stamp, plus `slug` (the tasked-spec identity
 * `taskedAfter` of other specs resolves against).
 */
export const SPEC_PINNED_KEYS = [
	'humanOnly',
	'needsAnswers',
	'taskedAfter',
	'issue',
	'origin',
	'originTrust',
	'slug',
] as const;

/** The headings a trimmed spec keeps (its durable framing, TASKING-PROTOCOL §6). */
export const SPEC_REQUIRED_HEADINGS = [
	'Problem Statement',
	'Solution',
	'User Stories',
] as const;

function hasHeading(content: string, heading: string): boolean {
	return content
		.replace(/\r\n/g, '\n')
		.split('\n')
		.some((line) => {
			const m = /^#{1,6}[ \t]+(.*?)[ \t#]*$/.exec(line);
			return m !== null && m[1] === heading;
		});
}

/**
 * Check the trimmed spec body of a hostile `tasking-land` against the spec at
 * `baseSha`, and return the body the apply job commits as the tasked spec. Its
 * frontmatter must parse; every {@link SPEC_PINNED_KEYS} key must read EXACTLY
 * as at `baseSha` (the same top-level lines, in the same order, with the same
 * continuation lines, so neither a first-wins nor a last-wins reader can see
 * another value); and every {@link SPEC_REQUIRED_HEADINGS} heading the base
 * spec has must still be there. Throws {@link HandoffRejected} otherwise.
 */
export function checkTrimmedSpecBody(params: {
	slug: string;
	body: string;
	baseSpec: string;
}): string {
	const {slug, body, baseSpec} = params;
	const what = `the trimmed spec body of '${slug}'`;
	const fm = splitFrontmatter(body);
	if (fm === undefined) {
		throw new HandoffRejected(
			'field',
			`${what}: its frontmatter does not parse (it must open and close a --- fence at the top)`,
		);
	}
	const baseEntries = keyEntries(splitFrontmatter(baseSpec)?.block ?? []);
	const bodyEntries = keyEntries(fm.block);
	for (const key of SPEC_PINNED_KEYS) {
		const want = baseEntries.filter((e) => e.key === key).map((e) => e.raw);
		const got = bodyEntries.filter((e) => e.key === key).map((e) => e.raw);
		if (JSON.stringify(want) !== JSON.stringify(got)) {
			throw new HandoffRejected(
				'field',
				`${what} changes the gate key '${key}' (it must keep its value at the base)`,
			);
		}
	}
	for (const heading of SPEC_REQUIRED_HEADINGS) {
		if (hasHeading(baseSpec, heading) && !hasHeading(body, heading)) {
			throw new HandoffRejected(
				'field',
				`${what} drops the required '## ${heading}' heading`,
			);
		}
	}
	return body;
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/** What the apply phase works with past the ownership check. */
interface ApplyContext {
	options: TaskingPhaseOptions;
	held: HeldLock;
	slug: string;
	item: string;
	arbiter: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
	note: (message: string) => void;
}

/**
 * The apply phase: check the lock is still this run's, act on the agent job's
 * result, validate the handoff as hostile, then resume at the tasking write
 * half. Runs no agent and no repository code.
 */
export async function performTaskingApplyPhase(
	options: TaskingPhaseOptions,
): Promise<TaskingPhaseResult> {
	const note = options.note ?? (() => {});
	const arbiter = options.arbiter ?? DEFAULT_ARBITER;
	const cwd = options.cwd;
	const env = noSmudgeEnv(
		identityEnv(options.identity, options.env ?? process.env),
	);
	const held = requireHeldLock({
		lockOutputs: options.lockOutputs,
		env,
		rung: 'task-spec',
	});
	if (options.agentResult === undefined) {
		throw new PhaseDriverError(
			'the apply phase needs the agent job result (--agent-result, ' +
				'needs.agent.result): only success reads the handoff',
		);
	}
	const agentResult = options.agentResult;
	const slug = taskingSlug(options, options.repoPath ?? cwd);
	const item = `spec:${slug}`;

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
		return {
			exitCode: 1,
			outcome: 'stale-lock',
			slug,
			message: ownership.message,
		};
	}

	// Every lock release from here on (the merge land's, the surface's) is
	// leased on the sha this run owns.
	const restoreLease = leaseLockReleases(item, held.lockSha);
	try {
		const ctx: ApplyContext = {
			options,
			held,
			slug,
			item,
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
			case 'read-handoff':
				return await applyOwned(ctx);
			case 'deterministic':
				return await surfaceSpec(
					ctx,
					'the agent job was skipped (needsAgent: false), but the tasking ' +
						'path has no rung that runs without an agent; the handoff was not read',
				);
			case 'surface':
				return await surfaceSpec(ctx, decision.reason);
			case 'release': {
				const released = await releaseLockLeased({
					cwd,
					arbiter,
					item,
					expectedSha: held.lockSha,
					env,
				});
				note(released.message);
				const reason = decision.reason;
				return released.released
					? {
							exitCode: 0,
							outcome: 'released',
							slug,
							message: `Released '${slug}': ${reason}.`,
						}
					: {
							exitCode: 1,
							outcome: 'release-refused',
							slug,
							message: `Could not release '${slug}' (${released.message}): ${reason}.`,
						};
			}
		}
	} finally {
		restoreLease();
	}
}

/**
 * Surface the spec to needs-attention because the agent job did not succeed
 * (decision 5): the question sidecar and `needsAnswers: true` on `main`, the lock
 * released (leased). Nothing from the agent job is read or pushed.
 */
async function surfaceSpec(
	ctx: ApplyContext,
	reason: string,
): Promise<TaskingPhaseResult> {
	const {slug, cwd, arbiter, env, note} = ctx;
	const routed = await releaseTaskingLock({
		slug,
		cwd,
		arbiter,
		routeToNeedsAttention: {reason},
		env,
		note,
	});
	const moved = routed.outcome === 'released';
	const message = moved
		? `Surfaced '${slug}' to needs-attention: ${reason}`
		: `Could not surface '${slug}' (${routed.message}): ${reason}`;
	return {
		exitCode: moved ? 0 : 1,
		outcome: moved ? 'surfaced' : 'surface-unmoved',
		slug,
		message,
	};
}

/** The spec at `baseSha` (trusted), or a usage error when it is not there. */
async function specAtBase(ctx: ApplyContext): Promise<{
	content: string;
	blob: string;
}> {
	const rel = workItemRel('specs-ready', `${ctx.slug}.md`);
	const show = await runAsync(
		'git',
		['cat-file', 'blob', `${ctx.held.baseSha}:${rel}`],
		ctx.cwd,
		{env: ctx.env},
	);
	const blob = await runAsync(
		'git',
		['rev-parse', `${ctx.held.baseSha}:${rel}`],
		ctx.cwd,
		{env: ctx.env},
	);
	if (show.status !== 0 || blob.status !== 0) {
		throw new PhaseDriverError(
			`the spec ${rel} is not at the lock job's base ${ctx.held.baseSha}`,
		);
	}
	return {content: show.stdout, blob: blob.stdout.trim()};
}

/** Whether `work/tasks/backlog/<slug>.md` exists at `baseSha`. */
async function stagedTaskAtBase(
	ctx: ApplyContext,
	slug: string,
): Promise<boolean> {
	const r = await runAsync(
		'git',
		['cat-file', '-e', `${ctx.held.baseSha}:${STAGED_TASKS_DIR}/${slug}.md`],
		ctx.cwd,
		{env: ctx.env},
	);
	return r.status === 0;
}

/** Validate every candidate of the record (throws {@link HandoffRejected}). */
async function checkCandidates(
	ctx: ApplyContext,
	candidates: Record<string, string>,
	stamp: OriginStamp,
): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const [slug, content] of Object.entries(candidates)) {
		out[slug] = checkTaskingCandidate({
			slug,
			content,
			stamp,
			existsAtBase: await stagedTaskAtBase(ctx, slug),
		});
	}
	return out;
}

/** Write the checked candidates to `work/tasks/backlog/<slug>.md`. */
function writeCandidates(cwd: string, candidates: Record<string, string>) {
	for (const [slug, content] of Object.entries(candidates)) {
		const abs = join(cwd, STAGED_TASKS_DIR, `${slug}.md`);
		mkdirSync(dirname(abs), {recursive: true});
		writeFileSync(abs, content);
	}
}

/**
 * The apply phase once the lock is known to be this run's: read the handoff,
 * check it, rebuild the commit on a fresh `work/spec-<slug>` branch cut from
 * `baseSha`, and resume at the write half.
 */
async function applyOwned(ctx: ApplyContext): Promise<TaskingPhaseResult> {
	const {options, held, slug, item, arbiter, cwd, env, note} = ctx;
	const mode = options.taskingIntegration ?? options.integration ?? 'propose';
	const rejected = async (reason: string): Promise<TaskingPhaseResult> => {
		note(reason);
		const r = await surfaceTaskingBlock({
			slug,
			cwd,
			arbiter,
			reason,
			message: `the handoff was rejected; parked '${slug}' for your attention`,
			lockedBlob: undefined,
			release: releaseTaskingLock,
			mode,
			provider: options.providerInstance,
			env,
			note,
		});
		return {
			exitCode: 1,
			outcome: r.outcome === 'needs-attention' ? 'rejected' : 'surface-unmoved',
			slug,
			message: `${reason}; ${r.message}`,
		};
	};

	const base = await specAtBase(ctx);
	const baseFm = parseFrontmatter(base.content);
	const stamp: OriginStamp = {
		origin: baseFm.origin,
		originTrust: baseFm.originTrust,
	};

	let record: HandoffRecord;
	let candidates: Record<string, string>;
	let specBody: string | undefined;
	try {
		if (options.handoffDir === undefined) {
			throw new HandoffRejected('layout', 'no handoff directory was given');
		}
		record = readHandoff({
			dir: options.handoffDir,
			runnerTemp: runnerTempFrom(options.runnerTemp, env),
			trust: {item, rung: 'task-spec'},
		}).record;
		const products = record.products as {candidates: Record<string, string>};
		candidates = await checkCandidates(ctx, products.candidates, stamp);
		if (record.intent.kind === 'tasking-land') {
			const land = record.products as TaskingLandProducts;
			if (
				land.reviewVerdict !== undefined &&
				land.reviewVerdict !== 'approve'
			) {
				throw new HandoffRejected(
					'field',
					`products.reviewVerdict is ${land.reviewVerdict}: a blocked task-set ` +
						'review is a tasking-surface, never a tasking-land',
				);
			}
			specBody = checkTrimmedSpecBody({
				slug,
				body: land.specBody,
				baseSpec: base.content,
			});
		}
	} catch (err) {
		if (!(err instanceof HandoffRejected)) throw err;
		return rejected(err.message);
	}

	// A FRESH work branch cut from `baseSha`: nothing from the agent job but the
	// checked files above reaches it.
	await switchToWorkBranch(cwd, arbiter, slug, env, held.baseSha);
	const before = snapshotStagedTasks(cwd);
	const poolBefore = snapshotPool(cwd);
	writeCandidates(cwd, candidates);

	if (record.intent.kind === 'tasking-surface') {
		const surfaceProducts = record.products as TaskingSurfaceProducts;
		await persistTaskingCandidates(cwd, slug, before, arbiter, env, note);
		const r = await surfaceTaskingBlock({
			slug,
			cwd,
			arbiter,
			reason: surfaceProducts.reason,
			message: `parked '${slug}' for your attention (no tasks landed)`,
			lockedBlob: base.blob,
			release: releaseTaskingLock,
			mode,
			provider: options.providerInstance,
			env,
			note,
		});
		return fromTaskResult(r, mode);
	}

	const land = record.products as TaskingLandProducts;
	writeFileSync(workItemPath(cwd, 'specs-ready', slug), specBody as string);
	const stagedEmitted = newOrChangedStagedTasks(cwd, before);
	const r = await integrateTaskingCandidates({
		slug,
		cwd,
		arbiter,
		stagedEmitted,
		emitTasks: collectEmittedTasks(cwd, stagedEmitted),
		poolBefore,
		placementDir: taskPlacementDir(options, baseFm),
		loopTag: undefined,
		lockedBlob: base.blob,
		release: releaseTaskingLock,
		mode,
		// The task-set review already ran in the agent phase.
		review: false,
		approvedReviewProse: land.reviewProse,
		mergeRetries: options.mergeRetries,
		mergeJitterMs: options.mergeJitterMs,
		noPR: options.noPR,
		providerInstance: options.providerInstance,
		env,
		agentEnv: env,
		note,
	});
	return fromTaskResult(r, mode);
}

/** Map the tasking write half's {@link TaskResult} to the apply phase's. */
function fromTaskResult(r: TaskResult, mode: string): TaskingPhaseResult {
	const outcome: TaskingPhaseOutcome =
		r.outcome === 'tasked'
			? mode === 'merge'
				? 'landed'
				: 'proposed'
			: r.outcome === 'needs-attention'
				? 'surfaced'
				: r.outcome === 'stale'
					? 'stale'
					: 'usage-error';
	return {
		exitCode: r.exitCode,
		outcome,
		slug: r.slug,
		message: r.message,
		...(r.emitted === undefined ? {} : {emitted: r.emitted}),
	};
}
