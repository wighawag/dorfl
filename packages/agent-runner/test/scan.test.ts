import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	scan,
	scanRepoPaths,
	readDoneSlugs,
	readBacklogItems,
} from '../src/scan.js';
import {mergeConfig} from '../src/config.js';
import {registerMirrorWithWork} from './helpers/gitRepo.js';

let root: string;

/** A minimal slice markdown body with the given frontmatter fields. */
function slice(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	return lines.join('\n');
}

/** The workspacesDir whose `repos/` we seed with bare mirror fixtures. */
function workspacesDir(): string {
	return join(root, '.agent-runner');
}

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
	it('reads slug/humanOnly/needsAnswers/blockedBy for each backlog markdown', () => {
		writeItem('repo', 'backlog', 'a.md', {
			slug: 'a',
			humanOnly: 'true',
			needsAnswers: 'true',
			blockedBy: '[]',
		});
		const items = readBacklogItems(join(root, 'repo'));
		expect(items).toHaveLength(1);
		expect(items[0].slug).toBe('a');
		expect(items[0].humanOnly).toBe(true);
		expect(items[0].needsAnswers).toBe(true);
		expect(items[0].blockedBy).toEqual([]);
		expect(items[0].file).toBe('a.md');
	});

	it('reads undeclared items (no humanOnly/needsAnswers) as undefined', () => {
		writeItem('repo', 'backlog', 'u.md', {slug: 'u', blockedBy: '[]'});
		const items = readBacklogItems(join(root, 'repo'));
		expect(items[0].humanOnly).toBeUndefined();
		expect(items[0].needsAnswers).toBeUndefined();
	});

	it('falls back to filename when slug frontmatter is absent', () => {
		const dir = join(root, 'repo', 'work', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'fallback.md'), '---\nhumanOnly: true\n---');
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

describe("scan (registry: reads each hub mirror's bare main ref)", () => {
	it('produces a per-repo queue with resolved eligibility', async () => {
		const m = registerMirrorWithWork(workspacesDir(), 'repo-a', {
			backlog: {
				'ready.md': slice({slug: 'ready'}),
				'human.md': slice({slug: 'human', humanOnly: 'true'}),
			},
		});
		const config = mergeConfig({
			workspacesDir: workspacesDir(),
			allowAgents: true,
		});

		const report = await scan(config);
		expect(report.repos).toHaveLength(1);
		const repo = report.repos[0];
		// The repo identity is the hub-mirror PATH (registry model).
		expect(repo.path).toBe(m.mirrorPath);

		const ready = repo.items.find((i) => i.slug === 'ready')!;
		expect(ready.eligibility.eligible).toBe(true);

		const human = repo.items.find((i) => i.slug === 'human')!;
		expect(human.eligibility.eligible).toBe(false);
		expect(human.eligibility.gatePass).toBe(false);
	});

	it('gates needsAnswers: true items independently of humanOnly', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo-na', {
			backlog: {
				'ready.md': slice({slug: 'ready'}),
				'answers.md': slice({slug: 'answers', needsAnswers: 'true'}),
			},
		});
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), allowAgents: true}),
		);
		const repo = report.repos[0];

		const ready = repo.items.find((i) => i.slug === 'ready')!;
		expect(ready.eligibility.eligible).toBe(true);

		const answers = repo.items.find((i) => i.slug === 'answers')!;
		expect(answers.eligibility.eligible).toBe(false);
		expect(answers.eligibility.gatePass).toBe(false);
	});

	it('resolves blockedBy against the same mirror work/done/', async () => {
		// dependency not yet done
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'b.md': slice({slug: 'b', blockedBy: '[a]'})},
		});
		const config = mergeConfig({
			workspacesDir: workspacesDir(),
			allowAgents: true,
		});
		let report = await scan(config);
		let b = report.repos[0].items[0];
		expect(b.eligibility.blockedBy.satisfied).toBe(false);
		expect(b.eligibility.eligible).toBe(false);

		// now satisfy the dependency: a fresh fixture with a done/ alongside backlog/.
		rmSync(workspacesDir(), {recursive: true, force: true});
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'b.md': slice({slug: 'b', blockedBy: '[a]'})},
			done: {'a.md': slice({slug: 'a'})},
		});
		report = await scan(config);
		b = report.repos[0].items[0];
		expect(b.eligibility.blockedBy.satisfied).toBe(true);
		expect(b.eligibility.eligible).toBe(true);
	});

	it('does NOT resolve blockedBy across mirrors', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo-a', {
			done: {'dep.md': slice({slug: 'dep'})},
		});
		registerMirrorWithWork(workspacesDir(), 'repo-b', {
			backlog: {'needs.md': slice({slug: 'needs', blockedBy: '[dep]'})},
		});
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), allowAgents: true}),
		);
		const needs = report.repos
			.flatMap((r) => r.items)
			.find((i) => i.slug === 'needs')!;
		// dep is done in repo-a but NOT in repo-b → still blocked
		expect(needs.eligibility.blockedBy.satisfied).toBe(false);
		expect(needs.eligibility.eligible).toBe(false);
	});

	it('honours allowAgents for undeclared (no humanOnly) items', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'u.md': slice({slug: 'u', blockedBy: '[]'})},
		});

		const strict = await scan(
			mergeConfig({workspacesDir: workspacesDir(), allowAgents: false}),
		);
		expect(strict.repos[0].items[0].eligibility.eligible).toBe(false);

		const permissive = await scan(
			mergeConfig({workspacesDir: workspacesDir(), allowAgents: true}),
		);
		expect(permissive.repos[0].items[0].eligibility.eligible).toBe(true);
	});

	it('returns an empty list when no mirrors are registered', async () => {
		mkdirSync(workspacesDir(), {recursive: true});
		const report = await scan(mergeConfig({workspacesDir: workspacesDir()}));
		expect(report.repos).toEqual([]);
	});

	it('counts eligible items in the report summary', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {
				'a.md': slice({slug: 'a'}),
				'b.md': slice({slug: 'b', humanOnly: 'true'}),
				'c.md': slice({slug: 'c'}),
			},
		});
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), allowAgents: true}),
		);
		expect(report.totalItems).toBe(3);
		expect(report.totalEligible).toBe(2);
	});
});

describe('scanRepoPaths (working-tree scan for in-place/run)', () => {
	it('reads eligibility from a working checkout and honours per-repo allowAgents', () => {
		writeItem('repo', 'backlog', 'u.md', {slug: 'u', blockedBy: '[]'});
		writeFileSync(
			join(root, 'repo', '.agent-runner.json'),
			JSON.stringify({allowAgents: true}),
		);
		// Global is strict, but the per-repo file opts in ⇒ eligible (the working-tree
		// scan CAN read a checked-out .agent-runner.json; the mirror scan cannot).
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({allowAgents: false}),
		);
		expect(report.repos[0].items[0].eligibility.eligible).toBe(true);
	});
});
