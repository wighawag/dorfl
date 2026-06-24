import {describe, it, expect} from 'vitest';
import {triageIntake} from '../src/intake-triage.js';
import {stampIntakeMarker} from '../src/intake-marker.js';
import type {IssueComment} from '../src/issue-provider.js';

/**
 * `intake-self-awareness-resumption-tracking`: the deterministic pre-decision
 * TRIAGE GATE \u2014 pure logic over the thread MARKER (no seam/git/`gh`). It SKIPS when
 * intake has the last word (`no-new-input`) or the issue is already terminal
 * (`already-terminal`), and PROCEEDS only on genuine new human input (incl. raced
 * comments, with deletion ENRICHMENT on that proceed path only). The
 * terminal/non-terminal split lives HERE, not in the marker.
 */

const human = (id: string, body = 'reply'): IssueComment => ({id, body});
const intake = (
	kind: 'ask' | 'bounced' | 'created',
	seen: string[],
	id: string,
	slug?: string,
): IssueComment => ({
	id,
	body: stampIntakeMarker('intake says', {kind, seen, ...(slug ? {slug} : {})}),
});

describe('triageIntake \u2014 last comment is INTAKE\u2019s', () => {
	it('SKIPS no-new-input when intake has the last word and saw every human comment', () => {
		const thread = [human('1'), human('2'), intake('ask', ['1', '2'], 'm1')];
		expect(triageIntake(thread)).toEqual({
			action: 'skip',
			outcome: 'no-new-input',
		});
	});

	it('SKIPS no-new-input on the SELF-TRIGGER case (intake\u2019s own just-posted comment is last)', () => {
		// A single intake comment, nothing human unseen \u2014 intake must NOT wake on its
		// own freshly-posted comment (the marker excludes it from the human check).
		const thread = [human('1'), intake('ask', ['1'], 'm1')];
		expect(triageIntake(thread)).toEqual({
			action: 'skip',
			outcome: 'no-new-input',
		});
	});

	it('PROCEEDS on a RACED human comment (id NOT in seenSet), flagged as predating', () => {
		// Intake read [1], then human 2 raced in BEFORE intake posted its marker.
		const thread = [human('1'), human('2'), intake('ask', ['1'], 'm1')];
		const decision = triageIntake(thread);
		expect(decision.action).toBe('proceed');
		if (decision.action === 'proceed') {
			expect(decision.predatingIds).toEqual(['2']);
			expect(decision.deletedSeenCount).toBe(0);
		}
	});

	it('unions seenSet across TWO markers \u2014 a comment seen by an EARLIER marker is not unseen', () => {
		// marker m1 saw [1]; marker m2 (last) saw [3]. Human 1,2,3 present; 2 is unseen.
		const thread = [
			human('1'),
			human('2'),
			intake('ask', ['1'], 'm1'),
			human('3'),
			intake('ask', ['3'], 'm2'),
		];
		const decision = triageIntake(thread);
		expect(decision.action).toBe('proceed');
		if (decision.action === 'proceed') {
			// 1 (seen by m1) and 3 (seen by m2) are NOT unseen; only 2 is.
			expect(decision.predatingIds).toEqual(['2']);
		}
	});

	it('DELETION + unseen \u2192 proceed-with-flag (count of previously-seen now-deleted comments)', () => {
		// seenSet = {1,2}; thread now has human 1 (2 deleted) plus a NEW unseen human 3.
		const thread = [human('1'), human('3'), intake('ask', ['1', '2'], 'm1')];
		const decision = triageIntake(thread);
		expect(decision.action).toBe('proceed');
		if (decision.action === 'proceed') {
			expect(decision.predatingIds).toEqual(['3']);
			expect(decision.deletedSeenCount).toBe(1); // id 2 was deleted
		}
	});

	it('DELETION-ONLY (no unseen comment) \u2192 SKIP no-new-input (a bare deletion is not a wake trigger)', () => {
		// seenSet = {1,2}; human 2 deleted but NO new comment \u2014 still no-new-input.
		const thread = [human('1'), intake('ask', ['1', '2'], 'm1')];
		expect(triageIntake(thread)).toEqual({
			action: 'skip',
			outcome: 'no-new-input',
		});
	});
});

describe('triageIntake \u2014 last comment is a HUMAN\u2019s', () => {
	it('PROCEEDS on a fresh issue with NO comments', () => {
		expect(triageIntake([])).toEqual({
			action: 'proceed',
			predatingIds: [],
			deletedSeenCount: 0,
		});
	});

	it('PROCEEDS when no terminal marker exists (fresh issue, comments but no intake)', () => {
		const thread = [human('1'), human('2')];
		expect(triageIntake(thread)).toEqual({
			action: 'proceed',
			predatingIds: [],
			deletedSeenCount: 0,
		});
	});

	it('PROCEEDS on a human reply after an ASK marker (mid-ask loop resumes \u2014 ask is NON-terminal)', () => {
		const thread = [human('1'), intake('ask', ['1'], 'm1'), human('2')];
		expect(triageIntake(thread)).toEqual({
			action: 'proceed',
			predatingIds: [],
			deletedSeenCount: 0,
		});
	});

	it('SKIPS already-terminal when a BOUNCED marker is earlier in the thread', () => {
		const thread = [human('1'), intake('bounced', ['1'], 'm1'), human('2')];
		expect(triageIntake(thread)).toEqual({
			action: 'skip',
			outcome: 'already-terminal',
		});
	});

	it('SKIPS already-terminal when a CREATED marker is earlier in the thread', () => {
		const thread = [
			human('1'),
			intake('created', ['1'], 'm1', 'add-quiet-flag'),
			human('2'),
		];
		expect(triageIntake(thread)).toEqual({
			action: 'skip',
			outcome: 'already-terminal',
		});
	});
});
