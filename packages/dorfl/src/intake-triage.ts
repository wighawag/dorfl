import type {IssueComment} from './issue-provider.js';
import {
	parseIntakeMarker,
	seenSetFrom,
	type IntakeMarkerKind,
} from './intake-marker.js';

/**
 * **The intake TRIAGE GATE** (task `intake-self-awareness-resumption-tracking`, spec
 * `issue-intake` US #2/#10): a DETERMINISTIC pre-decision gate that runs UNDER the
 * processing lock, BEFORE the decision prompt, deciding whether intake should run
 * the prompt at all. Built ENTIRELY on the thread MARKER (no sidecar, no cursor, no
 * bot-identity), it makes intake skip when it has the last word or the issue is
 * already terminal, and run the prompt ONLY on genuine new human input \u2014 which is
 * also the COMPLETE fix for the self-trigger hazard (intake's own freshly-posted
 * comment carries a marker, so it is excluded from the human-comment check by
 * construction).
 *
 * The TERMINAL/non-terminal split lives HERE, never in the marker: `ask` is
 * non-terminal, `bounced`/`created` are terminal. Re-classifying a kind later is a
 * change to {@link TERMINAL_KINDS} only \u2014 old markers stay valid.
 *
 * This is PURE logic over the stubbed thread (no seam, no git, no `gh`), the same
 * discipline `intake-event.ts` / `failure-cause.ts` keep.
 */

/** The kinds the TRIAGE treats as TERMINAL (the issue was already transformed). */
const TERMINAL_KINDS: ReadonlySet<IntakeMarkerKind> = new Set<IntakeMarkerKind>(
	['bounced', 'created'],
);

/**
 * The TRIAGE outcome. `proceed` runs the prompt (optionally carrying enrichment
 * flags for the prompt); `no-new-input` / `already-terminal` are SKIPS (siblings of
 * `locked` \u2014 "ran, deliberately did nothing", both exit 0, observable by CI + a
 * human).
 */
export type IntakeTriageDecision =
	| {
			action: 'proceed';
			/**
			 * Enrichment for the prompt on the PROCEED path. `predatingIds` are HUMAN
			 * comment ids that RACED IN (read-then-someone-commented-then-posted) \u2014 they
			 * PRE-DATE intake's last turn, so the prompt treats them as context for a
			 * PRIOR state, not necessarily a fresh answer. `deletedSeenCount` is the count
			 * of previously-SEEN human comments that have since been DELETED (computed
			 * ONLY on this raced proceed path \u2014 deletion is enrichment, never a wake
			 * trigger), flagged so the prompt does not assume its prior premises still
			 * hold. Both are absent/zero on the ordinary fresh/mid-ask proceed.
			 */
			predatingIds: string[];
			deletedSeenCount: number;
	  }
	| {action: 'skip'; outcome: 'no-new-input' | 'already-terminal'};

/**
 * Run the TRIAGE over the issue's full comment thread (oldest-first, as
 * `listComments` returns it). The canonical branches (spec `issue-intake`):
 *
 * 1. **Last comment is INTAKE's** (carries a marker). Build `seenSet` = the UNION of
 *    every intake marker's `seen=` id-list, then:
 *    - **PRIMARY** \u2014 is there an UNSEEN HUMAN comment (one WITHOUT a marker whose id
 *      is NOT in `seenSet`)? \u2192 PROCEED. The raced comment(s) are flagged as
 *      PRE-DATING intake's last turn. ALSO compute `seenSet \u2212 currentHumanThreadIds`;
 *      a non-empty difference means a previously-seen human comment was DELETED \u2014
 *      flagged (count only) so the prompt reassesses. (Deletion is ENRICHMENT on this
 *      proceed path only, NEVER a standalone wake trigger.)
 *    - **otherwise** (every human comment is in `seenSet`) \u2192 SKIP `no-new-input`. No
 *      deletion hunt here \u2014 a deletion with no new comment is not a turn worth waking
 *      for. This is what makes intake SELF-TRIGGERING a no-op by construction.
 * 2. **Last comment is someone ELSE's** (no marker on the last comment):
 *    - the thread already contains a TERMINAL marker (`bounced`/`created`) \u2192 SKIP
 *      `already-terminal` (the issue was already transformed).
 *    - otherwise (no terminal marker \u2014 fresh issue, or mid-`ask` loop) \u2192 PROCEED.
 * 3. **Empty thread** \u2192 PROCEED (a fresh issue with no comments).
 */
export function triageIntake(comments: IssueComment[]): IntakeTriageDecision {
	if (comments.length === 0) {
		// A fresh issue with no thread \u2014 there is genuine new material (the body).
		return {action: 'proceed', predatingIds: [], deletedSeenCount: 0};
	}

	const last = comments[comments.length - 1];
	const lastIsIntake = parseIntakeMarker(last.body) !== undefined;

	if (lastIsIntake) {
		// BRANCH 1 \u2014 intake has the last word. Did a human comment race in unseen?
		const seenSet = seenSetFrom(comments);
		const humanComments = comments.filter(
			(c) => parseIntakeMarker(c.body) === undefined,
		);
		const currentHumanIds = new Set(
			humanComments
				.map((c) => c.id)
				.filter((id): id is string => id !== undefined && id !== ''),
		);
		// PRIMARY: HUMAN comments (markerless) whose id is NOT in seenSet \u2014 raced in.
		const predatingIds = humanComments
			.map((c) => c.id)
			.filter(
				(id): id is string => id !== undefined && id !== '' && !seenSet.has(id),
			);
		if (predatingIds.length > 0) {
			// PROCEED on the raced comment(s). DELETION ENRICHMENT (only here): a
			// previously-seen human id no longer present in the thread was deleted.
			let deletedSeenCount = 0;
			for (const id of seenSet) {
				if (!currentHumanIds.has(id)) {
					deletedSeenCount += 1;
				}
			}
			return {action: 'proceed', predatingIds, deletedSeenCount};
		}
		// Every human comment is in seenSet \u2014 intake has the last word and saw
		// everything. SKIP (no deletion hunt: a bare deletion is not a wake trigger).
		return {action: 'skip', outcome: 'no-new-input'};
	}

	// BRANCH 2 \u2014 the last comment is a human's. A terminal marker earlier in the
	// thread means the issue was already transformed; a later human comment does not
	// re-open it (a future feature may; for now, skip).
	if (hasTerminalMarker(comments)) {
		return {action: 'skip', outcome: 'already-terminal'};
	}
	// Fresh issue, or a human reply mid-`ask` loop \u2014 PROCEED to the decision.
	return {action: 'proceed', predatingIds: [], deletedSeenCount: 0};
}

/** True iff any comment in the thread carries a TERMINAL intake marker. */
function hasTerminalMarker(comments: IssueComment[]): boolean {
	for (const comment of comments) {
		const marker = parseIntakeMarker(comment.body);
		if (marker !== undefined && TERMINAL_KINDS.has(marker.kind)) {
			return true;
		}
	}
	return false;
}
