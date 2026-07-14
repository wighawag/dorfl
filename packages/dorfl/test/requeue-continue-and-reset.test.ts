import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {acquireItemLock, markStuckItemLock} from '../src/item-lock.js';
import {createJob} from '../src/workspace.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	heldLockOnArbiter,
	stuckLockOnArbiter,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-requeue-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Drive a task all the way to needs-attention with a prior attempt's commit on
 * `work/<slug>` PUSHED to the arbiter (the durable artifact a requeue keeps):
 * claim → onboard → agent edits → route to needs-attention (push the branch to
 * the arbiter). Then requeue (default keep) back to backlog. Returns the seeded
 * handle so callers can make a FRESH clone and prove the next claim continues.
 */
async function stuckThenRequeued(
	slug: string,
	opts: {message?: string} = {},
): Promise<{seeded: SeededRepo; priorTip: string}> {
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
	// The build agent left work; commit it (the prior attempt's commit) and push
	// the branch to the arbiter (the durable artifact requeue keeps).
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	const priorTip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	gitIn(['push', '-q', ARBITER, `work/task-${slug}:work/task-${slug}`], repo);
	// Directly seed a STUCK per-item lock so `returnToBacklog` (requeue) has a stuck
	// lock to recover from. PR-2b (spec
	// `surface-stuck-as-questions-and-retire-stuck-lock-state`) retired the bounce's
	// `active → stuck` amend — a bounce now surfaces + RELEASES the lock — so we can
	// no longer drive a stuck lock via the bounce seam. `markStuckItemLock` is still
	// the direct primitive for the state and is exactly what a requeue's recovery
	// path targets. This test exercises that recovery, not the bounce itself.
	await markStuckItemLock({
		item: `task:${slug}`,
		reason: 'gate red on the first attempt',
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	const result = await returnToBacklog({
		cwd: repo,
		slug,
		arbiter: ARBITER,
		message: opts.message,
		env: gitEnv(),
	});
	expect(result.moved).toBe(true);
	return {seeded, priorTip};
}

describe('requeue default — keep + continue (in-place / start path)', () => {
	it('a subsequent claim CONTINUES from the kept branch tip (prior commit present)', async () => {
		const {seeded, priorTip} = await stuckThenRequeued('alpha');
		// A DIFFERENT machine's agent: a fresh clone of the arbiter.
		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug: 'alpha',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(started.branch).toBe('work/task-alpha');
		// The prior attempt's commit is present on the branch the claim landed on
		// (built ON the kept branch, NOT force-cut fresh off main). The continue
		// REBASES onto the current main, so the prior commit's CONTENT is present and
		// its log subject survives even though the rebase rewrites its SHA.
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(true);
		expect(readFileSync(join(fresh, 'prior.txt'), 'utf8')).toBe(
			'prior attempt work\n',
		);
		const log = gitIn(['log', '--format=%s', 'HEAD'], fresh);
		expect(log).toMatch(/prior attempt work/);
		// And it is NOT a fresh cut: the prior tip's TREE is reachable as content.
		void priorTip;
	});
});

describe('requeue default — REBASE onto fresh main at onboard-time', () => {
	it('replays the continued branch onto a main that moved while requeued', async () => {
		const {seeded} = await stuckThenRequeued('beta');
		// Main moves (non-conflicting) on the arbiter while the item sits requeued.
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'mainmoved.txt'), 'main moved\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved while requeued'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug: 'beta',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		// The continued branch was REPLAYED onto the moved main: BOTH the moved-main
		// file and the prior attempt's file are present on the work branch tip.
		expect(existsSync(join(fresh, 'mainmoved.txt'))).toBe(true);
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(true);
		// The work tip is a descendant of the NEW main (rebased onto it).
		expect(
			gitIn(['merge-base', '--is-ancestor', `${ARBITER}/main`, 'HEAD'], fresh),
		).toBe('');
	});

	it('a CONFLICTING continue rebase routes to needs-attention (never auto-resolves)', async () => {
		// Prior attempt edits shared.txt; then main edits shared.txt differently.
		const seeded = seedRepoWithArbiter(scratch.root, ['gamma']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/task-gamma', `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'shared.txt'), 'branch version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior edits shared'], repo);
		gitIn(['push', '-q', ARBITER, 'work/task-gamma:work/task-gamma'], repo);
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'gamma',
			reason: 'red',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		await returnToBacklog({
			cwd: repo,
			slug: 'gamma',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		// Main edits the SAME file differently (conflict on replay).
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main edits shared too'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug: 'gamma',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(1);
		expect(started.outcome).toBe('needs-attention');
		// The item is STUCK on its per-item lock (bounced, not auto-resolved); the
		// body rests in backlog/ but the held stuck lock makes it non-claimable.
		// PR-2b (spec surface-stuck-as-questions-and-retire-stuck-lock-state,
		// decision #1 / D1): a bounce no longer marks the lock stuck — it surfaces
		// a stuck-kind sidecar + needsAnswers:true on <arbiter>/main in one commit
		// then RELEASES the lock. Assert the A1 triple.
		expect(stuckLockOnArbiter(fresh, 'gamma')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(fresh, 'gamma')).toBe(true);
		expect(needsAnswersOnArbiterMain(fresh, 'gamma')).toBe(true);
		expect(existsOnArbiterMain(fresh, 'backlog', 'gamma')).toBe(true);
		expect(existsOnArbiterMain(fresh, 'needs-attention', 'gamma')).toBe(false);
	});
});

describe('requeue default — force-with-lease on the WORK branch only (never main)', () => {
	it('reconciles the already-pushed work tip after rebase; main is never force-pushed', async () => {
		const {seeded} = await stuckThenRequeued('delta');

		// Main moves so the continue rebase rewrites the work-branch SHAs.
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'mainmoved.txt'), 'moved\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);
		const mainAfterMove = arbiterRef(seeded, 'refs/heads/main');

		const beforeWork = arbiterRef(seeded, 'refs/heads/work/task-delta');
		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug: 'delta',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);

		// The arbiter's work/task-delta tip was UPDATED to the rebased tip (a lease-guarded
		// non-fast-forward), and it equals the local work tip after onboarding.
		const afterWork = arbiterRef(seeded, 'refs/heads/work/task-delta');
		expect(afterWork).not.toBe(beforeWork);
		expect(afterWork).toBe(gitIn(['rev-parse', 'HEAD'], fresh).trim());

		// main is NEVER force-pushed by the continue. main advances ONLY by the
		// claim's normal CAS (a fast-forward): the new arbiter main is a DESCENDANT
		// of the mover's main (the claim commit sits on top), never a rewrite of it.
		const mainAfterClaim = arbiterRef(seeded, 'refs/heads/main');
		expect(
			gitIn(
				['merge-base', '--is-ancestor', mainAfterMove, mainAfterClaim],
				fresh,
			),
		).toBe('');
	});
});

describe('requeue --reset — discard + fresh', () => {
	it('deletes the remote branch FIRST, then moves to backlog; next claim is FRESH', async () => {
		const reset = await stuckButNeedsAttention('zeta');
		// Sanity: the kept branch IS on the arbiter before --reset.
		expect(arbiterHasBranch(reset.seeded, 'work/task-zeta')).toBe(true);

		const result = await returnToBacklog({
			cwd: reset.repo,
			slug: 'zeta',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(result.deletedRemoteBranch).toBe(true);
		// The remote branch is GONE.
		expect(arbiterHasBranch(reset.seeded, 'work/task-zeta')).toBe(false);
		// The item is in backlog (the move happened AFTER the delete).
		expect(existsOnArbiterMain(reset.repo, 'backlog', 'zeta')).toBe(true);

		// The next claim starts FRESH (no prior commit) because the branch is gone.
		const fresh = reset.seeded.clone('fresh');
		const started = await performStart({
			slug: 'zeta',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(false);
	});

	it('a FAILED delete leaves the item in needs-attention (no backlog move)', async () => {
		const reset = await stuckButNeedsAttention('eta-reset');
		// Point --reset at a NON-EXISTENT arbiter remote. A tree-less requeue
		// CAS-publishes to the arbiter, so a missing remote is refused up front — the
		// item never moves (the no-backlog-move outcome this test guards is preserved).
		const result = await returnToBacklog({
			cwd: reset.repo,
			slug: 'eta-reset',
			arbiter: 'nonexistent-remote',
			reset: true,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		// A missing arbiter remote is refused up front (it is the CAS push target).
		expect(result.reasonNotMoved).toMatch(/no git remote named/i);
		// The item is STILL stuck (the lock was NOT released); body rests in backlog/.
		// This helper seeds the stuck lock directly via `markStuckItemLock` (see
		// `stuckButNeedsAttention` — PR-2b's bounce no longer produces a stuck lock),
		// so the stuck lock is the direct seed and we assert it directly.
		expect(heldLockOnArbiter(reset.repo, 'eta-reset')).toBe(true);
		expect(existsOnArbiterMain(reset.repo, 'backlog', 'eta-reset')).toBe(true);
	});
});

describe('requeue -m — handoff note (append-only, both modes)', () => {
	it('appends a dated handoff section to the item body', async () => {
		const reset = await stuckButNeedsAttention('theta-note');
		const result = await returnToBacklog({
			cwd: reset.repo,
			slug: 'theta-note',
			arbiter: ARBITER,
			message: 'watch out for the flaky integration test',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// The body lives on the arbiter (the tree-less move never wrote the cwd).
		const body = arbiterBacklogBody(reset.seeded, 'theta-note');
		expect(body).toMatch(/## Requeue \d{4}-\d{2}-\d{2}/);
		expect(body).toMatch(/watch out for the flaky integration test/);
	});

	it('accumulates notes across repeated requeues (append-only)', async () => {
		const reset = await stuckButNeedsAttention('iota-note');
		await returnToBacklog({
			cwd: reset.repo,
			slug: 'iota-note',
			arbiter: ARBITER,
			message: 'first steer',
			env: gitEnv(),
		});
		// Make it stuck again ON THE ARBITER (re-acquire + mark stuck), then requeue
		// again with a second note.
		await rerouteToNeedsAttentionOnArbiter(reset.seeded, 'iota-note');
		const result = await returnToBacklog({
			cwd: reset.repo,
			slug: 'iota-note',
			arbiter: ARBITER,
			message: 'second steer',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		const body = arbiterBacklogBody(reset.seeded, 'iota-note');
		expect(body).toMatch(/first steer/);
		expect(body).toMatch(/second steer/);
		// TWO requeue sections (append-only, never overwritten).
		const sections = body.match(/## Requeue \d{4}-\d{2}-\d{2}/g) ?? [];
		expect(sections.length).toBe(2);
	});

	it('applies on --reset too (a steer is relevant even when discarding)', async () => {
		const reset = await stuckButNeedsAttention('kappa-note');
		const result = await returnToBacklog({
			cwd: reset.repo,
			slug: 'kappa-note',
			arbiter: ARBITER,
			reset: true,
			message: 'reset because the approach was wrong; try X',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(result.deletedRemoteBranch).toBe(true);
		const body = arbiterBacklogBody(reset.seeded, 'kappa-note');
		expect(body).toMatch(/reset because the approach was wrong/);
	});
});

describe('requeue -m — STAGED (tasks/backlog/) item + non-fatal note (obs requeue-dash-m-strands-lock)', () => {
	// A staged item driven with --allow-backlog rests in tasks/backlog/, NOT the pool
	// tasks/ready/. The -m handoff note must find it there (mirroring --allow-backlog
	// resolution), AND a note that cannot land must NEVER strand the lock.

	it('appends the handoff note to a STAGED (tasks/backlog/) body and releases the lock', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, [], {
			staged: ['staged-m'],
		});
		const repo = seeded.repo;
		// Claim the STAGED body (--allow-backlog) and mark it stuck, so requeue has a
		// held lock to recover, exactly like the real backlog-drive recovery.
		const claim = await performClaim({
			slug: 'staged-m',
			cwd: repo,
			arbiter: ARBITER,
			allowBacklog: true,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		await markStuckItemLock({
			item: 'task:staged-m',
			reason: 'gate crash',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'staged-m',
			arbiter: ARBITER,
			reset: true,
			message: 'staged handoff: fix the prompt section',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		// The note landed on the STAGED body (tasks/backlog/), not tasks/ready/.
		const body = arbiterStagedBody(seeded, 'staged-m');
		expect(body).toMatch(/## Requeue \d{4}-\d{2}-\d{2}/);
		expect(body).toMatch(/staged handoff: fix the prompt section/);
		// The lock is RELEASED (the strand bug would leave it held).
		expect(stuckLockOnArbiter(repo, 'staged-m', ARBITER)).toBe(false);
	});

	it('a note that cannot land (body in neither ready/ nor backlog/) STILL releases the lock (non-fatal)', async () => {
		// Regression for the strand: the previous behaviour returned early on a failed
		// note and left the lock held. Seed a stuck lock whose body is NOT in either
		// claimable folder, so the note append finds nothing — the lock must still go.
		const seeded = seedRepoWithArbiter(scratch.root, ['orphan-note']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'orphan-note',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		await markStuckItemLock({
			item: 'task:orphan-note',
			reason: 'stuck',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		// Remove the body from the pool on the arbiter so the note has nowhere to land.
		const mover = seeded.clone('drop-body-orphan-note');
		gitIn(['rm', '-q', 'work/tasks/ready/orphan-note.md'], mover);
		gitIn(['commit', '-q', '-m', 'drop body'], mover);
		gitIn(['push', '-q', 'origin', 'HEAD:main'], mover);

		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'orphan-note',
			arbiter: ARBITER,
			reset: true,
			message: 'this note cannot be placed',
			env: gitEnv(),
			note: (m) => notes.push(m),
		});
		// The requeue still recovered the item: lock RELEASED despite the failed note.
		expect(result.moved).toBe(true);
		expect(stuckLockOnArbiter(repo, 'orphan-note', ARBITER)).toBe(false);
		// And it warned (rather than silently swallowing) that the note was skipped.
		expect(
			notes.some((n) => /could not append the -m handoff note/.test(n)),
		).toBe(true);
	});
});

describe('requeue continue — JOB-WORKTREE path (createJob)', () => {
	it('cuts the worktree from the kept arbiter branch and clearStale does not nuke it', async () => {
		const {seeded} = await stuckThenRequeued('lambda');
		const workspacesDir = join(scratch.root, '.dorfl');
		const job = createJob({
			fromRepo: seeded.repo,
			arbiter: ARBITER,
			slug: 'lambda',
			workspacesDir,
			env: gitEnv(),
		});
		expect(job.continued).toBe(true);
		expect(job.continueRebaseConflict).toBe(false);
		// The worktree was cut from the kept branch: the prior attempt's file is in
		// the worktree (NOT a fresh cut off main, which would lack it).
		expect(existsSync(join(job.dir, 'prior.txt'))).toBe(true);
		// clearStale did not nuke the continued branch: it is checked out + present.
		expect(gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], job.dir).trim()).toBe(
			'work/task-lambda',
		);
	});

	it('rebases the continued worktree branch onto a moved main', async () => {
		const {seeded} = await stuckThenRequeued('mu');
		// Main moves (non-conflicting) on the arbiter.
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'mainmoved.txt'), 'moved\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const workspacesDir = join(scratch.root, '.dorfl');
		const job = createJob({
			fromRepo: seeded.repo,
			arbiter: ARBITER,
			slug: 'mu',
			workspacesDir,
			env: gitEnv(),
		});
		expect(job.continued).toBe(true);
		expect(job.continueRebaseConflict).toBe(false);
		// Both the moved-main file and the prior attempt's file are present (replayed).
		expect(existsSync(join(job.dir, 'mainmoved.txt'))).toBe(true);
		expect(existsSync(join(job.dir, 'prior.txt'))).toBe(true);
	});

	it('the continue rebase + worktree switch is NOT wedged by the per-job record (out-of-tree ⇒ invisible to git)', async () => {
		// Regression for the continue-rebase WEDGE: when the per-job record lived
		// INSIDE the worktree, a re-create's `git switch`/rebase could fail with
		// "local changes to .dorfl-job.json would be overwritten by checkout".
		// With the record relocated to a sibling OUTSIDE the tree, the switch + rebase
		// onto a MOVED main succeed and the worktree stays clean (no record line in
		// `git status`).
		const {seeded} = await stuckThenRequeued('xi');
		// Main moves so the onboard CONTINUE must `git switch` onto the kept branch
		// and rebase it onto fresh main (the exact step the in-tree record wedged).
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'mainmoved.txt'), 'moved\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const workspacesDir = join(scratch.root, '.dorfl');
		const job = createJob({
			fromRepo: seeded.repo,
			arbiter: ARBITER,
			slug: 'xi',
			workspacesDir,
			env: gitEnv(),
		});
		// The continue did NOT wedge: it rebased cleanly onto the moved main.
		expect(job.continued).toBe(true);
		expect(job.continueRebaseConflict).toBe(false);
		expect(existsSync(join(job.dir, 'mainmoved.txt'))).toBe(true);
		expect(existsSync(join(job.dir, 'prior.txt'))).toBe(true);
		// The record exists but is OUTSIDE the worktree, so `git status` is clean —
		// nothing in the tree for the switch/rebase to refuse to overwrite.
		expect(existsSync(`${job.dir}.json`)).toBe(true);
		expect(existsSync(join(job.dir, '.dorfl-job.json'))).toBe(false);
		const status = gitIn(['status', '--porcelain'], job.dir).trim();
		expect(status).toBe('');
	});

	it('pushes the rebased continued tip to the arbiter (the green work lands, PR can open)', async () => {
		const {seeded} = await stuckThenRequeued('nu');
		// Main moves on the arbiter while requeued, so the onboard rebase rewrites the
		// work-branch SHAs and the continue path must reconcile the arbiter tip.
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'mainmoved.txt'), 'moved\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const beforeWork = arbiterRef(seeded, 'refs/heads/work/task-nu');
		const workspacesDir = join(scratch.root, '.dorfl');
		const job = createJob({
			fromRepo: seeded.repo,
			arbiter: ARBITER,
			slug: 'nu',
			workspacesDir,
			env: gitEnv(),
		});
		expect(job.continued).toBe(true);
		expect(job.continueRebaseConflict).toBe(false);
		// The arbiter's work tip was UPDATED to the rebased worktree HEAD (a
		// lease-guarded reconcile) — the green work is on the arbiter, not stranded.
		const afterWork = arbiterRef(seeded, 'refs/heads/work/task-nu');
		expect(afterWork).not.toBe(beforeWork);
		expect(afterWork).toBe(gitIn(['rev-parse', 'HEAD'], job.dir).trim());
	});
});

// --- helpers ---------------------------------------------------------------

/**
 * A stuck item left IN needs-attention (NOT yet requeued), with a prior attempt's
 * commit on `work/<slug>` PUSHED to the arbiter and the item surfaced in
 * needs-attention/ on main. Used to exercise `returnToBacklog`'s --reset / -m
 * directly on a needs-attention item.
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
	// Seed a STUCK lock directly (PR-2b retired the bounce's `active → stuck`
	// amend). See the `stuckThenRequeued` helper for the same reasoning.
	await markStuckItemLock({
		item: `task:${slug}`,
		reason: 'gate red',
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	return {seeded, repo};
}

/** The arbiter's sha for a full ref (e.g. `refs/heads/work/<slug>`), or ''. */
function arbiterRef(seeded: SeededRepo, ref: string): string {
	const out = gitIn(
		['ls-remote', `file://${seeded.arbiter}`, ref],
		seeded.repo,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

/** Does the arbiter currently have the given branch? */
function arbiterHasBranch(seeded: SeededRepo, branch: string): boolean {
	return arbiterRef(seeded, `refs/heads/${branch}`) !== '';
}

/**
 * Read a backlog item's body from the ARBITER's `main` (the durable home the
 * tree-less requeue writes — never the cwd tree), via a fresh clone.
 */
function arbiterBacklogBody(seeded: SeededRepo, slug: string): string {
	const reader = seeded.clone(`read-${slug}`);
	return readFileSync(
		join(reader, 'work', 'tasks', 'ready', `${slug}.md`),
		'utf8',
	);
}

/**
 * Read a STAGED item's body from the ARBITER's `main` (`work/tasks/backlog/`, the
 * staging folder a --allow-backlog-driven item rests in) via a fresh clone.
 */
function arbiterStagedBody(seeded: SeededRepo, slug: string): string {
	const reader = seeded.clone(`read-staged-${slug}`);
	return readFileSync(
		join(reader, 'work', 'tasks', 'backlog', `${slug}.md`),
		'utf8',
	);
}

/**
 * Make a requeued item STUCK AGAIN on its per-item lock (the cross-machine
 * analogue of "it got stuck again"), in a throwaway clone so the cwd tree under
 * test is untouched: re-acquire the lock + mark it stuck. Used to drive a second
 * requeue and prove the handoff notes ACCUMULATE on the backlog body.
 */
async function rerouteToNeedsAttentionOnArbiter(
	seeded: SeededRepo,
	slug: string,
): Promise<void> {
	const mover = seeded.clone(`reroute-${slug}`);
	await acquireItemLock({
		item: `task:${slug}`,
		action: 'implement',
		cwd: mover,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	await markStuckItemLock({
		item: `task:${slug}`,
		reason: 'stuck again',
		cwd: mover,
		arbiter: ARBITER,
		env: gitEnv(),
	});
}
