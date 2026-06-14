import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {
	performRecoverIsolated,
	locateIsolatedRecovery,
} from '../src/recover-isolated.js';
import {createJob, jobWorktreePath} from '../src/workspace.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * `complete --isolated <slug>` tests (the `finish-already-committed-branch` slice,
 * items 2\u20134): the LOCATE-EXISTING resolver + the recover-already-committed run
 * from a RETAINED job worktree, plus the idempotent / nothing-to-recover no-ops.
 *
 * House style (mirrors do-isolated.test.ts): a throwaway project + a local
 * `--bare` arbiter, a TEMP `workspacesDir` (the agents' area), real shared dirs
 * untouched. We materialise a REAL job worktree via `createJob` (the same machinery
 * `do --isolated` uses), then STRAND it (agent work + done-move committed, NOT
 * pushed) and drive the recovery from the operator's checkout.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-recover-isolated-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** The temp agents' execution area (worktrees + mirrors live here). */
function workspacesDir(): string {
	return join(scratch.root, 'agents-area');
}

/**
 * Materialise a REAL retained job worktree for `slug` off the seeded repo's
 * arbiter, then STRAND it exactly as a terminal push failure AFTER the done-move +
 * commit leaves it: the agent's work committed, the slice `git mv`'d
 * `in-progress/ → done/` and committed (`…; done`), but the tip NOT pushed.
 */
async function seedStrandedWorktree(
	seeded: SeededRepo,
	slug: string,
): Promise<{worktreeDir: string; tip: string; arbiterUrl: string}> {
	const ws = workspacesDir();
	const arbiterUrl = `file://${seeded.arbiter}`;
	// Claim FIRST so the arbiter (and the fresh worktree createJob cuts off main)
	// holds the slug in in-progress/ \u2014 the folder the strand's done-move moves FROM.
	const claim = await performClaim({
		slug,
		cwd: seeded.repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	const job = createJob({
		url: arbiterUrl,
		slug,
		workspacesDir: ws,
		env: gitEnv(),
	});
	const dir = job.dir;
	// The agent produced work (uncommitted, as the agent leaves it).
	writeFileSync(join(dir, 'feature.txt'), 'the work\n');
	// The done-move + commit already happened (steps 2\u20133 of performIntegration),
	// just before the push that then failed terminally. The worktree's arbiter
	// remote is `origin` (the mirror's clone); the slice is in in-progress/ there.
	mkdirSync(join(dir, 'work', 'done'), {recursive: true});
	gitIn(['mv', `work/in-progress/${slug}.md`, `work/done/${slug}.md`], dir);
	gitIn(['add', '-A'], dir);
	gitIn(['commit', '-q', '-m', `feat(${slug}): build the thing; done`], dir);

	// Pre-conditions: the worktree is at the deterministic path; done/ present, the
	// tip not pushed (origin/main still has in-progress/).
	expect(dir).toBe(jobWorktreePath(ws, arbiterUrl, slug));
	expect(existsSync(join(dir, 'work', 'done', `${slug}.md`))).toBe(true);
	const tip = gitIn(['rev-parse', 'HEAD'], dir).trim();
	return {worktreeDir: dir, tip, arbiterUrl};
}

describe('locateIsolatedRecovery — the locate-EXISTING resolver', () => {
	it('resolves a PRESENT retained worktree via the arbiter-URL-keyed naming (not a slug glob)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const {worktreeDir} = await seedStrandedWorktree(seeded, 'alpha');

		const located = locateIsolatedRecovery({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: ARBITER,
			workspacesDir: workspacesDir(),
			env: gitEnv(),
		});
		expect('present' in located && located.present).toBe(true);
		if ('dir' in located) {
			expect(located.dir).toBe(worktreeDir);
		}
	});

	it('reports nothing-to-recover (present:false) when no worktree is retained', () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const located = locateIsolatedRecovery({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: ARBITER,
			workspacesDir: workspacesDir(),
			env: gitEnv(),
		});
		expect('present' in located && located.present === false).toBe(true);
	});

	it('errors (usage) when the cwd arbiter remote does not resolve', () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		// `origin` is not wired in the seeded repo (only `arbiter` is).
		const located = locateIsolatedRecovery({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: 'origin',
			workspacesDir: workspacesDir(),
			env: gitEnv(),
		});
		expect('error' in located).toBe(true);
	});
});

describe('complete --isolated — recover a stranded retained worktree', () => {
	it('integrates the kept commit (merge): work lands on the arbiter, no rebuild, no orphan branch, no --force', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['alpha']);
		const {tip} = await seedStrandedWorktree(seeded, 'alpha');

		const result = await performRecoverIsolated({
			slug: 'alpha',
			cwd: seeded.repo,
			arbiter: ARBITER,
			workspacesDir: workspacesDir(),
			integration: 'merge',
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// The work landed on the arbiter's main, in done/ ONLY (the move is a move).
		expect(existsOnArbiterMain(seeded.repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(seeded.repo, 'in-progress', 'alpha')).toBe(
			false,
		);
		// It integrated from the EXACT kept commit (no rebuild): the arbiter main is
		// the kept tip (a clean ff of an already-rebased branch off the latest main).
		expect(gitIn(['rev-parse', `${ARBITER}/main`], seeded.repo).trim()).toBe(
			tip,
		);
		// The agent's work landed (carried by the kept commit).
		expect(
			gitIn(['show', `${ARBITER}/main:feature.txt`], seeded.repo).trim(),
		).toBe('the work');
	});

	it('reaps the now-redundant worktree after a successful recovery', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const {worktreeDir} = await seedStrandedWorktree(seeded, 'beta');

		const result = await performRecoverIsolated({
			slug: 'beta',
			cwd: seeded.repo,
			arbiter: ARBITER,
			workspacesDir: workspacesDir(),
			integration: 'merge',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		// The worktree is provably on the arbiter now → reaped.
		expect(existsSync(worktreeDir)).toBe(false);
	});
});

describe('complete --isolated — idempotent / honest no-ops', () => {
	it('a re-run after a successful recovery is a clean nothing-to-recover (no crash, no fresh worktree)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['gamma']);
		await seedStrandedWorktree(seeded, 'gamma');

		const first = await performRecoverIsolated({
			slug: 'gamma',
			cwd: seeded.repo,
			arbiter: ARBITER,
			workspacesDir: workspacesDir(),
			integration: 'merge',
			env: gitEnv(),
		});
		expect(first.outcome).toBe('completed');

		// The worktree was reaped; a re-run finds nothing to recover.
		const second = await performRecoverIsolated({
			slug: 'gamma',
			cwd: seeded.repo,
			arbiter: ARBITER,
			workspacesDir: workspacesDir(),
			integration: 'merge',
			env: gitEnv(),
		});
		expect(second.exitCode).toBe(0);
		expect(second.outcome).toBe('nothing-to-recover');
		// No fresh worktree was created.
		expect(
			existsSync(
				jobWorktreePath(workspacesDir(), `file://${seeded.arbiter}`, 'gamma'),
			),
		).toBe(false);
	});

	it('nothing retained at all → a clear nothing-to-recover no-op (no crash, no fresh worktree)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['delta']);
		const result = await performRecoverIsolated({
			slug: 'delta',
			cwd: seeded.repo,
			arbiter: ARBITER,
			workspacesDir: workspacesDir(),
			integration: 'merge',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('nothing-to-recover');
		expect(result.message).toMatch(/nothing to recover/i);
		expect(
			existsSync(
				jobWorktreePath(workspacesDir(), `file://${seeded.arbiter}`, 'delta'),
			),
		).toBe(false);
	});

	it('an already-integrated worktree (tip already on the arbiter) is a no-op, never a double-integrate', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['epsilon']);
		const {worktreeDir, tip} = await seedStrandedWorktree(seeded, 'epsilon');
		// Push the kept tip to the arbiter's main OUT OF BAND (it is now integrated),
		// but DO NOT reap the worktree — so the recover path finds a present worktree
		// whose tip is already integrated.
		gitIn(['push', '-q', 'origin', 'HEAD:main'], worktreeDir);
		// Read the arbiter's main from the operator's checkout (its `arbiter` remote).
		gitIn(['fetch', '-q', ARBITER], seeded.repo);
		const arbiterMainBefore = gitIn(
			['rev-parse', `${ARBITER}/main`],
			seeded.repo,
		).trim();
		expect(arbiterMainBefore).toBe(tip);

		const result = await performRecoverIsolated({
			slug: 'epsilon',
			cwd: seeded.repo,
			arbiter: ARBITER,
			workspacesDir: workspacesDir(),
			integration: 'merge',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('already-integrated');
		// The arbiter main did NOT move (no re-push / double-integrate).
		expect(gitIn(['rev-parse', `${ARBITER}/main`], seeded.repo).trim()).toBe(
			tip,
		);
	});
});
