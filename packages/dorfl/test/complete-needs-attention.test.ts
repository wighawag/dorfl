import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {readItemLock} from '../src/item-lock.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
} from './helpers/gitRepo.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('dorfl-complete-na-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/**
 * Stand a repo up exactly as the human loop leaves it just before `complete`:
 * a task claimed (in-progress on the arbiter) and the human onboarded onto
 * `work/<slug>` off the freshly-pushed main.
 */
async function claimAndBranch(
	slug: string,
	opts: {extraSlugs?: string[]} = {},
): Promise<{repo: string; seeded: ReturnType<typeof seedRepoWithArbiter>}> {
	const seeded = seedRepoWithArbiter(scratch.root, [
		slug,
		...(opts.extraSlugs ?? []),
	]);
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

const PASS = 'exit 0';
const FAIL = 'exit 1';

describe('complete — failed gate routes to needs-attention', () => {
	it('moves the item backlog → needs-attention with the reason recorded', async () => {
		const {repo} = await claimAndBranch('alpha');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: FAIL,
			// Autonomous-equivalent: the bounce needs an arbiter handle to mark the lock.
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		// PR-2b D3: a clean-surface `gate-failed` bounce is GREEN (exitCode 0).
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('gate-failed');
		expect(result.routedToNeedsAttention).toBe(true);

		// The body STAYS in backlog/ (no folder move); never reaches done/.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsSync(join(repo, 'work', 'tasks', 'done', 'alpha.md'))).toBe(
			false,
		);
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);

		// PR-2b: post-bounce the reason lives on the surfaced sidecar's envelope
		// context (not the released lock). Read it off `<arbiter>/main`.
		const sidecar = gitIn(
			['show', `${ARBITER}/main:work/questions/task-alpha.md`],
			repo,
		);
		expect(sidecar).toMatch(/gate failed/i);
	});

	it('no partial state: aborted work saved (wip) + move-only tip, clean tree', async () => {
		const {repo} = await claimAndBranch('beta');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			verify: FAIL,
			env: gitEnv(),
		});
		expect(result.routedToNeedsAttention).toBe(true);

		// Working tree is clean (the wip was staged + committed). No partial state.
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
		// The bounce is a pure lock amend now: the aborted work is saved as the WIP
		// commit on the branch tip (no folder move, no separate move-only commit).
		const tip = gitIn(['show', '--name-status', '--format=', 'HEAD'], repo);
		expect(tip).toMatch(/feature\.txt/);
		expect(tip).not.toMatch(/work\/needs-attention\/beta\.md/);
		// Not mid-rebase, not detached.
		expect(currentBranch(repo)).toBe('work/task-beta');
	});

	it('--skip-verify is unchanged: completes, no needs-attention move', async () => {
		const {repo} = await claimAndBranch('gamma');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			skipVerify: true,
			verify: FAIL, // would fail if run — proving it is skipped
			noSwitch: true,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.routedToNeedsAttention).toBeFalsy();
		expect(existsSync(join(repo, 'work', 'tasks', 'done', 'gamma.md'))).toBe(
			true,
		);
		expect(stuckLockOnArbiter(repo, 'gamma')).toBe(false);
	});
});

describe('complete — rebase conflict routes to needs-attention', () => {
	it('aborts the rebase, then moves the item to needs-attention with the conflict reason', async () => {
		const {seeded, repo} = await claimAndBranch('theta');
		// Our work edits README.md.
		writeFileSync(join(repo, 'README.md'), '# project\nour change\n');

		// Concurrently, another clone advances arbiter/main with a CONFLICTING edit.
		const other = seeded.clone('conflict');
		writeFileSync(join(other, 'README.md'), '# project\ntheir change\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'conflicting advance'], other);
		gitIn(['push', '-q', ARBITER, 'main:main'], other);

		const result = await performComplete({
			slug: 'theta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		// PR-2b D3: a clean-surface `rebase-conflict` bounce is GREEN (exitCode 0).
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('rebase-conflict');
		expect(result.routedToNeedsAttention).toBe(true);

		// The rebase was aborted (not mid-rebase).
		expect(existsSync(join(repo, '.git', 'rebase-merge'))).toBe(false);
		expect(existsSync(join(repo, '.git', 'rebase-apply'))).toBe(false);

		// The stuck state is the lock; nothing landed on the arbiter's done/ (the
		// done-move happened on the BRANCH tree but never reached main).
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'theta')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'theta')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'theta')).toBe(true);

		// Nothing landed on arbiter main.
		expect(existsOnArbiterMain(repo, 'done', 'theta')).toBe(false);

		// PR-2b: reason on the surfaced sidecar (not the released lock).
		const sidecar = gitIn(
			['show', `${ARBITER}/main:work/questions/task-theta.md`],
			repo,
		);
		expect(sidecar).toMatch(/conflict/i);
	});

	it('no partial state on conflict: clean tree, still on the work branch', async () => {
		const {seeded, repo} = await claimAndBranch('kappa');
		writeFileSync(join(repo, 'README.md'), '# project\nour change\n');
		const other = seeded.clone('conflict2');
		writeFileSync(join(other, 'README.md'), '# project\ntheir change\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'conflicting advance'], other);
		gitIn(['push', '-q', ARBITER, 'main:main'], other);

		const result = await performComplete({
			slug: 'kappa',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.routedToNeedsAttention).toBe(true);
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
		expect(currentBranch(repo)).toBe('work/task-kappa');
	});
});
