import {describe, it, expect} from 'vitest';
import {
	resolveSelectionOrder,
	SELECTION_ORDER_PRESETS,
	DEFAULT_SELECTION_ORDER,
	type SelectionPool,
} from '../src/select-order.js';

/**
 * The PURE selection-order resolver (slice `advance-selection-order-config`): a
 * PRESET keyword OR an explicit pool-name list resolves to the canonical ordered
 * list of the FOUR orderable pools; `apply` is pinned-first and NOT nameable;
 * unknown names/keywords FAIL LOUDLY. Driven as a table.
 */

describe('resolveSelectionOrder — preset expansion + explicit list (table)', () => {
	const cases: Array<{
		name: string;
		input: string | string[];
		expected: SelectionPool[];
	}> = [
		{
			name: 'preset `drain` ⇒ [build, slice, surface, triage]',
			input: 'drain',
			expected: ['build', 'slice', 'surface', 'triage'],
		},
		{
			name: 'preset `groom` ⇒ [surface, triage, build, slice]',
			input: 'groom',
			expected: ['surface', 'triage', 'build', 'slice'],
		},
		{
			name: 'the DEFAULT value resolves to the drain order',
			input: DEFAULT_SELECTION_ORDER,
			expected: ['build', 'slice', 'surface', 'triage'],
		},
		{
			name: 'env single-element list `[drain]` ALSO expands the preset',
			input: ['drain'],
			expected: ['build', 'slice', 'surface', 'triage'],
		},
		{
			name: 'env single-element list `[groom]` expands the preset',
			input: ['groom'],
			expected: ['surface', 'triage', 'build', 'slice'],
		},
		{
			name: 'explicit LIST is taken verbatim',
			input: ['surface', 'build', 'slice', 'triage'],
			expected: ['surface', 'build', 'slice', 'triage'],
		},
		{
			name: 'explicit list reproducing prdsFirst:true ([slice, build, ...])',
			input: ['slice', 'build', 'surface', 'triage'],
			expected: ['slice', 'build', 'surface', 'triage'],
		},
		{
			name: 'a single explicit pool name is a one-element list (not a preset)',
			input: 'build',
			expected: ['build'],
		},
		{
			name: 'a partial explicit list is honoured verbatim (no padding)',
			input: ['build', 'slice'],
			expected: ['build', 'slice'],
		},
		{
			name: 'list entries are trimmed of surrounding whitespace',
			input: [' build ', 'slice'],
			expected: ['build', 'slice'],
		},
	];

	for (const c of cases) {
		it(c.name, () => {
			expect(resolveSelectionOrder(c.input)).toEqual(c.expected);
		});
	}

	it('each preset in SELECTION_ORDER_PRESETS resolves to its own list', () => {
		for (const [name, list] of Object.entries(SELECTION_ORDER_PRESETS)) {
			expect(resolveSelectionOrder(name)).toEqual([...list]);
		}
	});
});

describe('resolveSelectionOrder — loud failures (table)', () => {
	const failing: Array<{
		name: string;
		input: string | string[];
		match: RegExp;
	}> = [
		{
			name: 'unknown single keyword fails naming the value',
			input: 'balanced',
			match: /unknown pool 'balanced'|'balanced'/,
		},
		{
			name: 'unknown pool name in a list fails naming the value',
			input: ['build', 'nope', 'slice'],
			match: /unknown pool 'nope'/,
		},
		{
			name: 'naming `apply` is a loud usage error (pinned, not orderable)',
			input: ['apply', 'build'],
			match: /'apply' is pinned/,
		},
		{
			name: 'a lone `apply` is also rejected',
			input: 'apply',
			match: /'apply' is pinned/,
		},
		{
			name: 'an empty list fails loudly',
			input: [],
			match: /empty/,
		},
		{
			name: 'an all-blank list fails loudly (empty after trim)',
			input: ['  ', ''],
			match: /empty/,
		},
		{
			name: 'a duplicate pool name fails loudly',
			input: ['build', 'build'],
			match: /duplicate pool 'build'/,
		},
		{
			name: 'a preset keyword MIXED into a list is not a pool name ⇒ fails',
			input: ['drain', 'build'],
			match: /unknown pool 'drain'/,
		},
	];

	for (const c of failing) {
		it(c.name, () => {
			expect(() => resolveSelectionOrder(c.input)).toThrow(c.match);
		});
	}
});
