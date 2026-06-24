import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
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

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-detect-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe('isParticipatingRepo', () => {
	it('is true for a repo with a non-empty work/tasks/ready/', () => {
		const repo = makeRepo('alpha', ['a.md']);
		expect(isParticipatingRepo(repo)).toBe(true);
	});

	it('is false for a repo whose work/tasks/ready/ has no .md files', () => {
		const repo = join(root, 'beta');
		mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
		writeFileSync(join(repo, 'work', 'tasks', 'ready', 'notes.txt'), 'hi');
		expect(isParticipatingRepo(repo)).toBe(false);
	});

	it('is false for a repo with no work/tasks/ready/ at all', () => {
		const repo = join(root, 'gamma');
		mkdirSync(repo, {recursive: true});
		expect(isParticipatingRepo(repo)).toBe(false);
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
