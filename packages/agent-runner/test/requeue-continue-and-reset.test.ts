import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
import {performStart} from '../src/start.js';
import {createJob} from '../src/workspace.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-requeue-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Drive a slice all the way to needs-attention with a prior attempt's commit on
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
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	// The build agent left work; commit it (the prior attempt's commit) and push
	// the branch to the arbiter (the durable artifact requeue keeps).
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	const priorTip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	gitIn(['push', '-q', ARBITER, `work/slice-${slug}:work/slice-${slug}`], repo);
	// Route to needs-attention THROUGH the seam (surfaces it on the arbiter's main,
	// mode M) so the item is in needs-attention/ on main, cross-machine visible.
	await ledgerWrite.applyNeedsAttentionTransition({
		cwd: repo,
		slug,
		reason: 'gate red on the first attempt',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	// The seam pushed the surface to main; sync LOCAL main to the surface (as a
	// human's checkout would be on main) so the requeue's push HEAD lands on main.
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
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
		expect(started.branch).toBe('work/slice-alpha');
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
		gitIn(['switch', '-q', '-c', 'work/slice-gamma', `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'shared.txt'), 'branch version\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'prior edits shared'], repo);
		gitIn(['push', '-q', ARBITER, 'work/slice-gamma:work/slice-gamma'], repo);
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
		// The item is surfaced on the arbiter's main in needs-attention/ (bounced,
		// not auto-resolved), and it is NO longer claimable from backlog.
		expect(existsOnArbiterMain(fresh, 'needs-attention', 'gamma')).toBe(true);
		expect(existsOnArbiterMain(fresh, 'backlog', 'gamma')).toBe(false);
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

		const beforeWork = arbiterRef(seeded, 'refs/heads/work/slice-delta');
		const fresh = seeded.clone('continuer');
		const started = await performStart({
			slug: 'delta',
			cwd: fresh,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(started.exitCode).toBe(0);

		// The arbiter's work/slice-delta tip was UPDATED to the rebased tip (a lease-guarded
		// non-fast-forward), and it equals the local work tip after onboarding.
		const afterWork = arbiterRef(seeded, 'refs/heads/work/slice-delta');
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
		expect(arbiterHasBranch(reset.seeded, 'work/slice-zeta')).toBe(true);

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
		expect(arbiterHasBranch(reset.seeded, 'work/slice-zeta')).toBe(false);
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
		// The item is STILL in needs-attention on the arbiter (no backlog move).
		expect(
			existsOnArbiterMain(reset.repo, 'needs-attention', 'eta-reset'),
		).toBe(true);
		expect(existsOnArbiterMain(reset.repo, 'backlog', 'eta-reset')).toBe(false);
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
		// Re-route back to needs-attention ON THE ARBITER (the move lives there now,
		// not in the cwd tree), then requeue again with a second note.
		rerouteToNeedsAttentionOnArbiter(reset.seeded, 'iota-note');
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

describe('requeue continue — JOB-WORKTREE path (createJob)', () => {
	it('cuts the worktree from the kept arbiter branch and clearStale does not nuke it', async () => {
		const {seeded} = await stuckThenRequeued('lambda');
		const workspacesDir = join(scratch.root, '.agent-runner');
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
			'work/slice-lambda',
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

		const workspacesDir = join(scratch.root, '.agent-runner');
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

		const beforeWork = arbiterRef(seeded, 'refs/heads/work/slice-nu');
		const workspacesDir = join(scratch.root, '.agent-runner');
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
		const afterWork = arbiterRef(seeded, 'refs/heads/work/slice-nu');
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
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	gitIn(['push', '-q', ARBITER, `work/slice-${slug}:work/slice-${slug}`], repo);
	await ledgerWrite.applyNeedsAttentionTransition({
		cwd: repo,
		slug,
		reason: 'gate red',
		arbiter: ARBITER,
		env: gitEnv(),
	});
	// Bring main's surfaced needs-attention state into the working tree so the
	// item file is present locally (the requeue move operates on the tree); land
	// on local main (as a human's checkout would be) so push HEAD lands on main.
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-B', 'main', `${ARBITER}/main`], repo);
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
	return readFileSync(join(reader, 'work', 'backlog', `${slug}.md`), 'utf8');
}

/**
 * Re-route a requeued item BACK to needs-attention/ on the arbiter's `main`
 * (backlog → needs-attention), in a throwaway clone so the cwd tree under test is
 * untouched — the cross-machine analogue of "it got stuck again". Used to drive a
 * second requeue and prove the handoff notes ACCUMULATE.
 */
function rerouteToNeedsAttentionOnArbiter(
	seeded: SeededRepo,
	slug: string,
): void {
	const mover = seeded.clone(`reroute-${slug}`);
	gitIn(['fetch', '-q', ARBITER], mover);
	gitIn(['checkout', '-q', '-B', 'reroute', `${ARBITER}/main`], mover);
	// `git mv` needs the destination dir to exist (it does not auto-create).
	mkdirSync(join(mover, 'work', 'needs-attention'), {recursive: true});
	gitIn(
		['mv', `work/backlog/${slug}.md`, `work/needs-attention/${slug}.md`],
		mover,
	);
	gitIn(['add', '-A'], mover);
	gitIn(['commit', '-q', '-m', `back to NA: ${slug}`], mover);
	gitIn(['push', '-q', ARBITER, 'reroute:main'], mover);
}
