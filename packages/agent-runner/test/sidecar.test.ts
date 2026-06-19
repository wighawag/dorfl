import {describe, it, expect} from 'vitest';
import {
	parseSidecar,
	serialiseSidecar,
	appendQuestions,
	newSidecar,
	allAnswered,
	pendingEntries,
	isEntryAnswered,
	resolveSidecarIdentity,
	sidecarPathFor,
	SidecarParseError,
	type SidecarModel,
} from '../src/sidecar.js';

/** A canonical two-entry sidecar text (one answered, one open). */
const SAMPLE = [
	'---',
	'item: brief:autoslice',
	'type: brief',
	'slug: autoslice',
	'allAnswered: false',
	'---',
	'',
	'## Q1',
	'id: q1',
	'question: |',
	'  Should the slicer fan PRDs in parallel?',
	'context: |',
	'  The runner already parallelises builds.',
	'answered: true',
	'answer: |',
	'  Yes, bounded at 4.',
	'',
	'## Q2',
	'id: q2',
	'question: |',
	'  What is the default churn cap?',
	'context: |',
	'  Open question from the PRD.',
	'answered: false',
	'answer: |',
	'',
].join('\n');

describe('parseSidecar', () => {
	it('parses identity frontmatter and ordered entries', () => {
		const model = parseSidecar(SAMPLE);
		expect(model.item).toBe('brief:autoslice');
		expect(model.type).toBe('brief');
		expect(model.slug).toBe('autoslice');
		expect(model.entries.map((e) => e.id)).toEqual(['q1', 'q2']);
		expect(model.entries[0].question).toBe(
			'Should the slicer fan PRDs in parallel?',
		);
		expect(model.entries[0].answer).toBe('Yes, bounded at 4.');
		expect(model.entries[1].answer).toBe('');
	});

	it('IGNORES the derived allAnswered mirror on read (recomputed from entries)', () => {
		// The frontmatter lies (allAnswered: true) but only q1 is answered.
		const lying = SAMPLE.replace('allAnswered: false', 'allAnswered: true');
		const model = parseSidecar(lying);
		expect(allAnswered(model)).toBe(false);
	});

	it('is tolerant of the human writing only answer: (no answered: line)', () => {
		const text = [
			'---',
			'item: task:foo',
			'type: task',
			'slug: foo',
			'allAnswered: false',
			'---',
			'',
			'## Q1',
			'id: q1',
			'question: |',
			'  Pick a default?',
			'answer: |',
			'  blue',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect(model.entries[0].answeredOverride).toBeUndefined();
		expect(isEntryAnswered(model.entries[0])).toBe(true);
	});

	it('throws on a missing frontmatter fence', () => {
		expect(() => parseSidecar('## Q1\nid: q1\n')).toThrow(SidecarParseError);
	});

	it('throws on a missing item: identity', () => {
		const text = ['---', 'type: task', 'slug: foo', '---', ''].join('\n');
		expect(() => parseSidecar(text)).toThrow(SidecarParseError);
	});

	it('parses an optional default and a disposition', () => {
		const text = [
			'---',
			'item: observation:dup',
			'type: observation',
			'slug: dup',
			'allAnswered: false',
			'---',
			'',
			'## Q1',
			'id: q1',
			'question: |',
			'  Promote, keep, or delete?',
			'default: |',
			'  keep',
			'answered: false',
			'answer: |',
			'disposition: keep',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect(model.entries[0].default).toBe('keep');
		expect(model.entries[0].disposition).toBe('keep');
	});
});

describe('serialiseSidecar — round-trip stable + canonical', () => {
	it('round-trips a parsed sample byte-stable (canonical output)', () => {
		const model = parseSidecar(SAMPLE);
		const out = serialiseSidecar(model);
		// Re-parsing the serialised text yields an equivalent model.
		const reparsed = parseSidecar(out);
		expect(reparsed).toEqual(model);
		// And serialising again is a fixed point (canonical).
		expect(serialiseSidecar(reparsed)).toBe(out);
	});

	it('recomputes the allAnswered mirror on every write', () => {
		const model = parseSidecar(SAMPLE);
		expect(serialiseSidecar(model)).toContain('allAnswered: false');
		// Answer q2 → all answered → the mirror flips on the next serialise.
		model.entries[1].answer = 'cap at 5';
		expect(serialiseSidecar(model)).toContain('allAnswered: true');
	});

	it('normalises answered: true for a non-empty answer with no explicit override', () => {
		const model: SidecarModel = {
			item: 'task:foo',
			type: 'task',
			slug: 'foo',
			entries: [{id: 'q1', question: 'q?', context: '', answer: 'an answer'}],
		};
		const out = serialiseSidecar(model);
		expect(out).toContain('answered: true');
	});

	it('preserves an explicit answered: false override over a non-empty answer', () => {
		const model: SidecarModel = {
			item: 'task:foo',
			type: 'task',
			slug: 'foo',
			entries: [
				{
					id: 'q1',
					question: 'q?',
					context: '',
					answer: 'tentative',
					answeredOverride: false,
				},
			],
		};
		expect(isEntryAnswered(model.entries[0])).toBe(false);
		expect(serialiseSidecar(model)).toContain('answered: false');
	});
});

describe('the answered predicate (MAINTAINER-RESOLVED §1)', () => {
	it('non-empty answer ⇒ answered', () => {
		expect(
			isEntryAnswered({id: 'q1', question: '', context: '', answer: 'x'}),
		).toBe(true);
	});
	it('empty answer ⇒ unanswered', () => {
		expect(
			isEntryAnswered({id: 'q1', question: '', context: '', answer: '   '}),
		).toBe(false);
	});
	it('explicit answered: false overrides a non-empty answer', () => {
		expect(
			isEntryAnswered({
				id: 'q1',
				question: '',
				context: '',
				answer: 'x',
				answeredOverride: false,
			}),
		).toBe(false);
	});
	it('explicit answered: true overrides an empty answer', () => {
		expect(
			isEntryAnswered({
				id: 'q1',
				question: '',
				context: '',
				answer: '',
				answeredOverride: true,
			}),
		).toBe(true);
	});
});

describe('allAnswered / pendingEntries — derived from entries', () => {
	it('none answered', () => {
		const model = newSidecar('task:foo', [{question: 'a?'}, {question: 'b?'}]);
		expect(allAnswered(model)).toBe(false);
		expect(pendingEntries(model).map((e) => e.id)).toEqual(['q1', 'q2']);
	});

	it('subset answered ⇒ NOT all answered', () => {
		const model = newSidecar('task:foo', [{question: 'a?'}, {question: 'b?'}]);
		model.entries[0].answer = 'yes';
		expect(allAnswered(model)).toBe(false);
		expect(pendingEntries(model).map((e) => e.id)).toEqual(['q2']);
	});

	it('all answered ⇒ allAnswered true', () => {
		const model = newSidecar('task:foo', [{question: 'a?'}]);
		model.entries[0].answer = 'yes';
		expect(allAnswered(model)).toBe(true);
		expect(pendingEntries(model)).toEqual([]);
	});

	it('an empty sidecar is NOT all-answered (keeps pending⇒NO-OP honest)', () => {
		const empty: SidecarModel = {
			item: 'task:foo',
			type: 'task',
			slug: 'foo',
			entries: [],
		};
		expect(allAnswered(empty)).toBe(false);
	});
});

describe('appendQuestions — stable monotonic ids, never overwrite', () => {
	it('appends qN+1 off the highest existing id', () => {
		const model = newSidecar('task:foo', [{question: 'a?'}]);
		const next = appendQuestions(model, [{question: 'b?'}, {question: 'c?'}]);
		expect(next.entries.map((e) => e.id)).toEqual(['q1', 'q2', 'q3']);
	});

	it('never mutates an existing answered entry', () => {
		const model = newSidecar('task:foo', [{question: 'a?'}]);
		model.entries[0].answer = 'kept answer';
		const next = appendQuestions(model, [{question: 'b?'}]);
		expect(next.entries[0]).toEqual(model.entries[0]);
		expect(next.entries[0].answer).toBe('kept answer');
		// The input model is not mutated (a NEW model is returned).
		expect(model.entries).toHaveLength(1);
	});

	it('appending flips a previously-allAnswered sidecar back to not-all-answered', () => {
		const model = newSidecar('task:foo', [{question: 'a?'}]);
		model.entries[0].answer = 'yes';
		expect(allAnswered(model)).toBe(true);
		const next = appendQuestions(model, [{question: 'b?'}]);
		expect(allAnswered(next)).toBe(false);
	});

	it('ids are NEVER reused even when a middle id is conceptually gone', () => {
		// Simulate a model whose highest id is q5 (history); append continues at q6.
		const model: SidecarModel = {
			item: 'task:foo',
			type: 'task',
			slug: 'foo',
			entries: [
				{id: 'q1', question: 'a', context: '', answer: 'x'},
				{id: 'q5', question: 'b', context: '', answer: 'y'},
			],
		};
		const next = appendQuestions(model, [{question: 'c?'}]);
		expect(next.entries.map((e) => e.id)).toEqual(['q1', 'q5', 'q6']);
	});
});

describe('resolveSidecarIdentity / sidecarPathFor — identity-keyed (resolver SoT)', () => {
	it('brief:<slug> → work/questions/brief-<slug>.md', () => {
		expect(sidecarPathFor('brief:autoslice')).toBe(
			'work/questions/brief-autoslice.md',
		);
	});
	it('task:<slug> → work/questions/task-<slug>.md', () => {
		expect(sidecarPathFor('task:foo')).toBe('work/questions/task-foo.md');
	});
	it('observation:<slug> and obs:<slug> both → observation-<slug>.md', () => {
		expect(sidecarPathFor('observation:bar')).toBe(
			'work/questions/observation-bar.md',
		);
		expect(sidecarPathFor('obs:bar')).toBe('work/questions/observation-bar.md');
	});
	it('a bare slug resolves to the task namespace (resolver default)', () => {
		expect(sidecarPathFor('plain')).toBe('work/questions/task-plain.md');
		expect(resolveSidecarIdentity('plain')).toEqual({
			type: 'task',
			slug: 'plain',
			item: 'task:plain',
		});
	});
	it('the `:`→`-` mapping is in the FILENAME only (item keeps the colon)', () => {
		expect(resolveSidecarIdentity('brief:x').item).toBe('brief:x');
	});
});
