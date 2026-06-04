import {describe, it, expect} from 'vitest';
import {parseFrontmatter} from '../src/frontmatter.js';

describe('parseFrontmatter', () => {
	it('extracts slug, humanOnly and blocked_by from a full frontmatter block', () => {
		const md = [
			'---',
			'title: Some Title',
			'slug: my-slice',
			'prd: my-prd',
			'humanOnly: true',
			'blocked_by: [foo, bar]',
			'created: 2026-06-03',
			'---',
			'',
			'## What to build',
			'body text here',
		].join('\n');
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('my-slice');
		expect(fm.humanOnly).toBe(true);
		expect(fm.blockedBy).toEqual(['foo', 'bar']);
	});

	it('treats humanOnly: true as the human-only gate', () => {
		const md = ['---', 'slug: a', 'humanOnly: true', '---'].join('\n');
		expect(parseFrontmatter(md).humanOnly).toBe(true);
	});

	it('treats omitted humanOnly as undefined (undeclared)', () => {
		const md = ['---', 'slug: a', 'blocked_by: []', '---'].join('\n');
		expect(parseFrontmatter(md).humanOnly).toBeUndefined();
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
		const md = ['---', "slug: 'quoted-slug'", 'humanOnly: "true"', '---'].join(
			'\n',
		);
		const fm = parseFrontmatter(md);
		expect(fm.slug).toBe('quoted-slug');
		expect(fm.humanOnly).toBe(true);
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
		expect(fm.humanOnly).toBeUndefined();
		expect(fm.blockedBy).toEqual([]);
	});

	it('ignores keys appearing after the frontmatter block', () => {
		const md = [
			'---',
			'slug: a',
			'---',
			'',
			'humanOnly: true',
			'blocked_by: [should-be-ignored]',
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
