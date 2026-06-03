import {describe, it, expect} from 'vitest';
import {formatReport, afkLabel} from '../src/format.js';
import type {ScanReport} from '../src/scan.js';
import {resolveEligibility} from '../src/eligibility.js';

function item(
	slug: string,
	afk: boolean | undefined,
	blockedBy: string[],
	doneSlugs: Set<string>,
	allowUnspecifiedGate: boolean,
) {
	return {
		file: `${slug}.md`,
		slug,
		afk,
		blockedBy,
		eligibility: resolveEligibility({
			afk,
			blockedBy,
			doneSlugs,
			allowUnspecifiedGate,
		}),
	};
}

describe('afkLabel', () => {
	it('labels the three gate states', () => {
		expect(afkLabel(true)).toBe('true');
		expect(afkLabel(false)).toBe('false');
		expect(afkLabel(undefined)).toBe('unspecified');
	});
});

describe('formatReport', () => {
	it('shows repo, slug, afk, blocked-by and eligible for each item', () => {
		const report: ScanReport = {
			repos: [
				{
					path: '/repos/alpha',
					items: [item('ready', true, [], new Set(), false)],
				},
			],
			totalItems: 1,
			totalEligible: 1,
		};
		const out = formatReport(report);
		expect(out).toContain('/repos/alpha');
		expect(out).toContain('ready');
		expect(out).toContain('true');
		// eligible marker present
		expect(out.toLowerCase()).toContain('eligible');
	});

	it('reports missing blockers in the output', () => {
		const report: ScanReport = {
			repos: [
				{
					path: '/repos/alpha',
					items: [item('needs', true, ['dep'], new Set(), false)],
				},
			],
			totalItems: 1,
			totalEligible: 0,
		};
		const out = formatReport(report);
		expect(out).toContain('dep');
	});

	it('handles an empty report gracefully', () => {
		const report: ScanReport = {repos: [], totalItems: 0, totalEligible: 0};
		const out = formatReport(report);
		expect(typeof out).toBe('string');
		expect(out.length).toBeGreaterThan(0);
	});

	it('includes a summary line with totals', () => {
		const report: ScanReport = {
			repos: [
				{
					path: '/repos/alpha',
					items: [
						item('a', true, [], new Set(), false),
						item('b', false, [], new Set(), false),
					],
				},
			],
			totalItems: 2,
			totalEligible: 1,
		};
		const out = formatReport(report);
		expect(out).toContain('2');
		expect(out).toContain('1');
	});
});
