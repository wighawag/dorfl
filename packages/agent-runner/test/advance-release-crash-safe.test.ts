import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performAdvance, type RungExecutor} from '../src/advance.js';
import {listItemLocks} from '../src/item-lock.js';
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
 * slice `advancing-lock-release-crash-safe`), RE-TARGETED after the capstone
 * cut-over (slice `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`).
 *
 * The original incident left the slug in BOTH `work/advancing/<entry>.md` (an
 * orphaned ON-`main` marker) AND a lifecycle folder after a failing post-lock
 * dispatch. The cut-over DISSOLVES that whole class: the `work/advancing/` marker
 * is RETIRED (no transient status in `main`'s tree), and for a BUILD-SLICE rung the
 * advance layer takes NO unified hold at all (the inner `do`'s claim/slice lock is
 * the sole exclusion). So there is no advance-layer release that touches the
 * working tree, and nothing on `main` to orphan.
 *
 * These tests pin the POST-cut-over invariants: after ANY build-slice tick (success
 * or failure, even a dispatch that left a dirty / mid-rebase tree), (a) NO
 * `work/advancing/` marker ever exists on `<arbiter>/main`, (b) NO orphaned unified
 * lock remains, and (c) the kept work branch tip is intact (recoverable, NEVER
 * `git reset --hard`'d).
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

/** Build a stranded-strand-shaped work branch that carries a done-moved slice file
 * (the incident's tree shape, MINUS the retired baked-in advancing marker).
 * Returns the kept tip sha. The branch is left on the arbiter. */
function seedStrandedWorkBranch(
	repo: string,
	slug: string,
	entry: string,
): {branch: string; keptTip: string} {
	const branch = `work/${entry}`;
	git(['checkout', '-q', '-b', branch, 'arbiter/main'], repo);
	mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
	git(['mv', `work/tasks/todo/${slug}.md`, `work/tasks/done/${slug}.md`], repo);
	git(
		['commit', '-q', '-m', `done: ${slug} (kept commit from prior run)`],
		repo,
	);
	const keptTip = git(['rev-parse', 'HEAD'], repo).trim();
	git(['push', '-q', 'arbiter', `${branch}:${branch}`], repo);
	return {branch, keptTip};
}

/** Re-claim the slice (backlog→in-progress) directly on arbiter/main, mirroring
 * the runner's just-issued claim that precedes the build dispatch. */
function reclaimOnArbiterMain(repo: string, slug: string): void {
	git(['checkout', '-q', 'main'], repo);
	git(['pull', '-q', '--ff-only', 'arbiter', 'main'], repo);
	mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
	git(
		['mv', `work/tasks/todo/${slug}.md`, `work/in-progress/${slug}.md`],
		repo,
	);
	git(['commit', '-q', '-m', `claim: ${slug}`], repo);
	git(['push', '-q', 'arbiter', 'main:main'], repo);
}

/** A `RungExecutor` whose `buildSlice` simulates `recoverAlreadyCommitted`:
 * check out the kept work branch, rebase onto `<arbiter>/main`, on conflict
 * `git rebase --abort` and report failure (NEVER throws). */
function recoverConflictExecutor(branch: string): RungExecutor {
	const stub: RungExecutor['surface'] = async () => ({
		exitCode: 0,
		outcome: 'advanced',
		message: '',
	});
	return {
		async buildTask(input) {
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
		taskBrief: stub,
		triageObservation: stub,
		surface: stub,
		apply: stub,
	};
}

/** Assert the POST-cut-over invariants hold for `entry`/`slug` after a tick. */
async function assertNoTransientResidue(
	repo: string,
	slug: string,
	entry: string,
): Promise<void> {
	// (a) NO `work/advancing/` marker EVER exists (the folder is retired).
	expect(trackedOnArbiter(repo, `work/advancing/${entry}.md`)).toBe(false);
	// (b) NO orphaned unified lock (a build-slice rung takes none at the advance
	// layer; the inner `do` released its own).
	expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
}

describe('advance build-slice rung: no transient residue across a failing dispatch', () => {
	it('leaves NO marker/lock when the recover dispatch hits a rebase conflict (kept work intact)', async () => {
		const slug = 'alpha';
		const entry = `task-${slug}`;
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);

		const {branch, keptTip} = seedStrandedWorkBranch(repo, slug, entry);
		reclaimOnArbiterMain(repo, slug);

		const executor = recoverConflictExecutor(branch);
		const result = await performAdvance({
			arg: `task:${slug}`,
			cwd: repo,
			arbiter: 'arbiter',
			executor,
		});

		// The dispatch failed (rebase-conflict) — exit non-zero is fine.
		expect(result.exitCode).not.toBe(0);

		await assertNoTransientResidue(repo, slug, entry);
		// INVARIANT: the slug is in exactly ONE lifecycle folder on arbiter/main
		// (the in-progress it started in — the strand's done-move never landed).
		expect(trackedOnArbiter(repo, `work/in-progress/${slug}.md`)).toBe(true);
		expect(trackedOnArbiter(repo, `work/tasks/done/${slug}.md`)).toBe(false);
		// INVARIANT: the KEPT WORK branch tip is preserved (recoverable, never
		// `git reset --hard`'d).
		git(['fetch', '-q', 'arbiter'], repo);
		expect(gitIn(['rev-parse', `arbiter/${branch}`], repo).trim()).toBe(
			keptTip,
		);
	});

	it('leaves NO marker/lock when the failing dispatch left an UNCOMMITTED DIRTY worktree', async () => {
		const slug = 'gamma';
		const entry = `task-${slug}`;
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		git(
			['mv', `work/tasks/todo/${slug}.md`, `work/in-progress/${slug}.md`],
			repo,
		);
		git(['commit', '-q', '-m', `claim: ${slug}`], repo);
		git(['push', '-q', 'arbiter', 'main:main'], repo);
		const preDispatchTip = git(['rev-parse', 'HEAD'], repo).trim();

		const stub: RungExecutor['surface'] = async () => ({
			exitCode: 0,
			outcome: 'advanced',
			message: '',
		});
		const executor: RungExecutor = {
			async buildTask(input) {
				const c = input.context.cwd;
				// Mid-build failure: a step wrote new content to the worktree but
				// errored before committing — the cwd is left UNCOMMITTED-DIRTY.
				writeFileSync(
					join(c, 'README.md'),
					'# project\nuncommitted half-built\n',
				);
				return {
					exitCode: 1,
					outcome: 'usage-error',
					message: 'build failed mid-flight, tree dirty',
				};
			},
			taskBrief: stub,
			triageObservation: stub,
			surface: stub,
			apply: stub,
		};
		const result = await performAdvance({
			arg: `task:${slug}`,
			cwd: repo,
			arbiter: 'arbiter',
			executor,
		});
		expect(result.exitCode).not.toBe(0);
		await assertNoTransientResidue(repo, slug, entry);
		// The pre-dispatch commit (the claim) is still reachable from arbiter/main.
		git(['fetch', '-q', 'arbiter'], repo);
		const log = gitIn(['log', '--format=%H', 'arbiter/main'], repo);
		expect(log.split('\n')).toContain(preDispatchTip);
	});

	it('happy path: a successful build-slice dispatch leaves no marker/lock residue', async () => {
		const slug = 'beta';
		const entry = `task-${slug}`;
		const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
		mkdirSync(join(repo, 'work', 'in-progress'), {recursive: true});
		git(
			['mv', `work/tasks/todo/${slug}.md`, `work/in-progress/${slug}.md`],
			repo,
		);
		git(['commit', '-q', '-m', `claim: ${slug}`], repo);
		git(['push', '-q', 'arbiter', 'main:main'], repo);

		const executor: RungExecutor = {
			async buildTask() {
				return {exitCode: 0, outcome: 'advanced', message: 'ok'};
			},
			async taskBrief() {
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
			arg: `task:${slug}`,
			cwd: repo,
			arbiter: 'arbiter',
			executor,
		});
		expect(result.exitCode).toBe(0);
		await assertNoTransientResidue(repo, slug, entry);
	});
});
