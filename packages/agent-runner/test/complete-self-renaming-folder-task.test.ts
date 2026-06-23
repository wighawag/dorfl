import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * A SELF-RENAMING FOLDER task (the `folder-taxonomy-reorg-and-rename` migration):
 * a task whose whole job is to `git mv` the very `work/` ledger folders the runner
 * reads its OWN record from — e.g. `done/ -> tasks/done/`, `backlog/ -> tasks/todo/`.
 *
 * The trap this guards against (observed live, drive-backlog Phase 1): the runner's
 * `complete` runs the INSTALLED (pre-rename) binary, whose compiled-in `work-layout`
 * still says `done -> 'done'`, while the task's BRANCH tree has renamed the folder
 * to `tasks/done/` AND the agent has placed its own ledger record there as part of
 * the migration. The pre-fix resolver looked ONLY at the binary's `work/tasks/todo|
 * in-progress|needs-attention|done/<slug>.md` paths, found the record at NONE of
 * them, and crashed with `nothing to complete` — surfacing to needs-attention and
 * REAPING the job worktree, discarding the whole build.
 *
 * The fix (A2, layout-agnostic done-position detection): when the record is at none
 * of the binary-known folders, `complete` scans `work/**\/<slug>.md` on the branch;
 * if it finds the record in a folder whose LEAF name is `done` (covering both
 * `work/done/` and a renamed `work/tasks/done/`), it treats the task as already
 * done-moved by the agent into its terminal position, SKIPS the runner's own
 * `git mv`, and commits the agent's work as-is. No binary-vs-branch folder-name
 * reconciliation is needed — the agent owns the move, the runner just integrates.
 *
 * House style mirrors `autonomous-recovers-stranded-done.test.ts`: throwaway
 * checkout + local `--bare` arbiter, `gitEnv()` isolation, no shared locations.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-self-renaming-folder-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Stand up the repo as a task that placed its OWN record in the terminal
 * done-position leaves it: claimed (body rests in the pool `work/tasks/todo/<slug>.md`
 * on the arbiter — the renamed agent POOL), then on the work branch the agent
 * done-moved its record to `work/tasks/done/<slug>.md` and produced real source
 * work — all committed. The tip is AHEAD of `<arbiter>/main` and never pushed.
 * HEAD is on the work branch.
 *
 * (Historical note: this guard was born from the `folder-taxonomy-reorg-and-rename`
 * Phase-1 flip, when the runner's INSTALLED binary still read the pre-rename
 * `done/` folder while the branch had renamed it to `tasks/done/`. After that flip
 * LANDED, the binary's `work-layout` resolves the SAME `tasks/done/` leaf, so the
 * scenario reduces to a normal pool->done done-move; the layout-agnostic `done`-leaf
 * detection in `complete.ts` still backstops it and is what this test pins.)
 */
async function seedSelfRenamedDoneBranch(
	slug: string,
): Promise<{repo: string; seeded: SeededRepo; tip: string; branch: string}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	const branch = `work/task-${slug}`;
	gitIn(['switch', '-q', '-c', branch, `${ARBITER}/main`], repo);

	// The agent's source work (a stand-in) AND the done-move: relocate the record
	// from the pool `work/tasks/todo/<slug>.md` to the terminal done-position
	// `work/tasks/done/<slug>.md`, exactly as a finishing agent does.
	writeFileSync(join(repo, 'feature.txt'), 'the migration work\n');
	mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(
		['mv', `work/tasks/todo/${slug}.md`, `work/tasks/done/${slug}.md`],
		repo,
	);
	gitIn(['add', '-A'], repo);
	gitIn(
		[
			'commit',
			'-q',
			'-m',
			`feat(${slug}): rename ledger folders done->tasks/done; done`,
		],
		repo,
	);

	// Sanity: the record is at the terminal done-position, and at NONE of the other
	// ledger folders. The arbiter still holds the body in the pool (`tasks/todo/`,
	// resolved from the `backlog` status key via `work-layout`).
	expect(existsSync(join(repo, 'work', 'tasks', 'done', `${slug}.md`))).toBe(
		true,
	);
	expect(existsSync(join(repo, 'work', 'tasks', 'todo', `${slug}.md`))).toBe(
		false,
	);
	expect(existsSync(join(repo, 'work', 'done', `${slug}.md`))).toBe(false);
	expect(existsSync(join(repo, 'work', 'in-progress', `${slug}.md`))).toBe(
		false,
	);
	expect(existsOnArbiterMain(repo, 'backlog', slug)).toBe(true);
	const tip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	return {repo, seeded, tip, branch};
}

describe('complete — self-renaming-folder slice (record placed in a RENAMED done-position)', () => {
	it('integrates the kept commit when the agent placed its own record at work/tasks/done/ (no `nothing to complete` crash, no rebuild/force)', async () => {
		const {repo, tip, branch} = await seedSelfRenamedDoneBranch('regroup');
		const notes: string[] = [];

		const result = await performComplete({
			slug: 'regroup',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// The kept commit (with the renamed folder AND the source work) landed on
		// the arbiter's main verbatim — no rebuild, no second move.
		expect(gitIn(['show', `${ARBITER}/main:feature.txt`], repo).trim()).toBe(
			'the migration work',
		);
		expect(
			gitIn(['show', `${ARBITER}/main:work/tasks/done/regroup.md`], repo)
				.length,
		).toBeGreaterThan(0);
		// The runner did NOT create a stray binary-layout `work/done/regroup.md`
		// (it must not reconcile branch layout against its own compiled-in names).
		const lsmain = gitIn(
			['ls-tree', '-r', '--name-only', `${ARBITER}/main`],
			repo,
		);
		expect(lsmain).not.toContain('work/done/regroup.md');
		// The EXACT kept commit integrated (clean fast-forward on the merge base).
		const base = gitIn(['merge-base', tip, `${ARBITER}/main`], repo).trim();
		expect(base).toBe(tip);
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).toBe(tip);
		expect(result.branch).toBe(branch);
	});

	it('DIRTY-CONTINUE: agent placed its record at work/tasks/done/ with UNCOMMITTED work still in the tree (the live WIP state) integrates, not `nothing to complete`', async () => {
		// The exact live failure mode: the migration agent renamed the folders +
		// committed, placing its own record at work/tasks/done/<slug>.md, but THIS run
		// left uncommitted edits in the worktree (the dirtyContinue state). The second
		// presence guard re-checked the binary's work/done/<slug>.md (absent) and
		// crashed with `nothing to complete`. It must instead fold the uncommitted work
		// into the commit and integrate.
		const {repo, branch} = await seedSelfRenamedDoneBranch('dirty-regroup');
		// Leave NEW uncommitted work in the tree (what made it a dirty continue).
		writeFileSync(join(repo, 'extra.txt'), 'a late edit\n');
		const notes: string[] = [];

		const result = await performComplete({
			slug: 'dirty-regroup',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// The continue-build note fired (the dirtyContinue / source:'done' path).
		expect(notes.some((n) => /continue-build on 'dirty-regroup'/.test(n))).toBe(
			true,
		);
		// Both the renamed-folder record AND the late uncommitted edit landed.
		expect(
			gitIn(['show', `${ARBITER}/main:work/tasks/done/dirty-regroup.md`], repo)
				.length,
		).toBeGreaterThan(0);
		expect(gitIn(['show', `${ARBITER}/main:extra.txt`], repo).trim()).toBe(
			'a late edit',
		);
		// No stray binary-layout work/done/ record.
		const lsmain = gitIn(
			['ls-tree', '-r', '--name-only', `${ARBITER}/main`],
			repo,
		);
		expect(lsmain).not.toContain('work/done/dirty-regroup.md');
		expect(result.branch).toBe(branch);
	});

	it('a record stranded in a NON-done, non-pool position (tasks/backlog/ staging) is NOT silently integrated — it still refuses honestly', async () => {
		// Guard the cut line: the layout-agnostic detection fires ONLY on a `done`
		// leaf. A record sitting in STAGING (`tasks/backlog/`, the `pre-backlog` key)
		// is neither the pool `complete` sources from (`tasks/todo/`) NOR a `done`
		// leaf, so the runner must REFUSE rather than mis-integrate an unfinished item
		// as done. (A record left in the pool itself is a normal completion — the
		// runner does the pool->done move — so staging is the honest "not finished,
		// not done" position to pin the refusal on.)
		const slug = 'half-done';
		const seeded = seedRepoWithArbiter(scratch.root, [slug]);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug,
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
		// Move the record from the pool (`tasks/todo/`, where claim left it) BACK into
		// staging (`tasks/backlog/`) — a non-done, non-pool durable position.
		mkdirSync(join(repo, 'work', 'tasks', 'backlog'), {recursive: true});
		gitIn(
			['mv', `work/tasks/todo/${slug}.md`, `work/tasks/backlog/${slug}.md`],
			repo,
		);
		gitIn(['add', '-A'], repo);
		gitIn(
			['commit', '-q', '-m', `wip(${slug}): in staging, no done-move`],
			repo,
		);

		const result = await performComplete({
			slug,
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			env: gitEnv(),
			note: () => {},
		});

		// Honest refusal (the record is not in a terminal done-position), NOT a
		// silent done-integration.
		expect(result.exitCode).not.toBe(0);
		expect(result.outcome).toBe('refused');
		expect(existsOnArbiterMain(repo, 'done', slug)).toBe(false);
	});
});
