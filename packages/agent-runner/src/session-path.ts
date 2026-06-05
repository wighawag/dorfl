import {homedir} from 'node:os';
import {join} from 'node:path';

/**
 * Generation of the pi **session FILE path** (`--session <path>`) agent-runner
 * hands to the pi adapter.
 *
 * ## Why a FULL file path (`--session`), not a `--session-dir`
 *
 * The pi adapter used to pin `--session-dir <cwd>/.agent-runner-pi-session`,
 * which (1) hid sessions from the pi-remote dashboard (its
 * `SessionManager.listAll()` only scans first-level subdirs of
 * `~/.pi/agent/sessions/`), (2) made `do --watch` race onto a stale prior-run
 * `.jsonl` (newest-by-mtime in a shared dir, chosen BEFORE pi wrote the new
 * file), and (3) polluted the in-place checkout with an untracked
 * `.agent-runner-pi-session/`. Generating a deterministic FULL path up front and
 * passing `--session <that>` fixes all three: pi creates+writes that exact file,
 * the watcher tails a KNOWN path (no race), and nothing lands in the checkout.
 *
 * ## pi `--session <path>` invariants this module upholds (verified against pi
 * source `core/session-manager.ts` + `main.ts resolveSessionPath`)
 *
 *  1. **The arg MUST be a PATH-SHAPED string — absolute and ending `.jsonl`.**
 *     pi takes the file-path branch only when the arg has a slash OR ends
 *     `.jsonl`; otherwise it treats it as a session-ID to look up, fails, and
 *     **exits 1**. {@link sessionFileName} always appends `.jsonl`; the callers
 *     join it under an absolute root.
 *  2. **pi creates+writes a non-existent `--session` path** (`SessionManager.open`
 *     on a missing file → `newSession()` pinned at that path). So a UNIQUE name
 *     per launch yields a fresh session; a REUSED name would resume+append the
 *     prior run (corrupt audit + `--watch` replay). Hence the unique-suffix.
 *  3. **The header `cwd` (which the dashboard groups by) falls back to the spawn
 *     `process.cwd()` for a NEW file.** So grouping is driven by WHERE pi is
 *     spawned (the adapter spawns with `cwd: input.dir`), NOT by this folder.
 *  4. **The dashboard's `listAll()` is non-recursive** — it scans `.jsonl`
 *     directly inside FIRST-LEVEL subdirs of `~/.pi/agent/sessions/`. So the
 *     DEFAULT root ({@link piDefaultSessionsDir}) is a direct child of that root,
 *     auto-visible. An operator override may be ANY folder (its dashboard
 *     visibility is pi-remote's concern, not agent-runner's).
 *
 * ## Import vs. replicate (decided at build time)
 *
 * pi exports `getDefaultSessionDir(cwd)`, but agent-runner does NOT depend on
 * `@earendil-works/pi-coding-agent` (only `commander` is a runtime dep; see
 * `work/observations/slice-premise-pi-coding-agent-not-a-dep.md`). Adding it
 * solely to derive the per-cwd slug would pull a heavy tree, so the tiny,
 * stable slug encoding is REPLICATED here (mirroring the do-watch slice, which
 * used a local structural type for the same reason). The encoding matches pi's
 * `getDefaultSessionDirPath`: strip a leading slash, replace path separators +
 * `:` with `-`, wrap in `--…--`.
 */

/** pi's managed sessions root (`~/.pi/agent/sessions/`). */
export function piSessionsRoot(): string {
	return join(homedir(), '.pi', 'agent', 'sessions');
}

/**
 * The per-cwd DEFAULT sessions folder — a FIRST-LEVEL (direct-child) subdir of
 * {@link piSessionsRoot} so the dashboard's non-recursive `listAll()` scans it
 * (invariant #4). Replicates pi's `getDefaultSessionDirPath(cwd)` slug:
 * `--${cwd without leading slash, separators/colon → '-'}--`. PURE — it does NOT
 * create the folder (pi's `SessionManager` mkdirs the session file's parent on
 * open; the watcher also tolerates a not-yet-existent dir).
 */
export function piDefaultSessionsDir(cwd: string): string {
	const slug = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
	return join(piSessionsRoot(), slug);
}

/** A monotonic-ish unique suffix (timestamp + random) for one launch. */
function uniqueSuffix(): string {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 8);
	return `${ts}-${rand}`;
}

/**
 * The session FILE NAME for one launch: `<id>-<unique>.jsonl`. UNIQUE per launch
 * (invariant #2) — the `id` (slug or work-id) alone is NOT enough, since a
 * second run reusing it would make pi resume+append the prior session. The stem
 * is otherwise free; only uniqueness + the `.jsonl` extension are load-bearing.
 */
export function sessionFileName(id: string): string {
	return `${id}-${uniqueSuffix()}.jsonl`;
}

/**
 * Generate the full, ABSOLUTE pi session FILE path for one launch:
 * `<sessionsDir ?? piDefaultSessionsDir(cwd)>/<id>-<unique>.jsonl`.
 *
 * - `sessionsDir` unset ⇒ the pi-default per-cwd dir (invariant #4) — the
 *   fallback lives HERE (one place), so config resolution yields `undefined` for
 *   "unset" and need not compute a dynamic default.
 * - `cwd` is the job's spawn cwd; it ONLY drives the default folder slug. The
 *   header `cwd` (dashboard grouping) comes from the spawn cwd at launch, not
 *   this path (invariant #3).
 * - `id` is a stable per-launch identifier (in-place: the slug; job-worktree:
 *   the work-id) made unique by the appended suffix.
 *
 * The result is absolute and ends `.jsonl` (invariant #1).
 */
export function generateSessionPath(options: {
	cwd: string;
	id: string;
	sessionsDir?: string;
}): string {
	const root = options.sessionsDir ?? piDefaultSessionsDir(options.cwd);
	return join(root, sessionFileName(options.id));
}
