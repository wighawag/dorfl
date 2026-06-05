import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {existsSync, writeFileSync, readFileSync} from 'node:fs';
import {
	jobWorktreeStrategy,
	inPlaceStrategy,
	selectIsolationStrategy,
	type IsolatedTree,
} from '../src/isolation.js';
import {performClaim} from '../src/claim-cas.js';
import {jobWorktreePath} from '../src/workspace.js';
import {gitMv} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-isolation-');
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * Drive the SHARED post-claim pipeline against an isolated tree handle, reading
 * ONLY the uniform handle fields (`dir`/`branch`/`arbiterRemote`) — never a
 * concrete `Job`. Proves the seam removed the `Job`-shape coupling: the same
 * steps land work via EITHER strategy. (Mirrors the body `run`'s `runOneItem`
 * runs: build → done-move → commit → push the branch to the arbiter.)
 */
function buildAndPushViaHandle(tree: IsolatedTree, slug: string): void {
	const env = gitEnv();
	// 1. "Build": edit a file so the commit is non-empty.
	writeFileSync(join(tree.dir, 'agent-output.txt'), 'work done\n');
	// 2. Done-move + completion commit (runner-owned), reading the handle dir.
	gitMv(`work/in-progress/${slug}.md`, `work/done/${slug}.md`, tree.dir);
	gitIn(['add', '-A'], tree.dir);
	gitIn(['commit', '-q', '-m', `feat(${slug}): complete; done`], tree.dir);
	// 3. Integrate (merge): push the branch to the handle's arbiter remote main.
	gitIn(['push', '-q', tree.arbiterRemote, `${tree.branch}:main`], tree.dir);
}

describe('jobWorktreeStrategy — the existing run isolation, extracted', () => {
	it('prepares a job worktree in the agents area on work/<slug>, cut from fresh main', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		await performClaim({
			slug: 'feat',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const strategy = jobWorktreeStrategy({
			fromRepo: repo,
			arbiter: 'arbiter',
			workspacesDir,
		});
		const tree = strategy.prepare({slug: 'feat', env: gitEnv()});
		try {
			// The handle's dir IS the external job worktree (agents' area), NOT the
			// checkout — no in-place mutation.
			const expected = jobWorktreePath(
				workspacesDir,
				`file://${arbiter}`,
				'feat',
			);
			expect(tree.dir).toBe(expected);
			expect(existsSync(tree.dir)).toBe(true);
			expect(tree.dir.startsWith(workspacesDir)).toBe(true);
			expect(tree.branch).toBe('work/feat');
			// Inside a job worktree the arbiter remote is the mirror's clone `origin`.
			expect(tree.arbiterRemote).toBe('origin');
			expect(tree.arbiterUrl).toBe(`file://${arbiter}`);
			// The work item is on this branch (claimed → in-progress), proving the
			// worktree was cut from the freshly-fetched main that includes the claim.
			expect(existsSync(join(tree.dir, 'work', 'in-progress', 'feat.md'))).toBe(
				true,
			);
		} finally {
			tree.teardown();
		}
	});

	it('the SHARED pipeline lands work via the handle, then teardown reaps the provably-safe worktree (ADR §4)', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		await performClaim({
			slug: 'feat',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const strategy = jobWorktreeStrategy({
			fromRepo: repo,
			arbiter: 'arbiter',
			workspacesDir,
		});
		const tree = strategy.prepare({slug: 'feat', env: gitEnv()});
		buildAndPushViaHandle(tree, 'feat');

		// The work landed on the arbiter's main (merge) — provably safe.
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);

		// Teardown re-applies the §4 predicate: clean tree AND on the arbiter ⇒
		// the worktree is REAPED (git worktree remove + prune, never rm -rf).
		tree.teardown();
		expect(existsSync(tree.dir)).toBe(false);
	});

	it('teardown RETAINS a worktree whose work is NOT on the arbiter (never-lose-work, ADR §4)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		await performClaim({
			slug: 'feat',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const strategy = jobWorktreeStrategy({
			fromRepo: repo,
			arbiter: 'arbiter',
			workspacesDir,
		});
		const tree = strategy.prepare({slug: 'feat', env: gitEnv()});
		// "Build" but DON'T push: a clean-but-unpushed (or dirty) tree is not
		// provably safe, so teardown must retain it (the needs-attention signal).
		writeFileSync(join(tree.dir, 'agent-output.txt'), 'unsaved work\n');

		tree.teardown();
		// The worktree (and its un-saved work) is retained for the human.
		expect(existsSync(tree.dir)).toBe(true);
		expect(existsSync(join(tree.dir, 'agent-output.txt'))).toBe(true);
	});
});

describe('inPlaceStrategy — operate in the current checkout, no mirror/worktree', () => {
	it('prepares the checkout itself on work/<slug>, with the checkout arbiter remote/url', async () => {
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		await performClaim({
			slug: 'feat',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const strategy = inPlaceStrategy({checkout: repo, arbiter: 'arbiter'});
		const tree = strategy.prepare({slug: 'feat', env: gitEnv()});

		// The handle's dir IS the checkout (in-place); no external worktree.
		expect(tree.dir).toBe(repo);
		expect(tree.branch).toBe('work/feat');
		// The arbiter remote/url are the CHECKOUT's own (not a mirror `origin`).
		expect(tree.arbiterRemote).toBe('arbiter');
		expect(tree.arbiterUrl).toBe(`file://${arbiter}`);

		// The checkout is now ON the work branch (switched in-place).
		const head = gitIn(['symbolic-ref', '--short', 'HEAD'], repo).trim();
		expect(head).toBe('work/feat');
		// No hub mirror / external worktree was created anywhere under the checkout.
		expect(existsSync(join(repo, 'repos'))).toBe(false);
	});

	it('the SHARED pipeline lands work via the in-place handle (same steps as job-worktree)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		await performClaim({
			slug: 'feat',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const strategy = inPlaceStrategy({checkout: repo, arbiter: 'arbiter'});
		const tree = strategy.prepare({slug: 'feat', env: gitEnv()});

		// The EXACT same handle-driven pipeline as the job-worktree case.
		buildAndPushViaHandle(tree, 'feat');

		// Work landed on the arbiter's main through the in-place checkout.
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
	});

	it('teardown is a NO-OP: the human checkout is left in a defined state, NEVER reaped', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		await performClaim({
			slug: 'feat',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const strategy = inPlaceStrategy({checkout: repo, arbiter: 'arbiter'});
		const tree = strategy.prepare({slug: 'feat', env: gitEnv()});
		// Leave un-saved work in the checkout — teardown must NOT delete it.
		writeFileSync(join(repo, 'scratch.txt'), 'human work in progress\n');

		// Defined state documented by this test: the checkout survives teardown,
		// stays on work/<slug>, and keeps its working-tree contents (README + the
		// un-saved scratch file). teardown reaps nothing.
		tree.teardown();
		expect(existsSync(repo)).toBe(true);
		expect(existsSync(join(repo, 'README.md'))).toBe(true);
		expect(existsSync(join(repo, 'scratch.txt'))).toBe(true);
		expect(readFileSync(join(repo, 'scratch.txt'), 'utf8')).toBe(
			'human work in progress\n',
		);
		const head = gitIn(['symbolic-ref', '--short', 'HEAD'], repo).trim();
		expect(head).toBe('work/feat');
	});

	it('switches to an EXISTING work/<slug> branch (resume / re-run) instead of failing', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		await performClaim({
			slug: 'feat',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// Pre-create the work branch + move off it, so prepare must SWITCH not -c.
		gitIn(['fetch', '-q', 'arbiter'], repo);
		gitIn(['switch', '-q', '-c', 'work/feat', 'arbiter/main'], repo);
		gitIn(['switch', '-q', 'main'], repo);

		const strategy = inPlaceStrategy({checkout: repo, arbiter: 'arbiter'});
		const tree = strategy.prepare({slug: 'feat', env: gitEnv()});
		expect(tree.branch).toBe('work/feat');
		const head = gitIn(['symbolic-ref', '--short', 'HEAD'], repo).trim();
		expect(head).toBe('work/feat');
	});
});

describe('selectIsolationStrategy — by "is there a checkout", not a hardcoded path', () => {
	it('selects the in-place strategy when a checkout is given', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const strategy = selectIsolationStrategy({
			checkout: repo,
			arbiter: 'arbiter',
		});
		expect(strategy.name).toBe('in-place');
	});

	it('selects the job-worktree strategy when there is NO checkout (fromRepo + workspacesDir)', () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const strategy = selectIsolationStrategy({
			fromRepo: repo,
			arbiter: 'arbiter',
			workspacesDir: join(scratch.root, '.agent-runner'),
		});
		expect(strategy.name).toBe('job-worktree');
	});

	it('the job-worktree selection requires fromRepo + workspacesDir (no checkout)', () => {
		expect(() => selectIsolationStrategy({arbiter: 'arbiter'})).toThrow(
			/fromRepo.*workspacesDir/,
		);
	});

	it('both selected strategies yield the SAME uniform handle shape', async () => {
		// Two independent repos so each strategy claims its own slug.
		const inPlace = seedRepoWithArbiter(join(scratch.root, 'ip'), ['feat']);
		const jobwt = seedRepoWithArbiter(join(scratch.root, 'jw'), ['feat']);
		const workspacesDir = join(scratch.root, '.agent-runner');
		await performClaim({
			slug: 'feat',
			cwd: inPlace.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		await performClaim({
			slug: 'feat',
			cwd: jobwt.repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const ipTree = selectIsolationStrategy({
			checkout: inPlace.repo,
			arbiter: 'arbiter',
		}).prepare({slug: 'feat', env: gitEnv()});
		const jwTree = selectIsolationStrategy({
			fromRepo: jobwt.repo,
			arbiter: 'arbiter',
			workspacesDir,
		}).prepare({slug: 'feat', env: gitEnv()});
		try {
			// Both expose the identical field set the pipeline reads.
			const keys = (t: IsolatedTree) => Object.keys(t).sort();
			expect(keys(ipTree)).toEqual(keys(jwTree));
			expect(keys(ipTree)).toEqual([
				'arbiterRemote',
				'arbiterUrl',
				'branch',
				'dir',
				'teardown',
			]);
			// Same branch; differing dirs (checkout vs agents' area) — proving the
			// pipeline never assumes WHERE the tree lives.
			expect(ipTree.branch).toBe('work/feat');
			expect(jwTree.branch).toBe('work/feat');
			expect(ipTree.dir).toBe(inPlace.repo);
			expect(jwTree.dir.startsWith(workspacesDir)).toBe(true);
		} finally {
			ipTree.teardown();
			jwTree.teardown();
		}
	});
});
