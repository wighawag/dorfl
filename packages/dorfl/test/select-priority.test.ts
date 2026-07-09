import {describe, it, expect} from 'vitest';
import {
	selectPrioritised,
	taskableSpecs,
	type SpecCandidate,
	type SelectedLifecyclePools,
} from '../src/select-priority.js';
import {selectCandidates} from '../src/select.js';
import type {ScanReport, ScannedItem} from '../src/scan.js';

/**
 * The SHARED, PURE two-pool selection helper (`do-autopick`, ADR §3): eligible
 * TASKS first, then TASKABLE PRDs (a per-repo toggle flips it), bounded by a
 * COUNT, SEQUENTIAL. The task pool is selected via the EXISTING
 * `selectCandidates` (the primitive `run` shares), so this file ALSO pins that
 * the helper's task ordering IS `selectCandidates`'s output.
 */

function taskItem(slug: string, eligible: boolean): ScannedItem {
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

function prd(slug: string, extra: Partial<SpecCandidate> = {}): SpecCandidate {
	return {
		repoPath: '/repo',
		slug,
		humanOnly: undefined,
		needsAnswers: undefined,
		taskedAfter: [],
		...extra,
	};
}

describe('taskableSpecs — consumes autoslice-gate predicate (not reinvented)', () => {
	it('keeps only PRDs the gate passes (autoTask on, not humanOnly/needsAnswers)', () => {
		const candidates = [
			prd('ok'),
			prd('human', {humanOnly: true}),
			prd('asks', {needsAnswers: true}),
		];
		const out = taskableSpecs({
			candidates,
			taskedSlugs: new Set(),
			autoTask: true,
		});
		expect(out.map((p) => p.slug)).toEqual(['ok']);
	});

	it('autoTask off ⇒ nothing is taskable (mirrors autoBuild off)', () => {
		const out = taskableSpecs({
			candidates: [prd('ok')],
			taskedSlugs: new Set(),
			autoTask: false,
		});
		expect(out).toEqual([]);
	});

	it('taskedAfter gates against the TASKED markers, not done/', () => {
		const candidates = [prd('beta', {taskedAfter: ['alpha']})];
		// alpha not yet tasked ⇒ beta not taskable.
		expect(
			taskableSpecs({candidates, taskedSlugs: new Set(), autoTask: true}),
		).toEqual([]);
		// alpha tasked ⇒ beta becomes taskable.
		expect(
			taskableSpecs({
				candidates,
				taskedSlugs: new Set(['alpha']),
				autoTask: true,
			}).map((p) => p.slug),
		).toEqual(['beta']);
	});
});

describe('selectPrioritised — tasks-first, then PRDs-to-task', () => {
	it('auto-pick (count 1) picks the FIRST eligible task when tasks exist', () => {
		const r = report('/repo', [taskItem('a', true), taskItem('b', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			count: 1,
		});
		expect(picked).toEqual([{repoPath: '/repo', slug: 'a', namespace: 'task'}]);
	});

	it('auto-pick falls through to a PRD when NO task is eligible', () => {
		const r = report('/repo', [taskItem('a', false)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1'), prd('p2')],
			count: 1,
		});
		expect(picked).toEqual([{repoPath: '/repo', slug: 'p1', namespace: 'prd'}]);
	});

	it('orders ALL tasks before ANY PRD (drain ready work first)', () => {
		const r = report('/repo', [taskItem('a', true), taskItem('b', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1'), prd('p2')],
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:a',
			'task:b',
			'prd:p1',
			'prd:p2',
		]);
	});

	it('-n <x> takes x across both pools in priority order (sequential bound)', () => {
		const r = report('/repo', [taskItem('a', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1'), prd('p2')],
			count: 2,
		});
		// one task drains, then the first PRD.
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:a',
			'prd:p1',
		]);
	});

	it('count larger than the pools returns everything available (no padding)', () => {
		const r = report('/repo', [taskItem('a', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			count: 99,
		});
		expect(picked).toHaveLength(2);
	});

	it('returns empty when nothing is eligible in either pool', () => {
		const r = report('/repo', [taskItem('a', false)]);
		expect(
			selectPrioritised({report: r, caps: CAPS, prds: [], count: 1}),
		).toEqual([]);
	});
});

describe('selectPrioritised — selectionOrder FLIPS the order (subsumes prdsFirst)', () => {
	it('the `drain` DEFAULT (omitted selectionOrder) == the old prdsFirst:false order', () => {
		// The default preserved: omitting selectionOrder reproduces today's
		// tasks-first two-pool default (the prdsFirst:false behaviour).
		const r = report('/repo', [taskItem('a', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:a',
			'prd:p1',
		]);
		// And an EXPLICIT `drain` preset gives the same as omitting it.
		const viaPreset = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			selectionOrder: 'drain',
		});
		expect(viaPreset).toEqual(picked);
	});

	it('[task, build, ...] puts PRDs-to-task BEFORE eligible tasks (== old prdsFirst:true)', () => {
		const r = report('/repo', [taskItem('a', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			selectionOrder: ['task', 'build', 'surface', 'triage'],
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'prd:p1',
			'task:a',
		]);
	});

	it('selectionOrder flips which item auto-pick (count 1) takes', () => {
		const r = report('/repo', [taskItem('a', true)]);
		const tasksFirst = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			count: 1,
		});
		const prdsFirst = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
			selectionOrder: ['task', 'build', 'surface', 'triage'],
			count: 1,
		});
		expect(tasksFirst[0]).toMatchObject({namespace: 'task', slug: 'a'});
		expect(prdsFirst[0]).toMatchObject({namespace: 'prd', slug: 'p1'});
	});

	it('the `groom` preset puts surface+triage AHEAD of build+task', () => {
		const r = report('/repo', [taskItem('s', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p')],
			selectionOrder: 'groom',
			lifecycle: {
				apply: [],
				surface: [{repoPath: '/repo', slug: 'su', namespace: 'prd'}],
				triage: [{repoPath: '/repo', slug: 'tr', namespace: 'observation'}],
			},
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'prd:su', // surface
			'observation:tr', // triage
			'task:s', // build
			'prd:p', // task (PRD)
		]);
	});

	it('an UNKNOWN pool name FAILS LOUDLY at selection time', () => {
		const r = report('/repo', [taskItem('a', true)]);
		expect(() =>
			selectPrioritised({
				report: r,
				caps: CAPS,
				prds: [prd('p1')],
				selectionOrder: ['build', 'nope'],
			}),
		).toThrow(/unknown pool 'nope'/);
	});
});

describe('selectPrioritised — the LIFECYCLE pools (advance-autopick-lifecycle-pools)', () => {
	function lifecycle(
		over: Partial<SelectedLifecyclePools> = {},
	): SelectedLifecyclePools {
		return {apply: [], surface: [], triage: [], ...over};
	}

	it('DEFAULTS to none — `do`-shaped calls (no `lifecycle`) select ONLY tasks + PRDs (F-SHARE)', () => {
		// This is the `do` auto-pick shape: no lifecycle pools passed. Proves the
		// widening is backward-compatible — `do` never selects an observation or a
		// needsAnswers item.
		const r = report('/repo', [taskItem('a', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p1')],
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:a',
			'prd:p1',
		]);
		expect(picked.some((s) => s.namespace === 'observation')).toBe(false);
	});

	it('apply is PINNED FIRST, then the drain order (build → task → surface → triage)', () => {
		const r = report('/repo', [taskItem('s', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p')],
			lifecycle: lifecycle({
				apply: [{repoPath: '/repo', slug: 'ap', namespace: 'task'}],
				surface: [{repoPath: '/repo', slug: 'su', namespace: 'prd'}],
				triage: [{repoPath: '/repo', slug: 'tr', namespace: 'observation'}],
			}),
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:ap', // apply: PINNED FIRST (consume-always-wins)
			'task:s', // build: eligible task
			'prd:p', // task: taskable PRD
			'prd:su', // surface
			'observation:tr', // triage
		]);
	});

	it('count bounds ACROSS all five pools in priority order (apply first, then drain)', () => {
		const r = report('/repo', [taskItem('s', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [],
			count: 2,
			lifecycle: lifecycle({
				apply: [{repoPath: '/repo', slug: 'ap', namespace: 'task'}],
				triage: [{repoPath: '/repo', slug: 'tr', namespace: 'observation'}],
			}),
		});
		// apply first (pinned), then the eligible task (count 2 stops before triage).
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:ap',
			'task:s',
		]);
	});

	it('lifecycle-only selection (no buildable work) drains apply-first then the order', () => {
		const r = report('/repo', []);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [],
			lifecycle: lifecycle({
				apply: [{repoPath: '/repo', slug: 'ap', namespace: 'task'}],
				surface: [{repoPath: '/repo', slug: 'su', namespace: 'task'}],
				triage: [{repoPath: '/repo', slug: 'tr', namespace: 'observation'}],
			}),
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:ap', // apply pinned first
			'task:su', // surface (drain order)
			'observation:tr', // triage
		]);
	});

	it('selectionOrder reorders ONLY the four orderable pools; apply stays pinned first', () => {
		const r = report('/repo', [taskItem('s', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [prd('p')],
			selectionOrder: ['task', 'build', 'surface', 'triage'],
			lifecycle: lifecycle({
				apply: [{repoPath: '/repo', slug: 'ap', namespace: 'task'}],
				triage: [{repoPath: '/repo', slug: 'tr', namespace: 'observation'}],
			}),
		});
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual([
			'task:ap', // apply STILL first (not orderable)
			'prd:p', // task (PRD) flipped ahead of build
			'task:s', // build
			'observation:tr', // triage (still last)
		]);
	});

	it('a gated-off pool NAMED in the order drops out cleanly (no error)', () => {
		// `observationTriage: off` ⇒ no triage items even though the order names
		// `triage`. The gates decide what is PRESENT; selectionOrder ranks what is.
		const r = report('/repo', [taskItem('s', true)]);
		const picked = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [],
			selectionOrder: ['triage', 'build', 'task', 'surface'],
			// triage pool EMPTY (gated off); naming it is a no-op, never an error.
			lifecycle: lifecycle({triage: []}),
		});
		expect(picked.some((s) => s.namespace === 'observation')).toBe(false);
		expect(picked.map((s) => `${s.namespace}:${s.slug}`)).toEqual(['task:s']);
	});
});

describe('selectPrioritised — the TASK pool IS selectCandidates (shared primitive run uses)', () => {
	it('the task ordering equals selectCandidates(report, caps) exactly', () => {
		const r = report('/repo', [
			taskItem('a', true),
			taskItem('b', false),
			taskItem('c', true),
		]);
		const viaHelper = selectPrioritised({
			report: r,
			caps: CAPS,
			prds: [],
		}).map((s) => ({repoPath: s.repoPath, slug: s.slug}));
		const viaRun = selectCandidates(r, CAPS);
		// The helper's task pool is byte-identical to what `run` selects: they
		// SHARE `selectCandidates` (this task owns the two-pool helper; `run`'s
		// adoption of the PRD pool is the noted follow-up).
		expect(viaHelper).toEqual(viaRun);
	});

	it('honours the task-pool caps (round-robin / total) via selectCandidates', () => {
		const r: ScanReport = {
			repos: [
				{
					path: '/a',
					items: [taskItem('a1', true), taskItem('a2', true)],
				},
				{path: '/b', items: [taskItem('b1', true)]},
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
