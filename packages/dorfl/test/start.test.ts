import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {performStart} from '../src/start.js';
import {performClaim} from '../src/claim-cas.js';
import {listItemLocks} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	raceClone,
	racerEnv,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('dorfl-start-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Current branch (short name) of a checkout. */
function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/** Does a local branch exist in this checkout? */
function localBranchExists(repo: string, branch: string): boolean {
	return gitIn(['branch', '--list', branch], repo).trim() !== '';
}

/**
 * Move an item from backlog → done on the arbiter (simulating completion), so we
 * can test the done/ refusal. The body rests in `backlog/` now (claim no longer
 * moves it), so the durable done-move sources from there. Uses a separate clone
 * so we don't disturb the checkout under test.
 */
function completeOnArbiter(
	seeded: {clone(label: string): string},
	slug: string,
) {
	const finisher = seeded.clone(`finish-${slug}`);
	gitIn(['fetch', '-q', 'arbiter'], finisher);
	gitIn(['checkout', '-q', '-B', `done/${slug}`, 'arbiter/main'], finisher);
	// git mv needs the destination dir to exist (git tracks no empty dirs).
	mkdirSync(join(finisher, 'work', 'tasks', 'done'), {recursive: true});
	gitIn(
		['mv', `work/tasks/ready/${slug}.md`, `work/tasks/done/${slug}.md`],
		finisher,
	);
	gitIn(['commit', '-q', '-m', `done: ${slug}`], finisher);
	gitIn(['push', '-q', 'arbiter', `done/${slug}:main`], finisher);
}

describe('start — backlog item, winning claim', () => {
	it('claims and lands the user on work/<slug> off the latest arbiter main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performStart({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('started');
		expect(result.branch).toBe('work/task-alpha');
		expect(currentBranch(repo)).toBe('work/task-alpha');
		// The claim landed: the lock is held; the body STAYS in backlog/ on the arbiter.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([
			'task-alpha',
		]);
		// The work branch (cut off the latest arbiter main) carries the backlog body.
		const show = gitIn(
			['cat-file', '-e', 'HEAD:work/tasks/ready/alpha.md'],
			repo,
		);
		expect(show).toBe('');
	});
});

describe('start — backlog item, losing/contended claim', () => {
	it('on a lost race leaves the user untouched and creates NO work branch', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const repo = seeded.repo;
		// Another claimer wins first from a separate clone.
		const other = seeded.clone('other');
		const won = await performClaim({
			slug: 'alpha',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(won.exitCode).toBe(0);

		const before = currentBranch(repo);
		const result = await performStart({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		// Lock-based: the item is now claimed (its lock is held), so start refuses
		// (exit 1) rather than re-claiming — it never re-claims a held item, even
		// though the body still rests in backlog/.
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		// User untouched; NO work branch created.
		expect(currentBranch(repo)).toBe(before);
		expect(localBranchExists(repo, 'work/task-alpha')).toBe(false);
	});

	it('a two-claimer race: the loser creates no branch, the winner lands on its work branch', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// Distinct committer identity per racer so the two claim commits get DISTINCT
		// shas (as two real claimers would) and the loser loses through the genuine
		// CAS, not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');
		const beforeA = currentBranch(a);
		const beforeB = currentBranch(b);

		// Genuinely concurrent: the arbiter ref-CAS picks the single winner.
		const [ra, rb] = await Promise.all([
			performStart({
				slug: 'solo',
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('a'),
			}),
			performStart({
				slug: 'solo',
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('b'),
			}),
		]);

		const winners = [ra, rb].filter((r) => r.exitCode === 0);
		const losers = [ra, rb].filter((r) => r.exitCode !== 0);
		expect(winners).toHaveLength(1);
		expect(losers).toHaveLength(1);
		expect(winners[0].outcome).toBe('started');
		// The loser is lost (race) or refused (saw it already in-progress); either
		// way it created NO work branch.
		expect(['lost', 'contended', 'refused']).toContain(losers[0].outcome);

		// Winner is on work/solo; loser is untouched, no work branch.
		const aWon = ra.exitCode === 0;
		const winnerRepo = aWon ? a : b;
		const loserRepo = aWon ? b : a;
		const loserBefore = aWon ? beforeB : beforeA;
		expect(currentBranch(winnerRepo)).toBe('work/task-solo');
		expect(currentBranch(loserRepo)).toBe(loserBefore);
		expect(localBranchExists(loserRepo, 'work/task-solo')).toBe(false);

		// The arbiter agrees: the lock is held exactly once; the body stays in backlog/.
		expect(await listItemLocks(a, 'arbiter', gitEnv())).toEqual(['task-solo']);
		expect(existsOnArbiterMain(a, 'backlog', 'solo')).toBe(true);
	});
});

describe('start — already-claimed (held lock) item', () => {
	it('refuses by default with a message that points at `git log`', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const repo = seeded.repo;
		// Claim it from a separate clone so it is in-progress on the arbiter.
		const other = seeded.clone('other');
		await performClaim({
			slug: 'beta',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const before = currentBranch(repo);
		const result = await performStart({
			slug: 'beta',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/already in-progress/);
		expect(result.message).toMatch(/--resume/);
		// The decision is folder-based (WORK-CONTRACT rule 6 — no claimed_by field).
		// There is NO `claimedBy` concept any more (ADR §7): the message never names
		// the claimer; it points at git history instead.
		expect(result.message).toMatch(/git log/);
		expect(result.message).not.toMatch(/\bby \w/);
		// User untouched; no work branch.
		expect(currentBranch(repo)).toBe(before);
		expect(localBranchExists(repo, 'work/task-beta')).toBe(false);
	});

	it('--resume switches to the work branch WITHOUT claiming', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const repo = seeded.repo;
		const other = seeded.clone('other');
		await performClaim({
			slug: 'beta',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});

		const result = await performStart({
			slug: 'beta',
			cwd: repo,
			arbiter: 'arbiter',
			resume: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('resumed');
		expect(result.branch).toBe('work/task-beta');
		expect(currentBranch(repo)).toBe('work/task-beta');
		// Still claimed (we did NOT re-claim): the lock is held, body still in backlog/.
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([
			'task-beta',
		]);
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
		// The work branch (cut off arbiter main) carries the backlog body.
		const onBranch = gitIn(
			['cat-file', '-e', 'HEAD:work/tasks/ready/beta.md'],
			repo,
		);
		expect(onBranch).toBe('');
	});
});

describe('start — done / absent item', () => {
	it('refuses a done item', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['gamma']);
		const repo = seeded.repo;
		const other = seeded.clone('other');
		await performClaim({
			slug: 'gamma',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		completeOnArbiter(seeded, 'gamma');

		const before = currentBranch(repo);
		const result = await performStart({
			slug: 'gamma',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/already done/);
		expect(currentBranch(repo)).toBe(before);
		expect(localBranchExists(repo, 'work/task-gamma')).toBe(false);
	});

	it('refuses an absent item', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performStart({
			slug: 'does-not-exist',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/not present/);
		expect(localBranchExists(repo, 'work/task-does-not-exist')).toBe(false);
	});
});

describe('start — slug inference from branch', () => {
	it('infers the slug from a work/<slug> branch when none is given (resume)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['delta']);
		const repo = seeded.repo;
		// Claim + onboard once via an explicit start.
		const first = await performStart({
			slug: 'delta',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.exitCode).toBe(0);
		expect(currentBranch(repo)).toBe('work/task-delta');

		// Now, sitting on work/delta with the item in-progress, re-run start with
		// NO slug and --resume — the slug is inferred from the branch.
		const again = await performStart({
			cwd: repo,
			arbiter: 'arbiter',
			resume: true,
			env: gitEnv(),
		});
		expect(again.exitCode).toBe(0);
		expect(again.outcome).toBe('resumed');
		expect(again.branch).toBe('work/task-delta');
		expect(currentBranch(repo)).toBe('work/task-delta');
	});

	it('errors when no slug is given and not on a work/<slug> branch', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		expect(currentBranch(repo)).toBe('main');
		const result = await performStart({
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/missing <slug>/);
	});
});

describe('start — environment errors', () => {
	it('errors when the arbiter remote does not exist', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performStart({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'nope',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/no git remote named 'nope'/);
	});

	it('does NOT launch any agent/editor — only onboards onto the branch', async () => {
		// There is nothing to spawn: performStart has no harness hook. This test
		// documents the contract by asserting the surface (a pure onboard result).
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performStart({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result).toEqual({
			exitCode: 0,
			outcome: 'started',
			branch: 'work/task-alpha',
			message: expect.stringContaining('Started'),
		});
	});
});
