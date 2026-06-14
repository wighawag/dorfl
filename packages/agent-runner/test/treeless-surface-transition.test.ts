import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {surfaceToNeedsAttention} from '../src/needs-attention.js';
import {ledgerWrite} from '../src/ledger-write.js';
import {performClaim} from '../src/claim-cas.js';
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
	scratch = makeScratch('agent-runner-treeless-surface-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Drive a slice to the AFTER-COMMIT continue state on the arbiter ONLY: claim it
 * (so the item is in `in-progress/` on `<arbiter>/main`) and push its kept
 * `work/slice-<slug>` branch (the already-committed, recoverable work), then
 * leave the cwd working tree on the ORIGINAL seed `main` (which does NOT track the
 * surfaced state). A test can then prove `surfaceToNeedsAttention` does its move
 * WITHOUT reading or writing that tree.
 */
async function claimedOnArbiterOnly(
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
	// Push the kept (already-committed) work branch to the arbiter — the
	// recoverable artifact the after-commit surface leaves intact.
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'committed.txt'), 'already committed work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'already committed work'], repo);
	gitIn(['push', '-q', ARBITER, `work/slice-${slug}:work/slice-${slug}`], repo);
	// Leave the cwd on the original seed main (it never checks out the surfaced
	// state), so the surface must read the arbiter, not the cwd tree.
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-f', 'main'], repo);
	return {seeded, repo};
}

/** The commit shas reachable from `<arbiter>/main` (newest first). */
function arbiterMainLog(repo: string): string[] {
	gitIn(['fetch', '-q', ARBITER], repo);
	return gitIn(['log', '--format=%H', `${ARBITER}/main`], repo)
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s !== '');
}

describe('surface — tree-less CAS transition (in-progress/ → needs-attention/, no cwd tree)', () => {
	it('moves in-progress/ → needs-attention/ on the arbiter WITHOUT a cwd checkout of the item', async () => {
		const {repo} = await claimedOnArbiterOnly('alpha');
		// Precondition: the surfaced state is NOT in the cwd working tree (it lives
		// only on the arbiter's main), proving the move cannot come from the cwd tree.
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			false,
		);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);

		const result = await surfaceToNeedsAttention({
			cwd: repo,
			slug: 'alpha',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The move landed on the arbiter's main: in-progress/ → needs-attention/.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
	});

	it('appends the reason to the item BODY on the move (read via the arbiter, not the cwd tree)', async () => {
		const {repo, seeded} = await claimedOnArbiterOnly('gamma');
		const reason = 'rebase onto the latest main conflicted (aborted)';
		const result = await surfaceToNeedsAttention({
			cwd: repo,
			slug: 'gamma',
			reason,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// Read the moved file from a FRESH clone of the arbiter (the durable home).
		const fresh = seeded.clone('reader');
		const body = readFileSync(
			join(fresh, 'work', 'needs-attention', 'gamma.md'),
			'utf8',
		);
		expect(body).toMatch(/## Needs attention/);
		expect(body).toMatch(/rebase onto the latest main conflicted/);
	});

	it('does NOT touch the cwd working tree: a pre-existing untracked file is neither staged nor committed, HEAD does not move', async () => {
		const {repo} = await claimedOnArbiterOnly('beta');

		// Seed an UNTRACKED file in the shared checkout — the kind of stray WIP a
		// cwd-bound commit path could have swept up.
		mkdirSync(join(repo, 'work', 'ideas'), {recursive: true});
		const strayRel = 'work/ideas/assistant-wip.md';
		writeFileSync(join(repo, strayRel), '# an idea being written\n');

		const beforeArbiter = arbiterMainLog(repo);
		const beforeHead = gitIn(['rev-parse', 'HEAD'], repo).trim();

		const result = await surfaceToNeedsAttention({
			cwd: repo,
			slug: 'beta',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// 1. The stray file is STILL UNTRACKED in the cwd (status shows it as `??`).
		const status = gitIn(['status', '--porcelain', strayRel], repo);
		expect(status.trim()).toBe(`?? ${strayRel}`);

		// 2. The cwd HEAD did not move — the surface made NO commit in the cwd tree.
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).toBe(beforeHead);

		// 3. The stray file is absent from EVERY commit the surface added to the arbiter.
		const afterArbiter = arbiterMainLog(repo);
		const newCommits = afterArbiter.filter((c) => !beforeArbiter.includes(c));
		expect(newCommits.length).toBeGreaterThan(0);
		for (const commit of newCommits) {
			const files = gitIn(['show', '--name-only', '--format=', commit], repo);
			expect(files).not.toMatch(/assistant-wip\.md/);
		}

		// 4. And the move itself DID land (in-progress → needs-attention).
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'beta')).toBe(false);
	});

	it('the recoverable kept work/slice-<slug> branch is UNCHANGED on the arbiter (after-commit, no branch push)', async () => {
		const {repo} = await claimedOnArbiterOnly('eta');
		gitIn(['fetch', '-q', ARBITER], repo);
		const branchBefore = gitIn(
			['rev-parse', `${ARBITER}/work/slice-eta`],
			repo,
		).trim();

		const result = await surfaceToNeedsAttention({
			cwd: repo,
			slug: 'eta',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The kept branch is left intact on the arbiter (recoverable) — the surface
		// is purely the ledger move; it pushed no branch and changed no tip.
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['rev-parse', `${ARBITER}/work/slice-eta`], repo).trim()).toBe(
			branchBefore,
		);
	});

	it('converges against an advanced main: surfaces ON TOP of an unrelated main advance', async () => {
		const {repo, seeded} = await claimedOnArbiterOnly('zeta');

		// Advance the arbiter's main from a SEPARATE clone, then surface: the helper's
		// fresh base + its leased fast-forward land the move ON TOP of the advance
		// (never clobbering it). The GENUINE first-attempt-rejection retry is covered
		// deterministically by the two-concurrent-surfaces test below.
		const mover = seeded.clone('mover');
		gitIn(['fetch', '-q', ARBITER], mover);
		gitIn(['switch', '-q', '-C', 'mv-main', `${ARBITER}/main`], mover);
		writeFileSync(join(mover, 'unrelated.txt'), 'an unrelated main advance\n');
		gitIn(['add', '-A'], mover);
		gitIn(['commit', '-q', '-m', 'unrelated main advance'], mover);
		gitIn(['push', '-q', ARBITER, 'mv-main:main'], mover);

		const result = await surfaceToNeedsAttention({
			cwd: repo,
			slug: 'zeta',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The move landed ON TOP of the advanced main: the unrelated commit is still
		// present AND the surface move applied (in-progress → needs-attention).
		expect(existsOnArbiterMain(repo, 'needs-attention', 'zeta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'zeta')).toBe(false);
		const fresh = seeded.clone('after');
		expect(existsSync(join(fresh, 'unrelated.txt'))).toBe(true);
	});

	it('two CONCURRENT surfaces over the same arbiter both land (the contention loop refetches + retries the loser through the CAS)', async () => {
		// Two distinct slugs, both claimed + their kept branches pushed, surfaced AT
		// THE SAME TIME from two independent clones. Their leased `:main` pushes
		// genuinely race: the loser's first push is rejected (main moved under it), so
		// the SHARED contention loop refetches + rebuilds against the advanced base and
		// retries — the same stale-base CAS path `claim`/`requeue` retry. BOTH must land.
		const seeded = seedRepoWithArbiter(scratch.root, ['rho', 'sigma']);
		const setup = async (slug: string): Promise<string> => {
			const clone = seeded.clone(`racer-${slug}`);
			const claim = await performClaim({
				slug,
				cwd: clone,
				arbiter: ARBITER,
				env: gitEnv(),
			});
			expect(claim.exitCode).toBe(0);
			gitIn(['fetch', '-q', ARBITER], clone);
			gitIn(
				['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`],
				clone,
			);
			writeFileSync(join(clone, `${slug}.txt`), `${slug} work\n`);
			gitIn(['add', '-A'], clone);
			gitIn(['commit', '-q', '-m', `${slug} work`], clone);
			gitIn(
				['push', '-q', ARBITER, `work/slice-${slug}:work/slice-${slug}`],
				clone,
			);
			gitIn(['fetch', '-q', ARBITER], clone);
			gitIn(['checkout', '-q', '-f', 'main'], clone);
			return clone;
		};
		// Claim sequentially (claim is itself a CAS); the SURFACES race.
		const rhoRepo = await setup('rho');
		const sigmaRepo = await setup('sigma');

		const [rRho, rSigma] = await Promise.all([
			surfaceToNeedsAttention({
				cwd: rhoRepo,
				slug: 'rho',
				reason: 'continue push failed terminally',
				arbiter: ARBITER,
				env: gitEnv(),
			}),
			surfaceToNeedsAttention({
				cwd: sigmaRepo,
				slug: 'sigma',
				reason: 'continue push failed terminally',
				arbiter: ARBITER,
				env: gitEnv(),
			}),
		]);
		expect(rRho.moved).toBe(true);
		expect(rSigma.moved).toBe(true);

		// Both moves converged onto the arbiter's main (the loser retried through the
		// CAS), so BOTH items are surfaced and NEITHER is left in-progress.
		expect(existsOnArbiterMain(rhoRepo, 'needs-attention', 'rho')).toBe(true);
		expect(existsOnArbiterMain(rhoRepo, 'needs-attention', 'sigma')).toBe(true);
		expect(existsOnArbiterMain(rhoRepo, 'in-progress', 'rho')).toBe(false);
		expect(existsOnArbiterMain(rhoRepo, 'in-progress', 'sigma')).toBe(false);
	});

	it('refuses (no move) when no arbiter is given — tree-less CAS needs a ref to push to', async () => {
		const {repo} = await claimedOnArbiterOnly('delta');
		const result = await surfaceToNeedsAttention({
			cwd: repo,
			slug: 'delta',
			reason: 'continue push failed terminally',
			arbiter: '',
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/arbiter/i);
	});

	it('refuses (no move) when the slug is on the arbiter in neither in-progress/ nor needs-attention/', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['theta']);
		const repo = seeded.repo;
		// Never claimed: theta is in backlog/ on the arbiter, not in-progress/.
		const result = await surfaceToNeedsAttention({
			cwd: repo,
			slug: 'theta',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/in-progress|needs-attention/i);
	});

	it('the seam method delegates to the tree-less surface (one mechanism, reachable through the write seam)', async () => {
		const {repo} = await claimedOnArbiterOnly('iota');
		const result = await ledgerWrite.applyTreelessNeedsAttentionTransition({
			cwd: repo,
			slug: 'iota',
			reason: 'continue push failed terminally',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'iota')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'iota')).toBe(false);
	});
});
