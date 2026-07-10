import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {
	applyAnsweredQuestions,
	ApplyPersistError,
	resolveItemPathByIdentity,
	OPEN_QUESTIONS_MARKER_OPEN,
	OPEN_QUESTIONS_MARKER_CLOSE,
} from '../src/apply-persist.js';
import {
	newSidecar,
	parseSidecar,
	serialiseSidecar,
	type SidecarModel,
} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {
	makeScratch,
	gitEnv,
	gitIn,
	fixtureFolderRel,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * `advance-rung-apply` task (PRD `advance-loop`, US #11/14/15/29/30) — the
 * engine-owned APPLY persist over a throwaway git repo (the house pattern the
 * surface-persist / sidecar-apply tests use). The task's acceptance criteria
 * pinned here:
 *
 *   - all-answered → apply the HUMAN's answers ATOMICALLY (item body + sidecar in
 *     ONE commit, via the sidecar contract's atomic-apply);
 *   - either APPENDS new questions (stays needsAnswers:true, re-pauses) OR resolves
 *     fully (clears needsAnswers + deletes the sidecar in the SAME commit) OR
 *     discharges the source BY DELETION (`discharge` set — `git rm` source +
 *     sidecar in a standalone revertible commit, the reason in the message);
 *   - the disposition VOCABULARY is GONE (task
 *     `agentic-apply-retire-disposition-vocabulary`): there is no `disposition`
 *     field, no most-decisive picker, no `keep`/`triaged:keep`. A sidecar entry is
 *     BINARY (no-answer | answered); what to DO with an answered observation is the
 *     AGENTIC apply decision (advance.ts), which routes here (re-pause / discharge /
 *     via promoteObservation for a mint);
 *   - applying NEVER invents an answer (only applies human-authored answers);
 *   - a SUBSET-answered sidecar is NOT applied (the persist refuses it loudly — the
 *     classifier NO-OPs it before it ever reaches here).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-apply-persist-');
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

/** The full HEAD commit message (subject + body). */
function headCommitMessage(repo: string): string {
	return gitIn(['log', '-1', '--format=%B', 'HEAD'], repo);
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
}): {repo: string; itemPath: string; sidecarPath: string} {
	const slug = opts.slug ?? 'foo';
	const folder = opts.folder ?? 'backlog';
	const type = opts.type ?? 'task';
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);

	const itemPath = `work/${fixtureFolderRel(folder)}/${slug}.md`;
	mkdirSync(join(repo, 'work', fixtureFolderRel(folder)), {recursive: true});
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
		opts.questions.map((q) => ({
			question: q,
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
			item: 'task:foo',
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
			item: 'task:foo',
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
			/allAnswered=false/,
		);
	});
});

describe('applyAnsweredQuestions — discharge by deletion (the delete-source verdict)', () => {
	it('discharge on an OBSERVATION → the note + sidecar git rm-ed in a STANDALONE revertible commit, reason in the message, no resting residue', () => {
		const {repo, itemPath, sidecarPath} = seed({
			slug: 'note',
			folder: 'observations',
			type: 'observation',
			questions: ['drop it?'],
			answers: ['yes — out of scope now'],
		});

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'observation:note',
			itemPath,
			discharge: {reason: 'yes — out of scope now'},
			env: gitEnv(),
		});

		// The note leaves the inbox by DELETION. The note AND its answered sidecar
		// are gone; the reason rode the commit MESSAGE (git history = archive), NOT a
		// resting body marker.
		expect(result.outcome).toBe('deleted');
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain(itemPath);
		expect(touched).toContain(sidecarPath);
		expect(trackedInHead(repo, itemPath)).toBe(false);
		expect(trackedInHead(repo, sidecarPath)).toBe(false);
		expect(headCommitMessage(repo)).toContain('out of scope now');
	});

	it('discharge fires DIRECT (no preview/confirm) on a WORK ITEM too — same mechanism, source git rm-ed', () => {
		const {repo, itemPath, sidecarPath} = seed({
			slug: 'wi',
			type: 'task',
			questions: ['scrap it?'],
			answers: ['yes, the human ratified the drop'],
		});

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'task:wi',
			itemPath,
			discharge: {reason: 'yes, the human ratified the drop'},
			env: gitEnv(),
		});

		// delete-source is uniform across source types (decision 6): the source is
		// git rm-ed in one revertible commit, the reason in the message.
		expect(result.outcome).toBe('deleted');
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(headCommitMessage(repo)).toContain('ratified the drop');
	});

	it('re-pause WINS over a discharge (you cannot discharge a source you are still asking about)', () => {
		const {repo, itemPath, sidecarPath} = seed({
			questions: ['A?'],
			answers: ['a'],
		});
		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'task:foo',
			itemPath,
			appendQuestions: [{question: 'follow-up?'}],
			discharge: {reason: 'should not fire'},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('repaused');
		// The source is INTACT — re-pause took precedence over the discharge.
		expect(existsSync(join(repo, itemPath))).toBe(true);
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
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
			item: 'task:foo',
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
				item: 'task:foo',
				itemPath,
				env: gitEnv(),
			}),
		).toThrow(ApplyPersistError);
	});

	it('throws when there is no sidecar (the apply rung needs an answered sidecar)', () => {
		const repo = join(scratch.root, 'no-sidecar');
		mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		writeFileSync(
			join(repo, 'work', 'tasks', 'ready', 'foo.md'),
			'---\nslug: foo\nneedsAnswers: true\n---\n\nbody\n',
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed'], repo);
		expect(() =>
			applyAnsweredQuestions({
				cwd: repo,
				item: 'task:foo',
				itemPath: 'work/tasks/ready/foo.md',
				env: gitEnv(),
			}),
		).toThrow(ApplyPersistError);
	});
});

describe('applyAnsweredQuestions — full-resolution RECONCILES the body (strips the marker-fenced open-questions block, prd `apply-reconciles-stale-open-questions`)', () => {
	/**
	 * Re-seed with a body that carries a marker-fenced open-questions block (the
	 * shape the templates sibling task will introduce). The reconcile must strip
	 * exactly that block on a full-resolution apply, leave it intact on a re-pause,
	 * and behave as today on items WITHOUT the marker pair.
	 */
	function seedWithMarkerBlock(opts: {
		slug?: string;
		questions: string[];
		answers?: string[];
	}): {repo: string; itemPath: string; sidecarPath: string} {
		const slug = opts.slug ?? 'foo';
		const repo = join(scratch.root, 'project');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);

		const itemPath = `work/${fixtureFolderRel('backlog')}/${slug}.md`;
		mkdirSync(join(repo, 'work', fixtureFolderRel('backlog')), {
			recursive: true,
		});
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
				OPEN_QUESTIONS_MARKER_OPEN,
				'',
				'## Open questions (clear needsAnswers when resolved)',
				'',
				'- STALE-OPEN-QUESTION-MARKER',
				'',
				OPEN_QUESTIONS_MARKER_CLOSE,
				'',
				'## Tail',
				'',
				'tail prose',
				'',
			].join('\n'),
		);

		let model: SidecarModel = newSidecar(
			`task:${slug}`,
			opts.questions.map((q) => ({question: q})),
		);
		model = {
			...model,
			entries: model.entries.map((e, i) => ({
				...e,
				answer: opts.answers?.[i] ?? `answer-${e.id}`,
			})),
		};
		const sidecarPath = `work/questions/task-${slug}.md`;
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));

		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed item (marker-fenced) + sidecar'], repo);
		return {repo, itemPath, sidecarPath};
	}

	it('marker-present full-resolution → strips the fenced block, records ## Applied answers, deletes the sidecar, clears needsAnswers', () => {
		const {repo, itemPath, sidecarPath} = seedWithMarkerBlock({
			questions: ['A?'],
			answers: ['a'],
		});

		applyAnsweredQuestions({
			cwd: repo,
			item: 'task:foo',
			itemPath,
			env: gitEnv(),
		});

		const body = readFileSync(join(repo, itemPath), 'utf8');
		// The fenced transient block is GONE — markers AND fenced content stripped.
		expect(body).not.toContain(OPEN_QUESTIONS_MARKER_OPEN);
		expect(body).not.toContain(OPEN_QUESTIONS_MARKER_CLOSE);
		expect(body).not.toContain('STALE-OPEN-QUESTION-MARKER');
		// The surrounding body content is preserved.
		expect(body).toContain('## What to build');
		expect(body).toContain('## Tail');
		expect(body).toContain('tail prose');
		// The full-resolution invariants still hold: applied-answers recorded,
		// sidecar deleted, needsAnswers cleared.
		expect(body).toContain('## Applied answers');
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(parseFrontmatter(body).needsAnswers).toBe(false);
	});

	it('marker-present RE-PAUSE → block is RETAINED (reconcile only fires on full resolution, D3)', () => {
		const {repo, itemPath, sidecarPath} = seedWithMarkerBlock({
			questions: ['A?'],
			answers: ['a'],
		});

		applyAnsweredQuestions({
			cwd: repo,
			item: 'task:foo',
			itemPath,
			appendQuestions: [{question: 'follow-up?'}],
			env: gitEnv(),
		});

		const body = readFileSync(join(repo, itemPath), 'utf8');
		// The block is STILL open: markers AND fenced content preserved verbatim.
		expect(body).toContain(OPEN_QUESTIONS_MARKER_OPEN);
		expect(body).toContain(OPEN_QUESTIONS_MARKER_CLOSE);
		expect(body).toContain('STALE-OPEN-QUESTION-MARKER');
		// Re-pause invariants hold: sidecar present, needsAnswers stays true.
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
		expect(parseFrontmatter(body).needsAnswers).toBe(true);
	});

	it('marker-ABSENT full-resolution → behaves exactly as today (no strip, no crash, backward compat D1)', () => {
		// The default seed() body carries NO marker pair — apply must be a pure
		// append, byte-for-byte identical to today's behaviour on legacy items.
		const {repo, itemPath} = seed({questions: ['A?'], answers: ['a']});
		const before = readFileSync(join(repo, itemPath), 'utf8');
		// Task the post-frontmatter prose; the frontmatter legitimately changes
		// (`needsAnswers: true` → `false`), but the BODY prose must be preserved as
		// a prefix — backward compat for items authored without the marker pair.
		const stripFm = (s: string) => s.replace(/^---[\s\S]*?\n---\n/, '');
		const proseBefore = stripFm(before).replace(/\s*$/, '');

		applyAnsweredQuestions({
			cwd: repo,
			item: 'task:foo',
			itemPath,
			env: gitEnv(),
		});

		const after = readFileSync(join(repo, itemPath), 'utf8');
		expect(stripFm(after)).toContain(proseBefore);
		expect(after).toContain('## Applied answers');
	});
});

describe('applyAnsweredQuestions — only the repo it is pointed at is touched', () => {
	it('commits into the test fixture repo, no shared/global location', () => {
		const {repo, itemPath} = seed({questions: ['A?'], answers: ['a']});
		const before = gitIn(['rev-parse', 'HEAD'], repo).trim();
		applyAnsweredQuestions({
			cwd: repo,
			item: 'task:foo',
			itemPath,
			env: gitEnv(),
		});
		const after = gitIn(['rev-parse', 'HEAD'], repo).trim();
		expect(after).not.toBe(before);
		expect(repo.startsWith(scratch.root)).toBe(true);
	});
});

/**
 * F3a (prd `staging-surface-and-apply-promote-safety`) — the apply rung is
 * FOLDER-AGNOSTIC: at write-time it re-resolves the item's CURRENT path by
 * IDENTITY (the symmetric twin of `sidecarPathFor`'s identity-keyed resolution).
 * A concurrent `promote` that `git mv`'d the item from staging into the pool
 * between capture and write MUST NOT cause a stale-path write — the apply
 * commits to the post-move path. If the item has vanished entirely, apply
 * exits clean (the `vanished` outcome, no commit, no ghost file).
 */
describe('applyAnsweredQuestions — resolves the item by IDENTITY at write-time (F3a, folder-agnostic)', () => {
	it('TASK: a concurrent promote `tasks/backlog → tasks/ready` between capture and write — apply commits at the POST-MOVE path, no ghost at the stale path', () => {
		// Seed in STAGING (fixture word `pre-backlog` → `tasks-backlog`).
		const {repo, itemPath, sidecarPath} = seed({
			folder: 'pre-backlog',
			questions: ['ship it?'],
			answers: ['yes'],
		});
		expect(itemPath).toBe('work/tasks/backlog/foo.md');

		// Simulate a concurrent `promote` happening AFTER the caller captured the
		// staging path but BEFORE apply writes: a `git mv` from staging into the
		// pool, committed on the same `main`.
		mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
		gitIn(['mv', 'work/tasks/backlog/foo.md', 'work/tasks/ready/foo.md'], repo);
		gitIn(['commit', '-q', '-m', 'promote: foo backlog → todo'], repo);

		// Apply is called with the STALE captured path — it MUST re-resolve to the
		// post-move path and write there.
		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'task:foo',
			itemPath /* STALE */,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('resolved');
		expect(result.itemPath).toBe('work/tasks/ready/foo.md');
		// The rewrite landed at the POST-MOVE path.
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain('work/tasks/ready/foo.md');
		expect(touched).toContain(sidecarPath);
		// NO ghost file at the stale path — neither in the index nor on disk.
		expect(existsSync(join(repo, 'work/tasks/backlog/foo.md'))).toBe(false);
		expect(trackedInHead(repo, 'work/tasks/backlog/foo.md')).toBe(false);
		// The invariant: needsAnswers cleared + sidecar deleted in the same commit.
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		const fm = parseFrontmatter(
			readFileSync(join(repo, 'work/tasks/ready/foo.md'), 'utf8'),
		);
		expect(fm.needsAnswers).toBe(false);
	});

	it('SPEC (symmetric): a concurrent promote `specs/proposed → specs/ready` — apply commits at the POST-MOVE path', () => {
		const {repo, itemPath, sidecarPath} = seed({
			slug: 'bar',
			folder: 'pre-prd',
			type: 'spec',
			questions: ['scope?'],
			answers: ['narrow'],
		});
		expect(itemPath).toBe('work/specs/proposed/bar.md');

		mkdirSync(join(repo, 'work', 'specs', 'ready'), {recursive: true});
		gitIn(
			['mv', 'work/specs/proposed/bar.md', 'work/specs/ready/bar.md'],
			repo,
		);
		gitIn(['commit', '-q', '-m', 'promote: bar proposed → ready'], repo);

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'spec:bar',
			itemPath /* STALE */,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('resolved');
		expect(result.itemPath).toBe('work/specs/ready/bar.md');
		const touched = filesInHeadCommit(repo);
		expect(touched).toContain('work/specs/ready/bar.md');
		expect(touched).toContain(sidecarPath);
		expect(existsSync(join(repo, 'work/specs/proposed/bar.md'))).toBe(false);
		expect(trackedInHead(repo, 'work/specs/proposed/bar.md')).toBe(false);
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});

	it('VANISHED: the item file is gone between capture and write — apply exits clean, no commit, no ghost file, sidecar UNTOUCHED', () => {
		const {repo, itemPath, sidecarPath} = seed({
			questions: ['ship?'],
			answers: ['yes'],
		});
		// Simulate the item being removed entirely (cancelled/deleted) between
		// capture and write — the sidecar stays (identity-keyed, survives).
		gitIn(['rm', '-q', itemPath], repo);
		gitIn(['commit', '-q', '-m', 'remove item entirely'], repo);
		const headBefore = gitIn(['rev-parse', 'HEAD'], repo).trim();

		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'task:foo',
			itemPath /* STALE — the file is gone */,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('vanished');
		expect(result.commit).toBeUndefined();
		const headAfter = gitIn(['rev-parse', 'HEAD'], repo).trim();
		// No NEW commit — HEAD is exactly where the deletion left it.
		expect(headAfter).toBe(headBefore);
		// The sidecar is UNTOUCHED — apply did not recreate the item or delete the
		// sidecar; the loop simply exited clean.
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
		// No ghost file at the stale path either.
		expect(existsSync(join(repo, itemPath))).toBe(false);
	});

	it('resolveItemPathByIdentity: identity-keyed, finds the item across lifecycle folders + returns undefined when gone', () => {
		const {repo} = seed({
			folder: 'pre-backlog',
			questions: ['ship?'],
			answers: ['yes'],
		});
		// Initially in staging.
		expect(resolveItemPathByIdentity(repo, 'task:foo')).toBe(
			'work/tasks/backlog/foo.md',
		);
		// After a promote, it resolves to the pool path — the resolver is folder-agnostic.
		mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
		gitIn(['mv', 'work/tasks/backlog/foo.md', 'work/tasks/ready/foo.md'], repo);
		gitIn(['commit', '-q', '-m', 'promote'], repo);
		expect(resolveItemPathByIdentity(repo, 'task:foo')).toBe(
			'work/tasks/ready/foo.md',
		);
		// After a full remove, it returns undefined.
		gitIn(['rm', '-q', 'work/tasks/ready/foo.md'], repo);
		gitIn(['commit', '-q', '-m', 'remove'], repo);
		expect(resolveItemPathByIdentity(repo, 'task:foo')).toBeUndefined();
	});
});
