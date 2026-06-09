/**
 * **`intake`'s PURE event-classification** (slice `intake-event-classification`, PRD
 * `issue-intake` US #2 — the resume-on-thread-change behaviour).
 *
 * `intake` is a CONVERSATION on an issue thread: a run may ASK a clarifying question
 * and STOP, expecting a LATER run to resume from the updated thread (PRD "Loop
 * closure" / the decision table's ASK row). This module is the PURE CONTROL-PATH
 * classifier the re-run depends on: given an issue EVENT, it decides whether `intake`
 * should RE-EVALUATE the whole thread or IGNORE the event.
 *
 * THE CANONICAL RULE (from PRD `issue-intake`, "The engine shape"): *"The loop
 * re-runs on a new comment OR an issue-body edit (re-evaluate the whole thread); a
 * buried prior-comment edit is IGNORED."*
 *
 * - a **new comment** → RE-EVALUATE (a genuine new turn on the thread);
 * - an **issue-body edit** → RE-EVALUATE (the spec the prompt reads changed; re-read
 *   body + full thread);
 * - editing a **buried PRIOR comment** → IGNORE (it is NOT a new turn —
 *   re-triggering on old-comment edits invites loops).
 *
 * Edit-vs-reply changes only the comment's FRAMING, not the control path: a NEW
 * comment re-evaluates whether it is phrased as an edit-of-the-ask or a reply. The
 * distinction the rule turns on is "a NEW turn vs an edit of a BURIED prior turn",
 * NOT "edit vs reply".
 *
 * SCOPE FENCE (PRD "Scope: the engine only"): this is ONLY the pure classifier. It is
 * NOT CI's TRIGGER POLICY (command/every-issue, maintainer/anyone) — that is
 * `runner-in-ci`'s. CI's trigger LATER CONSULTS this classifier, but the policy of
 * WHO/WHAT may trigger lives in CI, not here. This module touches no seam, no git, no
 * `gh` — it is pure logic over a stubbed event shape (the same discipline
 * `failure-cause.ts` keeps).
 */

/**
 * The KIND of issue event the classifier decides over. The shapes are STUBBED in
 * tests (no webhook, no `gh`); a real CI trigger maps its provider event onto one of
 * these kinds before consulting {@link classifyIntakeEvent}.
 *
 * - `issue-comment-created` — a NEW comment was added to the thread (a new turn).
 * - `issue-body-edited` — the ISSUE BODY itself was edited (the spec changed).
 * - `issue-comment-edited` — an EXISTING comment was edited (see {@link IntakeEvent}
 *   for the buried-vs-latest distinction the rule turns on).
 */
export type IntakeEventKind =
	| 'issue-comment-created'
	| 'issue-body-edited'
	| 'issue-comment-edited';

/**
 * The CONTROL-PATH decision the classifier returns:
 *
 * - `re-evaluate` — `intake` should RE-READ the issue body + full thread and re-run
 *   its decision (a new comment or a body edit changed the material the prompt
 *   judges).
 * - `ignore` — the event is NOT a new turn; `intake` does nothing (re-triggering on a
 *   buried old-comment edit would invite loops).
 */
export type IntakeEventDecision = 're-evaluate' | 'ignore';

/**
 * A STUBBED issue event the classifier decides over. Deliberately MINIMAL — it
 * carries only what the CONTROL-PATH rule turns on, nothing else (no author, no CI
 * trigger policy — that is `runner-in-ci`'s).
 */
export interface IntakeEvent {
	/** Which kind of thread change occurred. */
	kind: IntakeEventKind;
}

/**
 * Classify an issue EVENT into the CONTROL-PATH decision: RE-EVALUATE the whole
 * thread, or IGNORE the event. The PURE realisation of the PRD's canonical rule
 * (no seam, no git, no `gh`).
 *
 * The table (PRD `issue-intake` US #2):
 *
 * | event kind              | decision      | why                                          |
 * | ----------------------- | ------------- | -------------------------------------------- |
 * | `issue-comment-created` | `re-evaluate` | a new comment is a new turn on the thread    |
 * | `issue-body-edited`     | `re-evaluate` | the issue body (the spec) changed            |
 * | `issue-comment-edited`  | `ignore`      | editing a buried prior comment is NOT a turn |
 *
 * `issue-comment-edited` is IGNORED unconditionally: editing a prior comment is not a
 * new turn (and re-triggering on old-comment edits invites loops). The "buried" in
 * the rule is descriptive — the rule does not single out which prior comment was
 * edited; ANY comment edit is an edit of an already-seen turn, not a new one. (Adding
 * NEW content is `issue-comment-created`, which DOES re-evaluate.)
 *
 * Edit-vs-reply does NOT change this: a new comment is `issue-comment-created`
 * REGARDLESS of whether it is phrased as an edit-of-the-ask or a reply — both
 * re-evaluate, because editing-vs-replying changes only the comment's FRAMING, not
 * whether it is a new turn.
 */
export function classifyIntakeEvent(event: IntakeEvent): IntakeEventDecision {
	switch (event.kind) {
		case 'issue-comment-created':
		case 'issue-body-edited':
			return 're-evaluate';
		case 'issue-comment-edited':
			return 'ignore';
	}
}
