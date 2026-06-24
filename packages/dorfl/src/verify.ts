import {spawn} from 'node:child_process';

/**
 * The per-repo acceptance gate, run as `dorfl verify`. It is a
 * deterministic shell gate — a declared, per-repo command (or ordered list of
 * commands) — NOT prose interpreted by a model. There is no LLM in this loop:
 * the gate is known by reading config, and it either passes (exit 0) or it does
 * not. This same mechanism is consumed by the human `complete` command (where it
 * is a default-on, `--skip-verify`-able safety-net) and by the autonomous
 * `run-once`/`watch` (where it is the authoritative, non-skippable trust
 * boundary). `verify` itself just runs the gate; callers decide authority.
 *
 * It is read-only with respect to `work/`: it runs the declared check and never
 * moves or commits anything.
 */

/**
 * The per-repo gate, as declared in config. A single shell command, or an
 * ordered list of commands run in sequence (each must pass for the gate to
 * pass). `undefined` (unset) ⇒ {@link DEFAULT_VERIFY_COMMAND} is used.
 */
export type VerifyConfig = string | string[];

/**
 * The sensible default when no `verify` is configured: build, then test, then
 * check formatting across the workspace. Deterministic, auditable, no model.
 */
export const DEFAULT_VERIFY_COMMAND =
	'pnpm -r build && pnpm -r test && pnpm -r format:check';

/**
 * Resolve the declared gate into an ordered, non-empty list of shell commands.
 * Unset ⇒ the default. A string ⇒ a single command. A list ⇒ the list, with
 * blank/whitespace-only entries dropped (and the default substituted if that
 * leaves nothing). Each command is run in sequence; all must pass.
 */
export function resolveVerifyCommands(
	verify: VerifyConfig | undefined,
): string[] {
	if (verify === undefined) {
		return [DEFAULT_VERIFY_COMMAND];
	}
	const list = Array.isArray(verify) ? verify : [verify];
	const commands = list.filter((command) => command.trim() !== '');
	return commands.length > 0 ? commands : [DEFAULT_VERIFY_COMMAND];
}

export interface RunVerifyOptions {
	/** The repo to run the gate in (its working directory). */
	cwd: string;
	/** The declared gate (string | list). Unset ⇒ the default command. */
	verify?: VerifyConfig;
	/** Environment for the gate's child processes. */
	env?: NodeJS.ProcessEnv;
	/** Sink for streamed stdout chunks. Defaults to `process.stdout.write`. */
	onStdout?: (chunk: string) => void;
	/** Sink for streamed stderr chunks. Defaults to `process.stderr.write`. */
	onStderr?: (chunk: string) => void;
}

export interface RunVerifyResult {
	/** The exit code of the gate: 0 iff every command passed. */
	exitCode: number;
	/** The ordered commands that were run (resolved from config). */
	commands: string[];
	/** Whether the gate passed (exitCode === 0). */
	passed: boolean;
}

/**
 * Run the resolved gate command(s) in `cwd`, streaming output, and resolve with
 * the gate's status: exit 0 iff every command passed. Commands run in sequence;
 * the first non-zero exit short-circuits the rest and becomes the result
 * (mirroring `&&` semantics). Each command is run through `bash -c` so that
 * shell operators in the declared gate (`&&`, pipes, etc.) behave as written.
 */
export async function runVerify(
	options: RunVerifyOptions,
): Promise<RunVerifyResult> {
	const commands = resolveVerifyCommands(options.verify);
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
			return {exitCode, commands, passed: false};
		}
	}
	return {exitCode: 0, commands, passed: true};
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
			reject(new Error(`failed to spawn gate command: ${err.message}`)),
		);
		child.on('close', (code) => {
			resolvePromise(code ?? -1);
		});
	});
}
