import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {performClaim} from '../src/claim-cas.js';
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
	scratch = makeScratch('agent-runner-claim-cas-');
});
afterEach(() => {
	scratch.cleanup();
});

describe('performClaim — happy path', () => {
	it('claims a backlog item (exit 0) and moves it to in-progress on the arbiter', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('claimed');
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(false);
	});

	it('does NOT introduce claimed_by / claimed_at (WORK-CONTRACT rule 6)', async () => {
		// Contract: claim state is the folder + git history, never frontmatter.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const content = gitIn(
			['show', 'arbiter/main:work/in-progress/alpha.md'],
			repo,
		);
		expect(content).not.toMatch(/^claimed_by:/m);
		expect(content).not.toMatch(/^claimed_at:/m);
	});

	it('uses a PLAIN claim commit subject with no `(by ...)` suffix (claimer lives in git history)', async () => {
		// The claimer is NOT in the commit-message header any more (the `--by` flag
		// and the `claimedBy` concept were removed, ADR §7): the subject is plain
		// `claim: <slug>`. Who claimed is read from git (`git log` — committer
		// identity + timestamp), not parsed back out of the subject.
		const {repo} = seedRepoWithArbiter(scratch.root, ['who']);
		await performClaim({
			slug: 'who',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const subject = gitIn(['log', '-1', '--format=%s', 'arbiter/main'], repo);
		expect(subject.trim()).toBe('claim: who');
		expect(subject).not.toMatch(/\(by /);
	});

	it('leaves legacy claimed_by / claimed_at lines untouched (no longer stamped)', async () => {
		// The advisory-stamp mechanism was removed: a file still carrying legacy
		// lines is claimed normally and the lines are left exactly as-is (not
		// updated, not deleted) — the contract simply ignores them.
		const {repo} = seedRepoWithArbiter(scratch.root, ['legacy']);
		const backlogFile = join(repo, 'work', 'backlog', 'legacy.md');
		const legacy = readFileSync(backlogFile, 'utf8').replace(
			/^blockedBy: \[\]$/m,
			'blockedBy: []\nclaimed_by:\nclaimed_at:',
		);
		writeFileSync(backlogFile, legacy);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'add legacy advisory lines'], repo);
		gitIn(['push', '-q', 'arbiter', 'main'], repo);
		await performClaim({
			slug: 'legacy',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		const content = gitIn(
			['show', 'arbiter/main:work/in-progress/legacy.md'],
			repo,
		);
		// Untouched: still the empty legacy lines, NOT stamped with 'alice'.
		expect(content).toMatch(/^claimed_by:\s*$/m);
		expect(content).not.toMatch(/^claimed_by: alice$/m);
	});

	it('restores the original branch and cleans up the claim branch', async () => {
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
		// The throwaway claim branch must be gone.
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

	it('returns "lost" when the item is already in-progress on the arbiter', async () => {
		const {repo, clone} = (() => {
			const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
			return {repo: seeded.repo, clone: seeded.clone};
		})();
		// First claimer wins from a separate clone.
		const other = clone('other');
		const first = await performClaim({
			slug: 'alpha',
			cwd: other,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(first.exitCode).toBe(0);
		// Second claimer (original repo) now finds it already in-progress.
		const second = await performClaim({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(2);
		expect(second.outcome).toBe('lost');
		// The in-progress message points a user re-running on their OWN item at the
		// real recovery verbs (resume / work-on / requeue) rather than only
		// "pick another item".
		expect(second.message).toMatch(/already in-progress/);
		expect(second.message).toMatch(/resume/);
		expect(second.message).toMatch(/work-on/);
		expect(second.message).toMatch(/requeue/);
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
		// It must NOT have mutated the arbiter.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
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
	it('reports the intended push and does NOT mutate the arbiter', async () => {
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
		expect(notes.some((n) => n.includes('[dry-run]'))).toBe(true);
		// Arbiter untouched: still in backlog, not in-progress.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		// Original branch restored, claim branch cleaned up.
		const branches = gitIn(['branch', '--list', 'claim/alpha'], repo);
		expect(branches.trim()).toBe('');
	});
});

describe('performClaim — main merely advanced then succeeds', () => {
	it('retries when a DIFFERENT item lands on main, then claims ours', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['ours', 'other']);
		const us = seeded.repo;
		const them = seeded.clone('them');

		// Land `other` on main from a separate clone (advances main, but `ours`
		// is still claimable).
		const landed = await performClaim({
			slug: 'other',
			cwd: them,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(landed.exitCode).toBe(0);

		// Our claim sees the stale base on the first push, refetches, and wins.
		const ours = await performClaim({
			slug: 'ours',
			cwd: us,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(ours.exitCode).toBe(0);
		expect(existsOnArbiterMain(us, 'in-progress', 'ours')).toBe(true);
		expect(existsOnArbiterMain(us, 'done', 'other')).toBe(false);
		expect(existsOnArbiterMain(us, 'in-progress', 'other')).toBe(true);
	});
});

describe('claim race (mirrors claim.sh verification)', () => {
	it('a simultaneous two-claimer race over the same item yields exactly one winner', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const a = seeded.clone('a');
		const b = seeded.clone('b');

		// Genuinely concurrent: both in-process claims run at the same time, so the
		// arbiter's ref-CAS (not test ordering) is what picks the single winner.
		const [ra, rb] = await Promise.all([
			performClaim({slug: 'solo', cwd: a, arbiter: 'arbiter', env: gitEnv()}),
			performClaim({slug: 'solo', cwd: b, arbiter: 'arbiter', env: gitEnv()}),
		]);

		const claimed = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(claimed).toHaveLength(1);
		expect(lost).toHaveLength(1);
		// The arbiter ref agrees: the item is in-progress exactly once.
		expect(existsOnArbiterMain(a, 'in-progress', 'solo')).toBe(true);
		expect(existsOnArbiterMain(a, 'backlog', 'solo')).toBe(false);
	});
});
