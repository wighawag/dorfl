import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {
	applyAnsweredQuestions,
	ApplyPersistError,
	isTriagedKeep,
} from '../src/apply-persist.js';
import {
	newSidecar,
	parseSidecar,
	serialiseSidecar,
	type SidecarModel,
	type SidecarDisposition,
} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * `advance-rung-apply` slice (PRD `advance-loop`, US #11/14/15/29/30) — the
 * engine-owned APPLY persist over a throwaway git repo (the house pattern the
 * surface-persist / sidecar-apply tests use). The slice's acceptance criteria
 * pinned here:
 *
 *   - all-answered → apply the HUMAN's answers ATOMICALLY (item body + sidecar in
 *     ONE commit, via the sidecar contract's atomic-apply);
 *   - either APPENDS new questions (stays needsAnswers:true, re-pauses) OR resolves
 *     fully (clears needsAnswers + deletes the sidecar in the SAME commit);
 *   - an answer can disposition the item to ANY terminal (advance / out-of-scope /
 *     needs-attention / keep / delete) via the `disposition` field;
 *   - a "keep" answer stamps `triaged:keep` + drops out of the pool;
 *   - applying NEVER invents an answer (only applies human-authored answers);
 *   - a SUBSET-answered sidecar is NOT applied (the persist refuses it loudly — the
 *     classifier NO-OPs it before it ever reaches here).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-apply-persist-');
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

/** Does `HEAD:<path>` exist in the repo's index/tree? */
function trackedInHead(repo: string, path: string): boolean {
	return (
		run('git', ['cat-file', '-e', `HEAD:${path}`], repo, {env: gitEnv()})
			.status === 0
	);
}

/**
 * Seed a throwaway repo with one item (needsAnswers:true) + its sidecar carrying
 * the given questions; the `answers`/`dispositions` arrays seed each entry's
 * answered-state (an empty answer ⇒ unanswered) so a test can build any cell.
 */
function seed(opts: {
	slug?: string;
	folder?: string;
	type?: string;
	questions: string[];
	answers?: (string | undefined)[];
	dispositions?: (SidecarDisposition | undefined)[];
}): {repo: string; itemPath: string; sidecarPath: string} {
	const slug = opts.slug ?? 'foo';
	const folder = opts.folder ?? 'backlog';
	const type = opts.type ?? 'slice';
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);

	const itemPath = `work/${folder}/${slug}.md`;
	mkdirSync(join(repo, 'work', folder), {recursive: true});
	writeFileSync(
		join(repo, itemPath),
		[
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
		].join('\n'),
	);

	let model: SidecarModel = newSidecar(
		`${type}:${slug}`,
		opts.questions.map((q, i) => ({
			question: q,
			disposition: opts.dispositions?.[i],
		})),
	);
	model = {
		...model,
		entries: model.entries.map((e, i) => ({
			...e,
			answer: opts.answers?.[i] ?? `answer-${e.id}`,
		})),
	};
	const sidecarPath = `work/questions/${type}-${slug}.md`;
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));

	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed item + answered sidecar'], repo);
	return {repo, itemPath, sidecarPath};
}

describe('applyAnsweredQuestions — resolve fully (the default, all answered)', () => {
	it('applies the answers + clears needsAnswers + DELETES the sidecar in ONE commit', () => {
		const {repo, itemPath, sidecarPath} = seed({
			questions: ['A?', 'B?'],
			answers: ['a', 'b'],
		});

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('resolved');
		// ONE commit touched BOTH the item AND the sidecar (atomic).
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).toContain(sidecarPath);
		// The invariant: needsAnswers:false ⟺ no sidecar — both in the SAME commit.
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(trackedInHead(repo, sidecarPath)).toBe(false);
		const fm = parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8'));
		expect(fm.needsAnswers).toBe(false);
		// The applied answers are recorded VERBATIM in the body (never invented).
		const body = readFileSync(join(repo, itemPath), 'utf8');
		expect(body).toContain('## Applied answers');
		expect(body).toContain('a');
		expect(body).toContain('b');
	});
});

describe('applyAnsweredQuestions — append / re-pause (new questions discovered)', () => {
	it('APPENDS qN+1 + stays needsAnswers:true (re-paused), sidecar present, ONE commit', () => {
		const {repo, itemPath, sidecarPath} = seed({
			questions: ['A?'],
			answers: ['a'],
		});

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			appendQuestions: [{question: 'follow-up?'}],
			env: gitEnv(),
		});

		expect(result.outcome).toBe('repaused');
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).toContain(sidecarPath);
		// The sidecar STILL exists; needsAnswers stays true (re-paused).
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
		expect(
			parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8')).needsAnswers,
		).toBe(true);
		// q1 preserved (answer intact), q2 appended (pending), all-answered flips back.
		const model = parseSidecar(readFileSync(join(repo, sidecarPath), 'utf8'));
		expect(model.entries.map((e) => e.id)).toEqual(['q1', 'q2']);
		expect(model.entries[0].answer).toBe('a');
		expect(model.entries[1].question).toBe('follow-up?');
		expect(model.entries[1].answer).toBe('');
		expect(readFileSync(join(repo, sidecarPath), 'utf8')).toMatch(
			/allAnswered: false/,
		);
	});
});

describe('applyAnsweredQuestions — disposition to ANY terminal (US #29)', () => {
	it('out-of-scope → resolves the Q&A AND moves the item to work/out-of-scope/', () => {
		const {repo, itemPath, sidecarPath} = seed({
			questions: ['ship it?'],
			answers: ['no'],
			dispositions: ['out-of-scope'],
		});

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('out-of-scope');
		// The Q&A was resolved (sidecar deleted) and the item moved folders.
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(existsSync(join(repo, 'work', 'out-of-scope', 'foo.md'))).toBe(true);
		expect(result.itemPath).toBe('work/out-of-scope/foo.md');
	});

	it('needs-attention → resolves the Q&A AND bounces the item to work/needs-attention/', () => {
		const {repo, itemPath, sidecarPath} = seed({
			questions: ['unclear?'],
			answers: ['take it to a human'],
			dispositions: ['needs-attention'],
		});

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('needs-attention');
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(existsSync(join(repo, 'work', 'needs-attention', 'foo.md'))).toBe(
			true,
		);
	});

	it('delete → resolves + RECOMMENDS deletion (the agent never auto-deletes the file)', () => {
		const {repo, itemPath, sidecarPath} = seed({
			slug: 'dup',
			folder: 'observations',
			type: 'observation',
			questions: ['keep or drop?'],
			answers: ['drop — exact duplicate'],
			dispositions: ['delete'],
		});

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'observation:dup',
			itemPath,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('delete-recommended');
		// The Q&A resolved (sidecar gone) but the FILE is still present (human deletes).
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(existsSync(join(repo, itemPath))).toBe(true);
		expect(readFileSync(join(repo, itemPath), 'utf8')).toContain(
			'## Recommended: delete',
		);
	});

	it('the most-decisive terminal wins when dispositions are spread across entries', () => {
		// keep + out-of-scope + needs-attention present → needs-attention (most decisive).
		const {repo, itemPath} = seed({
			questions: ['q1?', 'q2?', 'q3?'],
			answers: ['a', 'b', 'c'],
			dispositions: ['keep', 'out-of-scope', 'needs-attention'],
		});
		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('needs-attention');
		expect(existsSync(join(repo, 'work', 'needs-attention', 'foo.md'))).toBe(
			true,
		);
	});
});

describe('applyAnsweredQuestions — a "keep" answer drops the item out of the pool (US #30)', () => {
	it('stamps triaged:keep + resolves the Q&A in one commit; the item is never re-asked', () => {
		const {repo, itemPath, sidecarPath} = seed({
			slug: 'note',
			folder: 'observations',
			type: 'observation',
			questions: ['promote/keep/delete?'],
			answers: ['keep — settled, no action'],
			dispositions: ['keep'],
		});

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'observation:note',
			itemPath,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('kept');
		const body = readFileSync(join(repo, itemPath), 'utf8');
		// triaged:keep marker present → drops out of the candidate pool.
		expect(isTriagedKeep(body)).toBe(true);
		// The Q&A is resolved: needsAnswers cleared + sidecar deleted (same commit).
		expect(parseFrontmatter(body).needsAnswers).toBe(false);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).toContain(sidecarPath);
	});
});

describe('applyAnsweredQuestions — NEVER invents an answer (always allowed, only applies human answers)', () => {
	it('records the human answers VERBATIM and authors none of its own', () => {
		const {repo, itemPath} = seed({
			questions: ['what scope?'],
			answers: ['EXACTLY-WHAT-THE-HUMAN-WROTE'],
		});
		applyAnsweredQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			env: gitEnv(),
		});
		const body = readFileSync(join(repo, itemPath), 'utf8');
		expect(body).toContain('EXACTLY-WHAT-THE-HUMAN-WROTE');
	});

	it('REFUSES a subset-answered sidecar (a classifier NO-OP, never an apply)', () => {
		// q2 unanswered (empty answer) → NOT all-answered → the persist refuses loudly.
		const {repo, itemPath} = seed({
			questions: ['A?', 'B?'],
			answers: ['a', ''],
		});
		expect(() =>
			applyAnsweredQuestions({
				cwd: repo,
				item: 'slice:foo',
				itemPath,
				env: gitEnv(),
			}),
		).toThrow(ApplyPersistError);
	});

	it('throws when there is no sidecar (the apply rung needs an answered sidecar)', () => {
		const repo = join(scratch.root, 'no-sidecar');
		mkdirSync(join(repo, 'work', 'backlog'), {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		writeFileSync(
			join(repo, 'work', 'backlog', 'foo.md'),
			'---\nslug: foo\nneedsAnswers: true\n---\n\nbody\n',
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed'], repo);
		expect(() =>
			applyAnsweredQuestions({
				cwd: repo,
				item: 'slice:foo',
				itemPath: 'work/backlog/foo.md',
				env: gitEnv(),
			}),
		).toThrow(ApplyPersistError);
	});
});

describe('applyAnsweredQuestions — only the repo it is pointed at is touched', () => {
	it('commits into the test fixture repo, no shared/global location', () => {
		const {repo, itemPath} = seed({questions: ['A?'], answers: ['a']});
		const before = gitIn(['rev-parse', 'HEAD'], repo).trim();
		applyAnsweredQuestions({
			cwd: repo,
			item: 'slice:foo',
			itemPath,
			env: gitEnv(),
		});
		const after = gitIn(['rev-parse', 'HEAD'], repo).trim();
		expect(after).not.toBe(before);
		expect(repo.startsWith(scratch.root)).toBe(true);
	});
});
