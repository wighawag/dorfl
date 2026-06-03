import {describe, it, expect} from 'vitest';
import {
	categoriseAfk,
	categoriseItem,
	categoriseItems,
	sortReadyFirst,
	summariseGroups,
	CATEGORY_ORDER,
	type Category,
} from '../src/categorise.js';
import type {ScannedItem} from '../src/scan.js';
import {resolveEligibility} from '../src/eligibility.js';

/** Build a ScannedItem with a real (pure) eligibility resolution. */
function item(
	slug: string,
	afk: boolean | undefined,
	blockedBy: string[],
	doneSlugs: Set<string>,
	allowUnspecifiedGate = false,
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

describe('categoriseAfk', () => {
	it('maps afk:true to runner-eligible', () => {
		expect(categoriseAfk(true)).toBe('runner-eligible');
	});
	it('maps afk:false to human-only', () => {
		expect(categoriseAfk(false)).toBe('human-only');
	});
	it('maps unspecified gate to if-allowed', () => {
		expect(categoriseAfk(undefined)).toBe('if-allowed');
	});
});

describe('categoriseItem — every afk×deps combination', () => {
	// 3 gates × 2 dep states = 6 combinations. Category depends only on the
	// gate; readiness only on deps.
	const cases: Array<{
		afk: boolean | undefined;
		deps: string[];
		done: Set<string>;
		category: Category;
		ready: boolean;
	}> = [
		{
			afk: true,
			deps: [],
			done: new Set(),
			category: 'runner-eligible',
			ready: true,
		},
		{
			afk: true,
			deps: ['dep'],
			done: new Set(),
			category: 'runner-eligible',
			ready: false,
		},
		{
			afk: undefined,
			deps: [],
			done: new Set(),
			category: 'if-allowed',
			ready: true,
		},
		{
			afk: undefined,
			deps: ['dep'],
			done: new Set(),
			category: 'if-allowed',
			ready: false,
		},
		{
			afk: false,
			deps: [],
			done: new Set(),
			category: 'human-only',
			ready: true,
		},
		{
			afk: false,
			deps: ['dep'],
			done: new Set(),
			category: 'human-only',
			ready: false,
		},
	];

	for (const c of cases) {
		it(`afk=${String(c.afk)} deps=${c.deps.length ? 'blocked' : 'satisfied'} → ${c.category}/${c.ready ? 'ready' : 'blocked'}`, () => {
			const result = categoriseItem(item('x', c.afk, c.deps, c.done));
			expect(result.category).toBe(c.category);
			expect(result.ready).toBe(c.ready);
		});
	}

	it('readiness is flag-independent: deps satisfied via work/done/', () => {
		const result = categoriseItem(item('b', true, ['a'], new Set(['a'])));
		expect(result.ready).toBe(true);
	});
});

describe('categoriseItems', () => {
	it('buckets items into the three groups by gate', () => {
		const groups = categoriseItems([
			item('runner', true, [], new Set()),
			item('maybe', undefined, [], new Set()),
			item('human', false, [], new Set()),
		]);
		expect(groups['runner-eligible'].map((g) => g.item.slug)).toEqual([
			'runner',
		]);
		expect(groups['if-allowed'].map((g) => g.item.slug)).toEqual(['maybe']);
		expect(groups['human-only'].map((g) => g.item.slug)).toEqual(['human']);
	});

	it('is independent of allowUnspecifiedGate (groups identical either way)', () => {
		const items = [
			item('runner', true, [], new Set()),
			item('maybe', undefined, [], new Set()),
			item('human', false, [], new Set()),
		];
		const strict = categoriseItems(items);
		const permissive = categoriseItems(
			items.map((i) => item(i.slug, i.afk, i.blockedBy, new Set(), true)),
		);
		for (const category of CATEGORY_ORDER) {
			expect(permissive[category].map((g) => g.item.slug)).toEqual(
				strict[category].map((g) => g.item.slug),
			);
		}
	});

	it('sorts ready items above blocked ones within each group', () => {
		const groups = categoriseItems([
			item('blocked', true, ['dep'], new Set()),
			item('ready', true, [], new Set()),
		]);
		expect(groups['runner-eligible'].map((g) => g.item.slug)).toEqual([
			'ready',
			'blocked',
		]);
	});

	it('keeps every group present even when empty', () => {
		const groups = categoriseItems([item('only', true, [], new Set())]);
		expect(groups['if-allowed']).toEqual([]);
		expect(groups['human-only']).toEqual([]);
	});
});

describe('sortReadyFirst', () => {
	it('is a stable sort preserving order among equally-ready items', () => {
		const a = categoriseItem(item('a', true, [], new Set()));
		const b = categoriseItem(item('b', true, [], new Set()));
		const c = categoriseItem(item('c', true, ['x'], new Set()));
		const sorted = sortReadyFirst([c, a, b]);
		// ready a,b keep their incoming relative order; blocked c last.
		expect(sorted.map((s) => s.item.slug)).toEqual(['a', 'b', 'c']);
	});
});

describe('summariseGroups', () => {
	it('tallies per-category and ready/blocked counts across repos', () => {
		const repoA = categoriseItems([
			item('r1', true, [], new Set()),
			item('r2', true, ['dep'], new Set()),
			item('m1', undefined, [], new Set()),
		]);
		const repoB = categoriseItems([
			item('h1', false, [], new Set()),
			item('h2', false, ['dep'], new Set()),
		]);
		const summary = summariseGroups([repoA, repoB]);
		expect(summary.runnerEligible).toBe(2);
		expect(summary.ifAllowed).toBe(1);
		expect(summary.humanOnly).toBe(2);
		expect(summary.ready).toBe(3); // r1, m1, h1
		expect(summary.blocked).toBe(2); // r2, h2
	});
});
