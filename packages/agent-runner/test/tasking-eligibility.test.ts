import {describe, it, expect} from 'vitest';
import {
	resolveTaskGate,
	resolveTaskAfter,
	resolveTaskingEligibility,
} from '../src/tasking-eligibility.js';

describe('resolveTaskGate — the humanOnly × needsAnswers × autoTask matrix', () => {
	it('humanOnly: true is never agent-taskable regardless of autoTask', () => {
		expect(resolveTaskGate(true, undefined, false)).toBe(false);
		expect(resolveTaskGate(true, undefined, true)).toBe(false);
	});

	it('needsAnswers: true is never agent-taskable regardless of autoTask', () => {
		expect(resolveTaskGate(undefined, true, false)).toBe(false);
		expect(resolveTaskGate(undefined, true, true)).toBe(false);
	});

	it('either axis alone blocks (orthogonal); both set still blocks', () => {
		expect(resolveTaskGate(true, true, true)).toBe(false);
		expect(resolveTaskGate(true, false, true)).toBe(false);
		expect(resolveTaskGate(false, true, true)).toBe(false);
	});

	it('undeclared on both axes is taskable iff autoTask is on', () => {
		expect(resolveTaskGate(undefined, undefined, false)).toBe(false);
		expect(resolveTaskGate(undefined, undefined, true)).toBe(true);
	});

	// An explicit `false` on either axis is treated as "not gated" (undeclared),
	// per the binary model: the only meaningful declaration is `true`.
	it('explicit false on both axes behaves like undeclared (taskable iff autoTask)', () => {
		expect(resolveTaskGate(false, false, false)).toBe(false);
		expect(resolveTaskGate(false, false, true)).toBe(true);
	});

	// The full truth table: all four humanOnly×needsAnswers states × autoTask on/off.
	const axisStates: Array<boolean | undefined> = [undefined, false, true];
	for (const humanOnly of axisStates) {
		for (const needsAnswers of axisStates) {
			for (const autoTask of [false, true]) {
				const gated = humanOnly === true || needsAnswers === true;
				const expected = gated ? false : autoTask;
				it(`humanOnly=${String(humanOnly)} needsAnswers=${String(needsAnswers)} autoTask=${autoTask} → ${expected}`, () => {
					expect(resolveTaskGate(humanOnly, needsAnswers, autoTask)).toBe(
						expected,
					);
				});
			}
		}
	}
});

describe('resolveTaskGate — explicit naming satisfies the autoTask policy term', () => {
	// `explicit: true` mirrors `do <task>` building regardless of `autoBuild`:
	// naming the prd IS the authorization, so the `autoTask` policy term drops.
	it('explicit + autoTask OFF is taskable (the policy term is satisfied by naming)', () => {
		expect(resolveTaskGate(undefined, undefined, false, true)).toBe(true);
	});

	it('explicit defaults false (the pool path) ⇒ autoTask still gates', () => {
		expect(resolveTaskGate(undefined, undefined, false)).toBe(false);
		expect(resolveTaskGate(undefined, undefined, false, false)).toBe(false);
	});

	it('explicit does NOT override the readiness axes (humanOnly / needsAnswers still block)', () => {
		expect(resolveTaskGate(true, undefined, false, true)).toBe(false);
		expect(resolveTaskGate(undefined, true, false, true)).toBe(false);
		expect(resolveTaskGate(true, true, true, true)).toBe(false);
	});

	it('explicit is harmless when autoTask is already on (both authorize)', () => {
		expect(resolveTaskGate(undefined, undefined, true, true)).toBe(true);
	});
});

describe('resolveTaskingEligibility — explicit drops the policy term but keeps prdAfter', () => {
	it('explicit + autoTask OFF + no prdAfter ⇒ taskable', () => {
		const r = resolveTaskingEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			prdAfter: [],
			taskedSlugs: new Set(),
			autoTask: false,
			explicit: true,
		});
		expect(r.taskable).toBe(true);
		expect(r.gatePass).toBe(true);
	});

	it('explicit + autoTask OFF but an UNTASKED prdAfter ⇒ gate passes, still blocked', () => {
		const r = resolveTaskingEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			prdAfter: ['other'],
			taskedSlugs: new Set(),
			autoTask: false,
			explicit: true,
		});
		expect(r.gatePass).toBe(true);
		expect(r.taskable).toBe(false);
		expect(r.prdAfter.missing).toEqual(['other']);
	});

	it('explicit + humanOnly ⇒ never (the readiness axis binds)', () => {
		const r = resolveTaskingEligibility({
			humanOnly: true,
			needsAnswers: undefined,
			prdAfter: [],
			taskedSlugs: new Set(),
			autoTask: false,
			explicit: true,
		});
		expect(r.gatePass).toBe(false);
		expect(r.taskable).toBe(false);
	});
});

describe('resolveTaskAfter — against `work/prds/tasked/` residence (not done/)', () => {
	it('is satisfied when prdAfter is empty', () => {
		const r = resolveTaskAfter([], new Set());
		expect(r.satisfied).toBe(true);
		expect(r.missing).toEqual([]);
	});

	it('is satisfied when every listed PRD is already tasked', () => {
		const r = resolveTaskAfter(['a', 'b'], new Set(['a', 'b', 'c']));
		expect(r.satisfied).toBe(true);
		expect(r.missing).toEqual([]);
	});

	it('is unsatisfied and reports the untasked PRDs', () => {
		const r = resolveTaskAfter(['a', 'b'], new Set(['a']));
		expect(r.satisfied).toBe(false);
		expect(r.missing).toEqual(['b']);
	});

	it('reports all missing when none are tasked', () => {
		const r = resolveTaskAfter(['a', 'b'], new Set());
		expect(r.satisfied).toBe(false);
		expect(r.missing).toEqual(['a', 'b']);
	});

	it('preserves declaration order in the missing list', () => {
		const r = resolveTaskAfter(['z', 'a', 'm'], new Set(['a']));
		expect(r.missing).toEqual(['z', 'm']);
	});
});

describe('resolveTaskingEligibility — gate × prdAfter (tasked-vs-untasked fixtures)', () => {
	const cases: Array<{
		humanOnly: boolean | undefined;
		needsAnswers: boolean | undefined;
		autoTask: boolean;
		prdAfter: string[];
		tasked: Set<string>;
		taskable: boolean;
		gatePass: boolean;
	}> = [
		// undeclared + autoTask on + no prdAfter ⇒ taskable
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: true,
			prdAfter: [],
			tasked: new Set(),
			taskable: true,
			gatePass: true,
		},
		// undeclared + autoTask on + an UNTASKED blocker ⇒ gate passes but blocked
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: true,
			prdAfter: ['other'],
			tasked: new Set(),
			taskable: false,
			gatePass: true,
		},
		// undeclared + autoTask on + the blocker IS tasked ⇒ taskable
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: true,
			prdAfter: ['other'],
			tasked: new Set(['other']),
			taskable: true,
			gatePass: true,
		},
		// undeclared + autoTask off ⇒ never (gate fails)
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: false,
			prdAfter: [],
			tasked: new Set(),
			taskable: false,
			gatePass: false,
		},
		// humanOnly + autoTask on ⇒ never (gate fails regardless of prdAfter)
		{
			humanOnly: true,
			needsAnswers: undefined,
			autoTask: true,
			prdAfter: ['other'],
			tasked: new Set(['other']),
			taskable: false,
			gatePass: false,
		},
		// needsAnswers + autoTask on ⇒ never (the discovered axis blocks)
		{
			humanOnly: undefined,
			needsAnswers: true,
			autoTask: true,
			prdAfter: [],
			tasked: new Set(),
			taskable: false,
			gatePass: false,
		},
		// needsAnswers blocks independently of humanOnly (humanOnly false)
		{
			humanOnly: false,
			needsAnswers: true,
			autoTask: true,
			prdAfter: [],
			tasked: new Set(),
			taskable: false,
			gatePass: false,
		},
		// both axes set + autoTask on ⇒ never
		{
			humanOnly: true,
			needsAnswers: true,
			autoTask: true,
			prdAfter: [],
			tasked: new Set(),
			taskable: false,
			gatePass: false,
		},
		// humanOnly + autoTask off ⇒ never
		{
			humanOnly: true,
			needsAnswers: undefined,
			autoTask: false,
			prdAfter: [],
			tasked: new Set(),
			taskable: false,
			gatePass: false,
		},
		// multiple prdAfter, one untasked ⇒ blocked though gate passes
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			autoTask: true,
			prdAfter: ['a', 'b'],
			tasked: new Set(['a']),
			taskable: false,
			gatePass: true,
		},
	];

	for (const c of cases) {
		const label =
			`humanOnly=${String(c.humanOnly)} needsAnswers=${String(c.needsAnswers)} ` +
			`autoTask=${c.autoTask} ` +
			`prdAfter=${
				c.prdAfter.length === 0
					? 'none'
					: c.prdAfter.every((s) => c.tasked.has(s))
						? 'tasked'
						: 'untasked'
			}`;
		it(`${label} → taskable=${c.taskable}`, () => {
			const r = resolveTaskingEligibility({
				humanOnly: c.humanOnly,
				needsAnswers: c.needsAnswers,
				prdAfter: c.prdAfter,
				taskedSlugs: c.tasked,
				autoTask: c.autoTask,
			});
			expect(r.taskable).toBe(c.taskable);
			expect(r.gatePass).toBe(c.gatePass);
		});
	}

	it('reports the untasked PRDs when blocked by prdAfter', () => {
		const r = resolveTaskingEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			prdAfter: ['other'],
			taskedSlugs: new Set(),
			autoTask: true,
		});
		expect(r.prdAfter.satisfied).toBe(false);
		expect(r.prdAfter.missing).toEqual(['other']);
	});
});
