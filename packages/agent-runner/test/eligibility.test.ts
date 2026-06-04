import {describe, it, expect} from 'vitest';
import {
	resolveGate,
	resolveBlockedBy,
	resolveEligibility,
} from '../src/eligibility.js';

describe('resolveGate — the humanOnly × allowAgents matrix', () => {
	it('humanOnly: true is never claimable regardless of allowAgents', () => {
		expect(resolveGate(true, false)).toBe(false);
		expect(resolveGate(true, true)).toBe(false);
	});

	it('undeclared (undefined) is claimable iff allowAgents is on', () => {
		expect(resolveGate(undefined, false)).toBe(false);
		expect(resolveGate(undefined, true)).toBe(true);
	});

	// An explicit `false` is treated as "not humanOnly" (undeclared), per the
	// binary model: the only meaningful declaration is `humanOnly: true`.
	it('humanOnly: false behaves like undeclared (claimable iff allowAgents)', () => {
		expect(resolveGate(false, false)).toBe(false);
		expect(resolveGate(false, true)).toBe(true);
	});
});

describe('resolveBlockedBy', () => {
	it('is satisfied when blocked_by is empty', () => {
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

describe('resolveEligibility — full matrix (humanOnly × allowAgents × deps)', () => {
	const cases: Array<{
		humanOnly: boolean | undefined;
		allowAgents: boolean;
		deps: string[];
		done: Set<string>;
		eligible: boolean;
		gatePass: boolean;
	}> = [
		// undeclared + allowAgents on + deps satisfied ⇒ eligible
		{
			humanOnly: undefined,
			allowAgents: true,
			deps: [],
			done: new Set(),
			eligible: true,
			gatePass: true,
		},
		// undeclared + allowAgents on + deps NOT satisfied ⇒ gate passes but blocked
		{
			humanOnly: undefined,
			allowAgents: true,
			deps: ['dep'],
			done: new Set(),
			eligible: false,
			gatePass: true,
		},
		// undeclared + allowAgents off ⇒ never (gate fails)
		{
			humanOnly: undefined,
			allowAgents: false,
			deps: [],
			done: new Set(),
			eligible: false,
			gatePass: false,
		},
		// humanOnly + allowAgents on ⇒ never (gate fails regardless)
		{
			humanOnly: true,
			allowAgents: true,
			deps: [],
			done: new Set(),
			eligible: false,
			gatePass: false,
		},
		// humanOnly + allowAgents off ⇒ never
		{
			humanOnly: true,
			allowAgents: false,
			deps: [],
			done: new Set(),
			eligible: false,
			gatePass: false,
		},
		// undeclared + allowAgents on + deps satisfied via done ⇒ eligible
		{
			humanOnly: undefined,
			allowAgents: true,
			deps: ['dep'],
			done: new Set(['dep']),
			eligible: true,
			gatePass: true,
		},
	];

	for (const c of cases) {
		const label =
			`humanOnly=${String(c.humanOnly)} allowAgents=${c.allowAgents} ` +
			`deps=${c.deps.length === 0 ? 'none' : c.done.size ? 'satisfied' : 'blocked'}`;
		it(`${label} → eligible=${c.eligible}`, () => {
			const r = resolveEligibility({
				humanOnly: c.humanOnly,
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
			blockedBy: ['dep'],
			doneSlugs: new Set(),
			allowAgents: true,
		});
		expect(r.blockedBy.satisfied).toBe(false);
		expect(r.blockedBy.missing).toEqual(['dep']);
	});
});
