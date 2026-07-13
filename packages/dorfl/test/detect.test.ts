import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findParticipatingRepos, isParticipatingRepo} from '../src/detect.js';

let root: string;

function makeRepo(rel: string, backlogFiles: string[]): string {
	const repo = join(root, rel);
	mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
	for (const f of backlogFiles) {
		writeFileSync(
			join(repo, 'work', 'tasks', 'ready', f),
			'---\nslug: x\n---\n',
		);
	}
	return repo;
}

/** Seed a single work-item `.md` into an arbitrary pool subpath (relative to
 * `work/`), so tests can assert participation off a non-`tasks/ready/` pool. */
function seedPool(rel: string, poolSubpath: string, file: string): string {
	const repo = join(root, rel);
	const dir = join(repo, 'work', ...poolSubpath.split('/'));
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, file), '---\nslug: x\n---\n');
	return repo;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-detect-'));
});

afterEach(() => {
	rmrf(root);
});

describe('isParticipatingRepo', () => {
	it('is true for a repo with a non-empty work/tasks/ready/', () => {
		const repo = makeRepo('alpha', ['a.md']);
		expect(isParticipatingRepo(repo)).toBe(true);
	});

	it('is false for a repo whose work/tasks/ready/ has no .md files and no other pool content', () => {
		const repo = join(root, 'beta');
		mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
		writeFileSync(join(repo, 'work', 'tasks', 'ready', 'notes.txt'), 'hi');
		expect(isParticipatingRepo(repo)).toBe(false);
	});

	it('is false for a repo with no work/ pools at all', () => {
		const repo = join(root, 'gamma');
		mkdirSync(repo, {recursive: true});
		expect(isParticipatingRepo(repo)).toBe(false);
	});

	// Regression: a drained build pool must NOT hide a repo whose LIFECYCLE queues
	// are full. Before this, `tasks/ready/`-only gating made such a repo read as
	// non-participating, so `scan --here` emitted empty lifecycle buckets and CI
	// enumerate silently no-op'd while answered questions sat awaiting apply.
	it('is true when tasks/ready/ is empty but questions/ has an answered sidecar', () => {
		const repo = seedPool('delta', 'questions', 'observation-x.md');
		expect(isParticipatingRepo(repo)).toBe(true);
	});

	it('is true off a staged tasks/backlog/ item alone', () => {
		expect(isParticipatingRepo(seedPool('e1', 'tasks/backlog', 'a.md'))).toBe(
			true,
		);
	});

	it('is true off a proposed prd alone', () => {
		expect(isParticipatingRepo(seedPool('e2', 'specs/proposed', 'p.md'))).toBe(
			true,
		);
	});

	it('is true off a notes/observations item alone', () => {
		expect(
			isParticipatingRepo(seedPool('e3', 'notes/observations', 'o.md')),
		).toBe(true);
	});

	it('is NOT triggered by notes/ideas or notes/findings alone (non-lifecycle capture)', () => {
		expect(isParticipatingRepo(seedPool('i1', 'notes/ideas', 'idea.md'))).toBe(
			false,
		);
		expect(isParticipatingRepo(seedPool('i2', 'notes/findings', 'f.md'))).toBe(
			false,
		);
	});
});

describe('findParticipatingRepos (remote find discovery)', () => {
	it('finds a repo with a non-empty work/tasks/ready/ and skips one without', () => {
		makeRepo('alpha', ['a.md']);
		const beta = join(root, 'beta');
		mkdirSync(beta, {recursive: true});

		const repos = findParticipatingRepos(root);
		expect(repos).toContain(join(root, 'alpha'));
		expect(repos).not.toContain(beta);
	});

	it('skips a repo whose work/tasks/ready/ contains no markdown', () => {
		const empty = join(root, 'empty');
		mkdirSync(join(empty, 'work', 'tasks', 'ready'), {recursive: true});
		writeFileSync(join(empty, 'work', 'tasks', 'ready', 'README.txt'), 'no md');

		const repos = findParticipatingRepos(root);
		expect(repos).not.toContain(empty);
	});

	it('prunes node_modules while walking', () => {
		// A participating repo nested inside node_modules must NOT be found.
		makeRepo(join('node_modules', 'pkg'), ['a.md']);
		makeRepo('real', ['a.md']);

		const repos = findParticipatingRepos(root);
		expect(repos).toContain(join(root, 'real'));
		expect(repos.some((r) => r.includes('node_modules'))).toBe(false);
	});

	it('prunes dotdirs while walking', () => {
		makeRepo(join('.cache', 'pkg'), ['a.md']);
		makeRepo('real', ['a.md']);

		const repos = findParticipatingRepos(root);
		expect(repos).toContain(join(root, 'real'));
		expect(repos.some((r) => r.includes('.cache'))).toBe(false);
	});

	it('finds repos nested several levels deep', () => {
		makeRepo(join('group', 'sub', 'deep'), ['a.md']);
		const repos = findParticipatingRepos(root);
		expect(repos).toContain(join(root, 'group', 'sub', 'deep'));
	});

	it('does not descend into a participating repo to find nested ones', () => {
		// Once a participating repo is found, its own work/ subtree etc. need not
		// yield more repos; but a sibling outside still should.
		makeRepo('outer', ['a.md']);
		makeRepo('sibling', ['a.md']);
		const repos = findParticipatingRepos(root);
		expect(repos).toContain(join(root, 'outer'));
		expect(repos).toContain(join(root, 'sibling'));
	});

	it('returns a sorted list for deterministic output', () => {
		makeRepo('charlie', ['a.md']);
		makeRepo('alpha', ['a.md']);
		makeRepo('bravo', ['a.md']);
		const repos = findParticipatingRepos(root);
		const sorted = [...repos].sort();
		expect(repos).toEqual(sorted);
	});

	it('tolerates a non-existent folder without throwing', () => {
		expect(findParticipatingRepos(join(root, 'does-not-exist'))).toEqual([]);
	});
});
