import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {
	surfaceMergeQuestions,
	listUnmergedWorkBranchesViaGit,
	type MergeQuestionPullRequest,
	type UnmergedWorkBranch,
} from '../src/merge-question-surfacer.js';
import {parseSidecar, sidecarPathFor} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';

/**
 * `merge-question-surfacer` task (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, US #14) — the SECOND,
 * STATE-sourced surfacer. The acceptance criteria pinned here:
 *
 *   - enumerates unmerged `work/*` branches by reachability against `main`
 *     (the git-alone FLOOR);
 *   - layers PR metadata via `gh pr list` when a GitHub arbiter is configured
 *     (the CEILING), as ENRICHMENT only;
 *   - emits BINARY sidecar entries STAMPED `kind: merge` (the typed dispatch
 *     field from `sidecar-kind-field`); the `merge | hold | drop` menu rides
 *     `default` as a HUMAN HINT only — never a machine signal;
 *   - works on a bare arbiter (no host required);
 *   - the empty case surfaces nothing.
 *
 * Tests NEVER hit real GitHub: the `gh pr list` ceiling is the injected
 * `listOpenPullRequests` seam, and even the floor seam can be injected for the
 * isolated-from-git path. Global git config is isolated by `gitEnv()` per the
 * task-template rule.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-merge-q-surfacer-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Seed a repo with a base commit on `main` and a backlog task body. */
function seedRepo(slugs: string[]): {repo: string} {
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);
	// Seed a root commit on main so `merge-base --is-ancestor` is meaningful.
	writeFileSync(join(repo, 'README.md'), '# seed\n');
	mkdirSync(join(repo, 'work', 'tasks', 'ready'), {recursive: true});
	for (const slug of slugs) {
		const itemPath = `work/tasks/ready/${slug}.md`;
		writeFileSync(
			join(repo, itemPath),
			[
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
			].join('\n'),
		);
	}
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed'], repo);
	return {repo};
}

/**
 * Create a `work/<slug>` branch with ONE extra commit so its tip is NOT
 * reachable from `main`. Leaves the working tree back on `main`.
 */
function makeUnmergedWorkBranch(repo: string, slug: string): void {
	gitIn(['checkout', '-q', '-b', `work/${slug}`], repo);
	writeFileSync(join(repo, `work-${slug}.txt`), `pushed work for ${slug}\n`);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `work/${slug}: pushed work`], repo);
	gitIn(['checkout', '-q', 'main'], repo);
}

describe('surfaceMergeQuestions — empty case', () => {
	it('emits NOTHING when there are no `work/*` branches', () => {
		const {repo} = seedRepo([]);
		const result = surfaceMergeQuestions({
			cwd: repo,
			env: gitEnv(),
		});
		expect(result.considered).toBe(0);
		expect(result.surfaced).toEqual([]);
		expect(result.skipped).toEqual([]);
		// No sidecar file written anywhere.
		expect(existsSync(join(repo, 'work', 'questions'))).toBe(false);
	});

	it('emits NOTHING when every `work/*` branch is already reachable from main', () => {
		const {repo} = seedRepo(['foo']);
		// Create work/foo and MERGE it into main so it is reachable.
		gitIn(['checkout', '-q', '-b', 'work/foo'], repo);
		writeFileSync(join(repo, 'foo.txt'), 'merged work\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'work/foo: done'], repo);
		gitIn(['checkout', '-q', 'main'], repo);
		gitIn(['merge', '-q', '--no-ff', '-m', 'merge work/foo', 'work/foo'], repo);

		const result = surfaceMergeQuestions({cwd: repo, env: gitEnv()});
		expect(result.considered).toBe(0);
		expect(result.surfaced).toEqual([]);
	});
});

describe('surfaceMergeQuestions — bare arbiter / no-host FLOOR', () => {
	it('enumerates unmerged `work/*` branches and emits one BINARY merge-question per branch, stamped `kind: merge`', () => {
		const {repo} = seedRepo(['foo']);
		makeUnmergedWorkBranch(repo, 'foo');

		const result = surfaceMergeQuestions({
			cwd: repo,
			// arbiterUrl omitted ⇒ NoneProvider semantics: no `gh pr list` runs.
			env: gitEnv(),
		});

		expect(result.considered).toBe(1);
		expect(result.surfaced).toHaveLength(1);
		expect(result.skipped).toEqual([]);

		const row = result.surfaced[0];
		expect(row.item).toBe('task:foo');
		expect(row.ref).toBe('work/foo');
		expect(row.sidecarPath).toBe(sidecarPathFor('task:foo'));
		expect(row.prUrl).toBeUndefined();

		// The sidecar carries ONE entry with `kind: merge` and the `merge | hold |
		// drop` HINT in `default` — NEVER a `disposition=` field.
		const sidecarText = readFileSync(join(repo, row.sidecarPath), 'utf8');
		expect(sidecarText).not.toMatch(/disposition=/);
		const model = parseSidecar(sidecarText);
		expect(model.entries).toHaveLength(1);
		const entry = model.entries[0];
		expect(entry.kind).toBe('merge');
		expect(entry.default).toBe('merge | hold | drop');
		expect(entry.answer).toBe('');
		// The persist set `needsAnswers:true` on the item body atomically.
		expect(
			parseFrontmatter(
				readFileSync(join(repo, 'work/tasks/ready/foo.md'), 'utf8'),
			).needsAnswers,
		).toBe(true);
	});

	it('does NOT call the CEILING seam when the arbiter is not GitHub-shaped', () => {
		const {repo} = seedRepo(['foo']);
		makeUnmergedWorkBranch(repo, 'foo');

		let ghCalls = 0;
		surfaceMergeQuestions({
			cwd: repo,
			arbiterUrl: 'file:///some/bare/arbiter.git',
			env: gitEnv(),
			listOpenPullRequests: () => {
				ghCalls += 1;
				return new Map();
			},
		});
		expect(ghCalls).toBe(0);
	});

	it('is IDEMPOTENT — a second run skips a branch whose sidecar already carries a pending `kind: merge` entry', () => {
		const {repo} = seedRepo(['foo']);
		makeUnmergedWorkBranch(repo, 'foo');

		surfaceMergeQuestions({cwd: repo, env: gitEnv()});
		const second = surfaceMergeQuestions({cwd: repo, env: gitEnv()});

		expect(second.surfaced).toEqual([]);
		expect(second.skipped).toEqual([
			{
				ref: 'work/foo',
				slug: 'foo',
				reason: 'already-pending-merge-question',
			},
		]);
		// Still exactly ONE entry in the sidecar — never a duplicate.
		const model = parseSidecar(
			readFileSync(join(repo, sidecarPathFor('task:foo')), 'utf8'),
		);
		expect(model.entries).toHaveLength(1);
	});

	it('SKIPS a branch with no task body on `main` (the `branch:`-keyed identity is out of scope for this task)', () => {
		const {repo} = seedRepo([]); // no item body for the orphan branch
		makeUnmergedWorkBranch(repo, 'orphan');
		const result = surfaceMergeQuestions({cwd: repo, env: gitEnv()});
		expect(result.considered).toBe(1);
		expect(result.surfaced).toEqual([]);
		expect(result.skipped).toEqual([
			{ref: 'work/orphan', slug: 'orphan', reason: 'no-item-body'},
		]);
	});
});

describe('surfaceMergeQuestions — GitHub-configured CEILING (mocked `gh pr list`)', () => {
	it('enriches the question CONTEXT with PR metadata from the injected seam, never shelling real `gh`', () => {
		const {repo} = seedRepo(['foo', 'bar']);
		makeUnmergedWorkBranch(repo, 'foo');
		makeUnmergedWorkBranch(repo, 'bar');

		const prMap = new Map<string, MergeQuestionPullRequest>([
			[
				'work/foo',
				{
					number: 42,
					url: 'https://github.com/o/r/pull/42',
					title: 'land foo',
					state: 'OPEN',
				},
			],
		]);

		let seamCalled = 0;
		const result = surfaceMergeQuestions({
			cwd: repo,
			arbiterUrl: 'https://github.com/o/r.git',
			env: gitEnv(),
			listOpenPullRequests: () => {
				seamCalled += 1;
				return prMap;
			},
		});

		expect(seamCalled).toBe(1);
		expect(result.surfaced).toHaveLength(2);

		const byRef = new Map(result.surfaced.map((r) => [r.ref, r]));
		expect(byRef.get('work/foo')?.prUrl).toBe('https://github.com/o/r/pull/42');
		expect(byRef.get('work/bar')?.prUrl).toBeUndefined();

		const fooSidecar = parseSidecar(
			readFileSync(join(repo, byRef.get('work/foo')!.sidecarPath), 'utf8'),
		);
		expect(fooSidecar.entries[0].kind).toBe('merge');
		expect(fooSidecar.entries[0].default).toBe('merge | hold | drop');
		expect(fooSidecar.entries[0].context).toMatch(/PR #42/);
		expect(fooSidecar.entries[0].context).toMatch(
			/github\.com\/o\/r\/pull\/42/,
		);

		// The bar branch — no PR matched — still surfaces, with the
		// no-host-metadata note in its context.
		const barSidecar = parseSidecar(
			readFileSync(join(repo, byRef.get('work/bar')!.sidecarPath), 'utf8'),
		);
		expect(barSidecar.entries[0].kind).toBe('merge');
		expect(barSidecar.entries[0].context).toMatch(/git-alone floor/);
	});

	it('degrades silently when the CEILING seam throws — the FLOOR still surfaces', () => {
		const {repo} = seedRepo(['foo']);
		makeUnmergedWorkBranch(repo, 'foo');
		const notes: string[] = [];
		const result = surfaceMergeQuestions({
			cwd: repo,
			arbiterUrl: 'git@github.com:o/r.git',
			env: gitEnv(),
			listOpenPullRequests: () => {
				throw new Error('simulated gh outage');
			},
			note: (m) => notes.push(m),
		});
		expect(result.surfaced).toHaveLength(1);
		expect(result.surfaced[0].prUrl).toBeUndefined();
		expect(notes.some((n) => n.includes('gh pr list failed'))).toBe(true);
	});
});

describe('listUnmergedWorkBranchesViaGit — the production FLOOR', () => {
	it('returns only `work/*` branches whose tip is not reachable from `<base>`', () => {
		const {repo} = seedRepo(['foo', 'bar']);
		makeUnmergedWorkBranch(repo, 'foo');
		// `work/bar` is created and MERGED into main → must NOT appear.
		gitIn(['checkout', '-q', '-b', 'work/bar'], repo);
		writeFileSync(join(repo, 'bar.txt'), 'merged\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'work/bar: done'], repo);
		gitIn(['checkout', '-q', 'main'], repo);
		gitIn(['merge', '-q', '--no-ff', '-m', 'merge work/bar', 'work/bar'], repo);
		// And a non-work branch must be ignored.
		gitIn(['branch', 'feature/x', 'main'], repo);

		const branches: UnmergedWorkBranch[] = listUnmergedWorkBranchesViaGit({
			cwd: repo,
			base: 'main',
			env: gitEnv(),
		});
		expect(branches.map((b) => b.ref).sort()).toEqual(['work/foo']);
		expect(branches[0].slug).toBe('foo');
	});

	it('returns the empty list when `<base>` does not resolve (no `main` yet)', () => {
		const repo = join(scratch.root, 'empty');
		mkdirSync(repo, {recursive: true});
		gitIn(['init', '-q', '-b', 'main'], repo);
		const branches = listUnmergedWorkBranchesViaGit({
			cwd: repo,
			base: 'main',
			env: gitEnv(),
		});
		expect(branches).toEqual([]);
	});
});
