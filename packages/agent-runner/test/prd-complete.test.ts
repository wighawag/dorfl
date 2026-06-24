import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureFolderRel} from './helpers/gitRepo.js';
import {isPrdComplete} from '../src/prd-complete.js';

let root: string;

/** Seed one `work/<folder>/<file>` task with the given frontmatter. */
function writeTask(
	folder: 'backlog' | 'in-progress' | 'needs-attention' | 'done',
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
	root = mkdtempSync(join(tmpdir(), 'agent-runner-prd-complete-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe('isPrdComplete — the read-only "is this PRD complete?" core query', () => {
	it('NOT complete when NO task carries prd:<slug> (≥1 is required)', () => {
		// A `work/` tree with tasks, but none link to this prd — even other prds'
		// done tasks do not count.
		writeTask('done', 'unrelated-done.md', {slug: 'unrelated-done'});
		writeTask('done', 'other-prd.md', {
			slug: 'other-prd',
			prd: 'some-other-prd',
		});
		writeTask('backlog', 'standalone.md', {slug: 'standalone'});

		const result = isPrdComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});

		expect(result.complete).toBe(false);
		expect(result.tasks).toEqual([]);
	});

	it('NOT complete when ≥1 prd:<slug> task exists but some are NOT in work/tasks/done/', () => {
		// Three tasks link the prd; two are done, one is still in backlog.
		writeTask('done', 'a.md', {slug: 'a', prd: 'issue-intake'});
		writeTask('done', 'b.md', {slug: 'b', prd: 'issue-intake'});
		writeTask('backlog', 'c.md', {slug: 'c', prd: 'issue-intake'});

		const result = isPrdComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});

		expect(result.complete).toBe(false);
		// All three are matched (across folders), sorted by slug.
		expect(result.tasks.map((s) => s.slug)).toEqual(['a', 'b', 'c']);
	});

	it('NOT complete when a matching task is in in-progress or needs-attention (not done)', () => {
		writeTask('done', 'a.md', {slug: 'a', prd: 'issue-intake'});
		writeTask('in-progress', 'b.md', {slug: 'b', prd: 'issue-intake'});

		expect(
			isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'}).complete,
		).toBe(false);

		// And the needs-attention case is likewise incomplete.
		rmSync(join(root, 'repo', 'work', 'in-progress'), {
			recursive: true,
			force: true,
		});
		writeTask('needs-attention', 'b.md', {slug: 'b', prd: 'issue-intake'});

		expect(
			isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'}).complete,
		).toBe(false);
	});

	it('COMPLETE when ≥1 prd:<slug> task exists and ALL are in work/tasks/done/', () => {
		writeTask('done', 'a.md', {slug: 'a', prd: 'issue-intake'});
		writeTask('done', 'b.md', {slug: 'b', prd: 'issue-intake'});
		// An unrelated, not-done task for a different prd must not block completion.
		writeTask('backlog', 'elsewhere.md', {
			slug: 'elsewhere',
			prd: 'other-prd',
		});

		const result = isPrdComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});

		expect(result.complete).toBe(true);
		expect(result.tasks.map((s) => s.slug)).toEqual(['a', 'b']);
		expect(result.tasks.every((s) => s.folder === 'done')).toBe(true);
	});

	it('COMPLETE with a single done task (≥1 is enough)', () => {
		writeTask('done', 'only.md', {slug: 'only', prd: 'issue-intake'});

		const result = isPrdComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});

		expect(result.complete).toBe(true);
		expect(result.tasks).toHaveLength(1);
	});

	it('matches on the parsed prd: field — resolves task slug from frontmatter, falling back to filename', () => {
		// Frontmatter slug wins; filename fallback when no slug.
		writeTask('done', 'on-disk-name.md', {
			slug: 'real-slug',
			prd: 'issue-intake',
		});
		writeTask('done', 'filename-fallback.md', {prd: 'issue-intake'});

		const result = isPrdComplete({
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
		const result = isPrdComplete({
			repoPath: repoPath(),
			slug: 'issue-intake',
		});
		expect(result.complete).toBe(false);
		expect(result.tasks).toEqual([]);
	});
});
