/**
 * Minimal, dependency-free parser for the small subset of YAML frontmatter the
 * `work/` contract uses: top-level scalar keys and string lists (inline `[a, b]`
 * or block `- a` form). It deliberately does NOT implement general YAML — only
 * what `work/` task frontmatter needs (slug, humanOnly, blockedBy, ...).
 */

/**
 * **Origin-trust PROVENANCE** (task `untrusted-origin-forces-build-propose`).
 * How a spec/task was BORN and the AUTHOR-TRUST verdict at birth, stamped so the
 * signal SURVIVES the spec/task merge boundary (a landed-on-`main` artifact would
 * otherwise erase how it was created — the laundering gap).
 *
 * - `origin` — `human` (the default / unset: a human authored it locally; a local
 *   intake with no `--origin-trust` is ALSO this) | `issue` (the CI intake
 *   front-door stamped it from a public issue).
 * - `originTrust` — `trusted` | `untrusted`, the `author_association` verdict at
 *   birth (only meaningful when `origin: issue`). UNSET ⇒ `trusted` (the normal
 *   human path; ZERO behaviour change). `untrusted` forces the task's BUILD
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
	 * zero behaviour change). An `untrusted` task forces its BUILD transition to
	 * `propose` (overridable by an explicit `--merge`).
	 */
	originTrust: OriginTrust | undefined;
	/** Content-derived slug id (frontmatter `slug:`). */
	slug: string | undefined;
	/**
	 * Source SPEC slug: the parent-spec pointer this artifact derives from; the
	 * spec lives at `work/specs/ready/<spec>.md`. The `spec` vocabulary name (spec
	 * `prd-to-spec-vocabulary-cutover-and-migration-command`). `parseFrontmatter`
	 * populates it from the canonical `spec:` key ONLY — the HARD CUTOVER (the last
	 * ''prd'' back-compat surface removed): the legacy ''prd:'' KEY read is GONE, so
	 * an un-migrated ''prd:'' field no longer silently resolves. A downstream repo
	 * migrates its data with `dorfl prd-to-spec` (a purely TEXTUAL `prd: → spec:`
	 * rewrite that does NOT go through this parser), after which the field reads
	 * canonically. There is no `fm.prd` FIELD.
	 */
	spec: string | undefined;
	/**
	 * The GitHub issue number an `intake`-emitted artifact was transformed from
	 * (frontmatter `issue:`). Parsed so the `issue: N` intake writes is
	 * MACHINE-READABLE — the close JOB (`runner-in-ci`'s) reaches it to resolve the
	 * issue from folder + field state. Carried on EITHER:
	 *
	 * - a **spec** (`intake`'s spec outcome) — a fanned task reaches it via
	 *   `task.spec: → work/specs/ready/<spec>.md → spec issue:` (the number lives
	 *   ONLY on the spec, never duplicated across the N fanned tasks); OR
	 * - a **lone task** (`intake`'s TASK outcome, no `spec:`) — the provider-agnostic
	 *   closure link for a task that closes its own issue directly (replaces the old
	 *   GitHub-only `Fixes #N` body line, which is now a deferred optimisation).
	 *
	 * INVARIANT — one closure path per task: a task uses `issue:` XOR `spec:`, never
	 * both. Either it closes its own issue directly (`issue:`) or it contributes to a
	 * spec that closes the issue (`spec:` → spec `issue:`). This is NOT enforced by a
	 * throwing validator (there is no frontmatter-validation layer): intake never
	 * emits both — its task / spec dispatch branches are mutually exclusive — so only
	 * a human hand-edit could produce both, and the precedence rule (`spec:` wins,
	 * `issue:` ignored) is the future close-job's concern (see {@link
	 * resolveClosingIssue}), degrading a typo to "use the spec's number" rather than
	 * crashing. `undefined` when omitted (every non-intake spec and most tasks).
	 */
	issue: number | undefined;
	/**
	 * Autonomy gate axis 1 (DECIDED). `true` when the item declares itself
	 * human-only (a human must drive it regardless of how complete the spec is);
	 * `undefined` when omitted (undeclared — most items). Present on both tasks
	 * and prds.
	 */
	humanOnly: boolean | undefined;
	/**
	 * Autonomy gate axis 2 (DISCOVERED). `true` when the item has unresolved
	 * questions blocking autonomous progress (the open questions live in the body);
	 * `undefined` when omitted. Orthogonal to `humanOnly`; present on both tasks
	 * and prds.
	 */
	needsAnswers: boolean | undefined;
	/**
	 * The triage SETTLED marker (US #30). A non-empty `triaged:` value means this
	 * observation's triage QUESTION-LOOP has been settled by a human's answer, so it
	 * DROPS OUT of the triage candidate pool and is never re-asked. `undefined` when
	 * omitted (an UNTRIAGED observation, still in the pool). Carried so the
	 * lifecycle-pool enumeration (`advance-autopick-lifecycle-pools`) can exclude
	 * settled observations from the triage selection.
	 *
	 * The one WRITER today is the apply rung's `resolve` verdict, which stamps
	 * `triaged: resolve` on a note it settles and KEEPS (ADR
	 * `resolve-settles-the-question-loop-not-the-note`). It says the question-loop is
	 * settled, NOT that the signal is finished — a finished signal has no resting
	 * state at all (it is deleted), and an ANSWERED sidecar still dominates this
	 * marker (ADR `answered-observation-sidecar-dominates-triaged-marker`), so a
	 * genuinely new question about a settled note is still asked and answered.
	 */
	triaged: string | undefined;
	/** Slugs this item is blocked by; `[]` when omitted or empty. */
	blockedBy: string[];
	/**
	 * Spec-only: slugs of prds that must already be TASKED before this spec may be
	 * tasked (resolved against `work/specs/tasked/` residence, NOT `done/`). `[]` when
	 * omitted or empty. Parsed here so the auto-tasker can read it; enforcement
	 * lives in the `auto-slice` capability, not in eligibility.
	 */
	taskedAfter: string[];
	/**
	 * The per-item override layer for the `promptGuidance` NUDGE namespace
	 * (task `prompt-guidance-testfirst-item-override`, spec US #5). A task or
	 * spec may carry one or more `promptGuidance.<member>: true | false`
	 * frontmatter lines to OVERRIDE the resolved repo policy for THAT ITEM only.
	 * Each member is `undefined` when omitted (⇒ inherit the next layer down in
	 * the precedence chain: per-task > per-spec > repo-resolved). The override
	 * is honoured at the prompt-assembly seam (`prompt.ts`); it never affects
	 * the `verify` gate.
	 *
	 * Parsed from the DOTTED scalar form `promptGuidance.testFirst: true`
	 * (single-line, mirroring the flat shape `humanOnly`/`needsAnswers` use at the
	 * item level). A mistyped value (e.g. `"yes"`) reads as `undefined`, the same
	 * silent-on-malformed behaviour the existing `humanOnly` parsing has — no
	 * silent coerce to true/false.
	 */
	promptGuidance: {testFirst: boolean | undefined};
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

/**
 * Strip surrounding single or double quotes from a scalar token. A
 * SINGLE-quoted scalar also has its one YAML escape decoded (`''` is a literal
 * `'`), so a value written by {@link quoteYamlScalar} reads back verbatim.
 * Double-quoted scalars keep their inner text as-is (no backslash decoding).
 */
function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' || first === "'") && last === first) {
			const inner = trimmed.slice(1, -1);
			return first === "'" ? inner.replace(/''/g, "'") : inner;
		}
	}
	return trimmed;
}

/**
 * The read half of {@link quoteYamlScalar}, for the frontmatter readers that
 * live outside this module (the `title:` readers in `tasking.ts` and
 * `integration-core.ts`), so a quoted title reads back the same everywhere.
 */
export function unquoteYamlScalar(value: string): string {
	return unquote(value);
}

/**
 * Raised when a runner-side renderer is handed a value it cannot write safely
 * into frontmatter, or when the rendered document does not read back the keys
 * the runner meant to write (task
 * `intake-frontmatter-title-injection-strips-origin-stamp`).
 */
export class FrontmatterRenderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FrontmatterRenderError';
	}
}

/**
 * Any character that can end or fold a YAML line, or any other control
 * character: C0 controls (incl. tab, LF, CR), DEL, the C1 range (incl. NEL
 * U+0085, a YAML 1.1 line break), and the Unicode line/paragraph separators.
 */
// eslint-disable-next-line no-control-regex
const SCALAR_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Why `value` cannot be a one-line frontmatter scalar, or `undefined` when it
 * can. The verdict boundaries (intake, ADR mint) use it to refuse an
 * agent-drafted title before anything is rendered.
 */
export function singleLineScalarProblem(value: string): string | undefined {
	return SCALAR_CONTROL_RE.test(value)
		? 'must be a single line with no control characters'
		: undefined;
}

/**
 * THE shared quoter for agent-supplied text a runner writes into frontmatter
 * (task `intake-frontmatter-title-injection-strips-origin-stamp`). Returns a
 * YAML single-quoted scalar (`'...'`, an embedded `'` doubled), which is valid
 * YAML for every one-line string and reads back verbatim through
 * {@link unquote} (and so {@link readFrontmatterField}). A single-quoted scalar
 * has no escape for a line break, so a value that is not one line, or holds any
 * control character, THROWS {@link FrontmatterRenderError}: callers must reject
 * such a value at their verdict boundary, and this throw is the backstop.
 */
export function quoteYamlScalar(value: string): string {
	const problem = singleLineScalarProblem(value);
	if (problem !== undefined) {
		throw new FrontmatterRenderError(
			`frontmatter value ${JSON.stringify(value)} ${problem}`,
		);
	}
	return `'${value.replace(/'/g, "''")}'`;
}

/** A top-level `key: value` frontmatter line (the key grammar {@link parseFrontmatter} uses). */
const TOP_LEVEL_KEY_RE = /^([A-Za-z0-9_.]+)\s*:\s*(.*)$/;

/**
 * The post-render RE-PARSE assertion (task
 * `intake-frontmatter-title-injection-strips-origin-stamp`). A runner renders a
 * document, then calls this with the frontmatter values it MEANT to write;
 * any disagreement THROWS {@link FrontmatterRenderError}, so a document whose
 * runner-owned keys were displaced (a closed-early fence demoting the
 * `originTrust` stamp into the body, a smuggled duplicate `slug:`) is never
 * emitted.
 *
 * For each `expected` entry: a string value means the key must appear EXACTLY
 * ONCE as a top-level key and read back (via {@link unquote}) equal to it;
 * `undefined` means the key must be ABSENT. The typed keys that
 * {@link parseFrontmatter} models (`slug`, `issue`, `origin`, `originTrust`,
 * `humanOnly`, `needsAnswers`) are ALSO cross-checked through that parser, the
 * same reader the rest of dorfl uses. With `exact`, the frontmatter may hold no
 * top-level key outside `expected` (for a document the runner renders whole).
 */
export function assertFrontmatterFields(
	content: string,
	expected: Readonly<Record<string, string | undefined>>,
	options: {exact?: boolean} = {},
): void {
	const block = extractBlock(content);
	if (block === undefined) {
		throw new FrontmatterRenderError(
			'rendered document has no frontmatter block',
		);
	}
	const seen = new Map<string, string[]>();
	for (const line of block.split('\n')) {
		const match = TOP_LEVEL_KEY_RE.exec(line);
		if (!match) continue;
		const values = seen.get(match[1]) ?? [];
		values.push(unquote(match[2]));
		seen.set(match[1], values);
	}
	const fail = (detail: string): never => {
		throw new FrontmatterRenderError(
			`rendered frontmatter does not read back as written: ${detail}`,
		);
	};
	for (const [key, want] of Object.entries(expected)) {
		const got = seen.get(key) ?? [];
		if (want === undefined) {
			if (got.length > 0) fail(`'${key}' must be absent`);
			continue;
		}
		if (got.length !== 1) {
			fail(`'${key}' appears ${got.length} time(s), expected once`);
		}
		if (got[0] !== want) {
			fail(
				`'${key}' reads ${JSON.stringify(got[0])}, expected ${JSON.stringify(want)}`,
			);
		}
	}
	if (options.exact === true) {
		for (const key of seen.keys()) {
			if (!(key in expected)) fail(`unexpected key '${key}'`);
		}
	}
	// Cross-check through the typed parser (last-wins, value-normalising), so a
	// document that passes the line check but that dorfl would READ differently
	// still fails.
	const fm = parseFrontmatter(content);
	const typed: Record<string, string | undefined> = {
		slug: fm.slug,
		issue: fm.issue === undefined ? undefined : String(fm.issue),
		origin: fm.origin,
		originTrust: fm.originTrust,
		humanOnly: fm.humanOnly === undefined ? undefined : String(fm.humanOnly),
		needsAnswers:
			fm.needsAnswers === undefined ? undefined : String(fm.needsAnswers),
	};
	for (const [key, parsed] of Object.entries(typed)) {
		if (key in expected && parsed !== expected[key]) {
			fail(
				`parsed '${key}' is ${JSON.stringify(parsed)}, expected ${JSON.stringify(expected[key])}`,
			);
		}
	}
}

/**
 * Extract the `[...]` body of a YAML flow-style inline list, IGNORING anything
 * after the matching closing `]` (notably a trailing `# comment`, the documented
 * house style on `blockedBy: [] # startable now`). Quote-aware: a `]` inside a
 * single/double-quoted item is data, not the list terminator. Returns the inner
 * text (between the brackets), or `undefined` if no matching `]` is found
 * (malformed — caller treats it as empty).
 */
function inlineListInner(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed[0] !== '[') {
		return undefined;
	}
	let quote: "'" | '"' | undefined;
	for (let i = 1; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (quote) {
			if (ch === quote) {
				quote = undefined;
			}
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (ch === ']') {
			return trimmed.slice(1, i);
		}
	}
	return undefined;
}

function parseInlineList(value: string): string[] {
	const body = inlineListInner(value);
	if (body === undefined) {
		return [];
	}
	const inner = body.trim();
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
 * markdown document, returning the new content. Used by the tasker review→edit
 * LOOP's verdict sink (`slicer-review-edit-loop`) to emit a specific uncertain
 * candidate task as `needsAnswers: true` (open questions block autonomous build;
 * a human must answer them). If a `needsAnswers:` line already exists it is
 * REPLACED (idempotent); otherwise it is appended as the last line inside the
 * frontmatter fence. A document with NO frontmatter fence gets one PREPENDED (see
 * {@link setFrontmatterMarker}) — observations are born fence-less (the
 * `capture-signal` skill writes prose), so the tooling-owned `needsAnswers` axis
 * MUST be settable on them rather than silently dropped.
 */
export function setNeedsAnswersMarker(content: string, value: boolean): string {
	return setFrontmatterMarker(content, 'needsAnswers', String(value));
}

/**
 * Set (or replace) a top-level scalar `<key>: <value>` frontmatter marker on a
 * `work/` markdown document, returning the new content. The generalised form of
 * {@link setNeedsAnswersMarker} the advance APPLY rung uses to stamp the
 * `triaged: resolve` marker (US #30) on a note a human's answer settles but KEEPS
 * — so a settled observation drops out of the candidate pool and is never re-asked. If a
 * `<key>:` line already exists it is REPLACED (idempotent); otherwise it is
 * appended as the last line inside the frontmatter fence.
 *
 * A document with NO frontmatter fence gets ONE PREPENDED carrying just this
 * marker (`---\n<key>: <value>\n---\n\n<body>`). This is the load-bearing fix for
 * `sidecar-without-needsAnswers`: observations are routinely created fence-less
 * (the `capture-signal` skill writes free-form prose), and the OLD behaviour
 * silently returned the body UNCHANGED — so `persistSurfacedQuestions` wrote the
 * sidecar while the `needsAnswers:true` flag it believed it set was discarded,
 * tearing the `needsAnswers ⟺ active sidecar` invariant a later tick refused to
 * classify. These markers (`needsAnswers`, `triaged`) are tooling-owned axes, not
 * prose, so the tool is entitled to introduce the fence it needs.
 *
 * The ONE remaining return-unchanged case is a MALFORMED doc that opens a fence
 * (`---\n`) but never closes it: rewriting that risks corrupting hand-authored
 * content, so it is left untouched (a degenerate input no writer produces).
 */
export function setFrontmatterMarker(
	content: string,
	key: string,
	value: string,
): string {
	// A leading BOM is legal, and the READER ({@link extractBlock}) strips one
	// before looking for the fence. This WRITER must strip it the same way or the
	// two disagree about whether the document HAS frontmatter: a BOM'd doc would
	// fail the `startsWith('---\n')` test below, be judged FENCE-LESS, and get a
	// SECOND fence prepended, demoting the real frontmatter into the body and
	// silently destroying `slug`, `title`, `spec` and `blockedBy`. The corruption
	// is invisible to every defense-in-depth guard that re-parses the result,
	// because the marker itself parses back correctly.
	//
	// The BOM is the document's encoding marker, not ours to drop, so it is
	// stripped only for the ANALYSIS and re-prepended to whatever we return.
	const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
	const normalized = content.slice(bom.length).replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n')) {
		// Fence-less document: PREPEND a minimal fence carrying just this marker,
		// preserving the body verbatim (no leading blank between fence and body is
		// collapsed — exactly one blank line separates the fence from the content).
		const body = normalized.replace(/^\n+/, '');
		return `${bom}---\n${key}: ${value}\n---\n\n${body}`;
	}
	const lines = normalized.split('\n');
	const closing = lines.indexOf('---', 1);
	if (closing === -1) {
		// Malformed: an opening fence with no close. Leave it untouched rather than
		// risk corrupting hand-authored content.
		return content;
	}
	const pattern = new RegExp(`^${key}\\s*:`);
	for (let i = 1; i < closing; i++) {
		if (pattern.test(lines[i])) {
			lines[i] = `${key}: ${value}`;
			return bom + lines.join('\n');
		}
	}
	lines.splice(closing, 0, `${key}: ${value}`);
	return bom + lines.join('\n');
}

/**
 * Read ONE arbitrary top-level scalar frontmatter key by name, returning its
 * unquoted value (or `undefined` when the doc has no fence, or the key is absent).
 *
 * A general-purpose companion to {@link parseFrontmatter} for keys that are NOT in
 * the modelled {@link Frontmatter} shape — e.g. the observation→task provenance
 * back-reference `promotedFrom:` the triage-promote path stamps and the create-CAS
 * lost-race disambiguation reads (task
 * `observation-triage-already-triaged-benign-skip`). Only top-level `key: value`
 * lines are matched (block-list / nested values are out of scope for a scalar read).
 */
export function readFrontmatterField(
	content: string,
	key: string,
): string | undefined {
	const block = extractBlock(content);
	if (block === undefined) {
		return undefined;
	}
	const pattern = new RegExp(`^${key}\\s*:\\s*(.*)$`);
	for (const line of block.split('\n')) {
		const match = pattern.exec(line);
		if (match) {
			const value = unquote(match[1]);
			return value === '' ? undefined : value;
		}
	}
	return undefined;
}

/**
 * PROPAGATE the origin-trust PROVENANCE (`origin` + `originTrust`) from a SOURCE
 * artifact (a spec) onto a TARGET artifact's content (an emitted task), returning
 * the new content (task `untrusted-origin-forces-build-propose`). The tasker
 * calls this so a task born from an untrusted-origin spec carries the stamp the
 * BUILD transition reads. IDEMPOTENT: each present source field is written via
 * {@link setFrontmatterMarker} (replace-or-append). When the source has NO `origin`
 * (a human/local-authored spec ⇒ trusted), the target is returned UNCHANGED — the
 * normal path is never stamped (zero behaviour change). When a stamp IS applied to
 * a fence-less target, {@link setFrontmatterMarker} now prepends a fence to carry
 * it (tasks the tasker emits always have a fence, so this is the defensive path).
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
		spec: undefined,
		issue: undefined,
		humanOnly: undefined,
		needsAnswers: undefined,
		triaged: undefined,
		blockedBy: [],
		taskedAfter: [],
		promptGuidance: {testFirst: undefined},
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
		// Top-level keys are alphanumeric / `_`; the dot is allowed so the per-item
		// override for the `promptGuidance` namespace can be parsed in its DOTTED
		// scalar form (e.g. `promptGuidance.testFirst: true`) without introducing a
		// nested-mapping parser.
		const match = /^([A-Za-z0-9_.]+)\s*:\s*(.*)$/.exec(line);
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
		} else if (key === 'spec') {
			// The parent-spec pointer, read from the canonical `spec:` key ONLY into the
			// `fm.spec` field (spec `prd-to-spec-vocabulary-cutover-and-migration-command`,
			// HARD CUTOVER). The legacy ''prd:'' KEY read is GONE — an un-migrated ''prd:''
			// field no longer resolves here; a repo converts its data via the TEXTUAL
			// `dorfl prd-to-spec` rewrite (which does not use this parser). An empty value
			// leaves the field undefined.
			result.spec = rawValue === '' ? undefined : unquote(rawValue);
		} else if (key === 'issue') {
			// Integer issue link (`intake`'s spec-emit OR a lone-task emit). A
			// non-integer / empty value reads as undefined (the field is absent rather
			// than malformed).
			const n = Number(unquote(rawValue));
			result.issue =
				rawValue !== '' && Number.isInteger(n) && n > 0 ? n : undefined;
		} else if (key === 'promptGuidance.testFirst') {
			// Per-item override for the `promptGuidance.testFirst` nudge. An empty or
			// malformed value reads as `undefined` (⇒ inherit the next layer), the
			// same silent-on-malformed shape `humanOnly` uses — never a silent coerce.
			result.promptGuidance.testFirst =
				rawValue === '' ? undefined : toBoolean(rawValue);
		} else if (key === 'humanOnly') {
			result.humanOnly = rawValue === '' ? undefined : toBoolean(rawValue);
		} else if (key === 'needsAnswers') {
			result.needsAnswers = rawValue === '' ? undefined : toBoolean(rawValue);
		} else if (key === 'triaged') {
			// The SETTLED marker: a non-empty value (`keep`/`duplicate`) drops the
			// observation out of the triage pool. An empty value reads as undefined
			// (undeclared — still untriaged).
			result.triaged = rawValue === '' ? undefined : unquote(rawValue);
		} else if (key === 'blockedBy' || key === 'taskedAfter') {
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
				result.taskedAfter = list;
			}
		}
	}

	return result;
}

/**
 * Resolve, from a parsed artifact's frontmatter, HOW it closes its source issue:
 * the `spec:` hop or the lone-task `issue:` field. A PURE helper for the FUTURE
 * CI close-job (`runner-in-ci`'s) — it is NOT wired into intake or any reader
 * today; it merely pins the one-closure-path PRECEDENCE in one place.
 *
 * Encodes the invariant: a task uses `issue:` XOR `spec:`. When (only a human
 * hand-edit could) BOTH are present, `spec:` WINS — the close-job hops to the
 * spec's `issue:` and IGNORES the task's own `issue:` (the fanned-spec path is
 * the authoritative one; a lone `issue:` on a `spec:`-bearing task is a
 * contradiction that degrades to "use the spec" rather than crashing).
 *
 * Returns:
 * - `{via: 'spec', spec}` when a `spec:` is present (hop to the spec's `issue:`; the
 *   caller resolves the spec file to read its number);
 * - `{via: 'issue', issue}` when only a lone-task `issue:` is present;
 * - `undefined` when neither is present (no closure path).
 */
export function resolveClosingIssue(
	frontmatter: Pick<Frontmatter, 'spec' | 'issue'>,
): {via: 'spec'; spec: string} | {via: 'issue'; issue: number} | undefined {
	if (frontmatter.spec !== undefined) {
		return {via: 'spec', spec: frontmatter.spec};
	}
	if (frontmatter.issue !== undefined) {
		return {via: 'issue', issue: frontmatter.issue};
	}
	return undefined;
}
