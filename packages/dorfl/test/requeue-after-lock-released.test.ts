import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	existsSync,
	mkdirSync,
	chmodSync,
	readFileSync,
} from 'node:fs';
import {parseSidecar, serialiseSidecar} from '../src/sidecar.js';
import {spawnSync} from 'node:child_process';
import {parseFrontmatter} from '../src/frontmatter.js';
import {join} from 'node:path';
import {
	returnToBacklog,
	surfaceStuckToNeedsAttention,
} from '../src/needs-attention.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {readItemLock} from '../src/item-lock.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	heldLockOnArbiter,
	sidecarSurfacedOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * Task: `requeue-reset-and-reconcile-work-after-the-lock-was-released`. A
 * SURFACE (`surfaceStuckToNeedsAttention`) releases the per-item lock after it
 * lands the question sidecar, so a surfaced item with a kept work branch has NO
 * held lock. `requeue --reset` and `requeue --reconcile` must still act on it
 * (taking a short lock of their own), while plain `requeue` stays a no-op and
 * the refusal for a truly unknown slug is unchanged. Tested against a local
 * `--bare` arbiter.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-requeue-released-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** The arbiter's sha for a full ref, or '' when absent. */
function arbiterRef(seeded: SeededRepo, ref: string): string {
	const out = gitIn(
		['ls-remote', `file://${seeded.arbiter}`, ref],
		seeded.repo,
	);
	const line = out.split('\n').find((l) => l.trim() !== '');
	return line ? line.split('\t')[0].trim() : '';
}

/**
 * Claim `slug`, push a prior attempt's `work/task-<slug>` to the arbiter, then
 * SURFACE it through the real surface primitive (sidecar + `needsAnswers`, lock
 * RELEASED). Optionally move `main` afterwards (non-conflicting, or conflicting
 * on the same file the branch edited).
 */
async function surfacedWithKeptBranch(
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
	gitIn(['switch', '-q', '--detach', `${ARBITER}/main`], repo);

	const surfaced = await surfaceStuckToNeedsAttention({
		cwd: repo,
		slug,
		reason: 'continue rebase conflicted',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(surfaced.surfaced).toBe(true);
	expect(surfaced.released).toBe(true);
	// The motivating state: surfaced, lock RELEASED, kept branch on the arbiter.
	expect(heldLockOnArbiter(repo, slug)).toBe(false);
	expect(sidecarSurfacedOnArbiterMain(repo, slug)).toBe(true);
	expect(arbiterRef(seeded, `refs/heads/work/task-${slug}`)).toBe(priorTip);

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
		gitIn(['commit', '-q', '-m', 'main moved after the surface'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);
	}
	return {seeded, repo, priorTip};
}

describe('requeue --reset on a surfaced item whose lock the surface already released', () => {
	it('deletes the kept remote branch and leaves the item claimable from scratch', async () => {
		const {seeded, repo} = await surfacedWithKeptBranch('alpha');

		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.moved).toBe(true);
		expect(result.deletedRemoteBranch).toBe(true);
		expect(notes.join('\n')).toMatch(/short lock/);
		// The kept branch is GONE on the arbiter.
		expect(arbiterRef(seeded, 'refs/heads/work/task-alpha')).toBe('');
		// The short lock the recovery took is released; the body rests in the pool.
		expect(heldLockOnArbiter(repo, 'alpha')).toBe(false);
		expect(
			await readItemLock({
				item: 'task:alpha',
				cwd: repo,
				arbiter: ARBITER,
				env: gitEnv(),
			}),
		).toBeUndefined();
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);

		// The next claim starts FRESH: nothing of the prior attempt is carried over.
		const fresh = seeded.clone('fresh');
		const started = await performStart({
			slug: 'alpha',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);
		expect(existsSync(join(fresh, 'prior.txt'))).toBe(false);
	});
});

describe('requeue --reconcile on a surfaced item whose lock the surface already released', () => {
	it('re-syncs and retries the rebase, pushing the reconciled tip back without discarding work', async () => {
		const {seeded, repo, priorTip} = await surfacedWithKeptBranch('bravo', {
			mainMoves: true,
		});

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'bravo',
			arbiter: ARBITER,
			reconcile: true,
			env: gitEnv(),
		});

		expect(result.moved).toBe(true);
		expect(result.reconciled).toBe(true);
		expect(result.deletedRemoteBranch).toBeFalsy();
		// The kept branch is PRESERVED, rebased onto the moved main.
		const afterWork = arbiterRef(seeded, 'refs/heads/work/task-bravo');
		expect(afterWork).not.toBe('');
		expect(afterWork).not.toBe(priorTip);
		const mainTip = arbiterRef(seeded, 'refs/heads/main');
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['merge-base', '--is-ancestor', mainTip, afterWork], repo);
		const files = gitIn(['ls-tree', '--name-only', afterWork], repo);
		expect(files).toMatch(/prior\.txt/);
		expect(files).toMatch(/mainmoved\.txt/);
		// The short lock is released again; the surfaced question is untouched.
		expect(heldLockOnArbiter(repo, 'bravo')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'bravo')).toBe(true);
	});

	it('on a genuine conflict leaves the branch UNTOUCHED and gives the short lock back', async () => {
		const {seeded, repo, priorTip} = await surfacedWithKeptBranch('charlie', {
			mainMoves: true,
			mainConflicts: true,
		});

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'charlie',
			arbiter: ARBITER,
			reconcile: true,
			env: gitEnv(),
		});

		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/RETRIED the rebase/);
		expect(result.reasonNotMoved).toMatch(/short recovery lock .* released/);
		expect(arbiterRef(seeded, 'refs/heads/work/task-charlie')).toBe(priorTip);
		// Back to exactly the released, surfaced state.
		expect(heldLockOnArbiter(repo, 'charlie')).toBe(false);
		expect(sidecarSurfacedOnArbiterMain(repo, 'charlie')).toBe(true);
	});
});

describe('plain requeue and unknown slugs with no held lock', () => {
	it('plain requeue on a surfaced item stays a no-op, keeps the branch, and names --reconcile/--reset', async () => {
		const {seeded, repo, priorTip} = await surfacedWithKeptBranch('delta');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'delta',
			arbiter: ARBITER,
			env: gitEnv(),
		});

		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/no held per-item lock/);
		expect(result.reasonNotMoved).toMatch(/next claim continues from it/);
		expect(result.reasonNotMoved).toMatch(/requeue --reconcile/);
		expect(result.reasonNotMoved).toMatch(/requeue --reset/);
		expect(arbiterRef(seeded, 'refs/heads/work/task-delta')).toBe(priorTip);
		expect(heldLockOnArbiter(repo, 'delta')).toBe(false);
	});

	it('the refusal for a truly unknown slug is unchanged (for --reset and --reconcile too)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['echo']);
		const expected =
			"'ghost' has no held per-item lock on arbiter \u2014 nothing to requeue " +
			'(wrong slug, or already at rest in backlog/done?). requeue recovers a ' +
			'task whose lock is held stuck (needs-attention) or active (a killed ' +
			'in-progress run).';
		for (const flags of [{}, {reset: true}, {reconcile: true}]) {
			const result = await returnToBacklog({
				cwd: seeded.repo,
				slug: 'ghost',
				arbiter: ARBITER,
				env: gitEnv(),
				...flags,
			});
			expect(result.moved).toBe(false);
			expect(result.reasonNotMoved).toBe(expected);
		}
		expect(heldLockOnArbiter(seeded.repo, 'ghost')).toBe(false);
	});
});

describe('requeue -m on a surfaced item whose lock the surface already released', () => {
	function showOnMain(repo: string, path: string): string | undefined {
		gitIn(['fetch', '-q', ARBITER], repo);
		const res = spawnSync('git', ['show', `${ARBITER}/main:${path}`], {
			cwd: repo,
			env: gitEnv(),
			encoding: 'utf8',
		});
		return res.status === 0 ? res.stdout : undefined;
	}

	it('answers the surfaced question with the note, applies it, and the next start continues', async () => {
		const {seeded, repo, priorTip} = await surfacedWithKeptBranch('foxtrot');

		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'foxtrot',
			arbiter: ARBITER,
			message: 'The ports were busy; just retry.',
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.reasonNotMoved).toBeUndefined();
		expect(result.moved).toBe(true);
		expect(result.handoffNoteDeliveredTo).toBe('main-answer');
		expect(notes.join('\n')).toMatch(/answered its surfaced question/);
		// Resolved on main: no sidecar, needsAnswers cleared, the note recorded
		// both as the applied answer and as the handoff the continue prompt reads.
		expect(sidecarSurfacedOnArbiterMain(repo, 'foxtrot')).toBe(false);
		const body = showOnMain(repo, 'work/tasks/ready/foxtrot.md')!;
		expect(parseFrontmatter(body).needsAnswers).not.toBe(true);
		expect(body).toMatch(/^## Applied answers/m);
		expect(body).toMatch(/^## Requeue \d{4}-\d{2}-\d{2}$/m);
		expect(body.match(/The ports were busy; just retry\./g)).toHaveLength(2);
		// The kept branch is untouched and the lock is not left held.
		expect(arbiterRef(seeded, 'refs/heads/work/task-foxtrot')).toBe(priorTip);
		expect(heldLockOnArbiter(repo, 'foxtrot')).toBe(false);

		const next = seeded.clone('next');
		const started = await performStart({
			slug: 'foxtrot',
			cwd: next,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.outcome).toBe('started');
		expect(started.message).toMatch(/continued/);
		expect(existsSync(join(next, 'prior.txt'))).toBe(true);
	});

	it('a released item that is not surfaced gets the plain note on main', async () => {
		const {seeded, repo} = await surfacedWithKeptBranch('golf');
		// Answer + apply by hand first, so the item is released but no longer surfaced.
		const first = await returnToBacklog({
			cwd: repo,
			slug: 'golf',
			arbiter: ARBITER,
			message: 'first',
			env: gitEnv(),
		});
		expect(first.handoffNoteDeliveredTo).toBe('main-answer');

		const second = await returnToBacklog({
			cwd: repo,
			slug: 'golf',
			arbiter: ARBITER,
			message: 'second thoughts',
			env: gitEnv(),
		});
		expect(second.moved).toBe(true);
		expect(second.handoffNoteDeliveredTo).toBe('main');
		const body = showOnMain(repo, 'work/tasks/ready/golf.md')!;
		expect(body).toContain('second thoughts');
		expect(arbiterRef(seeded, 'refs/heads/work/task-golf')).not.toBe('');
	});
});

describe('requeue -m: a failing answer path never strands the lock or loses the note', () => {
	it('a commit hook that refuses the answer commit degrades to the plain note on main', async () => {
		const {repo} = await surfacedWithKeptBranch('hotel');
		// The answer path commits in a scratch worktree of THIS repo, so the
		// repo's own hooks run there; make the commit fail.
		const hooks = join(repo, '.git', 'hooks');
		mkdirSync(hooks, {recursive: true});
		writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n');
		chmodSync(join(hooks, 'pre-commit'), 0o755);

		const notes: string[] = [];
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'hotel',
			arbiter: ARBITER,
			message: 'retry please',
			env: gitEnv(),
			note: (m) => notes.push(m),
		});

		expect(result.moved).toBe(true);
		expect(result.handoffNoteDeliveredTo).toBe('main');
		expect(notes.join('\n')).toMatch(/could not answer its surfaced question/);
		// The lock (the short one this requeue took) is not left held.
		expect(heldLockOnArbiter(repo, 'hotel')).toBe(false);
		// The question stays open; the note reached the body.
		expect(sidecarSurfacedOnArbiterMain(repo, 'hotel')).toBe(true);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(
			gitIn(['show', `${ARBITER}/main:work/tasks/ready/hotel.md`], repo),
		).toContain('retry please');
	});
});

describe('a re-bounce of an item surfaced with the pre-0.16.1 question wording', () => {
	it('is recognised as already surfaced (no duplicate entry)', async () => {
		const {seeded, repo} = await surfacedWithKeptBranch('india');
		// Rewrite the surfaced question to the old em-dash wording on main.
		const old = seeded.clone('legacy');
		const path = join(old, 'work', 'questions', 'task-india.md');
		const model = parseSidecar(readFileSync(path, 'utf8'));
		writeFileSync(
			path,
			serialiseSidecar({
				...model,
				entries: model.entries.map((e) => ({
					...e,
					question: "'task:india' was bounced \u2014 how should we proceed?",
				})),
			}),
		);
		gitIn(['commit', '-qam', 'legacy wording'], old);
		gitIn(['push', '-q', ARBITER, 'HEAD:main'], old);

		const again = await surfaceStuckToNeedsAttention({
			cwd: repo,
			slug: 'india',
			reason: 'continue rebase conflicted',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(again.surfaced).toBe(true);
		gitIn(['fetch', '-q', ARBITER], repo);
		const after = parseSidecar(
			gitIn(['show', `${ARBITER}/main:work/questions/task-india.md`], repo),
		);
		expect(after.entries).toHaveLength(1);
	});
});
