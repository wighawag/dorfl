import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isPrdComplete} from '../src/prd-complete.js';

let root: string;

/** Seed one `work/<folder>/<file>` slice with the given frontmatter. */
function writeSlice(
	folder: 'backlog' | 'in-progress' | 'needs-attention' | 'done',
	file: string,
	frontmatter: Record<string, string>,
	body = 'body',
): void {
	const dir = join(root, 'repo', 'work', folder);
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
	it('NOT complete when NO slice carries prd:<slug> (≥1 is required)', () => {
		// A `work/` tree with slices, but none link to this PRD — even other PRDs'
		// done slices do not count.
		writeSlice('done', 'unrelated-done.md', {slug: 'unrelated-done'});
		writeSlice('done', 'other-prd.md', {
			slug: 'other-prd',
			prd: 'some-other-prd',
		});
		writeSlice('backlog', 'standalone.md', {slug: 'standalone'});

		const result = isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'});

		expect(result.complete).toBe(false);
		expect(result.slices).toEqual([]);
	});

	it('NOT complete when ≥1 prd:<slug> slice exists but some are NOT in work/done/', () => {
		// Three slices link the PRD; two are done, one is still in backlog.
		writeSlice('done', 'a.md', {slug: 'a', prd: 'issue-intake'});
		writeSlice('done', 'b.md', {slug: 'b', prd: 'issue-intake'});
		writeSlice('backlog', 'c.md', {slug: 'c', prd: 'issue-intake'});

		const result = isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'});

		expect(result.complete).toBe(false);
		// All three are matched (across folders), sorted by slug.
		expect(result.slices.map((s) => s.slug)).toEqual(['a', 'b', 'c']);
	});

	it('NOT complete when a matching slice is in in-progress or needs-attention (not done)', () => {
		writeSlice('done', 'a.md', {slug: 'a', prd: 'issue-intake'});
		writeSlice('in-progress', 'b.md', {slug: 'b', prd: 'issue-intake'});

		expect(
			isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'}).complete,
		).toBe(false);

		// And the needs-attention case is likewise incomplete.
		rmSync(join(root, 'repo', 'work', 'in-progress'), {
			recursive: true,
			force: true,
		});
		writeSlice('needs-attention', 'b.md', {slug: 'b', prd: 'issue-intake'});

		expect(
			isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'}).complete,
		).toBe(false);
	});

	it('COMPLETE when ≥1 prd:<slug> slice exists and ALL are in work/done/', () => {
		writeSlice('done', 'a.md', {slug: 'a', prd: 'issue-intake'});
		writeSlice('done', 'b.md', {slug: 'b', prd: 'issue-intake'});
		// An unrelated, not-done slice for a different PRD must not block completion.
		writeSlice('backlog', 'elsewhere.md', {
			slug: 'elsewhere',
			prd: 'other-prd',
		});

		const result = isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'});

		expect(result.complete).toBe(true);
		expect(result.slices.map((s) => s.slug)).toEqual(['a', 'b']);
		expect(result.slices.every((s) => s.folder === 'done')).toBe(true);
	});

	it('COMPLETE with a single done slice (≥1 is enough)', () => {
		writeSlice('done', 'only.md', {slug: 'only', prd: 'issue-intake'});

		const result = isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'});

		expect(result.complete).toBe(true);
		expect(result.slices).toHaveLength(1);
	});

	it('matches on the parsed prd: field — resolves slice slug from frontmatter, falling back to filename', () => {
		// Frontmatter slug wins; filename fallback when no slug.
		writeSlice('done', 'on-disk-name.md', {
			slug: 'real-slug',
			prd: 'issue-intake',
		});
		writeSlice('done', 'filename-fallback.md', {prd: 'issue-intake'});

		const result = isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'});

		expect(result.complete).toBe(true);
		expect(result.slices.map((s) => s.slug).sort()).toEqual([
			'filename-fallback',
			'real-slug',
		]);
	});

	it('reads cleanly with NO work/ folders present (no throw, NOT complete)', () => {
		// An empty repo (no work/ tree at all) → no slices → not complete.
		const result = isPrdComplete({repoPath: repoPath(), slug: 'issue-intake'});
		expect(result.complete).toBe(false);
		expect(result.slices).toEqual([]);
	});
});
