import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {ledgerWrite} from '../src/ledger-write.js';
import {runOnce, type Dorfl} from '../src/run.js';
import {performStart} from '../src/start.js';
import {performClaim} from '../src/claim-cas.js';
import {performComplete} from '../src/complete.js';
import {scanRepoPaths} from '../src/scan.js';
import {readItemLock} from '../src/item-lock.js';
import {mergeConfig} from '../src/config.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
} from './helpers/gitRepo.js';

/**
 * The stuck-state surface is the per-item lock `state: stuck`, NOT a
 * `needs-attention/` folder file on `main` (task
 * `cutover-needs-attention-becomes-lock-stuck-recovery-surface`, decision i+: the
 * on-`main` surfacing mechanism is RETIRED). These pin the cut-over: the bounce
 * does NO `main` write, the stuck reason rides on the lock, and `start` resolves
 * via the lock (`stuck → active`). They drive REAL git against a local `--bare`
 * arbiter, so they live in the NON-PARALLEL vitest project (RACE_SENSITIVE).
 */

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('dorfl-na-surface-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** Current branch (short name) of a checkout. */
function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/**
 * Stand a repo up exactly as the runner leaves it just before a stuck outcome: a
 * task claimed (the per-item lock is held active; the body RESTS in backlog/) and
 * onboarded onto `work/<slug>` off the freshly-pushed main, with the build agent's
 * UNCOMMITTED edits in the tree.
 */
async function claimAndBranch(
	slug: string,
	opts: {extraSlugs?: string[]} = {},
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
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	return {repo, seeded};
}

/** Simulate the build agent: leave UNCOMMITTED work in the tree (no git). */
function agentEdits(repo: string, file = 'feature.txt', body = 'the work\n') {
	writeFileSync(join(repo, file), body);
}

describe('the bounce marks the lock stuck and writes NO main', () => {
	it('saves the wip on the branch + marks the lock stuck; the body stays in backlog/', async () => {
		const {repo} = await claimAndBranch('alpha');
		agentEdits(repo);

		const result = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'alpha',
			reason: 'acceptance gate failed (exit 1)',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The agent's wip is committed on the work branch tip (recoverable), NOT a
		// folder move.
		const tip = gitIn(['show', '--name-status', '--format=', 'HEAD'], repo);
		expect(tip).toMatch(/feature\.txt/);
		expect(tip).not.toMatch(/work\/needs-attention\/alpha\.md/);

		// NO main write: the body rests in backlog/ and the wip never reaches main.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		const mainTree = gitIn(
			['ls-tree', '-r', '--name-only', `${ARBITER}/main`],
			repo,
		);
		expect(mainTree).not.toMatch(/feature\.txt/);

		// PR-2b: the reason lives on the surfaced sidecar (`<arbiter>/main`), not the
		// released lock.
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
		const sidecar = gitIn(
			['show', `${ARBITER}/main:work/questions/task-alpha.md`],
			repo,
		);
		expect(sidecar).toMatch(/acceptance gate failed \(exit 1\)/);
	});

	it('the rebase-conflict path (item done-moved on the branch) is the same pure lock amend', async () => {
		const {repo} = await claimAndBranch('beta');
		// Emulate the post-done-move state on the work branch.
		mkdirSync(join(repo, 'work', 'tasks', 'done'), {recursive: true});
		gitIn(['mv', 'work/tasks/ready/beta.md', 'work/tasks/done/beta.md'], repo);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'done-move'], repo);

		const result = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'beta',
			reason: 'rebase onto arbiter/main conflicted (aborted)',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'beta')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'beta')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'beta')).toBe(true);
		// The body still rests in backlog/ on main (the done-move was branch-only).
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
	});

	it('local-only routing (no arbiter) marks no lock and does NOT touch main', async () => {
		const {repo} = await claimAndBranch('gamma');
		agentEdits(repo);
		const result = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason: 'just locally',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// No arbiter ⇒ no lock to amend, main untouched (the body rests in backlog/).
		expect(existsOnArbiterMain(repo, 'backlog', 'gamma')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'gamma')).toBe(false);
		expect(stuckLockOnArbiter(repo, 'gamma')).toBe(false);
	});
});

const editingAgent: Dorfl = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};
const FAIL = 'exit 1';

function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
	return scanRepoPaths([join(scratch.root, 'project')], config);
}

function configFor(root: string, overrides = {}) {
	void root;
	return mergeConfig({
		defaultArbiter: 'arbiter',
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'merge',
		agentCmd: 'true',
		autoBuild: true,
		...overrides,
	});
}

describe('the stuck lock is marked in BOTH merge and propose', () => {
	for (const integration of ['merge', 'propose'] as const) {
		it(`runOnce (${integration}) marks a red item's lock stuck (no main write)`, async () => {
			const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
			const workspacesDir = join(scratch.root, 'ws');
			const config = configFor(scratch.root, {integration, verify: FAIL});
			const result = await runOnce({
				config,
				report: scanProject(config),
				workspace: workspacesDir,
				dorfl: editingAgent,
				env: gitEnv(),
			});
			expect(result.items[0].status).toBe('tests-failed');
			expect(result.claimedAndDone).toBe(0);
			// The stuck state is the per-item lock — independent of the code
			// integration axis (merge or propose). The body stays in backlog/.
			// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
			// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
			// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
			// then RELEASES the lock. Assert the A1 triple.
			expect(stuckLockOnArbiter(repo, 'feat')).toBe(false);
			expect(sidecarSurfacedOnArbiterMain(repo, 'feat')).toBe(true);
			expect(needsAnswersOnArbiterMain(repo, 'feat')).toBe(true);
			expect(existsOnArbiterMain(repo, 'backlog', 'feat')).toBe(true);
			expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		});
	}
});

describe('scan/status read the lock; selection stays offline', () => {
	it('scan does not treat a lock-held item as claimable (held-slug subtraction)', async () => {
		const {repo} = await claimAndBranch('delta', {extraSlugs: ['stays']});
		agentEdits(repo);
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'delta',
			reason: 'timeout after 30m',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'delta')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'delta')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'delta')).toBe(true);

		// The offline working-tree scan subtracts the held slug (supplied by the
		// in-place caller); `stays` remains claimable.
		const config = configFor(scratch.root);
		const report = scanRepoPaths([repo], config, new Set(['delta']));
		const all = report.repos.flatMap((r) => r.items);
		expect(all.find((i) => i.slug === 'delta')).toBeUndefined();
		expect(all.find((i) => i.slug === 'stays')).toBeDefined();
	});
});

describe('resolve via start (no manual moves) — through the lock', () => {
	it('start on a stuck item prints the reason, resumes the lock, lands on the branch', async () => {
		const {repo, seeded} = await claimAndBranch('epsilon');
		agentEdits(repo);
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'epsilon',
			reason: 'the agent got stuck on a flaky test',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(repo, 'epsilon')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'epsilon')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'epsilon')).toBe(true);

		// A human on a SEPARATE clone resolves it via `start` — no --resume, no
		// manual file move.
		const human = seeded.clone('human');
		const notes: string[] = [];
		const result = await performStart({
			slug: 'epsilon',
			cwd: human,
			arbiter: ARBITER,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBeDefined();
		expect(result.branch).toBe('work/task-epsilon');
		// PR-2b: the bounce already released the lock; `start` re-acquires it fresh
		// (`active`) and lands on the work branch. The reason lives on the surfaced
		// sidecar (`<arbiter>/main`) rather than the (previously) released lock.
		expect(currentBranch(human)).toBe('work/task-epsilon');
		expect(stuckLockOnArbiter(human, 'epsilon')).toBe(false);
		const lock = await readItemLock({
			item: 'task:epsilon',
			cwd: human,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock?.state).toBe('active');
		void notes;
	});

	it('resolve leaves no half-surfaced state and no scratch branch behind', async () => {
		const {repo, seeded} = await claimAndBranch('zeta');
		agentEdits(repo);
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'zeta',
			reason: 'stuck',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		const human = seeded.clone('human2');
		const result = await performStart({
			slug: 'zeta',
			cwd: human,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		// Clean tree, no leftover resolve scratch branch.
		expect(gitIn(['status', '--porcelain'], human).trim()).toBe('');
		const branches = gitIn(['branch', '--list', 'dorfl/*'], human).trim();
		expect(branches).toBe('');
	});
});

describe('claim/complete success paths unchanged', () => {
	it('a happy claim leaves the body in backlog on main (no needs-attention surface)', async () => {
		const {repo} = await claimAndBranch('eta');
		expect(existsOnArbiterMain(repo, 'backlog', 'eta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'eta')).toBe(false);
	});

	it('a successful complete (merge) lands done on main, no stuck lock', async () => {
		const {repo} = await claimAndBranch('theta');
		agentEdits(repo);
		const result = await performComplete({
			slug: 'theta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			skipVerify: true,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'theta')).toBe(true);
		expect(stuckLockOnArbiter(repo, 'theta')).toBe(false);
	});
});
