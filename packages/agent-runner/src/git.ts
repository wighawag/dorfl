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
