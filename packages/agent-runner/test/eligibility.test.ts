import {describe, it, expect} from 'vitest';
import {
	resolveGate,
	resolveBlockedBy,
	resolveEligibility,
} from '../src/eligibility.js';

describe('resolveGate — the humanOnly × needsAnswers × allowAgents matrix', () => {
	it('humanOnly: true is never claimable regardless of allowAgents', () => {
		expect(resolveGate(true, undefined, false)).toBe(false);
		expect(resolveGate(true, undefined, true)).toBe(false);
	});

	it('needsAnswers: true is never claimable regardless of allowAgents', () => {
		expect(resolveGate(undefined, true, false)).toBe(false);
		expect(resolveGate(undefined, true, true)).toBe(false);
	});

	it('either axis alone blocks (orthogonal); both set still blocks', () => {
		expect(resolveGate(true, true, true)).toBe(false);
		expect(resolveGate(true, false, true)).toBe(false);
		expect(resolveGate(false, true, true)).toBe(false);
	});

	it('undeclared on both axes is claimable iff allowAgents is on', () => {
		expect(resolveGate(undefined, undefined, false)).toBe(false);
		expect(resolveGate(undefined, undefined, true)).toBe(true);
	});

	// An explicit `false` on either axis is treated as "not gated" (undeclared),
	// per the binary model: the only meaningful declaration is `true`.
	it('explicit false on both axes behaves like undeclared (claimable iff allowAgents)', () => {
		expect(resolveGate(false, false, false)).toBe(false);
		expect(resolveGate(false, false, true)).toBe(true);
	});
});

describe('resolveBlockedBy', () => {
	it('is satisfied when blockedBy is empty', () => {
		const r = resolveBlockedBy([], new Set());
		expect(r.satisfied).toBe(true);
		expect(r.missing).toEqual([]);
	});

	it('is satisfied when every blocker is present in done', () => {
		const r = resolveBlockedBy(['a', 'b'], new Set(['a', 'b', 'c']));
		expect(r.satisfied).toBe(true);
		expect(r.missing).toEqual([]);
	});

	it('is unsatisfied and reports the missing blockers', () => {
		const r = resolveBlockedBy(['a', 'b'], new Set(['a']));
		expect(r.satisfied).toBe(false);
		expect(r.missing).toEqual(['b']);
	});

	it('reports all missing when none are done', () => {
		const r = resolveBlockedBy(['a', 'b'], new Set());
		expect(r.satisfied).toBe(false);
		expect(r.missing).toEqual(['a', 'b']);
	});
});

describe('resolveEligibility — full matrix (humanOnly × needsAnswers × allowAgents × deps)', () => {
	const cases: Array<{
		humanOnly: boolean | undefined;
		needsAnswers: boolean | undefined;
		allowAgents: boolean;
		deps: string[];
		done: Set<string>;
		eligible: boolean;
		gatePass: boolean;
	}> = [
		// undeclared + allowAgents on + deps satisfied ⇒ eligible
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			allowAgents: true,
			deps: [],
			done: new Set(),
			eligible: true,
			gatePass: true,
		},
		// undeclared + allowAgents on + deps NOT satisfied ⇒ gate passes but blocked
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			allowAgents: true,
			deps: ['dep'],
			done: new Set(),
			eligible: false,
			gatePass: true,
		},
		// undeclared + allowAgents off ⇒ never (gate fails)
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			allowAgents: false,
			deps: [],
			done: new Set(),
			eligible: false,
			gatePass: false,
		},
		// humanOnly + allowAgents on ⇒ never (gate fails regardless)
		{
			humanOnly: true,
			needsAnswers: undefined,
			allowAgents: true,
			deps: [],
			done: new Set(),
			eligible: false,
			gatePass: false,
		},
		// needsAnswers + allowAgents on ⇒ never (the discovered axis blocks)
		{
			humanOnly: undefined,
			needsAnswers: true,
			allowAgents: true,
			deps: [],
			done: new Set(),
			eligible: false,
			gatePass: false,
		},
		// needsAnswers blocks independently of humanOnly (humanOnly false)
		{
			humanOnly: false,
			needsAnswers: true,
			allowAgents: true,
			deps: [],
			done: new Set(),
			eligible: false,
			gatePass: false,
		},
		// both axes set + allowAgents on ⇒ never
		{
			humanOnly: true,
			needsAnswers: true,
			allowAgents: true,
			deps: [],
			done: new Set(),
			eligible: false,
			gatePass: false,
		},
		// humanOnly + allowAgents off ⇒ never
		{
			humanOnly: true,
			needsAnswers: undefined,
			allowAgents: false,
			deps: [],
			done: new Set(),
			eligible: false,
			gatePass: false,
		},
		// undeclared + allowAgents on + deps satisfied via done ⇒ eligible
		{
			humanOnly: undefined,
			needsAnswers: undefined,
			allowAgents: true,
			deps: ['dep'],
			done: new Set(['dep']),
			eligible: true,
			gatePass: true,
		},
	];

	for (const c of cases) {
		const label =
			`humanOnly=${String(c.humanOnly)} needsAnswers=${String(c.needsAnswers)} ` +
			`allowAgents=${c.allowAgents} ` +
			`deps=${c.deps.length === 0 ? 'none' : c.done.size ? 'satisfied' : 'blocked'}`;
		it(`${label} → eligible=${c.eligible}`, () => {
			const r = resolveEligibility({
				humanOnly: c.humanOnly,
				needsAnswers: c.needsAnswers,
				blockedBy: c.deps,
				doneSlugs: c.done,
				allowAgents: c.allowAgents,
			});
			expect(r.eligible).toBe(c.eligible);
			expect(r.gatePass).toBe(c.gatePass);
		});
	}

	it('reports missing blockers when blocked', () => {
		const r = resolveEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			blockedBy: ['dep'],
			doneSlugs: new Set(),
			allowAgents: true,
		});
		expect(r.blockedBy.satisfied).toBe(false);
		expect(r.blockedBy.missing).toEqual(['dep']);
	});
});
