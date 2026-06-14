import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {git, run} from '../src/git.js';
import {
	sweepRemoteMergedBranches,
	listRemoteWorkBranches,
} from '../src/reap-branches.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-reap-branches-');
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * The remote-branch sweep operates against an arbiter THROUGH a local clone whose
 * `<arbiter>` remote points at it. `seedRepoWithArbiter` gives us a working clone
 * (`repo`) wired with an `arbiter` remote → a local `--bare` arbiter — the real
 * substrate the sweep must work against (provider-agnostic plain git).
 */
function setup(): {repo: string; arbiter: string} {
	const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['seed']);
	return {repo, arbiter};
}

/** The arbiter remote name wired by the fixture. */
const ARBITER = 'arbiter';

/**
 * Push a namespaced work branch `work/slice-<slug>` to the arbiter, branched off
 * `arbiter/main` with one new commit. Returns the branch ref + its tip sha.
 */
function pushWorkBranch(
	repo: string,
	slug: string,
	merge = false,
): {branch: string; tip: string} {
	const branch = `work/slice-${slug}`;
	git(['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	git(['checkout', '-q', '-B', branch, `${ARBITER}/main`], repo, {
		env: gitEnv(),
	});
	writeFileSync(join(repo, `${slug}.txt`), `work for ${slug}\n`);
	git(['add', '-A'], repo, {env: gitEnv()});
	git(['commit', '-q', '-m', `work: ${slug}`], repo, {env: gitEnv()});
	const tip = git(['rev-parse', 'HEAD'], repo, {env: gitEnv()}).trim();
	// Push the branch under its own ref (the "in-flight / proposed" state).
	git(['push', '-q', ARBITER, `${branch}:${branch}`], repo, {env: gitEnv()});
	if (merge) {
		// ALSO land it on main (the "merged" state) — its tip is now an ancestor of
		// arbiter/main, so it is provably reapable.
		git(['push', '-q', ARBITER, `${branch}:main`], repo, {env: gitEnv()});
	}
	// Leave the working clone back on main so the branch only lives remotely.
	git(['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	git(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo, {
		env: gitEnv(),
	});
	return {branch, tip};
}

/** Does the arbiter currently have a `refs/heads/<branch>`? */
function remoteBranchExists(repo: string, branch: string): boolean {
	const res = run('git', ['ls-remote', '--heads', ARBITER, branch], repo, {
		env: gitEnv(),
	});
	return res.status === 0 && res.stdout.trim() !== '';
}

describe('sweepRemoteMergedBranches — delete only PROVABLY-MERGED remote work/* branches', () => {
	it('deletes a merged branch and RETAINS an un-merged (in-flight) one', () => {
		const {repo} = setup();
		const merged = pushWorkBranch(repo, 'merged', true);
		const inflight = pushWorkBranch(repo, 'inflight', false);

		// Both branches exist on the arbiter before the sweep.
		expect(remoteBranchExists(repo, merged.branch)).toBe(true);
		expect(remoteBranchExists(repo, inflight.branch)).toBe(true);

		const notes: string[] = [];
		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		// The merged branch is reaped …
		expect(result.reaped.map((b) => b.branch)).toEqual([merged.branch]);
		expect(remoteBranchExists(repo, merged.branch)).toBe(false);

		// … and the in-flight one is RETAINED (the recovery point is safe).
		expect(result.retained.map((b) => b.branch)).toEqual([inflight.branch]);
		expect(result.retained[0].reason).toBe('not-merged');
		expect(remoteBranchExists(repo, inflight.branch)).toBe(true);
	});

	it('NEVER deletes an un-merged branch (the never-delete-in-flight invariant)', () => {
		const {repo} = setup();
		const inflight = pushWorkBranch(repo, 'inflight', false);

		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.reaped).toHaveLength(0);
		expect(result.retained.map((b) => b.branch)).toEqual([inflight.branch]);
		// The recovery point survives.
		expect(remoteBranchExists(repo, inflight.branch)).toBe(true);
	});

	it('reaps a merged branch via git push --delete WITHOUT --force', () => {
		const {repo} = setup();
		const merged = pushWorkBranch(repo, 'merged', true);

		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.reaped.map((b) => b.branch)).toEqual([merged.branch]);
		expect(result.reaped[0].tip).toBe(merged.tip);
		expect(remoteBranchExists(repo, merged.branch)).toBe(false);
	});

	it('works against a local --bare arbiter and any provider (no gh dependency)', () => {
		// The fixture's arbiter IS a local `--bare` repo; the whole flow is plain git.
		const {repo, arbiter} = setup();
		expect(arbiter.endsWith('.git')).toBe(true);
		const merged = pushWorkBranch(repo, 'bare-merged', true);
		const inflight = pushWorkBranch(repo, 'bare-inflight', false);

		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.reaped.map((b) => b.branch)).toEqual([merged.branch]);
		expect(result.retained.map((b) => b.branch)).toEqual([inflight.branch]);
	});

	it('--dry-run REPORTS what would be reaped without deleting anything', () => {
		const {repo} = setup();
		const merged = pushWorkBranch(repo, 'merged', true);
		const inflight = pushWorkBranch(repo, 'inflight', false);

		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			dryRun: true,
			env: gitEnv(),
		});

		// Nothing actually deleted.
		expect(result.reaped).toHaveLength(0);
		expect(result.wouldReap.map((b) => b.branch)).toEqual([merged.branch]);
		expect(result.retained.map((b) => b.branch)).toEqual([inflight.branch]);
		// BOTH branches still exist on the arbiter.
		expect(remoteBranchExists(repo, merged.branch)).toBe(true);
		expect(remoteBranchExists(repo, inflight.branch)).toBe(true);
	});

	it('is idempotent: a second sweep over an already-reaped arbiter is a no-op', () => {
		const {repo} = setup();
		pushWorkBranch(repo, 'merged', true);

		const first = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(first.reaped).toHaveLength(1);

		const second = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(second.reaped).toHaveLength(0);
		expect(second.retained).toHaveLength(0);
	});

	it('ignores a non-namespaced work/* head (only the protocol\u2019s own branches)', () => {
		const {repo} = setup();
		// A stray `work/legacy` head that is NOT a `work/<type>-<slug>` branch.
		git(['fetch', '-q', ARBITER], repo, {env: gitEnv()});
		git(['checkout', '-q', '-B', 'work/legacy', `${ARBITER}/main`], repo, {
			env: gitEnv(),
		});
		writeFileSync(join(repo, 'legacy.txt'), 'legacy\n');
		git(['add', '-A'], repo, {env: gitEnv()});
		git(['commit', '-q', '-m', 'legacy'], repo, {env: gitEnv()});
		// Merge it to main too (so it WOULD be reapable if it were recognised).
		git(['push', '-q', ARBITER, 'work/legacy:main'], repo, {env: gitEnv()});
		git(['push', '-q', ARBITER, 'work/legacy:work/legacy'], repo, {
			env: gitEnv(),
		});
		git(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo, {
			env: gitEnv(),
		});

		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		// The non-conforming head is left untouched (not enumerated, not reaped).
		expect(result.reaped).toHaveLength(0);
		expect(remoteBranchExists(repo, 'work/legacy')).toBe(true);
	});
});

describe('listRemoteWorkBranches', () => {
	it('returns each namespaced work/* head + its tip', () => {
		const {repo} = setup();
		const a = pushWorkBranch(repo, 'a', false);
		const b = pushWorkBranch(repo, 'b', true);

		const heads = listRemoteWorkBranches(repo, ARBITER, gitEnv());
		const byBranch = Object.fromEntries(heads.map((h) => [h.branch, h.tip]));
		expect(byBranch[a.branch]).toBe(a.tip);
		expect(byBranch[b.branch]).toBe(b.tip);
	});

	it('returns [] when the arbiter is unreachable (the safe direction)', () => {
		const {repo} = setup();
		const heads = listRemoteWorkBranches(repo, 'no-such-remote', gitEnv());
		expect(heads).toEqual([]);
	});
});
