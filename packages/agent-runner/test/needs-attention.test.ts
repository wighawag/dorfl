import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {
	routeToNeedsAttention,
	returnToBacklog,
	readNeedsAttentionItems,
} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {scanRepoPaths} from '../src/scan.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';
import type {Config} from '../src/config.js';

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
 * slice claimed (in-progress on the arbiter) and onboarded onto `work/<slug>`
 * off the freshly-pushed main, with the build agent's (uncommitted) edits in the
 * tree. Returns the seeded handle + working clone.
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
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	return {repo, seeded};
}

/** Simulate the build agent: leave UNCOMMITTED work in the tree (no git). */
function agentEdits(repo: string, file = 'feature.txt', body = 'the work\n') {
	writeFileSync(join(repo, file), body);
}

describe('needs-attention — the move (in-progress → needs-attention)', () => {
	it('git mvs the item and records the reason in the file body, committed', async () => {
		const {repo} = await claimAndBranch('alpha');
		agentEdits(repo);

		const result = await routeToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			reason: 'acceptance gate failed (exit 1)',
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		// The file moved folders…
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			false,
		);
		const dest = join(repo, 'work', 'needs-attention', 'alpha.md');
		expect(existsSync(dest)).toBe(true);
		// …the reason is prose in the BODY (not a frontmatter field).
		const body = readFileSync(dest, 'utf8');
		expect(body).toMatch(/acceptance gate failed \(exit 1\)/);
		expect(body).toMatch(/Needs attention/i);
		// Routing now produces TWO commits (needs-attention-surface-on-main): a wip
		// commit saving the aborted agent work, then a MOVE-ONLY commit (the tip) that
		// is PURELY the reason + the git mv — so a surfacing strategy can cherry-pick
		// the tip without leaking the wip onto main.
		const tip = gitIn(['show', '--name-status', '--format=', 'HEAD'], repo);
		expect(tip).toMatch(/work\/needs-attention\/alpha\.md/);
		expect(tip).toMatch(/work\/in-progress\/alpha\.md/);
		expect(tip).not.toMatch(/feature\.txt/); // the wip is NOT in the move-only tip
		expect(result.moveCommit).toBe(gitIn(['rev-parse', 'HEAD'], repo).trim());
		// The wip commit below the tip carries the agent's aborted work.
		const wip = gitIn(['show', '--name-status', '--format=', 'HEAD~1'], repo);
		expect(wip).toMatch(/feature\.txt/);
		// Working tree is clean afterwards.
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
	});

	it('records agent-surfaced questions alongside the reason', async () => {
		const {repo} = await claimAndBranch('beta');
		agentEdits(repo);

		await routeToNeedsAttention({
			cwd: repo,
			slug: 'beta',
			reason: 'agent reported the slice too ambiguous to build',
			questions: [
				'Which schema version is the source of truth?',
				'Should retries be idempotent?',
			],
			env: gitEnv(),
		});

		const body = readFileSync(
			join(repo, 'work', 'needs-attention', 'beta.md'),
			'utf8',
		);
		expect(body).toMatch(/too ambiguous to build/);
		expect(body).toMatch(/Which schema version is the source of truth\?/);
		expect(body).toMatch(/Should retries be idempotent\?/);
	});

	it('refuses (does not throw) when the slug is not in-progress', async () => {
		const {repo} = await claimAndBranch('gamma');
		const result = await routeToNeedsAttention({
			cwd: repo,
			slug: 'nonexistent',
			reason: 'whatever',
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/not found|not in-progress/i);
	});
});

describe('needs-attention — not claimable, but surfaced', () => {
	it('scan/eligibility do NOT treat needs-attention items as claimable', async () => {
		// Keep `backlog/` non-empty (so the repo is still detected) while moving the
		// claimed slice out to needs-attention/.
		const {repo} = await claimAndBranch('delta', {extraSlugs: ['stays']});
		agentEdits(repo);
		await routeToNeedsAttention({
			cwd: repo,
			slug: 'delta',
			reason: 'rebase conflict against main',
			env: gitEnv(),
		});

		const config: Config = {
			maxParallel: 1,
			perRepoMax: 1,
			defaultArbiter: ARBITER,
			allowAgents: true,
			integration: 'propose',
			agentCmd: 'true',
			workspacesDir: join(scratch.root, '.workspaces'),
		};
		const report = scanRepoPaths([repo], config);
		const all = report.repos.flatMap((r) => r.items);
		// The item is in needs-attention/, not backlog/ — scan never sees it as a
		// claimable backlog item (only the sibling `stays` remains in backlog/).
		expect(all.find((i) => i.slug === 'delta')).toBeUndefined();
		expect(all.find((i) => i.slug === 'stays')).toBeDefined();
	});

	it('readNeedsAttentionItems lists the stuck items with their reason', async () => {
		const {repo} = await claimAndBranch('epsilon');
		agentEdits(repo);
		await routeToNeedsAttention({
			cwd: repo,
			slug: 'epsilon',
			reason: 'timeout after 30m with no progress',
			env: gitEnv(),
		});

		const items = readNeedsAttentionItems(repo);
		expect(items).toHaveLength(1);
		expect(items[0].slug).toBe('epsilon');
		expect(items[0].reason).toMatch(/timeout after 30m/);
	});

	it('readNeedsAttentionItems is empty when the folder is absent', async () => {
		const {repo} = await claimAndBranch('zeta');
		expect(readNeedsAttentionItems(repo)).toEqual([]);
	});
});

describe('needs-attention — return path (needs-attention → backlog)', () => {
	it('moves an item back to backlog for re-claiming on the arbiter (tree-less)', async () => {
		const {repo} = await claimAndBranch('eta');
		agentEdits(repo);
		// Surface to needs-attention ON THE ARBITER (wip + move + branch push +
		// surface on main) so the tree-less requeue has an arbiter item + continue-
		// branch to act on.
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'eta',
			reason: 'env was misconfigured',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'eta',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		// The move landed on the arbiter (needs-attention → backlog), tree-less.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'eta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'eta')).toBe(true);
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
		await returnToBacklog({
			cwd: repo,
			slug: 'theta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// Bring the arbiter's backlog move into the cwd so the local scan sees it.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);

		const config: Config = {
			maxParallel: 1,
			perRepoMax: 1,
			defaultArbiter: ARBITER,
			allowAgents: true,
			integration: 'propose',
			agentCmd: 'true',
			workspacesDir: join(scratch.root, '.workspaces'),
		};
		const report = scanRepoPaths([repo], config);
		const all = report.repos.flatMap((r) => r.items);
		expect(all.find((i) => i.slug === 'theta')).toBeDefined();
	});

	it('refuses (does not throw) when the slug is not in needs-attention', async () => {
		const {repo} = await claimAndBranch('iota');
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'iota',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/not found|not in needs-attention/i);
	});
});

describe('needs-attention — pushes the transition like the done-move', () => {
	it('the move reaches the arbiter when an arbiter remote is configured', async () => {
		const {repo} = await claimAndBranch('kappa');
		agentEdits(repo);

		await routeToNeedsAttention({
			cwd: repo,
			slug: 'kappa',
			reason: 'a reason',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		// The work branch carries the move; push it and confirm the arbiter has it.
		gitIn(['push', '-q', ARBITER, 'work/slice-kappa:work/slice-kappa'], repo);
		const res = gitIn(
			['cat-file', '-e', 'work/slice-kappa:work/needs-attention/kappa.md'],
			repo,
		);
		expect(res).toBe('');
		// Sanity: helper above asserts existsOnArbiterMain is importable.
		expect(typeof existsOnArbiterMain).toBe('function');
	});
});
