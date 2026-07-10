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
	sidecarPathCandidates,
	SidecarParseError,
	type SidecarModel,
	type SidecarKind,
} from '../src/sidecar.js';

/** A canonical two-entry sidecar text in the new human-readable format. */
const SAMPLE = [
	'<!-- dorfl-sidecar: item=spec:autotask type=spec slug=autotask allAnswered=false -->',
	'',
	'## Q1',
	'',
	'**Should the tasker fan PRDs in parallel?**',
	'',
	'> The runner already parallelises builds.',
	'',
	'<!-- q1 fields: id=q1 -->',
	'',
	'**Your answer** (write below this line):',
	'',
	'Yes, bounded at 4.',
	'',
	'## Q2',
	'',
	'**What is the default churn cap?**',
	'',
	'> Open question from the PRD.',
	'',
	'<!-- q2 fields: id=q2 -->',
	'',
	'**Your answer** (write below this line):',
	'',
].join('\n');

describe('parseSidecar — new human-readable format', () => {
	it('parses identity from the top HTML comment and ordered entries', () => {
		const model = parseSidecar(SAMPLE);
		expect(model.item).toBe('spec:autotask');
		expect(model.type).toBe('spec');
		expect(model.slug).toBe('autotask');
		expect(model.entries.map((e) => e.id)).toEqual(['q1', 'q2']);
		expect(model.entries[0].question).toBe(
			'Should the tasker fan PRDs in parallel?',
		);
		expect(model.entries[0].context).toBe(
			'The runner already parallelises builds.',
		);
		expect(model.entries[0].answer).toBe('Yes, bounded at 4.');
		expect(model.entries[1].answer).toBe('');
	});

	it('IGNORES the derived allAnswered mirror on read (recomputed from entries)', () => {
		// The identity comment lies (allAnswered=true) but only q1 is answered.
		const lying = SAMPLE.replace('allAnswered=false', 'allAnswered=true');
		const model = parseSidecar(lying);
		expect(allAnswered(model)).toBe(false);
	});

	it('TOLERANT EDIT: human types only under the answer marker (no comment edit)', () => {
		// Q2's machine comment still says no override; the human just typed
		// prose under the answer marker. The parser derives answered=true from
		// the non-empty answer; the override is NOT sticky. Replace the LAST
		// occurrence of the answer marker (Q2's, since Q1 already has an answer).
		const marker = '**Your answer** (write below this line):';
		const lastIdx = SAMPLE.lastIndexOf(marker);
		const edited =
			SAMPLE.slice(0, lastIdx) +
			marker +
			'\n\ncap at 5\n' +
			SAMPLE.slice(lastIdx + marker.length + 1);
		const model = parseSidecar(edited);
		expect(model.entries[1].answer).toBe('cap at 5');
		expect(model.entries[1].answeredOverride).toBeUndefined();
		expect(isEntryAnswered(model.entries[1])).toBe(true);
		expect(allAnswered(model)).toBe(true);
	});

	it('throws on a missing identity HTML comment', () => {
		expect(() => parseSidecar('## Q1\n\n**hi**\n')).toThrow(SidecarParseError);
	});

	it('throws on a missing item= in the identity comment', () => {
		const text =
			'<!-- dorfl-sidecar: type=task slug=foo allAnswered=false -->\n';
		expect(() => parseSidecar(text)).toThrow(SidecarParseError);
	});

	it('throws on an entry missing its id (per-entry HTML comment)', () => {
		const text = [
			'<!-- dorfl-sidecar: item=task:foo type=task slug=foo allAnswered=false -->',
			'',
			'## Q1',
			'',
			'**A question?**',
			'',
			'**Your answer** (write below this line):',
			'',
		].join('\n');
		expect(() => parseSidecar(text)).toThrow(SidecarParseError);
	});

	it('parses an optional default (the disposition VOCABULARY is retired: a `disposition=` token in the entry comment is IGNORED, an entry is binary)', () => {
		const text = [
			'<!-- dorfl-sidecar: item=observation:dup type=observation slug=dup allAnswered=false -->',
			'',
			'## Q1',
			'',
			'**Promote, keep, or delete?**',
			'',
			'> Body has a clear conservative routing.',
			'',
			'_Suggested default: keep_',
			'',
			// A legacy `disposition=` token is IGNORED (the field no longer exists on
			// the entry shape; what to DO with the answer is the agentic decision).
			'<!-- q1 fields: id=q1 disposition=keep -->',
			'',
			'**Your answer** (write below this line):',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect(model.entries[0].default).toBe('keep');
		expect(model.entries[0].context).toBe(
			'Body has a clear conservative routing.',
		);
		// No `disposition` field on the entry any more.
		expect('disposition' in model.entries[0]).toBe(false);
	});

	it('a legacy disposition token (e.g. promote-task) is parsed away (an entry is binary)', () => {
		const text = [
			'<!-- dorfl-sidecar: item=observation:prom type=observation slug=prom allAnswered=false -->',
			'',
			'## Q1',
			'',
			'**Promote?**',
			'',
			'<!-- q1 fields: id=q1 disposition=promote-task -->',
			'',
			'**Your answer** (write below this line):',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect('disposition' in model.entries[0]).toBe(false);
		expect(model.entries[0].id).toBe('q1');
	});

	it('another legacy disposition token (promote-prd) is also parsed away', () => {
		const text = [
			'<!-- dorfl-sidecar: item=observation:prdprom type=observation slug=prdprom allAnswered=false -->',
			'',
			'## Q1',
			'',
			'**Promote as a PRD?**',
			'',
			'<!-- q1 fields: id=q1 disposition=promote-prd -->',
			'',
			'**Your answer** (write below this line):',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect('disposition' in model.entries[0]).toBe(false);
		expect(model.entries[0].id).toBe('q1');
	});

	it('any disposition token (e.g. the legacy promote-slice) is parsed away — the vocabulary is fully retired', () => {
		const text = [
			'<!-- dorfl-sidecar: item=observation:legacy type=observation slug=legacy allAnswered=false -->',
			'',
			'## Q1',
			'',
			'**Promote?**',
			'',
			'<!-- q1 fields: id=q1 disposition=promote-slice -->',
			'',
			'**Your answer** (write below this line):',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect('disposition' in model.entries[0]).toBe(false);
	});
});

describe('serialiseSidecar — canonical shape + semantic round-trip', () => {
	it('emits a human-readable shape: identity comment + bold/blockquote/italic + answer marker', () => {
		const model = parseSidecar(SAMPLE);
		const out = serialiseSidecar(model);
		// Identity comment at the top (HTML comment, no YAML frontmatter).
		expect(out.startsWith('<!-- dorfl-sidecar:')).toBe(true);
		expect(out).toContain('item=spec:autotask');
		expect(out).toContain('allAnswered=false');
		// No literal block-scalar `|` pipes anywhere (the old format's giveaway).
		expect(out).not.toContain('question: |');
		expect(out).not.toContain('answer: |');
		// Bold question line, blockquote context, fixed answer marker per entry.
		expect(out).toContain('**Should the tasker fan PRDs in parallel?**');
		expect(out).toContain('> The runner already parallelises builds.');
		expect(out).toContain('**Your answer** (write below this line):');
		// Per-entry HTML comment carries the id.
		expect(out).toContain('<!-- q1 fields: id=q1 -->');
	});

	it('round-trips SEMANTICALLY: parse → serialise → parse recovers an equal model', () => {
		const model = parseSidecar(SAMPLE);
		const out = serialiseSidecar(model);
		const reparsed = parseSidecar(out);
		expect(reparsed).toEqual(model);
		// And re-serialising is a fixed point (canonical text).
		expect(serialiseSidecar(reparsed)).toBe(out);
	});

	it('recomputes the allAnswered mirror on every write', () => {
		const model = parseSidecar(SAMPLE);
		expect(serialiseSidecar(model)).toContain('allAnswered=false');
		// Answer q2 → all answered → the mirror flips on the next serialise.
		model.entries[1].answer = 'cap at 5';
		expect(serialiseSidecar(model)).toContain('allAnswered=true');
	});

	it('normalises answered=true for a non-empty answer with no explicit override', () => {
		const model: SidecarModel = {
			item: 'task:foo',
			type: 'task',
			slug: 'foo',
			entries: [{id: 'q1', question: 'q?', context: '', answer: 'an answer'}],
		};
		const out = serialiseSidecar(model);
		// The override field is OMITTED when the derived predicate already
		// matches (so a stale comment cannot become a sticky override).
		expect(out).toContain('<!-- q1 fields: id=q1 -->');
		expect(out).not.toContain('answered=');
	});

	it('preserves an explicit answered=false override over a non-empty answer', () => {
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
		const out = serialiseSidecar(model);
		expect(out).toContain('answered=false');
		// And a parse-back recovers the override (it DISAGREES with the
		// answer-derived predicate, so it is a genuine override).
		const reparsed = parseSidecar(out);
		expect(reparsed.entries[0].answeredOverride).toBe(false);
		expect(isEntryAnswered(reparsed.entries[0])).toBe(false);
	});

	it('preserves an explicit answered=true override over an empty answer', () => {
		const model: SidecarModel = {
			item: 'task:foo',
			type: 'task',
			slug: 'foo',
			entries: [
				{
					id: 'q1',
					question: 'q?',
					context: '',
					answer: '',
					answeredOverride: true,
				},
			],
		};
		const out = serialiseSidecar(model);
		expect(out).toContain('answered=true');
		const reparsed = parseSidecar(out);
		expect(reparsed.entries[0].answeredOverride).toBe(true);
		expect(isEntryAnswered(reparsed.entries[0])).toBe(true);
	});

	it('emits the italic suggested default on a serialised entry', () => {
		const model = newSidecar('task:foo', [
			{question: 'pick a colour?', context: 'no rush', default: 'blue'},
		]);
		const out = serialiseSidecar(model);
		expect(out).toContain('_Suggested default: blue_');
		const reparsed = parseSidecar(out);
		expect(reparsed.entries[0].default).toBe('blue');
		expect(reparsed.entries[0].context).toBe('no rush');
	});

	it('does NOT serialise any disposition field (the vocabulary is retired — entries are binary)', () => {
		const model = newSidecar('observation:dup', [
			{
				question: 'promote, keep, or delete?',
				context: 'an observation',
				default: 'keep',
			},
		]);
		const out = serialiseSidecar(model);
		expect(out).not.toContain('disposition=');
		const reparsed = parseSidecar(out);
		expect('disposition' in reparsed.entries[0]).toBe(false);
	});
});

describe('answer boundary is HEADING-DELIMITED (ADR trade-off b)', () => {
	it('an answer containing a literal `---` line still parses as ONE answer', () => {
		const text = [
			'<!-- dorfl-sidecar: item=task:foo type=task slug=foo allAnswered=false -->',
			'',
			'## Q1',
			'',
			'**Pick an option?**',
			'',
			'<!-- q1 fields: id=q1 -->',
			'',
			'**Your answer** (write below this line):',
			'',
			'before the rule',
			'',
			'---',
			'',
			'after the rule',
			'',
			'## Q2',
			'',
			'**Second?**',
			'',
			'<!-- q2 fields: id=q2 -->',
			'',
			'**Your answer** (write below this line):',
			'',
			'just the second answer',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect(model.entries).toHaveLength(2);
		expect(model.entries[0].answer).toBe(
			'before the rule\n\n---\n\nafter the rule',
		);
		expect(model.entries[1].answer).toBe('just the second answer');
		// Round-trips semantically.
		const reparsed = parseSidecar(serialiseSidecar(model));
		expect(reparsed).toEqual(model);
	});

	it('an answer with a `## ` mid-line (NOT at the start of a line) is one answer', () => {
		const text = [
			'<!-- dorfl-sidecar: item=task:foo type=task slug=foo allAnswered=false -->',
			'',
			'## Q1',
			'',
			'**A question?**',
			'',
			'<!-- q1 fields: id=q1 -->',
			'',
			'**Your answer** (write below this line):',
			'',
			'see issue ## 42 for context',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect(model.entries).toHaveLength(1);
		expect(model.entries[0].answer).toBe('see issue ## 42 for context');
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
	it('explicit override false beats a non-empty answer', () => {
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
	it('explicit override true beats an empty answer', () => {
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

	it('all answered ⇒ allAnswered true (and the comment mirror reflects it)', () => {
		const model = newSidecar('task:foo', [{question: 'a?'}]);
		model.entries[0].answer = 'yes';
		expect(allAnswered(model)).toBe(true);
		expect(pendingEntries(model)).toEqual([]);
		expect(serialiseSidecar(model)).toContain('allAnswered=true');
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
	it('spec:<slug> → work/questions/spec-<slug>.md', () => {
		expect(sidecarPathFor('spec:autotask')).toBe(
			'work/questions/spec-autotask.md',
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
		expect(resolveSidecarIdentity('spec:x').item).toBe('spec:x');
	});
});

describe('sidecarPathCandidates — spec probes the legacy prd-<slug>.md fallback', () => {
	// CARVE-OUT #1 (DATA-territory survivor): the producer now emits `spec:<slug>`,
	// but the on-disk sidecar is still the legacy `prd-<slug>.md` until the migration
	// command renames the DATA. A `spec`-typed identity therefore probes
	// `spec-<slug>.md` FIRST, then the legacy `prd-<slug>.md` — so a `spec:`-emitted
	// item still finds its `prd-<slug>.md` sidecar. This FILE-PATH alias is DATA the
	// migration command removes (NOT the `SidecarType` `'prd'` member, which is gone).
	it('spec:<slug> → [spec-<slug>.md, prd-<slug>.md] (canonical first, legacy fallback)', () => {
		expect(sidecarPathCandidates('spec:autotask')).toEqual([
			'work/questions/spec-autotask.md',
			'work/questions/prd-autotask.md',
		]);
	});
	it('the first candidate is exactly sidecarPathFor (the canonical path)', () => {
		expect(sidecarPathCandidates('spec:x')[0]).toBe(sidecarPathFor('spec:x'));
	});
	it('a non-spec type has a SINGLE candidate (its canonical path, no fallback)', () => {
		expect(sidecarPathCandidates('task:foo')).toEqual([
			'work/questions/task-foo.md',
		]);
		expect(sidecarPathCandidates('observation:bar')).toEqual([
			'work/questions/observation-bar.md',
		]);
	});
});

describe('entry `kind` axis — INTERIM dispatch primitive (apply-rung reads it)', () => {
	const KINDS: SidecarKind[] = ['merge', 'stuck', 'triage', 'spec'];

	it.each(KINDS)(
		'round-trips `kind=%s` through serialise + parse, emitting it in the per-entry comment',
		(kind) => {
			const model: SidecarModel = {
				item: 'task:foo',
				type: 'task',
				slug: 'foo',
				entries: [{id: 'q1', question: 'q?', context: '', answer: '', kind}],
			};
			const out = serialiseSidecar(model);
			expect(out).toContain(`<!-- q1 fields: id=q1 kind=${kind} -->`);
			const reparsed = parseSidecar(out);
			expect(reparsed.entries[0].kind).toBe(kind);
			// Fixed point: re-serialising is byte-equal.
			expect(serialiseSidecar(reparsed)).toBe(out);
		},
	);

	it('an entry with NO `kind` parses + serialises byte-identically (back-compat — every existing sidecar is unchanged)', () => {
		const text = [
			'<!-- dorfl-sidecar: item=task:foo type=task slug=foo allAnswered=false -->',
			'',
			'## Q1',
			'',
			'**A question?**',
			'',
			'<!-- q1 fields: id=q1 -->',
			'',
			'**Your answer** (write below this line):',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect('kind' in model.entries[0]).toBe(false);
		expect(serialiseSidecar(model)).toBe(text);
	});

	it('an unknown `kind=` token parses to `undefined` (silent-on-malformed, retired-`disposition` precedent)', () => {
		const text = [
			'<!-- dorfl-sidecar: item=task:foo type=task slug=foo allAnswered=false -->',
			'',
			'## Q1',
			'',
			'**A question?**',
			'',
			'<!-- q1 fields: id=q1 kind=bogus -->',
			'',
			'**Your answer** (write below this line):',
			'',
		].join('\n');
		const model = parseSidecar(text);
		expect(model.entries[0].kind).toBeUndefined();
		expect('kind' in model.entries[0]).toBe(false);
		// And serialising drops the unknown token (no coerce, no echo).
		expect(serialiseSidecar(model)).not.toContain('kind=');
	});

	it('`newSidecar` / `appendQuestions` stamp the `kind` the surfacer hands them', () => {
		const model = newSidecar('task:foo', [
			{question: 'merge x?', kind: 'merge'},
		]);
		expect(model.entries[0].kind).toBe('merge');
		const next = appendQuestions(model, [
			{question: 'spec y?', kind: 'spec'},
			{question: 'plain content q?'},
		]);
		expect(next.entries.map((e) => e.kind)).toEqual([
			'merge',
			'spec',
			undefined,
		]);
	});
});
