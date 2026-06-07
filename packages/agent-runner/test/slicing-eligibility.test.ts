import {describe, it, expect} from 'vitest';
import {
	resolveSliceGate,
	resolveSliceAfter,
	resolveSlicingEligibility,
} from '../src/slicing-eligibility.js';

describe('resolveSliceGate — the humanOnly × needsAnswers × autoSlice matrix', () => {
	it('humanOnly: true is never agent-sliceable regardless of autoSlice', () => {
		expect(resolveSliceGate(true, undefined, false)).toBe(false);
		expect(resolveSliceGate(true, undefined, true)).toBe(false);
	});

	it('needsAnswers: true is never agent-sliceable regardless of autoSlice', () => {
		expect(resolveSliceGate(undefined, true, false)).toBe(false);
		expect(resolveSliceGate(undefined, true, true)).toBe(false);
	});

	it('either axis alone blocks (orthogonal); both set still blocks', () => {
		expect(resolveSliceGate(true, true, true)).toBe(false);
		expect(resolveSliceGate(true, false, true)).toBe(false);
		expect(resolveSliceGate(false, true, true)).toBe(false);
	});

	it('undeclared on both axes is sliceable iff autoSlice is on', () => {
		expect(resolveSliceGate(undefined, undefined, false)).toBe(false);
		expect(resolveSliceGate(undefined, undefined, true)).toBe(true);
	});

	// An explicit `false` on either axis is treated as "not gated" (undeclared),
	// per the binary model: the only meaningful declaration is `true`.
	it('explicit false on both axes behaves like undeclared (sliceable iff autoSlice)', () => {
		expect(resolveSliceGate(false, false, false)).toBe(false);
		expect(resolveSliceGate(false, false, true)).toBe(true);
	});

	// The full truth table: all four humanOnly×needsAnswers states × autoSlice on/off.
	const axisStates: Array<boolean | undefined> = [undefined, false, true];
	for (const humanOnly of axisStates) {
		for (const needsAnswers of axisStates) {
			for (const autoSlice of [false, true]) {
				const gated = humanOnly === true || needsAnswers === true;
				const expected = gated ? false : autoSlice;
				it(`humanOnly=${String(humanOnly)} needsAnswers=${String(needsAnswers)} autoSlice=${autoSlice} → ${expected}`, () => {
					expect(resolveSliceGate(humanOnly, needsAnswers, autoSlice)).toBe(
						expected,
					);
				});
			}
		}
	}
});

describe('resolveSliceAfter — against the `sliced:` marker (not done/)', () => {
	it('is satisfied when sliceAfter is empty', () => {
		const r = resolveSliceAfter([], new Set());
		expect(r.satisfied).toBe(true);
		expect(r.missing).toEqual([]);
	});

	it('is satisfied when every listed PRD is already sliced', () => {
		const r = resolveSliceAfter(['a', 'b'], new Set(['a', 'b', 'c']));
		expect(r.satisfied).toBe(true);
		expect(r.missing).toEqual([]);
	});

	it('is unsatisfied and reports the unsliced PRDs', () => {
		const r = resolveSliceAfter(['a', 'b'], new Set(['a']));
		expect(r.satisfied).toBe(false);
		expect(r.missing).toEqual(['b']);
	});

	it('reports all missing when none are sliced', () => {
		const r = resolveSliceAfter(['a', 'b'], new Set());
		expect(r.satisfied).toBe(false);
		expect(r.missing).toEqual(['a', 'b']);
	});

	it('preserves declaration order in the missing list', () => {
		const r = resolveSliceAfter(['z', 'a', 'm'], new Set(['a']));
		expect(r.missing).toEqual(['z', 'm']);
	});
});

describe('resolveSlicingEligibility — gate × sliceAfter (sliced-vs-unsliced fixtures)', () => {
	const cases: Array<{
		humanOnly: boolean | undefined;
		needsAnswers: boolean | undefined;
		autoSlice: boolean;
		sliceAfter: string[];
		sliced: Set<string>;
		sliceable: boolean;
		gatePass: boolean;
	}> = [
		// undeclared + autoSlice on + no sliceAfter ⇒ sliceable
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoSlice: true,
			sliceAfter: [],
			sliced: new Set(),
			sliceable: true,
			gatePass: true,
		},
		// undeclared + autoSlice on + an UNSLICED blocker ⇒ gate passes but blocked
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoSlice: true,
			sliceAfter: ['other'],
			sliced: new Set(),
			sliceable: false,
			gatePass: true,
		},
		// undeclared + autoSlice on + the blocker IS sliced ⇒ sliceable
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoSlice: true,
			sliceAfter: ['other'],
			sliced: new Set(['other']),
			sliceable: true,
			gatePass: true,
		},
		// undeclared + autoSlice off ⇒ never (gate fails)
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoSlice: false,
			sliceAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// humanOnly + autoSlice on ⇒ never (gate fails regardless of sliceAfter)
		{
			humanOnly: true,
			needsAnswers: undefined,
			autoSlice: true,
			sliceAfter: ['other'],
			sliced: new Set(['other']),
			sliceable: false,
			gatePass: false,
		},
		// needsAnswers + autoSlice on ⇒ never (the discovered axis blocks)
		{
			humanOnly: undefined,
			needsAnswers: true,
			autoSlice: true,
			sliceAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// needsAnswers blocks independently of humanOnly (humanOnly false)
		{
			humanOnly: false,
			needsAnswers: true,
			autoSlice: true,
			sliceAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// both axes set + autoSlice on ⇒ never
		{
			humanOnly: true,
			needsAnswers: true,
			autoSlice: true,
			sliceAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// humanOnly + autoSlice off ⇒ never
		{
			humanOnly: true,
			needsAnswers: undefined,
			autoSlice: false,
			sliceAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// multiple sliceAfter, one unsliced ⇒ blocked though gate passes
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoSlice: true,
			sliceAfter: ['a', 'b'],
			sliced: new Set(['a']),
			sliceable: false,
			gatePass: true,
		},
	];

	for (const c of cases) {
		const label =
			`humanOnly=${String(c.humanOnly)} needsAnswers=${String(c.needsAnswers)} ` +
			`autoSlice=${c.autoSlice} ` +
			`sliceAfter=${
				c.sliceAfter.length === 0
					? 'none'
					: c.sliceAfter.every((s) => c.sliced.has(s))
						? 'sliced'
						: 'unsliced'
			}`;
		it(`${label} → sliceable=${c.sliceable}`, () => {
			const r = resolveSlicingEligibility({
				humanOnly: c.humanOnly,
				needsAnswers: c.needsAnswers,
				sliceAfter: c.sliceAfter,
				slicedSlugs: c.sliced,
				autoSlice: c.autoSlice,
			});
			expect(r.sliceable).toBe(c.sliceable);
			expect(r.gatePass).toBe(c.gatePass);
		});
	}

	it('reports the unsliced PRDs when blocked by sliceAfter', () => {
		const r = resolveSlicingEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			sliceAfter: ['other'],
			slicedSlugs: new Set(),
			autoSlice: true,
		});
		expect(r.sliceAfter.satisfied).toBe(false);
		expect(r.sliceAfter.missing).toEqual(['other']);
	});
});
