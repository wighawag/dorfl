import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import type {ReviewGate, ReviewVerdict} from '../src/review-gate.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Slice `gate-on-rebased-tip-fresh-worktree`: the acceptance gate (`prepare` then
 * `verify`) runs, by default, in a CLEAN throwaway worktree cut from the work
 * branch REBASED onto the latest `<arbiter>/main` (the tree that actually
 * integrates), NOT the agent's pre-rebase checkout — so a green gate provably
 * describes the merged artifact. These tests drive `performIntegration` DIRECTLY
 * (the shared band that honours the `freshWorktreeGate` boolean it is handed),
 * proving: the falsely-green-leak is closed (a cwd-only file is ABSENT from the
 * gate tree); a rebase-introduced change IS present in the gate tree; the throwaway
 * worktree is reaped + never leaks + is distinct from the job worktree; prepare runs
 * in the fresh worktree before verify; failures route exactly as today; and the OFF
 * path is byte-for-byte the pre-rebase gate.
 *
 * House style mirrors `integration-core.test.ts`: a throwaway checkout + a local
 * `--bare` arbiter; `surfaceArbiter` left unset (the human-`complete` local-only
 * routing) unless a test needs the surface.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-fwg-test-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Stand a repo up exactly as the caller's HEAD leaves it just before the core:
 * a slice claimed (the lock is held; the body rests in backlog/ on the arbiter) and onboarded onto `work/<slug>`
 * off the freshly-pushed main, with UNCOMMITTED agent work in the tree.
 */
async function claimAndBranch(slug: string) {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
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
	// Simulate the build agent: leave UNCOMMITTED work (it does no git).
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return {seeded, repo};
}

/** Count fresh-worktree-gate sandbox dirs currently in the OS temp area. */
function gateSandboxCount(): number {
	return readdirSync(tmpdir()).filter((d) =>
		d.startsWith('agent-runner-fresh-gate-'),
	).length;
}

describe('fresh-worktree gate — the gate tests the REBASED tip, not the pre-rebase checkout', () => {
	it('a cwd-only (gitignored/uncommitted) file the gate relied on is ABSENT from the gate worktree (falsely-green leak CLOSED)', async () => {
		const {repo} = await claimAndBranch('leak');
		// The agent's checkout has a file that is NOT committed (it would be swept by
		// `git add -A` UNLESS gitignored — here we gitignore it so it can never reach
		// the committed/pushed tree). With today's pre-rebase gate this file is present
		// in `cwd` and a `verify` that depends on it passes (falsely green). With the
		// fresh gate the worktree is cut from the COMMITTED rebased tip, which does NOT
		// have the file, so the SAME `verify` FAILS — proving the leak is closed.
		writeFileSync(join(repo, '.gitignore'), 'leak-only.txt\n');
		writeFileSync(
			join(repo, 'leak-only.txt'),
			'present only in the checkout\n',
		);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'leak',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			// The gate depends on the cwd-only file existing; it must NOT exist in the
			// fresh rebased-tip worktree.
			verify: 'test -f leak-only.txt',
			mode: 'propose',
			env: gitEnv(),
		});

		// The gate ran on the rebased tip (no leak-only.txt) ⇒ it FAILED, so the leak
		// is provably closed (a pre-rebase gate would have passed on the cwd file).
		expect(core.outcome).toBe('gate-failed');
		expect(core.routedToNeedsAttention).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'leak')).toBe(false);
	});

	it('OFF path (today): the SAME cwd-only file IS visible to the pre-rebase gate (it passes) — the consciously-accepted divergence', async () => {
		const {repo} = await claimAndBranch('leak-off');
		writeFileSync(join(repo, '.gitignore'), 'leak-only.txt\n');
		writeFileSync(
			join(repo, 'leak-only.txt'),
			'present only in the checkout\n',
		);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'leak-off',
			source: 'backlog',
			recovering: false,
			// OFF: gate runs in cwd (the pre-rebase tree), which HAS the file.
			freshWorktreeGate: false,
			verify: 'test -f leak-only.txt',
			mode: 'propose',
			env: gitEnv(),
		});

		// The pre-rebase gate saw the cwd-only file and PASSED (today's behaviour).
		expect(core.outcome).toBe('completed');
		expect(existsSync(join(repo, 'work', 'done', 'leak-off.md'))).toBe(true);
	});

	it('a change introduced ONLY by the integration rebase IS present in the gated tree (gate sees what merges)', async () => {
		const {seeded, repo} = await claimAndBranch('rebased');
		// AFTER the branch was cut, the arbiter's main advances with a NEW file the
		// branch does not have. The integration rebase brings it onto the work branch
		// tip; the fresh gate (cut from THAT rebased tip) therefore SEES it. A
		// pre-rebase gate (the cwd before the rebase) would NOT.
		const other = seeded.clone('advance');
		writeFileSync(join(other, 'rebased-in.txt'), 'arrived via the rebase\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'advance main with a new file'], other);
		gitIn(['push', '-q', ARBITER, 'main:main'], other);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'rebased',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			// The gate REQUIRES the rebase-introduced file — it can only pass on the
			// rebased tip, never on the pre-rebase checkout.
			verify: 'test -f rebased-in.txt',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(existsSync(join(repo, 'work', 'done', 'rebased.md'))).toBe(true);
	});
});

describe('fresh-worktree gate — prepare runs in the fresh worktree before verify', () => {
	it('prepare THEN verify run in the throwaway worktree (a fresh worktree with no deps gates correctly)', async () => {
		const {repo} = await claimAndBranch('prep');
		// prepare WRITES a file the throwaway worktree starts WITHOUT; verify then
		// requires it. Because prepare runs in the SAME fresh worktree before verify,
		// the gate passes. (The file lands in the throwaway worktree, reaped after, so
		// it never touches the agent's cwd or the committed tree.)
		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'prep',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			prepare: 'touch prepared.marker',
			verify: 'test -f prepared.marker',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		// The prepare marker was written in the THROWAWAY worktree, not the agent's
		// cwd (the gate worktree is reaped, so it does not exist anywhere now).
		expect(existsSync(join(repo, 'prepared.marker'))).toBe(false);
		expect(existsSync(join(repo, 'work', 'done', 'prep.md'))).toBe(true);
	});

	it('a FAILING prepare in the fresh worktree ⇒ prepare-failed (distinct from gate-failed), NEVER runs verify', async () => {
		const {repo} = await claimAndBranch('prep-fail');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'prep-fail',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			prepare: 'exit 7',
			// If verify ran it would pass — but prepare-failed must short-circuit it.
			verify: 'exit 0',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('prepare-failed');
		expect(core.routedToNeedsAttention).toBe(true);
		expect(core.reason).toMatch(/prepare/i);
		expect(core.reason).not.toMatch(/acceptance gate failed/i);
		// Bounced (the routedToNeedsAttention flag), never landed on arbiter main.
		// Local-only `performIntegration` (no surfaceArbiter) records nothing durable;
		// the body stays in backlog/ and no needs-attention/ folder is written.
		expect(existsOnArbiterMain(repo, 'done', 'prep-fail')).toBe(false);
		expect(
			existsSync(join(repo, 'work', 'needs-attention', 'prep-fail.md')),
		).toBe(false);
	});
});

describe('fresh-worktree gate — reaped after the gate (pass OR fail), never leaks', () => {
	it('a GREEN gate reaps the throwaway worktree (no agent-runner-fresh-gate-* dir lingers)', async () => {
		const {repo} = await claimAndBranch('reap-pass');
		const before = gateSandboxCount();

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'reap-pass',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			verify: 'exit 0',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		// No throwaway gate sandbox lingers (reaped in the finally).
		expect(gateSandboxCount()).toBe(before);
		// The gate worktree was distinct from the job worktree: the agent's cwd still
		// has its work branch checked out and is untouched as a registered worktree.
		const worktrees = gitIn(['worktree', 'list'], repo);
		expect(worktrees).not.toMatch(/agent-runner-fresh-gate-/);
	});

	it('a RED gate ALSO reaps the throwaway worktree (no leak on the failure path)', async () => {
		const {repo} = await claimAndBranch('reap-fail');
		const before = gateSandboxCount();

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'reap-fail',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			verify: 'exit 1',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('gate-failed');
		expect(gateSandboxCount()).toBe(before);
		const worktrees = gitIn(['worktree', 'list'], repo);
		expect(worktrees).not.toMatch(/agent-runner-fresh-gate-/);
	});
});

describe('fresh-worktree gate — failure routing is unchanged (only the gate TREE moved)', () => {
	it('a red gate on the rebased tip routes to needs-attention exactly as today (from done/, since the done-move already happened)', async () => {
		const {repo} = await claimAndBranch('route');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'route',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			verify: 'exit 3',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('gate-failed');
		expect(core.routedToNeedsAttention).toBe(true);
		expect(core.branch).toBe('work/slice-route');
		expect(core.reason).toMatch(/acceptance gate failed/i);
		// The bounce is a pure lock amend now (no folder move). Local-only
		// `performIntegration` records nothing durable; nothing landed on main.
		expect(existsSync(join(repo, 'work', 'needs-attention', 'route.md'))).toBe(
			false,
		);
		expect(existsOnArbiterMain(repo, 'done', 'route')).toBe(false);
	});

	it('a rebase CONFLICT still routes to rebase-conflict (the gate does NOT run on an un-integratable tree)', async () => {
		const {seeded, repo} = await claimAndBranch('conflict');
		writeFileSync(join(repo, 'README.md'), '# project\nour change\n');

		// Another clone advances arbiter/main with a CONFLICTING edit.
		const other = seeded.clone('conflict');
		writeFileSync(join(other, 'README.md'), '# project\ntheir change\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'conflicting advance'], other);
		gitIn(['push', '-q', ARBITER, 'main:main'], other);

		const before = gateSandboxCount();
		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'conflict',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			// If the gate ever ran, this would pass — but a rebase conflict must
			// short-circuit BEFORE the gate (no gate on an un-integratable tree).
			verify: 'exit 0',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('rebase-conflict');
		expect(core.routedToNeedsAttention).toBe(true);
		// No gate sandbox was even created (the gate never ran).
		expect(gateSandboxCount()).toBe(before);
		expect(existsOnArbiterMain(repo, 'done', 'conflict')).toBe(false);
	});
});

const APPROVE: ReviewVerdict = {verdict: 'approve', findings: []};
const BLOCK: ReviewVerdict = {
	verdict: 'block',
	findings: [{severity: 'blocking', question: 'why is X like this?'}],
};

describe('fresh-worktree gate ON + review ON — verify-THEN-review, both on the REBASED tip (MAINTAINER DECISION 2)', () => {
	it('the review runs AFTER the rebased-tip verify, on the SAME (rebased-tip) tree', async () => {
		const {repo} = await claimAndBranch('vtr');
		// verify writes a marker IN the tree it runs against; the review then observes
		// whether that marker is present in the tree IT is handed. If both run on the
		// SAME rebased-tip worktree in order, the review sees the marker.
		let reviewSawVerifyMarker = false;
		let reviewCwd: string | undefined;
		const gate: ReviewGate = async ({cwd}) => {
			reviewCwd = cwd;
			reviewSawVerifyMarker = existsSync(join(cwd, 'verify-ran.marker'));
			return APPROVE;
		};

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'vtr',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			verify: 'touch verify-ran.marker',
			review: true,
			reviewGate: gate,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		// verify ran BEFORE the review, and on the SAME tree (the marker it wrote is
		// visible to the review).
		expect(reviewSawVerifyMarker).toBe(true);
		// The review inspected the THROWAWAY gate worktree (the rebased tip), NOT the
		// agent's pre-rebase cwd.
		expect(reviewCwd).toBeDefined();
		expect(reviewCwd).not.toBe(repo);
		expect(reviewCwd).toMatch(/agent-runner-fresh-gate-/);
		expect(existsSync(join(repo, 'work', 'done', 'vtr.md'))).toBe(true);
		// The verify marker lived only in the (reaped) gate worktree; it never touched
		// the agent's cwd or the committed tree.
		expect(existsSync(join(repo, 'verify-ran.marker'))).toBe(false);
	});

	it('the review inspects the rebased tip: a rebase-introduced file IS visible to it', async () => {
		const {seeded, repo} = await claimAndBranch('vtr-rebased');
		// arbiter/main advances with a file the branch does not have; the integration
		// rebase brings it onto the tip the fresh gate (and so the review) is cut from.
		const other = seeded.clone('advance');
		writeFileSync(join(other, 'rebased-in.txt'), 'arrived via the rebase\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'advance main'], other);
		gitIn(['push', '-q', ARBITER, 'main:main'], other);

		let reviewSawRebasedFile = false;
		const gate: ReviewGate = async ({cwd}) => {
			reviewSawRebasedFile = existsSync(join(cwd, 'rebased-in.txt'));
			return APPROVE;
		};

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'vtr-rebased',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			verify: 'exit 0',
			review: true,
			reviewGate: gate,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(reviewSawRebasedFile).toBe(true);
	});

	it('a review BLOCK on the ON path surfaces from the rebased tip (after the rebased-tip verify passed), routing from done/', async () => {
		const {repo} = await claimAndBranch('vtr-block');
		let verifyRanBeforeReview = false;
		const gate: ReviewGate = async ({cwd}) => {
			verifyRanBeforeReview = existsSync(join(cwd, 'verify-ran.marker'));
			return BLOCK;
		};

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'vtr-block',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			verify: 'touch verify-ran.marker',
			review: true,
			reviewGate: gate,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('review-blocked');
		expect(core.routedToNeedsAttention).toBe(true);
		// verify ran (and passed) BEFORE the review blocked, on the rebased tip.
		expect(verifyRanBeforeReview).toBe(true);
		// The bounce is a pure lock amend now (no folder move); local-only, nothing
		// durable recorded; nothing landed on main.
		expect(
			existsSync(join(repo, 'work', 'needs-attention', 'vtr-block.md')),
		).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'vtr-block')).toBe(false);
	});

	it('a red rebased-tip verify short-circuits BEFORE the review (verify is the floor, runs first)', async () => {
		const {repo} = await claimAndBranch('vtr-redverify');
		let reviewRan = false;
		const gate: ReviewGate = async () => {
			reviewRan = true;
			return APPROVE;
		};

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'vtr-redverify',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: true,
			verify: 'exit 1',
			review: true,
			reviewGate: gate,
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('gate-failed');
		// The review NEVER ran — a red verify short-circuits before the judgement gate.
		expect(reviewRan).toBe(false);
	});
});

describe('fresh-worktree gate — OFF is byte-for-byte the pre-rebase gate', () => {
	it('OFF: a green pre-rebase gate completes and lands the done-move (no throwaway worktree created)', async () => {
		const {repo} = await claimAndBranch('off-green');
		const before = gateSandboxCount();

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'off-green',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: false,
			verify: 'exit 0',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(existsSync(join(repo, 'work', 'done', 'off-green.md'))).toBe(true);
		// OFF ⇒ no fresh worktree is ever created.
		expect(gateSandboxCount()).toBe(before);
	});

	it('UNSET (the core default) behaves like OFF: the pre-rebase gate, no throwaway worktree', async () => {
		const {repo} = await claimAndBranch('off-unset');
		const before = gateSandboxCount();

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'off-unset',
			source: 'backlog',
			recovering: false,
			// freshWorktreeGate UNSET — the core treats absence as OFF (the CLI resolves
			// the user-facing default to ON via config; the band honours the value it is
			// handed).
			verify: 'exit 0',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(gateSandboxCount()).toBe(before);
	});

	it('OFF: a red pre-rebase gate routes from backlog/ (the done-move has NOT happened yet)', async () => {
		const {repo} = await claimAndBranch('off-red');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'off-red',
			source: 'backlog',
			recovering: false,
			freshWorktreeGate: false,
			verify: 'exit 1',
			mode: 'propose',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('gate-failed');
		expect(core.routedToNeedsAttention).toBe(true);
		// The bounce is a pure lock amend now (no folder move); the body stays in
		// backlog/ and no needs-attention/ folder is written (local-only).
		expect(existsSync(join(repo, 'work', 'backlog', 'off-red.md'))).toBe(true);
		expect(
			existsSync(join(repo, 'work', 'needs-attention', 'off-red.md')),
		).toBe(false);
	});
});
