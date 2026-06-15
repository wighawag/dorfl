/**
 * Minimal, dependency-free parser for the small slice of YAML frontmatter the
 * `work/` contract uses: top-level scalar keys and string lists (inline `[a, b]`
 * or block `- a` form). It deliberately does NOT implement general YAML — only
 * what `work/` slice frontmatter needs (slug, humanOnly, blockedBy, ...).
 */

/**
 * **Origin-trust PROVENANCE** (slice `untrusted-origin-forces-build-propose`).
 * How a PRD/slice was BORN and the AUTHOR-TRUST verdict at birth, stamped so the
 * signal SURVIVES the PRD/slice merge boundary (a landed-on-`main` artifact would
 * otherwise erase how it was created — the laundering gap).
 *
 * - `origin` — `human` (the default / unset: a human authored it locally; a local
 *   intake with no `--origin-trust` is ALSO this) | `issue` (the CI intake
 *   front-door stamped it from a public issue).
 * - `originTrust` — `trusted` | `untrusted`, the `author_association` verdict at
 *   birth (only meaningful when `origin: issue`). UNSET ⇒ `trusted` (the normal
 *   human path; ZERO behaviour change). `untrusted` forces the slice's BUILD
 *   transition to `propose` so a human reviews the becomes-code change (an
 *   explicit `--merge` still overrides — the operator is present).
 *
 * `intake.ts` does NOT resolve the trust verdict itself (the `intake.ts` ~L296
 * boundary: trust is CI's POLICY); the CI shell passes it IN via `--origin-trust`.
 */
export type Origin = 'human' | 'issue';
export type OriginTrust = 'trusted' | 'untrusted';

export interface Frontmatter {
	/**
	 * How the artifact was BORN (`human`|`issue`). `undefined` when omitted
	 * (⇒ `human`/trusted: the normal local-author path, no behaviour change).
	 * Stamped `issue` by the CI intake front-door so the becomes-code checkpoint is
	 * not laundered at the merge boundary.
	 */
	origin: Origin | undefined;
	/**
	 * The author-trust verdict at birth (`trusted`|`untrusted`); only meaningful
	 * when `origin: issue`. `undefined` when omitted (⇒ `trusted`: the normal path,
	 * zero behaviour change). An `untrusted` slice forces its BUILD transition to
	 * `propose` (overridable by an explicit `--merge`).
	 */
	originTrust: OriginTrust | undefined;
	/** Content-derived slug id (frontmatter `slug:`). */
	slug: string | undefined;
	/** Source PRD slug (frontmatter `prd:`); the PRD lives at `work/prd/<prd>.md`. */
	prd: string | undefined;
	/**
	 * The GitHub issue number an `intake`-emitted artifact was transformed from
	 * (frontmatter `issue:`). Parsed so the `issue: N` intake writes is
	 * MACHINE-READABLE — the close JOB (`runner-in-ci`'s) reaches it to resolve the
	 * issue from folder + field state. Carried on EITHER:
	 *
	 * - a **PRD** (`intake`'s PRD outcome) — a fanned slice reaches it via
	 *   `slice.prd: → work/prd/<prd>.md → PRD issue:` (the number lives ONLY on the
	 *   PRD, never duplicated across the N fanned slices); OR
	 * - a **lone slice** (`intake`'s SLICE outcome, no `prd:`) — the provider-agnostic
	 *   closure link for a slice that closes its own issue directly (replaces the old
	 *   GitHub-only `Fixes #N` body line, which is now a deferred optimisation).
	 *
	 * INVARIANT — one closure path per slice: a slice uses `issue:` XOR `prd:`, never
	 * both. Either it closes its own issue directly (`issue:`) or it contributes to a
	 * PRD that closes the issue (`prd:` → PRD `issue:`). This is NOT enforced by a
	 * throwing validator (there is no frontmatter-validation layer): intake never
	 * emits both — its slice / PRD dispatch branches are mutually exclusive — so only
	 * a human hand-edit could produce both, and the precedence rule (`prd:` wins,
	 * `issue:` ignored) is the future close-job's concern (see {@link
	 * resolveClosingIssue}), degrading a typo to "use the PRD's number" rather than
	 * crashing. `undefined` when omitted (every non-intake PRD and most slices).
	 */
	issue: number | undefined;
	/**
	 * Autonomy gate axis 1 (DECIDED). `true` when the item declares itself
	 * human-only (a human must drive it regardless of how complete the spec is);
	 * `undefined` when omitted (undeclared — most items). Present on both slices
	 * and PRDs.
	 */
	humanOnly: boolean | undefined;
	/**
	 * Autonomy gate axis 2 (DISCOVERED). `true` when the item has unresolved
	 * questions blocking autonomous progress (the open questions live in the body);
	 * `undefined` when omitted. Orthogonal to `humanOnly`; present on both slices
	 * and PRDs.
	 */
	needsAnswers: boolean | undefined;
	/**
	 * The triage SETTLED marker (US #30). A non-empty `triaged:` value (e.g.
	 * `keep` / `duplicate`) means a human (or the conservative auto-disposition)
	 * has SETTLED this observation, so it DROPS OUT of the triage candidate pool
	 * and is never re-asked. `undefined` when omitted (an UNTRIAGED observation,
	 * still in the pool). Carried so the lifecycle-pool enumeration
	 * (`advance-autopick-lifecycle-pools`) can exclude settled observations from
	 * the triage selection.
	 */
	triaged: string | undefined;
	/** Slugs this item is blocked by; `[]` when omitted or empty. */
	blockedBy: string[];
	/**
	 * PRD-only: slugs of PRDs that must already be SLICED before this PRD may be
	 * sliced (resolved against `work/prd-sliced/` residence, NOT `done/`). `[]` when
	 * omitted or empty. Parsed here so the auto-slicer can read it; enforcement
	 * lives in the `auto-slice` capability, not in eligibility.
	 */
	sliceAfter: string[];
}

/**
 * Extract the raw frontmatter block (the lines between the leading `---` and the
 * next `---`). Returns `undefined` when the document does not start with a
 * frontmatter fence.
 */
function extractBlock(content: string): string | undefined {
	const normalized = content.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
	if (!normalized.startsWith('---\n') && normalized !== '---') {
		return undefined;
	}
	const lines = normalized.split('\n');
	// First line is the opening fence.
	const closing = lines.indexOf('---', 1);
	if (closing === -1) {
		return undefined;
	}
	return lines.slice(1, closing).join('\n');
}

/** Strip surrounding single or double quotes from a scalar token. */
function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' || first === "'") && last === first) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function parseInlineList(value: string): string[] {
	const inner = value.trim().slice(1, -1).trim();
	if (inner === '') {
		return [];
	}
	return inner
		.split(',')
		.map((item) => unquote(item))
		.filter((item) => item !== '');
}

function toBoolean(value: string): boolean | undefined {
	const v = unquote(value).toLowerCase();
	if (v === 'true') {
		return true;
	}
	if (v === 'false') {
		return false;
	}
	return undefined;
}

/**
 * Set (or clear) the top-level `needsAnswers:` frontmatter marker on a `work/`
 * markdown document, returning the new content. Used by the slicer review→edit
 * LOOP's verdict sink (`slicer-review-edit-loop`) to emit a specific uncertain
 * candidate slice as `needsAnswers: true` (open questions block autonomous build;
 * a human must answer them). If a `needsAnswers:` line already exists it is
 * REPLACED (idempotent); otherwise it is appended as the last line inside the
 * frontmatter fence. A document with no frontmatter fence is returned unchanged.
 */
export function setNeedsAnswersMarker(content: string, value: boolean): string {
	return setFrontmatterMarker(content, 'needsAnswers', String(value));
}

/**
 * Set (or replace) a top-level scalar `<key>: <value>` frontmatter marker on a
 * `work/` markdown document, returning the new content. The generalised form of
 * {@link setNeedsAnswersMarker} the advance APPLY rung uses to stamp a
 * `triaged: keep` marker (US #30) on an item a human answered "keep" — so a
 * settled observation drops out of the candidate pool and is never re-asked. If a
 * `<key>:` line already exists it is REPLACED (idempotent); otherwise it is
 * appended as the last line inside the frontmatter fence. A document with no
 * frontmatter fence is returned unchanged (state stays the folder — this is a
 * tooling-owned axis marker, never prose).
 */
export function setFrontmatterMarker(
	content: string,
	key: string,
	value: string,
): string {
	const normalized = content.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n')) {
		return content;
	}
	const lines = normalized.split('\n');
	const closing = lines.indexOf('---', 1);
	if (closing === -1) {
		return content;
	}
	const pattern = new RegExp(`^${key}\\s*:`);
	for (let i = 1; i < closing; i++) {
		if (pattern.test(lines[i])) {
			lines[i] = `${key}: ${value}`;
			return lines.join('\n');
		}
	}
	lines.splice(closing, 0, `${key}: ${value}`);
	return lines.join('\n');
}

/**
 * PROPAGATE the origin-trust PROVENANCE (`origin` + `originTrust`) from a SOURCE
 * artifact (a PRD) onto a TARGET artifact's content (an emitted slice), returning
 * the new content (slice `untrusted-origin-forces-build-propose`). The slicer
 * calls this so a slice born from an untrusted-origin PRD carries the stamp the
 * BUILD transition reads. IDEMPOTENT: each present source field is written via
 * {@link setFrontmatterMarker} (replace-or-append). When the source has NO `origin`
 * (a human/local-authored PRD ⇒ trusted), the target is returned UNCHANGED — the
 * normal path is never stamped (zero behaviour change). A target with no
 * frontmatter fence is returned unchanged (setFrontmatterMarker's contract).
 */
export function propagateOrigin(
	source: Pick<Frontmatter, 'origin' | 'originTrust'>,
	targetContent: string,
): string {
	if (source.origin === undefined && source.originTrust === undefined) {
		return targetContent;
	}
	let next = targetContent;
	if (source.origin !== undefined) {
		next = setFrontmatterMarker(next, 'origin', source.origin);
	}
	if (source.originTrust !== undefined) {
		next = setFrontmatterMarker(next, 'originTrust', source.originTrust);
	}
	return next;
}

export function parseFrontmatter(content: string): Frontmatter {
	const block = extractBlock(content);
	const result: Frontmatter = {
		origin: undefined,
		originTrust: undefined,
		slug: undefined,
		prd: undefined,
		issue: undefined,
		humanOnly: undefined,
		needsAnswers: undefined,
		triaged: undefined,
		blockedBy: [],
		sliceAfter: [],
	};
	if (block === undefined) {
		return result;
	}

	const lines = block.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Skip blank lines and comments and non top-level (indented) lines; block
		// list items are consumed inline below.
		if (line.trim() === '' || line.trimStart().startsWith('#')) {
			continue;
		}
		const match = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
		if (!match) {
			continue;
		}
		const key = match[1];
		const rawValue = match[2].trim();

		if (key === 'origin') {
			// Provenance: how the artifact was born. Only the known values map;
			// anything else (or empty) reads as undefined (⇒ the human/trusted default).
			const v = unquote(rawValue).toLowerCase();
			result.origin = v === 'human' || v === 'issue' ? v : undefined;
		} else if (key === 'originTrust') {
			// The author-trust verdict at birth. Only the known values map; anything
			// else (or empty) reads as undefined (⇒ trusted, the zero-change default).
			const v = unquote(rawValue).toLowerCase();
			result.originTrust = v === 'trusted' || v === 'untrusted' ? v : undefined;
		} else if (key === 'slug') {
			result.slug = rawValue === '' ? undefined : unquote(rawValue);
		} else if (key === 'prd') {
			result.prd = rawValue === '' ? undefined : unquote(rawValue);
		} else if (key === 'issue') {
			// Integer issue link (`intake`'s PRD-emit OR a lone-slice emit). A
			// non-integer / empty value reads as undefined (the field is absent rather
			// than malformed).
			const n = Number(unquote(rawValue));
			result.issue =
				rawValue !== '' && Number.isInteger(n) && n > 0 ? n : undefined;
		} else if (key === 'humanOnly') {
			result.humanOnly = rawValue === '' ? undefined : toBoolean(rawValue);
		} else if (key === 'needsAnswers') {
			result.needsAnswers = rawValue === '' ? undefined : toBoolean(rawValue);
		} else if (key === 'triaged') {
			// The SETTLED marker: a non-empty value (`keep`/`duplicate`) drops the
			// observation out of the triage pool. An empty value reads as undefined
			// (undeclared — still untriaged).
			result.triaged = rawValue === '' ? undefined : unquote(rawValue);
		} else if (key === 'blockedBy' || key === 'sliceAfter') {
			let list: string[];
			if (rawValue.startsWith('[')) {
				list = parseInlineList(rawValue);
			} else if (rawValue === '') {
				// Block-style list: consume following indented `- item` lines.
				const items: string[] = [];
				let j = i + 1;
				while (j < lines.length) {
					const itemMatch = /^\s+-\s*(.+)$/.exec(lines[j]);
					if (!itemMatch) {
						break;
					}
					const item = unquote(itemMatch[1]);
					if (item !== '') {
						items.push(item);
					}
					j++;
				}
				list = items;
				i = j - 1;
			} else {
				list = [];
			}
			if (key === 'blockedBy') {
				result.blockedBy = list;
			} else {
				result.sliceAfter = list;
			}
		}
	}

	return result;
}

/**
 * Resolve, from a parsed artifact's frontmatter, HOW it closes its source issue:
 * the `prd:` hop or the lone-slice `issue:` field. A PURE helper for the FUTURE
 * CI close-job (`runner-in-ci`'s) — it is NOT wired into intake or any reader
 * today; it merely pins the one-closure-path PRECEDENCE in one place.
 *
 * Encodes the invariant: a slice uses `issue:` XOR `prd:`. When (only a human
 * hand-edit could) BOTH are present, `prd:` WINS — the close-job hops to the PRD's
 * `issue:` and IGNORES the slice's own `issue:` (the fanned-PRD path is the
 * authoritative one; a lone `issue:` on a `prd:`-bearing slice is a contradiction
 * that degrades to "use the PRD" rather than crashing).
 *
 * Returns:
 * - `{via: 'prd', prd}` when a `prd:` is present (hop to the PRD's `issue:`; the
 *   caller resolves the PRD file to read its number);
 * - `{via: 'issue', issue}` when only a lone-slice `issue:` is present;
 * - `undefined` when neither is present (no closure path).
 */
export function resolveClosingIssue(
	frontmatter: Pick<Frontmatter, 'prd' | 'issue'>,
): {via: 'prd'; prd: string} | {via: 'issue'; issue: number} | undefined {
	if (frontmatter.prd !== undefined) {
		return {via: 'prd', prd: frontmatter.prd};
	}
	if (frontmatter.issue !== undefined) {
		return {via: 'issue', issue: frontmatter.issue};
	}
	return undefined;
}
