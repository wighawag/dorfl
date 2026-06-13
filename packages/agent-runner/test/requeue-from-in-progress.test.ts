import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {returnToBacklog} from '../src/needs-attention.js';
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
	scratch = makeScratch('agent-runner-requeue-in-progress-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * Reproduce a slice STUCK in `in-progress/` on the arbiter (never surfaced to
 * needs-attention) WITH a prior attempt's commit on `work/<slug>` pushed to the
 * arbiter (the durable artifact a keep+continue requeue keeps). This is the
 * un-surfaced-abort / killed-run / in-place-requeue-note class: the claim PUSHED
 * `in-progress/<slug>.md` to the arbiter's main (a tree-less CAS), but no
 * subsequent surface or done-move ever moved it out, so it is stranded in
 * `in-progress/`.
 *
 * The cwd is left on the seed `main` (which never checked out the in-progress
 * state), so a requeue must read the slug's current folder from the ARBITER, not
 * the cwd tree.
 */
async function stuckInProgress(
	slug: string,
): Promise<{seeded: SeededRepo; repo: string; priorTip: string}> {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	// The claim publishes work/in-progress/<slug>.md to the arbiter's main (the
	// tree-less CAS) — exactly how a real claim leaves the item in in-progress/.
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	// A prior attempt commits work on work/<slug> and pushes the branch (the
	// keep+continue artifact). The run is then KILLED — nothing surfaces it, so it
	// stays in in-progress/ on the arbiter.
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'prior.txt'), 'prior attempt work\n');
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'prior attempt work'], repo);
	const priorTip = gitIn(['rev-parse', 'HEAD'], repo).trim();
	gitIn(['push', '-q', ARBITER, `work/slice-${slug}:work/slice-${slug}`], repo);
	// Leave the cwd on a clean main (NOT the in-progress surfaced state): the
	// requeue must resolve the source folder from the arbiter, not the cwd tree.
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['checkout', '-q', '-f', 'main'], repo);
	return {seeded, repo, priorTip};
}

/** The commit shas reachable from `<arbiter>/main` (newest first). */
function arbiterMainLog(repo: string): string[] {
	gitIn(['fetch', '-q', ARBITER], repo);
	return gitIn(['log', '--format=%H', `${ARBITER}/main`], repo)
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s !== '');
}

/** The arbiter's sha for a full ref, or ''. */
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

describe('requeue recovers a slice stuck in in-progress/ (not only needs-attention/)', () => {
	it('moves in-progress/ → backlog/ on the arbiter WITHOUT a cwd checkout of the item', async () => {
		const {repo} = await stuckInProgress('alpha');
		// Precondition: the item is NOT in needs-attention/ (it never surfaced) — it
		// is stuck in in-progress/ on the arbiter.
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
		// And the cwd tree never checked the in-progress state out.
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			false,
		);

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'alpha',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// The move landed on the arbiter's main: in-progress/ → backlog/.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
	});

	it('keep+continue (default) leaves the work branch on the arbiter untouched', async () => {
		const {seeded, repo} = await stuckInProgress('beta');
		const before = arbiterRef(seeded, 'refs/heads/work/slice-beta');
		expect(before).not.toBe('');

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'beta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(result.deletedRemoteBranch).toBeFalsy();

		// The kept work branch is UNTOUCHED on the arbiter (the next claim continues
		// from its tip).
		expect(arbiterHasBranch(seeded, 'work/slice-beta')).toBe(true);
		expect(arbiterRef(seeded, 'refs/heads/work/slice-beta')).toBe(before);
		// And the item moved to backlog/.
		expect(existsOnArbiterMain(repo, 'backlog', 'beta')).toBe(true);
	});

	it('--reset deletes the remote work branch FIRST, then moves in-progress/ → backlog/', async () => {
		const {seeded, repo} = await stuckInProgress('gamma');
		expect(arbiterHasBranch(seeded, 'work/slice-gamma')).toBe(true);

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'gamma',
			arbiter: ARBITER,
			reset: true,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);
		expect(result.deletedRemoteBranch).toBe(true);
		// The remote branch is GONE (discarded).
		expect(arbiterHasBranch(seeded, 'work/slice-gamma')).toBe(false);
		// The item moved to backlog/ (after the delete).
		expect(existsOnArbiterMain(repo, 'backlog', 'gamma')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'gamma')).toBe(false);
	});

	it('-m appends a dated handoff note (read+rewritten via the arbiter, not the cwd tree)', async () => {
		const {seeded, repo} = await stuckInProgress('delta');
		const result = await returnToBacklog({
			cwd: repo,
			slug: 'delta',
			arbiter: ARBITER,
			message: 'killed mid-run; resume from the prior attempt',
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		const fresh = seeded.clone('reader');
		const body = readFileSync(
			join(fresh, 'work', 'backlog', 'delta.md'),
			'utf8',
		);
		expect(body).toMatch(/## Requeue \d{4}-\d{2}-\d{2}/);
		expect(body).toMatch(/killed mid-run; resume from the prior attempt/);
	});

	it('a pre-existing untracked cwd file is neither staged nor committed (tree-less CAS)', async () => {
		const {repo} = await stuckInProgress('epsilon');

		// Seed an UNTRACKED file in the shared checkout — a concurrent writer's WIP.
		mkdirSync(join(repo, 'work', 'ideas'), {recursive: true});
		const strayRel = 'work/ideas/concurrent-wip.md';
		writeFileSync(join(repo, strayRel), '# a concurrent writer was editing\n');

		const beforeArbiter = arbiterMainLog(repo);
		const beforeHead = gitIn(['rev-parse', 'HEAD'], repo).trim();

		const result = await returnToBacklog({
			cwd: repo,
			slug: 'epsilon',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(true);

		// 1. The stray file is STILL UNTRACKED in the cwd.
		const status = gitIn(['status', '--porcelain', strayRel], repo);
		expect(status.trim()).toBe(`?? ${strayRel}`);
		// 2. The cwd HEAD did not move — requeue made NO commit in the cwd tree.
		expect(gitIn(['rev-parse', 'HEAD'], repo).trim()).toBe(beforeHead);
		// 3. The stray file is absent from EVERY commit requeue added to the arbiter.
		const afterArbiter = arbiterMainLog(repo);
		const newCommits = afterArbiter.filter((c) => !beforeArbiter.includes(c));
		expect(newCommits.length).toBeGreaterThan(0);
		for (const commit of newCommits) {
			const files = gitIn(['show', '--name-only', '--format=', commit], repo);
			expect(files).not.toMatch(/concurrent-wip\.md/);
		}
		// 4. The move itself DID land (in-progress → backlog).
		expect(existsOnArbiterMain(repo, 'backlog', 'epsilon')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'epsilon')).toBe(false);
	});

	it('gives a CLEAR actionable message (never a bare "not found") for a slug stuck in neither folder', async () => {
		// A seeded repo where the slug is only in backlog/ (never claimed): requeue
		// must refuse with a message that NAMES both legitimate stuck folders.
		const seeded = seedRepoWithArbiter(scratch.root, ['zeta']);
		const result = await returnToBacklog({
			cwd: seeded.repo,
			slug: 'zeta',
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.moved).toBe(false);
		expect(result.reasonNotMoved).toMatch(/needs-attention/);
		expect(result.reasonNotMoved).toMatch(/in-progress/);
		// Not a bare "not found".
		expect(result.reasonNotMoved).not.toMatch(/^not found$/i);
	});
});
