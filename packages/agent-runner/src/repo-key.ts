/**
 * The arbiter-URL → **hub key** encoder, extracted from `repo-mirror.ts` so it
 * is importable WITHOUT pulling in the rest of the hub-mirror plumbing (which
 * itself depends on `repo-config.ts`). The split exists for ONE reason: the
 * per-machine `config.override.json` layer (resolved in `repo-config.ts`)
 * needs the hub key to look up the per-repo override bucket — but
 * `repo-config.ts` cannot import from `repo-mirror.ts` without a cycle. The
 * key encoder is pure (URL → string) and has no business depending on the
 * mirror or the per-repo config, so it lives here. `repo-mirror.ts` re-exports
 * {@link encodeRepoKey} so existing callers see no change.
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
