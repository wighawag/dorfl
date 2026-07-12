import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {parseSlugArg, type SlugNamespace} from './slug-namespace.js';
import {workItemRel, type WorkFolderKey} from './work-layout.js';

/**
 * The **question/answer SIDECAR contract** (spec `advance-loop`, task
 * `advance-sidecar-contract`) — the one genuinely-new piece of the `advance`
 * family. A strict, tooling-OWNED per-item file `work/questions/<type>-<slug>.md`
 * carrying per-entry answered-state, so the tooling fully owns the Q&A artifact
 * (no fragile round-trip parse of human-authored prose in the item body).
 *
 * This module is the FORMAT + the in-memory model + the pure read/write/append/
 * derived-`allAnswered` operations. The ATOMIC apply (mutate the item body AND
 * the sidecar in ONE commit) lives in {@link applyAtomic} (`sidecar-apply.ts`).
 * It builds NOTHING above the contract — no tick, no verb, no lock, no rungs;
 * later tasks of the family consume these.
 *
 * # On-disk text format (REFORMATTED — ADR `question-sidecar-human-readable-format`)
 *
 * The sidecar is the HUMAN-FACING surface of the answer loop: humans read the
 * question and write the answer in this file, very often through the GitHub web
 * UI. The original `key: |` YAML-block-scalar format rendered as run-together
 * noise on GitHub (literal `|` pipes, collapsed indentation). The on-disk format
 * is now **real Markdown with machine state in HTML comments**:
 *
 *   - An IDENTITY HTML comment at the top carries `item`/`type`/`slug`/
 *     `allAnswered` (`<!-- dorfl-sidecar: item=... type=... slug=... allAnswered=... -->`).
 *   - Per entry: a `## Qn` heading (entry separator + answer boundary), a BOLD
 *     question line, a BLOCKQUOTE context, an ITALIC suggested-default
 *     (`_Suggested default: …_`), a per-entry HTML COMMENT carrying
 *     `id=…` (and an explicit `answered=…` OVERRIDE when it disagrees with the
 *     answer-derived predicate), a fixed answer marker
 *     `**Your answer** (write below this line):`, then the human's answer prose.
 *     (The `disposition=…` field is RETIRED — task
 *     `agentic-apply-retire-disposition-vocabulary`; an entry is binary, and a
 *     stale `disposition=` token in an old sidecar is parsed away.)
 *   - The answer is HEADING-DELIMITED: it spans from the answer marker up to
 *     the next entry `## ` heading (NOT a `---` rule), so a literal `---`
 *     inside an answer cannot break parsing.
 *
 * GitHub renders HTML comments as nothing, so the machine state is invisible to
 * the human and unbreakable by their edit. The human just types prose under the
 * answer marker with no format knowledge.
 *
 * Round-trip is **SEMANTIC** (model-equal, not byte-equal): a parse → serialise
 * canonicalises whitespace; the MODEL (entries, ids, answers, answered-state) is
 * preserved. The load-bearing rules are kept:
 *
 *   - **Identity-keyed, NOT folder-keyed.** The path is derived PURELY from the
 *     item's NAMESPACED identity (`<type>-<slug>`, `:`→`-` for the filename),
 *     using {@link parseSlugArg} (the `slug-namespace.ts` resolver) as the single
 *     source of truth for the identity. There is NO back-pointer field in the
 *     item body — the only in-body signal is the existing `needsAnswers` flag —
 *     so the sidecar survives the item's `git mv`s between lifecycle folders
 *     with no lock-step move.
 *   - **The answered predicate (MAINTAINER-RESOLVED §1):** a non-empty
 *     `answer` ⇒ ANSWERED, with an explicit `answered=…` HTML-comment field as
 *     an OVERRIDE. The override is encoded in the per-entry HTML comment ONLY
 *     when it DISAGREES with the derived predicate (an empty answer with
 *     `answered=true`, or a non-empty answer with `answered=false`); otherwise
 *     the field is omitted so a tolerant "human only types under the answer
 *     marker" edit cannot be re-interpreted as a sticky override on the next
 *     parse.
 *   - **`allAnswered` is DERIVED** — recomputed from the entries on every
 *     serialise; the classifier MAY read it for a cheap scan but MUST NOT trust
 *     it over the entries.
 *   - **Entry ids are stable + monotonic** (`q1`, `q2`, …), NEVER reused.
 *     APPEND adds `qN+1` and never mutates an existing answered entry (the
 *     sidecar is the item's full Q&A history).
 */

/**
 * The item-types a sidecar can key onto (the slug-namespace + obs).
 *
 * HARD CUTOVER (spec `prd-to-spec-vocabulary-cutover-and-migration-command`,
 * contract step): the legacy ''prd'' type member is GONE — the parent-spec type
 * is `'spec'` only. A `spec:<slug>` identity keys onto the `spec-<slug>`
 * lock/sidecar entry. The on-disk `prd-<slug>.md` sidecar FILE (dorfl's
 * not-yet-converted data) is still probed by {@link sidecarPathCandidates} as a
 * legacy file-path fallback — that is a DATA alias the migration command removes,
 * NOT this type member.
 */
export type SidecarType = 'spec' | 'task' | 'observation';

/**
 * The optional, machine-only `kind` AXIS on a question entry — the dispatch
 * signal the answered-question apply rung reads to choose deterministic-action
 * (`merge`, `stuck`) vs agentic-content (`triage`, `spec`) routing WITHOUT
 * sniffing the shape of another field. Absent ⇒ the existing binary content
 * entry (every pre-`kind` sidecar parses + renders byte-identically).
 *
 * INTERIM PRIMITIVE — REMOVE when question sidecars move to KIND-BASED
 * SUBFOLDERS (`work/questions/merge/`, …), where the folder ENCODES the kind
 * and this per-entry field is redundant. See the observation
 * `questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21` + idea
 * `folder-taxonomy-and-prd-edit-handshake`. Built deliberately as a single
 * typed field read in exactly ONE place (the apply dispatch, a later task) so
 * the folder-cutover can DELETE it in one move.
 *
 * A mistyped/unknown `kind=` token parses to `undefined` (silent-on-malformed,
 * mirroring the retired `disposition` precedent), never a throw, never a
 * coerce.
 */
export type SidecarKind = 'merge' | 'stuck' | 'triage' | 'spec';

const SIDECAR_KINDS: ReadonlySet<SidecarKind> = new Set<SidecarKind>([
	'merge',
	'stuck',
	'triage',
	'spec',
]);

/** One question entry in the sidecar (the per-entry source of truth). */
export interface SidecarEntry {
	/** Stable, monotonic id (`q1`, `q2`, …); never reused once minted. */
	id: string;
	/** The question, verbatim. */
	question: string;
	/** Inline context so the human need not open the item. Empty when absent. */
	context: string;
	/** Optional suggested default (the surface-questions humility aid). */
	default?: string;
	/**
	 * The human's answer; empty/absent while unanswered. A NON-EMPTY answer ⇒
	 * answered (see {@link isEntryAnswered}).
	 */
	answer: string;
	/**
	 * The explicit `answered` OVERRIDE, when the human/tooling wrote one. `true`
	 * forces answered; `false` overrides a non-empty answer back to unanswered.
	 * `undefined` ⇒ no override (the answered-ness derives from `answer`).
	 */
	answeredOverride?: boolean;
	/**
	 * Optional dispatch axis (see {@link SidecarKind}). Absent ⇒ the existing
	 * binary content entry. INTERIM — removable once question sidecars move to
	 * kind-based SUBFOLDERS.
	 */
	kind?: SidecarKind;
}

/** The parsed sidecar: identity frontmatter + ordered entries. */
export interface SidecarModel {
	/** The NAMESPACED identity (`spec:autotask`, `task:foo`, `observation:bar`). */
	item: string;
	/** The item type (redundant with the filename; explicit for the parser). */
	type: SidecarType;
	/** The bare slug. */
	slug: string;
	/** The ordered question entries (the source of truth for answered-state). */
	entries: SidecarEntry[];
}

/** Raised for a structurally-invalid sidecar the parser cannot trust. */
export class SidecarParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SidecarParseError';
	}
}

/**
 * Is this entry ANSWERED? The MAINTAINER-RESOLVED §1 predicate: a non-empty
 * `answer` ⇒ answered, with the explicit `answered=…` override (carried in the
 * per-entry HTML comment) winning when present. An explicit `answered=false`
 * overrides a non-empty answer back to unanswered; an explicit `answered=true`
 * forces answered even with an empty answer.
 */
export function isEntryAnswered(entry: SidecarEntry): boolean {
	if (entry.answeredOverride !== undefined) {
		return entry.answeredOverride;
	}
	return entry.answer.trim() !== '';
}

/** Every entry that is NOT yet answered (derived from the entries). */
export function pendingEntries(model: SidecarModel): SidecarEntry[] {
	return model.entries.filter((entry) => !isEntryAnswered(entry));
}

/**
 * Is the WHOLE sidecar answered? DERIVED from the entries (never read off the
 * identity comment mirror). An EMPTY sidecar (no entries) is NOT all-answered —
 * a sidecar with no open questions should not exist (it would be deleted on
 * full resolution), so `allAnswered` over zero entries is `false`, keeping the
 * "pending ⇒ NO-OP" classifier honest.
 */
export function allAnswered(model: SidecarModel): boolean {
	return model.entries.length > 0 && pendingEntries(model).length === 0;
}

const TYPE_TO_NAMESPACE: Record<SidecarType, string> = {
	spec: 'spec',
	task: 'task',
	observation: 'observation',
};

/** Map a namespaced-identity prefix onto the sidecar type. */
function typeForNamespace(
	explicit: SlugNamespace | undefined,
	rawPrefix: string,
): SidecarType {
	// A `spec:` prefix / `explicit === 'spec'` maps to the `'spec'` type — NOT the
	// `task` fall-through below — so `spec:<slug>` gets its own `spec-<slug>`
	// lock/sidecar entry.
	if (explicit === 'spec') {
		return 'spec';
	}
	if (explicit === 'task') {
		return 'task';
	}
	// `parseSlugArg` only knows `task:`/`spec:`; the sidecar adds the
	// `observation:` namespace (`obs:` is the CLI alias the verb resolves; the
	// sidecar stores the canonical `observation`). A bare slug (no prefix)
	// defaults to the task namespace, matching the resolver's "bare = task".
	if (rawPrefix === 'observation' || rawPrefix === 'obs') {
		return 'observation';
	}
	return 'task';
}

/** The resolved identity of a sidecar: `{type, slug, item}`. */
export interface SidecarIdentity {
	type: SidecarType;
	slug: string;
	/** The canonical namespaced identity (`<namespace>:<slug>`). */
	item: string;
}

/**
 * Resolve a namespaced-identity argument (`spec:autotask`, `task:foo`,
 * `observation:bar`, `obs:bar`, or a bare `<slug>` = task) into its
 * `{type, slug, item}`. PURE string work over {@link parseSlugArg} — the
 * resolver is the single source of truth for the task/spec split; the sidecar
 * extends it with the `observation` namespace.
 */
export function resolveSidecarIdentity(identity: string): SidecarIdentity {
	// `observation:`/`obs:` are not slug-namespace prefixes — peel them first.
	const colon = identity.indexOf(':');
	if (colon !== -1) {
		const prefix = identity.slice(0, colon);
		if (prefix === 'observation' || prefix === 'obs') {
			const slug = identity.slice(colon + 1);
			return {type: 'observation', slug, item: `observation:${slug}`};
		}
	}
	const parsed = parseSlugArg(identity);
	const type = typeForNamespace(parsed.explicit, identity.slice(0, colon));
	return {
		type,
		slug: parsed.slug,
		item: `${TYPE_TO_NAMESPACE[type]}:${parsed.slug}`,
	};
}

/**
 * Derive the sidecar PATH `work/questions/<type>-<slug>.md` from the item's
 * namespaced identity. The identity is the single source of truth; `:`→`-` for
 * the filename. Accepts the same forms as {@link resolveSidecarIdentity}.
 */
export function sidecarPathFor(identity: string): string {
	const {type, slug} = resolveSidecarIdentity(identity);
	return workItemRel('questions', `${type}-${slug}.md`);
}

/**
 * The ordered candidate sidecar PATHS a READER should probe for `identity`: the
 * canonical {@link sidecarPathFor} path FIRST, then any legacy-data fallback that
 * may still be on disk before the migration command converts it.
 *
 * MIGRATE step (spec `prd-to-spec-vocabulary-cutover-and-migration-command`): the
 * producer side now emits `spec:<slug>`, so {@link sidecarPathFor} resolves
 * `work/questions/spec-<slug>.md`. But the ON-DISK sidecar is still the legacy
 * `work/questions/prd-<slug>.md` until `dorfl prd-to-spec` renames the DATA. So a
 * `spec`-typed identity ALSO probes the legacy `prd-<slug>.md` as a fallback, and
 * a reader takes the FIRST candidate that exists. This is a FILE-PATH DATA alias
 * the migration command removes (it converts `prd-<slug>.md → spec-<slug>.md` on
 * disk); it is NOT the `SlugNamespace`/`SidecarType` ''prd'' type member. Every
 * non-`spec` type has a single candidate (its canonical path), unchanged.
 */
export function sidecarPathCandidates(identity: string): string[] {
	const {type, slug} = resolveSidecarIdentity(identity);
	const canonical = workItemRel('questions', `${type}-${slug}.md`);
	if (type === 'spec') {
		return [canonical, workItemRel('questions', `prd-${slug}.md`)];
	}
	return [canonical];
}

// --- Format constants -----------------------------------------------------

/** The fixed answer marker the human types prose under. */
const ANSWER_MARKER = '**Your answer** (write below this line):';

/**
 * The lifecycle folders a given item type may currently reside in — the
 * search set the {@link serialiseSidecar} human-visible link line scans to
 * locate the item at write-time. Deliberately INCLUSIVE of the terminal
 * folders (`done`, `cancelled`, `prds-dropped`) so a sidecar still-being-
 * serialised for a finished item still emits a clickable link. Kept LOCAL to
 * this module (rather than reused from `advance.ts`) because this set is the
 * "where might the item CURRENTLY be on disk?" question, which is broader
 * than advance's rung-classifier reach.
 *
 * DECISION (sidecar-visible-item-link): the task set is the four DURABLE
 * folders `tasks-ready` / `done` / `cancelled` / `tasks-backlog` and
 * deliberately EXCLUDES `in-progress` / `needs-attention`. Those two are NOT
 * durable folders — they are retired transient lock-ref state (ADR
 * `needs-attention-folder-cutover-followup-nits`, see the `TASK_LIFECYCLE_FOLDERS`
 * JSDoc in `work-layout.ts`): a stuck task's BODY rests in `tasks/ready/`
 * while the lock carries `state: stuck`, so no task body ever lives under
 * `work/in-progress/` or `work/needs-attention/` for this scan to find. An
 * earlier WIP of this task listed both; narrowing to the durable set matches
 * the current on-disk reality and avoids scanning phantom folders.
 * ALTERNATIVE considered: reuse `TASK_LIFECYCLE_FOLDERS` directly — rejected
 * because it still carries the legacy `in-progress` entry and omits the
 * `cancelled` / `tasks-backlog` folders a sidecar link may need to reach.
 */
const LINK_LIFECYCLE_FOLDERS: Record<SidecarType, readonly WorkFolderKey[]> = {
	task: ['tasks-ready', 'done', 'cancelled', 'tasks-backlog'],
	spec: ['specs-ready', 'specs-tasked', 'specs-proposed', 'specs-dropped'],
	observation: ['observations'],
};

/**
 * Look up the item's CURRENT on-disk repo-relative path by scanning the
 * lifecycle folders its type may reside in, in a documented precedence order.
 * Returns `undefined` when the item is not found in ANY folder — the
 * serialiser's "harmless fallback" (omit the link) branch.
 *
 * PURE lookup: no throws, no side effects. Every call is a fresh scan — the
 * link SELF-HEALS on the next `serialise` after a `git mv` between folders
 * (identity-keyed sidecar; NO lock-step move).
 */
function findItemRelPath(
	repoRoot: string,
	type: SidecarType,
	slug: string,
): string | undefined {
	for (const folder of LINK_LIFECYCLE_FOLDERS[type]) {
		const rel = workItemRel(folder, `${slug}.md`);
		if (existsSync(join(repoRoot, rel))) {
			return rel;
		}
	}
	return undefined;
}

/**
 * Render the human-visible Markdown link line, from the sidecar's fixed path
 * (`work/questions/<type>-<slug>.md`) to the item's current `work/<folder>/
 * <slug>.md`. Since both live under `work/`, the sidecar-relative link is
 * `../<folder-name>/<slug>.md` — the `..` climbs out of `questions/` and the
 * `<folder-name>` (which may contain a `/`, e.g. `tasks/ready`) drops back in.
 */
function renderItemLinkLine(item: string, itemRel: string): string {
	// itemRel is `work/<folder-name>/<slug>.md`; strip the leading `work/` and
	// prefix with `../` so the link is relative to `work/questions/<file>.md`.
	const prefix = 'work/';
	const target = itemRel.startsWith(prefix)
		? `../${itemRel.slice(prefix.length)}`
		: itemRel;
	return `Item: [\`${item}\`](${target})`;
}

// --- Parse ----------------------------------------------------------------

/** Pull the next monotonic id given the highest existing id number. */
function nextId(entries: SidecarEntry[]): string {
	let max = 0;
	for (const entry of entries) {
		const m = /^q(\d+)$/.exec(entry.id);
		if (m) {
			const n = Number(m[1]);
			if (n > max) {
				max = n;
			}
		}
	}
	return `q${max + 1}`;
}

/** Normalise CRLF → LF and strip a leading BOM. */
function normaliseText(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
}

/** Strip leading + trailing blank lines, leaving inner blanks intact. */
function trimBlankLines(value: string): string {
	return value.replace(/^\n+/, '').replace(/\n+$/, '');
}

interface IdentityFields {
	item: string;
	allAnswered?: boolean;
}

/** Parse the top identity HTML comment. */
function parseIdentityComment(line: string): IdentityFields | undefined {
	const match = /^<!--\s*dorfl-sidecar:\s*(.*?)\s*-->\s*$/.exec(line);
	if (!match) {
		return undefined;
	}
	const fields: Record<string, string> = {};
	for (const token of match[1].split(/\s+/)) {
		if (token === '') {
			continue;
		}
		const eq = token.indexOf('=');
		if (eq === -1) {
			continue;
		}
		fields[token.slice(0, eq)] = token.slice(eq + 1);
	}
	const item = fields['item'];
	if (item === undefined || item === '') {
		return undefined;
	}
	const out: IdentityFields = {item};
	if (fields['allAnswered'] !== undefined) {
		out.allAnswered = fields['allAnswered'] === 'true';
	}
	return out;
}

interface EntryFields {
	id?: string;
	answered?: boolean;
	kind?: SidecarKind;
}

/** Parse a per-entry `<!-- qN fields: key=val … -->` HTML comment. */
function parseEntryComment(line: string): EntryFields | undefined {
	const match = /^<!--\s*q\d+\s+fields:\s*(.*?)\s*-->\s*$/.exec(line);
	if (!match) {
		return undefined;
	}
	const out: EntryFields = {};
	for (const token of match[1].split(/\s+/)) {
		if (token === '') {
			continue;
		}
		const eq = token.indexOf('=');
		if (eq === -1) {
			continue;
		}
		const key = token.slice(0, eq);
		const value = token.slice(eq + 1);
		if (key === 'id') {
			out.id = value;
		} else if (key === 'answered') {
			if (value === 'true') {
				out.answered = true;
			} else if (value === 'false') {
				out.answered = false;
			}
		} else if (key === 'kind') {
			// Silent-on-malformed (retired `disposition` precedent): a mistyped or
			// unknown kind reads as `undefined`, never a throw, never a coerce.
			if (SIDECAR_KINDS.has(value as SidecarKind)) {
				out.kind = value as SidecarKind;
			}
		}
	}
	return out;
}

/** Parse one entry's content lines (between two `## ` headings) into an entry. */
function parseEntrySection(lines: string[]): SidecarEntry {
	let id = '';
	let question = '';
	const contextLines: string[] = [];
	let inBlockquote = false;
	let defaultVal: string | undefined;
	let answeredOverride: boolean | undefined;
	let kind: SidecarKind | undefined;
	let answerStart = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === ANSWER_MARKER) {
			answerStart = i + 1;
			break;
		}
		const entryFields = parseEntryComment(line);
		if (entryFields) {
			if (entryFields.id !== undefined) {
				id = entryFields.id;
			}
			if (entryFields.answered !== undefined) {
				answeredOverride = entryFields.answered;
			}
			if (entryFields.kind !== undefined) {
				kind = entryFields.kind;
			}
			inBlockquote = false;
			continue;
		}
		// Blockquote context: collect the FIRST contiguous run of `> …` lines.
		// Once a non-quote line breaks the run, later `>` lines (e.g. the human
		// quoting something in their answer's preamble) are ignored as context.
		const blockquoteMatch = /^>\s?(.*)$/.exec(line);
		if (blockquoteMatch && (contextLines.length === 0 || inBlockquote)) {
			contextLines.push(blockquoteMatch[1]);
			inBlockquote = true;
			continue;
		}
		if (inBlockquote && !blockquoteMatch && line.trim() !== '') {
			inBlockquote = false;
		}
		// Italic "_Suggested default: …_" line.
		const defaultMatch = /^_Suggested default:\s*(.+?)_\s*$/.exec(line);
		if (defaultMatch && defaultVal === undefined) {
			defaultVal = defaultMatch[1];
			continue;
		}
		// Bold question line (first one wins; skip the answer marker line which
		// has trailing `(write below this line):` and so does not match this regex).
		const questionMatch = /^\*\*(.+?)\*\*\s*$/.exec(line);
		if (questionMatch && question === '') {
			question = questionMatch[1];
			continue;
		}
	}

	if (id === '') {
		throw new SidecarParseError(
			'sidecar entry is missing its id (HTML comment)',
		);
	}

	const context = trimBlankLines(contextLines.join('\n'));
	let answer = '';
	if (answerStart >= 0) {
		answer = trimBlankLines(lines.slice(answerStart).join('\n'));
	}

	// Re-interpret the override: store it ONLY when it DISAGREES with the
	// answer-derived predicate (so a redundant `answered=false` over an empty
	// answer cannot become a sticky override that freezes a later tolerant edit).
	const derivedAnswered = answer.trim() !== '';
	let finalOverride: boolean | undefined;
	if (answeredOverride === true && !derivedAnswered) {
		finalOverride = true;
	} else if (answeredOverride === false && derivedAnswered) {
		finalOverride = false;
	}

	const entry: SidecarEntry = {
		id,
		question,
		context,
		answer,
	};
	if (defaultVal !== undefined) {
		entry.default = defaultVal;
	}
	if (finalOverride !== undefined) {
		entry.answeredOverride = finalOverride;
	}
	if (kind !== undefined) {
		entry.kind = kind;
	}
	return entry;
}

/**
 * Parse a sidecar document into its typed model. The on-disk format is the
 * human-readable Markdown + HTML-comments form (see the module doc); the
 * identity comment lives at the top, each entry opens with a `## ` heading, and
 * the answer is heading-delimited (everything between the answer marker and the
 * next `## ` heading is the answer). TOLERANT of the human typing only under
 * the answer marker: a non-empty answer ⇒ answered (no comment edit needed).
 */
export function parseSidecar(text: string): SidecarModel {
	const lines = normaliseText(text).split('\n');

	// Find the identity HTML comment (scan from the top, skipping blank lines).
	let identity: IdentityFields | undefined;
	let cursor = 0;
	while (cursor < lines.length) {
		const line = lines[cursor];
		cursor++;
		if (line.trim() === '') {
			continue;
		}
		identity = parseIdentityComment(line);
		if (identity) {
			break;
		}
		throw new SidecarParseError(
			'sidecar must open with an `<!-- dorfl-sidecar: … -->` identity comment',
		);
	}
	if (!identity) {
		throw new SidecarParseError('sidecar is missing its identity HTML comment');
	}
	const resolved = resolveSidecarIdentity(identity.item);

	// Split the rest into per-entry sections on `## ` headings. Anything before
	// the first heading is preamble we ignore (a stray human note, or the blank
	// line after the identity comment).
	const entries: SidecarEntry[] = [];
	let sectionLines: string[] | undefined;
	for (let i = cursor; i < lines.length; i++) {
		const line = lines[i];
		if (/^##\s+/.test(line)) {
			if (sectionLines !== undefined) {
				entries.push(parseEntrySection(sectionLines));
			}
			sectionLines = [];
			continue;
		}
		if (sectionLines !== undefined) {
			sectionLines.push(line);
		}
	}
	if (sectionLines !== undefined) {
		entries.push(parseEntrySection(sectionLines));
	}

	return {
		item: resolved.item,
		type: resolved.type,
		slug: resolved.slug,
		entries,
	};
}

// --- Serialise ------------------------------------------------------------

/** Collapse internal newlines so a value renders as a single Markdown line. */
function singleLine(value: string): string {
	return value.replace(/\s*\n\s*/g, ' ').trim();
}

/** Render a multi-line value as a Markdown blockquote (each line `> …`). */
function blockquote(value: string): string[] {
	const trimmed = trimBlankLines(value);
	if (trimmed === '') {
		return [];
	}
	return trimmed.split('\n').map((line) => (line === '' ? '>' : `> ${line}`));
}

/**
 * Serialise a model to its CANONICAL human-readable Markdown text. The identity
 * HTML comment at the top carries `item`/`type`/`slug` + the derived
 * `allAnswered` mirror; each entry is a `## Qn` heading, a bold question line,
 * a blockquote context (when non-empty), an italic suggested-default (when
 * present), a per-entry HTML comment carrying `id` (and an explicit `answered`
 * override when it disagrees with the derived predicate), the fixed answer
 * marker, then the answer prose. Round-trip is SEMANTIC:
 * `parseSidecar(serialiseSidecar(m))` recovers an equal MODEL; re-serialising
 * canonicalises the text.
 */
export function serialiseSidecar(
	model: SidecarModel,
	options: SerialiseSidecarOptions = {},
): string {
	const out: string[] = [];
	const identityParts = [
		`item=${model.item}`,
		`type=${model.type}`,
		`slug=${model.slug}`,
		`allAnswered=${allAnswered(model)}`,
	];
	out.push(`<!-- dorfl-sidecar: ${identityParts.join(' ')} -->`);

	// Human-visible Markdown link line — placed AFTER the identity comment and
	// BEFORE the first `## ` heading, i.e. in the parser's ignored preamble
	// region. Regenerated on every serialise from the item's CURRENT on-disk
	// location; NEVER round-tripped through the parsed model (the link line is
	// write-only cosmetic output, per the source observation). If the item is
	// not resolvable on disk, we simply OMIT the line (harmless fallback) — a
	// broken link would be more confusing than no link.
	if (options.repoRoot !== undefined) {
		const itemRel = findItemRelPath(options.repoRoot, model.type, model.slug);
		if (itemRel !== undefined) {
			out.push('');
			out.push(renderItemLinkLine(model.item, itemRel));
		}
	}

	model.entries.forEach((entry) => {
		out.push('');
		const heading = entry.id.replace(/^q/, 'Q');
		out.push(`## ${heading}`);
		out.push('');
		out.push(`**${singleLine(entry.question)}**`);
		const ctx = blockquote(entry.context);
		if (ctx.length > 0) {
			out.push('');
			out.push(...ctx);
		}
		if (entry.default !== undefined && entry.default.trim() !== '') {
			out.push('');
			out.push(`_Suggested default: ${singleLine(entry.default)}_`);
		}
		out.push('');
		// Per-entry machine comment. The override is emitted ONLY when it
		// DISAGREES with the answer-derived predicate (otherwise the
		// just-serialised line would re-parse as a sticky override).
		const fields: string[] = [`id=${entry.id}`];
		const derivedAnswered = entry.answer.trim() !== '';
		if (entry.answeredOverride === true && !derivedAnswered) {
			fields.push('answered=true');
		} else if (entry.answeredOverride === false && derivedAnswered) {
			fields.push('answered=false');
		}
		if (entry.kind !== undefined) {
			fields.push(`kind=${entry.kind}`);
		}
		out.push(`<!-- ${entry.id} fields: ${fields.join(' ')} -->`);
		out.push('');
		out.push(ANSWER_MARKER);
		const answerText = trimBlankLines(entry.answer);
		if (answerText !== '') {
			out.push('');
			out.push(answerText);
		}
	});
	out.push('');
	return out.join('\n');
}

/**
 * Options for {@link serialiseSidecar}. The optional `repoRoot` opts the
 * caller into emitting the human-visible Markdown link line at the top of
 * the sidecar (pointing at the item's current `work/<folder>/<slug>.md`).
 * Callers that don't have a repo root (e.g. pure format tests) simply omit
 * it and the serialiser emits no link — the parse is unaffected either way.
 *
 * DECISION (sidecar-visible-item-link): `repoRoot` is OPTIONAL and defaults
 * to NO link, rather than being a required argument threaded through every
 * caller. Only the two WRITING call sites (`applyAtomic` in
 * `sidecar-apply.ts`, `persistSurfacedQuestions` in `surface-persist.ts`)
 * pass `cwd`; any other current/future caller of `serialiseSidecar` silently
 * emits no link line. This keeps the many pure-format / round-trip tests
 * trivial (they need no on-disk repo) and keeps the link a write-only
 * cosmetic concern of the persist paths. TRADE-OFF: a new writing caller must
 * remember to pass `repoRoot` to get the link; ALTERNATIVE considered — make
 * it required — rejected because it would force every format-only caller and
 * test to fabricate a repo root purely to reach the same no-link output.
 */
export interface SerialiseSidecarOptions {
	/**
	 * Absolute or relative path to the repository root, so the serialiser can
	 * scan `work/<lifecycle-folder>/<slug>.md` for the item and render a
	 * clickable relative link line. When omitted (or when the item cannot be
	 * located), the link line is omitted — a harmless fallback, never a
	 * broken link.
	 */
	repoRoot?: string;
}

// --- Append ---------------------------------------------------------------

/** A new question to append (no id — the appender mints the next monotonic id). */
export interface NewQuestion {
	question: string;
	context?: string;
	default?: string;
	/**
	 * Optional dispatch {@link SidecarKind} the surfacer stamps so the apply
	 * rung can route a runner-ACTION question (`merge`, `stuck`) to the
	 * deterministic dispatch vs a CONTENT question (`triage`, `spec`) to the
	 * agentic `decide()` path. INTERIM — removable once kind-subfolders land.
	 */
	kind?: SidecarKind;
}

/**
 * Append `newQuestions` to the model, minting `qN+1…` ids off the highest
 * existing id. NEVER overwrites or mutates an existing entry (answered or not) —
 * the sidecar is the item's full Q&A history. Appending flips a previously-
 * `allAnswered` sidecar back to not-all-answered (the new entries are pending).
 * Returns a NEW model (the input is not mutated).
 */
export function appendQuestions(
	model: SidecarModel,
	newQuestions: NewQuestion[],
): SidecarModel {
	const entries = model.entries.slice();
	for (const q of newQuestions) {
		const entry: SidecarEntry = {
			id: nextId(entries),
			question: q.question,
			context: q.context ?? '',
			answer: '',
		};
		if (q.default !== undefined) {
			entry.default = q.default;
		}
		if (q.kind !== undefined) {
			entry.kind = q.kind;
		}
		entries.push(entry);
	}
	return {...model, entries};
}

/**
 * Build a fresh sidecar model for `identity` carrying `newQuestions` (ids minted
 * `q1…`). The first-pass constructor the surface-question rung uses before there
 * is any sidecar to append to.
 */
export function newSidecar(
	identity: string,
	newQuestions: NewQuestion[],
): SidecarModel {
	const resolved = resolveSidecarIdentity(identity);
	const base: SidecarModel = {
		item: resolved.item,
		type: resolved.type,
		slug: resolved.slug,
		entries: [],
	};
	return appendQuestions(base, newQuestions);
}
