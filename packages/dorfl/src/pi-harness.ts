import {spawn, spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {
	NullHarness,
	pidAlive,
	registerHarness,
	type Harness,
	type HarnessRecord,
	type InteractiveLaunchInput,
	type InteractiveLaunchResult,
	type LaunchInput,
	type LaunchResult,
} from './harness.js';
import {generateSessionPath} from './session-path.js';
import {lastAssistantText} from './watch-session.js';
import type {HarnessAdapter} from './config.js';

/**
 * The **pi** harness adapter (ADR §5) — the first real agent harness
 * `dorfl` drives. It fulfils the harness seam introduced by
 * `agent-workspaces` (`./harness.ts`): launch a job's work-agent command in its
 * worktree, and report liveness from **pi-native signals**.
 *
 * Two design commitments from the task + ADR §5, both encoded here:
 *
 *  1. **Invocation** is the standard work-agent prompt (the constant wrapper +
 *     the task's `## Prompt`, assembled by `./prompt.ts`) fed to the pi CLI on
 *     stdin, running non-interactively (`--print`) inside the job worktree.
 *  2. **Liveness** is reported from the **PID** (process alive?) PLUS a pointer
 *     to the pi **session file** (real activity + an audit trail) — explicitly
 *     **NOT filesystem mtime**: a live agent can think for minutes without
 *     writing any files, so mtime would mistake a thinking agent for a dead one.
 *
 * ## Session location: `--session <full-path>` (task `session-path-pi-default`)
 *
 * The adapter passes a **deterministic FULL session-FILE path** as `--session
 * <path>` (NOT `--session-dir <dir>`). The caller GENERATES that path once
 * (before launch, so `do --watch` can tail the known path) via {@link
 * generateSessionPath} and threads it in as `LaunchInput.session`; when omitted,
 * the adapter generates a default for its own cwd. pi creates+writes the session
 * at exactly that path (it CREATES a non-existent `--session` file) and
 * `--session` takes precedence over `--session-dir` (verified vs pinned pi
 * source). The default lands under pi's per-cwd sessions folder, so the
 * pi-remote dashboard sees the session and the in-place checkout stays clean.
 * The arg is ABSOLUTE and ends `.jsonl` — required, else pi treats it as a
 * session-ID lookup and exits 1 (see {@link generateSessionPath}).
 *
 * pi specifics stay BEHIND this adapter; the core (`run`, `status`, `do`) talks
 * only to the `Harness` interface. Where running real pi in CI is impractical,
 * the pi CLI is stubbed (see `pi-harness.test.ts`) via the injectable `piBin`.
 *
 * ## Seam contract (what an adapter promises the core)
 *
 *  - `launch(input)` runs the work-agent command for ONE job in `input.dir`
 *    (the worktree), feeding `input.prompt` to the agent. It returns
 *    `{ok, record, detail?}`: `ok` iff the agent completed successfully, and a
 *    `record` to persist in `.dorfl-job.json` carrying the **liveness
 *    anchor** (`pid`) plus the pi `session` FILE path. The core treats the call
 *    as blocking (it runs the test gate immediately after).
 *  - `isAlive(record)` answers liveness FROM THE RECORD'S ANCHOR (PID/session),
 *    never mtime, so a separate `status`/`do` process can re-derive liveness
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
	 * `--model`). The adapter always supplies `--print` + `--session <path>`;
	 * these layer on top for operator control.
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
	/** Absolute path to the pi session `.jsonl` file (the activity + audit pointer). */
	session?: string;
}

/**
 * The pi adapter. Invocation: `pi [--model <model>] --print --session
 * <full-path>.jsonl [extra]` run in the worktree with the work-agent prompt on
 * stdin. The model is passed NATIVELY as `--model <model>` when set (ADR §13 —
 * the routing intent dorfl controls); auth/keys stay pi's job, never
 * dorfl's. Liveness: the PID is the authoritative "is it running?"
 * signal; the recorded `session` file is the activity + audit pointer surfaced
 * alongside it. NEVER mtime (ADR §5).
 */
export class PiHarness implements Harness {
	readonly adapter = 'pi';
	private readonly piBin: string;
	private readonly extraArgs: string[];

	constructor(options: PiHarnessOptions = {}) {
		this.piBin = options.piBin ?? DEFAULT_PI_BIN;
		this.extraArgs = options.extraArgs ?? [];
	}

	/**
	 * Resolve the full session-FILE path for a launch. The CALLER normally
	 * generates this (via {@link generateSessionPath}) and passes it in
	 * `input.session` so the watcher knows it BEFORE launch; when omitted (e.g. a
	 * direct adapter call), generate a default under pi's per-cwd folder from the
	 * launch dir. Either way the result is absolute and ends `.jsonl`.
	 */
	private resolveSessionFile(input: LaunchInput): string {
		return (
			input.session ?? generateSessionPath({cwd: input.dir, id: input.slug})
		);
	}

	/** Build the pi argv: `[--model m] [extra] --print --session <file>`. */
	private buildArgs(input: LaunchInput, sessionFile: string): string[] {
		// The model ROUTING intent (ADR §13): when set, pass it NATIVELY as
		// `--model <model>`. dorfl only chooses the model; pi owns auth/keys.
		const modelArgs =
			input.model !== undefined && input.model !== ''
				? ['--model', input.model]
				: [];
		// Non-interactive (`--print`): pi processes the prompt and exits. We pass
		// the FULL session FILE path (`--session`, never `--session-dir`): pi
		// creates+writes it there, it is visible to the dashboard, and nothing
		// lands in the checkout. The operator's `extraArgs` still layer on.
		return [
			...modelArgs,
			...this.extraArgs,
			'--print',
			'--session',
			sessionFile,
		];
	}

	launch(input: LaunchInput): LaunchResult {
		const sessionFile = this.resolveSessionFile(input);
		const args = this.buildArgs(input, sessionFile);
		const result = spawnSync(this.piBin, args, {
			// Spawn pi with cwd = the repo/worktree dir so the NEW session's header
			// `cwd` groups it correctly in the dashboard (invariant #3) — the folder
			// does NOT imply the repo.
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
		// Record the pi child's PID (the liveness anchor) + the exact session FILE
		// path pi used (the pi-native activity + audit trail). Liveness later reads
		// these — NOT a filesystem mtime (ADR §5).
		const record: PiHarnessRecord = {
			adapter: 'pi',
			pid: result.pid,
			command: [this.piBin, ...args].join(' '),
			session: sessionFile,
		};
		const status = result.status ?? -1;
		return {
			ok: status === 0,
			record,
			detail: status === 0 ? undefined : (result.stderr ?? '').trim(),
			// The agent's ANSWER (task `harness-agent-output`): the LAST assistant
			// turn's text read from the session `.jsonl` pi just wrote — NOT piped
			// stdout (which is drained). Shares `watch-session.ts`'s reader.
			output: readLastAssistantText(sessionFile),
		};
	}

	/**
	 * The ASYNC twin of {@link launch} — IDENTICAL semantics (same `--print
	 * --session <file>` invocation, same prompt on stdin, output still CAPTURED,
	 * same `LaunchResult` shape: PID anchor + session pointer + ok/detail), but
	 * launched NON-BLOCKING with `spawn` instead of the synchronous `spawnSync`.
	 * This is the one structural carve-out the `do --watch` observer needs (task
	 * `do-watch`): `spawnSync` blocks the event loop until pi exits, so NOTHING
	 * could tail the growing session `.jsonl` concurrently. `launchAsync` runs pi
	 * alongside the tailer; the WHOLE launch delta is `spawnSync` → `spawn`. The
	 * prompt is still fed on stdin and stdout/stderr are still captured; we read
	 * the `.jsonl` LOG, never piped stdout.
	 */
	launchAsync(input: LaunchInput): Promise<LaunchResult> {
		const sessionFile = this.resolveSessionFile(input);
		const args = this.buildArgs(input, sessionFile);
		const record: PiHarnessRecord = {
			adapter: 'pi',
			command: [this.piBin, ...args].join(' '),
			session: sessionFile,
		};
		return new Promise<LaunchResult>((resolve, reject) => {
			const child = spawn(this.piBin, args, {
				// Same as `launch`: spawn in the repo/worktree dir so the session
				// header `cwd` groups the dashboard correctly (invariant #3).
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
					// Read the agent's ANSWER from the `.jsonl` at `close` — the same
					// last-assistant-text read `launch` does at return (task
					// `harness-agent-output`); the process has exited so the log is final.
					output: readLastAssistantText(sessionFile),
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
	 * Launch pi INTERACTIVELY (task `agent-interactive-launch`, decision #2): a
	 * FOREGROUND human session in `input.dir`. The whole delta from {@link launch}
	 * is the stdio contract:
	 *
	 *  - **NO `--print`** — a real interactive session the human types into (the
	 *    autonomous form is `pi --print …`, prompt on stdin, captured).
	 *  - **`stdio: 'inherit'`** — the human's terminal IS pi's terminal (foreground).
	 *  - **NO piped prompt** — the human drives; nothing is fed on stdin.
	 *  - **`--model <model>`** still flows in when set (ADR §13: the resolved
	 *    routing pins the human's starting model; they may switch inside pi).
	 *  - **`--session <path>`** is STILL passed so the human session is recorded /
	 *    dashboard-visible (audit trail), exactly as the autonomous path records it.
	 *
	 * It BLOCKS in the foreground until the human exits (`spawnSync` + inherited
	 * stdio), then returns their exit code. It is NOT a tracked job (decision #3):
	 * no `.dorfl-job.json`, no PID/liveness record, no gate — there is
	 * nothing to capture, so it returns only the exit code.
	 */
	launchInteractive(input: InteractiveLaunchInput): InteractiveLaunchResult {
		const sessionFile = this.resolveSessionFile({
			dir: input.dir,
			slug: input.slug,
			command: '',
			session: input.session,
		});
		// The model ROUTING intent (ADR §13): when set, pass it NATIVELY as
		// `--model <model>`. dorfl only chooses the model; pi owns auth/keys.
		const modelArgs =
			input.model !== undefined && input.model !== ''
				? ['--model', input.model]
				: [];
		// NO `--print` (a real foreground session), but STILL `--session <path>` so
		// the human session is recorded + dashboard-visible. The operator's
		// `extraArgs` still layer on.
		const args = [...modelArgs, ...this.extraArgs, '--session', sessionFile];
		const result = spawnSync(this.piBin, args, {
			// Run in the onboarded working tree so the session header `cwd` groups it
			// correctly in the dashboard (invariant #3) and the human starts there.
			cwd: input.dir,
			// INHERIT the human's stdio: their terminal IS pi's terminal (foreground,
			// interactive) — the opposite of the captured autonomous launch.
			stdio: 'inherit',
			env: input.env ?? process.env,
		});
		if (result.error) {
			throw new Error(
				`failed to spawn pi (${this.piBin}): ${result.error.message}`,
			);
		}
		return {exitCode: result.status ?? -1};
	}

	isAlive(record: HarnessRecord): boolean {
		return pidAlive(record.pid);
	}

	/**
	 * The recorded pi session-FILE pointer for a job — the pi-native activity +
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
 * Does a job record carry a live pi session file on disk? Combines the recorded
 * pointer with an `existsSync` check. This is the pi-native "is there an audit
 * trail to look at?" signal — distinct from PID liveness, and STILL not mtime
 * (we check existence, never modification time).
 */
export function piSessionExists(record: HarnessRecord): boolean {
	return record.session !== undefined && existsSync(record.session);
}

/**
 * Read the LAST assistant message's text from the pi session `.jsonl` at
 * `sessionFile` — the agent's final ANSWER, surfaced as `LaunchResult.output`
 * (task `harness-agent-output`). Called by BOTH `launch` (at return) and
 * `launchAsync` (at `close`), AFTER pi has exited so the log is complete.
 *
 * It REUSES `watch-session.ts`'s {@link lastAssistantText} (one `.jsonl` parser,
 * not two). An absent file (pi never wrote it) yields `undefined`, as does a log
 * with no assistant text — a read error is never thrown back into the launch.
 */
function readLastAssistantText(sessionFile: string): string | undefined {
	let jsonl: string;
	try {
		jsonl = readFileSync(sessionFile, 'utf8');
	} catch {
		return undefined; // no session log on disk — no answer to surface.
	}
	return lastAssistantText(jsonl);
}

// Register the pi adapter so `status`/`do`/`gc` resolve liveness for `pi` jobs
// to THIS adapter (PID + session pointer) rather than the null fallback. A
// default-configured instance is sufficient for liveness (the binary/extra args
// only matter for `launch`, which the core does via an explicit instance).
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
