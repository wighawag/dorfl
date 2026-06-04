import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performComplete} from '../src/complete.js';
import {readNeedsAttentionItems} from '../src/needs-attention.js';
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
	scratch = makeScratch('agent-runner-complete-na-');
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
 * a slice claimed (in-progress on the arbiter) and the human onboarded onto
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
	gitIn(['switch', '-q', '-c', `work/${slug}`, `${ARBITER}/main`], repo);
	return {repo, seeded};
}

/** Simulate the build agent: leave UNCOMMITTED work in the tree (no git). */
function agentEdits(repo: string, file = 'feature.txt', body = 'the work\n') {
	writeFileSync(join(repo, file), body);
}

const PASS = 'exit 0';
const FAIL = 'exit 1';

describe('complete — failed gate routes to needs-attention', () => {
	it('moves the item in-progress → needs-attention with the reason recorded', async () => {
		const {repo} = await claimAndBranch('alpha');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: FAIL,
			env: gitEnv(),
		});

		// Exit 1 (the work did not complete) and the gate-failed outcome stands.
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('gate-failed');
		expect(result.routedToNeedsAttention).toBe(true);

		// The item is no longer dangling in in-progress/ — it moved to
		// needs-attention/ (not done/).
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			false,
		);
		expect(existsSync(join(repo, 'work', 'done', 'alpha.md'))).toBe(false);
		const dest = join(repo, 'work', 'needs-attention', 'alpha.md');
		expect(existsSync(dest)).toBe(true);

		// The reason is recorded as prose in the body (no status/label field).
		const body = readFileSync(dest, 'utf8');
		expect(body).toMatch(/Needs attention/i);
		expect(body).toMatch(/gate failed/i);

		// Surfaced by readNeedsAttentionItems with that reason.
		const items = readNeedsAttentionItems(repo);
		expect(items.find((i) => i.slug === 'alpha')?.reason).toMatch(
			/gate failed/i,
		);
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

		// Working tree is clean (everything was staged + committed). No partial state.
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
		// TWO commits (needs-attention-surface-on-main): the MOVE-ONLY tip is purely
		// the git mv (no agent file), and the wip commit below it saves the aborted
		// work — so a surfacing strategy can publish the tip without leaking the wip.
		const tip = gitIn(['show', '--name-status', '--format=', 'HEAD'], repo);
		expect(tip).toMatch(/work\/needs-attention\/beta\.md/);
		expect(tip).toMatch(/work\/in-progress\/beta\.md/);
		expect(tip).not.toMatch(/feature\.txt/);
		const wip = gitIn(['show', '--name-status', '--format=', 'HEAD~1'], repo);
		expect(wip).toMatch(/feature\.txt/);
		// Not mid-rebase, not detached.
		expect(currentBranch(repo)).toBe('work/beta');
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
		expect(existsSync(join(repo, 'work', 'done', 'gamma.md'))).toBe(true);
		expect(existsSync(join(repo, 'work', 'needs-attention', 'gamma.md'))).toBe(
			false,
		);
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
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('rebase-conflict');
		expect(result.routedToNeedsAttention).toBe(true);

		// The rebase was aborted (not mid-rebase).
		expect(existsSync(join(repo, '.git', 'rebase-merge'))).toBe(false);
		expect(existsSync(join(repo, '.git', 'rebase-apply'))).toBe(false);

		// Item moved to needs-attention/ (it was in done/ after the done-move).
		expect(existsSync(join(repo, 'work', 'done', 'theta.md'))).toBe(false);
		expect(existsSync(join(repo, 'work', 'in-progress', 'theta.md'))).toBe(
			false,
		);
		const dest = join(repo, 'work', 'needs-attention', 'theta.md');
		expect(existsSync(dest)).toBe(true);
		expect(readFileSync(dest, 'utf8')).toMatch(/conflict/i);

		// Nothing landed on arbiter main.
		expect(existsOnArbiterMain(repo, 'done', 'theta')).toBe(false);

		// Surfaced with the conflict reason.
		const items = readNeedsAttentionItems(repo);
		expect(items.find((i) => i.slug === 'theta')?.reason).toMatch(/conflict/i);
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
		expect(currentBranch(repo)).toBe('work/kappa');
	});
});
