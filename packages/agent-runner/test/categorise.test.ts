import {describe, it, expect} from 'vitest';
import {
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
	humanOnly: boolean | undefined,
	blockedBy: string[],
	doneSlugs: Set<string>,
	allowAgents = false,
): ScannedItem {
	return {
		file: `${slug}.md`,
		slug,
		humanOnly,
		blockedBy,
		eligibility: resolveEligibility({
			humanOnly,
			blockedBy,
			doneSlugs,
			allowAgents,
		}),
	};
}

describe('categoriseItem — every humanOnly×deps combination', () => {
	// Grouping is gate + readiness, INDEPENDENT of allowAgents.
	const cases: Array<{
		humanOnly: boolean | undefined;
		deps: string[];
		done: Set<string>;
		category: Category;
		ready: boolean;
	}> = [
		{
			humanOnly: undefined,
			deps: [],
			done: new Set(),
			category: 'agent-claimable',
			ready: true,
		},
		{
			humanOnly: undefined,
			deps: ['dep'],
			done: new Set(),
			category: 'blocked',
			ready: false,
		},
		{
			humanOnly: true,
			deps: [],
			done: new Set(),
			category: 'human-only',
			ready: true,
		},
		{
			humanOnly: true,
			deps: ['dep'],
			done: new Set(),
			category: 'human-only',
			ready: false,
		},
	];

	for (const c of cases) {
		it(`humanOnly=${String(c.humanOnly)} deps=${c.deps.length ? 'blocked' : 'satisfied'} → ${c.category}/${c.ready ? 'ready' : 'blocked'}`, () => {
			const result = categoriseItem(item('x', c.humanOnly, c.deps, c.done));
			expect(result.category).toBe(c.category);
			expect(result.ready).toBe(c.ready);
		});
	}

	it('readiness is policy-independent: deps satisfied via work/done/', () => {
		const result = categoriseItem(item('b', undefined, ['a'], new Set(['a'])));
		expect(result.ready).toBe(true);
		expect(result.category).toBe('agent-claimable');
	});
});

describe('categoriseItems', () => {
	it('buckets items into the three groups by gate + readiness', () => {
		const groups = categoriseItems([
			item('claimable', undefined, [], new Set()),
			item('human', true, [], new Set()),
			item('blocked', undefined, ['dep'], new Set()),
		]);
		expect(groups['agent-claimable'].map((g) => g.item.slug)).toEqual([
			'claimable',
		]);
		expect(groups['human-only'].map((g) => g.item.slug)).toEqual(['human']);
		expect(groups['blocked'].map((g) => g.item.slug)).toEqual(['blocked']);
	});

	it('is independent of allowAgents (groups identical either way)', () => {
		const items = [
			item('claimable', undefined, [], new Set()),
			item('human', true, [], new Set()),
			item('blocked', undefined, ['dep'], new Set()),
		];
		const strict = categoriseItems(items);
		const permissive = categoriseItems(
			items.map((i) => item(i.slug, i.humanOnly, i.blockedBy, new Set(), true)),
		);
		for (const category of CATEGORY_ORDER) {
			expect(permissive[category].map((g) => g.item.slug)).toEqual(
				strict[category].map((g) => g.item.slug),
			);
		}
	});

	it('sorts ready items above blocked ones within a group', () => {
		// human-only items can be ready or blocked but stay in the same group.
		const groups = categoriseItems([
			item('blocked', true, ['dep'], new Set()),
			item('ready', true, [], new Set()),
		]);
		expect(groups['human-only'].map((g) => g.item.slug)).toEqual([
			'ready',
			'blocked',
		]);
	});

	it('keeps every group present even when empty', () => {
		const groups = categoriseItems([item('only', undefined, [], new Set())]);
		expect(groups['human-only']).toEqual([]);
		expect(groups['blocked']).toEqual([]);
	});
});

describe('sortReadyFirst', () => {
	it('is a stable sort preserving order among equally-ready items', () => {
		const a = categoriseItem(item('a', undefined, [], new Set()));
		const b = categoriseItem(item('b', undefined, [], new Set()));
		const c = categoriseItem(item('c', undefined, ['x'], new Set()));
		const sorted = sortReadyFirst([c, a, b]);
		expect(sorted.map((s) => s.item.slug)).toEqual(['a', 'b', 'c']);
	});
});

describe('summariseGroups', () => {
	it('tallies per-category and ready counts across repos', () => {
		const repoA = categoriseItems([
			item('c1', undefined, [], new Set()),
			item('b1', undefined, ['dep'], new Set()),
			item('m1', true, [], new Set()),
		]);
		const repoB = categoriseItems([
			item('h1', true, [], new Set()),
			item('h2', true, ['dep'], new Set()),
		]);
		const summary = summariseGroups([repoA, repoB]);
		expect(summary.agentClaimable).toBe(1); // c1
		expect(summary.humanOnly).toBe(3); // m1, h1, h2
		expect(summary.blocked).toBe(1); // b1
		expect(summary.ready).toBe(3); // c1, m1, h1
	});
});
