import {
	isEntryAnswered,
	type SidecarEntry,
	type SidecarModel,
} from './sidecar.js';

/**
 * The PARSE half of the answered merge-question (task
 * `apply-rung-merge-disposition`): the human's plain `merge | hold | drop`
 * answer to a `kind: merge` sidecar entry, read deterministically. Kept apart
 * from the dispatcher (`apply-merge-action.ts`, which re-exports it) so the
 * selection path can read an answered merge without importing the land
 * machinery.
 */

/** The three deterministic actions a merge-question answer encodes. */
export type MergeActionVerb = 'merge' | 'hold' | 'drop';

/** A detected, answer-driven merge-action keyed off ONE answered `kind: merge` entry. */
export interface DetectedMergeAction {
	/** The deterministic verb parsed from the entry's answer text. */
	verb: MergeActionVerb;
	/** The answered `kind: merge` entry the verb came from. */
	entry: SidecarEntry;
}

/**
 * Parse the human's plain free-text answer into the deterministic
 * {@link MergeActionVerb}. The merge-question surfacer renders
 * `merge | hold | drop` in the entry's `default` as a human-readable hint, so
 * the human typically types one of those words verbatim. We accept any text
 * whose first whole word (case-insensitive) is one of `merge` / `hold` / `drop`
 * — this is the same machine-parseable choice shape the surfacer's applied
 * answer q1 documents ("a DETERMINISTIC CHOICE shape … the human picks and the
 * system parses unambiguously").
 *
 * Returns `undefined` on ANYTHING else (an empty answer, a typo, a long
 * narrative without one of the three words at the start) so the caller can
 * route the ambiguity HONESTLY — never default-to-merge on a malformed answer,
 * which would invent a land the human did not authorise.
 */
export function parseMergeAnswer(text: string): MergeActionVerb | undefined {
	const trimmed = text.trim().toLowerCase();
	if (trimmed === '') return undefined;
	// The first whole alphabetic word; trailing punctuation (a comma, em-dash,
	// period) and any following commentary are tolerated. We deliberately do
	// NOT consume hyphens / apostrophes — the three verbs are plain ASCII
	// words, and over-tolerating typo-shapes would silently invent a verb the
	// human did not pick.
	const match = /^([a-z]+)/.exec(trimmed);
	if (match === null) return undefined;
	const word = match[1];
	if (word === 'merge' || word === 'hold' || word === 'drop') {
		return word;
	}
	return undefined;
}

/**
 * `detectAnsweredMergeAction` (`apply-merge-action.ts`) over an already-parsed sidecar model (the
 * selection path reads sidecars itself, in place and from a mirror ref). The
 * same ordering rules apply.
 */
export function answeredMergeActionIn(
	model: SidecarModel,
): DetectedMergeAction | undefined {
	// (1) Unanswered `kind: merge` follow-up ⇒ re-paused; the apply must NOT fire.
	for (const entry of model.entries) {
		if (entry.kind === 'merge' && !isEntryAnswered(entry)) return undefined;
	}
	// (2) LATEST answered `kind: merge` entry — a fresh follow-up beats a stale one.
	for (let i = model.entries.length - 1; i >= 0; i--) {
		const entry = model.entries[i];
		if (entry.kind !== 'merge') continue;
		if (!isEntryAnswered(entry)) continue;
		const verb = parseMergeAnswer(entry.answer);
		if (verb !== undefined) {
			return {verb, entry};
		}
	}
	return undefined;
}
