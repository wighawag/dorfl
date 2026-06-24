import {type Harness, type LaunchResult} from './harness.js';
import {PiHarness} from './pi-harness.js';
import {SessionTailer} from './watch-session.js';
import {generateSessionPath} from './session-path.js';

/**
 * The SHARED launch-with-optional-watch helper (task `watch-review-session`).
 *
 * This is the ONE codepath both the BUILD launch (`do.ts`'s `runDoAgent`) and the
 * REVIEW launch (`review-gate.ts`'s `harnessReviewGate`) use to run an agent
 * through the harness seam, optionally tailing its pi session `.jsonl` live. It
 * was EXTRACTED from `do.ts` (where the watch wiring — `generateSessionPath` →
 * `SessionTailer` → `start()` → `launchAsync` → `finally stop()`, else sync
 * `launch` — used to live INLINE) so the review path can tail its OWN session
 * without COPYING that block (the run/do duplication anti-pattern; copying would
 * fork the watch wiring into a second implementation, and `run.ts` would become a
 * third). One implementation, two callers.
 *
 * What it owns (the parts that were inline in `do.ts`):
 *
 *  - **A known session path per launch**, generated up-front via
 *    {@link generateSessionPath} from `sessionId` (+ `sessionsDir`/`dir`), so the
 *    tailer follows the EXACT file (no newest-by-mtime guessing). Distinct callers
 *    pass distinct `sessionId`s (the build uses the slug; the review uses
 *    `<slug>-review`) so their sessions never collide.
 *  - **Tail when `watch` is on** (and the harness is a {@link PiHarness}): start a
 *    {@link SessionTailer} on that known path, launch NON-BLOCKING via
 *    `launchAsync`, and `finally stop()` the tailer (one final drain + the
 *    `\u2713 agent finished` line), EXACTLY as the build path did before. A non-pi
 *    harness with `watch` on falls through to the sync `launch` (the caller is
 *    responsible for rejecting `--watch` on a non-pi harness up-front, as `do`
 *    does); this helper degrades safely rather than tailing a log that does not
 *    exist.
 *  - **OFF the watch path** (or a non-pi harness): a plain synchronous
 *    `harness.launch(...)` — BYTE-IDENTICAL to the pre-extraction behaviour, so no
 *    tailer is created and the {@link LaunchResult} is unchanged.
 *
 * It is OBSERVABILITY ONLY: the returned {@link LaunchResult} is identical whether
 * or not `watch` is on (the tailer is a pure reader), so it never changes a run's
 * outcome, gate, routing, git, or exit code.
 */
export interface LaunchWithOptionalWatchInput {
	/** The harness seam to launch through (pi enables the live tail). */
	harness: Harness;
	/** The working directory the agent runs in (the worktree/checkout). */
	dir: string;
	/** The slug being processed (for adapters that name/log per slug). */
	slug: string;
	/** The command the null/shell adapter shells out to (ignored by pi). */
	command: string;
	/** The prompt fed to the agent on stdin. */
	prompt: string;
	/** The model routing intent forwarded to the harness (ADR \u00a713). */
	model?: string;
	/**
	 * The human-readable id for the session-FILE stem (made unique per launch
	 * inside {@link generateSessionPath}). DISTINCT per caller so two launches in
	 * one run never collide: the build passes the slug; the review passes
	 * `<slug>-review`.
	 */
	sessionId: string;
	/**
	 * The HOST-ONLY sessions root (resolved `config.sessionsDir`). `undefined` \u21d2
	 * pi's default per-cwd folder for {@link dir} (see {@link generateSessionPath}).
	 */
	sessionsDir?: string;
	/** Tail the session `.jsonl` live (pi harness only). */
	watch?: boolean;
	/** Where the tailed high-signal lines are written (defaults to stderr). */
	watchSink?: (line: string) => void;
	/** Emit ANSI colour in the tailed lines (the caller's TTY/`NO_COLOR` decision). */
	color?: boolean;
	/** Environment for the child agent process. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Launch the agent through the harness, optionally tailing its pi session log
 * live. Returns the {@link LaunchResult} unchanged on either path (the tailer is
 * a pure observer). See {@link LaunchWithOptionalWatchInput} for the watch-on vs
 * watch-off behaviour (the latter is byte-identical to a plain `harness.launch`).
 */
export async function launchWithOptionalWatch(
	input: LaunchWithOptionalWatchInput,
): Promise<LaunchResult> {
	const {harness} = input;

	// Generate the full pi session-FILE path ONCE here (caller-generates) so the
	// adapter and the `--watch` tailer cannot disagree, and so the tailer knows it
	// BEFORE pi starts (task `session-path-pi-default`). `sessionsDir` unset \u21d2
	// pi's per-cwd default folder. The non-pi null adapter ignores `session`, but
	// generating it unconditionally keeps ONE path for BOTH the watch and
	// non-watch branches.
	const session = generateSessionPath({
		sessionsDir: input.sessionsDir,
		cwd: input.dir,
		id: input.sessionId,
	});

	// `--watch` (pi only): launch async + tail the KNOWN session .jsonl path
	// concurrently. The caller is responsible for rejecting `--watch` on a non-pi
	// harness up-front (as `do` does); a non-pi harness here falls through to the
	// sync launch below rather than tailing a log that will never exist.
	if (input.watch === true && harness instanceof PiHarness) {
		const tailer = new SessionTailer({
			sessionFile: session,
			color: input.color ?? false,
			sink: input.watchSink,
		});
		tailer.start();
		try {
			return await harness.launchAsync({
				dir: input.dir,
				slug: input.slug,
				command: input.command,
				prompt: input.prompt,
				model: input.model,
				session,
				env: input.env,
			});
		} finally {
			// Always release the tailer (one final drain) — even on a launch error —
			// so the observer never outlives the run or leaks a handle.
			await tailer.stop();
		}
	}

	return harness.launch({
		dir: input.dir,
		slug: input.slug,
		command: input.command,
		prompt: input.prompt,
		model: input.model,
		session,
		env: input.env,
	});
}
