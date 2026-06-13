import {describe, it, expect} from 'vitest';
import {
	selectPrioritised,
	sliceablePrds,
	type PrdCandidate,
	type SelectedLifecyclePools,
} from '../src/select-priority.js';
import {selectCandidates} from '../src/select.js';
import type {ScanReport, ScannedItem} from '../src/scan.js';

/**
 * The SHARED, PURE two-pool selection helper (`do-autopick`, ADR §3): eligible
 * SLICES first, then SLICEABLE PRDs (a per-repo toggle flips it), bounded by a
 * COUNT, SEQUENTIAL. The slice pool is selected via the EXISTING
 * `selectCandidates` (the primitive `run` shares), so this file ALSO pins that
 * the helper's slice ordering IS `selectCandidates`'s output.
 */

function sliceItem(slug: string, eligible: boolean): ScannedItem {
	return {
		file: `${slug}.md`,
		slug,
		humanOnly: eligible ? undefined : true,
		blockedBy: [],
		eligibility: {
			eligible,
			gatePass: eligible,
			blockedBy: {satisfied: true, missing: []},
		},
	};
}

function report(path: string, items: ScannedItem[]): ScanReport {
	const totalEligible = items.filter((i) => i.eligibility.eligible).length;
	return {repos: [{path, items}], totalItems: items.length, totalEligible};
}

const CAPS = {maxParallel: 100, perRepoMax: 100};

function prd(slug: string, extra: Partial<PrdCandidate> = {}): PrdCandidate {
	return {
		repoPath: '/repo',
		slug,
		humanOnly: undefined,
		needsAnswers: undefined,
		sliceAfter: [],
		...extra,
	};
}

describe('sliceablePrds — consumes autoslice-gate predicate (not reinvented)', () => {
	it('keeps only PRDs the gate passes (autoSlice on, not humanOnly/needsAnswers)', () => {
		const candidates = [
			prd('ok'),
			prd('human', {humanOnly: true}),
			prd('asks', {needsAnswers: true}),
		];
		const out = sliceablePrds({
			candidates,
			slicedSlugs: new Set(),
			autoSlice: true,
		});
		expect(out.map((p) => p.slug)).toEqual(['ok']);
	});

	it('autoSlice off ⇒ nothing is sliceable (mirrors autoBuild off)', () => {
		const out = sliceablePrds({
			candidates: [prd('ok')],
			slicedSlugs: new Set(),
			autoSlice: false,
		});
		expect(out).toEqual([]);
	});

	it('sliceAfter gates against the SLICED markers, not done/', () => {
		const candidates = [prd('beta', {sliceAfter: ['alpha']})];
		// alpha not yet sliced ⇒ beta not sliceable.
		expect(
			sliceablePrds({candidates, slicedSlugs: new Set(), autoSlice: true}),
		).toEqual([]);
		// alpha sliced ⇒ beta becomes sliceable.
		expect(
			sliceablePrds({
				candidates,
				slicedSlugs: new Set(['alpha']),
				autoSlice: true,
			}).map((p) => p.slug),
		).toEqual(['beta']);
	});
});

describe('selectPrioritised — slices-first, then PRDs-to-slice', () => {
	it('auto-pick (count 1) picks the FIRST eligible slice when slices exist', () => {
		const r = report('/repo', [sliceItem('a', true), sliceItem('b', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			count: 1,
		});
		expect(picked).toEqual([
			{repoPath: '/repo', slug: 'a', namespace: 'slice'},
		]);
	});

	it('auto-pick falls through to a PRD when NO slice is eligible', () => {
		const r = report('/repo', [sliceItem('a', false)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1'), prd('p2')],
			count: 1,
		});
		expect(picked).toEqual([{repoPath: '/repo', slug: 'p1', namespace: 'prd'}]);
	});

	it('orders ALL slices before ANY PRD (drain ready work first)', () => {
		const r = report('/repo', [sliceItem('a', true), sliceItem('b', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1'), prd('p2')],
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'slice:a',
			'slice:b',
			'prd:p1',
			'prd:p2',
		]);
	});

	it('-n <x> takes x across both pools in priority order (sequential bound)', () => {
		const r = report('/repo', [sliceItem('a', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1'), prd('p2')],
			count: 2,
		});
		// one slice drains, then the first PRD.
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'slice:a',
			'prd:p1',
		]);
	});

	it('count larger than the pools returns everything available (no padding)', () => {
		const r = report('/repo', [sliceItem('a', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			count: 99,
		});
		expect(picked).toHaveLength(2);
	});

	it('returns empty when nothing is eligible in either pool', () => {
		const r = report('/repo', [sliceItem('a', false)]);
		expect(
			selectPrioritised({report: r, caps: CAPS, prds: [], count: 1}),
		).toEqual([]);
	});
});

describe('selectPrioritised — per-repo toggle FLIPS the order', () => {
	it('prdsFirst=true puts PRDs-to-slice BEFORE eligible slices', () => {
		const r = report('/repo', [sliceItem('a', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			prdsFirst: true,
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'prd:p1',
			'slice:a',
		]);
	});

	it('prdsFirst flips which item auto-pick (count 1) takes', () => {
		const r = report('/repo', [sliceItem('a', true)]);
		const slicesFirst = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			count: 1,
		});
		const prdsFirst = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			prdsFirst: true,
			count: 1,
		});
		expect(slicesFirst[0]).toMatchObject({namespace: 'slice', slug: 'a'});
		expect(prdsFirst[0]).toMatchObject({namespace: 'prd', slug: 'p1'});
	});
});

describe('selectPrioritised — the LIFECYCLE pools (advance-autopick-lifecycle-pools)', () => {
	function lifecycle(
		over: Partial<SelectedLifecyclePools> = {},
	): SelectedLifecyclePools {
		return {apply: [], surface: [], triage: [], ...over};
	}

	it('DEFAULTS to none — `do`-shaped calls (no `lifecycle`) select ONLY slices + PRDs (F-SHARE)', () => {
		// This is the `do` auto-pick shape: no lifecycle pools passed. Proves the
		// widening is backward-compatible — `do` never selects an observation or a
		// needsAnswers item.
		const r = report('/repo', [sliceItem('a', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'slice:a',
			'prd:p1',
		]);
		expect(picked.some((s) => s.namespace === 'observation')).toBe(false);
	});

	it('orders the FOUR pools: buildable (slices → PRDs) FIRST, then lifecycle (apply → surface → triage)', () => {
		const r = report('/repo', [sliceItem('s', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p')],
			lifecycle: lifecycle({
				apply: [{repoPath: '/repo', slug: 'ap', namespace: 'slice'}],
				surface: [{repoPath: '/repo', slug: 'su', namespace: 'prd'}],
				triage: [{repoPath: '/repo', slug: 'tr', namespace: 'observation'}],
			}),
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'slice:s', // buildable: eligible slice
			'prd:p', // buildable: sliceable PRD
			'slice:ap', // lifecycle: apply (consume first)
			'prd:su', // lifecycle: surface
			'observation:tr', // lifecycle: triage
		]);
	});

	it('count bounds ACROSS all four pools in priority order (buildable drains first)', () => {
		const r = report('/repo', [sliceItem('s', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [],
			count: 2,
			lifecycle: lifecycle({
				apply: [{repoPath: '/repo', slug: 'ap', namespace: 'slice'}],
				triage: [{repoPath: '/repo', slug: 'tr', namespace: 'observation'}],
			}),
		});
		// the eligible slice first, then apply (count 2 stops before triage).
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'slice:s',
			'slice:ap',
		]);
	});

	it('lifecycle-only selection (no buildable work) drains the lifecycle pools in order', () => {
		const r = report('/repo', []);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [],
			lifecycle: lifecycle({
				apply: [{repoPath: '/repo', slug: 'ap', namespace: 'slice'}],
				surface: [{repoPath: '/repo', slug: 'su', namespace: 'slice'}],
				triage: [{repoPath: '/repo', slug: 'tr', namespace: 'observation'}],
			}),
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'slice:ap',
			'slice:su',
			'observation:tr',
		]);
	});

	it('prdsFirst flips ONLY the buildable pair, lifecycle stays after', () => {
		const r = report('/repo', [sliceItem('s', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p')],
			prdsFirst: true,
			lifecycle: lifecycle({
				triage: [{repoPath: '/repo', slug: 'tr', namespace: 'observation'}],
			}),
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'prd:p', // buildable flipped
			'slice:s',
			'observation:tr', // lifecycle still last
		]);
	});
});

describe('selectPrioritised — the SLICE pool IS selectCandidates (shared primitive run uses)', () => {
	it('the slice ordering equals selectCandidates(report, caps) exactly', () => {
		const r = report('/repo', [
			sliceItem('a', true),
			sliceItem('b', false),
			sliceItem('c', true),
		]);
		const viaHelper = selectPrioritised({report: r, caps: CAPS, prds: []}).map(
			(s) => ({repoPath: s.repoPath, slug: s.slug}),
		);
		const viaRun = selectCandidates(r, CAPS);
		// The helper's slice pool is byte-identical to what `run` selects: they
		// SHARE `selectCandidates` (this slice owns the two-pool helper; `run`'s
		// adoption of the PRD pool is the noted follow-up).
		expect(viaHelper).toEqual(viaRun);
	});

	it('honours the slice-pool caps (round-robin / total) via selectCandidates', () => {
		const r: ScanReport = {
			repos: [
				{
					path: '/a',
					items: [sliceItem('a1', true), sliceItem('a2', true)],
				},
				{path: '/b', items: [sliceItem('b1', true)]},
			],
			totalItems: 3,
			totalEligible: 3,
		};
		const caps = {maxParallel: 2, perRepoMax: 1};
		const picked = selectPrioritised({report: r, caps, prds: []});
		// perRepoMax 1 + maxParallel 2 ⇒ one from each repo, exactly selectCandidates.
		expect(picked.map((s) => s.slug).sort()).toEqual(['a1', 'b1']);
		expect(picked.map((s) => ({repoPath: s.repoPath, slug: s.slug}))).toEqual(
			selectCandidates(r, caps),
		);
	});
});
