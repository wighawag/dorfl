import {describe, it, expect} from 'vitest';
import {formatReport, afkLabel} from '../src/format.js';
import type {ScanReport, ScannedItem} from '../src/scan.js';
import {resolveEligibility} from '../src/eligibility.js';

function item(
	slug: string,
	afk: boolean | undefined,
	blockedBy: string[],
	doneSlugs: Set<string>,
	allowUnspecifiedGate: boolean,
): ScannedItem {
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

/** Build a one-repo report, computing eligibility totals like scan() does. */
function reportOf(items: ScannedItem[], path = '/repos/alpha'): ScanReport {
	return {
		repos: [{path, items}],
		totalItems: items.length,
		totalEligible: items.filter((i) => i.eligibility.eligible).length,
	};
}

describe('afkLabel', () => {
	it('labels the three gate states', () => {
		expect(afkLabel(true)).toBe('true');
		expect(afkLabel(false)).toBe('false');
		expect(afkLabel(undefined)).toBe('unspecified');
	});
});

describe('formatReport — grouped dashboard', () => {
	it('shows all three group labels under each repo', () => {
		const out = formatReport(reportOf([item('a', true, [], new Set(), false)]));
		expect(out).toContain('/repos/alpha');
		expect(out).toContain('Runner-eligible now');
		expect(out).toContain('Claimable if allowed');
		expect(out).toContain('Human-only');
	});

	it('renders empty groups as (none)', () => {
		// only a runner-eligible item → if-allowed and human-only are empty.
		const out = formatReport(reportOf([item('a', true, [], new Set(), false)]));
		expect(out).toContain('(none)');
	});

	it('places afk:false items under Human-only', () => {
		const out = formatReport(
			reportOf([item('human', false, [], new Set(), false)]),
		);
		const humanIdx = out.indexOf('Human-only');
		const slugIdx = out.indexOf('human');
		expect(humanIdx).toBeGreaterThanOrEqual(0);
		expect(slugIdx).toBeGreaterThan(humanIdx);
	});

	it('places unspecified-gate items under Claimable if allowed with a flag hint', () => {
		const out = formatReport(
			reportOf([item('maybe', undefined, [], new Set(), false)]),
		);
		expect(out).toContain('Claimable if allowed');
		expect(out).toContain('--allow-unspecified-gate');
	});

	it('shows readiness per item: satisfied vs waiting on', () => {
		const out = formatReport(
			reportOf([
				item('ready', true, [], new Set(), false),
				item('blocked', true, ['dep'], new Set(), false),
			]),
		);
		expect(out).toContain('deps: satisfied');
		expect(out).toContain('waiting on dep');
	});

	it('sorts ready items above blocked ones within a group', () => {
		const out = formatReport(
			reportOf([
				item('blocked', true, ['dep'], new Set(), false),
				item('ready', true, [], new Set(), false),
			]),
		);
		expect(out.indexOf('ready')).toBeLessThan(out.indexOf('blocked'));
	});

	it('shows the SAME groups regardless of --allow-unspecified-gate', () => {
		const items = [
			item('runner', true, [], new Set(), false),
			item('maybe', undefined, [], new Set(), false),
			item('human', false, [], new Set(), false),
		];
		const permissiveItems = [
			item('runner', true, [], new Set(), true),
			item('maybe', undefined, [], new Set(), true),
			item('human', false, [], new Set(), true),
		];
		// Strip the verdict line (which legitimately changes with the flag) and
		// compare the rest (the grouped sections).
		const groupsOnly = (out: string) =>
			out
				.split('\n')
				.filter((l) => !l.startsWith('Runner verdict:'))
				.join('\n');
		const strict = groupsOnly(formatReport(reportOf(items)));
		const permissive = groupsOnly(formatReport(reportOf(permissiveItems)));
		expect(permissive).toBe(strict);
	});

	it('summary reports per-category totals and ready/blocked counts', () => {
		const out = formatReport(
			reportOf([
				item('r1', true, [], new Set(), false),
				item('r2', true, ['dep'], new Set(), false),
				item('m1', undefined, [], new Set(), false),
				item('h1', false, [], new Set(), false),
			]),
		);
		expect(out).toContain('4 item(s) across 1 repo');
		expect(out).toContain('2 runner-eligible');
		expect(out).toContain('1 if-allowed');
		expect(out).toContain('1 human-only');
		expect(out).toContain('3 ready');
		expect(out).toContain('1 blocked');
	});

	it('verdict count reflects the flag for unspecified-gate items', () => {
		// One unspecified-gate, deps satisfied. Strict ⇒ 0 eligible; permissive ⇒ 1.
		const strict = formatReport(
			reportOf([item('maybe', undefined, [], new Set(), false)]),
		);
		const permissive = formatReport(
			reportOf([item('maybe', undefined, [], new Set(), true)]),
		);
		expect(strict).toContain('0/1 item(s) eligible now');
		expect(permissive).toContain('1/1 item(s) eligible now');
	});

	it('handles an empty report gracefully', () => {
		const out = formatReport({repos: [], totalItems: 0, totalEligible: 0});
		expect(typeof out).toBe('string');
		expect(out.length).toBeGreaterThan(0);
		expect(out).toContain('No participating repos found.');
	});
});
