import {existsSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {git, run} from './git.js';
import type {Config, PartialConfig} from './config.js';
import {
	REPO_CONFIG_FILENAME,
	loadRepoConfigFromContent,
	resolveRepoConfigFromLoaded,
	type LoadedRepoConfig,
} from './repo-config.js';

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

/**
 * Fetch ONLY `main` from the arbiter into an existing bare mirror, WITHOUT
 * `--prune`. Use this when the mirror also holds LOCAL-ONLY branches that must
 * survive (e.g. the `work/<slug>` branches of live worktrees): the full
 * mirror-style `+refs/heads/*:refs/heads/*` fetch in {@link ensureMirror} prunes
 * any local head absent on the arbiter, which would delete (and corrupt) a
 * checked-out `work/<slug>` worktree branch. This refreshes `main` to the latest
 * arbiter tip while leaving every other local ref untouched. Returns the fresh
 * `main` tip.
 */
export function fetchMirrorMain(
	mirrorDir: string,
	env?: NodeJS.ProcessEnv,
): string {
	git(['fetch', 'origin', '+refs/heads/main:refs/heads/main'], mirrorDir, {
		env,
	});
	return mirrorMainSha(mirrorDir, env);
}

/**
 * Read the target repo's COMMITTED `.agent-runner.json` from the bare hub
 * mirror's `main` (`git show main:.agent-runner.json`) — the per-repo config
 * layer for the NO-CHECKOUT paths (`do --remote`). The committed file is a
 * tracked file on `<arbiter>/main`, so it is reachable from the mirror without a
 * worktree. Returns the raw file CONTENT, or `undefined` when the repo has no
 * `.agent-runner.json` on `main` (a config-less repo — the caller then resolves to
 * exactly global + default, byte-identical to before this layer existed).
 *
 * This is the slice's ONE genuinely-new seam: sourcing the bytes from the arbiter
 * instead of the cwd. The parse / allow-reject filtering stays in
 * {@link loadRepoConfigFromContent} (the existing per-repo machinery), so the
 * host-only key rejection is identical however the bytes were sourced.
 *
 * A `git show` failure that is NOT "path missing on main" (a corrupt mirror, an
 * absent `main`) is propagated — it is a genuine plumbing fault, not a
 * config-less repo. The missing-path case (`git show` exit ≠ 0 naming the path)
 * is read as `undefined` (no file = no per-repo layer).
 */
export function readRepoConfigFromMirrorMain(
	mirrorDir: string,
	env?: NodeJS.ProcessEnv,
): string | undefined {
	const spec = `main:${REPO_CONFIG_FILENAME}`;
	const res = run('git', ['show', spec], mirrorDir, {env});
	if (res.status === 0) {
		return res.stdout;
	}
	// `git show main:<path>` exits non-zero both when the PATH is absent on main
	// (the config-less repo — expected, → undefined) and when `main`/the object is
	// unresolvable (a genuine fault — propagate). git words the former as
	// "...does not exist in 'main'" / "exists on disk, but not in" / "path ...
	// does not exist"; the latter as an invalid-object/unknown-revision error.
	const stderr = res.stderr;
	const pathMissing =
		/does not exist in|exists on disk, but not in|fatal: path/i.test(stderr) ||
		/did not match any file/i.test(stderr);
	if (pathMissing) {
		return undefined;
	}
	throw new Error(
		`git show ${spec} failed in ${mirrorDir} (exit ${res.status}): ${stderr.trim()}`,
	);
}

/**
 * Resolve a repo's effective {@link Config} for a NO-CHECKOUT path by layering its
 * COMMITTED `.agent-runner.json` (read from the bare hub mirror's `main` via
 * {@link readRepoConfigFromMirrorMain}) into the SAME
 * `flag > env > per-repo > global > default` chain a working checkout uses
 * ({@link resolveRepoConfigFromLoaded}). This is the reusable core of `do
 * --remote`'s inline per-repo resolution (`resolveRemoteRepoConfig` in `cli.ts`):
 * the mirror is assumed ALREADY ensured + fetched by the caller (the read paths
 * fetch-first), so this only READS its `main` config and layers it.
 *
 * Resilient: a config-less repo (no file on `main`) resolves to exactly
 * global + flags (byte-identical to the no-per-repo behaviour). A genuine
 * read fault is propagated by {@link readRepoConfigFromMirrorMain}; a caller that
 * must never block on a fault (a read-only scan) catches + falls back to
 * global + flags itself.
 */
export function resolveRepoConfigFromMirror(options: {
	/** The bare hub mirror directory whose `main:.agent-runner.json` to read. */
	mirrorPath: string;
	/** The global + default config layer (from `loadConfig`/`mergeConfig`). */
	global: Config;
	/** Optional flag overrides (highest precedence). */
	flags?: PartialConfig;
	env?: NodeJS.ProcessEnv;
}): Config {
	const {mirrorPath, global, flags, env} = options;
	const content = readRepoConfigFromMirrorMain(mirrorPath, env);
	const label = `${mirrorPath}#main:${REPO_CONFIG_FILENAME}`;
	const loaded: LoadedRepoConfig =
		content === undefined
			? {path: label, config: {}, rejected: []}
			: loadRepoConfigFromContent(content, label);
	return resolveRepoConfigFromLoaded(loaded, {global, flags}).config;
}

/** The bare mirror's `main` tip (40-hex sha), as freshly fetched. */
export function mirrorMainSha(
	mirrorDir: string,
	env?: NodeJS.ProcessEnv,
): string {
	return git(['rev-parse', 'main'], mirrorDir, {env}).trim();
}

/**
 * Fetch-first for the READ paths (`scan`/`status`, ADR
 * `command-surface-and-journeys` §5/§6): refresh a registered mirror's `main`
 * before reading its `work/` tree, so the read sees the remote truth (the
 * registry model makes the remote the source of truth). It is a thin wrapper
 * over {@link fetchMirrorMain} (the load-bearing main-only, no-prune fetch — it
 * must NOT be the pruning `ensureMirror` fetch, which would delete live
 * worktrees' `work/<slug>` branches, ADR §6).
 *
 * **Never errors out: warn + fall back to last-known.** A failed fetch (offline,
 * a vanished origin, a dead arbiter) is NOT fatal for a read — `scan`/`status`
 * must still report from the mirror's last-known `main`. On failure it routes a
 * human-readable note through `warn` and returns `false`; on success it returns
 * `true`. The freshness of the read then reflects the last SUCCESSFUL fetch.
 */
export function fetchMirrorMainOrWarn(options: {
	/** The bare hub mirror directory whose `main` to refresh. */
	mirrorPath: string;
	/** Sink for the fall-back warning when the fetch fails. */
	warn?: (message: string) => void;
	env?: NodeJS.ProcessEnv;
}): boolean {
	try {
		fetchMirrorMain(options.mirrorPath, options.env);
		return true;
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		options.warn?.(
			`could not fetch mirror at ${options.mirrorPath}; ` +
				`reading last-known state (offline). ${reason}`,
		);
		return false;
	}
}
