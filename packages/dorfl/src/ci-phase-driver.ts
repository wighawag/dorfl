/**
 * **The shared CI phase driver** (spec `ci-agent-job-without-write-token`, ADR
 * `ci-agent-job-holds-no-write-token`, task `ci-split-build-path`).
 *
 * Every CI item runs as three jobs (`phase.ts`): lock, agent, apply. Each path
 * split (`ci-phase-build.ts` first; intake, tasking and the tree-less rungs
 * later) needs the same few steps around its own pipeline halves, and they live
 * here so every split does them the same way:
 *
 *  - the lock phase reads `<arbiter>/main` as the base (never the run's own
 *    commit), classifies the item in a throwaway worktree of that base, and
 *    publishes its trusted facts to `$GITHUB_OUTPUT` (`ci-lock-outputs.ts`);
 *  - the agent and apply phases read those facts back from
 *    {@link LOCK_OUTPUTS_ENV} and check them;
 *  - the lock-ownership rule (spec §8): the agent phase checks, read-only, that
 *    the item's lock ref still equals `lockSha` before launching anything, and
 *    the apply phase checks it before its FIRST write and writes nothing when
 *    it does not; every later lock operation is leased on the sha last observed
 *    ({@link releaseLockLeased});
 *  - the agent phase bounds the free text it hands over to the handoff limits;
 *  - the lock phase computes the agent job's timeout from the config at
 *    `baseSha` ({@link agentTimeoutMinutesAt}), and the apply phase decides what
 *    to do with the agent job's result before it reads any artifact
 *    ({@link resolveAgentResult}, `ci-agent-result.ts`): only `success` reads
 *    it (task `ci-split-agent-result-and-reruns`).
 */

import {mkdtempSync, rmSync, appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	LOCK_OUTPUTS_ENV,
	readLockOutputsFromEnv,
	serializeLockOutputs,
	type LockOutputs,
} from './ci-lock-outputs.js';
import {HandoffRejected, type HandoffRung} from './ci-handoff-format.js';
import {
	actionsRunRefFromEnv,
	decideAgentResult,
	detectAgentTimeout,
	githubTokenApiGet,
	type AgentJobResult,
	type AgentResultDecision,
	type GithubApiGet,
} from './ci-agent-result.js';
import {DEFAULT_CONFIG, type Config} from './config.js';
import {git, run, runAsync} from './git.js';
import {pushLfsObjects} from './ci-handoff-lfs.js';
import type {HandoffLfsObject} from './ci-handoff.js';
import type {IntegrationCoreInput} from './integration-core.js';
import {workItemRel} from './work-layout.js';
import {
	REPO_CONFIG_FILENAME,
	REPO_CONFIG_FILENAME_LEGACY,
	loadRepoConfigFromContent,
} from './repo-config.js';
import {itemLockRef, lockEntryFor} from './item-lock.js';
import {refWrite} from './ref-write.js';

export {LOCK_OUTPUTS_ENV};

/** A phase run that cannot go on: bad trusted inputs or a missing precondition. */
export class PhaseDriverError extends Error {
	override readonly name = 'PhaseDriverError';
}

/**
 * The instruction a phase prints when it refuses to act for a lock it no longer
 * owns (spec §8, "Re-runs"): "Re-run failed jobs" replays old lock outputs, and
 * the way to retry an item is a new run, which takes a fresh lock.
 */
export const STALE_LOCK_RETRY_HINT =
	'The lock was released, reaped or re-taken since the lock job ran (for ' +
	'example a "Re-run failed jobs" of a finished run). Nothing was written. To ' +
	'retry the item, start a NEW run (the next tick, or a dispatch), which takes ' +
	'a fresh lock; do not re-run the old jobs.';

/** Git environment for any checkout of hostile or unverified content: never smudge LFS. */
export function noSmudgeEnv(
	env: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
	return {...(env ?? process.env), GIT_LFS_SKIP_SMUDGE: '1'};
}

/**
 * Fetch the arbiter's `main` into `<arbiter>/main` and return its tip: the
 * phase's `baseSha`. The lock phase classifies against THIS tip, never the
 * run's `github.sha` (a queued run may start hours after its dispatch).
 */
export async function fetchArbiterMain(params: {
	cwd: string;
	arbiter: string;
	env?: NodeJS.ProcessEnv;
}): Promise<string> {
	const {cwd, arbiter, env} = params;
	await gitAsyncHard(
		[
			'fetch',
			'--quiet',
			'--no-tags',
			arbiter,
			`+refs/heads/main:refs/remotes/${arbiter}/main`,
		],
		cwd,
		env,
	);
	return (
		await gitAsyncHard(
			['rev-parse', '--verify', `refs/remotes/${arbiter}/main^{commit}`],
			cwd,
			env,
		)
	).trim();
}

/**
 * Run `fn` with a throwaway, detached worktree of `baseSha` (LFS smudging off),
 * removed afterwards. The lock phase reads the ledger (the item's folder, its
 * frontmatter, its sidecar) from here, so a checkout behind the arbiter cannot
 * make it act on stale state. Only files are read: no repository code runs.
 */
export async function withBaseWorktree<T>(
	params: {cwd: string; baseSha: string; env?: NodeJS.ProcessEnv},
	fn: (dir: string) => Promise<T>,
): Promise<T> {
	const {cwd, baseSha} = params;
	const env = noSmudgeEnv(params.env);
	const parent = mkdtempSync(join(tmpdir(), 'dorfl-base-'));
	const dir = join(parent, 'tree');
	await gitAsyncHard(
		['worktree', 'add', '--quiet', '--detach', dir, baseSha],
		cwd,
		env,
	);
	try {
		return await fn(dir);
	} finally {
		await runAsync('git', ['worktree', 'remove', '--force', dir], cwd, {env});
		rmSync(parent, {recursive: true, force: true});
		await runAsync('git', ['worktree', 'prune'], cwd, {env});
	}
}

/** The sha of `ref` on the arbiter (`git ls-remote`, read-only), or `undefined`. */
export async function arbiterRefSha(params: {
	cwd: string;
	arbiter: string;
	ref: string;
	env?: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
	const out = await gitAsyncHard(
		['ls-remote', params.arbiter, params.ref],
		params.cwd,
		params.env,
	);
	for (const line of out.split('\n')) {
		const [sha, name] = line.split('\t');
		if (name === params.ref && sha !== undefined && sha !== '') return sha;
	}
	return undefined;
}

/** The item's lock ref sha on the arbiter (read-only), or `undefined` when released. */
export function arbiterLockSha(params: {
	cwd: string;
	arbiter: string;
	item: string;
	env?: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
	return arbiterRefSha({
		...params,
		ref: itemLockRef(lockEntryFor(params.item)),
	});
}

/** The result of {@link checkLockOwnership}. */
export type LockOwnership =
	| {owned: true}
	| {owned: false; current: string | undefined; message: string};

/**
 * The lock-ownership rule (spec §8): does the item's lock ref on the arbiter
 * still equal `lockSha`, the sha the lock job produced? Read-only. The lock
 * `holder` is the same bot for every CI run, so the sha is what tells runs
 * apart. When it does not match, the message carries the retry instruction.
 */
export async function checkLockOwnership(params: {
	cwd: string;
	arbiter: string;
	item: string;
	lockSha: string;
	env?: NodeJS.ProcessEnv;
}): Promise<LockOwnership> {
	const current = await arbiterLockSha(params);
	if (current === params.lockSha) return {owned: true};
	const now =
		current === undefined ? 'is released' : `now points at ${current}`;
	return {
		owned: false,
		current,
		message:
			`the lock of ${params.item} ${now}, not the lock job's ` +
			`${params.lockSha}. ${STALE_LOCK_RETRY_HINT}`,
	};
}

/**
 * Release the item's lock with a LEASE on `expectedSha`, the sha this phase last
 * observed, so a phase never releases a lock another run holds now. Returns
 * whether the ref was deleted (a lost lease leaves it untouched).
 */
export async function releaseLockLeased(params: {
	cwd: string;
	arbiter: string;
	item: string;
	expectedSha: string;
	env?: NodeJS.ProcessEnv;
}): Promise<{released: boolean; message: string}> {
	const ref = itemLockRef(lockEntryFor(params.item));
	const del = await refWrite.deleteLockRef({
		arbiter: params.arbiter,
		ref,
		expectedSha: params.expectedSha,
		cwd: params.cwd,
		env: params.env,
	});
	if (del.status === 0) {
		await runAsync('git', ['update-ref', '-d', ref], params.cwd, {
			env: params.env,
		});
		return {released: true, message: `released ${ref}`};
	}
	return {
		released: false,
		message: `the leased release of ${ref} was rejected: ${del.stderr.trim()}`,
	};
}

/**
 * Publish the lock phase's facts: append them to the `$GITHUB_OUTPUT` file when
 * one is given, else print them (a local replay). The serializer refuses any
 * value that is not a sha, an enum, a boolean, a bounded integer or a
 * dorfl-derived name.
 */
export function emitLockOutputs(
	facts: LockOutputs,
	params: {githubOutput?: string; note: (message: string) => void},
): void {
	const lines = serializeLockOutputs(facts);
	if (params.githubOutput !== undefined && params.githubOutput !== '') {
		appendFileSync(params.githubOutput, lines);
	} else {
		params.note(`lock outputs:\n${lines}`);
	}
}

/** The lock outputs an agent or apply phase acts on, checked for its rung. */
export interface HeldLock {
	baseSha: string;
	lockSha: string;
	rung: HandoffRung;
	continueTip?: string;
	handoffName?: string;
	needsAgent?: boolean;
	agentTimeoutMinutes?: number;
}

/**
 * Read the lock outputs (given, or from {@link LOCK_OUTPUTS_ENV}) and require
 * what an agent or apply phase needs: the lock was acquired, on `rung`, with a
 * base and a lock sha. Throws {@link PhaseDriverError} otherwise.
 */
export function requireHeldLock(params: {
	lockOutputs?: LockOutputs;
	env: NodeJS.ProcessEnv;
	rung: HandoffRung;
}): HeldLock {
	const facts = params.lockOutputs ?? readLockOutputsFromEnv(params.env);
	if (facts.acquired !== true) {
		throw new PhaseDriverError(
			'the lock job did not acquire the item (acquired != true); nothing to do',
		);
	}
	if (facts.rung !== params.rung) {
		throw new PhaseDriverError(
			`the lock job classified the rung ${String(facts.rung)}, not ${params.rung}`,
		);
	}
	if (facts.baseSha === undefined || facts.lockSha === undefined) {
		throw new PhaseDriverError(
			'the lock outputs carry no baseSha or no lockSha',
		);
	}
	return {
		baseSha: facts.baseSha,
		lockSha: facts.lockSha,
		rung: facts.rung,
		continueTip: facts.continueTip,
		handoffName: facts.handoffName,
		needsAgent: facts.needsAgent,
		agentTimeoutMinutes: facts.agentTimeoutMinutes,
	};
}

/** Control characters the handoff record refuses (all but tab, LF, CR). */
// eslint-disable-next-line no-control-regex
const HANDOFF_TEXT_CONTROL_RE =
	/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Bound one free-text product for the handoff record: drop the control
 * characters the record refuses (an agent's output may carry terminal escapes)
 * and cut it to `maxChars`, marking the cut. The apply phase re-validates it;
 * this only keeps a long but honest summary from failing the whole handoff.
 */
export function boundHandoffText(text: string, maxChars: number): string {
	const clean = text.replace(HANDOFF_TEXT_CONTROL_RE, '');
	if (clean.length <= maxChars) return clean;
	const marker = '\n\n[truncated by dorfl for the CI handoff]';
	return clean.slice(0, Math.max(0, maxChars - marker.length)) + marker;
}

/**
 * The `$RUNNER_TEMP` the apply phase reads the artifact under (the handoff
 * reader refuses a directory outside it).
 */
export function runnerTempFrom(
	given: string | undefined,
	env: NodeJS.ProcessEnv,
): string {
	const dir = given ?? env.RUNNER_TEMP;
	if (dir === undefined || dir === '') {
		throw new PhaseDriverError(
			'RUNNER_TEMP is not set (the apply phase reads the handoff only from under it)',
		);
	}
	return dir;
}

/**
 * The repository config committed at `baseSha` (`dorfl.json`, else the legacy
 * dotfile): the trusted config a phase acts on, never the checkout's or a
 * bundle's. `undefined` when neither file exists or the first one found does
 * not parse.
 */
export function repoConfigAt(
	cwd: string,
	baseSha: string,
	env: NodeJS.ProcessEnv | undefined,
): Partial<Config> | undefined {
	for (const name of [REPO_CONFIG_FILENAME, REPO_CONFIG_FILENAME_LEGACY]) {
		const r = run('git', ['cat-file', 'blob', `${baseSha}:${name}`], cwd, {
			env,
		});
		if (r.status !== 0) continue;
		try {
			return loadRepoConfigFromContent(r.stdout, `${baseSha}:${name}`).config;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * The agent job's timeout in minutes, as the lock phase publishes it
 * (`agentTimeoutMinutes`): today's `agentDeadlineMinutes +
 * checkpointHeadroomMinutes`, each read from the config at `baseSha` and falling
 * back to its default (60 and 30) when absent or outside its valid range
 * ([1, 240] and [10, 60]).
 */
export function agentTimeoutMinutesAt(
	cwd: string,
	baseSha: string,
	env: NodeJS.ProcessEnv | undefined,
): number {
	const config = repoConfigAt(cwd, baseSha, env) ?? {};
	const pick = (v: unknown, min: number, max: number, fallback: number) =>
		typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
			? v
			: fallback;
	return (
		pick(
			config.agentDeadlineMinutes,
			1,
			240,
			DEFAULT_CONFIG.agentDeadlineMinutes,
		) +
		pick(
			config.checkpointHeadroomMinutes,
			10,
			60,
			DEFAULT_CONFIG.checkpointHeadroomMinutes,
		)
	);
}

/**
 * Decide what the apply phase does with the agent job's result (decision 5),
 * BEFORE any artifact is read. For `cancelled` it reads the agent job from the
 * Actions API with `GITHUB_TOKEN` (or the injected `api`) to tell a timeout from
 * a real cancel. `agentTimeoutMinutes` is the trusted lock output
 * (`--agent-timeout-minutes`, else the lock outputs), never the artifact's.
 * Nothing it reads from the API is ever printed.
 */
export function resolveAgentResult(params: {
	result: AgentJobResult;
	held: HeldLock;
	agentTimeoutMinutes?: number;
	api?: GithubApiGet;
	env: NodeJS.ProcessEnv;
}): Promise<AgentResultDecision> {
	return decideAgentResult({
		result: params.result,
		needsAgent: params.held.needsAgent,
		detectTimeout: () =>
			detectAgentTimeout({
				get: params.api ?? githubTokenApiGet(params.env),
				run: actionsRunRefFromEnv(params.env),
				agentTimeoutMinutes:
					params.agentTimeoutMinutes ?? params.held.agentTimeoutMinutes,
			}),
	});
}

/** The result of {@link pushHandoffLfs}. */
export type HandoffLfsPush =
	| {ok: true}
	| {
			ok: false;
			/** True when an object broke a handoff rule (the handoff is rejected). */
			rejected: boolean;
			reason: string;
	  };

/**
 * Run a shared lock acquire whose refusal is BOTH noted and returned as its
 * `message`, which the phase returns as its result line and the CLI prints:
 * its notes are held back until it returns, then every one is passed on except
 * a refusal's own message, so that line appears once in the job log (task
 * `ci-phase-logs-each-line-once`). An acquire is one short arbiter round trip,
 * so holding its notes back does not delay the log noticeably.
 */
export async function acquireNotingOnce<
	R extends {exitCode: number; message: string},
>(
	note: (message: string) => void,
	acquire: (note: (message: string) => void) => Promise<R>,
): Promise<R> {
	const held: string[] = [];
	const result = await acquire((m) => held.push(m));
	for (const m of held) {
		if (result.exitCode === 0 || m !== result.message) note(m);
	}
	return result;
}

/**
 * Push the validated handoff's Git LFS objects to the arbiter (decision 6),
 * the apply phase's FIRST write: before any ref of any intent (a continue push,
 * the land's pushes, a WIP branch save), so a ref never lands pointing at a
 * missing object. Pushed from the apply checkout of the trusted base, so
 * `.lfsconfig` and the endpoint come from main. The caller surfaces the item on
 * a failure (`rejected` when an object broke a handoff rule).
 */
export async function pushHandoffLfs(params: {
	cwd: string;
	arbiter: string;
	objects: readonly HandoffLfsObject[];
	env: NodeJS.ProcessEnv;
	note: (message: string) => void;
}): Promise<HandoffLfsPush> {
	const {cwd, arbiter, objects, env, note} = params;
	if (objects.length === 0) return {ok: true};
	let pushed: {status: number; stderr: string};
	try {
		pushed = await pushLfsObjects({cwd, arbiter, objects, env});
	} catch (err) {
		if (!(err instanceof HandoffRejected)) throw err;
		note(err.message);
		return {ok: false, rejected: true, reason: err.message};
	}
	if (pushed.status !== 0) {
		const reason =
			`the ${objects.length} Git LFS object(s) of the handoff ` +
			`could not be pushed to ${arbiter} (${pushed.stderr.trim().slice(0, 500)}), ` +
			'so no branch of the work was pushed';
		note(reason);
		return {ok: false, rejected: false, reason};
	}
	note(`pushed ${objects.length} Git LFS object(s) to ${arbiter}`);
	return {ok: true};
}

/**
 * The done-move source folder of the task AT `baseSha` (trusted), which picks
 * the land half's ledger reconcile arms exactly as the agent's `complete` did.
 */
export function taskSourceAtBase(
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

async function gitAsyncHard(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
	const r = await runAsync('git', args, cwd, {env});
	if (r.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`,
		);
	}
	return r.stdout;
}
