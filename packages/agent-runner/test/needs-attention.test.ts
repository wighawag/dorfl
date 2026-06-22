import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {
	routeToNeedsAttention,
	returnToBacklog,
} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {scanRepoPaths} from '../src/scan.js';
import {performClaim} from '../src/claim-cas.js';
import {readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';
import type {Config} from '../src/config.js';

/**
 * The needs-attention RECOVERY SURFACE after the cut-over (slice
 * `cutover-needs-attention-becomes-lock-stuck-recovery-surface`, decision i+):
 * stuck-state is the per-item lock `state: stuck`, NOT a `needs-attention/` folder
 * file. So:
 *   - {@link routeToNeedsAttention} no longer does a `git mv` to
 *     `needs-attention/`; it SAVES the agent's uncommitted wip to the work branch
 *     tip + PUSHES the branch (the recoverable half). The reason/questions ride on
 *     the lock entry (the seam marks it stuck);
 *   - the seam bounce ({@link ledgerWrite.applyNeedsAttentionTransition}) marks the
 *     held lock `active → stuck` (the SOLE stuck record); NO `main` write;
 *   - {@link returnToBacklog} (requeue) RELEASES the stuck lock (the body already
 *     rests in `backlog/`); NO `needs-attention/` folder read.
 *
 * All real git against a local `--bare file://` arbiter, writing only into its own
 * temp fixtures.
 */

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-needs-attention-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Stand a repo up exactly as the runner leaves it just before a stuck outcome: a
 * slice claimed (the per-item lock is held active; the body RESTS in backlog/) and
 * onboarded onto `work/<slug>` off the freshly-pushed main, with the build agent's
 * (uncommitted) edits in the tree.
 */
async function claimAndBranch(
	slug: string,
	opts: {promptBody?: string; extraSlugs?: string[]} = {},
): Promise<{repo: string; seeded: ReturnType<typeof seedRepoWithArbiter>}> {
	const seeded = seedRepoWithArbiter(
		scratch.root,
		[slug, ...(opts.extraSlugs ?? [])],
		opts,
	);
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
	return {repo, seeded};
}

/** Simulate the build agent: leave UNCOMMITTED work in the tree (no git). */
function agentEdits(repo: string, file = 'feature.txt', body = 'the work\n') {
	writeFileSync(join(repo, file), body);
}

describe('routeToNeedsAttention — saves wip + pushes the branch (no folder move)', () => {
	it('commits the agent wip to the work branch tip; the body STAYS in backlog/', async () => {
		const {repo} = await claimAndBranch('alpha');
		agentEdits(repo);

		const result = await routeToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			reason: 'acceptance gate failed (exit 1)',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		// NO folder move: the body still rests in backlog/ (claim never moved it),
		// and NO needs-attention/ folder file exists.
		expect(existsSync(join(repo, 'work', 'tasks', 'todo', 'alpha.md'))).toBe(
			true,
		);
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			false,
		);
		// The agent's wip is committed to the work branch tip (the recoverable half).
		const tip = gitIn(['show', '--name-status', '--format=', 'HEAD'], repo);
		expect(tip).toMatch(/feature\.txt/);
		expect(result.moveCommit).toBe(gitIn(['rev-parse', 'HEAD'], repo).trim());
		// Working tree is clean afterwards (the wip was committed).
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
		// The branch was pushed to the arbiter (cross-machine recoverable).
		expect(result.branchPush).toBe('pushed');
	});

	it('skips the wip commit when the tree is clean (the couldn’t-even-start bounce)', async () => {
		const {repo} = await claimAndBranch('beta');
		// No agent edits: nothing to save.
		const result = await routeToNeedsAttention({
			cwd: repo,
			slug: 'beta',
			reason: 'agent did nothing',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// No wip commit was made (the tree was clean), so the branch is at main and
		// the push is skipped (nothing beyond main to recover).
		expect(result.moveCommit).toBeUndefined();
		expect(result.branchPush).toBe('skipped-empty');
	});
});

describe('the seam bounce marks the lock stuck (the SOLE stuck record)', () => {
	it('marks the held lock stuck + reason + questions; NO main write', async () => {
		const {repo} = await claimAndBranch('beta');
		agentEdits(repo);

		const r = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'beta',
			reason: 'agent reported the slice too ambiguous to build',
			questions: [
				'Which schema version is the source of truth?',
				'Should retries be idempotent?',
			],
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(r.moved).toBe(true);

		const lock = await readItemLock({
			item: 'task:beta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.state).toBe('stuck');
		expect(lock?.reason).toMatch(/too ambiguous to build/);
		expect(lock?.questions).toContain(
			'Which schema version is the source of truth?',
		);
		expect(lock?.questions).toContain('Should retries be idempotent?');
		// NO main write: the body stays in backlog/, no needs-attention/ folder.
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
	});

	it('reports moved:false when there is no held lock to mark', async () => {
		const {repo} = await claimAndBranch('gamma');
		// Release the lock so there is nothing to mark stuck.
		const result = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'nonexistent',
			reason: 'whatever',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/no held lock/i);
		void repo;
	});
});

describe('needs-attention — not claimable, but surfaced via the lock', () => {
	it('scan/eligibility do NOT treat a lock-held item as claimable', async () => {
		// The held slug is subtracted from the eligible pool; the sibling stays.
		const {repo} = await claimAndBranch('delta', {extraSlugs: ['stays']});
		agentEdits(repo);
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'delta',
			reason: 'rebase conflict against main',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		const config: Config = {
			maxParallel: 1,
			perRepoMax: 1,
			defaultArbiter: ARBITER,
			autoBuild: true,
			integration: 'propose',
			agentCmd: 'true',
			workspacesDir: join(scratch.root, '.workspaces'),
		};
		// `scanRepoPaths` is an OFFLINE working-tree read; the in-place caller supplies
		// the held-slug set (the registry `scan` fetches it from the lock refs). The
		// held `delta` is subtracted; `stays` remains claimable.
		const report = scanRepoPaths([repo], config, new Set(['delta']));
		const all = report.repos.flatMap((r) => r.items);
		expect(all.find((i) => i.slug === 'delta')).toBeUndefined();
		expect(all.find((i) => i.slug === 'stays')).toBeDefined();
	});
});

describe('returnToBacklog (requeue) — releases the stuck lock (body stays in pool)', () => {
	it('releases the lock so the item is claimable again; NO needs-attention/ read', async () => {
		const {repo} = await claimAndBranch('eta');
		agentEdits(repo);
		// Bounce: save wip + push branch + mark the lock stuck.
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'eta',
			reason: 'env was misconfigured',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(stuckLockOnArbiter(repo, 'eta')).toBe(true);
		// Move back to a clean main so the requeue reads the arbiter, not the cwd.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'eta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// The lock is released; the body already rests in backlog/ (claimable again).
		expect(stuckLockOnArbiter(repo, 'eta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'eta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'eta')).toBe(false);
	});

	it('a returned item is once again claimable by scan/eligibility', async () => {
		const {repo} = await claimAndBranch('theta');
		agentEdits(repo);
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'theta',
			reason: 'transient failure',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		await returnToBacklog({
			cwd: repo,
			slug: 'theta',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		const config: Config = {
			maxParallel: 1,
			perRepoMax: 1,
			defaultArbiter: ARBITER,
			autoBuild: true,
			integration: 'propose',
			agentCmd: 'true',
			workspacesDir: join(scratch.root, '.workspaces'),
		};
		// The lock was released by requeue, so an empty held-set leaves theta visible.
		const report = scanRepoPaths([repo], config, new Set());
		const all = report.repos.flatMap((r) => r.items);
		expect(all.find((i) => i.slug === 'theta')).toBeDefined();
	});

	it('refuses (does not throw) with a CLEAR message when the slug has no held lock', async () => {
		// `iota` is seeded only in backlog/ (never claimed): no held lock to requeue.
		const seeded = seedRepoWithArbiter(scratch.root, ['iota']);
		const result = await returnToBacklog({
			cwd: seeded.repo,
			slug: 'iota',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/no held per-item lock/i);
	});
});
