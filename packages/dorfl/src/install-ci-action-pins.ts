/**
 * The ONE table of third-party GitHub Actions that `dorfl install-ci` emits,
 * each pinned to a full 40-character commit SHA, plus the regeneration rule that
 * keeps a consumer repository's own pins.
 *
 * WHY SHAS. A tag such as `@v5` can be moved by whoever controls the action's
 * repository, so a compromised or careless release reaches every job that uses
 * it, including dorfl's jobs that hold `contents: write` and a provider API key.
 * A commit SHA cannot move. This is GitHub's own hardening guidance ("Using
 * third-party actions", Security hardening for GitHub Actions).
 *
 * THE FORMAT. Every reference is emitted as `owner/repo@<40-hex-sha> # vX.Y.Z`,
 * the exact shape Dependabot writes and rewrites, so a consumer that enables
 * Dependabot's `github-actions` ecosystem (with `/.github/actions/*` in
 * `directories` for the composite action) gets reviewable bump PRs.
 *
 * HOW EACH SHA WAS RESOLVED (2026-09-26). For each tag:
 *   1. `git ls-remote --tags https://github.com/<owner>/<repo>.git`, reading the
 *      peeled `refs/tags/<tag>^{}` line when the tag is annotated (that line is
 *      the COMMIT; the unpeeled line is the tag OBJECT and must never be used),
 *      else the tag line itself for a lightweight tag;
 *   2. cross-checked with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`
 *      (object type) and `gh api repos/<owner>/<repo>/commits/<sha>` (the SHA is
 *      a commit that exists in the repository).
 *
 *   actions/checkout v7.0.1: lightweight tag, `git/ref` type `commit`,
 *     3d3c42e5aac5ba805825da76410c181273ba90b1 ("prep v7.0.1 release (#2531)").
 *     The floating `v7` tag points at the same commit. v7 is the current major
 *     and adds the fork-PR checkout block for `pull_request_target` /
 *     `workflow_run` that v5 lacks; the inputs dorfl passes (`fetch-depth`,
 *     `persist-credentials`) are unchanged.
 *   actions/setup-node v7.0.0: lightweight tag, `git/ref` type `commit`,
 *     820762786026740c76f36085b0efc47a31fe5020 ("Migrate to ESM and upgrade
 *     dependencies (#1574)"). The floating `v7` tag points at the same commit.
 *     `node-version` and `package-manager-cache` are still inputs (see the
 *     comment on the setup-node step in `generateSetupAction`).
 *   pnpm/action-setup v6.1.0: ANNOTATED tag. `git/ref` type `tag` with object
 *     d9184bf108216479bc5a137cc391f4d7b14c870b (the tag object, NOT usable);
 *     peeled `^{}` and `gh api .../git/tags/d9184bf...` both give the commit
 *     ea17c68df8912ef543352723c149a84f56e3d413 ("feat: support pnpm v12
 *     (#288)"). With no `version` input it still reads `packageManager` from
 *     package.json, which is how dorfl's workspace mode uses it.
 *
 * To bump a pin: resolve the new tag the same way, update the entry, and record
 * the resolution above. `install-ci-actions-pinned.test.ts` fails on any
 * emitted `uses:` that is not a full SHA.
 */

/** One pinned third-party action. */
export interface ActionPin {
	/** `owner/repo`, or `owner/repo/path` for an action in a subdirectory. */
	readonly action: string;
	/** The full 40-character lowercase commit SHA (never a tag object). */
	readonly sha: string;
	/** The release tag the SHA was resolved from, for the trailing comment. */
	readonly version: string;
}

/** Every third-party action dorfl's generators emit. */
export const ACTION_PINS = {
	checkout: {
		action: 'actions/checkout',
		sha: '3d3c42e5aac5ba805825da76410c181273ba90b1',
		version: 'v7.0.1',
	},
	setupNode: {
		action: 'actions/setup-node',
		sha: '820762786026740c76f36085b0efc47a31fe5020',
		version: 'v7.0.0',
	},
	pnpmSetup: {
		action: 'pnpm/action-setup',
		sha: 'ea17c68df8912ef543352723c149a84f56e3d413',
		version: 'v6.1.0',
	},
} as const satisfies Record<string, ActionPin>;

/**
 * The value to put after `uses: ` for a pinned action:
 * `owner/repo@<sha> # vX.Y.Z` (the Dependabot format).
 */
export function pinnedUses(pin: ActionPin): string {
	return `${pin.action}@${pin.sha} # ${pin.version}`;
}

// ─── preserving the consumer's pins on regeneration ─────────────────────────

/**
 * A `uses:` step line: the prefix (indentation, an optional `- ` list marker,
 * `uses:` and its spacing), then the VALUE (an optionally quoted
 * `action@ref`), then an optional trailing comment. Matched per line, which is
 * how both dorfl's templates and Dependabot write these lines. A flow-style or
 * multi-line `uses:` value is not recognised (and so not preserved).
 */
const USES_LINE =
	/^(\s*(?:-\s+)?uses:[ \t]+)((['"]?)([^\s'"@#]+)@([^\s'"#]+)\3(?:[ \t]+#.*)?)[ \t]*$/;

/**
 * A full commit SHA (what counts as "pinned"). Case-insensitive here, so a
 * consumer's uppercase pin is still kept; dorfl itself emits lowercase.
 */
const FULL_SHA = /^[0-9a-f]{40}$/i;

/** The lookup key for an action: GitHub treats `owner/repo` case-insensitively. */
function actionKey(action: string): string {
	return action.toLowerCase();
}

/** A remote action key (`owner/repo[/path]`), i.e. not `./local` nor `docker://`. */
function isRemoteAction(action: string): boolean {
	return !action.startsWith('.') && /^[^/\s]+\/[^/\s]+/.test(action);
}

/** Parse the version out of a trailing `# v1.2.3` comment, for ranking. */
function versionOf(tail: string): number[] | undefined {
	const m = /#\s*v?(\d+(?:\.\d+)*)/.exec(tail);
	return m ? m[1].split('.').map(Number) : undefined;
}

/** Compare two parsed versions; a missing version ranks lowest. */
function compareVersions(a?: number[], b?: number[]): number {
	if (!a || !b) return (a ? 1 : 0) - (b ? 1 : 0);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

/**
 * Collect the SHA pins an existing file already carries, keyed by action
 * (`owner/repo[/path]`). The value is the whole `uses:` value with its trailing
 * comment, exactly as written. When the file pins the same action to several
 * different SHAs, the one whose `# vX.Y.Z` comment is highest wins (ties: the
 * first in the file), so a partial manual bump is never undone.
 */
export function existingPins(existing: string): Map<string, string> {
	const pins = new Map<string, string>();
	// `\r?\n`: a CRLF checkout (Windows, `core.autocrlf`) must not hide its pins,
	// or dorfl's default would silently replace them.
	for (const line of existing.split(/\r?\n/)) {
		const m = USES_LINE.exec(line);
		if (!m) continue;
		const [, , value, , action, ref] = m;
		if (!isRemoteAction(action) || !FULL_SHA.test(ref)) continue;
		const key = actionKey(action);
		const current = pins.get(key);
		if (
			current === undefined ||
			compareVersions(versionOf(value), versionOf(current)) > 0
		) {
			pins.set(key, value);
		}
	}
	return pins;
}

/**
 * Rewrite a freshly generated workflow / composite action so every `uses:` of an
 * action that `existing` already pins to a full SHA keeps the consumer's
 * reference and trailing comment. Matching is by action (`owner/repo`, plus the
 * path for an action in a subdirectory), never by position. An existing TAG is
 * not a pin: the generated reference (dorfl's SHA) stays. So the result never
 * swaps a SHA for a tag. Only the value after `uses: ` changes; indentation and
 * every other line are the generated ones.
 */
export function preserveExistingPins(
	generated: string,
	existing: string | undefined,
): string {
	if (existing === undefined) return generated;
	const pins = existingPins(existing);
	if (pins.size === 0) return generated;
	return generated
		.split('\n')
		.map((line) => {
			const m = USES_LINE.exec(line);
			if (!m) return line;
			const [, prefix, , , action] = m;
			const kept = pins.get(actionKey(action));
			return kept === undefined ? line : `${prefix}${kept}`;
		})
		.join('\n');
}
