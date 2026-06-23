/**
 * The mirror↔arbiter RECONCILIATION (task
 * `onboard-and-reset-reconcile-mirror-to-arbiter`). Pins the two coupled fixes:
 *
 *   1. WRITE-THROUGH ordering at the delete sites (`requeue --reset`, the
 *      merge-reap in `integrator.ts`, `gc --remote-branches` in
 *      `reap-branches.ts`): the LOCAL tracking ref
 *      `refs/remotes/<arbiter>/work/<slug>` (the ref `branchAheadOf` reads) is
 *      deleted FIRST, then `git push <arbiter> --delete`. The asymmetry
 *      converts a permanent stale-continue failure mode into a self-healing one.
 *   2. ARBITER-AUTHORITATIVE continue-detection on BOTH onboarding paths
 *      (in-place clone via `start.ts`/`isolation.ts`, bare hub mirror via
 *      `workspace.ts`): `git ls-remote <arbiter> refs/heads/work/<slug>`;
 *      absent on the arbiter ⇒ fresh cut, regardless of any local ref —
 *      closes the CROSS-MACHINE delete window write-through alone cannot.
 *
 * Throwaway `--bare` `file://` arbiters + real clones/mirrors, no network.
 * A plain `remote prune` is verified NOT relied on (no-op on the bare mirror).
 */
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
import {releaseItemLock} from '../src/item-lock.js';
import {performStart} from '../src/start.js';
import {createJob} from '../src/workspace.js';
import {branchAheadOfArbiter} from '../src/continue-branch.js';
import {sweepRemoteMergedBranches} from '../src/reap-branches.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

const ARBITER = 'arbiter';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-onboard-reconcile-');
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * Drive a task to needs-attention with a prior attempt's commit on
 * `work/task-<slug>` PUSHED to the arbiter (the kept-branch artifact a
 * `requeue --reset` is meant to discard).
 */
async function stuckButNeedsAttention(
	slug: string,
): Promise<{seeded: SeededRepo; repo: string}> {
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
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	gitIn(['push', '-q', ARBITER, `work/task-${slug}:work/task-${slug}`], repo);
	await ledgerWrite.applyNeedsAttentionTransition({
		cwd: repo,
		slug,
		reason: 'gate red',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
	return {seeded, repo};
}

function localRef(cwd: string, ref: string): string {
	const res = run('git', ['rev-parse', '--verify', '--quiet', ref], cwd, {
		env: gitEnv(),
	});
	return res.stdout.trim();
}

function arbiterHasBranch(seeded: SeededRepo, branch: string): boolean {
	const out = gitIn(
		['ls-remote', `file://${seeded.arbiter}`, `refs/heads/${branch}`],
		seeded.repo,
	);
	return out.trim() !== '';
}

/**
 * Move a slug from needs-attention/ back to backlog/ on the arbiter (cross-machine),
 * AND release its per-item lock — modelling a LEGITIMATE return-to-pool. Under the
 * interim dual-write (task `claim-acquires-unified-lock-no-body-move`) a claim
 * acquires the per-item lock, and the real return-to-pool (`returnToBacklog`)
 * RELEASES it. A bare arbiter reroute that left the lock held would NOT be
 * re-claimable (claim's lock acquire would lose definitively — by design, the
 * orphaned-lock case is cleared by the human `release-lock` verb in task
 * `release-lock-verb-and-gc-stuck-report`, never an auto-steal at claim time). So a
 * test that wants the item to be legitimately re-claimable must release the lock,
 * exactly as the real return-to-pool does.
 */
async function rerouteToBacklogOnArbiter(
	seeded: SeededRepo,
	slug: string,
): Promise<void> {
	const mover = seeded.clone(`reroute-${slug}`);
	gitIn(['fetch', '-q', ARBITER], mover);
	// The body already RESTS in backlog/ (the bounce is a pure lock amend now — no
	// folder move). The real return-to-pool (`returnToBacklog`) just RELEASES the
	// per-item lock, so the item becomes LEGITIMATELY re-claimable.
	await releaseItemLock({
		item: `task:${slug}`,
		cwd: mover,
		arbiter: ARBITER,
		env: gitEnv(),
	});
}

// =============================================================================
// FIX 1 (WRITE-THROUGH): `requeue --reset` deletes the LOCAL tracking ref first
// =============================================================================

describe('requeue --reset is WRITE-THROUGH (local tracking ref deleted FIRST)', () => {
	it("removes the LOCAL tracking ref refs/remotes/<arbiter>/work/<slug> (not just the local HEAD — today's specific miss)", async () => {
		const {repo} = await stuckButNeedsAttention('alpha');
		const trackingRef = `refs/remotes/${ARBITER}/work/task-alpha`;
		expect(localRef(repo, trackingRef)).not.toBe('');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// The LOCAL tracking ref — the one `branchAheadOf` reads — is gone.
		// (Before the fix, `--reset` only ran `git branch -D <branch>` which
		// drops a local HEAD, NOT the tracking ref, so the next `do` continued
		// from the stale tracking ref.)
		expect(localRef(repo, trackingRef)).toBe('');
		// And the local HEAD is gone too.
		expect(localRef(repo, 'refs/heads/work/task-alpha')).toBe('');
	});

	it('when the arbiter delete FAILS, the local state is BEHIND (recoverable on fetch), not AHEAD (stale-continue)', async () => {
		const {seeded, repo} = await stuckButNeedsAttention('beta');
		const trackingRef = `refs/remotes/${ARBITER}/work/task-beta`;
		expect(localRef(repo, trackingRef)).not.toBe('');

		// Break the arbiter remote URL so `git push --delete` fails (the local
		// tracking ref still resolves because the object was fetched into the
		// store; `resolveRequeueSourceRel` also reads `<arbiter>/main` from the
		// local tracking ref).
		const realArbiter = seeded.arbiter;
		const brokenUrl = `file://${realArbiter}-MOVED-AWAY`;
		gitIn(['remote', 'set-url', ARBITER, brokenUrl], repo);

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'beta',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
		});
		// The requeue ABORTED (arbiter delete failed) — the lock stays held (not
		// released). No backlog move (the body already rests in backlog/).
		expect(result.moved).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
		// CRITICAL: the LOCAL tracking ref was deleted FIRST (write-through), so
		// the local store is now BEHIND the arbiter (the arbiter still has the
		// branch). It is NOT AHEAD (the dangerous direction that drives stale
		// continues).
		expect(localRef(repo, trackingRef)).toBe('');

		// SELF-HEALING: restore the arbiter URL, fetch, and the tracking ref
		// reappears (arbiter is source of truth, local ref is derived).
		gitIn(['remote', 'set-url', ARBITER, `file://${realArbiter}`], repo);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(localRef(repo, trackingRef)).not.toBe('');
	});

	it('after `--reset`, NO store can drive a continue: a re-`do` starts FRESH', async () => {
		const {seeded, repo} = await stuckButNeedsAttention('gamma');
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'gamma',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(arbiterHasBranch(seeded, 'work/task-gamma')).toBe(false);

		// Re-`do` in THIS SAME checkout (where the stale tracking ref previously
		// would have driven the bug). The next claim must start FRESH — the prior
		// attempt's file is NOT present on the work branch.
		const started = await performStart({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(existsSync(join(repo, 'prior.txt'))).toBe(false);
	});
});

// =============================================================================
// FIX 2 (READ-SIDE BACKSTOP): continue-detection is ARBITER-AUTHORITATIVE
// =============================================================================

describe('continue-detection is ARBITER-authoritative (in-place clone path)', () => {
	it('a STALE local tracking ref (branch gone on arbiter, fetch.prune unset) does NOT drive a continue — cut FRESH via ls-remote truth', async () => {
		const {seeded} = await stuckButNeedsAttention('delta');

		// THIRD-machine clone, the live in-place shape: it has fetched the kept
		// branch (so its tracking ref + objects are local), `fetch.prune` is
		// UNSET (the default), and it has no local HEAD `work/task-delta`.
		// Clone NOW — before the cross-machine delete — so the fetch brings the
		// kept branch + objects into the third machine's local store.
		const third = seeded.clone('third-machine');
		expect(
			run('git', ['config', '--get', 'fetch.prune'], third, {env: gitEnv()})
				.status,
		).not.toBe(0);
		const trackingRef = `refs/remotes/${ARBITER}/work/task-delta`;
		expect(localRef(third, trackingRef)).not.toBe('');
		expect(localRef(third, 'refs/heads/work/task-delta')).toBe('');

		// Cross-machine delete: a DIFFERENT machine deletes the arbiter branch.
		const otherMachine = seeded.clone('cross-machine-deleter');
		gitIn(
			['push', '-q', `file://${seeded.arbiter}`, '--delete', 'work/task-delta'],
			otherMachine,
		);
		expect(arbiterHasBranch(seeded, 'work/task-delta')).toBe(false);

		// The third machine still holds the STALE tracking ref — a plain `git
		// fetch` does NOT prune (verified: `fetch.prune` unset, the live shape).
		// We DO NOT rely on `remote prune` to clean it up — the read must be
		// arbiter-authoritative on its own.
		gitIn(['fetch', '-q', ARBITER], third);
		expect(localRef(third, trackingRef)).not.toBe('');

		// The ARBITER-AUTHORITATIVE predicate says NO continue, even with the
		// stale tracking ref present.
		expect(
			branchAheadOfArbiter({
				cwd: third,
				arbiterRemote: ARBITER,
				branch: 'work/task-delta',
				branchRef: `${ARBITER}/work/task-delta`,
				mainRef: `${ARBITER}/main`,
				env: gitEnv(),
			}),
		).toBe(false);

		// The full onboard pipeline agrees. Route the item back to backlog
		// cross-machine, then `performStart` in the third machine: FRESH cut,
		// no prior.txt.
		await rerouteToBacklogOnArbiter(seeded, 'delta');
		const started = await performStart({
			slug: 'delta',
			cwd: third,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(existsSync(join(third, 'prior.txt'))).toBe(false);
	});
});

describe('continue-detection is ARBITER-authoritative (bare hub-mirror path)', () => {
	it('an orphaned `refs/remotes/origin/work/<slug>` in the bare mirror (the namespace no refspec prunes) does NOT drive a continue', async () => {
		const {seeded} = await stuckButNeedsAttention('epsilon');
		const workspacesDir = join(scratch.root, '.agent-runner');

		// First createJob: kept branch is on the arbiter → CONTINUE (the prior
		// commit lands in the worktree).
		const job1 = createJob({
			fromRepo: seeded.repo,
			arbiter: ARBITER,
			slug: 'epsilon',
			workspacesDir,
			env: gitEnv(),
		});
		expect(job1.continued).toBe(true);
		const oldTip = gitIn(['rev-parse', 'HEAD'], job1.dir).trim();
		const mirrorPath = job1.mirror.path;
		job1.dispose();

		// Cross-machine delete on the arbiter (e.g. another machine's `gc
		// --remote-branches`).
		const otherMachine = seeded.clone('cross-machine-deleter');
		gitIn(
			[
				'push',
				'-q',
				`file://${seeded.arbiter}`,
				'--delete',
				'work/task-epsilon',
			],
			otherMachine,
		);
		expect(arbiterHasBranch(seeded, 'work/task-epsilon')).toBe(false);

		// Plant the bare-mirror in the live ORPHAN shape: a
		// `refs/remotes/origin/work/<slug>` ref in the namespace NO
		// `remote.origin.fetch` refspec prunes (verified: 57 such live stale
		// refs in the task observation).
		run(
			'git',
			['update-ref', 'refs/remotes/origin/work/task-epsilon', oldTip],
			mirrorPath,
			{env: gitEnv()},
		);

		// VERIFY a plain `remote prune` is NOT what we rely on: it is a NO-OP on
		// the bare mirror's `refs/remotes/origin/*` namespace (no
		// `remote.origin.fetch` refspec).
		expect(localRef(mirrorPath, 'refs/remotes/origin/work/task-epsilon')).toBe(
			oldTip,
		);
		run('git', ['remote', 'prune', 'origin'], mirrorPath, {env: gitEnv()});
		expect(localRef(mirrorPath, 'refs/remotes/origin/work/task-epsilon')).toBe(
			oldTip,
		); // PROVES `remote prune` is a no-op here.

		// Route the item back to backlog so the next createJob's claim can
		// land, then call createJob again for the same slug.
		await rerouteToBacklogOnArbiter(seeded, 'epsilon');
		// Need a fresh claim for the next createJob — perform it from a
		// throwaway clone (cross-machine claim).
		const claimer = seeded.clone('claimer-epsilon');
		const claim = await performClaim({
			slug: 'epsilon',
			cwd: claimer,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);

		const job2 = createJob({
			fromRepo: seeded.repo,
			arbiter: ARBITER,
			slug: 'epsilon',
			workspacesDir,
			env: gitEnv(),
		});
		// FRESH cut: the prior attempt's file is NOT present on the worktree —
		// the arbiter-authoritative read overrides the orphan tracking ref.
		expect(job2.continued).toBe(false);
		expect(existsSync(join(job2.dir, 'prior.txt'))).toBe(false);
		job2.dispose();
	});
});

// =============================================================================
// LEGITIMATE CONTINUE STILL WORKS (no regression)
// =============================================================================

describe('legitimate continue still works when the arbiter GENUINELY has the kept branch', () => {
	it('in-place path: continues from the kept branch tip (prior commit present)', async () => {
		const {seeded} = await stuckButNeedsAttention('zeta');
		// Re-route the item back to backlog (cross-machine) so it is claimable;
		// the kept branch REMAINS on the arbiter (default keep+continue shape).
		await rerouteToBacklogOnArbiter(seeded, 'zeta');
		// A fresh continuer clone (cross-machine — no stale local refs).
		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug: 'zeta',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(true);
	});

	it('bare-mirror path: createJob continues from the kept branch tip', async () => {
		const {seeded} = await stuckButNeedsAttention('eta');
		const workspacesDir = join(scratch.root, '.agent-runner');
		const job = createJob({
			fromRepo: seeded.repo,
			arbiter: ARBITER,
			slug: 'eta',
			workspacesDir,
			env: gitEnv(),
		});
		expect(job.continued).toBe(true);
		expect(existsSync(join(job.dir, 'prior.txt'))).toBe(true);
	});
});

// =============================================================================
// WRITE-THROUGH at the OTHER delete sites (merge-reap, gc --remote-branches)
// =============================================================================

describe('write-through ordering also applies at the merged-branch reaper (`gc --remote-branches`)', () => {
	it('sweeping a merged remote branch drops the LOCAL tracking ref before the arbiter delete — no stale-ahead local store', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['theta']);
		const repo = seeded.repo;

		// Build a `work/task-theta` branch and FAST-FORWARD merge it into main
		// on the arbiter (so it is provably an ancestor of `<arbiter>/main`).
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/task-theta', `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'merged.txt'), 'merged work\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'merged work'], repo);
		gitIn(['push', '-q', ARBITER, 'work/task-theta:work/task-theta'], repo);
		gitIn(['push', '-q', ARBITER, 'work/task-theta:main'], repo);

		// Materialise the local tracking ref by fetching explicitly.
		gitIn(
			[
				'fetch',
				'-q',
				ARBITER,
				'+refs/heads/work/task-theta:refs/remotes/arbiter/work/task-theta',
				'+refs/heads/main:refs/remotes/arbiter/main',
			],
			repo,
		);
		const trackingRef = 'refs/remotes/arbiter/work/task-theta';
		expect(localRef(repo, trackingRef)).not.toBe('');

		// Sweep — the branch is provably merged, so it is reaped.
		const result = sweepRemoteMergedBranches({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.reaped.map((r) => r.branch)).toContain('work/task-theta');
		// LOCAL tracking ref is gone (write-through), arbiter branch is gone.
		expect(localRef(repo, trackingRef)).toBe('');
		expect(arbiterHasBranch(seeded, 'work/task-theta')).toBe(false);
	});
});
