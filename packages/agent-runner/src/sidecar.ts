import {parseSlugArg, type SlugNamespace} from './slug-namespace.js';
import {workItemRel} from './work-layout.js';

/**
 * The **question/answer SIDECAR contract** (PRD `advance-loop`, slice
 * `advance-sidecar-contract`) — the one genuinely-new piece of the `advance`
 * family. A strict, tooling-OWNED per-item file `work/questions/<type>-<slug>.md`
 * carrying per-entry answered-state, so the tooling fully owns the Q&A artifact
 * (no fragile round-trip parse of human-authored prose in the item body).
 *
 * This module is the FORMAT + the in-memory model + the pure read/write/append/
 * derived-`allAnswered` operations. The ATOMIC apply (mutate the item body AND
 * the sidecar in ONE commit) lives in {@link applyAtomic} (`sidecar-apply.ts`).
 * It builds NOTHING above the contract — no tick, no verb, no lock, no rungs;
 * later slices of the family consume these.
 *
 * The format is RESOLVED in the PRD ("The sidecar FORMAT (RESOLVED here)" +
 * "MAINTAINER-RESOLVED SLICE-TIME DECISIONS §1") — this is a faithful build of
 * that spec, not a re-opening. The load-bearing rules:
 *
 *   - **Identity-keyed, NOT folder-keyed.** The path is derived PURELY from the
 *     item's NAMESPACED identity (`<type>-<slug>`, `:`→`-` for the filename),
 *     using {@link parseSlugArg} (the `slug-namespace.ts` resolver) as the single
 *     source of truth for the identity. There is NO back-pointer field in the
 *     item body — the only in-body signal is the existing `needsAnswers` flag —
 *     so the sidecar survives the item's `git mv`s between lifecycle folders with
 *     no lock-step move.
 *   - **The answered predicate (MAINTAINER-RESOLVED §1):** a non-empty `answer:`
 *     ⇒ ANSWERED, with an explicit `answered:` line as an OVERRIDE. The human
 *     writes the LEAST (just `answer:`); the serialiser normalises `answered:
 *     true` on the next write; an explicit `answered: false` overrides a
 *     non-empty answer.
 *   - **`allAnswered` is DERIVED** — recomputed from the entries on every
 *     serialise; the classifier MAY read it for a cheap scan but MUST NOT trust
 *     it over the entries.
 *   - **Entry ids are stable + monotonic** (`q1`, `q2`, …), NEVER reused. APPEND
 *     adds `qN+1` and never mutates an existing answered entry (the sidecar is
 *     the item's full Q&A history).
 */

/** The three item-types a sidecar can key onto (the slug-namespace + obs). */
export type SidecarType = 'brief' | 'task' | 'observation';

/**
 * The optional triage/terminal routing an answered triage entry carries.
 *
 * `dropped` is the GENERIC "won't-proceed" terminal — it ROUTES the item to
 * `work/dropped/` (slice `generic-terminal-dropped-folder-generalising-out-of-scope`,
 * PRD `staging-pool-position-gate-and-trust-model` US #16/17/18). It GENERALISES
 * the previous `out-of-scope` disposition (which routed to `work/out-of-scope/`):
 * the specific REASON an item was dropped (`superseded by <x>` / `out-of-scope` /
 * `duplicate` / `abandoned`) lives in the item BODY (a `reason:` line), NOT in
 * the disposition or the folder — status is the folder (WORK-CONTRACT rule 3).
 */
export type SidecarDisposition =
	| 'promote-slice'
	| 'promote-adr'
	| 'keep'
	| 'delete'
	| 'dropped'
	| 'needs-attention';

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
	 * The explicit `answered:` OVERRIDE, when the human/tooling wrote one. `true`
	 * forces answered; `false` overrides a non-empty answer back to unanswered.
	 * `undefined` ⇒ no override (the answered-ness derives from `answer`).
	 */
	answeredOverride?: boolean;
	/** Optional triage/terminal routing (only on triage entries). */
	disposition?: SidecarDisposition;
}

/** The parsed sidecar: identity frontmatter + ordered entries. */
export interface SidecarModel {
	/** The NAMESPACED identity (`brief:autoslice`, `task:foo`, `observation:bar`). */
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
 * `answer:` ⇒ answered, with the explicit `answered:` override winning when
 * present. An explicit `answered: false` overrides a non-empty answer back to
 * unanswered; an explicit `answered: true` forces answered even with an empty
 * answer.
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
 * frontmatter mirror). An EMPTY sidecar (no entries) is NOT all-answered — a
 * sidecar with no open questions should not exist (it would be deleted on full
 * resolution), so `allAnswered` over zero entries is `false`, keeping the
 * "pending ⇒ NO-OP" classifier honest.
 */
export function allAnswered(model: SidecarModel): boolean {
	return model.entries.length > 0 && pendingEntries(model).length === 0;
}

const TYPE_TO_NAMESPACE: Record<SidecarType, string> = {
	brief: 'brief',
	task: 'task',
	observation: 'observation',
};

/** Map a namespaced-identity prefix onto the sidecar type. */
function typeForNamespace(
	explicit: SlugNamespace | undefined,
	rawPrefix: string,
): SidecarType {
	if (explicit === 'brief') {
		return 'brief';
	}
	if (explicit === 'task') {
		return 'task';
	}
	// `parseSlugArg` only knows `task:`/`brief:`; the sidecar adds the
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
 * Resolve a namespaced-identity argument (`brief:autoslice`, `task:foo`,
 * `observation:bar`, `obs:bar`, or a bare `<slug>` = task) into its
 * `{type, slug, item}`. PURE string work over {@link parseSlugArg} — the
 * resolver is the single source of truth for the task/brief split; the sidecar
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

/** Strip a trailing newline-run, leaving inner blank lines intact. */
function trimBlock(value: string): string {
	return value.replace(/\n+$/, '');
}

interface RawFrontmatter {
	item?: string;
	type?: string;
	slug?: string;
}

/** Split the document into its frontmatter block + the body after it. */
function splitDocument(text: string): {fm: string; body: string} {
	const normalized = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
	if (!normalized.startsWith('---\n')) {
		throw new SidecarParseError(
			'sidecar must open with a `---` frontmatter fence',
		);
	}
	const lines = normalized.split('\n');
	const closing = lines.indexOf('---', 1);
	if (closing === -1) {
		throw new SidecarParseError('sidecar frontmatter fence is not closed');
	}
	return {
		fm: lines.slice(1, closing).join('\n'),
		body: lines.slice(closing + 1).join('\n'),
	};
}

/** Parse the small slice of frontmatter the sidecar uses (scalar keys only). */
function parseRawFrontmatter(fm: string): RawFrontmatter {
	const result: RawFrontmatter = {};
	for (const line of fm.split('\n')) {
		const match = /^([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$/.exec(line);
		if (!match) {
			continue;
		}
		const [, key, value] = match;
		if (key === 'item') {
			result.item = value;
		} else if (key === 'type') {
			result.type = value;
		} else if (key === 'slug') {
			result.slug = value;
		}
		// `allAnswered` is a DERIVED mirror — IGNORED on read (recomputed on write).
	}
	return result;
}

/** Per-entry scalar key with a block-scalar (`|`) or inline value. */
type EntryKey =
	| 'id'
	| 'question'
	| 'context'
	| 'default'
	| 'answered'
	| 'answer'
	| 'disposition';

const ENTRY_KEYS: ReadonlySet<string> = new Set<EntryKey>([
	'id',
	'question',
	'context',
	'default',
	'answered',
	'answer',
	'disposition',
]);

const DISPOSITIONS: ReadonlySet<string> = new Set<SidecarDisposition>([
	'promote-slice',
	'promote-adr',
	'keep',
	'delete',
	'dropped',
	'needs-attention',
]);

/**
 * Parse a sidecar document into its typed model. TOLERANT of the human writing
 * only `answer:` (the answered-ness derives from it). Block scalars (`key: |`)
 * collect the following more-indented lines; inline scalars (`key: value`) take
 * the rest of the line.
 */
export function parseSidecar(text: string): SidecarModel {
	const {fm, body} = splitDocument(text);
	const raw = parseRawFrontmatter(fm);
	if (raw.item === undefined || raw.item === '') {
		throw new SidecarParseError('sidecar frontmatter is missing `item:`');
	}
	const resolved = resolveSidecarIdentity(raw.item);

	const entries: SidecarEntry[] = [];
	const lines = body.split('\n');
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		// An entry opens with a `## ...` heading. Skip anything before the first.
		if (!/^##\s+/.test(line)) {
			i++;
			continue;
		}
		i++;
		const fields = new Map<EntryKey, string>();
		while (i < lines.length && !/^##\s+/.test(lines[i])) {
			const keyMatch = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(lines[i]);
			if (!keyMatch) {
				i++;
				continue;
			}
			const key = keyMatch[1];
			const rest = keyMatch[2];
			if (!ENTRY_KEYS.has(key)) {
				i++;
				continue;
			}
			if (rest.trim() === '|') {
				// Block scalar: collect following lines more-indented than the key.
				i++;
				const blockLines: string[] = [];
				while (i < lines.length && !/^##\s+/.test(lines[i])) {
					const l = lines[i];
					if (l.trim() === '') {
						blockLines.push('');
						i++;
						continue;
					}
					const indent = /^(\s+)/.exec(l);
					if (!indent) {
						break;
					}
					blockLines.push(l.replace(/^ {2}/, '').replace(/^\t/, ''));
					i++;
				}
				fields.set(key as EntryKey, trimBlock(blockLines.join('\n')));
			} else {
				fields.set(key as EntryKey, rest.trim());
				i++;
			}
		}

		const id = fields.get('id') ?? '';
		if (id === '') {
			throw new SidecarParseError('sidecar entry is missing `id:`');
		}
		const answerText = fields.get('answer') ?? '';
		const derivedAnswered = answerText.trim() !== '';
		const answeredRaw = fields.get('answered');
		let answeredOverride: boolean | undefined;
		if (answeredRaw !== undefined && answeredRaw !== '') {
			const v = answeredRaw.toLowerCase();
			// The `answered:` line is an OVERRIDE — store it ONLY when it DISAGREES
			// with the answer-derived predicate. A redundant `answered: false` over an
			// empty answer (or `answered: true` over a non-empty one) carries no
			// information and must NOT become a sticky override — otherwise the
			// serialiser's normalised `answered:` line would re-parse into a frozen
			// override, and later filling `answer:` could never flip the entry.
			if (v === 'true' && !derivedAnswered) {
				answeredOverride = true;
			} else if (v === 'false' && derivedAnswered) {
				answeredOverride = false;
			}
		}
		const dispositionRaw = fields.get('disposition');
		const disposition =
			dispositionRaw !== undefined &&
			dispositionRaw !== '' &&
			DISPOSITIONS.has(dispositionRaw)
				? (dispositionRaw as SidecarDisposition)
				: undefined;

		const entry: SidecarEntry = {
			id,
			question: fields.get('question') ?? '',
			context: fields.get('context') ?? '',
			answer: answerText,
		};
		const def = fields.get('default');
		if (def !== undefined && def !== '') {
			entry.default = def;
		}
		if (answeredOverride !== undefined) {
			entry.answeredOverride = answeredOverride;
		}
		if (disposition !== undefined) {
			entry.disposition = disposition;
		}
		entries.push(entry);
	}

	return {
		item: resolved.item,
		type: resolved.type,
		slug: resolved.slug,
		entries,
	};
}

// --- Serialise ------------------------------------------------------------

/** Emit a block-scalar field (`key: |` + indented body), or skip if empty. */
function blockField(key: string, value: string): string[] {
	const out = [`${key}: |`];
	const trimmed = trimBlock(value);
	if (trimmed === '') {
		return out;
	}
	for (const line of trimmed.split('\n')) {
		out.push(line === '' ? '' : `  ${line}`);
	}
	return out;
}

/**
 * Serialise a model to its CANONICAL text: identity frontmatter with the
 * recomputed `allAnswered` mirror, then the ordered entries with `answered:`
 * normalised (a non-empty answer with no explicit override emits `answered:
 * true`; an explicit override is preserved verbatim). Round-trip stable:
 * `parseSidecar(serialiseSidecar(m))` ≡ `m` (modulo the derived mirror).
 */
export function serialiseSidecar(model: SidecarModel): string {
	const out: string[] = [];
	out.push('---');
	out.push(`item: ${model.item}`);
	out.push(`type: ${model.type}`);
	out.push(`slug: ${model.slug}`);
	out.push(`allAnswered: ${allAnswered(model)}`);
	out.push('---');
	out.push('');

	model.entries.forEach((entry, idx) => {
		const heading = entry.id.replace(/^q/, 'Q');
		out.push(`## ${heading}`);
		out.push(`id: ${entry.id}`);
		out.push(...blockField('question', entry.question));
		out.push(...blockField('context', entry.context));
		if (entry.default !== undefined) {
			out.push(...blockField('default', entry.default));
		}
		// Normalise the answered line: an explicit override is preserved, else the
		// derived predicate is emitted (non-empty answer ⇒ `answered: true`).
		const answered = isEntryAnswered(entry);
		out.push(`answered: ${answered}`);
		out.push(...blockField('answer', entry.answer));
		if (entry.disposition !== undefined) {
			out.push(`disposition: ${entry.disposition}`);
		}
		if (idx < model.entries.length - 1) {
			out.push('');
		}
	});
	out.push('');
	return out.join('\n');
}

// --- Append ---------------------------------------------------------------

/** A new question to append (no id — the appender mints the next monotonic id). */
export interface NewQuestion {
	question: string;
	context?: string;
	default?: string;
	disposition?: SidecarDisposition;
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
		if (q.disposition !== undefined) {
			entry.disposition = q.disposition;
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
