import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {
	surfaceMergeQuestions,
	listUnmergedWorkBranchesViaGit,
	listOpenPullRequestsViaGh,
	type MergeQuestionPullRequest,
	type UnmergedWorkBranch,
} from '../src/merge-question-surfacer.js';
import {
	parseSidecar,
	serialiseSidecar,
	sidecarPathFor,
} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import {workBranchRef} from '../src/slug-namespace.js';
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
 * Create a task build branch `work/task-<slug>` (the {@link workBranchRef}
 * form) with ONE extra commit so its tip is NOT reachable from `main`. Leaves
 * the working tree back on `main`. `branch` overrides the branch name (for the
 * non-task forms the FLOOR must ignore).
 */
function makeUnmergedWorkBranch(
	repo: string,
	slug: string,
	branch: string = workBranchRef('task', slug),
	opts: {doneMove?: boolean} = {},
): void {
	gitIn(['checkout', '-q', '-b', branch], repo);
	writeFileSync(join(repo, `work-${slug}.txt`), `pushed work for ${slug}\n`);
	// A finished build's tip carries its done-move (the state the answered-merge
	// land lands); a bounced build's kept work does not.
	const ready = `work/tasks/ready/${slug}.md`;
	if (opts.doneMove !== false && existsSync(join(repo, ready))) {
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(['mv', ready, `work/tasks/done/${slug}.md`], repo);
	}
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `${branch}: pushed work`], repo);
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
		// Create work/task-foo and MERGE it into main so it is reachable.
		makeUnmergedWorkBranch(repo, 'foo');
		gitIn(['merge', '-q', '--no-ff', '-m', 'merge', 'work/task-foo'], repo);

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
		expect(row.ref).toBe('work/task-foo');
		expect(row.sidecarPath).toBe(sidecarPathFor('task:foo'));

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
		// The `main` the question was asked against (the `strictMergeApproval`
		// re-stale check compares it with the `main` at apply time).
		expect(entry.askedAtMain).toBe(gitIn(['rev-parse', 'main~1'], repo).trim());
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
				ref: 'work/task-foo',
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
			{ref: 'work/task-orphan', slug: 'orphan', reason: 'no-item-body'},
		]);
	});
});

describe('surfaceMergeQuestions — GitHub-configured CEILING (mocked `gh pr list`)', () => {
	it('asks NOTHING about a branch with an OPEN PR (the PR is the land decision); asks about the rest, never shelling real `gh`', () => {
		const {repo} = seedRepo(['foo', 'bar']);
		makeUnmergedWorkBranch(repo, 'foo');
		makeUnmergedWorkBranch(repo, 'bar');

		const prMap = new Map<string, MergeQuestionPullRequest>([
			[
				'work/task-foo',
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
		expect(result.surfaced.map((r) => r.ref)).toEqual(['work/task-bar']);
		expect(result.skipped).toEqual([
			{ref: 'work/task-foo', slug: 'foo', reason: 'open-pr'},
		]);
		expect(existsSync(join(repo, sidecarPathFor('task:foo')))).toBe(false);

		// The bar branch (no open PR) says so in its context.
		const barSidecar = parseSidecar(
			readFileSync(join(repo, result.surfaced[0].sidecarPath), 'utf8'),
		);
		expect(barSidecar.entries[0].kind).toBe('merge');
		expect(barSidecar.entries[0].context).toMatch(/no open PR/);
	});

	it('asks about NO branch when the CEILING seam throws (a branch whose PR it cannot see is never asked about)', () => {
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
		expect(result.surfaced).toEqual([]);
		expect(result.skipped).toEqual([
			{ref: 'work/task-foo', slug: 'foo', reason: 'pr-state-unknown'},
		]);
		expect(notes.some((n) => n.includes('gh pr list failed'))).toBe(true);
	});

	it('the production `gh pr list` seam THROWS on a failing `gh` (so the pass asks nothing)', () => {
		const {repo} = seedRepo([]);
		expect(() =>
			listOpenPullRequestsViaGh({
				cwd: repo,
				ghBin: 'false',
				base: 'main',
				env: gitEnv(),
			}),
		).toThrow(/pr list exited/);
	});
});

describe('surfaceMergeQuestions: which branches are asked about (decisions 4 and 6)', () => {
	const lock = (
		slug: string,
		keptFor?: 'propose-pr',
	): import('../src/item-lock.js').LockEntry => ({
		entry: `task-${slug}`,
		action: 'implement',
		state: 'active',
		holder: 'someone',
		since: '2026-09-29T00:00:00.000Z',
		...(keptFor === undefined ? {} : {keptFor}),
	});

	it('skips a branch whose lock is held WITHOUT the propose-pr marker (a live build); asks about one kept for a propose PR', () => {
		const {repo} = seedRepo(['live', 'kept']);
		makeUnmergedWorkBranch(repo, 'live');
		makeUnmergedWorkBranch(repo, 'kept');
		const result = surfaceMergeQuestions({
			cwd: repo,
			env: gitEnv(),
			locks: [lock('live'), lock('kept', 'propose-pr')],
		});
		expect(result.surfaced.map((r) => r.item)).toEqual(['task:kept']);
		expect(result.skipped).toEqual([
			{ref: 'work/task-live', slug: 'live', reason: 'lock-held'},
		]);
	});

	it('skips a branch whose task body is TERMINAL (done/ or cancelled/ on main, e.g. a squash-merged PR)', () => {
		const {repo} = seedRepo(['merged', 'gone']);
		makeUnmergedWorkBranch(repo, 'merged');
		makeUnmergedWorkBranch(repo, 'gone');
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		mkdirSync(join(repo, 'work', 'tasks', 'cancelled'), {recursive: true});
		gitIn(
			['mv', 'work/tasks/ready/merged.md', 'work/tasks/done/merged.md'],
			repo,
		);
		gitIn(
			['mv', 'work/tasks/ready/gone.md', 'work/tasks/cancelled/gone.md'],
			repo,
		);
		gitIn(['commit', '-q', '-m', 'terminal'], repo);
		const result = surfaceMergeQuestions({cwd: repo, env: gitEnv()});
		expect(result.surfaced).toEqual([]);
		expect(result.skipped).toEqual([
			{ref: 'work/task-gone', slug: 'gone', reason: 'terminal'},
			{ref: 'work/task-merged', slug: 'merged', reason: 'terminal'},
		]);
	});

	it('asks about a task body resting in tasks/backlog/', () => {
		const {repo} = seedRepo(['staged']);
		makeUnmergedWorkBranch(repo, 'staged');
		mkdirSync(join(repo, 'work', 'tasks', 'backlog'), {recursive: true});
		gitIn(
			['mv', 'work/tasks/ready/staged.md', 'work/tasks/backlog/staged.md'],
			repo,
		);
		gitIn(['commit', '-q', '-m', 'stage'], repo);
		const result = surfaceMergeQuestions({cwd: repo, env: gitEnv()});
		expect(result.surfaced.map((r) => r.item)).toEqual(['task:staged']);
		expect(
			parseFrontmatter(
				readFileSync(join(repo, 'work/tasks/backlog/staged.md'), 'utf8'),
			).needsAnswers,
		).toBe(true);
	});

	it("skips a branch whose tip lacks the done-move (a bounced build's kept work)", () => {
		const {repo} = seedRepo(['bounced']);
		makeUnmergedWorkBranch(repo, 'bounced', undefined, {doneMove: false});
		const result = surfaceMergeQuestions({cwd: repo, env: gitEnv()});
		expect(result.surfaced).toEqual([]);
		expect(result.skipped).toEqual([
			{ref: 'work/task-bounced', slug: 'bounced', reason: 'no-done-move'},
		]);
	});

	it('never appends to an ANSWERED merge question awaiting its apply', () => {
		const {repo} = seedRepo(['foo']);
		makeUnmergedWorkBranch(repo, 'foo');
		surfaceMergeQuestions({cwd: repo, env: gitEnv()});
		const abs = join(repo, sidecarPathFor('task:foo'));
		const model = parseSidecar(readFileSync(abs, 'utf8'));
		writeFileSync(
			abs,
			serialiseSidecar({
				...model,
				entries: model.entries.map((e) => ({...e, answer: 'hold'})),
			}),
		);
		const again = surfaceMergeQuestions({cwd: repo, env: gitEnv()});
		expect(again.surfaced).toEqual([]);
		expect(again.skipped).toEqual([
			{ref: 'work/task-foo', slug: 'foo', reason: 'merge-question-answered'},
		]);
		expect(parseSidecar(readFileSync(abs, 'utf8')).entries).toHaveLength(1);
	});
});

describe('listUnmergedWorkBranchesViaGit — the production FLOOR', () => {
	it('returns only `work/*` branches whose tip is not reachable from `<base>`', () => {
		const {repo} = seedRepo(['foo', 'bar']);
		makeUnmergedWorkBranch(repo, 'foo');
		// `work/task-bar` is created and MERGED into main → must NOT appear.
		makeUnmergedWorkBranch(repo, 'bar');
		gitIn(['merge', '-q', '--no-ff', '-m', 'merge', 'work/task-bar'], repo);
		// And a non-work branch must be ignored.
		gitIn(['branch', 'feature/x', 'main'], repo);

		const branches: UnmergedWorkBranch[] = listUnmergedWorkBranchesViaGit({
			cwd: repo,
			base: 'main',
			env: gitEnv(),
		});
		expect(branches.map((b) => b.ref).sort()).toEqual(['work/task-foo']);
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

describe('listUnmergedWorkBranchesViaGit — namespaced branch names', () => {
	it('lists only the task BUILD branch `work/task-<slug>`, parsing the slug with `parseWorkBranchRef`', () => {
		const {repo} = seedRepo(['foo']);
		makeUnmergedWorkBranch(repo, 'foo');
		// Not a task build branch: an intake branch, a spec branch, and a
		// pre-cutover un-namespaced `work/<slug>` are all ignored.
		makeUnmergedWorkBranch(
			repo,
			'foo',
			workBranchRef('task', 'foo', {producer: 'intake'}),
		);
		makeUnmergedWorkBranch(repo, 'foo', workBranchRef('spec', 'foo'));
		makeUnmergedWorkBranch(repo, 'foo', 'work/foo');

		const branches = listUnmergedWorkBranchesViaGit({
			cwd: repo,
			base: 'main',
			env: gitEnv(),
		});
		expect(branches.map((b) => [b.ref, b.slug])).toEqual([
			['work/task-foo', 'foo'],
		]);
	});
});

/**
 * The arbiter side of the clone / mirror tests: a repo holding `main` (with the
 * task bodies) and the work branches, as the arbiter would.
 */
function seedArbiter(): {arbiter: string} {
	const {repo} = seedRepo(['foo', 'bar']);
	// Unmerged, with a task body: must surface.
	makeUnmergedWorkBranch(repo, 'foo');
	// Merged into main: skipped (not listed).
	makeUnmergedWorkBranch(repo, 'bar');
	gitIn(['merge', '-q', '--no-ff', '-m', 'merge', 'work/task-bar'], repo);
	// Unmerged, no task body: skipped with `no-item-body`.
	makeUnmergedWorkBranch(repo, 'orphan');
	return {arbiter: repo};
}

describe('surfaceMergeQuestions — reads the ARBITER branches in a clone and in the mirror', () => {
	it('in a CLONE, surfaces from the remote-tracking `refs/remotes/<arbiter>/work/task-*` refs', () => {
		const {arbiter} = seedArbiter();
		const clone = join(scratch.root, 'clone');
		gitIn(['clone', '-q', arbiter, clone], scratch.root);
		// The clone has NO local work heads: only remote-tracking ones.
		expect(
			gitIn(['for-each-ref', '--format=%(refname)', 'refs/heads/work/'], clone),
		).toBe('');
		// A local-only head in the clone is this machine's, not the arbiter's.
		makeUnmergedWorkBranch(clone, 'local', 'work/task-foo-local');

		const result = surfaceMergeQuestions({cwd: clone, env: gitEnv()});

		expect(result.considered).toBe(2);
		expect(result.surfaced.map((r) => [r.item, r.ref])).toEqual([
			['task:foo', 'work/task-foo'],
		]);
		expect(result.skipped).toEqual([
			{ref: 'work/task-orphan', slug: 'orphan', reason: 'no-item-body'},
		]);
		const model = parseSidecar(
			readFileSync(join(clone, sidecarPathFor('task:foo')), 'utf8'),
		);
		expect(model.entries).toHaveLength(1);
		expect(model.entries[0].kind).toBe('merge');
	});

	it('in a CLONE, checks reachability against the arbiter `main`, not the local one', () => {
		const {arbiter} = seedArbiter();
		const clone = join(scratch.root, 'clone');
		gitIn(['clone', '-q', arbiter, clone], scratch.root);
		// Merge foo on the ARBITER only; the clone's local `main` stays behind.
		gitIn(['merge', '-q', '--no-ff', '-m', 'merge', 'work/task-foo'], arbiter);
		gitIn(['fetch', '-q', 'origin'], clone);

		const branches = listUnmergedWorkBranchesViaGit({
			cwd: clone,
			base: 'main',
			env: gitEnv(),
		});
		expect(branches.map((b) => b.ref)).toEqual(['work/task-orphan']);
	});

	it('in a worktree of the bare hub MIRROR, surfaces from the mirror local heads', () => {
		const {arbiter} = seedArbiter();
		const mirror = join(scratch.root, 'mirror.git');
		gitIn(['clone', '-q', '--bare', arbiter, mirror], scratch.root);
		// A stale remote-tracking ref (left by an explicit-refspec fetch) must
		// not be read: in the mirror the local heads ARE the arbiter's branches.
		gitIn(
			[
				'update-ref',
				'refs/remotes/origin/work/task-stale',
				gitIn(['rev-parse', 'work/task-orphan'], mirror).trim(),
			],
			mirror,
		);
		const wt = join(scratch.root, 'wt');
		gitIn(['worktree', 'add', '-q', wt, 'main'], mirror);

		// The bare mirror itself lists the same branches.
		expect(
			listUnmergedWorkBranchesViaGit({
				cwd: mirror,
				base: 'main',
				env: gitEnv(),
			}).map((b) => b.ref),
		).toEqual(['work/task-foo', 'work/task-orphan']);

		const result = surfaceMergeQuestions({cwd: wt, env: gitEnv()});

		expect(result.considered).toBe(2);
		expect(result.surfaced.map((r) => [r.item, r.ref])).toEqual([
			['task:foo', 'work/task-foo'],
		]);
		expect(result.skipped).toEqual([
			{ref: 'work/task-orphan', slug: 'orphan', reason: 'no-item-body'},
		]);
	});
});
