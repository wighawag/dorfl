import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {
	NullHarness,
	pidAlive,
	registerHarness,
	type Harness,
	type HarnessRecord,
	type LaunchInput,
	type LaunchResult,
} from './harness.js';
import type {HarnessAdapter} from './config.js';

/**
 * The **pi** harness adapter (ADR §5) — the first real agent harness
 * `agent-runner` drives. It fulfils the harness seam introduced by
 * `agent-workspaces` (`./harness.ts`): launch a job's work-agent command in its
 * worktree, and report liveness from **pi-native signals**.
 *
 * Two design commitments from the slice + ADR §5, both encoded here:
 *
 *  1. **Invocation** is the standard work-agent prompt (the constant wrapper +
 *     the slice's `## Prompt`, assembled by `./prompt.ts`) fed to the pi CLI on
 *     stdin, running non-interactively (`--print`) inside the job worktree.
 *  2. **Liveness** is reported from the **PID** (process alive?) PLUS a pointer
 *     to the pi **session log** (real activity + an audit trail) — explicitly
 *     **NOT filesystem mtime**: a live agent can think for minutes without
 *     writing any files, so mtime would mistake a thinking agent for a dead one.
 *
 * pi specifics stay BEHIND this adapter; the core (`run`, `status`, `watch`)
 * talks only to the `Harness` interface. Where running real pi in CI is
 * impractical, the pi CLI is stubbed (see `pi-harness.test.ts`) via the
 * injectable `piBin`.
 *
 * ## Session location: `--session <full-path>` (NOT `--session-dir`)
 *
 * The adapter passes pi a deterministic FULL session-FILE path via
 * `--session <path>` (an absolute `.jsonl` path the CALLER generated — see
 * `session-path.ts`/`LaunchInput.session`), NOT a `--session-dir` pinned into
 * the worktree. pi creates+writes the session at exactly that path, and the
 * recorded {@link PiHarnessRecord.session} is that path (the liveness/audit
 * anchor `gc`/`status` read). This keeps sessions visible to the pi-remote
 * dashboard (default under pi's managed root), eliminates the `do --watch`
 * stale-file race (the path is known before pi starts), and stops polluting the
 * in-place checkout. pi is STILL spawned with `cwd: input.dir` so the new
 * session's header `cwd` groups it under the right repo (the folder does not
 * imply the repo). When no `session` is supplied (legacy/edge callers) the
 * adapter passes no session flag and pi falls back to its own default.
 *
 * ## Seam contract (what an adapter promises the core)
 *
 *  - `launch(input)` runs the work-agent command for ONE job in `input.dir`
 *    (the worktree), feeding `input.prompt` to the agent. It returns
 *    `{ok, record, detail?}`: `ok` iff the agent completed successfully, and a
 *    `record` to persist in `.agent-runner-job.json` carrying the **liveness
 *    anchor** (`pid`) plus an adapter-specific `session` pointer. The core treats
 *    the call as blocking (it runs the test gate immediately after) — like the
 *    null adapter, pi runs to completion here, so by the time `launch` returns
 *    the agent is done and `isAlive` correctly reads it as not-alive.
 *  - `isAlive(record)` answers liveness FROM THE RECORD'S ANCHOR (PID/session),
 *    never mtime, so a separate `status`/`watch` process can re-derive liveness
 *    from a fresh process WITHOUT re-launching the agent.
 */

/** The default pi CLI binary name (resolved on `PATH`). */
export const DEFAULT_PI_BIN = 'pi';

export interface PiHarnessOptions {
	/**
	 * The pi CLI binary (default `pi` on `PATH`). Tests inject a stub script here
	 * so the seam can be exercised without a real model call / network.
	 */
	piBin?: string;
	/**
	 * Extra arguments inserted before the `--print` invocation (e.g. a pinned
	 * `--model`). The adapter always supplies `--print` + `--session <path>`
	 * (when a session path is given); these layer on top for operator control.
	 */
	extraArgs?: string[];
}

/**
 * The pi harness block persisted in a job record. It extends the base
 * {@link HarnessRecord} with pi's concrete liveness pointer — the **session
 * file** — alongside the PID. `gc`/`status` re-derive liveness from these without
 * re-launching pi.
 */
export interface PiHarnessRecord extends HarnessRecord {
	adapter: 'pi';
	/** Absolute path to the pi session `.jsonl` (the activity + audit pointer). */
	session?: string;
}

/**
 * Build the pi argv for one launch. `--print` (non-interactive) is always
 * present; `--session <path>` is added verbatim when the caller supplied an
 * absolute `.jsonl` session path (the common case — generated up front so the
 * watcher can tail it and so it is dashboard-visible). The model ROUTING intent
 * (ADR §13), when set, is passed NATIVELY as `--model <model>`; operator
 * `extraArgs` layer on top.
 */
function piArgs(
	extraArgs: string[],
	input: LaunchInput,
): {args: string[]; session: string | undefined} {
	const modelArgs =
		input.model !== undefined && input.model !== ''
			? ['--model', input.model]
			: [];
	const sessionArgs =
		input.session !== undefined && input.session !== ''
			? ['--session', input.session]
			: [];
	return {
		args: [...modelArgs, ...extraArgs, '--print', ...sessionArgs],
		session: input.session,
	};
}

/**
 * The pi adapter. Invocation: `pi [--model <model>] --print --session <path>
 * [extra]` run in the worktree with the work-agent prompt on stdin. The model is
 * passed NATIVELY as `--model <model>` when set (ADR §13 — the routing intent
 * agent-runner controls); auth/keys stay pi's job, never agent-runner's.
 * Liveness: the PID is the authoritative "is it running?" signal; the recorded
 * `session` `.jsonl` is the activity + audit pointer surfaced alongside it.
 * NEVER mtime (ADR §5).
 */
export class PiHarness implements Harness {
	readonly adapter = 'pi';
	private readonly piBin: string;
	private readonly extraArgs: string[];

	constructor(options: PiHarnessOptions = {}) {
		this.piBin = options.piBin ?? DEFAULT_PI_BIN;
		this.extraArgs = options.extraArgs ?? [];
	}

	launch(input: LaunchInput): LaunchResult {
		// Non-interactive (`--print`): pi processes the prompt and exits. We pass the
		// caller-generated FULL session path via `--session <path>` (pi creates+writes
		// it there), so the recorded pointer is deterministic, the session is
		// dashboard-visible, and the in-place checkout is not polluted.
		const {args, session} = piArgs(this.extraArgs, input);
		const result = spawnSync(this.piBin, args, {
			cwd: input.dir,
			encoding: 'utf8',
			input: input.prompt,
			env: input.env ?? process.env,
			maxBuffer: 64 * 1024 * 1024,
		});
		if (result.error) {
			throw new Error(
				`failed to spawn pi (${this.piBin}): ${result.error.message}`,
			);
		}
		// Record the pi child's PID (the liveness anchor) + the session file pointer
		// (the pi-native activity + audit trail). Liveness later reads these — NOT a
		// filesystem mtime (ADR §5).
		const record: PiHarnessRecord = {
			adapter: 'pi',
			pid: result.pid,
			command: [this.piBin, ...args].join(' '),
			session,
		};
		const status = result.status ?? -1;
		return {
			ok: status === 0,
			record,
			detail: status === 0 ? undefined : (result.stderr ?? '').trim(),
		};
	}

	/**
	 * The ASYNC twin of {@link launch} — IDENTICAL semantics (same `--print
	 * --session` invocation, same prompt on stdin, output still CAPTURED, same
	 * `LaunchResult` shape: PID anchor + session pointer + ok/detail), but launched
	 * NON-BLOCKING with `spawn` instead of the synchronous `spawnSync`. This is the
	 * one structural carve-out the `do --watch` observer needs (slice `do-watch`):
	 * `spawnSync` blocks the event loop until pi exits, so NOTHING could tail the
	 * growing session `.jsonl` concurrently. `launchAsync` runs pi alongside the
	 * tailer; the WHOLE launch delta is `spawnSync` → `spawn`. It is NOT a switch
	 * to inherited-stdio piping (that is the separate future `--agent` seam) — the
	 * prompt is still fed on stdin and stdout/stderr are still captured; we read
	 * the `.jsonl` LOG, never piped stdout. With or without `--watch` the run's
	 * outcome/gate/git/exit are identical.
	 */
	launchAsync(input: LaunchInput): Promise<LaunchResult> {
		const {args, session} = piArgs(this.extraArgs, input);
		const record: PiHarnessRecord = {
			adapter: 'pi',
			command: [this.piBin, ...args].join(' '),
			session,
		};
		return new Promise<LaunchResult>((resolve, reject) => {
			const child = spawn(this.piBin, args, {
				cwd: input.dir,
				env: input.env ?? process.env,
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			record.pid = child.pid; // the liveness anchor, recorded like spawnSync.
			let stderr = '';
			child.stderr?.on('data', (chunk: Buffer) => {
				stderr += chunk.toString('utf8');
			});
			// Output is CAPTURED (not piped through) — `--watch` reads the .jsonl log,
			// not stdout. We drain stdout so the pipe never fills and stalls pi.
			child.stdout?.on('data', () => {});
			child.on('error', (err) => {
				reject(new Error(`failed to spawn pi (${this.piBin}): ${err.message}`));
			});
			child.on('close', (code) => {
				const status = code ?? -1;
				resolve({
					ok: status === 0,
					record,
					detail: status === 0 ? undefined : stderr.trim(),
				});
			});
			// Feed the same prepared prompt on stdin, then close it (pi reads to EOF).
			if (input.prompt !== undefined) {
				child.stdin?.write(input.prompt);
			}
			child.stdin?.end();
		});
	}

	/**
	 * Liveness from pi-native signals (ADR §5): the PID (`process.kill(pid, 0)`,
	 * the OS process table) answers "is the agent process running?" — the
	 * authoritative signal. NEVER filesystem mtime. The recorded session `.jsonl`
	 * is the audit/activity pointer surfaced alongside (see {@link sessionPointer}).
	 */
	isAlive(record: HarnessRecord): boolean {
		return pidAlive(record.pid);
	}

	/**
	 * The recorded pi session `.jsonl` pointer for a job — the pi-native activity +
	 * audit trail surfaced alongside PID liveness. `undefined` when the record has
	 * no session pointer (e.g. a non-pi or legacy record). Existence on disk is
	 * reported separately so callers can distinguish "recorded but gone" from
	 * "never recorded".
	 */
	sessionPointer(record: HarnessRecord): string | undefined {
		return record.session;
	}
}

/**
 * Does a job record carry a live pi session `.jsonl` on disk? Combines the
 * recorded pointer with an `existsSync` check. This is the pi-native "is there
 * an audit trail to look at?" signal — distinct from PID liveness, and STILL not
 * mtime (we check existence, never modification time).
 */
export function piSessionExists(record: HarnessRecord): boolean {
	return record.session !== undefined && existsSync(record.session);
}

// Register the pi adapter so `status`/`watch`/`gc` resolve liveness for `pi`
// jobs to THIS adapter (PID + session pointer) rather than the null fallback.
// A default-configured instance is sufficient for liveness (the binary/extra
// args only matter for `launch`, which the core does via an explicit instance).
registerHarness(new PiHarness());

/**
 * Build the harness that LAUNCHES jobs for a run, from config (ADR §5): `pi`
 * ⇒ the pi adapter (invoking `config.piBin`); anything else ⇒ the null adapter
 * (shelling out to `agentCmd`). This is the single place the core turns the
 * declared `harness` selector into a concrete adapter, keeping pi specifics
 * behind the seam.
 */
export function createHarness(options: {
	harness?: HarnessAdapter;
	piBin?: string;
}): Harness {
	if (options.harness === 'pi') {
		return new PiHarness({piBin: options.piBin});
	}
	return new NullHarness();
}
