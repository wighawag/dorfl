import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scan, readDoneSlugs, readBacklogItems} from '../src/scan.js';
import {mergeConfig} from '../src/config.js';

let root: string;

function writeItem(
	repo: string,
	status: 'backlog' | 'done' | 'in-progress',
	file: string,
	frontmatter: Record<string, string>,
): void {
	const dir = join(root, repo, 'work', status);
	mkdirSync(dir, {recursive: true});
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	writeFileSync(join(dir, file), lines.join('\n'));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-scan-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe('readDoneSlugs', () => {
	it('returns the set of slugs present in work/done/', () => {
		writeItem('repo', 'done', 'one.md', {slug: 'one'});
		writeItem('repo', 'done', 'two.md', {slug: 'two'});
		const slugs = readDoneSlugs(join(root, 'repo'));
		expect(slugs).toEqual(new Set(['one', 'two']));
	});

	it('falls back to the filename (sans .md) when slug frontmatter is absent', () => {
		const dir = join(root, 'repo', 'work', 'done');
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'no-slug.md'), 'no frontmatter');
		const slugs = readDoneSlugs(join(root, 'repo'));
		expect(slugs).toEqual(new Set(['no-slug']));
	});

	it('returns an empty set when there is no work/done/', () => {
		mkdirSync(join(root, 'repo'), {recursive: true});
		expect(readDoneSlugs(join(root, 'repo'))).toEqual(new Set());
	});
});

describe('readBacklogItems', () => {
	it('reads slug/afk/blockedBy for each backlog markdown', () => {
		writeItem('repo', 'backlog', 'a.md', {
			slug: 'a',
			afk: 'true',
			blocked_by: '[]',
		});
		const items = readBacklogItems(join(root, 'repo'));
		expect(items).toHaveLength(1);
		expect(items[0].slug).toBe('a');
		expect(items[0].afk).toBe(true);
		expect(items[0].blockedBy).toEqual([]);
		expect(items[0].file).toBe('a.md');
	});

	it('falls back to filename when slug frontmatter is absent', () => {
		const dir = join(root, 'repo', 'work', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'fallback.md'), '---\nafk: true\n---');
		const items = readBacklogItems(join(root, 'repo'));
		expect(items[0].slug).toBe('fallback');
	});

	it('returns items sorted by slug', () => {
		writeItem('repo', 'backlog', 'z.md', {slug: 'zebra'});
		writeItem('repo', 'backlog', 'a.md', {slug: 'apple'});
		const items = readBacklogItems(join(root, 'repo'));
		expect(items.map((i) => i.slug)).toEqual(['apple', 'zebra']);
	});
});

describe('scan', () => {
	it('produces a per-repo queue with resolved eligibility', () => {
		writeItem('repo-a', 'backlog', 'ready.md', {slug: 'ready', afk: 'true'});
		writeItem('repo-a', 'backlog', 'human.md', {slug: 'human', afk: 'false'});
		const config = mergeConfig({roots: [root]});

		const report = scan(config);
		expect(report.repos).toHaveLength(1);
		const repo = report.repos[0];
		expect(repo.path).toBe(join(root, 'repo-a'));

		const ready = repo.items.find((i) => i.slug === 'ready')!;
		expect(ready.eligibility.eligible).toBe(true);

		const human = repo.items.find((i) => i.slug === 'human')!;
		expect(human.eligibility.eligible).toBe(false);
		expect(human.eligibility.afkPass).toBe(false);
	});

	it('resolves blocked_by against the same repo work/done/', () => {
		writeItem('repo', 'backlog', 'b.md', {
			slug: 'b',
			afk: 'true',
			blocked_by: '[a]',
		});
		// dependency not yet done
		let report = scan(mergeConfig({roots: [root]}));
		let b = report.repos[0].items[0];
		expect(b.eligibility.blockedBy.satisfied).toBe(false);
		expect(b.eligibility.eligible).toBe(false);

		// now satisfy the dependency
		writeItem('repo', 'done', 'a.md', {slug: 'a'});
		report = scan(mergeConfig({roots: [root]}));
		b = report.repos[0].items[0];
		expect(b.eligibility.blockedBy.satisfied).toBe(true);
		expect(b.eligibility.eligible).toBe(true);
	});

	it('does NOT resolve blocked_by across repos', () => {
		writeItem('repo-a', 'done', 'dep.md', {slug: 'dep'});
		writeItem('repo-b', 'backlog', 'needs.md', {
			slug: 'needs',
			afk: 'true',
			blocked_by: '[dep]',
		});
		const report = scan(mergeConfig({roots: [root]}));
		const repoB = report.repos.find((r) => r.path === join(root, 'repo-b'))!;
		const needs = repoB.items[0];
		// dep is done in repo-a but NOT in repo-b → still blocked
		expect(needs.eligibility.blockedBy.satisfied).toBe(false);
		expect(needs.eligibility.eligible).toBe(false);
	});

	it('honours allowUnspecifiedGate for omitted afk', () => {
		writeItem('repo', 'backlog', 'u.md', {slug: 'u', blocked_by: '[]'});

		const strict = scan(
			mergeConfig({roots: [root], allowUnspecifiedGate: false}),
		);
		expect(strict.repos[0].items[0].eligibility.eligible).toBe(false);

		const permissive = scan(
			mergeConfig({roots: [root], allowUnspecifiedGate: true}),
		);
		expect(permissive.repos[0].items[0].eligibility.eligible).toBe(true);
	});

	it('returns repos sorted and an empty list when nothing participates', () => {
		mkdirSync(join(root, 'not-a-repo'), {recursive: true});
		const report = scan(mergeConfig({roots: [root]}));
		expect(report.repos).toEqual([]);
	});

	it('counts eligible items in the report summary', () => {
		writeItem('repo', 'backlog', 'a.md', {slug: 'a', afk: 'true'});
		writeItem('repo', 'backlog', 'b.md', {slug: 'b', afk: 'false'});
		writeItem('repo', 'backlog', 'c.md', {slug: 'c', afk: 'true'});
		const report = scan(mergeConfig({roots: [root]}));
		expect(report.totalItems).toBe(3);
		expect(report.totalEligible).toBe(2);
	});
});
