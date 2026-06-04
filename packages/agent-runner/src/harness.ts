import {spawnSync} from 'node:child_process';

/**
 * The **harness seam** (ADR §5): how a job's command is launched and how its
 * liveness is observed is pluggable behind an adapter; the core never hard-codes
 * a specific tool.
 *
 * Crucially, **liveness is reported by the harness, NOT inferred from filesystem
 * mtime**: a live agent can think for minutes without writing any files, so
 * mtime would mistake a thinking agent for a dead one. Adapters answer liveness
 * from the real signal (the PID, a session handle, …) — never mtime.
 *
 * This slice ships the **null adapter** (records a PID, runs a configured
 * command) so the substrate is testable standalone. The first real target (the
 * `pi` adapter: liveness via PID + a pointer to the pi session dir/log,
 * invocation via the pi CLI) is its own slice.
 */

/**
 * The persisted harness block in a job's `.agent-runner-job.json` record. It
 * captures which adapter launched the job + the liveness pointer the adapter
 * needs to answer `isAlive` later (so `gc`/`status` can re-derive liveness from
 * a fresh process without re-launching). Adapter-specific fields are optional.
 */
export interface HarnessRecord {
	/** Which harness adapter owns this job (`null`, later `pi`, …). */
	adapter: string;
	/** OS process id of the launched command (the liveness anchor). */
	pid?: number;
	/** The command the adapter ran (for audit / re-launch). */
	command?: string;
	/** Adapter-specific session pointer (e.g. the pi session dir/log path). */
	session?: string;
}

/** What a harness needs to launch one job's command. */
export interface LaunchInput {
	/** The job's working directory (the worktree) — the command runs here. */
	dir: string;
	/** The slug being processed (for adapters that name/log per slug). */
	slug: string;
	/** The command to run (e.g. the configured `agentCmd`). */
	command: string;
	/** Optional prompt fed on the command's stdin. */
	prompt?: string;
	env?: NodeJS.ProcessEnv;
}

export interface LaunchResult {
	/** True iff the launched command completed successfully. */
	ok: boolean;
	/** The harness block to persist in the job record (PID, command, …). */
	record: HarnessRecord;
	/** Failure detail when `ok` is false. */
	detail?: string;
}

/**
 * The harness seam. `launch` starts the job's command + returns the record (with
 * the liveness anchor); `isAlive` answers liveness FROM THE HARNESS (PID/session
 * — never mtime, ADR §5).
 */
export interface Harness {
	/** A stable adapter name (`null`, `pi`, …) stamped into the record. */
	readonly adapter: string;
	/** Launch the job's command; record the PID + liveness pointer. */
	launch(input: LaunchInput): LaunchResult;
	/** Is the job still alive? Answered from the record's anchor, NOT mtime. */
	isAlive(record: HarnessRecord): boolean;
}

/**
 * The **null adapter**: runs the configured command synchronously to completion
 * in the job dir, recording the PID. Liveness is `process.kill(pid, 0)` against
 * the recorded PID (the OS process table) — explicitly NOT a file mtime. Because
 * it runs synchronously, the process has already exited by the time `launch`
 * returns, so a finished job reads as not-alive (which is correct).
 */
export class NullHarness implements Harness {
	readonly adapter = 'null';

	launch(input: LaunchInput): LaunchResult {
		const result = spawnSync('bash', ['-c', input.command], {
			cwd: input.dir,
			encoding: 'utf8',
			input: input.prompt,
			env: input.env ?? process.env,
			maxBuffer: 64 * 1024 * 1024,
		});
		if (result.error) {
			throw new Error(
				`failed to spawn harness command: ${result.error.message}`,
			);
		}
		// Record the CHILD's PID (the liveness anchor) — not the runner's. The null
		// adapter runs synchronously, so by the time we return the child has
		// exited, and `isAlive` correctly reads it as not-alive (from the PID
		// table, NOT a file mtime).
		const record: HarnessRecord = {
			adapter: this.adapter,
			pid: result.pid,
			command: input.command,
		};
		const status = result.status ?? -1;
		return {
			ok: status === 0,
			record,
			detail: status === 0 ? undefined : (result.stderr ?? '').trim(),
		};
	}

	isAlive(record: HarnessRecord): boolean {
		return pidAlive(record.pid);
	}
}

/**
 * Is `pid` a live process? Uses signal 0 (`process.kill(pid, 0)`), which checks
 * for existence/permission WITHOUT delivering a signal — the OS process table,
 * never a filesystem mtime. Unknown/undefined PID ⇒ not alive.
 */
export function pidAlive(pid: number | undefined): boolean {
	if (pid === undefined || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means the process exists but we may not signal it ⇒ still alive.
		return (err as NodeJS.ErrnoException).code === 'EPERM';
	}
}
