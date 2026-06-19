import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {applyAtomic, ApplyAtomicError} from '../src/sidecar-apply.js';
import {newSidecar, parseSidecar, serialiseSidecar} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/** Does `HEAD:<path>` exist in the repo's index/tree? (soft cat-file check). */
function trackedInHead(repo: string, path: string): boolean {
	return (
		run('git', ['cat-file', '-e', `HEAD:${path}`], repo, {env: gitEnv()})
			.status === 0
	);
}

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-sidecar-apply-');
});
afterEach(() => {
	scratch.cleanup();
});

/** A throwaway git repo carrying one backlog item (needsAnswers: true) + its sidecar. */
function seedItemWithSidecar(slug = 'foo'): {
	repo: string;
	itemPath: string;
	sidecarPath: string;
} {
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);

	const itemPath = `work/tasks/todo/${slug}.md`;
	const itemBody = [
		'---',
		`title: ${slug}`,
		`slug: ${slug}`,
		'needsAnswers: true',
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

	// A sidecar with two open questions.
	const sidecarPath = `work/questions/task-${slug}.md`;
	const sidecar = newSidecar(`task:${slug}`, [
		{question: 'A?'},
		{question: 'B?'},
	]);
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(join(repo, sidecarPath), serialiseSidecar(sidecar));

	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed item + sidecar'], repo);
	return {repo, itemPath, sidecarPath};
}

/** The files touched by the HEAD commit (relative paths). */
function filesInHeadCommit(repo: string): string[] {
	return gitIn(['show', '--name-only', '--format=', 'HEAD'], repo)
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l !== '');
}

describe('applyAtomic — re-pause (subset/append, sidecar stays open)', () => {
	it('writes the updated body + sidecar in ONE commit, leaving needsAnswers true', () => {
		const {repo, itemPath, sidecarPath} = seedItemWithSidecar();
		// Answer only q1 → still pending → re-pause.
		const model = parseSidecar(readFileSync(join(repo, sidecarPath), 'utf8'));
		model.entries[0].answer = 'first answer';
		// The apply rung ALSO mutates the item body (e.g. records progress); supply a
		// genuinely-changed body so the one-commit-touches-both guarantee is exercised.
		const newBody =
			readFileSync(join(repo, itemPath), 'utf8') + '\nApplied q1.\n';

		const result = applyAtomic({
			cwd: repo,
			itemPath,
			itemBody: newBody,
			sidecar: model,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('repaused');
		// ONE commit touched BOTH the item and the sidecar.
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).toContain(sidecarPath);
		// The sidecar still exists and carries the answer; needsAnswers still true.
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
		const fm = parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8'));
		expect(fm.needsAnswers).toBe(true);
		const reparsed = parseSidecar(
			readFileSync(join(repo, sidecarPath), 'utf8'),
		);
		expect(reparsed.entries[0].answer).toBe('first answer');
	});
});

describe('applyAtomic — full resolution (clear needsAnswers + delete sidecar)', () => {
	it('on full resolution clears needsAnswers AND deletes the sidecar in the SAME commit', () => {
		const {repo, itemPath, sidecarPath} = seedItemWithSidecar();
		const model = parseSidecar(readFileSync(join(repo, sidecarPath), 'utf8'));
		model.entries[0].answer = 'a';
		model.entries[1].answer = 'b';

		const result = applyAtomic({
			cwd: repo,
			itemPath,
			itemBody: readFileSync(join(repo, itemPath), 'utf8'),
			sidecar: model,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('resolved');
		// The invariant: needsAnswers:false ⟺ no sidecar — both in the SAME commit.
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).toContain(sidecarPath);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		const fm = parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8'));
		expect(fm.needsAnswers).toBe(false);
		// And git agrees the sidecar is gone from the tree.
		expect(trackedInHead(repo, sidecarPath)).toBe(false);
	});

	it('derives resolution from the entries (mode optional)', () => {
		const {repo, itemPath, sidecarPath} = seedItemWithSidecar();
		const model = parseSidecar(readFileSync(join(repo, sidecarPath), 'utf8'));
		model.entries.forEach((e) => (e.answer = 'x'));
		const result = applyAtomic({
			cwd: repo,
			itemPath,
			sidecar: model,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('resolved');
	});
});

describe('applyAtomic — refuses a torn invariant', () => {
	it('throws when mode=resolve but entries are still pending', () => {
		const {repo, itemPath, sidecarPath} = seedItemWithSidecar();
		const model = parseSidecar(readFileSync(join(repo, sidecarPath), 'utf8'));
		model.entries[0].answer = 'only one';
		expect(() =>
			applyAtomic({
				cwd: repo,
				itemPath,
				sidecar: model,
				mode: 'resolve',
				env: gitEnv(),
			}),
		).toThrow(ApplyAtomicError);
	});

	it('throws when mode=repause but every entry is answered', () => {
		const {repo, itemPath, sidecarPath} = seedItemWithSidecar();
		const model = parseSidecar(readFileSync(join(repo, sidecarPath), 'utf8'));
		model.entries.forEach((e) => (e.answer = 'x'));
		expect(() =>
			applyAtomic({
				cwd: repo,
				itemPath,
				sidecar: model,
				mode: 'repause',
				env: gitEnv(),
			}),
		).toThrow(ApplyAtomicError);
	});
});

describe('applyAtomic — only the repo it is pointed at is touched', () => {
	it('commits into the test fixture repo, no shared/global location', () => {
		const {repo, itemPath, sidecarPath} = seedItemWithSidecar();
		const model = parseSidecar(readFileSync(join(repo, sidecarPath), 'utf8'));
		model.entries.forEach((e) => (e.answer = 'x'));
		const before = gitIn(['rev-parse', 'HEAD'], repo).trim();
		applyAtomic({cwd: repo, itemPath, sidecar: model, env: gitEnv()});
		const after = gitIn(['rev-parse', 'HEAD'], repo).trim();
		expect(after).not.toBe(before);
		// The fixture lives entirely under the scratch root.
		expect(repo.startsWith(scratch.root)).toBe(true);
	});
});
