import {describe, it, expect} from 'vitest';
import {selectCandidates} from '../src/select.js';
import type {ScanReport, ScannedItem} from '../src/scan.js';

function item(slug: string, eligible: boolean): ScannedItem {
	return {
		file: `${slug}.md`,
		slug,
		afk: eligible ? true : false,
		blockedBy: [],
		eligibility: {
			eligible,
			afkPass: eligible,
			blockedBy: {satisfied: true, missing: []},
		},
	};
}

function report(
	repos: Array<{path: string; items: ScannedItem[]}>,
): ScanReport {
	let totalItems = 0;
	let totalEligible = 0;
	for (const r of repos) {
		for (const it of r.items) {
			totalItems++;
			if (it.eligibility.eligible) totalEligible++;
		}
	}
	return {repos, totalItems, totalEligible};
}

describe('selectCandidates', () => {
	it('selects only eligible items', () => {
		const r = report([
			{
				path: '/repo',
				items: [item('a', true), item('b', false), item('c', true)],
			},
		]);
		const picks = selectCandidates(r, {maxParallel: 10, perRepoMax: 10});
		expect(picks.map((p) => p.slug)).toEqual(['a', 'c']);
	});

	it('caps the total at maxParallel', () => {
		const r = report([
			{
				path: '/repo',
				items: [item('a', true), item('b', true), item('c', true)],
			},
		]);
		const picks = selectCandidates(r, {maxParallel: 2, perRepoMax: 10});
		expect(picks).toHaveLength(2);
	});

	it('caps per repo at perRepoMax', () => {
		const r = report([
			{
				path: '/repo-a',
				items: [item('a1', true), item('a2', true), item('a3', true)],
			},
			{path: '/repo-b', items: [item('b1', true)]},
		]);
		const picks = selectCandidates(r, {maxParallel: 10, perRepoMax: 2});
		const fromA = picks.filter((p) => p.repoPath === '/repo-a');
		expect(fromA).toHaveLength(2);
		const fromB = picks.filter((p) => p.repoPath === '/repo-b');
		expect(fromB).toHaveLength(1);
	});

	it('respects maxParallel across repos (round-robin fairness, not all from one repo)', () => {
		const r = report([
			{
				path: '/repo-a',
				items: [item('a1', true), item('a2', true), item('a3', true)],
			},
			{
				path: '/repo-b',
				items: [item('b1', true), item('b2', true), item('b3', true)],
			},
		]);
		const picks = selectCandidates(r, {maxParallel: 2, perRepoMax: 10});
		expect(picks).toHaveLength(2);
		// fairness: one from each repo rather than two from repo-a
		const repos = new Set(picks.map((p) => p.repoPath));
		expect(repos.size).toBe(2);
	});

	it('never crosses caps when perRepoMax exceeds maxParallel', () => {
		const r = report([
			{
				path: '/repo',
				items: [item('a', true), item('b', true), item('c', true)],
			},
		]);
		const picks = selectCandidates(r, {maxParallel: 1, perRepoMax: 5});
		expect(picks).toHaveLength(1);
	});

	it('returns empty when nothing is eligible', () => {
		const r = report([{path: '/repo', items: [item('a', false)]}]);
		expect(selectCandidates(r, {maxParallel: 4, perRepoMax: 2})).toEqual([]);
	});

	it('carries the repo path and slug for each candidate', () => {
		const r = report([{path: '/repo', items: [item('a', true)]}]);
		const picks = selectCandidates(r, {maxParallel: 4, perRepoMax: 2});
		expect(picks[0]).toEqual({repoPath: '/repo', slug: 'a'});
	});
});
