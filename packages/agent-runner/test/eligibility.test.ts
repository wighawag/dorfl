import {describe, it, expect} from 'vitest';
import {
	resolveAfkGate,
	resolveBlockedBy,
	resolveEligibility,
} from '../src/eligibility.js';

describe('resolveAfkGate', () => {
	it('afk: true is always eligible regardless of policy', () => {
		expect(resolveAfkGate(true, false)).toBe(true);
		expect(resolveAfkGate(true, true)).toBe(true);
	});

	it('afk: false is never eligible regardless of policy', () => {
		expect(resolveAfkGate(false, false)).toBe(false);
		expect(resolveAfkGate(false, true)).toBe(false);
	});

	it('unspecified depends on allowUnspecifiedGate', () => {
		expect(resolveAfkGate(undefined, false)).toBe(false);
		expect(resolveAfkGate(undefined, true)).toBe(true);
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

describe('resolveEligibility', () => {
	it('is eligible when gate passes AND blockers satisfied', () => {
		const r = resolveEligibility({
			afk: true,
			blockedBy: ['dep'],
			doneSlugs: new Set(['dep']),
			allowUnspecifiedGate: false,
		});
		expect(r.eligible).toBe(true);
		expect(r.afkPass).toBe(true);
		expect(r.blockedBy.satisfied).toBe(true);
	});

	it('is not eligible when gate fails even if blockers satisfied', () => {
		const r = resolveEligibility({
			afk: false,
			blockedBy: [],
			doneSlugs: new Set(),
			allowUnspecifiedGate: true,
		});
		expect(r.eligible).toBe(false);
		expect(r.afkPass).toBe(false);
	});

	it('is not eligible when blockers unsatisfied even if gate passes', () => {
		const r = resolveEligibility({
			afk: true,
			blockedBy: ['dep'],
			doneSlugs: new Set(),
			allowUnspecifiedGate: false,
		});
		expect(r.eligible).toBe(false);
		expect(r.blockedBy.satisfied).toBe(false);
		expect(r.blockedBy.missing).toEqual(['dep']);
	});

	it('honours allowUnspecifiedGate for omitted afk', () => {
		const strict = resolveEligibility({
			afk: undefined,
			blockedBy: [],
			doneSlugs: new Set(),
			allowUnspecifiedGate: false,
		});
		expect(strict.eligible).toBe(false);

		const permissive = resolveEligibility({
			afk: undefined,
			blockedBy: [],
			doneSlugs: new Set(),
			allowUnspecifiedGate: true,
		});
		expect(permissive.eligible).toBe(true);
	});
});
