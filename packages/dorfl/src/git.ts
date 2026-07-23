import {spawnSync, spawn} from 'node:child_process';
import {existsSync, mkdirSync, statSync} from 'node:fs';
import {delimiter, dirname, isAbsolute, join} from 'node:path';

/** Result of running a git (or any) command. */
export interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

/**
 * The standard system dirs core tools (`git`, `ssh`, `sh`) live in. Some callers
 * launch `dorfl` with a CURATED `PATH` (a version-manager / MCP-agent env that
 * lists only `~/.volta/bin`, `~/.cargo/bin`, `~/.local/bin`, …) that OMITS these.
 * `dorfl` spawns bare `git` (and git in turn may shell out to `ssh`/`sh` for
 * hooks and remote transport), so a `PATH` missing `/usr/bin` produces an opaque
 * mid-run `spawn git ENOENT`. We UNION these onto whatever `PATH` we are given so
 * core tools resolve even under a curated caller `PATH`, without discarding the
 * caller's own entries (a project-pinned `git` earlier on `PATH` still wins).
 */
const SYSTEM_PATH_DIRS = [
	'/usr/local/bin',
	'/usr/bin',
	'/bin',
	'/usr/sbin',
	'/sbin',
];

/**
 * `PATH` with {@link SYSTEM_PATH_DIRS} APPENDED (caller entries kept FIRST, so a
 * pinned tool earlier on `PATH` still wins; missing system dirs are added, not
 * substituted). Deduplicated, preserving first-seen order.
 */
function pathWithSystemDirs(path: string | undefined): string {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const dir of [
		...(path ? path.split(delimiter) : []),
		...SYSTEM_PATH_DIRS,
	]) {
		if (dir !== '' && !seen.has(dir)) {
			seen.add(dir);
			out.push(dir);
		}
	}
	return out.join(delimiter);
}

/**
 * Return `env` with `PATH` hardened via {@link pathWithSystemDirs}, so the
 * spawned tool (and any tool IT shells out to) can find core system binaries
 * even when the caller's `PATH` omitted `/usr/bin`. Returns a COPY — never
 * mutates the caller's env object. `PATH` is looked up case-insensitively so a
 * Windows `Path`/`PATH` split is not silently missed.
 */
function envWithSystemPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const key =
		Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
	return {...env, [key]: pathWithSystemDirs(env[key])};
}

/**
 * Per-effective-PATH cache of the resolved absolute `git` path. Keyed by the
 * effective PATH (+ any `DORFL_GIT`/`GIT` override) so a DIFFERENT env — e.g. a
 * test's PATH-prepended `git` shim, or a project that pins its own git — is
 * resolved AGAINST ITS OWN PATH, never masked by a stale global memo. Bounded in
 * practice (the process uses a handful of distinct envs) and reset in tests.
 */
const gitBinaryCache = new Map<string, string>();

/** Clear the {@link resolveGitBinary} cache (tests only). */
export function resetResolvedGitBinaryForTest(): void {
	gitBinaryCache.clear();
}

/**
 * Resolve the `git` executable to an ABSOLUTE path for a given `env`, robustly —
 * so a caller `PATH` that omits `/usr/bin` cannot produce a mid-run `spawn git
 * ENOENT`, WITHOUT masking a git the caller deliberately put earlier on `PATH`
 * (a project pin, or a test shim). Order:
 *
 *   1. an explicit `DORFL_GIT` / `GIT` env override (an absolute path to a git
 *      binary), for full operator control;
 *   2. a probe of the env's OWN `PATH` FIRST (so a shim / pinned git earlier on
 *      `PATH` wins), then the standard system dirs APPENDED — so `/usr/bin/git`
 *      is still found when the caller dropped `/usr/bin`, but never AHEAD of the
 *      caller's own entries.
 *
 * Falls back to the bare name `'git'` when nothing resolves (git genuinely
 * absent) so the spawn still runs and produces the diagnostic path. Cached PER
 * effective PATH so distinct envs resolve independently.
 */
export function resolveGitBinary(env: NodeJS.ProcessEnv = process.env): string {
	const pathValue = pathWithSystemDirs(env.PATH);
	const cacheKey = `${env.DORFL_GIT ?? ''}\u0000${env.GIT ?? ''}\u0000${pathValue}`;
	const cached = gitBinaryCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}
	const resolved = resolveGitBinaryUncached(env, pathValue);
	gitBinaryCache.set(cacheKey, resolved);
	return resolved;
}

function resolveGitBinaryUncached(
	env: NodeJS.ProcessEnv,
	pathValue: string,
): string {
	for (const override of [env.DORFL_GIT, env.GIT]) {
		if (override && isAbsolute(override) && isExecutableFile(override)) {
			return override;
		}
	}
	const exe = process.platform === 'win32' ? 'git.exe' : 'git';
	for (const dir of pathValue.split(delimiter)) {
		const candidate = join(dir, exe);
		if (isExecutableFile(candidate)) {
			return candidate;
		}
	}
	return 'git'; // unresolved — let the spawn surface the ENOENT diagnostic
}

/** True iff `path` is a regular file (a symlink target is followed by statSync). */
function isExecutableFile(path: string): boolean {
	try {
		return existsSync(path) && statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * Resolve a command + harden its spawn env: bare `'git'` is replaced by the
 * absolute {@link resolveGitBinary} path, and the spawn env's `PATH` is unioned
 * with the standard system dirs so git's own child processes (hooks, `ssh`) also
 * resolve. Any OTHER command is passed through unchanged (only its `PATH` is
 * hardened). This is the single choke-point both {@link run} and
 * {@link runAsync} funnel through, so every git spawn in the codebase inherits
 * the robust resolution for free.
 */
function resolveSpawn(
	command: string,
	env: NodeJS.ProcessEnv,
): {command: string; env: NodeJS.ProcessEnv} {
	const hardenedEnv = envWithSystemPath(env);
	const resolved = command === 'git' ? resolveGitBinary(hardenedEnv) : command;
	return {command: resolved, env: hardenedEnv};
}

/**
 * Build the spawn-failure message. A plain `spawn git ENOENT` is OPAQUE (it does
 * not say WHY git was not found); for the `ENOENT` case we surface the effective
 * `PATH` and point at `DORFL_GIT`, so a curated caller `PATH` that omits the
 * system dirs is diagnosable at a glance instead of mid-run. Other spawn errors
 * pass through with the original message.
 */
function spawnErrorMessage(
	command: string,
	resolved: string,
	env: NodeJS.ProcessEnv,
	err: Error & {code?: string},
): string {
	if (err.code === 'ENOENT') {
		const path =
			env[Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'] ??
			'';
		const hint =
			command === 'git'
				? `Is git installed and on PATH? Set DORFL_GIT to an absolute git path, or add its dir to PATH. `
				: `Is it installed and on PATH? `;
		return (
			`failed to spawn '${command}': not found (tried '${resolved}'). ` +
			hint +
			`Effective PATH=${path}`
		);
	}
	return `failed to spawn '${command}': ${err.message}`;
}

/**
 * Run a command synchronously in `cwd`, capturing output. A non-zero exit is NOT
 * thrown here — callers inspect `status` (claim.sh's exit codes are meaningful).
 */
export function run(
	command: string,
	args: string[],
	cwd: string,
	options: {input?: string; env?: NodeJS.ProcessEnv} = {},
): RunResult {
	const {command: exe, env} = resolveSpawn(command, options.env ?? process.env);
	const result = spawnSync(exe, args, {
		cwd,
		encoding: 'utf8',
		input: options.input,
		env,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error) {
		throw new Error(spawnErrorMessage(command, exe, env, result.error));
	}
	return {
		status: result.status ?? -1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

/**
 * Async variant of {@link run}: spawns the command WITHOUT blocking the event
 * loop, so two awaited calls genuinely run concurrently. Used to verify the
 * claim race the way claim.sh's own verification does (truly simultaneous).
 */
export function runAsync(
	command: string,
	args: string[],
	cwd: string,
	options: {input?: string; env?: NodeJS.ProcessEnv} = {},
): Promise<RunResult> {
	const {command: exe, env} = resolveSpawn(command, options.env ?? process.env);
	return new Promise((resolvePromise, reject) => {
		const child = spawn(exe, args, {
			cwd,
			env,
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});
		child.on('error', (err) =>
			reject(new Error(spawnErrorMessage(command, exe, env, err))),
		);
		child.on('close', (code) => {
			resolvePromise({status: code ?? -1, stdout, stderr});
		});
		if (options.input !== undefined) {
			child.stdin.end(options.input);
		} else {
			child.stdin.end();
		}
	});
}

/** Run `git <args>` in `cwd`; throws on non-zero exit (use `run` for soft checks). */
export function git(
	args: string[],
	cwd: string,
	options: {input?: string; env?: NodeJS.ProcessEnv} = {},
): string {
	const result = run('git', args, cwd, options);
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`,
		);
	}
	return result.stdout;
}

/**
 * Move a tracked file with `git mv`, creating the destination directory first
 * (`mkdir -p`). The `work/` contract requires this: git does not track empty
 * dirs, so `work/done/` (or `work/in-progress/`) may not exist yet. No
 * `.gitkeep` placeholders — the mover owns dir creation.
 */
export function gitMv(from: string, to: string, cwd: string): void {
	mkdirSync(dirname(toAbsolute(cwd, to)), {recursive: true});
	git(['mv', from, to], cwd);
}

function toAbsolute(cwd: string, p: string): string {
	return p.startsWith('/') ? p : `${cwd}/${p}`;
}

/**
 * The pre-flight DIVERGENCE check for the in-place ff paths (`do` /
 * `complete --merge`): how many commits local `main` is AHEAD of
 * `<arbiter>/main` (`git rev-list --count <arbiter>/main..main`). A non-zero
 * count means local `main` carries UNPUSHED commits the arbiter lacks — the task
 * builds off `<arbiter>/main`, so its merge-back ff cannot apply, exactly the
 * "checkout state that breaks the in-place flow" class the dirty-tree refusal
 * guards. Returns 0 when local `main` is at/behind the arbiter (safe).
 *
 * Best-effort / SAFE-direction: if either ref cannot be resolved (no local
 * `main`, an unreachable arbiter that left `<arbiter>/main` absent) the count
 * cannot be computed, so we read it as 0 (do NOT block on an unknown) — the
 * caller is expected to have fetched first, and a genuinely diverged main is the
 * case we DO catch. Read-only.
 */
export async function localMainAheadCount(
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<number> {
	const res = await runAsync(
		'git',
		['rev-list', '--count', `${arbiter}/main..main`],
		cwd,
		{env},
	);
	if (res.status !== 0) {
		return 0; // a ref did not resolve — cannot compute; do not block (safe).
	}
	const n = Number.parseInt(res.stdout.trim(), 10);
	return Number.isFinite(n) ? n : 0;
}

/** How far local `main` has diverged from `<arbiter>/main`, both directions. */
export interface LocalMainDivergence {
	/** Commits on local `main` the arbiter lacks (UNPUSHED — `main-divergence-guard`). */
	ahead: number;
	/** Commits on `<arbiter>/main` the local `main` lacks (behind — needs a pull/rebase). */
	behind: number;
}

/**
 * Read the DIVERGENCE of local `main` vs `<arbiter>/main` in BOTH directions
 * (`git rev-list --left-right --count <arbiter>/main...main`): `ahead` =
 * unpushed local commits the arbiter lacks (the `main-divergence-guard`
 * framing), `behind` = arbiter commits the local tree lacks. This is the honest
 * expression of the LOCAL working tree's staleness relative to the arbiter — the
 * source of truth — for the cwd-local section of `scan`/`status` (it labels the
 * section as possibly ahead of / behind the fetched arbiter `main`).
 *
 * Best-effort / SAFE: if either ref cannot be resolved (no local `main`, an
 * unreachable arbiter so `<arbiter>/main` is absent) the divergence cannot be
 * computed, so it reads as `{ahead: 0, behind: 0}` (in sync) — never throws. The
 * caller is expected to have fetched the arbiter first; a genuinely diverged
 * `main` is the case we DO catch. Read-only.
 */
export async function localMainDivergence(
	cwd: string,
	arbiter: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LocalMainDivergence> {
	const res = await runAsync(
		'git',
		['rev-list', '--left-right', '--count', `${arbiter}/main...main`],
		cwd,
		{env},
	);
	if (res.status !== 0) {
		return {ahead: 0, behind: 0}; // a ref did not resolve — read as in sync (safe).
	}
	// `--left-right --count A...B` prints `<behind>\t<ahead>` (left = A=arbiter
	// commits B lacks = behind; right = B=local commits A lacks = ahead).
	const parts = res.stdout.trim().split(/\s+/);
	const behind = Number.parseInt(parts[0] ?? '', 10);
	const ahead = Number.parseInt(parts[1] ?? '', 10);
	return {
		ahead: Number.isFinite(ahead) ? ahead : 0,
		behind: Number.isFinite(behind) ? behind : 0,
	};
}
