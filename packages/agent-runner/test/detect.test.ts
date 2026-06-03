import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {detectRepos, isParticipatingRepo} from '../src/detect.js';

let root: string;

function makeRepo(rel: string, backlogFiles: string[]): string {
	const repo = join(root, rel);
	mkdirSync(join(repo, 'work', 'backlog'), {recursive: true});
	for (const f of backlogFiles) {
		writeFileSync(join(repo, 'work', 'backlog', f), '---\nslug: x\n---\n');
	}
	return repo;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'agent-runner-detect-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe('isParticipatingRepo', () => {
	it('is true for a repo with a non-empty work/backlog/', () => {
		const repo = makeRepo('alpha', ['a.md']);
		expect(isParticipatingRepo(repo)).toBe(true);
	});

	it('is false for a repo whose work/backlog/ has no .md files', () => {
		const repo = join(root, 'beta');
		mkdirSync(join(repo, 'work', 'backlog'), {recursive: true});
		writeFileSync(join(repo, 'work', 'backlog', 'notes.txt'), 'hi');
		expect(isParticipatingRepo(repo)).toBe(false);
	});

	it('is false for a repo with no work/backlog/ at all', () => {
		const repo = join(root, 'gamma');
		mkdirSync(repo, {recursive: true});
		expect(isParticipatingRepo(repo)).toBe(false);
	});
});

describe('detectRepos', () => {
	it('detects a repo with a non-empty work/backlog/ and skips one without', () => {
		makeRepo('alpha', ['a.md']);
		const beta = join(root, 'beta');
		mkdirSync(beta, {recursive: true});

		const repos = detectRepos({roots: [root], include: [], exclude: []});
		expect(repos).toContain(join(root, 'alpha'));
		expect(repos).not.toContain(beta);
	});

	it('skips a repo whose work/backlog/ contains no markdown', () => {
		const empty = join(root, 'empty');
		mkdirSync(join(empty, 'work', 'backlog'), {recursive: true});
		writeFileSync(join(empty, 'work', 'backlog', 'README.txt'), 'no md');

		const repos = detectRepos({roots: [root], include: [], exclude: []});
		expect(repos).not.toContain(empty);
	});

	it('prunes node_modules while walking', () => {
		// A participating repo nested inside node_modules must NOT be found.
		makeRepo(join('node_modules', 'pkg'), ['a.md']);
		makeRepo('real', ['a.md']);

		const repos = detectRepos({roots: [root], include: [], exclude: []});
		expect(repos).toContain(join(root, 'real'));
		expect(repos.some((r) => r.includes('node_modules'))).toBe(false);
	});

	it('prunes dotdirs while walking', () => {
		makeRepo(join('.cache', 'pkg'), ['a.md']);
		makeRepo('real', ['a.md']);

		const repos = detectRepos({roots: [root], include: [], exclude: []});
		expect(repos).toContain(join(root, 'real'));
		expect(repos.some((r) => r.includes('.cache'))).toBe(false);
	});

	it('finds repos nested several levels deep', () => {
		makeRepo(join('group', 'sub', 'deep'), ['a.md']);
		const repos = detectRepos({roots: [root], include: [], exclude: []});
		expect(repos).toContain(join(root, 'group', 'sub', 'deep'));
	});

	it('does not descend into a participating repo to find nested ones', () => {
		// Once a participating repo is found, its own work/ subtree etc. need not
		// yield more repos; but a sibling outside still should.
		makeRepo('outer', ['a.md']);
		makeRepo('sibling', ['a.md']);
		const repos = detectRepos({roots: [root], include: [], exclude: []});
		expect(repos).toContain(join(root, 'outer'));
		expect(repos).toContain(join(root, 'sibling'));
	});

	it('deduplicates across overlapping roots', () => {
		makeRepo('alpha', ['a.md']);
		const repos = detectRepos({roots: [root, root], include: [], exclude: []});
		const alpha = join(root, 'alpha');
		expect(repos.filter((r) => r === alpha)).toHaveLength(1);
	});

	it('excludes a detected repo when its path is in exclude', () => {
		makeRepo('alpha', ['a.md']);
		makeRepo('beta', ['a.md']);
		const repos = detectRepos({
			roots: [root],
			include: [],
			exclude: [join(root, 'beta')],
		});
		expect(repos).toContain(join(root, 'alpha'));
		expect(repos).not.toContain(join(root, 'beta'));
	});

	it('excludes by repo basename too', () => {
		makeRepo('alpha', ['a.md']);
		makeRepo('beta', ['a.md']);
		const repos = detectRepos({roots: [root], include: [], exclude: ['beta']});
		expect(repos).not.toContain(join(root, 'beta'));
		expect(repos).toContain(join(root, 'alpha'));
	});

	it('includes a path that detection would have skipped', () => {
		// `manual` participates by config even though it has no backlog markdown.
		const manual = join(root, 'manual');
		mkdirSync(manual, {recursive: true});
		const repos = detectRepos({
			roots: [root],
			include: [manual],
			exclude: [],
		});
		expect(repos).toContain(manual);
	});

	it('exclude wins over include', () => {
		const repo = makeRepo('alpha', ['a.md']);
		const repos = detectRepos({
			roots: [root],
			include: [repo],
			exclude: [repo],
		});
		expect(repos).not.toContain(repo);
	});

	it('returns a sorted list for deterministic output', () => {
		makeRepo('charlie', ['a.md']);
		makeRepo('alpha', ['a.md']);
		makeRepo('bravo', ['a.md']);
		const repos = detectRepos({roots: [root], include: [], exclude: []});
		const sorted = [...repos].sort();
		expect(repos).toEqual(sorted);
	});

	it('tolerates a non-existent root without throwing', () => {
		makeRepo('alpha', ['a.md']);
		const repos = detectRepos({
			roots: [root, join(root, 'does-not-exist')],
			include: [],
			exclude: [],
		});
		expect(repos).toContain(join(root, 'alpha'));
	});
});
