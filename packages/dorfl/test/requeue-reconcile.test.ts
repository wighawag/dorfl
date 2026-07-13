import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
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

/**
 * Task: `requeue-reconcile-nondestructive-recovery-verb`. Pins the new
 * non-destructive `requeue --reconcile` verb (the middle rung between the
 * default keep+continue and the destructive `--reset`) + the re-ordering of the
 * continue-conflict messages so they LEAD with `--reconcile` and mention
 * `--reset` LAST as the destructive last resort.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-reconcile-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** The arbiter's sha for a full ref (e.g. `refs/heads/work/task-<slug>`), or ''. */
function arbiterRef(seeded: SeededRepo, ref: string): string {
	const out = gitIn(
		['ls-remote', `file://${seeded.arbiter}`, ref],
		seeded.repo,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

/**
 * Drive a task to a lock-stuck state with a prior attempt's `work/task-<slug>`
 * PUSHED to the arbiter — the fixture on which `--reconcile` is meaningful.
 * Optionally have `main` move on the arbiter after the branch push, so the
 * rebase-onto-fresh-main is a REAL operation (non-conflicting when
 * `mainConflicts=false`, conflicting on the same file when `true`).
 */
async function stuckWithKeptBranch(
	slug: string,
	opts: {mainMoves?: boolean; mainConflicts?: boolean} = {},
): Promise<{seeded: SeededRepo; repo: string; priorTip: string}> {
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
	writeFileSync(
		join(repo, opts.mainConflicts ? 'shared.txt' : 'prior.txt'),
		'prior attempt work\n',
	);
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	const priorTip = gitIn(['rev-parse', 'HEAD'], repo).trim();
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

	if (opts.mainMoves) {
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		if (opts.mainConflicts) {
			writeFileSync(join(mover, 'shared.txt'), 'main version\n');
		} else {
			writeFileSync(join(mover, 'mainmoved.txt'), 'main moved\n');
		}
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main moved while requeued'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);
	}
	return {seeded, repo, priorTip};
}

describe('requeue --reconcile — success (rebase clean after mirror re-sync)', () => {
	it('re-syncs the mirror, rebases the kept branch, pushes the reconciled tip back, and releases the lock', async () => {
		const {seeded, repo, priorTip} = await stuckWithKeptBranch('alpha', {
			mainMoves: true,
			mainConflicts: false,
		});
		const beforeWork = arbiterRef(seeded, 'refs/heads/work/task-alpha');
		expect(beforeWork).toBe(priorTip);

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			reconcile: true,
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		expect(result.reconciled).toBe(true);
		expect(result.deletedRemoteBranch).toBeFalsy();
		// Item is claimable: body in backlog, lock released.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		// The kept branch is PRESERVED on the arbiter (never deleted), and its tip
		// is the REBASED tip (not the pre-rebase priorTip).
		const afterWork = arbiterRef(seeded, 'refs/heads/work/task-alpha');
		expect(afterWork).not.toBe('');
		expect(afterWork).not.toBe(priorTip);
		// The next claim continues from the reconciled tip cleanly.
		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug: 'alpha',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		// Both the moved-main file and the prior attempt's file are present on the
		// continued branch tip (the reconcile pushed the rebased content back).
		expect(existsSync(join(fresh, 'mainmoved.txt'))).toBe(true);
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(true);
	});
});

describe('requeue --reconcile — genuine content conflict after mirror re-sync', () => {
	it('leaves the item stuck, leaves the branch UNTOUCHED, and emits a message that LEADS with what was tried and mentions --reset LAST', async () => {
		const {seeded, repo, priorTip} = await stuckWithKeptBranch('bravo', {
			mainMoves: true,
			mainConflicts: true,
		});
		expect(arbiterRef(seeded, 'refs/heads/work/task-bravo')).toBe(priorTip);

		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'bravo',
			arbiter: ARBITER,
			reconcile: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.moved).toBe(false);
		expect(result.reconciled).toBeFalsy();
		const message = result.reasonNotMoved ?? '';
		// The message reports the retry HAPPENED (the mirror was re-synced), the
		// conflict is on genuine content, the deferred follow-on is referenced, and
		// `--reset` is mentioned LAST (framed as the destructive last resort).
		expect(message).toMatch(/re-synced the arbiter mirror/i);
		expect(message).toMatch(/RETRIED the rebase/i);
		expect(message).toMatch(/genuine content/i);
		expect(message).toMatch(/left UNTOUCHED/i);
		expect(message).toMatch(/rebase-conflict-on-continue/);
		expect(message).toMatch(/LAST RESORT/);
		expect(message).toMatch(/DESTRUCTIVELY/);
		// Ordering: `--reset` appears AFTER "LAST RESORT" and AFTER the deferred
		// follow-on hint — the destructive escape is the tail, not the headline.
		const idxReset = message.indexOf('`requeue --reset`');
		const idxDeferred = message.search(/deferred|planned but not yet built/);
		expect(idxReset).toBeGreaterThan(-1);
		expect(idxDeferred).toBeGreaterThan(-1);
		expect(idxReset).toBeGreaterThan(idxDeferred);
		// The lock is STILL held (item stays stuck).
		expect(stuckLockOnArbiter(repo, 'bravo')).toBe(true);
		// The branch is UNTOUCHED on the arbiter (nothing deleted, tip unchanged).
		expect(arbiterRef(seeded, 'refs/heads/work/task-bravo')).toBe(priorTip);
	});
});

describe('requeue default (no flag) — regression: no work branch still succeeds as a fresh-claim move', () => {
	it('a stuck item with no arbiter work branch is requeued as a fresh claim (no --reset needed)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['charlie']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'charlie',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'charlie',
			reason: 'gate red before any push',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		// No work branch on the arbiter (never pushed).
		expect(arbiterRef(seeded, 'refs/heads/work/task-charlie')).toBe('');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'charlie',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(result.deletedRemoteBranch).toBeFalsy();
		expect(result.reconciled).toBeFalsy();
		expect(stuckLockOnArbiter(repo, 'charlie')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'charlie')).toBe(true);
	});
});

describe('do --isolated continue-conflict message — LEADS with --reconcile and mentions --reset LAST', () => {
	it('the reason recorded on the stuck lock names --reconcile before --reset (non-destructive first)', async () => {
		// Reproduce the continue-conflict scenario: prior attempt + main both edit
		// the SAME file, so the onboard rebase in the continuer conflicts and is
		// routed to needs-attention with the reason we assert on.
		const seeded = seedRepoWithArbiter(scratch.root, ['delta']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'delta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/task-delta', `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'shared.txt'), 'branch version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior edits shared'], repo);
		gitIn(['push', '-q', ARBITER, 'work/task-delta:work/task-delta'], repo);
		await ledgerWrite.applyNeedsAttentionTransition({
			cwd: repo,
			slug: 'delta',
			reason: 'red',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
		await returnToBacklog({
			cwd: repo,
			slug: 'delta',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		// Main edits the SAME file differently on the arbiter → continue rebase
		// conflicts.
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'shared.txt'), 'main version\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'main edits shared too'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug: 'delta',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(1);
		expect(started.outcome).toBe('needs-attention');
		// The reason recorded on the stuck lock LEADS with the non-destructive
		// recovery (`--reconcile`) and only mentions `--reset` LAST as the
		// destructive last resort.
		const lock = await readItemLock({
			item: 'task:delta',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(lock).toBeDefined();
		const reason = lock?.reason ?? '';
		expect(reason).toMatch(/requeue --reconcile/);
		expect(reason).toMatch(/requeue --reset/);
		const idxReconcile = reason.indexOf('requeue --reconcile');
		const idxReset = reason.indexOf('requeue --reset');
		expect(idxReconcile).toBeGreaterThan(-1);
		expect(idxReset).toBeGreaterThan(idxReconcile);
		expect(reason).toMatch(/non-destructive/i);
		expect(reason).toMatch(/DESTRUCTIVELY/);
		void readFileSync; // silence unused-import lint on this file
	});
});
