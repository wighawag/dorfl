import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {ledgerWrite} from '../src/ledger-write.js';
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
	type SeededRepo,
} from './helpers/gitRepo.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-complete-from-na-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';
const FAIL = 'exit 1';

function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/** Simulate the build agent: leave UNCOMMITTED work in the tree (no git). */
function agentEdits(repo: string, file = 'feature.txt', body = 'the work\n') {
	writeFileSync(join(repo, file), body);
}

/**
 * Stand a repo up EXACTLY as the autonomous `do` path leaves a SPURIOUSLY-failed
 * item: claimed, branched onto `work/<slug>`, the agent's work present, then the
 * gate routed it to needs-attention WITH the arbiter — so (a) the work branch
 * carries `wip + move-only(in-progress→needs-attention)` and is pushed, and (b)
 * `<arbiter>/main` was SURFACED (the item reproduced into `needs-attention/`).
 *
 * This is the precise state the recovery `complete` must accept + reconcile.
 */
async function seedSurfacedNeedsAttention(
	slug: string,
	opts: {extraSlugs?: string[]; agentFile?: string} = {},
): Promise<{repo: string; seeded: SeededRepo}> {
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
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);

	// The agent produced work, but the gate failed spuriously.
	agentEdits(repo, opts.agentFile);

	// The autonomous routing: save wip on the branch + mark the lock stuck (the SOLE
	// stuck record). NO folder move — the body stays in backlog/.
	const routed = await ledgerWrite.applyNeedsAttentionTransition({
		cwd: repo,
		slug,
		reason: 'acceptance gate failed (exit 1) [spurious: env-polluted]',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(routed.moved).toBe(true);

	// Pre-conditions: the lock is stuck; the body rests in backlog/ (no folder move).
	expect(stuckLockOnArbiter(repo, slug)).toBe(true);
	expect(existsOnArbiterMain(repo, 'backlog', slug)).toBe(true);
	expect(existsOnArbiterMain(repo, 'needs-attention', slug)).toBe(false);
	expect(currentBranch(repo)).toBe(`work/slice-${slug}`);
	return {repo, seeded};
}

describe('complete — recover a good needs-attention item (re-gate green → done)', () => {
	it('lands it in done/ via merge, no manual git, surfacing reconciled', async () => {
		const {repo} = await seedSurfacedNeedsAttention('alpha');

		// The cause was spurious; re-gate is now GREEN.
		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			// Autonomous-equivalent: surface failures on main if it RE-fails.
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.routedToNeedsAttention).toBeFalsy();

		// The item landed in done/ on the arbiter's main; the needs-attention
		// surface is gone (the done-move SUPERSEDES the surfaced state).
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);

		// The agent's work landed too (it was carried as the wip commit).
		const arbiterFeature = gitIn(
			['show', `${ARBITER}/main:feature.txt`],
			repo,
		).trim();
		expect(arbiterFeature).toBe('the work');
	});

	it('the human never hits a rebase conflict against the surfacing commit', async () => {
		// A fresh human clone that has ONLY ever seen the surfaced main (the item in
		// needs-attention/). After the runner-owned recovery completes, this clone
		// must fast-forward to a main where the item is in done/ — NO conflict.
		const {repo, seeded} = await seedSurfacedNeedsAttention('beta');
		const human = seeded.clone('human');
		// The human's main shows the body in backlog/ (no surfacing on main); the
		// stuck state is the lock.
		expect(existsOnArbiterMain(human, 'backlog', 'beta')).toBe(true);

		const result = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');

		// The human just fast-forwards — a clean ff to the done state, no conflict
		// (the bounce never wrote main, so there is nothing to conflict with).
		gitIn(['fetch', '-q', ARBITER], human);
		gitIn(['merge', '--ff-only', '-q', `${ARBITER}/main`], human);
		expect(existsSync(join(human, 'work', 'tasks', 'done', 'beta.md'))).toBe(
			true,
		);
		expect(existsSync(join(human, 'work', 'tasks', 'todo', 'beta.md'))).toBe(
			false,
		);
	});

	it('refuses a STILL-RED re-gate; the item stays in needs-attention/', async () => {
		const {repo} = await seedSurfacedNeedsAttention('gamma');

		const result = await performComplete({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: FAIL, // the cause was NOT actually fixed
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		// Not completed: the gate stays authoritative.
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('gate-failed');

		// The item stays STUCK (the lock); never reaches done/, body stays in backlog/.
		expect(stuckLockOnArbiter(repo, 'gamma')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'gamma')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'gamma')).toBe(true);

		// Still stuck with its reason on the lock entry.
		const lock = await readItemLock({
			item: 'slice:gamma',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.reason).toMatch(/gate/i);
	});

	it('--skip-verify remains the human-only override (completes without re-gating)', async () => {
		const {repo} = await seedSurfacedNeedsAttention('delta');

		const result = await performComplete({
			slug: 'delta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			skipVerify: true,
			verify: FAIL, // would refuse if run — proving it is skipped
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'delta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'delta')).toBe(false);
	});

	it('completing a recovered stuck item RELEASES the lock (the stuck reason was transient)', async () => {
		// The stuck reason lived on the (transient) lock entry, not the durable body
		// (the working-tree-visibility trade the ADR made). Completing the item
		// done-moves it and RELEASES the lock — the reason history is not carried into
		// the durable `done/` record.
		const {repo} = await seedSurfacedNeedsAttention('epsilon');
		expect(stuckLockOnArbiter(repo, 'epsilon')).toBe(true);

		await performComplete({
			slug: 'epsilon',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		expect(existsOnArbiterMain(repo, 'done', 'epsilon')).toBe(true);
		// The lock (the transient stuck record) is released on completion.
		const lock = await readItemLock({
			item: 'slice:epsilon',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock).toBeUndefined();
	});

	it('propose mode: recovers from needs-attention by pushing the branch', async () => {
		const {repo} = await seedSurfacedNeedsAttention('zeta');

		const result = await performComplete({
			slug: 'zeta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			noSwitch: true,
			surfaceArbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// propose does not land on main; the branch is pushed with the done-move (the
		// body's frontmatter, sans any stuck reason — that lived on the transient lock).
		const branchHead = gitIn(
			['show', `${ARBITER}/work/slice-zeta:work/tasks/done/zeta.md`],
			repo,
		);
		expect(branchHead).toMatch(/zeta/i);
	});
});

describe('complete — the in-progress → done path is unchanged', () => {
	it('still completes a normal in-progress item (no needs-attention fallback)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['omega']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'omega',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/slice-omega', `${ARBITER}/main`], repo);
		agentEdits(repo);

		const result = await performComplete({
			slug: 'omega',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'omega')).toBe(true);
		// It came from in-progress/, never touched needs-attention/.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'omega')).toBe(false);
	});

	it('still refuses when neither in-progress/ nor needs-attention/ has the slug', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['eta']);
		const repo = seeded.repo;
		// Never claim — just sit on a work branch with no ledger file present.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(
			['switch', '-q', '-c', 'work/slice-nonexistent', `${ARBITER}/main`],
			repo,
		);

		const result = await performComplete({
			slug: 'nonexistent',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/nothing to complete/i);
	});
});
