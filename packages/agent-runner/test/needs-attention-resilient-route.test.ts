import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
import {GitHubProvider} from '../src/github.js';
import {run} from '../src/git.js';
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

/**
 * The needs-attention route made network-FAULT-TOLERANT, HONESTLY-reported, and
 * REQUEUE-SAFE (task `needs-attention-routing-resilient-honest-requeue-safe`).
 * Throwaway-git harness style (`GIT_CONFIG_GLOBAL` isolation); the retry timeline
 * is driven by an INJECTED no-op sleep so there are NO real wall-clock waits.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-na-resilient-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
/** A no-op sleep + tiny bounds so the bounded backoff resolves instantly. */
const FAST = {
	sleep: async () => {},
	backoff: {maxAttempts: 2, initialDelayMs: 1, maxTotalMs: 10},
} as const;

/**
 * Claim a slug, onboard onto `work/<slug>` off the freshly-pushed main, and
 * (optionally) leave a COMMITTED prior attempt on the branch so the emptiness
 * guard does NOT skip the branch push. Returns the working clone + the seeded
 * handle.
 */
async function claimAndBranch(
	slug: string,
	opts: {commitWork?: boolean} = {},
): Promise<{repo: string; seeded: SeededRepo}> {
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
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	if (opts.commitWork) {
		writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	}
	return {repo, seeded};
}

/** Break the working clone's arbiter remote so EVERY git network op fails. */
function breakArbiter(repo: string): void {
	gitIn(
		['remote', 'set-url', ARBITER, 'file:///nonexistent/agent-runner-gone.git'],
		repo,
	);
}

describe('needs-attention route — fault tolerance (never crashes on a git outage)', () => {
	it('an unreachable arbiter does NOT throw out of the route — caught + bounded give-up', async () => {
		const {repo} = await claimAndBranch('alpha', {commitWork: true});
		breakArbiter(repo);

		// The whole route resolves (no unhandled exception, even on a git outage).
		const routed = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'alpha',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
			...FAST,
		});

		// With the arbiter unreachable the lock amend (the SOLE stuck record) cannot
		// land, so the bounce HONESTLY reports moved:false (nothing was recorded) and
		// the branch push failed-after-retries — reported, never THROWN.
		expect(routed.moved).toBe(false);
		expect(routed.branchPush).toBe('failed');
	});

	it('retries the branch push with bounded backoff then gives up (NOT indefinitely)', async () => {
		const {repo} = await claimAndBranch('beta', {commitWork: true});
		breakArbiter(repo);

		const delays: number[] = [];
		const routed = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'beta',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
			sleep: async (ms: number) => {
				delays.push(ms);
			},
			backoff: {maxAttempts: 3, initialDelayMs: 10, maxTotalMs: 100_000},
		});

		expect(routed.branchPush).toBe('failed');
		// 3 attempts → 2 inter-attempt sleeps, exponential (the surface also retried,
		// but here we only assert SOME bounded, exponential delays were taken).
		expect(delays.length).toBeGreaterThan(0);
		expect(delays.length).toBeLessThan(20); // bounded, never indefinite
	});
});

describe('needs-attention route — honest per-op reporting', () => {
	it('(a) ALL succeed: surfaced ✓ + branch pushed ✓', async () => {
		const {repo} = await claimAndBranch('gamma', {commitWork: true});
		const routed = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
			...FAST,
		});
		// The on-`main` surface half is GONE (the lock is the surface now); only the
		// branch-push outcome is reported.
		expect(routed.branchPush).toBe('pushed');
		// The stuck state is the lock; the branch really reached the arbiter.
		expect(stuckLockOnArbiter(repo, 'gamma')).toBe(true);
	});

	it('(b) surface ✓ + branch SKIPPED-empty (the observed early-failure case)', async () => {
		// The emptiness guard skips the push when the target branch has no work beyond
		// main (a couldn't-even-start bounce) — exercised here by routing an ABSENT
		// branch (same arm as the existing centralise test). The surface still lands;
		// the report must say skipped, NOT pushed.
		const {repo} = await claimAndBranch('delta', {commitWork: false});
		const routed = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'delta',
			reason: 'gate red',
			arbiter: ARBITER,
			branch: 'work/task-never-created',
			env: gitEnv(),
			...FAST,
		});
		expect(routed.branchPush).toBe('skipped-empty');
		// The absent branch did NOT reach the arbiter (nothing to recover yet).
		gitIn(['fetch', '-q', ARBITER], repo);
		const onArbiter = run(
			'git',
			[
				'rev-parse',
				'--verify',
				'--quiet',
				`${ARBITER}/work/task-never-created^{commit}`,
			],
			repo,
			{env: gitEnv()},
		);
		expect(onArbiter.status).not.toBe(0);
	});

	it('(c) push fails after retries: reported as failed (saved LOCALLY only)', async () => {
		const {repo} = await claimAndBranch('epsilon', {commitWork: true});
		breakArbiter(repo);
		const routed = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'epsilon',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
			...FAST,
		});
		expect(routed.branchPush).toBe('failed');
		expect(routed.pushError).toBeTruthy();
	});

	it('the failure message never claims a push that did not happen', async () => {
		const {repo} = await claimAndBranch('zeta', {commitWork: false});
		const notes: string[] = [];
		const routed = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'zeta',
			reason: 'gate red',
			arbiter: ARBITER,
			branch: 'work/task-never-created',
			env: gitEnv(),
			note: (m) => notes.push(m),
			...FAST,
		});
		expect(routed.branchPush).toBe('skipped-empty');
		// A note explicitly says the branch push was SKIPPED (nothing to recover) —
		// not "pushed".
		expect(notes.join('\n')).toMatch(
			/Skipped pushing work\/task-never-created/,
		);
	});
});

describe('requeue-safe — default keep+continue refuses a missing arbiter branch', () => {
	it('REFUSES when the work branch is NOT on the arbiter (push first / --reset)', async () => {
		// Surface to needs-attention on the arbiter NORMALLY (so the item IS on
		// <arbiter>/main and the tree-less requeue reaches the continue-branch guard),
		// then DELETE the work branch from the arbiter so the guard sees it absent.
		const {repo, seeded} = await claimAndBranch('eta', {commitWork: true});
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'eta',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
			...FAST,
		});
		expect(stuckLockOnArbiter(repo, 'eta')).toBe(true);
		// Remove the continue-branch from the arbiter (the local one survives, which
		// is exactly why the guard must check the ARBITER ref, not the local one).
		gitIn(['push', '-q', ARBITER, '--delete', 'work/task-eta'], repo);
		void seeded;

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'eta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/isn't on/);
		expect(result.reasonNotMoved).toMatch(/push it first|--reset/);
		// The lock stayed stuck (not released); the body rests in backlog/.
		expect(stuckLockOnArbiter(repo, 'eta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'backlog', 'eta')).toBe(true);
	});

	it('REQUEUES when the arbiter branch IS present', async () => {
		const {repo} = await claimAndBranch('theta', {commitWork: true});
		const routed = await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'theta',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
			...FAST,
		});
		expect(routed.branchPush).toBe('pushed');
		// Land local main on the surface so the requeue's HEAD push fast-forwards.
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'theta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
	});

	it('--reset is UNAFFECTED by the guard (discards the branch by design)', async () => {
		// No arbiter branch present, but --reset must still proceed (and delete is a
		// no-op tolerated as already-gone).
		const {repo} = await claimAndBranch('iota', {commitWork: false});
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'iota',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
			...FAST,
		});
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'iota',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
	});

	it('REFUSES a requeue with NO arbiter (tree-less CAS needs a ref to push to)', async () => {
		// Tree-less requeue is published as a CAS to the arbiter ref (parity with
		// claim) — there is no purely-local mode any more, so omitting --arbiter is a
		// refusal (NOT a silent cwd-tree commit that could sweep a concurrent writer).
		const {repo} = await claimAndBranch('kappa', {commitWork: false});
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'kappa',
			reason: 'gate red',
			arbiter: ARBITER,
			env: gitEnv(),
			...FAST,
		});
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'kappa',
			// NO arbiter.
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/--arbiter/);
	});
});

describe('PR-create failure (propose) — distinct LOW-severity degrade mode', () => {
	/**
	 * A `gh` stub that is AUTHED (`auth status` exits 0) but whose `pr create`
	 * ALWAYS fails (a transient outage) — so the provider retries the create then
	 * degrades with the OUTAGE wording (work safe, only the review surface missing).
	 */
	function writeOutageGhStub(): string {
		const bin = join(scratch.root, 'gh-outage-stub.sh');
		const script = [
			'#!/usr/bin/env bash',
			'if [ "$1" = "auth" ]; then exit 0; fi', // authed
			'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
			'  echo "could not connect to api.github.com" 1>&2',
			'  exit 1',
			'fi',
			'exit 1',
		].join('\n');
		writeFileSync(bin, script);
		chmodSync(bin, 0o755);
		return bin;
	}

	it('retries with backoff then degrades with the manual gh pr create instruction', async () => {
		const provider = new GitHubProvider({ghBin: writeOutageGhStub()});
		const delays: number[] = [];
		const result = await provider.openRequest({
			cwd: scratch.root,
			branch: 'work/task-feat',
			arbiter: 'origin',
			sleep: async (ms: number) => {
				delays.push(ms);
			},
			backoff: {maxAttempts: 3, initialDelayMs: 5, maxTotalMs: 100_000},
		});

		// LOW severity: the branch is reported SAFE/pushed; only the PR is missing.
		expect(result.opened).toBe(false);
		expect(result.instruction).toMatch(/Pushed work\/task-feat/);
		expect(result.instruction).toMatch(/gh pr create/);
		expect(result.instruction).toMatch(/after retries|transient outage|SAFE/i);
		// It RETRIED (an authed-but-failing create) before degrading.
		expect(delays.length).toBeGreaterThan(0);
	});

	it('a missing/unauth gh degrades IMMEDIATELY (no wasted retry)', async () => {
		const bin = join(scratch.root, 'gh-unauth.sh');
		writeFileSync(bin, ['#!/usr/bin/env bash', 'exit 1'].join('\n')); // everything fails
		chmodSync(bin, 0o755);
		const provider = new GitHubProvider({ghBin: bin});
		const delays: number[] = [];
		const result = await provider.openRequest({
			cwd: scratch.root,
			branch: 'work/task-feat',
			arbiter: 'origin',
			sleep: async (ms: number) => {
				delays.push(ms);
			},
		});
		expect(result.opened).toBe(false);
		// The unavailable arm degrades to a manual `gh pr create` instruction, but it
		// surfaces the REAL cause (here an empty-stderr exit 1) — NOT a hard-coded
		// "unavailable or unauthenticated" auth guess.
		expect(result.instruction).toMatch(/gh pr create/);
		expect(result.instruction).not.toMatch(/unavailable or unauthenticated/);
		expect(delays).toEqual([]); // deterministic failure → no backoff
	});

	it('the unavailable arm surfaces the REAL gh stderr (a non-auth permissions error), NOT a hard-coded auth guess', async () => {
		const realCause =
			'GraphQL: 0xronan7 does not have the correct permissions (createPullRequest)';
		const bin = join(scratch.root, 'gh-perm.sh');
		// `pr create` fails with a real permissions stderr; `auth status` also fails
		// (so the availability probe reads unavailable → the `unavailable` arm).
		writeFileSync(
			bin,
			[
				'#!/usr/bin/env bash',
				'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then',
				`  echo ${JSON.stringify(realCause)} 1>&2`,
				'  exit 1',
				'fi',
				'exit 1',
			].join('\n'),
		);
		chmodSync(bin, 0o755);
		const provider = new GitHubProvider({ghBin: bin});
		const delays: number[] = [];
		const result = await provider.openRequest({
			cwd: scratch.root,
			branch: 'work/task-feat',
			arbiter: 'origin',
			sleep: async (ms: number) => {
				delays.push(ms);
			},
		});
		expect(result.opened).toBe(false);
		// The TRUE cause is surfaced verbatim, NOT misattributed to auth.
		expect(result.instruction).toContain(realCause);
		expect(result.instruction).not.toMatch(/unavailable or unauthenticated/);
		// The manual-fallback guidance + the safe-pushed posture stay intact.
		expect(result.instruction).toMatch(/Pushed work\/task-feat/);
		expect(result.instruction).toMatch(/gh pr create/);
		expect(delays).toEqual([]); // deterministic (unavailable) → no backoff
	});

	it('the unavailable arm reads as the clear "binary missing" string when gh is missing — never crashes', async () => {
		const provider = new GitHubProvider({
			ghBin: join(scratch.root, 'no-such-gh-binary'),
		});
		const delays: number[] = [];
		const result = await provider.openRequest({
			cwd: scratch.root,
			branch: 'work/task-feat',
			arbiter: 'origin',
			sleep: async (ms: number) => {
				delays.push(ms);
			},
		});
		expect(result.opened).toBe(false);
		expect(result.instruction).toContain('binary missing');
		expect(result.instruction).not.toMatch(/unavailable or unauthenticated/);
		expect(result.instruction).toMatch(/gh pr create/);
		expect(delays).toEqual([]); // deterministic failure → no backoff
	});
});
