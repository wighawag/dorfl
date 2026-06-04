import {existsSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {git} from './git.js';

/**
 * The shared **hub-mirror primitive**: one bare mirror per repo under
 * `<workspacesDir>/repos/<key>.git`, re-fetched from the arbiter. Both the
 * autonomous job runner (`agent-workspaces`) and the human `work-on` build on
 * it: a job worktree and a human worktree are both cut from the mirror's
 * freshly-fetched `main`, so they always branch off the latest arbiter main
 * (ADR §2).
 *
 * This module does NOT create worktrees, claim, or run anything — it only
 * locates / creates / fetches the mirror. It is STATE, not cache (ADR §3): it
 * lives under `~/.agent-runner/` (config `workspacesDir`), never `~/.cache`.
 */

/**
 * Deterministically encode an arbiter remote URL into a hierarchical hub key:
 * drop the scheme / user / `.git` suffix, then replace `.` → `-` **per path
 * segment** (lossless and reversible; avoids the dotted-segment hazard that
 * trips editors / tools and our own dotdir-pruning). E.g.
 * `git@github.com:wighawag/agent-runner.git` → `github-com/wighawag/agent-runner`.
 */
export function encodeRepoKey(url: string): string {
	const segments = urlSegments(url);
	return segments.map(dashDots).join('/');
}

/**
 * Split a remote URL into its host + path segments (lossy only of scheme/user/
 * port/`.git`, which carry no identity for keying). Handles the four shapes the
 * arbiter can take: scp-like ssh (`git@host:org/repo.git`), `ssh://`, `https://`
 * / `http://`, `file://`, and a plain local filesystem path to a bare repo.
 */
function urlSegments(url: string): string[] {
	const trimmed = url.trim();

	// scp-like ssh: [user@]host:path  (no `://`, has a `:` before the path).
	const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/;
	if (!trimmed.includes('://')) {
		const m = scp.exec(trimmed);
		if (m && !trimmed.startsWith('/')) {
			return [m[1], ...pathSegments(m[2])];
		}
		// Otherwise a plain local path (e.g. `/srv/git/org/repo.git`).
		return pathSegments(trimmed);
	}

	// scheme://[user@]host[:port]/path  — or file:///abs/path (empty host).
	const schemeEnd = trimmed.indexOf('://');
	const rest = trimmed.slice(schemeEnd + 3);
	const slash = rest.indexOf('/');
	const authority = slash === -1 ? rest : rest.slice(0, slash);
	const path = slash === -1 ? '' : rest.slice(slash + 1);
	const host = stripUserAndPort(authority);
	const hostSegments = host === '' ? [] : [host];
	return [...hostSegments, ...pathSegments(path)];
}

/** Drop `user@` and `:port` from an authority, leaving the bare host. */
function stripUserAndPort(authority: string): string {
	const afterUser = authority.includes('@')
		? authority.slice(authority.lastIndexOf('@') + 1)
		: authority;
	const colon = afterUser.indexOf(':');
	return colon === -1 ? afterUser : afterUser.slice(0, colon);
}

/** Split a `/`-path into non-empty segments, dropping a trailing `.git`. */
function pathSegments(path: string): string[] {
	const noGit = path.replace(/\.git\/?$/, '');
	return noGit.split('/').filter((s) => s.length > 0);
}

/** Replace every `.` with `-` within a single segment (per-segment, lossless). */
function dashDots(segment: string): string {
	return segment.replace(/\./g, '-');
}

/**
 * The on-disk location of the bare hub mirror for `url`:
 * `<workspacesDir>/repos/<key>.git`. Lives under `workspacesDir` (default
 * `~/.agent-runner`), never `~/.cache` (ADR §3).
 */
export function mirrorPath(workspacesDir: string, url: string): string {
	return join(workspacesDir, 'repos', `${encodeRepoKey(url)}.git`);
}

export interface EnsureMirrorOptions {
	/**
	 * The arbiter remote URL to mirror. Either `url` OR (`fromRepo` + `arbiter`)
	 * must be given; if both, `url` wins.
	 */
	url?: string;
	/** A working repo to resolve the remote URL from (with `arbiter`). */
	fromRepo?: string;
	/** Remote name in `fromRepo` whose URL to mirror (default `origin`). */
	arbiter?: string;
	/** The execution working area (config `workspacesDir`, default `~/.agent-runner`). */
	workspacesDir: string;
	env?: NodeJS.ProcessEnv;
}

export interface EnsureMirrorResult {
	/** Absolute path to the bare mirror. */
	path: string;
	/** The resolved arbiter URL the mirror tracks. */
	url: string;
	/** True iff the mirror did not exist and was just created. */
	created: boolean;
	/** True iff an existing mirror was fetched (not created). */
	fetched: boolean;
	/** The mirror's freshly-fetched `main` tip (40-hex sha). */
	mainSha: string;
}

/**
 * Locate the bare hub mirror for the arbiter; create it (`git clone --bare`) if
 * absent, or `git fetch` it if present. Idempotent: a second call fetches and
 * reuses the same mirror (it never re-clones, so any local mirror state — e.g.
 * other branches/objects — survives). Returns the mirror path and its
 * freshly-fetched `main`, so callers (job worktrees, human worktrees) always
 * branch off the latest arbiter main.
 */
export function ensureMirror(options: EnsureMirrorOptions): EnsureMirrorResult {
	const env = options.env;
	const url = resolveUrl(options);
	const path = mirrorPath(options.workspacesDir, url);

	let created = false;
	let fetched = false;
	if (existsSync(path)) {
		// Reuse: fetch the latest from the arbiter into the existing bare mirror.
		git(['fetch', '--prune', 'origin', '+refs/heads/*:refs/heads/*'], path, {
			env,
		});
		fetched = true;
	} else {
		// First time: a bare mirror clone (shared object store, cheap).
		mkdirSync(dirname(path), {recursive: true});
		git(['clone', '--quiet', '--bare', url, path], dirname(path), {env});
		created = true;
	}

	return {path, url, created, fetched, mainSha: mirrorMainSha(path, env)};
}

/** Resolve the arbiter URL from `url`, or from `fromRepo` + `arbiter` remote. */
function resolveUrl(options: EnsureMirrorOptions): string {
	if (options.url && options.url.trim() !== '') {
		return options.url.trim();
	}
	if (options.fromRepo) {
		const remote = options.arbiter ?? 'origin';
		return git(['remote', 'get-url', remote], options.fromRepo, {
			env: options.env,
		}).trim();
	}
	throw new Error(
		'ensureMirror requires either `url` or `fromRepo` (with `arbiter`).',
	);
}

/** The bare mirror's `main` tip (40-hex sha), as freshly fetched. */
export function mirrorMainSha(
	mirrorDir: string,
	env?: NodeJS.ProcessEnv,
): string {
	return git(['rev-parse', 'main'], mirrorDir, {env}).trim();
}
