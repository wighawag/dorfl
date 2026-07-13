import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureFolderRel, rmrf} from './helpers/gitRepo.js';
import {isSpecComplete} from '../src/spec-complete.js';

let root: string;

/** Seed one `work/<folder>/<file>` task with the given frontmatter. */
function writeTask(
	folder: 'backlog' | 'in-progress' | 'done',
	file: string,
	frontmatter: Record<string, string>,
	body = 'body',
): void {
	const dir = join(root, 'repo', 'work', fixtureFolderRel(folder));
	mkdirSync(dir, {recursive: true});
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', body);
	writeFileSync(join(dir, file), lines.join('\n'));
}

function repoPath(): string {
	return join(root, 'repo');
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-spec-complete-'));
});

afterEach(() => {
	rmrf(root);
});

describe('isSpecComplete — the read-only "is this spec complete?" core query', () => {
	it('NOT complete when NO task carries spec:<slug> (≥1 is required)', () => {
		// A `work/` tree with tasks, but none link to this spec — even other specs'
		// done tasks do not count.
		writeTask('done', 'unrelated-done.md', {slug: 'unrelated-done'});
		writeTask('done', 'other-spec.md', {
			slug: 'other-spec',
			spec: 'some-other-spec',
		});
		writeTask('backlog', 'standalone.md', {slug: 'standalone'});

		const result = isSpecComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});

		expect(result.complete).toBe(false);
		expect(result.tasks).toEqual([]);
	});

	it('NOT complete when ≥1 spec:<slug> task exists but some are NOT in work/tasks/done/', () => {
		// Three tasks link the spec; two are done, one is still in backlog.
		writeTask('done', 'a.md', {slug: 'a', spec: 'issue-intake'});
		writeTask('done', 'b.md', {slug: 'b', spec: 'issue-intake'});
		writeTask('backlog', 'c.md', {slug: 'c', spec: 'issue-intake'});

		const result = isSpecComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});

		expect(result.complete).toBe(false);
		// All three are matched (across folders), sorted by slug.
		expect(result.tasks.map((s) => s.slug)).toEqual(['a', 'b', 'c']);
	});

	it('NOT complete when a matching task is in in-progress (not done)', () => {
		// Post-cutover `needs-attention/` is no longer a task residence (retired to
		// the per-item lock `state: stuck`), so `in-progress` is the only transient
		// non-done residence the scan still recognises.
		writeTask('done', 'a.md', {slug: 'a', spec: 'issue-intake'});
		writeTask('in-progress', 'b.md', {slug: 'b', spec: 'issue-intake'});

		expect(
			isSpecComplete({repoPath: repoPath(), slug: 'issue-intake'}).complete,
		).toBe(false);
	});

	it('COMPLETE when ≥1 spec:<slug> task exists and ALL are in work/tasks/done/', () => {
		writeTask('done', 'a.md', {slug: 'a', spec: 'issue-intake'});
		writeTask('done', 'b.md', {slug: 'b', spec: 'issue-intake'});
		// An unrelated, not-done task for a different spec must not block completion.
		writeTask('backlog', 'elsewhere.md', {
			slug: 'elsewhere',
			spec: 'other-spec',
		});

		const result = isSpecComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});

		expect(result.complete).toBe(true);
		expect(result.tasks.map((s) => s.slug)).toEqual(['a', 'b']);
		expect(result.tasks.every((s) => s.folder === 'done')).toBe(true);
	});

	it('COMPLETE with a single done task (≥1 is enough)', () => {
		writeTask('done', 'only.md', {slug: 'only', spec: 'issue-intake'});

		const result = isSpecComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});

		expect(result.complete).toBe(true);
		expect(result.tasks).toHaveLength(1);
	});

	it('matches on the parsed spec: field — resolves task slug from frontmatter, falling back to filename', () => {
		// Frontmatter slug wins; filename fallback when no slug.
		writeTask('done', 'on-disk-name.md', {
			slug: 'real-slug',
			spec: 'issue-intake',
		});
		writeTask('done', 'filename-fallback.md', {spec: 'issue-intake'});

		const result = isSpecComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});

		expect(result.complete).toBe(true);
		expect(result.tasks.map((s) => s.slug).sort()).toEqual([
			'filename-fallback',
			'real-slug',
		]);
	});

	it('reads cleanly with NO work/ folders present (no throw, NOT complete)', () => {
		// An empty repo (no work/ tree at all) → no tasks → not complete.
		const result = isSpecComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});
		expect(result.complete).toBe(false);
		expect(result.tasks).toEqual([]);
	});
});
