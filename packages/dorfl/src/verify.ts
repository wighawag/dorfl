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
 *
 * There is NO default gate. A repo MUST declare its own `verify`; an unset gate
 * is a loud failure (`notConfigured`), never a silent `pnpm -r …` fallback that
 * could run the wrong check or pass vacuously.
 */

/**
 * The per-repo gate, as declared in config. A single shell command, or an
 * ordered list of commands run in sequence (each must pass for the gate to
 * pass). `undefined` (unset) is NOT valid: there is NO default gate — a repo
 * MUST declare its own `verify` (see {@link VerifyNotConfiguredError}).
 */
export type VerifyConfig = string | string[];

/**
 * The precise, actionable message emitted whenever a `verify` gate is required
 * but the repo declares none (unset, empty string, or an all-blank list). There
 * is deliberately NO default gate: a silent `pnpm -r build && …` fallback runs
 * the WRONG check in a repo whose real gate is something else (and passes
 * vacuously in a repo pnpm knows nothing about — e.g. `pnpm -r` printing
 * "No projects found" and exiting 0, a FALSE green). Failing loud here forces
 * the repo to declare the gate it actually means.
 */
export const VERIFY_NOT_CONFIGURED_MESSAGE =
	'no `verify` gate is configured for this repo. Dorfl has no default ' +
	'acceptance gate: declare the exact command(s) in `dorfl.json` ' +
	'(e.g. "verify": "pnpm -r build && pnpm -r test && pnpm format:check"), ' +
	'as a single string or an ordered list of commands.';

/**
 * Thrown by {@link resolveVerifyCommands} when a gate is required but none is
 * declared. A typed error (not a bare `Error`) so callers that must translate
 * an unconfigured gate into a routed gate-FAILURE (rather than an uncaught
 * crash) can detect it precisely — see {@link runVerify}, which catches it and
 * returns a failing {@link RunVerifyResult} with `notConfigured: true`.
 */
export class VerifyNotConfiguredError extends Error {
	constructor(message: string = VERIFY_NOT_CONFIGURED_MESSAGE) {
		super(message);
		this.name = 'VerifyNotConfiguredError';
	}
}

/**
 * Resolve the declared gate into an ordered, non-empty list of shell commands.
 * A string ⇒ a single command. A list ⇒ the list, with blank/whitespace-only
 * entries dropped. Each command is run in sequence; all must pass.
 *
 * There is NO default: unset, an empty string, or a list that is empty/all-blank
 * THROWS {@link VerifyNotConfiguredError}. Dorfl never invents an acceptance
 * gate — a repo must declare the exact check it means, so the gate can never
 * silently run the wrong command (or pass vacuously).
 */
export function resolveVerifyCommands(
	verify: VerifyConfig | undefined,
): string[] {
	if (verify === undefined) {
		throw new VerifyNotConfiguredError();
	}
	const list = Array.isArray(verify) ? verify : [verify];
	const commands = list.filter((command) => command.trim() !== '');
	if (commands.length === 0) {
		throw new VerifyNotConfiguredError();
	}
	return commands;
}

export interface RunVerifyOptions {
	/** The repo to run the gate in (its working directory). */
	cwd: string;
	/** The declared gate (string | list). Unset/blank ⇒ a failing, not-configured result. */
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
	/** The ordered commands that were run (resolved from config). Empty when not configured. */
	commands: string[];
	/** Whether the gate passed (exitCode === 0). */
	passed: boolean;
	/**
	 * The EXACT command that failed (the first non-zero exit — `&&`-short-circuit
	 * semantics), verbatim from the resolved gate list. Present ONLY on a failing
	 * result with a configured gate. This is the load-bearing context a bare `exit
	 * N` throws away: in a multi-command gate (`build && test && format:check`) it
	 * tells the human WHICH step failed without re-running the whole gate.
	 */
	failedCommand?: string;
	/**
	 * The TAIL of the failed command's combined stdout+stderr (last
	 * {@link VERIFY_OUTPUT_TAIL_LINES} non-empty lines), so the surfaced
	 * needs-attention question carries the ACTUAL error text (e.g. "no changesets
	 * were found") rather than an opaque exit code. Bounded so a noisy gate cannot
	 * bloat the sidecar. Present ONLY on a failing result with a configured gate.
	 */
	outputTail?: string;
	/**
	 * True iff the gate could not run because NO `verify` is declared (unset /
	 * empty / all-blank). A distinct, always-failing outcome (`passed: false`)
	 * so runner callers route it as a normal gate FAILURE with a clear reason
	 * rather than crashing on the thrown {@link VerifyNotConfiguredError}.
	 */
	notConfigured?: boolean;
}

/**
 * How many trailing non-empty output lines of the FAILED gate command are kept
 * in {@link RunVerifyResult.outputTail}. Small enough to keep the surfaced
 * question readable, large enough to carry the actual error (most tool errors
 * are 1–3 lines). The tail is captured per-command and reset on each command so
 * only the failing command's output is retained.
 */
export const VERIFY_OUTPUT_TAIL_LINES = 20;

/**
 * Run the resolved gate command(s) in `cwd`, streaming output, and resolve with
 * the gate's status: exit 0 iff every command passed. Commands run in sequence;
 * the first non-zero exit short-circuits the rest and becomes the result
 * (mirroring `&&` semantics). Each command is run through `bash -c` so that
 * shell operators in the declared gate (`&&`, pipes, etc.) behave as written.
 *
 * A repo with NO `verify` declared yields a failing result with
 * `notConfigured: true` (never throws): the shared runner call sites
 * (`do`/`run`/`complete` → `performIntegration`) already route a non-passing
 * gate to needs-attention, so an unconfigured gate surfaces the same way with a
 * precise reason instead of an uncaught crash.
 */
export async function runVerify(
	options: RunVerifyOptions,
): Promise<RunVerifyResult> {
	let commands: string[];
	try {
		commands = resolveVerifyCommands(options.verify);
	} catch (err) {
		if (err instanceof VerifyNotConfiguredError) {
			const onStderr =
				options.onStderr ?? ((chunk: string) => process.stderr.write(chunk));
			onStderr(`${err.message}\n`);
			return {exitCode: 1, commands: [], passed: false, notConfigured: true};
		}
		throw err;
	}
	const onStdout =
		options.onStdout ?? ((chunk: string) => process.stdout.write(chunk));
	const onStderr =
		options.onStderr ?? ((chunk: string) => process.stderr.write(chunk));

	for (const command of commands) {
		// Capture a bounded ring of this command's combined output so a FAILURE can
		// carry the actual error text (not just an exit code). Reset per command so
		// only the failing command's tail is retained. The captured chunks still
		// stream through the sinks unchanged (the console/log is unaffected).
		const tail: string[] = [];
		const capture = (chunk: string) => {
			for (const line of chunk.split('\n')) {
				tail.push(line);
			}
			// Keep a little slack over the reported budget; trimmed to the exact budget
			// (non-empty lines only) when a failure surfaces.
			const maxRing = VERIFY_OUTPUT_TAIL_LINES * 4;
			if (tail.length > maxRing) {
				tail.splice(0, tail.length - maxRing);
			}
		};
		const exitCode = await runOne(command, options.cwd, options.env, {
			onStdout: (chunk) => {
				capture(chunk);
				onStdout(chunk);
			},
			onStderr: (chunk) => {
				capture(chunk);
				onStderr(chunk);
			},
		});
		if (exitCode !== 0) {
			return {
				exitCode,
				commands,
				passed: false,
				failedCommand: command,
				outputTail: lastNonEmptyLines(tail, VERIFY_OUTPUT_TAIL_LINES),
			};
		}
	}
	return {exitCode: 0, commands, passed: true};
}

/**
 * Join the last `n` NON-EMPTY lines of a captured output ring into a single
 * string (newline-separated), preserving order. Blank lines are dropped so the
 * tail is dense signal (tool errors, not the trailing whitespace many gates
 * emit). Returns `undefined` when nothing was captured, so callers can omit the
 * context cleanly rather than surfacing an empty block.
 */
function lastNonEmptyLines(lines: string[], n: number): string | undefined {
	const dense = lines
		.map((line) => line.trimEnd())
		.filter((line) => line !== '');
	if (dense.length === 0) {
		return undefined;
	}
	return dense.slice(-n).join('\n');
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
