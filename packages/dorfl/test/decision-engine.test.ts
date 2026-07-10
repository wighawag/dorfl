import {describe, it, expect} from 'vitest';
import {
	decide,
	parseDecisionVerdict,
	DisallowedOutcomeError,
	EmptyAllowedOutcomesError,
	type DecisionOutcome,
	type DecisionVerdict,
	type DecisionDecider,
} from '../src/decision-engine.js';

/**
 * `decision-engine-shared-decide-seam` (prd
 * `agentic-question-resolution-retire-disposition-vocabulary`, US #9): the PURE
 * shared `decide(input, allowedOutcomes) → verdict` engine. These are pure-logic
 * tests (no fs/git/seam/model/network) mirroring intake's stubbed-verdict
 * dispatcher tests:
 *
 *  1. The INJECTED decider seam drives the engine with a CANNED verdict — one per
 *     outcome of the superset {task | spec | adr | delete | ask}.
 *  2. The allowed-outcome GUARD: a verdict outside the caller's `allowedOutcomes`
 *     is rejected LOUDLY (never silently coerced); a caller that does not allow
 *     `adr` can never receive it. An empty set is a programming error caught up
 *     front.
 *  3. The engine is outcome-AGNOSTIC + the INPUT-ADAPTER boundary sits in the
 *     caller — `input` is threaded opaquely to the decider.
 *  4. `parseDecisionVerdict` as a PARSE TABLE — the superset outcomes pulled out
 *     of prose-wrapped + fenced agent output, plus the throw cases (the twin of
 *     intake's `parseIntakeVerdict`).
 */

/** A canned decider: ignores its input and returns the given verdict. */
function cannedDecider<TInput>(
	verdict: DecisionVerdict,
): DecisionDecider<TInput> {
	return async () => verdict;
}

/** The full superset every caller draws its allowed SUBSET from. */
const SUPERSET: DecisionOutcome[] = ['task', 'spec', 'adr', 'delete', 'ask'];

// ---------------------------------------------------------------------------
// 1. The injected decider seam — one canned verdict PER outcome.
// ---------------------------------------------------------------------------
describe('decide — the injected seam drives one canned verdict per outcome', () => {
	it('returns a `task` verdict verbatim (carrying its drafted content)', async () => {
		const verdict: DecisionVerdict = {
			outcome: 'task',
			taskSlug: 'add-quiet-flag',
			taskTitle: 'Add a --quiet flag',
			taskBody: '## What to build\n\nA --quiet flag.',
		};
		const out = await decide({}, cannedDecider(verdict), SUPERSET);
		expect(out).toEqual(verdict);
	});

	it('returns a `spec` verdict verbatim', async () => {
		const verdict: DecisionVerdict = {
			outcome: 'spec',
			prdSlug: 'big-feature',
			prdTitle: 'A big coherent feature',
			prdBody: '## Problem Statement\n\nIt is big.',
		};
		const out = await decide({}, cannedDecider(verdict), SUPERSET);
		expect(out).toEqual(verdict);
	});

	it('returns an `adr` verdict verbatim', async () => {
		const verdict: DecisionVerdict = {
			outcome: 'adr',
			adrSlug: 'record-the-choice',
			adrTitle: 'Record the choice',
			adrBody: '## Context\n\nWe decided X.',
		};
		const out = await decide({}, cannedDecider(verdict), SUPERSET);
		expect(out).toEqual(verdict);
	});

	it('returns a `delete` verdict verbatim (carrying the reason)', async () => {
		const verdict: DecisionVerdict = {
			outcome: 'delete',
			deleteReason: 'the answer says to drop it',
		};
		const out = await decide({}, cannedDecider(verdict), SUPERSET);
		expect(out).toEqual(verdict);
	});

	it('returns an `ask` verdict verbatim (carrying the follow-up)', async () => {
		const verdict: DecisionVerdict = {
			outcome: 'ask',
			question: 'Which subsystem does this touch?',
		};
		const out = await decide({}, cannedDecider(verdict), SUPERSET);
		expect(out).toEqual(verdict);
	});
});

// ---------------------------------------------------------------------------
// 2. The allowed-outcome GUARD (the loud rejection).
// ---------------------------------------------------------------------------
describe('decide — the allowed-outcome guard rejects loudly, never coerces', () => {
	it('a caller that does NOT allow `adr` can never receive it', async () => {
		// The keystone-minus-adr subset (what advance-apply launches with before
		// `agentic-apply-mint-adr-route` widens it).
		const allowed: DecisionOutcome[] = ['task', 'spec', 'delete', 'ask'];
		const verdict: DecisionVerdict = {outcome: 'adr', adrTitle: 'sneaky'};
		await expect(
			decide({}, cannedDecider(verdict), allowed),
		).rejects.toBeInstanceOf(DisallowedOutcomeError);
	});

	it('the rejection names the offending outcome + the allowed set', async () => {
		const allowed: DecisionOutcome[] = ['task', 'ask'];
		try {
			await decide({}, cannedDecider({outcome: 'delete'}), allowed);
			expect.unreachable('decide should have rejected the out-of-set verdict');
		} catch (err) {
			expect(err).toBeInstanceOf(DisallowedOutcomeError);
			const e = err as DisallowedOutcomeError;
			expect(e.outcome).toBe('delete');
			expect(e.allowed).toEqual(['task', 'ask']);
			expect(e.message).toContain('delete');
			expect(e.message).toContain('task | ask');
		}
	});

	it('intake-like subset {task,spec,ask} still ACCEPTS an in-set verdict', async () => {
		// The engine is outcome-AGNOSTIC: it hard-codes no caller's outcomes, so an
		// intake-shaped subset works exactly as the keystone's wider one does.
		const allowed: DecisionOutcome[] = ['task', 'spec', 'ask'];
		const verdict: DecisionVerdict = {outcome: 'spec', prdTitle: 'ok'};
		const out = await decide({}, cannedDecider(verdict), allowed);
		expect(out).toEqual(verdict);
	});

	it('an EMPTY allowedOutcomes set is a programming error caught up front', async () => {
		await expect(
			decide({}, cannedDecider({outcome: 'task'}), []),
		).rejects.toBeInstanceOf(EmptyAllowedOutcomesError);
	});

	it('the guard accepts any iterable allowed set (e.g. a Set)', async () => {
		const allowed = new Set<DecisionOutcome>(['task', 'delete']);
		const verdict: DecisionVerdict = {outcome: 'delete', deleteReason: 'drop'};
		const out = await decide({}, cannedDecider(verdict), allowed);
		expect(out).toEqual(verdict);
	});
});

// ---------------------------------------------------------------------------
// 3. The input-adapter boundary sits in the caller — input threaded opaquely.
// ---------------------------------------------------------------------------
describe('decide — input is threaded opaquely to the injected decider', () => {
	it('passes the caller-shaped input verbatim to the decider', async () => {
		interface SidecarInput {
			answer: string;
			source: {type: string; slug: string};
		}
		const input: SidecarInput = {
			answer: 'yeah just drop it',
			source: {type: 'observation', slug: 'flaky-thing'},
		};
		let seen: SidecarInput | undefined;
		const decider: DecisionDecider<SidecarInput> = async (received) => {
			seen = received;
			return {outcome: 'delete', deleteReason: received.answer};
		};
		const out = await decide(input, decider, SUPERSET);
		expect(seen).toBe(input);
		expect(out.deleteReason).toBe('yeah just drop it');
	});
});

// ---------------------------------------------------------------------------
// 4. parseDecisionVerdict — the parse table (superset outcomes + throw cases).
// ---------------------------------------------------------------------------
describe('parseDecisionVerdict — the parse table', () => {
	it('parses a `task` verdict out of prose-wrapped + fenced output', () => {
		const output = [
			'Here is my decision.',
			'',
			'```json',
			JSON.stringify({
				outcome: 'task',
				taskSlug: 'add-quiet-flag',
				taskTitle: 'Add a --quiet flag',
				taskBody: '## What to build\n\nA --quiet flag.',
			}),
			'```',
		].join('\n');
		const v = parseDecisionVerdict(output);
		expect(v.outcome).toBe('task');
		expect(v.taskSlug).toBe('add-quiet-flag');
		expect(v.taskTitle).toBe('Add a --quiet flag');
		expect(v.taskBody).toBe('## What to build\n\nA --quiet flag.');
	});

	it('parses a `spec` verdict', () => {
		const v = parseDecisionVerdict(
			'```json\n{"outcome":"spec","prdTitle":"Big","prdBody":"## Problem Statement\\n\\nbig"}\n```',
		);
		expect(v.outcome).toBe('spec');
		expect(v.prdTitle).toBe('Big');
		expect(v.prdBody).toBe('## Problem Statement\n\nbig');
	});

	it('parses an `adr` verdict', () => {
		const v = parseDecisionVerdict(
			'{"outcome":"adr","adrSlug":"the-choice","adrTitle":"The choice"}',
		);
		expect(v.outcome).toBe('adr');
		expect(v.adrSlug).toBe('the-choice');
		expect(v.adrTitle).toBe('The choice');
	});

	it('parses a `delete` verdict (reason only)', () => {
		const v = parseDecisionVerdict(
			'I think this should go.\n\n```json\n{"outcome":"delete","deleteReason":"stale"}\n```',
		);
		expect(v.outcome).toBe('delete');
		expect(v.deleteReason).toBe('stale');
	});

	it('parses an `ask` verdict (question only)', () => {
		const v = parseDecisionVerdict('{"outcome":"ask","question":"Which one?"}');
		expect(v.outcome).toBe('ask');
		expect(v.question).toBe('Which one?');
	});

	it('tolerates missing OPTIONALS (the dispatcher has fallbacks)', () => {
		const v = parseDecisionVerdict(
			'{"outcome":"task","taskTitle":"Only a title"}',
		);
		expect(v.outcome).toBe('task');
		expect(v.taskTitle).toBe('Only a title');
		expect(v.taskSlug).toBeUndefined();
		expect(v.taskBody).toBeUndefined();
	});

	it('THROWS when no JSON object is present', () => {
		expect(() => parseDecisionVerdict('just prose, no verdict')).toThrow(
			/no parseable/i,
		);
	});

	it('THROWS on invalid JSON', () => {
		expect(() =>
			parseDecisionVerdict('```json\n{"outcome":"task",}\n```'),
		).toThrow(/not valid JSON/i);
	});

	it('THROWS on an outcome not in the superset {task,spec,adr,delete,ask}', () => {
		expect(() => parseDecisionVerdict('{"outcome":"bounce"}')).toThrow(
			/task\|spec\|adr\|delete\|ask/,
		);
	});
});
