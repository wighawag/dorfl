import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
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
 *     to the pi **session dir/log** (real activity + an audit trail) — explicitly
 *     **NOT filesystem mtime**: a live agent can think for minutes without
 *     writing any files, so mtime would mistake a thinking agent for a dead one.
 *
 * pi specifics stay BEHIND this adapter; the core (`run`, `status`, `watch`)
 * talks only to the `Harness` interface. Where running real pi in CI is
 * impractical, the pi CLI is stubbed (see `pi-harness.test.ts`) via the
 * injectable `piBin`.
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

/**
 * The subdirectory (inside a job worktree) where pi stores its session files /
 * log. We point pi at this dir (`--session-dir`) so the session pointer we
 * record is deterministic and lives WITH the job (an audit trail `status`/`gc`
 * can find), rather than wherever pi's global default would land it.
 */
export const PI_SESSION_DIRNAME = '.agent-runner-pi-session';

/** Compute the pi session dir for a job worktree at `dir`. */
export function piSessionDir(dir: string): string {
	return join(dir, PI_SESSION_DIRNAME);
}

export interface PiHarnessOptions {
	/**
	 * The pi CLI binary (default `pi` on `PATH`). Tests inject a stub script here
	 * so the seam can be exercised without a real model call / network.
	 */
	piBin?: string;
	/**
	 * Extra arguments inserted before the `--print` invocation (e.g. a pinned
	 * `--model`). The adapter always supplies `--print` + `--session-dir`; these
	 * layer on top for operator control.
	 */
	extraArgs?: string[];
}

/**
 * The pi harness block persisted in a job record. It extends the base
 * {@link HarnessRecord} with pi's concrete liveness pointer — the **session
 * dir** — alongside the PID. `gc`/`status` re-derive liveness from these without
 * re-launching pi.
 */
export interface PiHarnessRecord extends HarnessRecord {
	adapter: 'pi';
	/** Absolute path to the pi session dir/log (the activity + audit pointer). */
	session?: string;
}

/**
 * The pi adapter. Invocation: `pi [--model <model>] --print --session-dir
 * <job>/<session> [extra]` run in the worktree with the work-agent prompt on
 * stdin. The model is passed NATIVELY as `--model <model>` when set (ADR §13 —
 * the routing intent agent-runner controls); auth/keys stay pi's job, never
 * agent-runner's. Liveness: the PID is
 * the authoritative "is it running?" signal; the recorded `session` dir/log is
 * the activity + audit pointer surfaced alongside it. NEVER mtime (ADR §5).
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
		const sessionDir = piSessionDir(input.dir);
		// The model ROUTING intent (ADR §13): when set, pass it NATIVELY as
		// `--model <model>`. agent-runner only chooses the model; pi owns auth/keys.
		const modelArgs =
			input.model !== undefined && input.model !== ''
				? ['--model', input.model]
				: [];
		// Non-interactive (`--print`): pi processes the prompt and exits. We pin the
		// session dir INTO the job worktree so the recorded pointer is deterministic
		// and travels with the job (an audit trail), not pi's global default. The
		// operator's `extraArgs` still layer on (e.g. flags beyond `--model`).
		const args = [
			...modelArgs,
			...this.extraArgs,
			'--print',
			'--session-dir',
			sessionDir,
		];
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
		// Record the pi child's PID (the liveness anchor) + the session dir/log
		// pointer (the pi-native activity + audit trail). Liveness later reads these
		// — NOT a filesystem mtime (ADR §5).
		const record: PiHarnessRecord = {
			adapter: 'pi',
			pid: result.pid,
			command: [this.piBin, ...args].join(' '),
			session: sessionDir,
		};
		const status = result.status ?? -1;
		return {
			ok: status === 0,
			record,
			detail: status === 0 ? undefined : (result.stderr ?? '').trim(),
		};
	}

	/**
	 * Liveness from pi-native signals (ADR §5): the PID (`process.kill(pid, 0)`,
	 * the OS process table) answers "is the agent process running?" — the
	 * authoritative signal. NEVER filesystem mtime. The recorded session dir/log
	 * is the audit/activity pointer surfaced alongside (see {@link sessionPointer}).
	 */
	isAlive(record: HarnessRecord): boolean {
		return pidAlive(record.pid);
	}

	/**
	 * The recorded pi session dir/log pointer for a job — the pi-native activity +
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
 * Does a job record carry a live pi session dir/log on disk? Combines the
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
