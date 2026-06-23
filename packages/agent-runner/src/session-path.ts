import {homedir} from 'node:os';
import {join, resolve} from 'node:path';

/**
 * pi's env override for its agent dir. Real pi reads
 * `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR` (i.e. `PI_CODING_AGENT_DIR`) in its
 * `getAgentDir()` (verified vs pinned source `config.ts`); when set, ALL of pi's
 * default session paths move under it. agent-runner's replica MUST honour the same
 * var, or a user/CI that points pi at a custom agent dir would have agent-runner
 * write sessions to `~/.pi/agent/sessions` while pi reads the custom dir — sessions
 * then invisible to pi AND pi-remote (the very breakage this task fixes). Also the
 * clean lever for test isolation (point it at a scratch dir). NOTE: we honour only
 * the agent-dir var, not pi's separate `PI_CODING_AGENT_SESSION_DIR` — agent-runner
 * already has its own `sessionsDir` override for that role.
 */
const PI_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';

/** Expand a leading `~`/`~/` to the home dir (pi's `expandTildePath` behaviour). */
function expandTilde(p: string): string {
	if (p === '~') {
		return homedir();
	}
	if (p.startsWith('~/') || p.startsWith('~\\')) {
		return join(homedir(), p.slice(2));
	}
	return p;
}

/**
 * Generate the **full pi session-file path** the harness passes as `--session
 * <path>` (task `session-path-pi-default`). This is the single source of the
 * session path: the caller generates it ONCE (before pi launches, so the
 * `do --watch` tailer can tail the KNOWN path) and threads it into BOTH the
 * adapter (`LaunchInput.session`) and the tailer.
 *
 * ## Why a full FILE path, not `--session-dir`
 *
 * agent-runner used to pin `--session-dir <cwd>/.agent-runner-pi-session`, which
 * (1) hid sessions from the pi-remote dashboard (`SessionManager.listAll()` only
 * scans `~/.pi/agent/sessions/`), (2) made `do --watch` race onto a stale
 * prior-run log (newest-by-mtime in a shared dir), and (3) polluted the in-place
 * checkout with an untracked dir. Passing `--session <full-path>` fixes all
 * three: pi creates+writes the session at exactly that path, it takes precedence
 * over `--session-dir`, and the watcher tails a path it knew before pi started.
 *
 * ## The four load-bearing pi `--session` invariants (verified vs pinned pi
 * source `core/session-manager.ts` + `main.ts` `resolveSessionPath`)
 *
 *  1. **The arg MUST be PATH-SHAPED — absolute and ending `.jsonl`.** pi's
 *     `resolveSessionPath` takes the file-path branch ONLY when the arg contains
 *     a slash OR ends `.jsonl`; otherwise it treats the arg as a session-ID to
 *     look up, fails `not_found`, and pi EXITS 1. So `<sessionsDir>/<id>.jsonl`
 *     is required (a bare id would kill the run).
 *  2. **pi creates+writes a NON-EXISTENT `--session` path** (`SessionManager.open`
 *     on a missing file → `newSession()` pinned to the path). So the FILENAME
 *     must be UNIQUE PER LAUNCH: a reused name on an existing non-empty file would
 *     make pi LOAD + APPEND (resume), silently replaying the prior run.
 *  3. **The header `cwd` falls back to `process.cwd()` for a new file** (no header
 *     to read), so dashboard repo-grouping is correct ONLY because the adapter
 *     spawns pi with `cwd: input.dir`. The FOLDER does not imply the repo.
 *  4. **`listAll` is NON-RECURSIVE (one level):** a session is dashboard-visible
 *     via the default `listAll()` ONLY as a `.jsonl` DIRECTLY inside a first-level
 *     subdir of `~/.pi/agent/sessions/` — which the default {@link
 *     piDefaultSessionDir} (a direct child) gives.
 *
 * ## Why the slug helper is replicated, not imported
 *
 * agent-runner depends ONLY on `commander` (see
 * `work/observations/slice-premise-pi-coding-agent-not-a-dep.md`). pi's exported
 * `getDefaultSessionDir(cwd)` lives in `@earendil-works/pi-coding-agent`, whose
 * dependency tree is heavy (`pi-agent-core`, `pi-ai`, `zod`, `ws`). Pulling that
 * in for one tiny slug function is not worth it, so the encoding is REPLICATED
 * here (the same choice the do-watch task made for its session-log type). The
 * encoding is verified verbatim against pinned pi source `getDefaultSessionDirPath`:
 *
 *   join(agentDir, 'sessions', `--${resolve(cwd).replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--`)
 *
 * where `agentDir` is `~/.pi/agent`. If a runtime dep on pi-coding-agent is ever
 * wanted, swapping this for the import is a one-line change.
 */

/**
 * pi's agent dir — the parent of `sessions/`. Honours `PI_CODING_AGENT_DIR`
 * (matching real pi's `getAgentDir()`), else `~/.pi/agent`. Read at call time (not
 * cached) so a test setting `process.env.PI_CODING_AGENT_DIR` is respected.
 */
function piAgentDir(): string {
	const override = process.env[PI_AGENT_DIR_ENV];
	if (override !== undefined && override !== '') {
		return expandTilde(override);
	}
	return join(homedir(), '.pi', 'agent');
}

/**
 * pi's DEFAULT per-cwd sessions folder for `cwd` — a direct child of
 * `~/.pi/agent/sessions/` (invariant #4), so the dashboard's non-recursive
 * `listAll()` scans it and groups by the session header `cwd`. Replicates pi's
 * `getDefaultSessionDirPath` encoding verbatim (verified vs pinned source). PURE
 * (does not create the folder — the parent is ensured at generation time / by
 * pi's own `SessionManager.open`).
 */
export function piDefaultSessionDir(cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const safe = `--${resolvedCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
	return join(piAgentDir(), 'sessions', safe);
}

/**
 * Build a filename STEM that is UNIQUE PER LAUNCH (invariant #2). The `id`
 * (slug for in-place, work-id for job-worktree) is the human-readable anchor; a
 * timestamp + a short random suffix make it collision-proof even for two
 * launches in the same millisecond / same checkout reusing the same slug.
 */
function uniqueStem(id: string): string {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 8);
	return `${id}-${ts}-${rand}`;
}

/** Inputs to {@link generateSessionPath}. */
export interface GenerateSessionPathInput {
	/**
	 * The HOST-ONLY sessions root (resolved `config.sessionsDir`). `undefined`
	 * (unset) ⇒ pi's default per-cwd folder for {@link cwd} (the DYNAMIC default,
	 * kept in this ONE place — never smeared across config defaulting).
	 */
	sessionsDir?: string;
	/** The job cwd pi is spawned in — used for the unset-default folder. */
	cwd: string;
	/**
	 * A human-readable id for the filename stem (the slug in-place, the work-id
	 * for a job worktree). Made unique per launch internally.
	 */
	id: string;
}

/**
 * Generate the absolute, `.jsonl`-ending session FILE path to pass as
 * `--session <path>` (invariant #1). `<root>/<id>-<unique>.jsonl`, where `<root>`
 * is the resolved `sessionsDir` or — when unset — pi's default per-cwd folder
 * (the DYNAMIC default). The path is ABSOLUTE (resolved against the process cwd
 * if a relative `sessionsDir` was given) and the stem is unique per launch, so a
 * second launch in the same checkout never appends to / replays the first's
 * session.
 */
export function generateSessionPath(input: GenerateSessionPathInput): string {
	const root =
		input.sessionsDir !== undefined && input.sessionsDir !== ''
			? resolve(input.sessionsDir)
			: piDefaultSessionDir(input.cwd);
	return join(root, `${uniqueStem(input.id)}.jsonl`);
}
