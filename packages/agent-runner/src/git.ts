import {spawnSync, spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

/** Result of running a git (or any) command. */
export interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
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
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		input: options.input,
		env: options.env ?? process.env,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error) {
		throw new Error(`failed to spawn '${command}': ${result.error.message}`);
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
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: options.env ?? process.env,
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
			reject(new Error(`failed to spawn '${command}': ${err.message}`)),
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
