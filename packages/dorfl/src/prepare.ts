import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {run} from './git.js';
import type {VerifyConfig} from './verify.js';

/**
 * The per-repo ENV-PREP step, the sibling of the `verify` acceptance gate.
 *
 * `prepare` makes a freshly-materialised worktree's environment READY (install
 * dependencies, fetch submodules, run codegen); `verify` checks the tree is
 * GREEN (build, test, format). The runner sequences `prepare` THEN `verify`:
 * `prepare` runs ONCE, before the first `verify`, on a worktree that needs deps
 * but does not yet have them. They are DELIBERATELY distinct steps — install
 * MUST NOT be baked into `verify` (that would make `verify` stop being a pure,
 * cheaply-re-runnable acceptance check and make every gate run pay the install
 * cost). `prepare` is where install belongs; `verify` stays the gate.
 *
 * Like `verify`, `prepare` has NO default command — but the two differ in what
 * "unset" MEANS. An unset `prepare` is a genuine NO-OP (a repo with no deps
 * needs no install — we never invent a default that would run `pnpm install` in
 * a repo that has no lockfile). An unset `verify`, by contrast, is a hard error
 * (a repo MUST declare its acceptance gate; there is no gate to invent). So both
 * are default-free, but unset-prepare passes vacuously while unset-verify FAILS.
 *
 * Like `verify` it is a DECLARED, deterministic shell step (a single command or
 * an ordered list, all must pass) — no model in the loop. It is read-only with
 * respect to `work/`: it readies the env and never moves or commits anything.
 */

/**
 * The declared env-prep step, as configured. A single shell command, or an
 * ordered list of commands run in sequence (each must pass). Same shape as
 * {@link VerifyConfig}. `undefined` (unset) ⇒ NO prepare step (a no-op) — NOT a
 * default install command (the deliberate difference from `verify`).
 */
export type PrepareConfig = VerifyConfig;

/**
 * Resolve the declared env-prep step into an ordered list of shell commands.
 * Unset ⇒ an EMPTY list (a no-op — there is no default install, the key
 * difference from {@link resolveVerifyCommands}). A string ⇒ a single command. A
 * list ⇒ the list, with blank/whitespace-only entries dropped (which can leave
 * an empty list ⇒ still a no-op). Each command is run in sequence; all must pass.
 *
 * Contrast {@link resolveVerifyCommands}, which THROWS on the unset/all-blank
 * case (there is no default gate) rather than resolving to a no-op.
 */
export function resolvePrepareCommands(
	prepare: PrepareConfig | undefined,
): string[] {
	if (prepare === undefined) {
		return [];
	}
	const list = Array.isArray(prepare) ? prepare : [prepare];
	return list.filter((command) => command.trim() !== '');
}

export interface RunPrepareOptions {
	/** The repo/worktree to ready (its working directory). */
	cwd: string;
	/** The declared env-prep step (string | list). Unset ⇒ a no-op. */
	prepare?: PrepareConfig;
	/** Environment for the prepare child processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for streamed stdout chunks. Defaults to `process.stdout.write`. */
	onStdout?: (chunk: string) => void;
	/** Sink for streamed stderr chunks. Defaults to `process.stderr.write`. */
	onStderr?: (chunk: string) => void;
}

export interface RunPrepareResult {
	/** The exit code of the step: 0 iff every command passed (0 when no-op). */
	exitCode: number;
	/** The ordered commands that were run (resolved from config; empty ⇒ no-op). */
	commands: string[];
	/** Whether the step passed (exitCode === 0). A no-op (no commands) passes. */
	passed: boolean;
	/** True iff there was nothing to do (unset / all-blank ⇒ a no-op). */
	noop: boolean;
}

/**
 * Run the resolved env-prep command(s) in `cwd`, streaming output, and resolve
 * with the step's status: exit 0 iff every command passed. Commands run in
 * sequence; the first non-zero exit short-circuits the rest (mirroring `&&`).
 * Each command is run through `bash -c` so shell operators behave as written.
 *
 * An unset / all-blank `prepare` is a NO-OP: it runs nothing and passes (no
 * default install). This keeps the unset behaviour byte-for-byte identical to a
 * repo with no prepare step at all.
 */
export async function runPrepare(
	options: RunPrepareOptions,
): Promise<RunPrepareResult> {
	const commands = resolvePrepareCommands(options.prepare);
	if (commands.length === 0) {
		return {exitCode: 0, commands, passed: true, noop: true};
	}
	const onStdout =
		options.onStdout ?? ((chunk: string) => process.stdout.write(chunk));
	const onStderr =
		options.onStderr ?? ((chunk: string) => process.stderr.write(chunk));

	for (const command of commands) {
		const exitCode = await runOne(command, options.cwd, options.env, {
			onStdout,
			onStderr,
		});
		if (exitCode !== 0) {
			return {exitCode, commands, passed: false, noop: false};
		}
	}
	return {exitCode: 0, commands, passed: true, noop: false};
}

/** Spawn one command via `bash -c`, streaming its output, resolving its code. */
function runOne(
	command: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
	sinks: {onStdout: (chunk: string) => void; onStderr: (chunk: string) => void},
): Promise<number> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn('bash', ['-c', command], {
			cwd,
			env: env ?? process.env,
		});
		child.stdout.on('data', (chunk: Buffer) => {
			sinks.onStdout(chunk.toString('utf8'));
		});
		child.stderr.on('data', (chunk: Buffer) => {
			sinks.onStderr(chunk.toString('utf8'));
		});
		child.on('error', (err) =>
			reject(new Error(`failed to spawn prepare command: ${err.message}`)),
		);
		child.on('close', (code) => {
			resolvePromise(code ?? -1);
		});
	});
}

/**
 * The prepared-ness MARKER: a NON-COMMITTED sentinel that records "this worktree
 * has already been prepared", so a redundant re-install is skipped WITHIN one
 * persistent worktree's lifetime (the gate runs in the SAME worktree the agent
 * built in, so prepare must not pay the install cost twice per job).
 *
 * It lives in the worktree's GIT CONTROL AREA (`<git-dir>/<MARKER_BASENAME>`),
 * NEVER in the repo tree — so it can NEVER be committed (it is outside the work
 * tree git tracks) and is naturally torn down with the worktree. In a linked
 * worktree the git dir is `<mirror>/.git/worktrees/<id>`; in an in-place checkout
 * it is `<repo>/.git`. Either way it is per-worktree and uncommittable.
 *
 * This is the OPTIONAL within-one-worktree skip the task sanctions: it does NOT
 * make `prepare` a durable cross-job cache (a throwaway fresh worktree gets a
 * fresh git dir ⇒ no marker ⇒ prepare runs, which is exactly the per-gate
 * behaviour the dependent fresh-worktree-gate task wants).
 */
export const PREPARE_MARKER_BASENAME = '.dorfl-prepared';

/**
 * Resolve the prepared-ness marker path for `cwd`'s worktree: `<git-dir>/<base>`.
 * Returns `undefined` when `cwd` is not inside a git work tree (e.g. a bare temp
 * dir in a unit test) — callers then simply run prepare without a skip signal.
 */
export function preparedMarkerPath(
	cwd: string,
	env?: NodeJS.ProcessEnv,
): string | undefined {
	const result = run('git', ['rev-parse', '--absolute-git-dir'], cwd, {env});
	if (result.status !== 0) {
		return undefined;
	}
	const gitDir = result.stdout.trim();
	if (gitDir === '') {
		return undefined;
	}
	return join(gitDir, PREPARE_MARKER_BASENAME);
}

/** True iff `cwd`'s worktree carries the prepared-ness marker. */
export function isPrepared(cwd: string, env?: NodeJS.ProcessEnv): boolean {
	const path = preparedMarkerPath(cwd, env);
	return path !== undefined && existsSync(path);
}

/** Write the prepared-ness marker for `cwd`'s worktree (best-effort, no-op if
 * the marker path cannot be resolved). */
export function markPrepared(cwd: string, env?: NodeJS.ProcessEnv): void {
	const path = preparedMarkerPath(cwd, env);
	if (path === undefined) {
		return;
	}
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, new Date().toISOString() + '\n');
}

export interface EnsurePreparedOptions extends RunPrepareOptions {
	/**
	 * Skip the run when the worktree is ALREADY marked prepared (the optional
	 * within-one-worktree skip). Default `true`. Set `false` to force a run (e.g.
	 * a deliberately throwaway worktree that wants prepare every time).
	 */
	useMarker?: boolean;
}

/**
 * Prepare a worktree ONCE before its first `verify`: if it carries the
 * prepared-ness marker (and `useMarker` is on), SKIP (a no-op pass); otherwise
 * run `prepare`, and on success WRITE the marker so a second gate within the same
 * worktree does not re-install. A FAILING prepare never writes the marker (so a
 * retry re-runs it) and surfaces as `passed: false` for the caller to route.
 *
 * An unset/no-op `prepare` neither runs anything nor writes a marker — it stays
 * byte-for-byte today's behaviour.
 */
export async function ensurePrepared(
	options: EnsurePreparedOptions,
): Promise<RunPrepareResult & {skipped: boolean}> {
	const commands = resolvePrepareCommands(options.prepare);
	if (commands.length === 0) {
		return {exitCode: 0, commands, passed: true, noop: true, skipped: false};
	}
	const useMarker = options.useMarker ?? true;
	if (useMarker && isPrepared(options.cwd, options.env)) {
		return {exitCode: 0, commands, passed: true, noop: false, skipped: true};
	}
	const result = await runPrepare(options);
	if (result.passed && useMarker) {
		markPrepared(options.cwd, options.env);
	}
	return {...result, skipped: false};
}
