import {describe, it, expect} from 'vitest';
import {
	stampIntakeMarker,
	parseIntakeMarker,
	isIntakeComment,
	computeSeenDelta,
	seenSetFrom,
} from '../src/intake-marker.js';
import {brand} from '../src/brand.js';
import type {IssueComment} from '../src/issue-provider.js';

/**
 * `intake-self-awareness-resumption-tracking`: the SHARED intake MARKER primitive
 * the TRIAGE GATE is built on. Pure logic over comment bodies (no seam/git/`gh`) \u2014
 * the marker grammar (`<!-- ${brand.base}:intake kind=\u2026 [slug=\u2026] seen=\u2026 -->`), the
 * per-run `seen=` delta (HUMAN ids only, excluding intake's own + already-seen),
 * and the `seenSet` UNION across markers (the chain model).
 */

const NS = `${brand.base}:intake`;

describe('intake marker \u2014 stamp + parse the hidden HTML comment', () => {
	it('stamps an ask marker as a hidden HTML comment appended after the text', () => {
		const out = stampIntakeMarker('Which notes should --quiet suppress?', {
			kind: 'ask',
			seen: ['412', '418'],
		});
		expect(out).toContain('Which notes should --quiet suppress?');
		expect(out).toContain(`<!-- ${NS} kind=ask seen=412,418 -->`);
	});

	it('uses the brand.base namespace (today dorfl:intake), so a rebrand updates it', () => {
		const out = stampIntakeMarker('x', {kind: 'bounced', seen: ['503']});
		expect(out).toContain(`<!-- dorfl:intake `);
		expect(NS).toBe('dorfl:intake');
	});

	it('emits seen= even when the delta is EMPTY (uniform grammar)', () => {
		const out = stampIntakeMarker('hi', {kind: 'ask', seen: []});
		expect(out).toContain(`<!-- ${NS} kind=ask seen= -->`);
	});

	it('a created marker carries slug= (and only created does)', () => {
		const created = stampIntakeMarker('Created task foo', {
			kind: 'created',
			seen: ['601', '602'],
			slug: 'add-quiet-flag',
		});
		expect(created).toContain(
			`<!-- ${NS} kind=created slug=add-quiet-flag seen=601,602 -->`,
		);
		// ask never emits a slug even if (wrongly) supplied.
		const ask = stampIntakeMarker('q', {
			kind: 'ask',
			seen: [],
			slug: 'ignored',
		});
		expect(ask).not.toContain('slug=');
	});

	it('parses kind / slug / seen back out of a body (body text, not a separate field)', () => {
		const body =
			'Created PRD quiet-and-verbose-modes\n\n' +
			`<!-- ${NS} kind=created slug=quiet-and-verbose-modes seen=601,602 -->`;
		const marker = parseIntakeMarker(body);
		expect(marker).toEqual({
			kind: 'created',
			slug: 'quiet-and-verbose-modes',
			seen: ['601', '602'],
		});
	});

	it('a round-trip survives stamp \u2192 parse', () => {
		const body = stampIntakeMarker('the question', {
			kind: 'ask',
			seen: ['7', '8', '9'],
		});
		expect(parseIntakeMarker(body)).toEqual({
			kind: 'ask',
			seen: ['7', '8', '9'],
		});
	});

	it('a HUMAN comment (no marker) parses to undefined \u2014 it is not intake\u2019s', () => {
		expect(parseIntakeMarker('just a normal reply')).toBeUndefined();
		expect(isIntakeComment({body: 'just a normal reply'})).toBe(false);
		expect(
			isIntakeComment({body: `done\n\n<!-- ${NS} kind=ask seen= -->`}),
		).toBe(true);
	});

	it('a MALFORMED marker (unknown/absent kind) is treated as ABSENT (never throws)', () => {
		expect(
			parseIntakeMarker(`<!-- ${NS} kind=frobnicate seen=1 -->`),
		).toBeUndefined();
		expect(parseIntakeMarker(`<!-- ${NS} seen=1 -->`)).toBeUndefined();
		// A different namespace is not ours.
		expect(
			parseIntakeMarker('<!-- someone-else:intake kind=ask seen=1 -->'),
		).toBeUndefined();
	});
});

describe('computeSeenDelta \u2014 the per-run delta of HUMAN comment ids', () => {
	const intakeAsk = (seen: string[], id?: string): IssueComment => ({
		...(id !== undefined ? {id} : {}),
		body: stampIntakeMarker('q', {kind: 'ask', seen}),
	});

	it('records every human comment id when there is no prior marker', () => {
		const thread: IssueComment[] = [
			{id: '1', body: 'first'},
			{id: '2', body: 'second'},
		];
		expect(computeSeenDelta(thread)).toEqual(['1', '2']);
	});

	it('EXCLUDES intake\u2019s own marker-comments (the self-trigger trap)', () => {
		const thread: IssueComment[] = [
			{id: '1', body: 'human'},
			intakeAsk(['1'], 'm1'),
		];
		// Only the human id is recorded; intake\u2019s own marker-comment id (`m1`) is not.
		expect(computeSeenDelta(thread)).toEqual([]);
		// (id 1 is already in the prior marker\u2019s seen=, so the delta is empty.)
	});

	it('EXCLUDES human ids ALREADY recorded in a prior marker\u2019s seen= (the chain model delta)', () => {
		const thread: IssueComment[] = [
			{id: '1', body: 'human a'},
			intakeAsk(['1'], 'm1'),
			{id: '2', body: 'human b'},
		];
		// The new delta is only the NEW human id (2); 1 is already seen.
		expect(computeSeenDelta(thread)).toEqual(['2']);
	});

	it('drops comments with no id (a provider that omitted one)', () => {
		const thread: IssueComment[] = [{body: 'no id'}, {id: '5', body: 'has id'}];
		expect(computeSeenDelta(thread)).toEqual(['5']);
	});
});

describe('seenSetFrom \u2014 the UNION of every marker\u2019s seen= (the chain model)', () => {
	it('unions the seen= lists of TWO prior intake markers', () => {
		const thread: IssueComment[] = [
			{id: '1', body: 'a'},
			{id: '2', body: 'b'},
			{
				id: 'm1',
				body: stampIntakeMarker('q1', {kind: 'ask', seen: ['1', '2']}),
			},
			{id: '3', body: 'c'},
			{id: 'm2', body: stampIntakeMarker('q2', {kind: 'ask', seen: ['3']})},
		];
		const set = seenSetFrom(thread);
		expect([...set].sort()).toEqual(['1', '2', '3']);
	});

	it('a thread with no markers yields an empty seenSet', () => {
		expect(seenSetFrom([{id: '1', body: 'x'}]).size).toBe(0);
	});
});
