import {describe, it, expect} from 'vitest';
import {formatReport, gateLabel} from '../src/format.js';
import type {ScanReport, ScannedItem} from '../src/scan.js';
import {resolveEligibility} from '../src/eligibility.js';

function item(
	slug: string,
	humanOnly: boolean | undefined,
	blockedBy: string[],
	doneSlugs: Set<string>,
	allowAgents: boolean,
	needsAnswers: boolean | undefined = undefined,
): ScannedItem {
	return {
		file: `${slug}.md`,
		slug,
		humanOnly,
		needsAnswers,
		blockedBy,
		eligibility: resolveEligibility({
			humanOnly,
			needsAnswers,
			blockedBy,
			doneSlugs,
			allowAgents,
		}),
	};
}

/** Build a needsAnswers (discovered axis) ScannedItem. */
function needsAnswersItem(
	slug: string,
	blockedBy: string[],
	doneSlugs: Set<string>,
	allowAgents: boolean,
): ScannedItem {
	return item(slug, undefined, blockedBy, doneSlugs, allowAgents, true);
}

/** Build a one-repo report, computing eligibility totals like scan() does. */
function reportOf(items: ScannedItem[], path = '/repos/alpha'): ScanReport {
	return {
		repos: [{path, items}],
		totalItems: items.length,
		totalEligible: items.filter((i) => i.eligibility.eligible).length,
	};
}

describe('gateLabel', () => {
	it('labels the two autonomy axes with distinct reasons', () => {
		expect(gateLabel(true)).toBe('human-only');
		expect(gateLabel(undefined)).toBe('undeclared');
		expect(gateLabel(false)).toBe('undeclared');
		expect(gateLabel(undefined, true)).toBe('needs-answers');
		expect(gateLabel(false, true)).toBe('needs-answers');
		// humanOnly takes precedence so the decided reason is shown first.
		expect(gateLabel(true, true)).toBe('human-only');
	});
});

describe('formatReport — grouped dashboard', () => {
	it('shows all four group labels under each repo', () => {
		const out = formatReport(
			reportOf([item('a', undefined, [], new Set(), true)]),
		);
		expect(out).toContain('/repos/alpha');
		expect(out).toContain('Agent-claimable now');
		expect(out).toContain('Human-only');
		expect(out).toContain('Needs answers');
		expect(out).toContain('Blocked');
	});

	it('places needsAnswers items under Needs answers (distinct from Human-only)', () => {
		const out = formatReport(
			reportOf([needsAnswersItem('open-q', [], new Set(), false)]),
		);
		const naIdx = out.indexOf('Needs answers');
		const slugIdx = out.indexOf('open-q');
		expect(naIdx).toBeGreaterThanOrEqual(0);
		expect(slugIdx).toBeGreaterThan(naIdx);
		// gated like human-only: never eligible regardless of policy.
		expect(out).toContain('0/1 item(s) eligible now');
	});

	it('renders empty groups as (none)', () => {
		const out = formatReport(
			reportOf([item('a', undefined, [], new Set(), true)]),
		);
		expect(out).toContain('(none)');
	});

	it('places humanOnly items under Human-only', () => {
		const out = formatReport(
			reportOf([item('judge-call', true, [], new Set(), false)]),
		);
		const humanIdx = out.indexOf('Human-only');
		const slugIdx = out.indexOf('judge-call');
		expect(humanIdx).toBeGreaterThanOrEqual(0);
		expect(slugIdx).toBeGreaterThan(humanIdx);
	});

	it('places undeclared deps-satisfied items under Agent-claimable with a flag hint', () => {
		const out = formatReport(
			reportOf([item('maybe', undefined, [], new Set(), false)]),
		);
		expect(out).toContain('Agent-claimable now');
		expect(out).toContain('--allow-agents');
	});

	it('places undeclared blocked items under Blocked', () => {
		const out = formatReport(
			reportOf([item('waiting', undefined, ['dep'], new Set(), true)]),
		);
		const blockedIdx = out.indexOf('Blocked (');
		const slugIdx = out.indexOf('waiting');
		expect(blockedIdx).toBeGreaterThanOrEqual(0);
		expect(slugIdx).toBeGreaterThan(blockedIdx);
	});

	it('shows readiness per item: satisfied vs waiting on', () => {
		const out = formatReport(
			reportOf([
				item('ready', undefined, [], new Set(), true),
				item('blocked', undefined, ['dep'], new Set(), true),
			]),
		);
		expect(out).toContain('deps: satisfied');
		expect(out).toContain('waiting on dep');
	});

	it('shows the SAME groups regardless of --allow-agents', () => {
		const items = [
			item('claimable', undefined, [], new Set(), false),
			item('human', true, [], new Set(), false),
			item('blocked', undefined, ['dep'], new Set(), false),
		];
		const permissiveItems = [
			item('claimable', undefined, [], new Set(), true),
			item('human', true, [], new Set(), true),
			item('blocked', undefined, ['dep'], new Set(), true),
		];
		const groupsOnly = (out: string) =>
			out
				.split('\n')
				.filter((l) => !l.startsWith('Runner verdict:'))
				.join('\n');
		const strict = groupsOnly(formatReport(reportOf(items)));
		const permissive = groupsOnly(formatReport(reportOf(permissiveItems)));
		expect(permissive).toBe(strict);
	});

	it('summary reports per-category totals and ready counts', () => {
		const out = formatReport(
			reportOf([
				item('c1', undefined, [], new Set(), true),
				item('b1', undefined, ['dep'], new Set(), true),
				item('m1', true, [], new Set(), true),
				needsAnswersItem('na1', [], new Set(), true),
			]),
		);
		expect(out).toContain('4 item(s) across 1 repo');
		expect(out).toContain('1 agent-claimable');
		expect(out).toContain('1 human-only');
		expect(out).toContain('1 needs-answers');
		expect(out).toContain('1 blocked');
		expect(out).toContain('3 ready');
	});

	it('verdict count reflects the allowAgents policy for undeclared items', () => {
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
