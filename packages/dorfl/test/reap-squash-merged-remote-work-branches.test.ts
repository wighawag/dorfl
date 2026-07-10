import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {git, run} from '../src/git.js';
import {isProvablyMergedForReap} from '../src/gc.js';
import {sweepRemoteMergedBranches} from '../src/reap-branches.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Pin tests for the squash-aware reap predicate
 * ({@link isProvablyMergedForReap}) added by task
 * `reap-squash-merged-remote-work-branches`. Cover both directions:
 *
 *   (a) Squash-landed IS reaped — fast-path ancestor fails, but the done
 *       record is on `<arbiter>/main` and the branch carries nothing main
 *       lacks, so the squash-aware fallback reaps it.
 *   (b) Genuinely unmerged is RETAINED — no terminal record on main, OR
 *       terminal record present but the branch has extra commits main lacks.
 *   (c) Rebase-landed IS reaped via the `git cherry` (patch-id) path —
 *       fast-path ancestor fails, diff is non-empty, but every branch commit
 *       is already applied to main under a different sha.
 *
 * Sibling lock-side twin (cross-link):
 * `reaper-never-clears-a-done-plus-stuck-lock-orphans-forever-2026-06-20`.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-reap-squash-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** The remote-tracking main ref inside a working clone with an `arbiter` remote. */
const ARBITER_MAIN = `refs/remotes/${ARBITER}/main`;

/** Fetch <arbiter>/main into its scratch remote-tracking ref (bare arbiter has
 * no fetch refspec on the working clone). */
function fetchArbiterMain(repo: string): void {
	git(['fetch', '-q', ARBITER, `+refs/heads/main:${ARBITER_MAIN}`], repo, {
		env: gitEnv(),
	});
}

/**
 * Land a squash-style commit on `<arbiter>/main` that reflects the branch's
 * work (source file + `work/tasks/ready/<slug>.md` \u2192 `work/tasks/done/<slug>.md`
 * rename) as ONE new commit that is NOT the branch tip. Mirrors what GitHub's
 * squash-merge does. Uses a throwaway helper clone so the caller's checkout is
 * left alone.
 */
function squashLandOnMain(
	root: string,
	arbiter: string,
	slug: string,
	srcFile: string,
	srcContent: string,
): void {
	const helper = join(root, `helper-squash-${slug}`);
	git(['clone', '-q', `file://${arbiter}`, helper], root, {env: gitEnv()});
	git(['remote', 'add', 'arbiter', `file://${arbiter}`], helper, {
		env: gitEnv(),
	});
	git(['fetch', '-q', 'arbiter'], helper, {env: gitEnv()});
	git(['checkout', '-q', '-B', 'main', 'arbiter/main'], helper, {
		env: gitEnv(),
	});
	// Apply the "same" work (source add + ready\u2192done move) as ONE fresh commit
	// on main. Content-identical to what the branch produced, but a new sha.
	const readyPath = join(helper, 'work', 'tasks', 'ready', `${slug}.md`);
	const donePath = join(helper, 'work', 'tasks', 'done', `${slug}.md`);
	mkdirSync(dirname(donePath), {recursive: true});
	renameSync(readyPath, donePath);
	writeFileSync(join(helper, srcFile), srcContent);
	git(['add', '-A'], helper, {env: gitEnv()});
	git(['commit', '-q', '-m', `squash: land ${slug}`], helper, {env: gitEnv()});
	git(['push', '-q', 'arbiter', 'main:main'], helper, {env: gitEnv()});
}

/** Create + push a work branch that ALSO moves the item's ready record to
 * done (mirroring what `dorfl complete` writes into the branch). Returns the
 * branch ref + local tip sha. */
function createWorkBranchLikeComplete(
	repo: string,
	slug: string,
	srcFile: string,
	srcContent: string,
): {branch: string; tip: string} {
	const branch = `work/task-${slug}`;
	git(['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	git(['checkout', '-q', '-B', branch, `${ARBITER}/main`], repo, {
		env: gitEnv(),
	});
	const readyPath = join(repo, 'work', 'tasks', 'ready', `${slug}.md`);
	const donePath = join(repo, 'work', 'tasks', 'done', `${slug}.md`);
	mkdirSync(dirname(donePath), {recursive: true});
	renameSync(readyPath, donePath);
	writeFileSync(join(repo, srcFile), srcContent);
	git(['add', '-A'], repo, {env: gitEnv()});
	git(['commit', '-q', '-m', `work: ${slug}`], repo, {env: gitEnv()});
	const tip = git(['rev-parse', 'HEAD'], repo, {env: gitEnv()}).trim();
	git(['push', '-q', ARBITER, `${branch}:${branch}`], repo, {env: gitEnv()});
	// Leave the working clone back on main so the branch only lives remotely.
	git(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo, {
		env: gitEnv(),
	});
	return {branch, tip};
}

describe('isProvablyMergedForReap — squash-aware reap predicate', () => {
	it('(a) reaps a SQUASH-LANDED branch (done record on main + branch carries nothing main lacks)', () => {
		const slug = 'sq-landed';
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [slug]);
		const {tip, branch} = createWorkBranchLikeComplete(
			repo,
			slug,
			`${slug}.txt`,
			`work for ${slug}\n`,
		);
		// Land the work as a distinct SQUASH commit on <arbiter>/main whose tree
		// equals the branch tip's tree (source file + ready\u2192done move). The
		// branch tip is now NOT an ancestor of main.
		squashLandOnMain(
			scratch.root,
			arbiter,
			slug,
			`${slug}.txt`,
			`work for ${slug}\n`,
		);
		fetchArbiterMain(repo);

		// Fast-path ancestor MUST fail — the whole reason the squash-aware
		// fallback exists. `run` is the soft probe (never throws on non-zero).
		const ancestor = run(
			'git',
			['merge-base', '--is-ancestor', tip, ARBITER_MAIN],
			repo,
			{env: gitEnv()},
		);
		expect(ancestor.status).not.toBe(0);

		expect(
			isProvablyMergedForReap({
				cwd: repo,
				tip,
				arbiterMain: ARBITER_MAIN,
				namespace: 'task',
				slug,
				env: gitEnv(),
			}),
		).toBe(true);
		// End-to-end via `sweepRemoteMergedBranches`: reaped too.
		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.reaped.map((b) => b.branch)).toContain(branch);
	});

	it('(b1) RETAINS a branch whose item has NO terminal record on main (in-flight)', () => {
		const slug = 'inflight';
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		const {tip, branch} = createWorkBranchLikeComplete(
			repo,
			slug,
			`${slug}.txt`,
			`work for ${slug}\n`,
		);
		// NO squash-land on main — the item stays in `work/tasks/ready/`,
		// no `work/tasks/done/<slug>.md` present.
		fetchArbiterMain(repo);

		expect(
			isProvablyMergedForReap({
				cwd: repo,
				tip,
				arbiterMain: ARBITER_MAIN,
				namespace: 'task',
				slug,
				env: gitEnv(),
			}),
		).toBe(false);
		// End-to-end: the sweep RETAINS it.
		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.reaped).toHaveLength(0);
		expect(result.retained.map((b) => b.branch)).toContain(branch);
		expect(result.retained[0].reason).toBe('not-merged');
	});

	it('(b2) RETAINS a branch whose item IS terminal on main but the branch has EXTRA commits main lacks', () => {
		const slug = 'extras';
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [slug]);
		const {branch} = createWorkBranchLikeComplete(
			repo,
			slug,
			`${slug}.txt`,
			`work for ${slug}\n`,
		);
		// Land the squash on main so the done record exists.
		squashLandOnMain(
			scratch.root,
			arbiter,
			slug,
			`${slug}.txt`,
			`work for ${slug}\n`,
		);
		fetchArbiterMain(repo);

		// Now add an EXTRA commit to the local branch that main does NOT have
		// (an un-pushed amend / a divergent recovery commit), and push it so the
		// remote branch also carries it.
		git(['checkout', '-q', branch], repo, {env: gitEnv()});
		writeFileSync(join(repo, `${slug}-extra.txt`), 'extra work\n');
		git(['add', '-A'], repo, {env: gitEnv()});
		git(['commit', '-q', '-m', `extra: ${slug}`], repo, {env: gitEnv()});
		const extraTip = git(['rev-parse', 'HEAD'], repo, {env: gitEnv()}).trim();
		git(['push', '-q', ARBITER, `${branch}:${branch}`, '--force'], repo, {
			env: gitEnv(),
		});
		git(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo, {
			env: gitEnv(),
		});
		fetchArbiterMain(repo);

		expect(
			isProvablyMergedForReap({
				cwd: repo,
				tip: extraTip,
				arbiterMain: ARBITER_MAIN,
				namespace: 'task',
				slug,
				env: gitEnv(),
			}),
		).toBe(false);
		// End-to-end: the sweep RETAINS it — never reap a branch carrying
		// commits main lacks, even if the item is terminal on main.
		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.reaped).toHaveLength(0);
		expect(result.retained.map((b) => b.branch)).toContain(branch);
	});

	it('(c) reaps a REBASE-LANDED branch via the git-cherry patch-id path (diff non-empty, every commit already applied)', () => {
		const slug = 'rebased';
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, [slug]);
		const {branch, tip} = createWorkBranchLikeComplete(
			repo,
			slug,
			`${slug}.txt`,
			`work for ${slug}\n`,
		);

		// Land the branch's work as its own commit on main (same patch-id, new
		// sha — what a rebase-and-merge produces).
		squashLandOnMain(
			scratch.root,
			arbiter,
			slug,
			`${slug}.txt`,
			`work for ${slug}\n`,
		);

		// Then ADVANCE main by an unrelated commit so main.tree != tip.tree
		// (the `git diff --quiet` tree-equal path CANNOT catch this — only the
		// `git cherry` patch-id path can).
		const advancer = join(scratch.root, `advancer-${slug}`);
		git(['clone', '-q', `file://${arbiter}`, advancer], scratch.root, {
			env: gitEnv(),
		});
		git(['remote', 'add', 'arbiter', `file://${arbiter}`], advancer, {
			env: gitEnv(),
		});
		git(['fetch', '-q', 'arbiter'], advancer, {env: gitEnv()});
		git(['checkout', '-q', '-B', 'main', 'arbiter/main'], advancer, {
			env: gitEnv(),
		});
		writeFileSync(join(advancer, 'unrelated.txt'), 'unrelated advance\n');
		git(['add', '-A'], advancer, {env: gitEnv()});
		git(['commit', '-q', '-m', 'unrelated: advance main'], advancer, {
			env: gitEnv(),
		});
		git(['push', '-q', 'arbiter', 'main:main'], advancer, {env: gitEnv()});
		fetchArbiterMain(repo);

		// Precondition: tree-equal check FAILS (main has unrelated.txt tip lacks).
		const treeEqual = git(['diff', '--stat', ARBITER_MAIN, tip], repo, {
			env: gitEnv(),
		});
		expect(treeEqual).toMatch(/unrelated\.txt/);

		expect(
			isProvablyMergedForReap({
				cwd: repo,
				tip,
				arbiterMain: ARBITER_MAIN,
				namespace: 'task',
				slug,
				env: gitEnv(),
			}),
		).toBe(true);
		// End-to-end sweep reaps it too.
		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.reaped.map((b) => b.branch)).toContain(branch);
	});
});
