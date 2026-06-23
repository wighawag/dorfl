import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {resolveCwdSection} from '../src/cwd-section.js';
import {formatReport, formatCwdSection} from '../src/format.js';
import {status, formatStatus} from '../src/status.js';
import {scan} from '../src/scan.js';
import {mergeConfig} from '../src/config.js';
import {mirrorPath} from '../src/repo-mirror.js';
import {makeScratch, gitIn, type Scratch} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-cwd-section-');
});
afterEach(() => {
	scratch.cleanup();
});

function workspacesDir(): string {
	return join(scratch.root, '.agent-runner');
}

function config() {
	return mergeConfig({workspacesDir: workspacesDir(), autoBuild: true});
}

/** A minimal task body for `work/tasks/todo/<slug>.md`. */
function task(slug: string, extra: Record<string, string> = {}): string {
	const lines = ['---', `title: ${slug}`, `slug: ${slug}`];
	for (const [k, v] of Object.entries(extra)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('blockedBy: []', '---', '', 'body');
	return lines.join('\n');
}

/**
 * Build a participating working repo with a sibling local `--bare` arbiter wired
 * as the `arbiter` remote, seeding the given backlog tasks. Returns the repo +
 * arbiter paths.
 */
function seedCwdRepo(
	backlog: Record<string, string>,
	opts: {dir?: string} = {},
): {repo: string; arbiter: string} {
	const repo = join(scratch.root, opts.dir ?? 'project');
	mkdirSync(join(repo, 'work', 'tasks', 'todo'), {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	for (const [file, content] of Object.entries(backlog)) {
		writeFileSync(join(repo, 'work', 'tasks', 'todo', file), content);
	}
	writeFileSync(join(repo, 'README.md'), '# project\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed'], repo);

	const arbiter = join(scratch.root, `${opts.dir ?? 'project'}.git`);
	gitIn(['clone', '-q', '--bare', repo, arbiter], scratch.root);
	gitIn(['remote', 'add', 'arbiter', `file://${arbiter}`], repo);
	gitIn(['fetch', '-q', 'arbiter'], repo);
	return {repo, arbiter};
}

/** Register the cwd repo's arbiter as a hub mirror (so it is "also registered"). */
function registerArbiterAsMirror(arbiter: string): string {
	const url = `file://${arbiter}`;
	const dest = mirrorPath(workspacesDir(), url);
	mkdirSync(dirname(dest), {recursive: true});
	gitIn(['clone', '-q', '--bare', url, dest], dirname(dest));
	return dest;
}

/** Add an UNPUSHED commit on the cwd repo's local `main` (diverges from arbiter). */
function addUnpushedCommit(repo: string): void {
	writeFileSync(join(repo, 'unpushed.txt'), 'local only\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'unpushed local work'], repo);
}

describe('resolveCwdSection — cwd participation', () => {
	it('reports a participating cwd as a separate local section with its own count', async () => {
		const {repo} = seedCwdRepo({
			'a.md': task('a'),
			'b.md': task('b', {humanOnly: 'true'}),
		});
		const section = await resolveCwdSection({cwd: repo, config: config()});
		expect(section.participating).toBe(true);
		expect(section.path).toBe(repo);
		expect(section.totalItems).toBe(2);
		expect(section.repo?.items.map((i) => i.slug).sort()).toEqual(['a', 'b']);
	});

	it('returns {participating:false} OUTSIDE a participating repo (no section)', async () => {
		const notRepo = join(scratch.root, 'empty');
		mkdirSync(notRepo, {recursive: true});
		const section = await resolveCwdSection({cwd: notRepo, config: config()});
		expect(section.participating).toBe(false);
		expect(section.repo).toBeUndefined();
	});
});

describe('resolveCwdSection — fetch-first + divergence (main-divergence-guard framing)', () => {
	it('fetches the cwd arbiter first and reports a clean (in-sync) divergence', async () => {
		const {repo} = seedCwdRepo({'a.md': task('a')});
		const section = await resolveCwdSection({cwd: repo, config: config()});
		expect(section.arbiter?.configured).toBe(true);
		expect(section.arbiter?.fetched).toBe(true);
		expect(section.arbiter?.ahead).toBe(0);
		expect(section.arbiter?.behind).toBe(0);
	});

	it('shows local main AHEAD of the arbiter when there is unpushed work', async () => {
		const {repo} = seedCwdRepo({'a.md': task('a')});
		addUnpushedCommit(repo);
		const section = await resolveCwdSection({cwd: repo, config: config()});
		expect(section.arbiter?.ahead).toBe(1);
		const out = formatCwdSection(section).join('\n');
		expect(out).toMatch(/1 commit ahead \(unpushed\)/);
		expect(out).toMatch(/arbiter\/main/);
	});

	it('WARNS and falls back when the cwd arbiter fetch FAILS (never errors)', async () => {
		const {repo} = seedCwdRepo({'a.md': task('a')});
		// Point the arbiter remote at a path that does not exist ⇒ fetch fails.
		gitIn(
			['remote', 'set-url', 'arbiter', 'file:///nonexistent/gone.git'],
			repo,
		);
		const warnings: string[] = [];
		const section = await resolveCwdSection({
			cwd: repo,
			config: config(),
			warn: (m) => warnings.push(m),
		});
		// Did NOT throw; still produced the local section (offline fall-back).
		expect(section.participating).toBe(true);
		expect(section.arbiter?.fetched).toBe(false);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].toLowerCase()).toMatch(/fetch|offline|last-known/);
	});
});

describe('resolveCwdSection — registry de-dup', () => {
	it('marks the cwd as also-registered when its arbiter is a registered mirror', async () => {
		const {repo, arbiter} = seedCwdRepo({'a.md': task('a')});
		const mirror = registerArbiterAsMirror(arbiter);
		const section = await resolveCwdSection({cwd: repo, config: config()});
		expect(section.alsoRegistered).toBe(true);
		expect(section.registeredMirrorPath).toBe(mirror);
	});

	it('is NOT also-registered when the cwd arbiter is absent from the registry', async () => {
		const {repo} = seedCwdRepo({'a.md': task('a')});
		const section = await resolveCwdSection({cwd: repo, config: config()});
		expect(section.alsoRegistered).toBe(false);
	});
});

describe('formatReport — cwd-local section is distinct + de-duped (scan)', () => {
	it('renders a labelled local section ABOVE the registry, each with its OWN count', async () => {
		const {repo} = seedCwdRepo({'a.md': task('a'), 'b.md': task('b')});
		const section = await resolveCwdSection({cwd: repo, config: config()});
		// An (unrelated) empty registry.
		const registry = await scan(config());
		const out = formatReport(registry, section);
		expect(out).toContain('This repo (local working tree)');
		expect(out).toContain(repo);
		// Distinct sections, never one merged grand total.
		expect(out).toContain('Local total: 2 items');
		expect(out).not.toMatch(/Summary: 2 item/);
	});

	it('an UNREGISTERED participating cwd shows the self-registration hint, not the dead-end', async () => {
		const {repo} = seedCwdRepo({'a.md': task('a')});
		const section = await resolveCwdSection({cwd: repo, config: config()});
		const registry = await scan(config()); // empty registry
		const out = formatReport(registry, section);
		expect(out).not.toContain('No participating repos found.');
		expect(out.toLowerCase()).toContain('not registered');
		expect(out.toLowerCase()).toContain('remote add . --local');
	});

	it('a cwd that is ALSO registered is de-duped (shown once, marked, not a second row)', async () => {
		const {repo, arbiter} = seedCwdRepo({'a.md': task('a')});
		const mirror = registerArbiterAsMirror(arbiter);
		const section = await resolveCwdSection({cwd: repo, config: config()});
		const registry = await scan(config());
		const out = formatReport(registry, section);
		// Marked once in the local section…
		expect(out).toContain('(also registered)');
		// …and its registry row is dropped (the mirror path appears only in the
		// local section's path line, not as a separate registry repo row).
		const occurrences = out.split(mirror).length - 1;
		expect(occurrences).toBe(0);
	});

	it('OUTSIDE a participating repo, the registry-only empty-state is unchanged', async () => {
		const notRepo = join(scratch.root, 'empty');
		mkdirSync(notRepo, {recursive: true});
		const section = await resolveCwdSection({cwd: notRepo, config: config()});
		const registry = await scan(config()); // empty registry
		const out = formatReport(registry, section);
		expect(out).toContain('No participating repos found.');
	});
});

describe('formatStatus — cwd-local section renders distinctly', () => {
	it('shows the cwd local section in status when participating', async () => {
		const {repo} = seedCwdRepo({'a.md': task('a')});
		const section = await resolveCwdSection({cwd: repo, config: config()});
		const report = await status({
			workspacesDir: workspacesDir(),
			cwd: section,
		});
		expect(report.cwd?.participating).toBe(true);
		const out = formatStatus(report);
		expect(out).toContain('This repo (local working tree)');
		expect(out).toContain(repo);
		expect(out).toContain('Local total: 1 item');
	});

	it('status without a cwd section is unchanged (no local block)', async () => {
		const report = await status({workspacesDir: workspacesDir()});
		const out = formatStatus(report);
		expect(out).not.toContain('This repo (local working tree)');
	});
});
