import {spawnSync} from 'node:child_process';
import {brand} from './brand.js';
import {
	resolveRepoConfigPath,
	loadRepoConfig,
	REPO_CONFIG_FILENAME,
} from './repo-config.js';

/**
 * The bootstrap self-forward (spec `dorfl-self-version-pinning-and-bootstrap-forward`
 * §2/§4; task `dorfl-bootstrap-self-forward`, stories 1/4/5).
 *
 * The globally-installed `dorfl` is a thin BOOTSTRAP. On startup, BEFORE any
 * command dispatch, it reads the nearest repo `dorfl.json`; if that repo declares
 * a `dorflCmd` (and we are not already the forwarded process), it `exec`s that
 * command with the ORIGINAL argv + env inherited, after a one-line STDERR notice,
 * and returns the child's exit code (transparent passthrough).
 *
 * This module is the INJECTABLE seam: {@link decideForward} makes the pure
 * decision (run-self / forward / error / opt-out) from argv + env + a config
 * reader, and {@link performForward} does the exec through an injected spawn
 * function — so the whole path is unit-testable WITHOUT re-execing a real second
 * dorfl or hitting the network (mirroring how git/agent seams are injected in
 * tests). {@link maybeForward} wires the two for the CLI entry point.
 *
 * Load-bearing safety fact (spec §2, task): the forward decision fires ONCE, at
 * bare-`dorfl` startup, in the CHECKOUT ROOT — it is NOT recursive. The gate
 * worktree that runs `prepare`/`verify` is created + prepared by the
 * ALREADY-RUNNING dorfl, which runs the repo's commands via
 * `spawn('bash', ['-c', cmd], {cwd: worktreeDir})` (`prepare.ts`/`verify.ts`) —
 * it never launches a new `dorfl`, so a fresh worktree's empty `node_modules`
 * never re-triggers the forward. Therefore a declared-but-ABSENT `dorflCmd` at
 * the top level is almost always a MISCONFIGURATION (the repo's install did not
 * run), and we FAIL LOUD (decision 2026-07-21, option B) rather than silently
 * degrade to the global and run the WRONG version.
 */

/**
 * The env marker set on the FORWARDED child so it does not forward AGAIN forever
 * (loop-safe). The forwarded dorfl reads the SAME `dorfl.json` (same `dorflCmd`);
 * seeing this marker it runs in-process instead of re-execing. `DORFL_` prefixed
 * from the single brand identity so a rename flips it in lockstep.
 */
export const FORWARDED_ENV_MARKER = `${brand.envPrefix}FORWARDED`;

/**
 * The opt-out env var (spec §4). `DORFL_NO_FORWARD=1` (or any truthy value)
 * DISABLES forwarding AND suppresses the notice — the bootstrap/global runs
 * as-is, so a user can always reach the bootstrap dorfl directly.
 */
export const NO_FORWARD_ENV = `${brand.envPrefix}NO_FORWARD`;

/**
 * The opt-out CLI flag (spec §4). `--no-forward` DISABLES forwarding AND
 * suppresses the notice, exactly like {@link NO_FORWARD_ENV}. It is honoured
 * BEFORE command dispatch and STRIPPED from the argv commander parses (commander
 * never sees it — it is a bootstrap-level flag, not a per-command option).
 */
export const NO_FORWARD_FLAG = '--no-forward';

/** The pure forward DECISION — what the bootstrap should do at startup. */
export type ForwardDecision =
	| {kind: 'run-self'; reason: 'no-cmd' | 'already-forwarded' | 'opted-out'}
	| {kind: 'forward'; cmd: string; configPath: string}
	| {kind: 'error'; message: string};

/**
 * Read the nearest repo's declared `dorflCmd` for `cwd`. Returns the resolved
 * command (trimmed / empty⇒undefined via the config layer) and the `dorfl.json`
 * path it was read from. A missing/config-less repo ⇒ `{cmd: undefined}`. The
 * default reader; tests inject a stub instead of touching the filesystem.
 */
export interface RepoCmdReader {
	(cwd: string): {cmd: string | undefined; configPath: string};
}

/** The default {@link RepoCmdReader}: read the cwd's `dorfl.json` `dorflCmd`. */
export function defaultRepoCmdReader(cwd: string): {
	cmd: string | undefined;
	configPath: string;
} {
	const configPath = resolveRepoConfigPath(cwd);
	const loaded = loadRepoConfig(cwd);
	// `loadRepoConfig` carries `dorflCmd` verbatim from the file; the config-layer
	// trim/empty⇒unset normalisation runs at full resolution, but for the bootstrap
	// decision we only need the raw presence + trimmed value, so normalise here too.
	const raw = loaded.config.dorflCmd;
	const cmd =
		typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
	return {cmd, configPath: loaded.path ?? configPath};
}

/**
 * True iff the ORIGINAL argv carries the {@link NO_FORWARD_FLAG} opt-out. Read
 * from raw argv BEFORE commander parses (commander never sees this bootstrap
 * flag). Only the exact `--no-forward` token counts.
 */
export function argvHasNoForward(argv: readonly string[]): boolean {
	return argv.includes(NO_FORWARD_FLAG);
}

/** True iff the env carries a truthy {@link NO_FORWARD_ENV} opt-out. */
export function envHasNoForward(env: NodeJS.ProcessEnv): boolean {
	const value = env[NO_FORWARD_ENV];
	return value !== undefined && value !== '' && value !== '0';
}

/** True iff the env carries the {@link FORWARDED_ENV_MARKER} (we ARE the child). */
export function envIsForwarded(env: NodeJS.ProcessEnv): boolean {
	const value = env[FORWARDED_ENV_MARKER];
	return value !== undefined && value !== '' && value !== '0';
}

/**
 * Return `argv` with EVERY {@link NO_FORWARD_FLAG} token removed, so commander
 * (which does not declare `--no-forward` as an option) never sees it. Preserves
 * order + all other tokens. Used to hand a clean argv to the in-process run when
 * the opt-out is set.
 */
export function stripNoForwardFlag(argv: readonly string[]): string[] {
	return argv.filter((token) => token !== NO_FORWARD_FLAG);
}

/**
 * The PURE forward decision (no I/O beyond the injected `readRepoCmd`). Given the
 * original argv + env + cwd, decide whether the bootstrap should run itself,
 * forward to a `dorflCmd`, or (a declared-but-unusable command) surface an error.
 * The forward is fired ONCE here at startup; the returned decision is acted on by
 * {@link performForward}.
 *
 * Order of precedence:
 *   1. OPT-OUT (`--no-forward` OR `DORFL_NO_FORWARD`) ⇒ run-self, silent.
 *   2. ALREADY-FORWARDED (the child's env marker) ⇒ run-self, silent (loop-safe).
 *   3. NO `dorflCmd` declared ⇒ run-self (onboarding-safe; never chicken-and-egg).
 *   4. A `dorflCmd` is declared ⇒ forward to it.
 *
 * NOTE: this decision never itself resolves whether the target BINARY exists —
 * that is the exec's job ({@link performForward}), which FAILS LOUD on a spawn
 * error (the absent / present-but-broken pin). Keeping the decision pure lets a
 * test drive every branch without a filesystem probe.
 */
export function decideForward(options: {
	argv: readonly string[];
	env: NodeJS.ProcessEnv;
	cwd: string;
	readRepoCmd: RepoCmdReader;
}): ForwardDecision {
	const {argv, env, cwd, readRepoCmd} = options;

	if (argvHasNoForward(argv) || envHasNoForward(env)) {
		return {kind: 'run-self', reason: 'opted-out'};
	}
	if (envIsForwarded(env)) {
		return {kind: 'run-self', reason: 'already-forwarded'};
	}

	const {cmd, configPath} = readRepoCmd(cwd);
	if (cmd === undefined) {
		return {kind: 'run-self', reason: 'no-cmd'};
	}
	return {kind: 'forward', cmd, configPath};
}

/**
 * The injected exec seam. Runs `cmd` (through the shell so `npx dorfl@x` /
 * `mise exec dorfl@x --` / `node_modules/.bin/dorfl` all behave as written) with
 * the given argv appended, the given env (which carries the
 * {@link FORWARDED_ENV_MARKER} so the child does not forward again), inheriting
 * stdio. Returns the child's exit code, or a spawn ERROR (target absent / not
 * executable) which {@link performForward} turns into the loud, actionable error.
 *
 * Tests inject a stub that never touches a real process; the default
 * ({@link defaultForwardSpawn}) uses `spawnSync('bash', ['-c', ...])`.
 */
export interface ForwardSpawn {
	(options: {
		cmd: string;
		forwardedArgs: readonly string[];
		env: NodeJS.ProcessEnv;
	}): ForwardSpawnResult;
}

/** The result of the injected {@link ForwardSpawn}. */
export type ForwardSpawnResult =
	| {kind: 'exited'; code: number}
	| {kind: 'spawn-error'; message: string};

/**
 * The default {@link ForwardSpawn}: run `<cmd> <forwardedArgs...>` via
 * `bash -c "<cmd> \"$@\"" bash <args...>` with inherited stdio, returning the
 * child's exit code. A spawn error (`error` set — e.g. bash missing) or a shell
 * "command not found" (exit 127) is reported as `spawn-error` so an absent /
 * broken `dorflCmd` fails loud rather than silently degrading.
 */
export function defaultForwardSpawn(options: {
	cmd: string;
	forwardedArgs: readonly string[];
	env: NodeJS.ProcessEnv;
}): ForwardSpawnResult {
	// `bash -c '<cmd> "$@"' bash <forwardedArgs...>` passes the ORIGINAL argv
	// through as positional params (quoting-safe) AFTER the (possibly multi-token)
	// dorflCmd — so `npx dorfl@x <args>` and `./bin/dorfl <args>` both work.
	const result = spawnSync(
		'bash',
		['-c', `${options.cmd} "$@"`, 'bash', ...options.forwardedArgs],
		{env: options.env, stdio: 'inherit'},
	);
	if (result.error) {
		return {kind: 'spawn-error', message: result.error.message};
	}
	// 127 is the shell's "command not found" — the ABSENT-target case (e.g.
	// `node_modules/.bin/dorfl` before install). Surface it as a spawn error so it
	// fails loud, NOT a silent passthrough of a misleading exit code.
	if (result.status === 127) {
		return {kind: 'spawn-error', message: `command not found: ${options.cmd}`};
	}
	if (result.signal) {
		return {
			kind: 'spawn-error',
			message: `terminated by signal ${result.signal}`,
		};
	}
	return {kind: 'exited', code: result.status ?? 1};
}

/** The one-line STDERR notice announcing a forward (never stdout — must not
 * corrupt `--json`). Shape per spec §4. */
export function forwardNotice(cmd: string, configPath: string): string {
	return `${brand.bin}: forwarding to \`${cmd}\` (from ${configPath})`;
}

/**
 * The loud, actionable error for a declared-but-unusable `dorflCmd` (absent
 * target, or a present binary that spawn-errors). Names the `dorflCmd` value +
 * the `dorfl.json` path + the FIX (run the dependency install first) + the
 * `--no-forward` / `DORFL_NO_FORWARD` bypass — so it is never a silent degrade to
 * the global (which would run the WRONG version and defeat the pin).
 */
export function forwardFailureMessage(options: {
	cmd: string;
	configPath: string;
	detail: string;
}): string {
	const {cmd, configPath, detail} = options;
	return (
		`${brand.bin}: could NOT run the repo-declared dorflCmd \`${cmd}\` ` +
		`(from ${configPath}): ${detail}.\n` +
		`This usually means the repo's dependencies are not installed yet ` +
		`(e.g. \`${cmd}\` points at node_modules/.bin/dorfl before install). ` +
		`Run the repo's dependency install first (e.g. \`pnpm install\`, or the ` +
		`CI project-setup hook), then re-run.\n` +
		`To bypass the forward and run the bootstrap ${brand.bin} directly, pass ` +
		`${NO_FORWARD_FLAG} or set ${NO_FORWARD_ENV}=1 ` +
		`(this runs whatever ${brand.bin} is on PATH — NOT the pinned version).`
	);
}

/** What {@link performForward} tells the caller to do next. */
export type ForwardOutcome =
	/** A forward happened; exit the process with this code (transparent passthrough). */
	| {kind: 'forwarded'; exitCode: number}
	/** The forward could not run; print `message` to stderr and exit non-zero. */
	| {kind: 'error'; message: string; exitCode: number}
	/** No forward — the caller runs the bootstrap itself with `argv`. */
	| {kind: 'run-self'; argv: string[]};

/**
 * Act on a {@link ForwardDecision}: for a `forward`, print the notice to STDERR,
 * spawn the child (via the injected `spawn`) with the {@link FORWARDED_ENV_MARKER}
 * set + the ORIGINAL argv appended, and return the child's exit code — or, on a
 * spawn error, the loud actionable failure. For `run-self`, return the (opt-out-
 * stripped) argv for the caller to parse in-process.
 *
 * `argv` here is the FULL process argv (`[node, script, ...userArgs]`); only the
 * USER args (index 2+) are forwarded to the child, since the child provides its
 * own node + script.
 */
export function performForward(options: {
	decision: ForwardDecision;
	argv: readonly string[];
	env: NodeJS.ProcessEnv;
	spawn: ForwardSpawn;
	writeNotice: (line: string) => void;
}): ForwardOutcome {
	const {decision, argv, env, spawn, writeNotice} = options;

	if (decision.kind === 'run-self') {
		return {kind: 'run-self', argv: stripNoForwardFlag(argv)};
	}
	if (decision.kind === 'error') {
		return {kind: 'error', message: decision.message, exitCode: 1};
	}

	// A forward. The user args are everything after `[node, script]`.
	const forwardedArgs = argv.slice(2);
	writeNotice(forwardNotice(decision.cmd, decision.configPath));

	const childEnv: NodeJS.ProcessEnv = {...env, [FORWARDED_ENV_MARKER]: '1'};
	const result = spawn({cmd: decision.cmd, forwardedArgs, env: childEnv});

	if (result.kind === 'spawn-error') {
		return {
			kind: 'error',
			message: forwardFailureMessage({
				cmd: decision.cmd,
				configPath: decision.configPath,
				detail: result.message,
			}),
			exitCode: 1,
		};
	}
	return {kind: 'forwarded', exitCode: result.code};
}

/**
 * The CLI-entry wiring: decide + (if forwarding) exec, all through the default
 * seams. Returns the {@link ForwardOutcome} the entry point acts on — a
 * `forwarded`/`error` outcome means "exit with this code now"; a `run-self`
 * outcome means "continue into commander with this argv". Kept thin so the entry
 * point stays a two-line hook; the testable logic lives in {@link decideForward}
 * + {@link performForward}.
 */
export function maybeForward(options: {
	argv?: readonly string[];
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	readRepoCmd?: RepoCmdReader;
	spawn?: ForwardSpawn;
	writeNotice?: (line: string) => void;
}): ForwardOutcome {
	const argv = options.argv ?? process.argv;
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	const readRepoCmd = options.readRepoCmd ?? defaultRepoCmdReader;
	const spawn = options.spawn ?? defaultForwardSpawn;
	const writeNotice =
		options.writeNotice ??
		((line: string) => process.stderr.write(line + '\n'));

	let decision: ForwardDecision;
	try {
		decision = decideForward({argv, env, cwd, readRepoCmd});
	} catch (err) {
		// A malformed `dorfl.json` (invalid JSON / non-string dorflCmd) surfaces as
		// a loud error rather than a silent run-self, so a broken pin config is never
		// masked. `REPO_CONFIG_FILENAME` names the file in the message.
		return {
			kind: 'error',
			message:
				`${brand.bin}: could not read ${REPO_CONFIG_FILENAME} to decide the ` +
				`bootstrap forward: ${err instanceof Error ? err.message : String(err)}. ` +
				`Fix ${REPO_CONFIG_FILENAME}, or pass ${NO_FORWARD_FLAG} / set ` +
				`${NO_FORWARD_ENV}=1 to run the bootstrap ${brand.bin} directly.`,
			exitCode: 1,
		};
	}

	return performForward({decision, argv, env, spawn, writeNotice});
}
