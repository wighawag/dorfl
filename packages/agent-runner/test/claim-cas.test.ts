import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performClaim} from '../src/claim-cas.js';
import {listItemLocks, readItemLock} from '../src/item-lock.js';
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
	scratch = makeScratch('agent-runner-claim-cas-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('performClaim — happy path', () => {
	it('claims a backlog item (exit 0), acquires the lock, and leaves the body in backlog (NO main move)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
		// The body STAYS in backlog/ on main — claim writes nothing to main.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		// The per-item lock (action: implement) IS the claim.
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([
			'task-alpha',
		]);
	});

	it('writes NOTHING to main (the arbiter main tip is unchanged after the claim)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const mainBefore = gitIn(['rev-parse', 'arbiter/main'], repo).trim();
		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('claimed');
		// No claim commit (claim no longer lands on main); onboarding cuts off main.
		expect(result.claimCommit).toBeUndefined();
		gitIn(['fetch', '-q', 'arbiter'], repo);
		const mainAfter = gitIn(['rev-parse', 'arbiter/main'], repo).trim();
		expect(mainAfter).toBe(mainBefore);
	});

	it('records the holder/since on the lock entry (claim state is the lock, not frontmatter)', async () => {
		// Contract: claim state is the lock + git history, never advisory frontmatter.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const entry = await readItemLock({
			item: 'task:alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(entry?.action).toBe('implement');
		expect(entry?.state).toBe('active');
		expect(entry?.holder).not.toBe('');
		// The backlog body is untouched — no claimed_by/claimed_at stamped into it.
		const content = gitIn(
			['show', 'arbiter/main:work/tasks/ready/alpha.md'],
			repo,
		);
		expect(content).not.toMatch(/^claimed_by:/m);
		expect(content).not.toMatch(/^claimed_at:/m);
	});

	it('leaves the original branch and working tree untouched (claim mutates no local refs)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const before = gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
		await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const after = gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
		expect(after).toBe(before);
		// No throwaway claim branch is ever created any more.
		const branches = gitIn(['branch', '--list', 'claim/alpha'], repo);
		expect(branches.trim()).toBe('');
	});
});

describe('performClaim — not claimable (exit 2)', () => {
	it('returns "lost" when the slug is not in backlog', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performClaim({
			slug: 'does-not-exist',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
		// The done/absent message stays plain (no "continue your own item" hint).
		expect(result.message).toMatch(/not found on/);
		expect(result.message).not.toMatch(/resume/);
	});

	it('returns "lost" when the item is already CLAIMED (lock held) on the arbiter', async () => {
		const {repo, clone} = (() => {
			const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
			return {repo: seeded.repo, clone: seeded.clone};
		})();
		// First claimer wins from a separate clone (holds the lock; body stays in backlog).
		const other = clone('other');
		const first = await performClaim({
			slug: 'alpha',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.exitCode).toBe(0);
		// Second claimer (original repo) loses the lock race definitively (exit 2),
		// even though the body is still in backlog/.
		const second = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
		// The held-lock message points a user re-running on their OWN item at the
		// real recovery verbs (resume / work-on / requeue) rather than only
		// "pick another item".
		expect(second.message).toMatch(/already claimed/);
		expect(second.message).toMatch(/resume/);
		expect(second.message).toMatch(/work-on/);
		expect(second.message).toMatch(/requeue/);
		// The body never moved; the lock is held exactly once (b did not steal it).
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([
			'task-alpha',
		]);
	});
});

describe('performClaim — usage / env errors (exit 1)', () => {
	it('refuses on a dirty working tree', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		writeFileSync(join(repo, 'README.md'), '# project\nDIRTY\n');
		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/uncommitted changes/);
		// It must NOT have mutated the arbiter, and must NOT have acquired a lock.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
	});

	it('errors when the arbiter remote does not exist', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'nope',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/no git remote named 'nope'/);
	});

	it('errors when not given a slug', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performClaim({
			slug: '',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
	});
});

describe('performClaim — dry run', () => {
	it('reports it WOULD claim, takes NO lock and does NOT mutate the arbiter', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const notes: string[] = [];
		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			dryRun: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		expect(result.exitCode).toBe(0);
		expect(notes.some((n) => n.includes('DRY-RUN'))).toBe(true);
		// Arbiter untouched: still in backlog, never moved.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		// No lock acquired (a dry-run mutates nothing).
		expect(await listItemLocks(repo, 'arbiter', gitEnv())).toEqual([]);
	});
});

describe('performClaim — two different items both claim cleanly', () => {
	it('a sibling item being claimed does NOT block ours (per-item locks never falsely contend)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['ours', 'other']);
		const us = seeded.repo;
		const them = seeded.clone('them');

		// `other` is claimed from a separate clone (a different per-item ref).
		const landed = await performClaim({
			slug: 'other',
			cwd: them,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(landed.exitCode).toBe(0);

		// Our claim of a DIFFERENT item never contends on `other`'s lock; it wins.
		const ours = await performClaim({
			slug: 'ours',
			cwd: us,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(ours.exitCode).toBe(0);
		// Both bodies stay in backlog/; both locks are held, one per item.
		expect(existsOnArbiterMain(us, 'backlog', 'ours')).toBe(true);
		expect(existsOnArbiterMain(us, 'backlog', 'other')).toBe(true);
		expect((await listItemLocks(us, 'arbiter', gitEnv())).sort()).toEqual([
			'task-other',
			'task-ours',
		]);
	});
});

describe('claim race (mirrors claim.sh verification)', () => {
	it('a simultaneous two-claimer race over the same item yields exactly one winner', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		// Distinct committer identity per racer so the two claim commits get DISTINCT
		// shas (as two real claimers would) and the loser loses through the genuine
		// CAS, not a fixture sha-collision. See racerEnv.
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');

		// Genuinely concurrent: both in-process claims run at the same time, so the
		// arbiter's ref-CAS (not test ordering) is what picks the single winner.
		const [ra, rb] = await Promise.all([
			performClaim({
				slug: 'solo',
				cwd: a,
				arbiter: 'arbiter',
				env: racerEnv('a'),
			}),
			performClaim({
				slug: 'solo',
				cwd: b,
				arbiter: 'arbiter',
				env: racerEnv('b'),
			}),
		]);

		const claimed = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(claimed).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// The lock ref agrees: the item is locked exactly once, body still in backlog.
		expect(await listItemLocks(a, 'arbiter', gitEnv())).toEqual(['task-solo']);
		expect(existsOnArbiterMain(a, 'backlog', 'solo')).toBe(true);
	});
});
