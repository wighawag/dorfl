import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {ledgerWrite} from '../src/ledger-write.js';
import {runOnce, type AgentRunner} from '../src/run.js';
import {performStart} from '../src/start.js';
import {performClaim} from '../src/claim-cas.js';
import {performComplete} from '../src/complete.js';
import {scanRepoPaths} from '../src/scan.js';
import {status} from '../src/status.js';
import {readNeedsAttentionItems} from '../src/needs-attention.js';
import {mergeConfig} from '../src/config.js';
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
 * needs-attention surfacing on `main` (mode M) + the no-manual-moves resolve via
 * `start` (slice `needs-attention-surface-on-main`). These drive REAL git against
 * a local `--bare` arbiter and write `main`, so they live in the NON-PARALLEL
 * vitest project (see vitest.config.ts RACE_SENSITIVE) to stay deterministic.
 */

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-na-surface-');
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
 * slice claimed (in-progress on the arbiter) and onboarded onto `work/<slug>` off
 * the freshly-pushed main, with the build agent's UNCOMMITTED edits in the tree.
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
	gitIn(['switch', '-q', '-c', `work/${slug}`, `${ARBITER}/main`], repo);
	return {repo, seeded};
}

/** Simulate the build agent: leave UNCOMMITTED work in the tree (no git). */
function agentEdits(repo: string, file = 'feature.txt', body = 'the work\n') {
	writeFileSync(join(repo, file), body);
}

describe('needs-attention surface-on-main — routing through the seam', () => {
	it('produces a wip + move-only commit, surfaces the move-only on main, wip NOT on main', async () => {
		const {repo} = await claimAndBranch('alpha');
		agentEdits(repo);

		const result = ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'alpha',
			reason: 'acceptance gate failed (exit 1)',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// TWO commits on work/alpha: the MOVE-ONLY tip is purely the git mv (no
		// agent file); the wip below it holds the aborted work.
		const tip = gitIn(['show', '--name-status', '--format=', 'HEAD'], repo);
		expect(tip).toMatch(/work\/needs-attention\/alpha\.md/);
		expect(tip).not.toMatch(/feature\.txt/);
		const wip = gitIn(['show', '--name-status', '--format=', 'HEAD~1'], repo);
		expect(wip).toMatch(/feature\.txt/);

		// main now shows the stuck item as needs-attention (not in-progress)…
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		// …with its reason in the body, and the wip is NOT on main.
		const onMain = gitIn(
			['show', `${ARBITER}/main:work/needs-attention/alpha.md`],
			repo,
		);
		expect(onMain).toMatch(/acceptance gate failed \(exit 1\)/);
		const mainTree = gitIn(
			['ls-tree', '-r', '--name-only', `${ARBITER}/main`],
			repo,
		);
		expect(mainTree).not.toMatch(/feature\.txt/);
	});

	it('surfaces the rebase-conflict path (item in done/ on the branch, in-progress on main)', async () => {
		// The runner's rebase-conflict abort routes from done/ (the item was
		// done-moved before the failed rebase). On main it is still in in-progress/;
		// surfacing must relocate from there to needs-attention/ regardless.
		const {repo} = await claimAndBranch('beta');
		// Emulate the post-done-move state on the work branch (git mv needs the dest
		// dir to exist — git tracks no empty dirs).
		mkdirSync(join(repo, 'work', 'done'), {recursive: true});
		gitIn(['mv', 'work/in-progress/beta.md', 'work/done/beta.md'], repo);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'done-move'], repo);

		const result = ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'beta',
			reason: 'rebase onto arbiter/main conflicted (aborted)',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'beta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(false);
		const onMain = gitIn(
			['show', `${ARBITER}/main:work/needs-attention/beta.md`],
			repo,
		);
		expect(onMain).toMatch(/conflict/i);
	});

	it('local-only routing (no arbiter) does NOT touch main', async () => {
		const {repo} = await claimAndBranch('gamma');
		agentEdits(repo);
		const result = ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason: 'just locally',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// The surface was NOT published (no arbiter given): main is untouched.
		expect(existsOnArbiterMain(repo, 'in-progress', 'gamma')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'gamma')).toBe(false);
	});
});

const editingAgent: AgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};
// The gate is now the per-repo `verify` command (the converged core); `exit 1`
// stands in for a red gate (the deleted `defaultTestGate`/`TestGate` are gone).
const FAIL = 'exit 1';

/** The injected working-tree scan report for `run` over the seeded `project`. */
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
		allowAgents: true,
		...overrides,
	});
}

describe('needs-attention surface-on-main — surfaces in BOTH merge and propose', () => {
	for (const integration of ['merge', 'propose'] as const) {
		it(`runOnce (${integration}) surfaces a red item on main (ledger write, not code integration)`, async () => {
			const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
			const workspacesDir = join(scratch.root, 'ws');
			const config = configFor(scratch.root, {integration, verify: FAIL});
			const result = await runOnce({
				config,
				report: scanProject(config),
				workspace: workspacesDir,
				agentRunner: editingAgent,
				env: gitEnv(),
			});
			expect(result.items[0].status).toBe('tests-failed');
			expect(result.claimedAndDone).toBe(0);
			// Surfacing is a LEDGER write — it happens whether the code integration
			// axis is merge or propose. main shows the stuck item as needs-attention.
			expect(existsOnArbiterMain(repo, 'needs-attention', 'feat')).toBe(true);
			expect(existsOnArbiterMain(repo, 'in-progress', 'feat')).toBe(false);
			expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		});
	}
});

describe('needs-attention surface-on-main — scan/status read main', () => {
	it('scan does not treat a surfaced item as claimable; status reports the reason', async () => {
		// Surface a stuck item on main, then read the *arbiter main* tree from a
		// fresh checkout (offline) to prove the stuck state travels.
		const {repo, seeded} = await claimAndBranch('delta', {
			extraSlugs: ['stays'],
		});
		agentEdits(repo);
		ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'delta',
			reason: 'timeout after 30m',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		// A fresh checkout off the arbiter sees the surfaced state in its work tree.
		const fresh = seeded.clone('fresh');
		gitIn(['fetch', '-q', ARBITER], fresh);
		gitIn(['reset', '-q', '--hard', `${ARBITER}/main`], fresh);

		// scan reads work/backlog/ only — `delta` is in needs-attention/, not seen;
		// the sibling `stays` remains claimable.
		const config = configFor(scratch.root);
		void config;
		expect(existsSync(join(fresh, 'work', 'needs-attention', 'delta.md'))).toBe(
			true,
		);
		expect(existsSync(join(fresh, 'work', 'in-progress', 'delta.md'))).toBe(
			false,
		);
		const items = readNeedsAttentionItems(fresh);
		expect(items.find((i) => i.slug === 'delta')?.reason).toMatch(/timeout/i);

		// status, given the fresh checkout's `main` ref as a mirror path, surfaces the
		// reason (the read seam's ref read works against a non-bare clone too).
		const report = await status({
			workspacesDir: join(scratch.root, 'no-jobs'),
			mirrorPaths: [fresh],
			env: gitEnv(),
		});
		const surfaced = (report.needsAttention ?? []).flatMap((r) => r.items);
		expect(surfaced.find((i) => i.slug === 'delta')?.reason).toMatch(
			/timeout/i,
		);
	});
});

describe('needs-attention surface-on-main — resolve via start (no manual moves)', () => {
	it('start on a surfaced item prints the reason, clears the surface, lands on the branch', async () => {
		// Surface a stuck item on main.
		const {repo, seeded} = await claimAndBranch('epsilon');
		agentEdits(repo);
		ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'epsilon',
			reason: 'the agent got stuck on a flaky test',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(existsOnArbiterMain(repo, 'needs-attention', 'epsilon')).toBe(true);

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
		expect(result.outcome).toBe('resolved');
		expect(result.branch).toBe('work/epsilon');
		// The recorded reason was printed for the human.
		expect(notes.join('\n')).toMatch(/flaky test/i);
		// The human landed ON the work branch.
		expect(currentBranch(human)).toBe('work/epsilon');
		// The main surface is CLEARED: the item is back in in-progress, no longer
		// in needs-attention (truthful surface).
		expect(existsOnArbiterMain(human, 'needs-attention', 'epsilon')).toBe(
			false,
		);
		expect(existsOnArbiterMain(human, 'in-progress', 'epsilon')).toBe(true);
	});

	it('resolve leaves no half-surfaced state and no scratch branch behind', async () => {
		const {repo, seeded} = await claimAndBranch('zeta');
		agentEdits(repo);
		ledgerWrite.applyNeedsAttentionTransition({
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
		expect(result.outcome).toBe('resolved');
		// Clean tree, no leftover resolve scratch branch.
		expect(gitIn(['status', '--porcelain'], human).trim()).toBe('');
		const branches = gitIn(
			['branch', '--list', 'agent-runner/*'],
			human,
		).trim();
		expect(branches).toBe('');
	});
});

describe('needs-attention surface-on-main — claim/complete success paths unchanged', () => {
	it('a happy claim still lands in-progress on main (no needs-attention surface)', async () => {
		const {repo} = await claimAndBranch('eta');
		expect(existsOnArbiterMain(repo, 'in-progress', 'eta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'eta')).toBe(false);
	});

	it('a successful complete (merge) lands done on main, no needs-attention surface', async () => {
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
		expect(existsOnArbiterMain(repo, 'needs-attention', 'theta')).toBe(false);
	});
});
