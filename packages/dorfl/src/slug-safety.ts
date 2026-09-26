/**
 * The SAFE-SLUG character set, and the one sanitiser every slug-producing path
 * shares.
 *
 * A slug is not just a label: it becomes a file name (`work/<folder>/<slug>.md`),
 * part of a git ref (`work/<slug>`, `work/intake-task-<slug>`), a command-line
 * argument (`dorfl advance "task:<slug>"`, one per CI matrix leg) and text in
 * commit messages. Several producers draft slugs from content an outsider can
 * influence: `intake` from an issue's title and thread, the triage and apply
 * rungs from an agent verdict. Before this module the only transform was
 * `paramCase`, which keeps `$(`, backticks, quotes, `;`, `|` and `/`, and the
 * triage/ADR paths only `trim()`med, so a drafted `../x` escaped its folder.
 *
 * Two functions, two jobs:
 *
 *   - {@link toSafeSlug} is for PRODUCERS: it turns any drafted text into a slug
 *     made only of ASCII letters, digits and single hyphens. Its output always
 *     passes {@link isSafeSlug}.
 *   - {@link isSafeSlug} is for CONSUMERS: the slug resolvers refuse any slug
 *     outside the safe set, which covers slugs no producer here minted (a
 *     frontmatter `slug:` a human or agent wrote by hand). It is deliberately a
 *     little wider than what {@link toSafeSlug} emits (it also allows `.` and
 *     `_` and mixed case) so every slug already in use in a real `work/` tree
 *     keeps resolving: those characters are inert in a file name, a ref and a
 *     quoted shell word. `..` is still refused (path traversal), as is a leading
 *     `-` (it would read as a command-line option) or `.` (a hidden file), and so
 *     is a `.lock` suffix (git refuses it in a ref component).
 */

/**
 * The longest slug either function accepts. Real slugs in this repo top out
 * around 105 characters; 120 leaves room without letting a drafted essay become
 * a file name or ref component.
 */
export const MAX_SLUG_LENGTH = 120;

/** Letters, digits, `.`, `_`, `-`; starts and ends with a letter or digit. */
const SAFE_SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** Git refuses a ref component ending in `.lock` (its lock-file suffix). */
const GIT_LOCK_SUFFIX_RE = /\.lock$/i;

/**
 * Whether `slug` is safe to use as a file name, a git ref component and a
 * command-line argument (see the module doc for the exact set).
 */
export function isSafeSlug(slug: string): boolean {
	return (
		slug.length > 0 &&
		slug.length <= MAX_SLUG_LENGTH &&
		SAFE_SLUG_RE.test(slug) &&
		!slug.includes('..') &&
		!GIT_LOCK_SUFFIX_RE.test(slug)
	);
}

/**
 * Turn drafted text into a safe slug: accents are folded to their base letter,
 * every run of anything other than an ASCII letter or digit becomes ONE hyphen,
 * leading/trailing hyphens are dropped, and the result is capped at
 * {@link MAX_SLUG_LENGTH}. Case is preserved (callers that want lower case, like
 * `intake`, `paramCase` first). Returns `''` when nothing usable is left, so the
 * caller's existing "no slug to derive" refusal fires instead of a junk name.
 */
export function toSafeSlug(input: string): string {
	return input
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^A-Za-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/-+$/, '');
}

/**
 * Keep a slug that is already safe EXACTLY as it is, and sanitise one that is
 * not. The producers use this so every input that worked before still yields
 * the same slug, and only an unsafe one changes.
 */
export function ensureSafeSlug(input: string): string {
	const trimmed = input.trim();
	return isSafeSlug(trimmed) ? trimmed : toSafeSlug(trimmed);
}
