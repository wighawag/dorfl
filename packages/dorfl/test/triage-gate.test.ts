import {describe, it, expect} from 'vitest';
import {
	parseTriageEmit,
	buildTriagePrompt,
	TriageParseError,
} from '../src/triage-gate.js';

/**
 * `advance-rung-triage` task — the TRIAGE auto-disposition GATE parse (US #17).
 * The gate is the conservative `observationTriage: 'auto'`-gated exception: it judges whether an
 * observation is a NO-QUESTION case and emits `{auto, …}`. These tests pin the
 * parse + the HIGH BAR safety fallback (a malformed `auto:true` ⇒ surface the
 * question, never auto-dispose on a half-baked emit). The gate WRITE is exercised
 * via the engine in advance-triage.test.ts; here it is the pure parse, mirroring
 * `surface-gate.test.ts`.
 */

describe('parseTriageEmit — the conservative auto-disposition decision', () => {
	it('parses a duplicate auto-disposition (exact-duplicate → recommend delete)', () => {
		const emit = parseTriageEmit(
			JSON.stringify({
				auto: true,
				kind: 'duplicate',
				existing: 'observation:other',
				reason: 'same signal already captured',
			}),
		);
		expect(emit.auto).toBe(true);
		if (emit.auto) {
			expect(emit.kind).toBe('duplicate');
			expect(emit.existing).toBe('observation:other');
			expect(emit.reason).toContain('already captured');
		}
	});

	it('parses a map auto-disposition (unambiguous map onto an existing item)', () => {
		const emit = parseTriageEmit(
			'prose before {"auto": true, "kind": "map", "existing": "task:foo"} prose after',
		);
		expect(emit.auto).toBe(true);
		if (emit.auto) {
			expect(emit.kind).toBe('map');
			expect(emit.existing).toBe('task:foo');
		}
	});

	it('parses a question-gated decision (auto:false ⇒ surface the question)', () => {
		const emit = parseTriageEmit(
			JSON.stringify({
				auto: false,
				reason: 'needs a human promote/keep/delete',
			}),
		);
		expect(emit.auto).toBe(false);
		if (!emit.auto) {
			expect(emit.reason).toContain('human');
		}
	});

	it('HIGH BAR: an auto:true WITHOUT a recognised kind falls back to auto:false (surface)', () => {
		// A malformed "auto" must NEVER win — the safe direction is to surface the
		// question, never to auto-dispose on a half-baked emit.
		const emit = parseTriageEmit(
			JSON.stringify({auto: true, kind: 'promote', existing: 'task:x'}),
		);
		expect(emit.auto).toBe(false);
	});

	it('HIGH BAR: an auto:true WITHOUT an existing target falls back to auto:false', () => {
		const emit = parseTriageEmit(
			JSON.stringify({auto: true, kind: 'duplicate'}),
		);
		expect(emit.auto).toBe(false);
	});

	it('NEVER auto-promotes: an emit naming `promote-prd` as the kind falls back to auto:false (US #5)', () => {
		// The auto gate's disposition vocabulary is ONLY `duplicate`/`map` — sizing a
		// signal into a task vs a PRD is a HUMAN judgement call, offered at the
		// surface, NEVER an auto-pick. An emit that tries to auto-`promote-prd` is
		// just another unrecognised kind: it must surface the question, never win.
		const emit = parseTriageEmit(
			JSON.stringify({
				auto: true,
				kind: 'promote-prd',
				existing: 'prd:x',
				reason: 'looks PRD-sized',
			}),
		);
		expect(emit.auto).toBe(false);
		// The auto-side type never carries a promote kind at all: an `auto:true` emit
		// can only be `duplicate` or `map`, so `promote-prd` is unreachable as an
		// auto-disposition by construction.
		if (emit.auto) {
			expect(['duplicate', 'map']).toContain(emit.kind);
		}
	});

	it('throws when no `auto` field is present (the caller treats it as the safe path)', () => {
		expect(() => parseTriageEmit('no json here')).toThrow(TriageParseError);
		expect(() => parseTriageEmit(JSON.stringify({kind: 'duplicate'}))).toThrow(
			TriageParseError,
		);
	});
});

describe('buildTriagePrompt — states the high bar plainly', () => {
	it('names the two no-question cases and forbids auto-promote / auto-delete', () => {
		const prompt = buildTriagePrompt('observation:foo');
		expect(prompt).toContain('observation:foo');
		expect(prompt).toContain('duplicate');
		expect(prompt).toContain('map');
		expect(prompt).toContain('NEVER emit auto:true to PROMOTE');
		expect(prompt).toContain('NEVER to DELETE a NON-duplicate');
		// The auto gate never offers PRD-sizing either — `promote-prd` is a
		// human-only disposition, so it is not in the auto gate's vocabulary.
		expect(prompt).not.toContain('promote-prd');
	});
});
