import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performAdvance, type RungExecutor} from '../src/advance.js';
import {advancingMarkerPath} from '../src/advancing-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * Regression for `recover-autodetect-and-advancing-lock-crash-safety` (Defect B,
 * slice `advancing-lock-release-crash-safe`). The live incident left the slug in
 * BOTH `work/advancing/<entry>.md` (orphaned lock) AND a lifecycle folder after a
 * failing post-lock dispatch (the recover path rebased onto an `<arbiter>/main`
 * whose new content collided with a stale baked-in `work/advancing/<entry>.md`
 * carried on the kept work branch). These tests exercise the REAL `performAdvance`
 * + REAL `releaseAdvancingLock` and pin the invariant: after ANY tick (success or
 * failure), no orphaned advancing marker remains AND the kept work branch tip is
 * intact (recoverable, NEVER `git reset --hard`'d).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-advance-release-crash-');
});
afterEach(() => {
	scratch.cleanup();
});

function git(args: string[], cwd: string): string {
	const r = run('git', args, cwd, {env: gitEnv()});
	if (r.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr}`,
		);
	}
	return r.stdout;
}

function trackedOnArbiter(repo: string, path: string): boolean {
	git(['fetch', '-q', 'arbiter'], repo);
	return (
		run('git', ['cat-file', '-e', `arbiter/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
}

/** Build a stranded-strand-shaped work branch that carries a baked-in stale
 * advancing marker + a done-moved slice file (the incident's exact tree shape).
 * Returns the kept tip sha. The branch is left on the arbiter. */
function seedStrandedWorkBranch(
	repo: string,
	slug: string,
	entry: string,
): {branch: string; keptTip: string} {
	const branch = `work/${entry}`;
	// Cut from the original seed (one commit before the re-claim move).
	git(['checkout', '-q', '-b', branch, 'arbiter/main'], repo);
	mkdirSync(join(repo, 'work', 'advancing'), {recursive: true});
	writeFileSync(
		join(repo, 'work', 'advancing', `${entry}.md`),
		`---\nentry: ${entry}\nby: stale-prior-run\n---\n\nstale baked-in marker\n`,
	);
	git(['add', '-A'], repo);
	git(['commit', '-q', '-m', 'baked-in stale advancing marker'], repo);
	mkdirSync(join(repo, 'work', 'done'), {recursive: true});
	git(['mv', `work/backlog/${slug}.md`, `work/done/${slug}.md`], repo);
	git(
		['commit', '-q', '-m', `done: ${slug} (kept commit from prior run)`],
		repo,
	);
	const keptTip = git(['rev-parse', 'HEAD'], repo).trim();
	git(['push', '-q', 'arbiter', `${branch}:${branch}`], repo);
	return {branch, keptTip};
}

/** Re-claim the slice (backlog→in-progress) directly on arbiter/main, mirroring
 * the runner's just-issued claim that precedes the lock acquire. */
function reclaimOnArbiterMain(repo: string, slug: string): void {
	git(['checkout', '-q', 'main'], repo);
	git(['pull', '-q', '--ff-only', 'arbiter', 'main'], repo);
	mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
	git(['mv', `work/backlog/${slug}.md`, `work/in-progress/${slug}.md`], repo);
	git(['commit', '-q', '-m', `claim: ${slug}`], repo);
	git(['push', '-q', 'arbiter', 'main:main'], repo);
}

/** A `RungExecutor` whose `buildSlice` simulates `recoverAlreadyCommitted`:
 * check out the kept work branch, rebase onto `<arbiter>/main`, on conflict
 * `git rebase --abort` and report failure (NEVER throws — mirrors the real
 * recover return). */
function recoverConflictExecutor(branch: string): RungExecutor {
	const stub: RungExecutor['surface'] = async () => ({
		exitCode: 0,
		outcome: 'advanced',
		message: '',
	});
	return {
		async buildSlice(input) {
			const c = input.context.cwd;
			const arb = input.context.arbiter ?? 'origin';
			git(
				['fetch', '--quiet', arb, `+refs/heads/main:refs/remotes/${arb}/main`],
				c,
			);
			git(['checkout', '-q', branch], c);
			const rebase = run('git', ['rebase', `${arb}/main`], c, {env: gitEnv()});
			if (rebase.status !== 0) {
				run('git', ['rebase', '--abort'], c, {env: gitEnv()});
				return {
					exitCode: 1,
					outcome: 'usage-error',
					message: 'rebase-conflict (simulated)',
				};
			}
			return {exitCode: 0, outcome: 'advanced', message: 'rebased clean'};
		},
		slicePrd: stub,
		triageObservation: stub,
		surface: stub,
		apply: stub,
	};
}

describe('advancingMarkerPath — single path-construction seam', () => {
	it('returns the flat `work/advancing/<entry>.md` path (the folder-taxonomy reorg will repoint THIS helper)', () => {
		expect(advancingMarkerPath('slice-alpha')).toBe(
			'work/advancing/slice-alpha.md',
		);
		expect(advancingMarkerPath('prd-beta')).toBe('work/advancing/prd-beta.md');
		expect(advancingMarkerPath('observation-gamma')).toBe(
			'work/advancing/observation-gamma.md',
		);
	});

	it('acquire writes the marker through advancingMarkerPath; the lock BRANCH still carries the type-encoded entry', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['epsilon']);
		const {acquireAdvancingLock} = await import('../src/advancing-lock.js');
		const result = await acquireAdvancingLock({
			item: 'slice:epsilon',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(trackedOnArbiter(repo, advancingMarkerPath('slice-epsilon'))).toBe(
			true,
		);
		// `<type>-<slug>` survives in the locked BRANCH name (cross-type collision
		// avoidance is load-bearing even when the marker FILE later relocates).
		const subject = gitIn(['log', '-1', '--format=%s', 'arbiter/main'], repo);
		expect(subject).toContain('slice-epsilon');
	});
});

describe('advance: release is crash-safe across a failing post-lock dispatch', () => {
	it('clears the advancing borrow when the recover dispatch hits a rebase conflict (kept work intact)', async () => {
		const slug = 'alpha';
		const entry = `slice-${slug}`;
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);

		const {branch, keptTip} = seedStrandedWorkBranch(repo, slug, entry);
		reclaimOnArbiterMain(repo, slug);

		const executor = recoverConflictExecutor(branch);
		const notes: string[] = [];
		const result = await performAdvance({
			arg: `slice:${slug}`,
			cwd: repo,
			arbiter: 'arbiter',
			executor,
			note: (m) => notes.push(m),
		});

		// The dispatch failed (rebase-conflict) — exit non-zero is fine.
		expect(result.exitCode).not.toBe(0);

		// INVARIANT: no orphaned advancing marker on arbiter/main.
		expect(trackedOnArbiter(repo, `work/advancing/${entry}.md`)).toBe(false);
		// INVARIANT: the slug is in exactly ONE lifecycle folder on arbiter/main
		// (the in-progress it started in — the strand's done-move never landed).
		expect(trackedOnArbiter(repo, `work/in-progress/${slug}.md`)).toBe(true);
		expect(trackedOnArbiter(repo, `work/done/${slug}.md`)).toBe(false);
		// INVARIANT: the KEPT WORK branch tip is preserved (recoverable, never
		// `git reset --hard`'d). The release must not destroy the kept commit.
		git(['fetch', '-q', 'arbiter'], repo);
		expect(gitIn(['rev-parse', `arbiter/${branch}`], repo).trim()).toBe(
			keptTip,
		);
	});

	it('clears the advancing borrow when the failing dispatch left an UNCOMMITTED DIRTY worktree (the dirty-guard would have orphaned the marker)', async () => {
		const slug = 'gamma';
		const entry = `slice-${slug}`;
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		git(['mv', `work/backlog/${slug}.md`, `work/in-progress/${slug}.md`], repo);
		git(['commit', '-q', '-m', `claim: ${slug}`], repo);
		git(['push', '-q', 'arbiter', 'main:main'], repo);
		const preDispatchTip = git(['rev-parse', 'HEAD'], repo).trim();

		const stub: RungExecutor['surface'] = async () => ({
			exitCode: 0,
			outcome: 'advanced',
			message: '',
		});
		const executor: RungExecutor = {
			async buildSlice(input) {
				const c = input.context.cwd;
				// Mid-build failure: a step wrote new content to the worktree but
				// errored before committing — the cwd is left UNCOMMITTED-DIRTY.
				writeFileSync(
					join(c, 'README.md'),
					'# project\nuncommitted half-built\n',
				);
				writeFileSync(
					join(c, 'work', 'in-progress', `${slug}.md`),
					'half-edited slice\n',
				);
				return {
					exitCode: 1,
					outcome: 'usage-error',
					message: 'build failed mid-flight, tree dirty',
				};
			},
			slicePrd: stub,
			triageObservation: stub,
			surface: stub,
			apply: stub,
		};
		const result = await performAdvance({
			arg: `slice:${slug}`,
			cwd: repo,
			arbiter: 'arbiter',
			executor,
		});
		expect(result.exitCode).not.toBe(0);
		// INVARIANT: no orphaned advancing marker, even though dispatch left dirt.
		expect(trackedOnArbiter(repo, `work/advancing/${entry}.md`)).toBe(false);
		// The kept work commit (preDispatchTip = main) is intact — release did NOT
		// `git reset --hard` to clean the tree.
		git(['fetch', '-q', 'arbiter'], repo);
		expect(gitIn(['rev-parse', 'arbiter/main'], repo).trim()).not.toBe('');
		// The pre-dispatch commit (the claim) is still reachable from arbiter/main.
		const log = gitIn(['log', '--format=%H', 'arbiter/main'], repo);
		expect(log.split('\n')).toContain(preDispatchTip);
	});

	it('mid-rebase: a dispatch that bailed WITHOUT --abort leaves a mid-rebase tree; release still clears the borrow without discarding commits', async () => {
		const slug = 'delta';
		const entry = `slice-${slug}`;
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);

		const {branch, keptTip} = seedStrandedWorkBranch(repo, slug, entry);
		reclaimOnArbiterMain(repo, slug);

		const stub: RungExecutor['surface'] = async () => ({
			exitCode: 0,
			outcome: 'advanced',
			message: '',
		});
		const executor: RungExecutor = {
			async buildSlice(input) {
				const c = input.context.cwd;
				const arb = input.context.arbiter ?? 'origin';
				git(
					[
						'fetch',
						'--quiet',
						arb,
						`+refs/heads/main:refs/remotes/${arb}/main`,
					],
					c,
				);
				git(['checkout', '-q', branch], c);
				// Start a rebase that conflicts and DO NOT abort it — the dispatch
				// bails leaving the worktree mid-rebase (a pathological failure shape
				// the release must still survive).
				run('git', ['rebase', `${arb}/main`], c, {env: gitEnv()});
				return {
					exitCode: 1,
					outcome: 'usage-error',
					message: 'dispatch bailed mid-rebase',
				};
			},
			slicePrd: stub,
			triageObservation: stub,
			surface: stub,
			apply: stub,
		};
		const result = await performAdvance({
			arg: `slice:${slug}`,
			cwd: repo,
			arbiter: 'arbiter',
			executor,
		});
		expect(result.exitCode).not.toBe(0);
		expect(trackedOnArbiter(repo, `work/advancing/${entry}.md`)).toBe(false);
		// Kept work branch tip is intact (release did NOT reset --hard the branch).
		git(['fetch', '-q', 'arbiter'], repo);
		expect(gitIn(['rev-parse', `arbiter/${branch}`], repo).trim()).toBe(
			keptTip,
		);
	});

	it('happy path: a successful dispatch still releases the borrow exactly as before', async () => {
		const slug = 'beta';
		const entry = `slice-${slug}`;
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		// Move to in-progress on arbiter (the realistic state when build runs).
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		git(['mv', `work/backlog/${slug}.md`, `work/in-progress/${slug}.md`], repo);
		git(['commit', '-q', '-m', `claim: ${slug}`], repo);
		git(['push', '-q', 'arbiter', 'main:main'], repo);

		const executor: RungExecutor = {
			async buildSlice() {
				return {exitCode: 0, outcome: 'advanced', message: 'ok'};
			},
			async slicePrd() {
				return {exitCode: 0, outcome: 'advanced', message: ''};
			},
			async triageObservation() {
				return {exitCode: 0, outcome: 'advanced', message: ''};
			},
			async surface() {
				return {exitCode: 0, outcome: 'advanced', message: ''};
			},
			async apply() {
				return {exitCode: 0, outcome: 'advanced', message: ''};
			},
		};
		const result = await performAdvance({
			arg: `slice:${slug}`,
			cwd: repo,
			arbiter: 'arbiter',
			executor,
		});
		expect(result.exitCode).toBe(0);
		expect(trackedOnArbiter(repo, `work/advancing/${entry}.md`)).toBe(false);
	});
});
