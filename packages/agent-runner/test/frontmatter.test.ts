import {describe, it, expect} from 'vitest';
import {parseFrontmatter} from '../src/frontmatter.js';

describe('parseFrontmatter', () => {
	it('extracts slug, humanOnly, needsAnswers and blockedBy from a full frontmatter block', () => {
		const md = [
			'---',
			'title: Some Title',
			'slug: my-slice',
			'prd: my-prd',
			'humanOnly: true',
			'needsAnswers: true',
			'blockedBy: [foo, bar]',
			'---',
			'',
			'## What to build',
			'body text here',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('my-slice');
		expect(fm.prd).toBe('my-prd');
		expect(fm.humanOnly).toBe(true);
		expect(fm.needsAnswers).toBe(true);
		expect(fm.blockedBy).toEqual(['foo', 'bar']);
	});

	it('treats humanOnly: true as the human-only gate', () => {
		const md = ['---', 'slug: a', 'humanOnly: true', '---'].join('\n');
		expect(parseFrontmatter(md).humanOnly).toBe(true);
	});

	it('treats omitted humanOnly as undefined (undeclared)', () => {
		const md = ['---', 'slug: a', 'blockedBy: []', '---'].join('\n');
		expect(parseFrontmatter(md).humanOnly).toBeUndefined();
	});

	it('parses needsAnswers: true as the discovered axis', () => {
		const md = ['---', 'slug: a', 'needsAnswers: true', '---'].join('\n');
		expect(parseFrontmatter(md).needsAnswers).toBe(true);
	});

	it('treats omitted needsAnswers as undefined (undeclared)', () => {
		const md = ['---', 'slug: a', '---'].join('\n');
		expect(parseFrontmatter(md).needsAnswers).toBeUndefined();
	});

	it('parses needsAnswers: false as false (not gated)', () => {
		const md = ['---', 'slug: a', 'needsAnswers: false', '---'].join('\n');
		expect(parseFrontmatter(md).needsAnswers).toBe(false);
	});

	it('returns empty blockedBy when blockedBy is omitted', () => {
		const md = ['---', 'slug: a', '---'].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual([]);
	});

	it('returns empty blockedBy for an empty inline list', () => {
		const md = ['---', 'slug: a', 'blockedBy: []', '---'].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual([]);
	});

	it('parses a block-style (multi-line) blockedBy list', () => {
		const md = [
			'---',
			'slug: a',
			'blockedBy:',
			'  - foo',
			'  - bar',
			'---',
		].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual(['foo', 'bar']);
	});

	it('does NOT match the legacy snake_case blocked_by key', () => {
		const md = ['---', 'slug: a', 'blocked_by: [foo, bar]', '---'].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual([]);
	});

	it('parses PRD-level sliceAfter (inline list)', () => {
		const md = [
			'---',
			'slug: my-prd',
			'sliceAfter: [other-prd, third-prd]',
			'---',
		].join('\n');
		expect(parseFrontmatter(md).sliceAfter).toEqual(['other-prd', 'third-prd']);
	});

	it('parses a block-style sliceAfter list', () => {
		const md = [
			'---',
			'slug: my-prd',
			'sliceAfter:',
			'  - other-prd',
			'  - third-prd',
			'---',
		].join('\n');
		expect(parseFrontmatter(md).sliceAfter).toEqual(['other-prd', 'third-prd']);
	});

	it('returns empty sliceAfter when omitted', () => {
		const md = ['---', 'slug: my-prd', '---'].join('\n');
		expect(parseFrontmatter(md).sliceAfter).toEqual([]);
	});

	it('reads a full PRD frontmatter block (humanOnly/needsAnswers/sliceAfter)', () => {
		const md = [
			'---',
			'title: Historical Store',
			'slug: historical-store',
			'humanOnly: true',
			'needsAnswers: true',
			'sliceAfter: [foundations]',
			'---',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('historical-store');
		expect(fm.humanOnly).toBe(true);
		expect(fm.needsAnswers).toBe(true);
		expect(fm.sliceAfter).toEqual(['foundations']);
	});

	it('parses a PRD-only `issue: N` link as a number (intake PRD-emit)', () => {
		// `intake`'s PRD outcome writes `issue: N` on `work/prd/<slug>.md` so the close
		// JOB can reach it via `slice.prd: → PRD issue:`. It must be machine-readable.
		const md = [
			'---',
			'title: Some Feature',
			'slug: some-feature',
			'issue: 42',
			'---',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.issue).toBe(42);
	});

	it('treats omitted `issue:` as undefined (every non-intake PRD and all slices)', () => {
		const md = ['---', 'slug: a', 'prd: my-prd', '---'].join('\n');
		expect(parseFrontmatter(md).issue).toBeUndefined();
	});

	it('treats a non-integer / non-positive `issue:` value as undefined (absent, not malformed)', () => {
		for (const bad of ['issue: not-a-number', 'issue: 0', 'issue: -3']) {
			const md = ['---', 'slug: a', bad, '---'].join('\n');
			expect(parseFrontmatter(md).issue).toBeUndefined();
		}
	});

	it('ignores a stale `sliced:` line (the marker was removed in remove-sliced-marker-step-b)', () => {
		// `sliced:` is no longer a parsed frontmatter axis — sliced-ness is RESIDENCE in
		// `work/prd-sliced/`. A leftover `sliced:` line is just inert text the parser
		// neither recognises nor trips over.
		const md = ['---', 'slug: my-prd', 'sliced: 2026-06-03', '---'].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('my-prd');
		expect('sliced' in fm).toBe(false);
	});

	it('strips quotes from quoted scalar values', () => {
		const md = ['---', "slug: 'quoted-slug'", 'humanOnly: "true"', '---'].join(
			'\n',
		);
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('quoted-slug');
		expect(fm.humanOnly).toBe(true);
	});

	it('strips quotes from items in inline lists', () => {
		const md = ['---', 'slug: a', 'blockedBy: [\'foo\', "bar"]', '---'].join(
			'\n',
		);
		expect(parseFrontmatter(md).blockedBy).toEqual(['foo', 'bar']);
	});

	it('returns undefined slug when there is no frontmatter block', () => {
		const md = '# just a heading\n\nno frontmatter';
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBeUndefined();
		expect(fm.humanOnly).toBeUndefined();
		expect(fm.needsAnswers).toBeUndefined();
		expect(fm.blockedBy).toEqual([]);
		expect(fm.sliceAfter).toEqual([]);
	});

	it('ignores keys appearing after the frontmatter block', () => {
		const md = [
			'---',
			'slug: a',
			'---',
			'',
			'humanOnly: true',
			'blockedBy: [should-be-ignored]',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.humanOnly).toBeUndefined();
		expect(fm.blockedBy).toEqual([]);
	});

	it('handles CRLF line endings', () => {
		const md = ['---', 'slug: crlf', 'humanOnly: true', '---', 'body'].join(
			'\r\n',
		);
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('crlf');
		expect(fm.humanOnly).toBe(true);
	});
});
