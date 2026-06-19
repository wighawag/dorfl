import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {
	persistSurfacedQuestions,
	SurfacePersistError,
} from '../src/surface-persist.js';
import {newSidecar, parseSidecar, serialiseSidecar} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';

/**
 * `advance-rung-surface` slice — the engine-owned PERSIST half: the surface rung
 * writes the EMITTED questions to the sidecar (append-or-create) AND sets
 * `needsAnswers:true` on the item body in ONE commit (CAS-atomic under the held
 * lock). House throwaway-git-repo pattern. The slice's acceptance criteria pinned
 * here: one atomic commit (body + sidecar together), append-never-overwrite, a
 * re-surface flips all-answered back, and the empty emit is a clean no-op.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-surface-persist-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Files touched by the HEAD commit (relative paths). */
function filesInHeadCommit(repo: string): string[] {
	return gitIn(['show', '--name-only', '--format=', 'HEAD'], repo)
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l !== '');
}

/** A throwaway repo with one backlog slice (no sidecar yet). */
function seedBacklogItem(slug = 'foo'): {repo: string; itemPath: string} {
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	const itemPath = `work/tasks/todo/${slug}.md`;
	const itemBody = [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		'blockedBy: []',
		'---',
		'',
		'## What to build',
		'',
		'a thing',
		'',
	].join('\n');
	mkdirSync(join(repo, 'work', 'tasks', 'todo'), {recursive: true});
	writeFileSync(join(repo, itemPath), itemBody);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed item'], repo);
	return {repo, itemPath};
}

describe('persistSurfacedQuestions — first pass (CREATE the sidecar + set needsAnswers)', () => {
	it('writes the sidecar + flips needsAnswers:true in ONE commit', () => {
		const {repo, itemPath} = seedBacklogItem();
		const result = persistSurfacedQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			questions: [
				{question: 'A?', context: 'ctx-a'},
				{question: 'B?', default: 'maybe'},
			],
			env: gitEnv(),
		});

		expect(result.outcome).toBe('surfaced');
		expect(result.entryCount).toBe(2);
		expect(result.sidecarPath).toBe('work/questions/slice-foo.md');

		// The sidecar exists with the two questions (stable ids q1, q2).
		const model = parseSidecar(
			readFileSync(join(repo, result.sidecarPath), 'utf8'),
		);
		expect(model.entries.map((e) => e.id)).toEqual(['q1', 'q2']);
		expect(model.entries[0].context).toBe('ctx-a');
		expect(model.entries[1].default).toBe('maybe');

		// needsAnswers:true is set on the item body.
		expect(
			parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8')).needsAnswers,
		).toBe(true);

		// ONE commit touched BOTH the item AND the sidecar (atomic).
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).toContain(result.sidecarPath);
	});

	it('the sidecar path is IDENTITY-keyed (derived from the namespaced item, not the folder)', () => {
		const {repo, itemPath} = seedBacklogItem('bar');
		const result = persistSurfacedQuestions({
			cwd: repo,
			item: 'slice:bar',
			itemPath, // work/tasks/todo/bar.md
			questions: [{question: 'q?'}],
			env: gitEnv(),
		});
		// Path is `<type>-<slug>`, regardless of which lifecycle folder the item rests in.
		expect(result.sidecarPath).toBe('work/questions/slice-bar.md');
	});
});

describe('persistSurfacedQuestions — append-never-overwrite (re-surface)', () => {
	it('APPENDS qN+1 to an existing sidecar, never mutating an answered entry', () => {
		const {repo, itemPath} = seedBacklogItem();
		// Seed a sidecar where q1 is already ANSWERED + needsAnswers true.
		let model = newSidecar('slice:foo', [{question: 'A?'}]);
		model = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'answered A'})),
		};
		const sidecarPath = 'work/questions/slice-foo.md';
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));
		writeFileSync(
			join(repo, itemPath),
			readFileSync(join(repo, itemPath), 'utf8').replace(
				'blockedBy: []',
				'needsAnswers: true\nblockedBy: []',
			),
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed answered sidecar'], repo);

		const result = persistSurfacedQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			questions: [{question: 'B (new)?'}],
			env: gitEnv(),
		});

		expect(result.outcome).toBe('surfaced');
		const after = parseSidecar(readFileSync(join(repo, sidecarPath), 'utf8'));
		// q1 PRESERVED (answer intact), q2 APPENDED (the monotonic next id).
		expect(after.entries.map((e) => e.id)).toEqual(['q1', 'q2']);
		expect(after.entries[0].answer).toBe('answered A');
		expect(after.entries[1].question).toBe('B (new)?');
		expect(after.entries[1].answer).toBe('');
	});

	it('a re-surface flips a previously-ALL-ANSWERED sidecar back to not-all-answered', () => {
		const {repo, itemPath} = seedBacklogItem();
		// All entries answered → allAnswered true on disk.
		let model = newSidecar('slice:foo', [{question: 'A?'}]);
		model = {
			...model,
			entries: model.entries.map((e) => ({...e, answer: 'done'})),
		};
		const sidecarPath = 'work/questions/slice-foo.md';
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'all answered'], repo);
		// Sanity: the seed sidecar reports allAnswered.
		expect(serialiseSidecar(model)).toMatch(/allAnswered: true/);

		persistSurfacedQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			questions: [{question: 'C (new)?'}],
			env: gitEnv(),
		});

		const text = readFileSync(join(repo, sidecarPath), 'utf8');
		// The newly-appended pending entry flips allAnswered back to false.
		expect(text).toMatch(/allAnswered: false/);
	});
});

describe('persistSurfacedQuestions — the empty emit is a clean no-op', () => {
	it('writes NOTHING (no sidecar, item untouched) when the skill surfaced no questions', () => {
		const {repo, itemPath} = seedBacklogItem();
		const before = readFileSync(join(repo, itemPath), 'utf8');
		const headBefore = gitIn(['rev-parse', 'HEAD'], repo).trim();

		const result = persistSurfacedQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			questions: [],
			env: gitEnv(),
		});

		expect(result.outcome).toBe('nothing');
		expect(result.commit).toBeUndefined();
		// No sidecar written; the item body untouched; no commit produced.
		expect(existsSync(join(repo, 'work', 'questions', 'slice-foo.md'))).toBe(
			false,
		);
		expect(readFileSync(join(repo, itemPath), 'utf8')).toBe(before);
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).toBe(headBefore);
	});
});

describe('persistSurfacedQuestions — usage errors', () => {
	it('throws when not inside a git repository', () => {
		const dir = join(scratch.root, 'not-a-repo');
		mkdirSync(dir, {recursive: true});
		expect(() =>
			persistSurfacedQuestions({
				cwd: dir,
				item: 'slice:foo',
				itemPath: 'work/tasks/todo/foo.md',
				questions: [{question: 'q?'}],
				env: gitEnv(),
			}),
		).toThrow(SurfacePersistError);
	});
});
