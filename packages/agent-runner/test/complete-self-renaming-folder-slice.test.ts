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
 * A SELF-RENAMING FOLDER slice (the `folder-taxonomy-reorg-and-rename` migration):
 * a slice whose whole job is to `git mv` the very `work/` ledger folders the runner
 * reads its OWN record from — e.g. `done/ -> tasks/done/`, `backlog/ -> tasks/todo/`.
 *
 * The trap this guards against (observed live, drive-backlog Phase 1): the runner's
 * `complete` runs the INSTALLED (pre-rename) binary, whose compiled-in `work-layout`
 * still says `done -> 'done'`, while the slice's BRANCH tree has renamed the folder
 * to `tasks/done/` AND the agent has placed its own ledger record there as part of
 * the migration. The pre-fix resolver looked ONLY at the binary's `work/backlog|
 * in-progress|needs-attention|done/<slug>.md` paths, found the record at NONE of
 * them, and crashed with `nothing to complete` — surfacing to needs-attention and
 * REAPING the job worktree, discarding the whole build.
 *
 * The fix (A2, layout-agnostic done-position detection): when the record is at none
 * of the binary-known folders, `complete` scans `work/**\/<slug>.md` on the branch;
 * if it finds the record in a folder whose LEAF name is `done` (covering both
 * `work/done/` and a renamed `work/tasks/done/`), it treats the slice as already
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
 * Stand up the repo as a self-renaming-folder slice leaves it: claimed (body rests
 * in `work/backlog/<slug>.md` on the arbiter), then on the work branch the agent
 * renamed the ledger folders (`done/ -> tasks/done/`) and placed its OWN record at
 * the NEW done-position `work/tasks/done/<slug>.md` (NOT at the binary's
 * `work/done/`), plus produced real source work — all committed. The tip is AHEAD
 * of `<arbiter>/main` and never pushed. HEAD is on the work branch.
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
	const branch = `work/slice-${slug}`;
	gitIn(['switch', '-q', '-c', branch, `${ARBITER}/main`], repo);

	// The agent's source work (the rename touches real files in a real slice; here
	// a stand-in) AND the self-renaming done-move: relocate the record from the
	// pre-rename `work/backlog/<slug>.md` to the NEW done-position
	// `work/tasks/done/<slug>.md` (the renamed `done/` umbrella), exactly as the
	// migration slice's agent does.
	writeFileSync(join(repo, 'feature.txt'), 'the migration work\n');
	mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(['mv', `work/backlog/${slug}.md`, `work/tasks/done/${slug}.md`], repo);
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

	// Sanity: the record is at the NEW done-position, and at NONE of the binary's
	// pre-rename ledger folders. The arbiter still holds the body in backlog/.
	expect(existsSync(join(repo, 'work', 'tasks', 'done', `${slug}.md`))).toBe(
		true,
	);
	expect(existsSync(join(repo, 'work', 'backlog', `${slug}.md`))).toBe(false);
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

	it('a record stranded in a NON-done renamed position (e.g. tasks/todo/) is NOT silently integrated — it still refuses honestly', async () => {
		// Guard the cut line: the layout-agnostic detection fires ONLY on a `done`
		// leaf. A record left in the renamed POOL (`tasks/todo/`) is NOT a finished
		// slice; the runner must still refuse rather than mis-integrate an unfinished
		// item as done.
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
		gitIn(
			['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`],
			repo,
		);
		mkdirSync(join(repo, 'work', 'tasks', 'todo'), {recursive: true});
		gitIn(
			['mv', `work/backlog/${slug}.md`, `work/tasks/todo/${slug}.md`],
			repo,
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', `wip(${slug}): renamed pool only`], repo);

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
