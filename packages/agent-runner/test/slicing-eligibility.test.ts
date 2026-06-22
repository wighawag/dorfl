import {describe, it, expect} from 'vitest';
import {
	resolveSliceGate,
	resolveSliceAfter,
	resolveSlicingEligibility,
} from '../src/slicing-eligibility.js';

describe('resolveSliceGate — the humanOnly × needsAnswers × autoTask matrix', () => {
	it('humanOnly: true is never agent-sliceable regardless of autoTask', () => {
		expect(resolveSliceGate(true, undefined, false)).toBe(false);
		expect(resolveSliceGate(true, undefined, true)).toBe(false);
	});

	it('needsAnswers: true is never agent-sliceable regardless of autoTask', () => {
		expect(resolveSliceGate(undefined, true, false)).toBe(false);
		expect(resolveSliceGate(undefined, true, true)).toBe(false);
	});

	it('either axis alone blocks (orthogonal); both set still blocks', () => {
		expect(resolveSliceGate(true, true, true)).toBe(false);
		expect(resolveSliceGate(true, false, true)).toBe(false);
		expect(resolveSliceGate(false, true, true)).toBe(false);
	});

	it('undeclared on both axes is sliceable iff autoTask is on', () => {
		expect(resolveSliceGate(undefined, undefined, false)).toBe(false);
		expect(resolveSliceGate(undefined, undefined, true)).toBe(true);
	});

	// An explicit `false` on either axis is treated as "not gated" (undeclared),
	// per the binary model: the only meaningful declaration is `true`.
	it('explicit false on both axes behaves like undeclared (sliceable iff autoTask)', () => {
		expect(resolveSliceGate(false, false, false)).toBe(false);
		expect(resolveSliceGate(false, false, true)).toBe(true);
	});

	// The full truth table: all four humanOnly×needsAnswers states × autoTask on/off.
	const axisStates: Array<boolean | undefined> = [undefined, false, true];
	for (const humanOnly of axisStates) {
		for (const needsAnswers of axisStates) {
			for (const autoTask of [false, true]) {
				const gated = humanOnly === true || needsAnswers === true;
				const expected = gated ? false : autoTask;
				it(`humanOnly=${String(humanOnly)} needsAnswers=${String(needsAnswers)} autoTask=${autoTask} → ${expected}`, () => {
					expect(resolveSliceGate(humanOnly, needsAnswers, autoTask)).toBe(
						expected,
					);
				});
			}
		}
	}
});

describe('resolveSliceGate — explicit naming satisfies the autoTask policy term', () => {
	// `explicit: true` mirrors `do <slice>` building regardless of `autoBuild`:
	// naming the PRD IS the authorization, so the `autoTask` policy term drops.
	it('explicit + autoTask OFF is sliceable (the policy term is satisfied by naming)', () => {
		expect(resolveSliceGate(undefined, undefined, false, true)).toBe(true);
	});

	it('explicit defaults false (the pool path) ⇒ autoTask still gates', () => {
		expect(resolveSliceGate(undefined, undefined, false)).toBe(false);
		expect(resolveSliceGate(undefined, undefined, false, false)).toBe(false);
	});

	it('explicit does NOT override the readiness axes (humanOnly / needsAnswers still block)', () => {
		expect(resolveSliceGate(true, undefined, false, true)).toBe(false);
		expect(resolveSliceGate(undefined, true, false, true)).toBe(false);
		expect(resolveSliceGate(true, true, true, true)).toBe(false);
	});

	it('explicit is harmless when autoTask is already on (both authorize)', () => {
		expect(resolveSliceGate(undefined, undefined, true, true)).toBe(true);
	});
});

describe('resolveSlicingEligibility — explicit drops the policy term but keeps briefAfter', () => {
	it('explicit + autoTask OFF + no briefAfter ⇒ sliceable', () => {
		const r = resolveSlicingEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			briefAfter: [],
			slicedSlugs: new Set(),
			autoTask: false,
			explicit: true,
		});
		expect(r.sliceable).toBe(true);
		expect(r.gatePass).toBe(true);
	});

	it('explicit + autoTask OFF but an UNSLICED briefAfter ⇒ gate passes, still blocked', () => {
		const r = resolveSlicingEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			briefAfter: ['other'],
			slicedSlugs: new Set(),
			autoTask: false,
			explicit: true,
		});
		expect(r.gatePass).toBe(true);
		expect(r.sliceable).toBe(false);
		expect(r.briefAfter.missing).toEqual(['other']);
	});

	it('explicit + humanOnly ⇒ never (the readiness axis binds)', () => {
		const r = resolveSlicingEligibility({
			humanOnly: true,
			needsAnswers: undefined,
			briefAfter: [],
			slicedSlugs: new Set(),
			autoTask: false,
			explicit: true,
		});
		expect(r.gatePass).toBe(false);
		expect(r.sliceable).toBe(false);
	});
});

describe('resolveSliceAfter — against `work/briefs/tasked/` residence (not done/)', () => {
	it('is satisfied when briefAfter is empty', () => {
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

describe('resolveSlicingEligibility — gate × briefAfter (sliced-vs-unsliced fixtures)', () => {
	const cases: Array<{
		humanOnly: boolean | undefined;
		needsAnswers: boolean | undefined;
		autoTask: boolean;
		briefAfter: string[];
		sliced: Set<string>;
		sliceable: boolean;
		gatePass: boolean;
	}> = [
		// undeclared + autoTask on + no briefAfter ⇒ sliceable
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: true,
			briefAfter: [],
			sliced: new Set(),
			sliceable: true,
			gatePass: true,
		},
		// undeclared + autoTask on + an UNSLICED blocker ⇒ gate passes but blocked
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: true,
			briefAfter: ['other'],
			sliced: new Set(),
			sliceable: false,
			gatePass: true,
		},
		// undeclared + autoTask on + the blocker IS sliced ⇒ sliceable
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: true,
			briefAfter: ['other'],
			sliced: new Set(['other']),
			sliceable: true,
			gatePass: true,
		},
		// undeclared + autoTask off ⇒ never (gate fails)
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: false,
			briefAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// humanOnly + autoTask on ⇒ never (gate fails regardless of briefAfter)
		{
			humanOnly: true,
			needsAnswers: undefined,
			autoTask: true,
			briefAfter: ['other'],
			sliced: new Set(['other']),
			sliceable: false,
			gatePass: false,
		},
		// needsAnswers + autoTask on ⇒ never (the discovered axis blocks)
		{
			humanOnly: undefined,
			needsAnswers: true,
			autoTask: true,
			briefAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// needsAnswers blocks independently of humanOnly (humanOnly false)
		{
			humanOnly: false,
			needsAnswers: true,
			autoTask: true,
			briefAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// both axes set + autoTask on ⇒ never
		{
			humanOnly: true,
			needsAnswers: true,
			autoTask: true,
			briefAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// humanOnly + autoTask off ⇒ never
		{
			humanOnly: true,
			needsAnswers: undefined,
			autoTask: false,
			briefAfter: [],
			sliced: new Set(),
			sliceable: false,
			gatePass: false,
		},
		// multiple briefAfter, one unsliced ⇒ blocked though gate passes
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: true,
			briefAfter: ['a', 'b'],
			sliced: new Set(['a']),
			sliceable: false,
			gatePass: true,
		},
	];

	for (const c of cases) {
		const label =
			`humanOnly=${String(c.humanOnly)} needsAnswers=${String(c.needsAnswers)} ` +
			`autoTask=${c.autoTask} ` +
			`briefAfter=${
				c.briefAfter.length === 0
					? 'none'
					: c.briefAfter.every((s) => c.sliced.has(s))
						? 'sliced'
						: 'unsliced'
			}`;
		it(`${label} → sliceable=${c.sliceable}`, () => {
			const r = resolveSlicingEligibility({
				humanOnly: c.humanOnly,
				needsAnswers: c.needsAnswers,
				briefAfter: c.briefAfter,
				slicedSlugs: c.sliced,
				autoTask: c.autoTask,
			});
			expect(r.sliceable).toBe(c.sliceable);
			expect(r.gatePass).toBe(c.gatePass);
		});
	}

	it('reports the unsliced PRDs when blocked by briefAfter', () => {
		const r = resolveSlicingEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			briefAfter: ['other'],
			slicedSlugs: new Set(),
			autoTask: true,
		});
		expect(r.briefAfter.satisfied).toBe(false);
		expect(r.briefAfter.missing).toEqual(['other']);
	});
});
