import {describe, it, expect} from 'vitest';
import {parseFrontmatter} from '../src/frontmatter.js';

describe('parseFrontmatter', () => {
	it('extracts slug, afk and blocked_by from a full frontmatter block', () => {
		const md = [
			'---',
			'title: Some Title',
			'slug: my-slice',
			'prd: my-prd',
			'afk: true',
			'blocked_by: [foo, bar]',
			'created: 2026-06-03',
			'---',
			'',
			'## What to build',
			'body text here',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('my-slice');
		expect(fm.afk).toBe(true);
		expect(fm.blockedBy).toEqual(['foo', 'bar']);
	});

	it('treats afk: false as explicitly false', () => {
		const md = ['---', 'slug: a', 'afk: false', '---'].join('\n');
		expect(parseFrontmatter(md).afk).toBe(false);
	});

	it('treats omitted afk as undefined (unspecified)', () => {
		const md = ['---', 'slug: a', 'blocked_by: []', '---'].join('\n');
		expect(parseFrontmatter(md).afk).toBeUndefined();
	});

	it('returns empty blockedBy when blocked_by is omitted', () => {
		const md = ['---', 'slug: a', '---'].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual([]);
	});

	it('returns empty blockedBy for an empty inline list', () => {
		const md = ['---', 'slug: a', 'blocked_by: []', '---'].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual([]);
	});

	it('parses a block-style (multi-line) blocked_by list', () => {
		const md = [
			'---',
			'slug: a',
			'blocked_by:',
			'  - foo',
			'  - bar',
			'---',
		].join('\n');
		expect(parseFrontmatter(md).blockedBy).toEqual(['foo', 'bar']);
	});

	it('strips quotes from quoted scalar values', () => {
		const md = ['---', "slug: 'quoted-slug'", 'afk: "true"', '---'].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('quoted-slug');
		expect(fm.afk).toBe(true);
	});

	it('strips quotes from items in inline lists', () => {
		const md = ['---', 'slug: a', 'blocked_by: [\'foo\', "bar"]', '---'].join(
			'\n',
		);
		expect(parseFrontmatter(md).blockedBy).toEqual(['foo', 'bar']);
	});

	it('returns undefined slug when there is no frontmatter block', () => {
		const md = '# just a heading\n\nno frontmatter';
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBeUndefined();
		expect(fm.afk).toBeUndefined();
		expect(fm.blockedBy).toEqual([]);
	});

	it('ignores keys appearing after the frontmatter block', () => {
		const md = [
			'---',
			'slug: a',
			'---',
			'',
			'afk: true',
			'blocked_by: [should-be-ignored]',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.afk).toBeUndefined();
		expect(fm.blockedBy).toEqual([]);
	});

	it('handles CRLF line endings', () => {
		const md = ['---', 'slug: crlf', 'afk: true', '---', 'body'].join('\r\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('crlf');
		expect(fm.afk).toBe(true);
	});
});
