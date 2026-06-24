import {describe, it, expect} from 'vitest';
import {
	classifyIntakeEvent,
	type IntakeEvent,
	type IntakeEventDecision,
	type IntakeEventKind,
} from '../src/intake-event.js';

/**
 * `intake-event-classification` (PRD `issue-intake` US #2 — resume-on-thread-change)
 * — the PURE control-path classifier `intake`'s re-run depends on: an issue EVENT →
 * RE-EVALUATE vs IGNORE. Pure logic, no seam / git / `gh` (the same discipline as
 * `failure-cause.test.ts`): we pin the canonical table, the edit-vs-reply
 * invariance, and exhaustiveness over the event kinds.
 */

describe('classifyIntakeEvent — the control-path event table', () => {
	it('a NEW comment → re-evaluate (a new turn on the thread)', () => {
		expect(classifyIntakeEvent({kind: 'issue-comment-created'})).toBe(
			're-evaluate',
		);
	});

	it('an ISSUE-BODY edit → re-evaluate (the spec the prompt reads changed)', () => {
		expect(classifyIntakeEvent({kind: 'issue-body-edited'})).toBe(
			're-evaluate',
		);
	});

	it('a BURIED prior-comment edit → ignore (NOT a new turn; re-triggering invites loops)', () => {
		expect(classifyIntakeEvent({kind: 'issue-comment-edited'})).toBe('ignore');
	});

	it('the canonical table, asserted whole', () => {
		const table: Array<{event: IntakeEvent; decision: IntakeEventDecision}> = [
			{event: {kind: 'issue-comment-created'}, decision: 're-evaluate'},
			{event: {kind: 'issue-body-edited'}, decision: 're-evaluate'},
			{event: {kind: 'issue-comment-edited'}, decision: 'ignore'},
		];
		for (const {event, decision} of table) {
			expect(classifyIntakeEvent(event)).toBe(decision);
		}
	});
});

describe('classifyIntakeEvent — edit-vs-reply does NOT change the control path', () => {
	it('a new comment re-evaluates whether it is edit-framed or reply-framed', () => {
		// Edit-vs-reply changes only the comment's FRAMING, not whether it is a new
		// turn: BOTH are `issue-comment-created` and BOTH re-evaluate. The rule turns
		// on "new turn vs edit of a buried prior turn", NOT "edit vs reply".
		const replyFramed: IntakeEvent = {kind: 'issue-comment-created'};
		const editFramed: IntakeEvent = {kind: 'issue-comment-created'};
		expect(classifyIntakeEvent(replyFramed)).toBe('re-evaluate');
		expect(classifyIntakeEvent(editFramed)).toBe('re-evaluate');
		expect(classifyIntakeEvent(replyFramed)).toBe(
			classifyIntakeEvent(editFramed),
		);
	});
});

describe('classifyIntakeEvent — exhaustive over the event kinds', () => {
	it('every event kind classifies to a known decision', () => {
		const kinds: IntakeEventKind[] = [
			'issue-comment-created',
			'issue-body-edited',
			'issue-comment-edited',
		];
		for (const kind of kinds) {
			const decision = classifyIntakeEvent({kind});
			expect(['re-evaluate', 'ignore']).toContain(decision);
		}
	});
});
