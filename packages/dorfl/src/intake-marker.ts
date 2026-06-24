import {brand} from './brand.js';
import type {IssueComment} from './issue-provider.js';

/**
 * **The intake MARKER** (task `intake-self-awareness-resumption-tracking`, prd
 * `issue-intake` US #2/#10): the ONE primitive the deterministic pre-decision
 * TRIAGE GATE is built on. A machine-readable HIDDEN HTML comment intake stamps on
 * EVERY comment it posts, recording a neutral FACT about what intake did:
 *
 * - `<!-- dorfl:intake kind=ask seen=412,418 -->`
 * - `<!-- dorfl:intake kind=bounced seen=503 -->`
 * - `<!-- dorfl:intake kind=created slug=<slug> seen=601,602 -->`
 *
 * (Namespace `${brand.base}:intake` is built from {@link brand} exactly like
 * `PROCESSING_LOCK_LABEL`, so a rebrand updates it automatically.)
 *
 * It is the SOLE recovery signal — no sidecar, no cursor, no bot-identity. Intake
 * recognises ITS OWN comments by the marker alone (provider-portable, survives
 * posting under a human's token). Hidden HTML comments render as NOTHING on GitHub
 * but are present in the raw markdown each comment's `body` carries — so the triage
 * parses the marker straight out of {@link IssueComment.body}.
 *
 * What the marker records (DECIDED 2026-06-10):
 *
 * - **`kind`** \u2014 a NEUTRAL fact (`ask` / `bounced` / `created`). Whether a kind is
 *   TERMINAL is the TRIAGE's interpretation, NEVER data in the marker (no `terminal`
 *   field): if a kind's terminal-ness ever changes that is a triage change and old
 *   markers stay valid.
 * - **`slug`** \u2014 present only on `kind=created` (which task/prd intake produced).
 * - **`seen=<id>,\u2026`** \u2014 the per-run DELTA of HUMAN comment ids intake READ this run
 *   (EXCLUDING intake's own marker-comments AND any human id already in a prior
 *   marker's `seen=`). Ids, not a count, because a count cannot distinguish "a new
 *   comment appeared" from "an old one was deleted"; ids do both via set arithmetic.
 *   The full `seenSet` is the UNION of every marker's `seen=` (the CHAIN model).
 *
 * The grammar is SHARED so the dependent completion-comment task just stamps a
 * `created` marker via {@link stampIntakeMarker}, which the triage's
 * `already-terminal` branch then consumes.
 */

/** The neutral KIND a marker records \u2014 a fact about what intake did (NOT terminal-ness). */
export type IntakeMarkerKind = 'ask' | 'bounced' | 'created';

/** A parsed intake marker \u2014 `kind` + the human ids it `seen=` + an optional `slug`. */
export interface IntakeMarker {
	/** What intake did (a neutral fact; the TRIAGE owns terminal-ness, not this). */
	kind: IntakeMarkerKind;
	/** The HUMAN comment ids intake READ this run (the per-run delta; may be empty). */
	seen: string[];
	/** The created task/prd slug \u2014 present only on `kind=created`. */
	slug?: string;
}

/** The marker's brand-derived namespace token (today `dorfl:intake`). */
const MARKER_NS = `${brand.base}:intake`;

/**
 * Matches ONE intake marker anywhere in a comment body (the hidden HTML comment).
 * Captures the inner attribute run (everything after the namespace, before `-->`)
 * so {@link parseIntakeMarker} can pull `kind` / `slug` / `seen` out of it. Global
 * so a body that (pathologically) carries more than one is fully scanned, though
 * intake stamps exactly one per comment.
 */
const MARKER_RE = new RegExp(
	`<!--\\s*${escapeRegExp(MARKER_NS)}\\s+([^>]*?)\\s*-->`,
	'g',
);

/**
 * STAMP the intake marker onto a comment body intake is about to post (the SHARED
 * producer for ALL of ask / bounced / created). Appends the hidden HTML comment
 * AFTER the human-readable text, separated by a blank line, so the rendered comment
 * is just the text (the marker is invisible) yet the raw markdown carries the
 * marker for the triage to recover.
 *
 * `seen` is the per-run DELTA of human comment ids (computed by
 * {@link computeSeenDelta}); it is emitted even when empty (`seen=`) so the grammar
 * is uniform and the parser never has to special-case its absence. `slug` is
 * emitted only for `kind=created`.
 */
export function stampIntakeMarker(
	body: string,
	marker: {kind: IntakeMarkerKind; seen: string[]; slug?: string},
): string {
	const parts = [`kind=${marker.kind}`];
	if (
		marker.kind === 'created' &&
		marker.slug !== undefined &&
		marker.slug !== ''
	) {
		parts.push(`slug=${marker.slug}`);
	}
	parts.push(`seen=${marker.seen.join(',')}`);
	const tag = `<!-- ${MARKER_NS} ${parts.join(' ')} -->`;
	const text = body.replace(/\s+$/, '');
	return text === '' ? tag : `${text}\n\n${tag}`;
}

/**
 * Parse the FIRST intake marker out of a comment body (the SHARED consumer). Returns
 * `undefined` when the body carries no intake marker \u2014 i.e. it is a HUMAN comment
 * (the triage ranges its unseen-check over exactly these). A malformed marker (no
 * `kind`, or an unknown `kind`) is treated as ABSENT rather than throwing: an
 * unparseable hidden comment must never make the triage crash or misclassify a
 * human comment as intake's.
 */
export function parseIntakeMarker(body: string): IntakeMarker | undefined {
	MARKER_RE.lastIndex = 0;
	const match = MARKER_RE.exec(body);
	if (match === null) {
		return undefined;
	}
	const attrs = match[1];
	const kind = readAttr(attrs, 'kind');
	if (kind !== 'ask' && kind !== 'bounced' && kind !== 'created') {
		return undefined;
	}
	const slug = readAttr(attrs, 'slug');
	const seenRaw = readAttr(attrs, 'seen');
	const seen =
		seenRaw === undefined || seenRaw === ''
			? []
			: seenRaw.split(',').filter((id) => id !== '');
	return {
		kind,
		seen,
		...(slug !== undefined && slug !== '' ? {slug} : {}),
	};
}

/** True iff the comment carries an intake marker \u2014 i.e. it is INTAKE's OWN comment. */
export function isIntakeComment(comment: IssueComment): boolean {
	return parseIntakeMarker(comment.body) !== undefined;
}

/**
 * Compute the per-run `seen=` DELTA for a marker intake is about to stamp: the ids
 * of the HUMAN comments in the thread as intake READ it, EXCLUDING (a) intake's own
 * marker-comments (identified by carrying a marker) and (b) any human id ALREADY
 * recorded in a prior intake marker's `seen=` (the chain model keeps each marker's
 * `seen=` a bounded per-run delta; the union reconstructs the whole). Order follows
 * `listComments`' oldest-first; ids with no value (a provider that omitted one) are
 * dropped \u2014 the triage only reasons over ids it actually has.
 */
export function computeSeenDelta(comments: IssueComment[]): string[] {
	const already = seenSetFrom(comments);
	const delta: string[] = [];
	for (const comment of comments) {
		if (isIntakeComment(comment)) {
			continue; // intake's own marker-comment \u2014 NEVER recorded in `seen=`.
		}
		const id = comment.id;
		if (id === undefined || id === '') {
			continue;
		}
		if (already.has(id) || delta.includes(id)) {
			continue;
		}
		delta.push(id);
	}
	return delta;
}

/**
 * Build the full `seenSet` for the TRIAGE: the UNION of every intake marker's
 * `seen=` id-list in the thread (the chain model \u2014 each marker stores a per-run
 * delta, the union reconstructs the complete set of human comments intake has EVER
 * read). Ranges over intake's OWN comments (the ones carrying a marker); a human
 * comment never carries a `seen=`.
 */
export function seenSetFrom(comments: IssueComment[]): Set<string> {
	const set = new Set<string>();
	for (const comment of comments) {
		const marker = parseIntakeMarker(comment.body);
		if (marker === undefined) {
			continue;
		}
		for (const id of marker.seen) {
			set.add(id);
		}
	}
	return set;
}

/** Read a `key=value` attribute out of a marker's inner attribute run. */
function readAttr(attrs: string, key: string): string | undefined {
	const re = new RegExp(`(?:^|\\s)${escapeRegExp(key)}=([^\\s]*)`);
	const match = re.exec(attrs);
	return match === null ? undefined : match[1];
}

/** Escape a literal for embedding in a RegExp (the brand base + attribute keys). */
function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
